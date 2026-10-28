import { NEW_BREAKER, stepBreaker, type BreakerState } from './breaker';
import { cableDropV } from './cables';
import { branchCurrents, levelNetwork, maxPhase, onPhase, type Network, type PhaseAmps } from './network';
import { POWER_FACTOR, profileAt, wrapHour } from './profiles';
import { pvOutput, sunAt, type Sun } from './sun';
import { topBoard, type LoadType, type Level, type Phase } from './types';

/** Loading bands as a fraction of breaker rating: green < 60 %, orange 60–90 %, red > 90 %. */
export const BANDS = { warn: 0.6, high: 0.9 } as const;
export type Band = 'ok' | 'warn' | 'high';
export const bandOf = (loading: number): Band => (loading > BANDS.high ? 'high' : loading >= BANDS.warn ? 'warn' : 'ok');

/** Longest single breaker step, so a big time jump while playing still trips at the right moment. */
const MAX_STEP_HOURS = 0.05;

export interface CircuitResult {
  id: string;
  board: string;
  room: string;
  type: LoadType;
  phase: Phase;
  breakerA: number;
  /** What the room asks for at this time, even if its breaker is off. */
  demandKw: number;
  demandA: number;
  /** What actually flows (0 when off). */
  kw: number;
  amps: number;
  /** demandA ÷ breakerA. */
  loading: number;
  band: Band;
  /** Above rating and heating towards a trip. */
  overloaded: boolean;
  /** 0–1, 1 = trip point. */
  heat: number;
  tripped: boolean;
  /** Off because this breaker or one upstream is open. */
  dead: boolean;
  /** Voltage lost from the supply to this room, as % of the phase voltage. */
  vdPct: number;
}

export interface BoardResult {
  id: string;
  name: string;
  parent: string | null;
  phases: 1 | 3;
  /** Current on L1, L2, L3. Negative when solar exports through this board. */
  phaseAmps: PhaseAmps;
  /** Highest phase current: what the board's breaker sees. */
  amps: number;
  ratingA: number;
  loading: number;
  band: Band;
  overloaded: boolean;
  heat: number;
  tripped: boolean;
  dead: boolean;
  /** Voltage lost from the supply to this board, as % of the phase voltage. */
  vdPct: number;
  /** (highest − lowest phase) ÷ highest, for three-phase boards. 0 = balanced. */
  imbalance: number;
  solarKw: number;
}

export interface SimResult {
  hour: number;
  sun: Sun;
  circuits: CircuitResult[];
  boards: BoardResult[];
  loadKw: number;
  /** Sum of all room currents. */
  loadA: number;
  solarKw: number;
  /** Load − solar. Negative = export to the grid. */
  gridKw: number;
  /** The top board, fed from the grid. Its breaker is the main breaker. */
  main: BoardResult;
}

/**
 * Runs a level through the day. Pure logic with no rendering, so the same class can run
 * in the browser game, in tests, or inside LV Design Studio.
 *
 *   setHour(h)   jump to a time (no time passes, breakers keep their heat)
 *   advance(dt)  let dt hours pass: breakers heat or cool and may trip
 */
export class Simulator {
  readonly network: Network;
  private breakers = new Map<string, BreakerState>();
  private parentOf: Map<string, string | null>;
  hour: number;

  constructor(readonly level: Level, hour = 0) {
    this.network = levelNetwork(level);
    this.parentOf = new Map(this.network.nodes.map(n => [n.id, n.parent]));
    this.hour = wrapHour(hour);
  }

  setHour(hour: number): void {
    this.hour = wrapHour(hour);
  }

  advance(dtHours: number): void {
    let left = Math.max(0, dtHours);
    while (left > 1e-9) {
      const dt = Math.min(left, MAX_STEP_HOURS);
      const flow = this.flow(this.hour);
      for (const node of this.network.nodes) {
        if (!node.breakerA) continue;
        const loading = maxPhase(flow.branch.get(node.id)!) / node.breakerA;
        this.breakers.set(node.id, stepBreaker(this.breaker(node.id), loading, dt));
      }
      this.hour = wrapHour(this.hour + dt);
      left -= dt;
    }
  }

  resetBreakers(): void {
    this.breakers.clear();
  }

  result(): SimResult {
    const { sun, solar, demand, branch } = this.flow(this.hour);
    const V = this.level.voltage;

    // Boards, parents before children so voltage drop can build up from the supply
    const boards: BoardResult[] = [];
    const byId = new Map<string, BoardResult>();
    for (const b of this.boardsTopDown()) {
      const phaseAmps = branch.get(b.id)!;
      const amps = maxPhase(phaseAmps);
      const loading = amps / b.breakerA;
      const state = this.breaker(b.id);
      const dead = !this.isLive(b.id);
      const feederDrop = b.cable ? cableDropV(amps, b.cable.mm2, b.cable.lengthM, b.phases) : 0;
      const sizes = phaseAmps.map(Math.abs);
      const imbalance = b.phases === 3 && amps > 0 ? (Math.max(...sizes) - Math.min(...sizes)) / Math.max(...sizes) : 0;
      const r: BoardResult = {
        id: b.id, name: b.name, parent: b.parent, phases: b.phases, phaseAmps, amps, ratingA: b.breakerA,
        loading, band: bandOf(loading), overloaded: !dead && loading > 1, heat: state.heat, tripped: state.tripped, dead,
        vdPct: (b.parent ? byId.get(b.parent)!.vdPct : 0) + (feederDrop / V) * 100,
        imbalance, solarKw: solar.get(b.id) ?? 0,
      };
      boards.push(r);
      byId.set(b.id, r);
    }

    const circuits = this.level.circuits.map((c): CircuitResult => {
      const d = demand.get(c.id)!;
      const state = this.breaker(c.id);
      const dead = !this.isLive(c.id);
      const loading = d.amps / c.breakerA;
      const amps = dead ? 0 : d.amps;
      return {
        id: c.id, board: c.board, room: c.room, type: c.type, phase: c.phase, breakerA: c.breakerA,
        demandKw: d.kw, demandA: d.amps, kw: dead ? 0 : d.kw, amps,
        loading, band: bandOf(loading), overloaded: !dead && loading > 1, heat: state.heat, tripped: state.tripped, dead,
        vdPct: byId.get(c.board)!.vdPct + (cableDropV(amps, c.cableMm2, c.lengthM, 1) / V) * 100,
      };
    });

    const loadKw = circuits.reduce((s, c) => s + c.kw, 0);
    const solarKw = [...solar.values()].reduce((s, k) => s + k, 0);
    return {
      hour: this.hour, sun, circuits, boards, loadKw, loadA: circuits.reduce((s, c) => s + c.amps, 0),
      solarKw, gridKw: loadKw - solarKw, main: byId.get(topBoard(this.level).id)!,
    };
  }

  private boardsTopDown() {
    const out: Level['boards'] = [];
    const visit = (parent: string | null) => {
      for (const b of this.level.boards) if (b.parent === parent) { out.push(b); visit(b.id); }
    };
    visit(null);
    return out;
  }

  private breaker(id: string): BreakerState {
    return this.breakers.get(id) ?? NEW_BREAKER;
  }

  /** A node is live when no breaker on the path back to the supply is open. */
  private isLive(id: string): boolean {
    for (let at: string | null | undefined = id; at; at = this.parentOf.get(at)) {
      if (this.breaker(at).tripped) return false;
    }
    return true;
  }

  /** Demand per circuit, solar per board, and current through each node at this hour. */
  private flow(hour: number) {
    const V = this.level.voltage;
    const sun = sunAt(hour);
    const demand = new Map<string, { kw: number; amps: number }>();
    const injected = new Map<string, PhaseAmps>();
    for (const c of this.level.circuits) {
      const kw = c.kw * profileAt(c.type, hour);
      const amps = (kw * 1000) / (V * POWER_FACTOR[c.type]);
      demand.set(c.id, { kw, amps });
      if (this.isLive(c.id)) injected.set(c.id, onPhase(this.level, c.id, amps));
    }
    // Solar runs only while its board is live (inverters switch off when the supply is lost).
    // It feeds L1 on a single-phase board and all three phases equally on a three-phase board. Power factor 1.
    const solar = new Map<string, number>();
    for (const b of this.level.boards) {
      if (b.solarKw <= 0 || !this.isLive(b.id)) continue;
      const kw = pvOutput(b.solarKw, sun);
      solar.set(b.id, kw);
      const a = -(kw * 1000) / V;
      injected.set(b.id, b.phases === 3 ? [a / 3, a / 3, a / 3] : [a, 0, 0]);
    }
    return { sun, solar, demand, branch: branchCurrents(this.network, injected) };
  }
}
