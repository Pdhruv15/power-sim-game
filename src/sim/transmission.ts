/**
 * Transmission: carrying a power station's output to a town over high-voltage lines.
 * Game rules, kept simple:
 * - Power travels as balanced three-phase current, I = S ÷ (√3 × V), so a higher voltage needs less current.
 * - Each line loses 3 × I² × R as heat, so losses fall with the square of the voltage.
 * - Lines side by side between the same two places share the current by how easily it flows through each.
 *   A line that is out carries nothing, and the others take its share.
 * - Voltage at the far end drops by about √3 × I × (R × pf + X × √(1 − pf²)).
 * The voltages and numbers are examples. Real ones vary by country and by line.
 */

/** Line voltages the game offers, phase to phase, in kV. */
export const LINE_KV: readonly number[] = [11, 33, 132];

/** Typical power factor of a town's load. */
export const TOWN_POWER_FACTOR = 0.95;

export type LineKind = 'overhead' | 'cable';

export interface Conductor {
  id: string;
  name: string;
  kind: LineKind;
  /** Resistance and reactance of one phase, in ohms per km. */
  ohmsPerKm: number;
  xOhmsPerKm: number;
  /** Current it can carry without overheating, in amps. */
  amps: number;
  /** Credits a day to pay for building 1 km of it. */
  costPerKm: number;
  /** What it teaches, in one short sentence. */
  note: string;
}

const conductor = (id: string, name: string, kind: LineKind, ohmsPerKm: number, xOhmsPerKm: number, amps: number, costPerKm: number, note: string): [string, Conductor] =>
  [id, { id, name, kind, ohmsPerKm, xOhmsPerKm, amps, costPerKm, note }];

/** Overhead lines are cheap but have more reactance; buried cable costs far more and storms cannot reach it. */
export const CONDUCTORS: Readonly<Record<string, Conductor>> = Object.fromEntries([
  conductor('light', 'Light line', 'overhead', 0.40, 0.40, 300, 20, 'Cheap and light, for short runs or small loads.'),
  conductor('medium', 'Medium line', 'overhead', 0.20, 0.38, 500, 35, 'The usual choice for a town.'),
  conductor('heavy', 'Heavy line', 'overhead', 0.10, 0.36, 800, 60, 'Thick wires: less loss, more current, more steel in the towers.'),
  conductor('cable', 'Buried cable', 'cable', 0.16, 0.12, 450, 120, 'Out of sight and out of the storm, at several times the price.'),
  conductor('cable-large', 'Large buried cable', 'cable', 0.08, 0.10, 700, 190, 'Big buried cable for a city centre.'),
]);
export const CONDUCTOR_IDS: readonly string[] = Object.keys(CONDUCTORS);

/** One line in a link. */
export interface Line {
  conductor: string;
  lengthKm: number;
  /** Tripped or switched off: it carries nothing. */
  out?: boolean;
}

/** Lines side by side between the same two places, all at one voltage. */
export interface Link {
  kv: number;
  lines: readonly Line[];
}

export interface LinkResult {
  /** Current in each line, in amps. A line that is out carries 0. */
  amps: number[];
  /** Each line's current as a share of what it can carry. */
  loading: number[];
  /** Power lost as heat in all the lines, in MW. */
  lossMw: number;
  /** Voltage lost along the link, as % of the line voltage. */
  dropPct: number;
  /** At least one line is in, so power gets through. */
  connected: boolean;
}

/** Current for a three-phase load, in amps: I = S ÷ (√3 × V). */
export function lineAmps(mw: number, kv: number, pf = TOWN_POWER_FACTOR): number {
  return mw > 0 && kv > 0 ? (mw / pf) * 1e6 / (Math.sqrt(3) * kv * 1e3) : 0;
}

/** Resistance and reactance of one line's phase, in ohms. */
const impedance = (line: Line) => {
  const c = CONDUCTORS[line.conductor];
  return { r: c.ohmsPerKm * line.lengthKm, x: c.xOhmsPerKm * line.lengthKm };
};

/** Carry mw at power factor pf over the link, and see how each line copes. */
export function solveLink(link: Link, mw: number, pf = TOWN_POWER_FACTOR): LinkResult {
  const zs = link.lines.map(impedance);
  // Each line in takes current in proportion to its admittance, 1 ÷ Z
  const admit = link.lines.map((l, i) => {
    if (l.out) return { g: 0, b: 0 };
    const { r, x } = zs[i];
    const d = r * r + x * x;
    return d > 0 ? { g: r / d, b: -x / d } : { g: Infinity, b: 0 };
  });
  const g = admit.reduce((s, a) => s + a.g, 0), b = admit.reduce((s, a) => s + a.b, 0);
  const connected = link.lines.some(l => !l.out);
  if (!connected) return { amps: link.lines.map(() => 0), loading: link.lines.map(() => 0), lossMw: 0, dropPct: 0, connected };

  const total = lineAmps(mw, link.kv, pf);
  const yAll = Math.hypot(g, b);
  const amps = admit.map(a => (Number.isFinite(yAll) && yAll > 0 ? (total * Math.hypot(a.g, a.b)) / yAll : total / link.lines.length));
  const loading = amps.map((a, i) => a / CONDUCTORS[link.lines[i].conductor].amps);
  const lossMw = amps.reduce((s, a, i) => s + 3 * a * a * zs[i].r, 0) / 1e6;

  // The lines in, taken together as one: Z = 1 ÷ (G + jB)
  const d = g * g + b * b;
  const rAll = d > 0 ? g / d : 0, xAll = d > 0 ? -b / d : 0;
  const sin = Math.sqrt(Math.max(0, 1 - pf * pf));
  const dropPct = ((Math.sqrt(3) * total * (rAll * pf + xAll * sin)) / (link.kv * 1e3)) * 100;
  return { amps, loading, lossMw, dropPct, connected };
}

/** Credits a day to build the link's lines. */
export const linkCost = (link: Link): number => link.lines.reduce((s, l) => s + CONDUCTORS[l.conductor].costPerKm * l.lengthKm, 0);

/** Transformer sizes for stepping voltage up at a station or down at a substation, in MVA. */
export const GRID_TRANSFORMER_MVA: readonly number[] = [10, 20, 40, 63, 100];

/** How loaded a grid transformer is: power through it ÷ its size. */
export const gridTransformerLoading = (mw: number, mva: number, pf = TOWN_POWER_FACTOR): number => (mva > 0 ? mw / pf / mva : Infinity);

/** Credits a day for a grid transformer. Bigger costs more, but less per MVA. */
export const gridTransformerCost = (mva: number): number => Math.round(40 + 6 * mva);
