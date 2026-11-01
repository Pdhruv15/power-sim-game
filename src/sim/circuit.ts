/**
 * Small circuit solver for parts the player wires up freely, in any shape, right or wrong.
 * Every part is a resistance between two points, and a source is a voltage behind its own resistance.
 * Currents come from one rule: at every point, what flows in must flow out.
 * Same plain numbers as the rest of the game: no phase angles, and mains is treated like steady voltage.
 */
export interface Resistor {
  id: string;
  a: string;
  b: string;
  ohms: number;
}

export interface Source {
  id: string;
  plus: string;
  minus: string;
  volts: number;
  ohms: number;
}

export interface CircuitSolution {
  /** Voltage at each point, against the first source's minus. */
  volts: Map<string, number>;
  /** Current through each resistor, from a to b. */
  amps: Map<string, number>;
  /** Current each source delivers. */
  sourceAmps: Map<string, number>;
}

/** Tiny leak to the reference, so a point connected to nothing still has a voltage. */
const LEAK_SIEMENS = 1e-9;

export function solveCircuit(resistors: readonly Resistor[], sources: readonly Source[]): CircuitSolution {
  const reference = sources[0]?.minus;
  const points = [...new Set([...resistors.flatMap(r => [r.a, r.b]), ...sources.flatMap(s => [s.plus, s.minus])])]
    .filter(p => p !== reference);
  const index = new Map(points.map((p, i) => [p, i]));
  const n = points.length;
  const G = points.map((_, i) => Array.from({ length: n + 1 }, (_, j) => (i === j ? LEAK_SIEMENS : 0)));

  const stamp = (a: string, b: string, siemens: number) => {
    const i = index.get(a), j = index.get(b);
    if (i !== undefined) G[i][i] += siemens;
    if (j !== undefined) G[j][j] += siemens;
    if (i !== undefined && j !== undefined) { G[i][j] -= siemens; G[j][i] -= siemens; }
  };
  for (const r of resistors) stamp(r.a, r.b, 1 / r.ohms);
  for (const s of sources) {
    stamp(s.plus, s.minus, 1 / s.ohms);
    const i = index.get(s.plus), j = index.get(s.minus);
    if (i !== undefined) G[i][n] += s.volts / s.ohms;
    if (j !== undefined) G[j][n] -= s.volts / s.ohms;
  }

  const x = solveLinear(G);
  const volts = new Map(points.map((p, i) => [p, x[i]]));
  if (reference !== undefined) volts.set(reference, 0);
  const at = (p: string) => volts.get(p) ?? 0;
  return {
    volts,
    amps: new Map(resistors.map(r => [r.id, (at(r.a) - at(r.b)) / r.ohms])),
    sourceAmps: new Map(sources.map(s => [s.id, (s.volts - (at(s.plus) - at(s.minus))) / s.ohms])),
  };
}

/** Gaussian elimination with partial pivoting on an augmented matrix. */
function solveLinear(m: number[][]): number[] {
  const n = m.length;
  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let r = col + 1; r < n; r++) if (Math.abs(m[r][col]) > Math.abs(m[pivot][col])) pivot = r;
    [m[col], m[pivot]] = [m[pivot], m[col]];
    for (let r = col + 1; r < n; r++) {
      const f = m[r][col] / m[col][col];
      if (f === 0) continue;
      for (let c = col; c <= n; c++) m[r][c] -= f * m[col][c];
    }
  }
  const x = new Array<number>(n).fill(0);
  for (let r = n - 1; r >= 0; r--) {
    let sum = m[r][n];
    for (let c = r + 1; c < n; c++) sum -= m[r][c] * x[c];
    x[r] = sum / m[r][r];
  }
  return x;
}

/** Sets of points joined with no real resistance between them, for spotting shorts and what a breaker cuts off. */
export function joinedPoints(links: readonly (readonly [string, string])[]): (a: string, b: string) => boolean {
  const parent = new Map<string, string>();
  const find = (p: string): string => {
    const up = parent.get(p);
    if (up === undefined || up === p) return p;
    const root = find(up);
    parent.set(p, root);
    return root;
  };
  for (const [a, b] of links) parent.set(find(a), find(b));
  return (a, b) => a === b || find(a) === find(b);
}
