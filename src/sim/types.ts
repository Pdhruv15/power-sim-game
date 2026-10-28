/** Load types. Each has its own daily demand profile. */
export type LoadType = 'lighting' | 'sockets' | 'ac';

export const LOAD_TYPES: readonly LoadType[] = ['lighting', 'sockets', 'ac'];

/** One final circuit. In the villa level each circuit serves one room. */
export interface Circuit {
  id: string;
  room: string;
  type: LoadType;
  /** Connected load in kW (demand at 100 % of its profile). */
  kw: number;
  /** Breaker rating in amps. */
  breakerA: number;
}

/** Contents of a villa level file (public/data/villa.json). */
export interface VillaData {
  project: string;
  /** Degrees the plan is rotated clockwise from north. */
  orientation: number;
  /** Single-phase supply for the villa level. */
  supply: { voltage: number; mainBreakerA: number };
  /** Installed solar PV in kWp. 0 means no panels. */
  solarKw: number;
  circuits: Circuit[];
}
