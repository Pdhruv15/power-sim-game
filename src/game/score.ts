import { BANDS, cableAmps, PHASES, topBoard, type Level } from '../sim';
import { designCost } from './catalog';
import { fmt, hhmm } from './format';
import type { DayRun } from './runDay';

/** The sizing rule every level builds on. */
export const SIZING_RULE = 'Room current ≤ breaker ≤ cable';

export type ScoreKey = 'supply' | 'safety' | 'loading' | 'voltage' | 'balance' | 'protection' | 'cost' | 'solar';

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
  /** Circuit or board id the lesson is about. */
  target?: string;
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

/** Level 1 scoring. Other levels set their own points in the level file. */
export const DEFAULT_POINTS: Readonly<Partial<Record<ScoreKey, number>>> = { supply: 400, safety: 250, loading: 150, cost: 100, solar: 100 };

const LABELS: Record<ScoreKey, string> = {
  supply: 'Power kept on', safety: 'Safe design', loading: 'Healthy loading', voltage: 'Voltage at the rooms',
  balance: 'Balanced phases', protection: 'Short circuit handled', cost: 'Within budget', solar: 'Solar share',
};
const ORDER: ScoreKey[] = ['supply', 'safety', 'loading', 'voltage', 'balance', 'protection', 'cost', 'solar'];

/** Each unsafe breaker costs half the safety points, each busy breaker a third of the loading points, and so on. */
const UNSAFE_SHARE = 1 / 2;
const HIGH_LOAD_SHARE = 1 / 3;
const DROP_SHARE = 1 / 5;
const IMBALANCE_SHARE = 1 / 2;
/** Keep the voltage drop from the supply to any room under this. */
export const MAX_DROP_PCT = 5;
/** A three-phase board is unbalanced when its quietest phase is this much below its busiest at peak. */
export const MAX_IMBALANCE = 0.25;
const OVER_BUDGET_SLOPE = 4;     // 25 % over budget loses all cost points
const SOLAR_TARGET_SHARE = 0.3;  // full solar points when solar covers 30 % of the day's energy
const STARS = { one: 500, two: 750, three: 900 };

const clamp01 = (x: number): number => Math.min(1, Math.max(0, x));
/** Percent text that never shows "90 %" for a value just over the 90 % limit. */
const pct = (loading: number): string => {
  const r = Math.round(loading * 100);
  return r <= 90 && loading > BANDS.high ? (loading * 100).toFixed(1) : String(r);
};

/** Score a finished day. Pure function of the design and what happened. */
export function scoreDay(level: Level, day: DayRun): ScoreCard {
  const weights = { ...(level.points ?? DEFAULT_POINTS) } as Partial<Record<ScoreKey, number>>;
  const max = (k: ScoreKey) => weights[k] ?? 0;
  const mistakes: Lesson[] = [], warnings: Lesson[] = [], good: Lesson[] = [];
  const points: Partial<Record<ScoreKey, number>> = {};
  const top = topBoard(level);
  const roomsOn = (boardId: string) => level.circuits.filter(c => c.board === boardId);

  // ---- Power kept on
  points.supply = max('supply') * (day.energy.demand > 0 ? day.energy.supplied / day.energy.demand : 1);
  const overloadTrip = (id: string) => (day.faultTripped.has(id) ? undefined : day.tripHour.get(id));
  for (const b of level.boards) {
    const at = overloadTrip(b.id);
    if (at === undefined) continue;
    const p = day.boardPeaks.get(b.id)!;
    const isMain = b.id === top.id;
    mistakes.push({
      kind: 'mistake', target: b.id, title: isMain ? 'Main breaker too small' : `Feeder breaker too small: ${b.name}`,
      text: `${isMain ? 'Everything together' : b.name} needed ${fmt(p.amps)} A on the busiest phase, but the breaker is ${b.breakerA} A. ` +
        `It tripped at ${hhmm(at)} and ${isMain ? 'everything' : 'every room on this board'} lost power. ` +
        'A board breaker must carry all its rooms together.',
    });
  }
  for (const c of level.circuits) {
    const at = overloadTrip(c.id);
    if (at === undefined) continue;
    const p = day.peaks.get(c.id)!;
    mistakes.push({
      kind: 'mistake', target: c.id, title: `Breaker too small: ${c.room}`,
      text: `${c.room} needs up to ${fmt(p.amps)} A at ${hhmm(p.hour)}, but its breaker is ${c.breakerA} A. ` +
        `The breaker heated up and tripped at ${hhmm(at)}, and the room had no power after that. ` +
        `Pick a breaker bigger than the room's highest current, on a cable that can carry it.`,
    });
  }
  if ([...day.tripHour.keys()].every(id => day.faultTripped.has(id)) && day.faults.every(f => f.selective)) good.push({ kind: 'good', title: 'Power stayed on all day', text: 'No breaker tripped. Every room had power for the whole day.' });

  // ---- Safety: each breaker must protect its cable
  let unsafe = 0;
  for (const c of level.circuits) {
    if (c.breakerA <= cableAmps(c.cableMm2)) continue;
    unsafe++;
    mistakes.push({
      kind: 'mistake', target: c.id, title: `Breaker bigger than the cable: ${c.room}`,
      text: `The ${c.breakerA} A breaker lets up to ${c.breakerA} A through a ${c.cableMm2} mm² cable that is only good for ` +
        `${cableAmps(c.cableMm2)} A. The cable can overheat before the breaker trips, which is a fire risk. ` +
        'Use a bigger cable, or a smaller breaker if the room allows it.',
    });
  }
  for (const b of level.boards) {
    if (!b.cable || b.breakerA <= cableAmps(b.cable.mm2)) continue;
    unsafe++;
    mistakes.push({
      kind: 'mistake', target: b.id, title: `Breaker bigger than the feeder cable: ${b.name}`,
      text: `The ${b.breakerA} A breaker feeds ${b.name} through a ${b.cable.mm2} mm² cable that is only good for ` +
        `${cableAmps(b.cable.mm2)} A. The cable can overheat before the breaker trips. Use a bigger feeder cable.`,
    });
  }
  points.safety = Math.max(0, max('safety') * (1 - UNSAFE_SHARE * unsafe));
  if (unsafe === 0) good.push({ kind: 'good', title: 'Every cable is protected', text: 'Each breaker is at or below what its cable can carry.' });

  // ---- Healthy loading: peaks should stay under 90 % of each breaker
  let busy = 0;
  for (const c of level.circuits) {
    const p = day.peaks.get(c.id);
    if (day.tripHour.has(c.id) || !p || p.loading <= BANDS.high) continue;
    busy++;
    warnings.push({
      kind: 'warning', target: c.id, title: `Running close to the limit: ${c.room}`,
      text: `${c.room} reached ${pct(p.loading)} % of its ${c.breakerA} A breaker at ${hhmm(p.hour)}. ` +
        'It held today, but a hotter day could trip it. Keep normal peaks under 90 %.',
    });
  }
  for (const b of level.boards) {
    const p = day.boardPeaks.get(b.id)!;
    if (day.tripHour.has(b.id) || p.loading <= BANDS.high) continue;
    busy++;
    const over = p.loading > 1;
    const name = b.id === top.id ? 'Main breaker' : `${b.name} breaker`;
    warnings.push({
      kind: 'warning', target: b.id, title: over ? `${name} overloaded` : `${name} close to the limit`,
      text: `${b.id === top.id ? 'All rooms together' : `The rooms on ${b.name}`} drew ${fmt(p.amps)} A at ${hhmm(p.hour)}, ` +
        `${pct(p.loading)} % of the ${b.breakerA} A breaker. ` + (over ? 'It was heating up and nearly tripped. ' : '') + 'Keep it under 90 %.',
    });
  }
  points.loading = Math.max(0, max('loading') * (1 - HIGH_LOAD_SHARE * busy));

  // ---- Voltage at the rooms
  if (max('voltage') > 0) {
    let low = 0;
    for (const b of level.boards) {
      const over = roomsOn(b.id).filter(c => (day.drops.get(c.id)?.vdPct ?? 0) > MAX_DROP_PCT);
      if (!over.length) continue;
      low += over.length;
      const worst = over.reduce((w, c) => (day.drops.get(c.id)!.vdPct > day.drops.get(w.id)!.vdPct ? c : w));
      const d = day.drops.get(worst.id)!;
      warnings.push({
        kind: 'warning', target: b.id, title: `Voltage too low in ${b.name}`,
        text: `${over.length} room${over.length > 1 ? 's' : ''} lost more than ${MAX_DROP_PCT} % of the voltage. The worst was ` +
          `${worst.room} with ${fmt(d.vdPct)} % at ${hhmm(d.hour)}. Long and thin cables lose voltage, so lights dim and motors run hot. ` +
          'Use a bigger feeder cable for long runs, or bigger room cables.',
      });
    }
    points.voltage = Math.max(0, max('voltage') * (1 - DROP_SHARE * low));
    if (low === 0) good.push({ kind: 'good', title: 'Good voltage everywhere', text: `Every room stayed within ${MAX_DROP_PCT} % of the supply voltage.` });
  }

  // ---- Balanced phases on three-phase boards
  if (max('balance') > 0) {
    let unbalanced = 0;
    for (const b of level.boards.filter(x => x.phases === 3)) {
      const p = day.boardPeaks.get(b.id)!;
      if (p.imbalance <= MAX_IMBALANCE) continue;
      unbalanced++;
      const split = PHASES.map((ph, i) => `${ph} ${fmt(Math.abs(p.phaseAmps[i]), 0)} A`).join(', ');
      warnings.push({
        kind: 'warning', target: b.id, title: `Phases unbalanced: ${b.name}`,
        text: `At ${hhmm(p.hour)} the phases carried ${split}. The busiest phase decides when the breaker trips, ` +
          'so one overloaded phase wastes the other two. Spread the rooms so each phase carries a similar load.',
      });
    }
    points.balance = Math.max(0, max('balance') * (1 - IMBALANCE_SHARE * unbalanced));
    if (unbalanced === 0) good.push({ kind: 'good', title: 'Phases balanced', text: 'The three phases shared the load evenly on every board.' });
  }

  // ---- Short circuits: the nearest breaker should open at once, and nothing upstream
  if (max('protection') > 0 && day.faults.length) {
    const share = max('protection') / day.faults.length;
    let lost = 0;
    const nameOf = (id: string) => level.circuits.find(c => c.id === id)?.room ?? level.boards.find(b => b.id === id)?.name ?? id;
    for (const f of day.faults) {
      const room = level.circuits.find(c => c.id === f.circuit)!;
      const own = f.path[0];
      if (!f.instant) {
        lost += share;
        mistakes.push({
          kind: 'mistake', target: room.id, title: `Short circuit not cleared at once: ${room.room}`,
          text: `At ${hhmm(f.hour)} the short in ${room.room} drew only ${fmt(f.amps, 0)} A. Its ${room.breakerA} A breaker needs ` +
            `${fmt(own.instantA, 0)} A to trip at once, so the fault lasted ${fmt(f.seconds)} s. The cable heats fast and metal parts ` +
            'can give a shock. Use a smaller breaker, or a shorter or thicker cable so more current flows in a fault.',
        });
      } else if (!f.selective) {
        lost += share / 2;
        const upstream = f.tripped.filter(id => id !== room.id);
        const ownMissed = !f.tripped.includes(room.id);
        warnings.push({
          kind: 'warning', target: room.id, title: `Too many breakers tripped: ${room.room}`,
          text: `At ${hhmm(f.hour)} the short in ${room.room} drew ${fmt(f.amps, 0)} A, and ${upstream.map(nameOf).join(', ')} opened too, ` +
            'so every room behind it lost power. ' +
            (ownMissed ? `${room.room}'s own ${room.breakerA} A breaker needs ${fmt(own.instantA, 0)} A to trip at once. ` : '') +
            `A board breaker trips at once from 10 × its rating. Pick board breakers above ${fmt(f.amps / 10, 0)} A on this path, ` +
            'on cables that can carry them, so only the nearest breaker opens.',
        });
      } else {
        good.push({
          kind: 'good', title: `Only the faulty room went off: ${room.room}`,
          text: `The short drew ${fmt(f.amps, 0)} A. ${room.room}'s breaker opened at once and every other room kept its power.`,
        });
      }
    }
    points.protection = Math.max(0, max('protection') - lost);
  }

  // ---- Cost against the level budget
  const cost = designCost(level);
  const budget = level.budget ?? null;
  const overBudget = budget ? cost / budget - 1 : 0;
  points.cost = max('cost') * clamp01(1 - Math.max(0, overBudget) * OVER_BUDGET_SLOPE);
  if (budget && overBudget > 0) {
    warnings.push({ kind: 'warning', title: 'Over budget', text: `The design costs ${cost} credits against a budget of ${budget}. Bigger equipment than needed costs points.` });
  }

  // ---- Solar share of the day's energy
  const solarShare = day.energy.demand > 0 ? day.energy.solarUsed / day.energy.demand : 0;
  points.solar = max('solar') * clamp01(solarShare / SOLAR_TARGET_SHARE);
  if (day.energy.solar > 0.05) {
    good.push({
      kind: 'good', title: 'Solar helped',
      text: `The panels gave ${fmt(day.energy.solar)} kWh. The rooms used ${fmt(day.energy.solarUsed)} kWh of it directly` +
        (day.energy.exported > 0.05 ? ` and sent ${fmt(day.energy.exported)} kWh to the grid.` : '.'),
    });
  }

  const parts: ScorePart[] = ORDER.filter(k => max(k) > 0)
    .map(k => ({ key: k, label: LABELS[k], points: Math.round(points[k] ?? 0), max: max(k) }));
  const total = parts.reduce((s, p) => s + p.points, 0);
  const full = parts.reduce((s, p) => s + p.max, 0);
  // Star thresholds are set for 1000 points; scale them if a level uses a different total.
  const scale = full / 1000;
  const clean = mistakes.length === 0;
  const stars = total >= STARS.three * scale && clean ? 3 : total >= STARS.two * scale ? 2 : total >= STARS.one * scale ? 1 : 0;

  return { total, max: full, stars, parts, lessons: [...mistakes, ...warnings, ...good], cost, budget };
}
