import { BANDS, Simulator, type SimResult, type VillaData } from '../sim';

/** Fixed step for a scored day: 3 minutes, 480 frames. The same frames drive the replay. */
export const DAY_STEP_HOURS = 0.05;

export type DayEventKind = 'trip' | 'main-trip' | 'high';

export interface DayEvent {
  hour: number;
  kind: DayEventKind;
  circuitId?: string;
  text: string;
}

export interface Peak {
  loading: number;
  amps: number;
  hour: number;
}

export interface DayRun {
  /** One result per step from 00:00 to 24:00 inclusive. */
  frames: SimResult[];
  events: DayEvent[];
  /** kWh over the day. */
  energy: { demand: number; supplied: number; solar: number; solarUsed: number; grid: number; exported: number };
  /** Highest demand per circuit over the day (even while its breaker was off). */
  peaks: Map<string, Peak>;
  /** Highest current through the main breaker while it was on. */
  mainPeak: Peak;
  tripHour: Map<string, number>;
  mainTripHour: number | null;
}

/** Run a whole day from midnight with fresh breakers and record what happened. */
export function runDay(data: VillaData): DayRun {
  const sim = new Simulator(data, 0);
  const steps = Math.round(24 / DAY_STEP_HOURS);
  const frames: SimResult[] = [];
  const events: DayEvent[] = [];
  const energy = { demand: 0, supplied: 0, solar: 0, solarUsed: 0, grid: 0, exported: 0 };
  const peaks = new Map<string, Peak>();
  const mainPeak: Peak = { loading: 0, amps: 0, hour: 0 };
  const tripHour = new Map<string, number>();
  const warned = new Set<string>();
  let mainTripHour: number | null = null;

  for (let i = 0; i <= steps; i++) {
    const hour = i * DAY_STEP_HOURS;
    const r = { ...sim.result(), hour };
    frames.push(r);
    if (i === steps) break;

    const dt = DAY_STEP_HOURS;
    for (const c of r.circuits) {
      energy.demand += c.demandKw * dt;
      energy.supplied += c.kw * dt;
      const p = peaks.get(c.id);
      if (!p || c.demandA / c.breakerA > p.loading) peaks.set(c.id, { loading: c.demandA / c.breakerA, amps: c.demandA, hour });
      if (!c.dead && c.loading > BANDS.high && !warned.has(c.id)) {
        warned.add(c.id);
        events.push({ hour, kind: 'high', circuitId: c.id, text: `${c.room} went above 90 % of its breaker` });
      }
    }
    energy.solar += r.solarKw * dt;
    energy.solarUsed += Math.min(r.solarKw, r.loadKw) * dt;
    energy.grid += Math.max(0, r.gridKw) * dt;
    energy.exported += Math.max(0, -r.gridKw) * dt;
    if (!r.main.tripped && r.main.loading > mainPeak.loading) Object.assign(mainPeak, { loading: r.main.loading, amps: r.main.amps, hour });

    sim.advance(dt);

    // Record breakers that opened during this step
    const after = sim.result();
    for (const c of after.circuits) {
      if (c.tripped && !tripHour.has(c.id)) {
        tripHour.set(c.id, hour + dt);
        events.push({ hour: hour + dt, kind: 'trip', circuitId: c.id, text: `${c.room} breaker tripped` });
      }
    }
    if (after.main.tripped && mainTripHour === null) {
      mainTripHour = hour + dt;
      events.push({ hour: hour + dt, kind: 'main-trip', text: 'Main breaker tripped: the whole villa lost power' });
    }
  }

  return { frames, events, energy, peaks, mainPeak, tripHour, mainTripHour };
}
