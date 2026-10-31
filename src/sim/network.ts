import { transformerRatedAmps } from './transformer';
import { phaseIndex, type Level } from './types';

/**
 * Equipment kinds in the supply tree: grid → transformer → boards → loads.
 * City levels can add more transformers (and MV/HV sources) without changing this model.
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
}

export interface Network {
  voltage: number;
  nodes: NetworkNode[];
}

/** Current on each of the three phases, in amps. */
export type PhaseAmps = [number, number, number];

export const GRID_ID = 'GRID';
export const TRANSFORMER_ID = 'TX';

/** Supply tree for a level: grid → transformer (if any) → top board → sub-boards → one load per circuit. */
export function levelNetwork(level: Level): Network {
  const tx = level.transformer;
  return {
    voltage: level.voltage,
    nodes: [
      { id: GRID_ID, kind: 'grid', name: 'Utility supply', parent: null },
      ...(tx ? [{ id: TRANSFORMER_ID, kind: 'transformer', name: tx.name, parent: GRID_ID, breakerA: transformerRatedAmps(tx.kva, level.voltage) } satisfies NetworkNode] : []),
      ...level.boards.map((b): NetworkNode => ({ id: b.id, kind: 'board', name: b.name, parent: b.parent ?? (tx ? TRANSFORMER_ID : GRID_ID), breakerA: b.breakerA })),
      ...level.circuits.map((c): NetworkNode => ({ id: c.id, kind: 'load', name: c.room, parent: c.board, breakerA: c.breakerA })),
    ],
  };
}

/**
 * Current through each node, per phase = its own injected current plus everything downstream.
 * Positive = drawn from the supply; negative = generation (e.g. solar) feeding back.
 * Phase currents are added as plain numbers: a simple model that ignores phase angles.
 */
export function branchCurrents(net: Network, injected: ReadonlyMap<string, PhaseAmps>): Map<string, PhaseAmps> {
  const parentOf = new Map(net.nodes.map(n => [n.id, n.parent]));
  const total = new Map<string, PhaseAmps>(net.nodes.map(n => [n.id, [0, 0, 0]]));
  for (const [id, amps] of injected) {
    for (let at: string | null | undefined = id; at; at = parentOf.get(at)) {
      const t = total.get(at)!;
      for (let p = 0; p < 3; p++) t[p] += amps[p];
    }
  }
  return total;
}

/** A circuit's current placed on its phase. */
export function onPhase(level: Level, circuitId: string, amps: number): PhaseAmps {
  const c = level.circuits.find(x => x.id === circuitId)!;
  const out: PhaseAmps = [0, 0, 0];
  out[phaseIndex(level, c)] = amps;
  return out;
}

/** Highest phase current, by size (export also loads a breaker). */
export const maxPhase = (a: PhaseAmps): number => Math.max(Math.abs(a[0]), Math.abs(a[1]), Math.abs(a[2]));
