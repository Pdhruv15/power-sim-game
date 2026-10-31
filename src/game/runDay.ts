import { BANDS, Simulator, topBoard, TRANSFORMER_ID, type FaultResult, type Level, type PhaseAmps, type SimResult } from '../sim';
import { fmt } from './format';

/** Fixed step for a scored day: 3 minutes, 480 frames. The same frames drive the replay. */
export const DAY_STEP_HOURS = 0.05;

export type DayEventKind = 'trip' | 'board-trip' | 'main-trip' | 'transformer-trip' | 'high' | 'fault';

export interface DayEvent {
  hour: number;
  kind: DayEventKind;
  /** Circuit or board id. */
  target?: string;
  text: string;
}

export interface Peak {
  loading: number;
  amps: number;
  hour: number;
}

export interface BoardPeak extends Peak {
  /** Phase currents and imbalance at the moment of the peak. */
  phaseAmps: PhaseAmps;
  imbalance: number;
}

export interface WorstDrop {
  vdPct: number;
  hour: number;
}

export interface DayFault extends FaultResult {
  hour: number;
  text: string;
}

export interface DayRun {
  /** One result per step from 00:00 to 24:00 inclusive. */
  frames: SimResult[];
  events: DayEvent[];
  /** kWh over the day. */
  energy: { demand: number; supplied: number; solar: number; solarUsed: number; grid: number; exported: number };
  /** Highest demand per circuit over the day (even while its breaker was off). */
  peaks: Map<string, Peak>;
  /** Highest current per board while it was on. */
  boardPeaks: Map<string, BoardPeak>;
  /** Worst voltage drop per room while it had power. */
  drops: Map<string, WorstDrop>;
  /** Hour each circuit or board breaker tripped. */
  tripHour: Map<string, number>;
  /** Hour the main breaker (top board) tripped, or null. */
  mainTripHour: number | null;
  /** Peak of the top board. */
  mainPeak: BoardPeak;
  /** Peak of the transformer while it was on, in levels that have one. */
  transformerPeak: Peak | null;
  /** Short circuits from the level file and how the breakers handled them. */
  faults: DayFault[];
  /** Breakers opened by a short circuit rather than by overload. */
  faultTripped: Set<string>;
}

/** Run a whole day from midnight with fresh breakers and record what happened. */
export function runDay(level: Level): DayRun {
  const sim = new Simulator(level, 0);
  const topId = topBoard(level).id;
  const steps = Math.round(24 / DAY_STEP_HOURS);
  const frames: SimResult[] = [];
  const events: DayEvent[] = [];
  const energy = { demand: 0, supplied: 0, solar: 0, solarUsed: 0, grid: 0, exported: 0 };
  const peaks = new Map<string, Peak>();
  const boardPeaks = new Map<string, BoardPeak>(level.boards.map(b => [b.id, { loading: 0, amps: 0, hour: 0, phaseAmps: [0, 0, 0], imbalance: 0 }]));
  const drops = new Map<string, WorstDrop>();
  const transformerPeak: Peak | null = level.transformer ? { loading: 0, amps: 0, hour: 0 } : null;
  const tripHour = new Map<string, number>();
  const warned = new Set<string>();
  const faults: DayFault[] = [];
  /** Rooms with a shorted cable: off for the rest of the day, and not counted as lost supply. */
  const faulted = new Set<string>();
  const faultTripped = new Set<string>();
  const pending = [...level.faults].sort((a, b) => a.hour - b.hour);
  const name = (id: string) => level.circuits.find(c => c.id === id)?.room ?? level.boards.find(b => b.id === id)?.name ?? id;

  for (let i = 0; i <= steps; i++) {
    const hour = i * DAY_STEP_HOURS;
    const r = { ...sim.result(), hour };
    frames.push(r);
    if (i === steps) break;

    const dt = DAY_STEP_HOURS;
    for (const c of r.circuits) {
      if (faulted.has(c.id)) continue;
      energy.demand += c.demandKw * dt;
      energy.supplied += c.kw * dt;
      if (c.loading > (peaks.get(c.id)?.loading ?? -1)) peaks.set(c.id, { loading: c.loading, amps: c.demandA, hour });
      if (!c.dead && c.vdPct > (drops.get(c.id)?.vdPct ?? -1)) drops.set(c.id, { vdPct: c.vdPct, hour });
      if (!c.dead && c.loading > BANDS.high && !warned.has(c.id)) {
        warned.add(c.id);
        events.push({ hour, kind: 'high', target: c.id, text: `${c.room} went above 90 % of its breaker` });
      }
    }
    for (const b of r.boards) {
      const p = boardPeaks.get(b.id)!;
      if (!b.tripped && b.loading > p.loading) {
        Object.assign(p, { loading: b.loading, amps: b.amps, hour, phaseAmps: [...b.phaseAmps], imbalance: b.imbalance });
      }
    }
    const tx = r.transformer;
    if (tx && transformerPeak && !tx.tripped && tx.loading > transformerPeak.loading) {
      Object.assign(transformerPeak, { loading: tx.loading, amps: tx.amps, hour });
    }
    if (tx && !tx.tripped && tx.loading > BANDS.high && !warned.has(TRANSFORMER_ID)) {
      warned.add(TRANSFORMER_ID);
      events.push({ hour, kind: 'high', target: TRANSFORMER_ID, text: `${tx.name} went above 90 % of its size` });
    }
    energy.solar += r.solarKw * dt;
    energy.solarUsed += Math.min(r.solarKw, r.loadKw) * dt;
    energy.grid += Math.max(0, r.gridKw) * dt;
    energy.exported += Math.max(0, -r.gridKw) * dt;

    // Short circuits due by the start of this step happen before time moves on
    while (pending.length && pending[0].hour <= hour + 1e-9) {
      const f = pending.shift()!;
      const res = sim.fault(f.circuit);
      faulted.add(f.circuit);
      faults.push({ ...res, hour: f.hour, text: f.text });
      for (const id of res.tripped) { tripHour.set(id, f.hour); faultTripped.add(id); }
      const opened = res.tripped.map(name).join(', ') || 'nothing';
      events.push({
        hour: f.hour, kind: 'fault', target: f.circuit,
        text: `${f.text}: ${fmt(res.amps, 0)} A. ${res.instant ? 'Opened at once' : `Took ${fmt(res.seconds)} s to clear`}: ${opened}`,
      });
    }

    sim.advance(dt);

    // Record breakers that opened during this step
    const after = sim.result();
    if (after.transformer?.tripped && !tripHour.has(TRANSFORMER_ID)) {
      tripHour.set(TRANSFORMER_ID, hour + dt);
      events.push({ hour: hour + dt, kind: 'transformer-trip', target: TRANSFORMER_ID, text: `${after.transformer.name} overheated and switched off: everything lost power` });
    }
    for (const c of after.circuits) {
      if (c.tripped && !tripHour.has(c.id)) {
        tripHour.set(c.id, hour + dt);
        events.push({ hour: hour + dt, kind: 'trip', target: c.id, text: `${c.room} breaker tripped` });
      }
    }
    for (const b of after.boards) {
      if (!b.tripped || tripHour.has(b.id)) continue;
      tripHour.set(b.id, hour + dt);
      events.push(b.id === topId
        ? { hour: hour + dt, kind: 'main-trip', target: b.id, text: 'Main breaker tripped: everything lost power' }
        : { hour: hour + dt, kind: 'board-trip', target: b.id, text: `${b.name} breaker tripped: the whole board lost power` });
    }
  }

  return {
    frames, events, energy, peaks, boardPeaks, drops, tripHour,
    mainTripHour: tripHour.get(topId) ?? null, mainPeak: boardPeaks.get(topId)!, transformerPeak, faults, faultTripped,
  };
}
