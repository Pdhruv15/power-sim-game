import type { Circuit, VillaData } from './types';

/**
 * Equipment kinds in the supply tree. The villa level uses grid → board → loads.
 * Village and city levels add transformers (and MV/HV sources) without changing this model.
 */
export type NodeKind = 'grid' | 'transformer' | 'board' | 'load';

export interface NetworkNode {
  id: string;
  kind: NodeKind;
  name: string;
  /** Upstream node, null for the supply source. */
  parent: string | null;
  /** Rating of the breaker feeding this node, if any. */
  breakerA?: number;
  circuit?: Circuit;
}

export interface Network {
  voltage: number;
  nodes: NetworkNode[];
}

export const GRID_ID = 'GRID';
export const MAIN_BOARD_ID = 'DB';

/** Villa supply tree: utility supply → main DB (main breaker) → one load per circuit. */
export function villaNetwork(v: VillaData): Network {
  return {
    voltage: v.supply.voltage,
    nodes: [
      { id: GRID_ID, kind: 'grid', name: 'Utility supply', parent: null },
      { id: MAIN_BOARD_ID, kind: 'board', name: 'Villa DB', parent: GRID_ID, breakerA: v.supply.mainBreakerA },
      ...v.circuits.map((c): NetworkNode => ({ id: c.id, kind: 'load', name: c.room, parent: MAIN_BOARD_ID, breakerA: c.breakerA, circuit: c })),
    ],
  };
}

/**
 * Current through each node = its own injected current plus everything downstream.
 * Positive = drawn from the supply; negative = generation (e.g. solar) feeding back.
 */
export function branchCurrents(net: Network, injected: ReadonlyMap<string, number>): Map<string, number> {
  const parentOf = new Map(net.nodes.map(n => [n.id, n.parent]));
  const total = new Map<string, number>(net.nodes.map(n => [n.id, 0]));
  for (const [id, amps] of injected) {
    for (let at: string | null | undefined = id; at; at = parentOf.get(at)) {
      total.set(at, (total.get(at) ?? 0) + amps);
    }
  }
  return total;
}
