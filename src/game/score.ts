import { BANDS, cableAmps, type Circuit, type VillaData } from '../sim';
import { designCost } from './catalog';
import { fmt, hhmm } from './format';
import type { DayRun } from './runDay';

/** The one rule a learner needs for Level 1. */
export const SIZING_RULE = 'Room current ≤ breaker ≤ cable';

export type ScoreKey = 'supply' | 'safety' | 'loading' | 'cost' | 'solar';

export interface ScorePart {
  key: ScoreKey;
  label: string;
  points: number;
  max: number;
}

export interface Lesson {
  kind: 'mistake' | 'warning' | 'good';
  title: string;
  text: string;
  circuitId?: string;
}

export interface ScoreCard {
  total: number;
  max: number;
  stars: 0 | 1 | 2 | 3;
  parts: ScorePart[];
  /** Mistakes first, then warnings, then what went well. */
  lessons: Lesson[];
  cost: number;
  budget: number | null;
}

// Points available per part (total 1000)
const MAX: Record<ScoreKey, number> = { supply: 400, safety: 250, loading: 150, cost: 100, solar: 100 };
const UNSAFE_PENALTY = 125;      // per circuit whose breaker is bigger than its cable
const HIGH_LOAD_PENALTY = 50;    // per breaker running above 90 % at peak
const OVER_BUDGET_SLOPE = 4;     // 25 % over budget loses all cost points
const SOLAR_TARGET_SHARE = 0.3;  // full solar points when solar covers 30 % of the day's energy
const STARS = { one: 500, two: 750, three: 900 };

const isUnsafe = (c: Circuit): boolean => c.breakerA > cableAmps(c.cableMm2);
const clamp01 = (x: number): number => Math.min(1, Math.max(0, x));
/** Percent text that never shows "90 %" for a value just over the 90 % limit. */
const pct = (loading: number): string => {
  const r = Math.round(loading * 100);
  return r <= 90 && loading > BANDS.high ? (loading * 100).toFixed(1) : String(r);
};

/** Score a finished day. Pure function of the design and what happened. */
export function scoreDay(data: VillaData, day: DayRun): ScoreCard {
  const mistakes: Lesson[] = [], warnings: Lesson[] = [], good: Lesson[] = [];

  // Power kept on
  const suppliedShare = day.energy.demand > 0 ? day.energy.supplied / day.energy.demand : 1;
  const supply = MAX.supply * suppliedShare;
  if (day.mainTripHour !== null) {
    const p = day.mainPeak;
    mistakes.push({
      kind: 'mistake', title: 'Main breaker too small',
      text: `The whole villa needed ${fmt(p.amps)} A, but the main breaker is ${data.supply.mainBreakerA} A. ` +
        `It tripped at ${hhmm(day.mainTripHour)} and every room lost power. The main breaker must carry all rooms together.`,
    });
  }
  for (const c of data.circuits) {
    const at = day.tripHour.get(c.id);
    if (at === undefined) continue;
    const p = day.peaks.get(c.id)!;
    mistakes.push({
      kind: 'mistake', circuitId: c.id, title: `Breaker too small: ${c.room}`,
      text: `${c.room} needs up to ${fmt(p.amps)} A at ${hhmm(p.hour)}, but its breaker is ${c.breakerA} A. ` +
        `The breaker heated up and tripped at ${hhmm(at)}, and the room had no power after that. ` +
        `Pick a breaker bigger than the room's highest current, on a cable that can carry it.`,
    });
  }
  if (day.tripHour.size === 0 && day.mainTripHour === null) {
    good.push({ kind: 'good', title: 'Power stayed on all day', text: 'No breaker tripped. Every room had power for the whole day.' });
  }

  // Safety: each breaker must protect its cable
  const unsafe = data.circuits.filter(isUnsafe);
  const safety = Math.max(0, MAX.safety - UNSAFE_PENALTY * unsafe.length);
  for (const c of unsafe) {
    mistakes.push({
      kind: 'mistake', circuitId: c.id, title: `Breaker bigger than the cable: ${c.room}`,
      text: `The ${c.breakerA} A breaker lets up to ${c.breakerA} A through a ${c.cableMm2} mm² cable that is only good for ` +
        `${cableAmps(c.cableMm2)} A. The cable can overheat before the breaker trips, which is a fire risk. ` +
        `Use a bigger cable, or a smaller breaker if the room allows it.`,
    });
  }
  if (unsafe.length === 0) good.push({ kind: 'good', title: 'Every cable is protected', text: 'Each breaker is at or below what its cable can carry.' });

  // Healthy loading: peaks should stay under 90 % of the breaker
  const high = data.circuits.filter(c => !day.tripHour.has(c.id) && (day.peaks.get(c.id)?.loading ?? 0) > BANDS.high);
  const mainHigh = day.mainTripHour === null && day.mainPeak.loading > BANDS.high;
  const loading = Math.max(0, MAX.loading - HIGH_LOAD_PENALTY * (high.length + (mainHigh ? 1 : 0)));
  for (const c of high) {
    const p = day.peaks.get(c.id)!;
    warnings.push({
      kind: 'warning', circuitId: c.id, title: `Running close to the limit: ${c.room}`,
      text: `${c.room} reached ${pct(p.loading)} % of its ${c.breakerA} A breaker at ${hhmm(p.hour)}. ` +
        'It held today, but a hotter day could trip it. Keep normal peaks under 90 %.',
    });
  }
  if (mainHigh) {
    const over = day.mainPeak.loading > 1;
    warnings.push({
      kind: 'warning', title: over ? 'Main breaker overloaded' : 'Main breaker close to the limit',
      text: `All rooms together drew ${fmt(day.mainPeak.amps)} A at ${hhmm(day.mainPeak.hour)}, ${pct(day.mainPeak.loading)} % of the ` +
        `${data.supply.mainBreakerA} A main breaker. ` +
        (over ? 'It was heating up and nearly tripped the whole villa. ' : '') + 'Keep it under 90 %.',
    });
  }

  // Cost against the level budget
  const cost = designCost(data);
  const budget = data.budget ?? null;
  const over = budget ? cost / budget - 1 : 0;
  const costPoints = MAX.cost * clamp01(1 - Math.max(0, over) * OVER_BUDGET_SLOPE);
  if (budget && over > 0) {
    warnings.push({
      kind: 'warning', title: 'Over budget',
      text: `The design costs ${cost} credits against a budget of ${budget}. Bigger equipment than needed costs points.`,
    });
  }

  // Solar share of the day's energy
  const solarShare = day.energy.demand > 0 ? day.energy.solarUsed / day.energy.demand : 0;
  const solar = MAX.solar * clamp01(solarShare / SOLAR_TARGET_SHARE);
  if (data.solarKw > 0) {
    good.push({
      kind: 'good', title: 'Solar helped',
      text: `The panels gave ${fmt(day.energy.solar)} kWh. The villa used ${fmt(day.energy.solarUsed)} kWh of it directly` +
        (day.energy.exported > 0.05 ? ` and sent ${fmt(day.energy.exported)} kWh to the grid.` : '.'),
    });
  }

  const parts: ScorePart[] = [
    { key: 'supply', label: 'Power kept on', points: supply, max: MAX.supply },
    { key: 'safety', label: 'Safe design', points: safety, max: MAX.safety },
    { key: 'loading', label: 'Healthy loading', points: loading, max: MAX.loading },
    { key: 'cost', label: 'Within budget', points: costPoints, max: MAX.cost },
    { key: 'solar', label: 'Solar share', points: solar, max: MAX.solar },
  ].map(p => ({ ...p, points: Math.round(p.points) })) as ScorePart[];
  const total = parts.reduce((s, p) => s + p.points, 0);
  const clean = mistakes.length === 0;
  const stars = total >= STARS.three && clean ? 3 : total >= STARS.two ? 2 : total >= STARS.one ? 1 : 0;

  return { total, max: 1000, stars, parts, lessons: [...mistakes, ...warnings, ...good], cost, budget };
}
