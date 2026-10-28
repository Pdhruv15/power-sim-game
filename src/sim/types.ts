/** Load types. Each has its own daily demand profile. */
export type LoadType = 'lighting' | 'sockets' | 'ac';

export const LOAD_TYPES: readonly LoadType[] = ['lighting', 'sockets', 'ac'];

/** Supply phases. A single-phase board uses L1 only. */
export type Phase = 'L1' | 'L2' | 'L3';

export const PHASES: readonly Phase[] = ['L1', 'L2', 'L3'];

/** A cable run: size and length. */
export interface Cable {
  mm2: number;
  lengthM: number;
}

/**
 * A distribution board. The board with no parent is fed from the grid, and its breaker is the main breaker.
 * Village and city levels will add transformers above this.
 */
export interface Board {
  id: string;
  name: string;
  parent: string | null;
  /** Breaker feeding this board, in amps. */
  breakerA: number;
  phases: 1 | 3;
  /** Feeder cable from the parent board. Null for the top board. */
  cable: Cable | null;
  /** Solar PV connected at this board, in kWp. */
  solarKw: number;
  /** Phase a single-phase board is connected to on a three-phase parent. */
  phase: Phase;
  /** Storey for drawing (0 = ground). Boards without a floor stand outside. */
  floor?: number;
}

/** A short circuit at the end of a room's cable, at a set time of day. */
export interface FaultEvent {
  hour: number;
  circuit: string;
  /** What happened, in plain words, e.g. "A kettle lead shorts". */
  text: string;
}

/** One final circuit. Each circuit serves one room. */
export interface Circuit {
  id: string;
  board: string;
  room: string;
  type: LoadType;
  /** Connected load in kW (demand at 100 % of its profile). */
  kw: number;
  /** Breaker rating in amps. */
  breakerA: number;
  /** Cable size in mm² (see CABLE_AMPS). */
  cableMm2: number;
  /** Cable length from the board to the room. 0 = not modelled (no voltage drop). */
  lengthM: number;
  /** Phase the circuit is connected to. Always L1 on a single-phase board. */
  phase: Phase;
}

/** A level: the supply tree, the rooms, and the scoring setup. */
export interface Level {
  id: string;
  title: string;
  project: string;
  /** Short brief shown to the player at the start of the level. */
  intro?: string;
  /** Degrees the plan is rotated clockwise from north. */
  orientation: number;
  /** Phase voltage. Three-phase boards have this between each phase and neutral. */
  voltage: number;
  boards: Board[];
  circuits: Circuit[];
  /** Spending limit for the design, in credits. */
  budget?: number;
  /** Points available per score part. Parts left out are not scored. */
  points?: Record<string, number>;
  /** Resistance of the supply itself (transformer and street cable), in ohms. Limits short-circuit current. */
  sourceOhms: number;
  faults: FaultEvent[];
}

/** The board fed from the grid. parseLevel guarantees there is exactly one. */
export const topBoard = (level: Level): Board => level.boards.find(b => b.parent === null)!;

export const totalSolarKw = (level: Level): number => level.boards.reduce((s, b) => s + b.solarKw, 0);

/** Phase a circuit really uses: its own on a three-phase board, otherwise the single-phase board's phase. */
export function phaseIndex(level: Level, c: Circuit): 0 | 1 | 2 {
  const board = level.boards.find(b => b.id === c.board);
  return PHASES.indexOf(board?.phases === 3 ? c.phase : (board?.phase ?? 'L1')) as 0 | 1 | 2;
}
