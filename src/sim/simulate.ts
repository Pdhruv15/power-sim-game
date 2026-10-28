import { NEW_BREAKER, stepBreaker, type BreakerState } from './breaker';
import { branchCurrents, MAIN_BOARD_ID, villaNetwork, type Network } from './network';
import { POWER_FACTOR, profileAt, wrapHour } from './profiles';
import { pvOutput, sunAt, type Sun } from './sun';
import type { LoadType, VillaData } from './types';

/** Loading bands as a fraction of breaker rating: green < 60 %, orange 60–90 %, red > 90 %. */
export const BANDS = { warn: 0.6, high: 0.9 } as const;
export type Band = 'ok' | 'warn' | 'high';
export const bandOf = (loading: number): Band => (loading > BANDS.high ? 'high' : loading >= BANDS.warn ? 'warn' : 'ok');

/** Longest single breaker step, so a big time jump while playing still trips at the right moment. */
const MAX_STEP_HOURS = 0.05;

export interface CircuitResult {
  id: string;
  room: string;
  type: LoadType;
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
}

export interface SimResult {
  hour: number;
  sun: Sun;
  circuits: CircuitResult[];
  loadKw: number;
  loadA: number;
  solarKw: number;
  /** Load − solar. Negative = export to the grid. */
  gridKw: number;
  main: { amps: number; ratingA: number; loading: number; band: Band; heat: number; tripped: boolean };
}

/**
 * Runs the villa through the day. Pure logic with no rendering, so the same class can run
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

  constructor(readonly data: VillaData, hour = 0) {
    this.network = villaNetwork(data);
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
        const loading = Math.abs(flow.branch.get(node.id) ?? 0) / node.breakerA;
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
    const { sun, solarKw, demand, branch } = this.flow(this.hour);
    const circuits = this.data.circuits.map((c): CircuitResult => {
      const d = demand.get(c.id)!;
      const b = this.breaker(c.id);
      const dead = !this.isLive(c.id);
      const loading = d.amps / c.breakerA;
      return {
        id: c.id, room: c.room, type: c.type, breakerA: c.breakerA,
        demandKw: d.kw, demandA: d.amps, kw: dead ? 0 : d.kw, amps: dead ? 0 : d.amps,
        loading, band: bandOf(loading), overloaded: !dead && loading > 1,
        heat: b.heat, tripped: b.tripped, dead,
      };
    });
    const loadKw = circuits.reduce((s, c) => s + c.kw, 0);
    const loadA = circuits.reduce((s, c) => s + c.amps, 0);
    const mainA = Math.abs(branch.get(MAIN_BOARD_ID) ?? 0);
    const ratingA = this.data.supply.mainBreakerA;
    const mb = this.breaker(MAIN_BOARD_ID);
    return {
      hour: this.hour, sun, circuits, loadKw, loadA, solarKw, gridKw: loadKw - solarKw,
      main: { amps: mainA, ratingA, loading: mainA / ratingA, band: bandOf(mainA / ratingA), heat: mb.heat, tripped: mb.tripped },
    };
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

  /** Demand per circuit and current through each node at this hour. */
  private flow(hour: number) {
    const V = this.network.voltage;
    const sun = sunAt(hour);
    // Solar only runs while the main DB is live (inverters switch off when the supply is lost).
    const solarKw = this.isLive(MAIN_BOARD_ID) ? pvOutput(this.data.solarKw, sun) : 0;
    const demand = new Map<string, { kw: number; amps: number }>();
    const injected = new Map<string, number>();
    for (const c of this.data.circuits) {
      const kw = c.kw * profileAt(c.type, hour);
      const amps = (kw * 1000) / (V * POWER_FACTOR[c.type]);
      demand.set(c.id, { kw, amps });
      if (this.isLive(c.id)) injected.set(c.id, amps);
    }
    injected.set(MAIN_BOARD_ID, -(solarKw * 1000) / V); // PV connects at the DB, power factor 1
    return { sun, solarKw, demand, branch: branchCurrents(this.network, injected) };
  }
}
