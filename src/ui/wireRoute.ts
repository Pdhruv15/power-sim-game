/** One end of a wire: where it is, and which way it leaves its part (-1 left, 1 right). */
export interface WireEnd {
  x: number;
  y: number;
  dir: -1 | 1;
}

/** A part's box on the board. */
export interface PartBox {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

export interface Point {
  x: number;
  y: number;
}

/** A wire to route. `from` and `to` name its connection points, so wires that are joined anyway may share a run. */
export interface WireJob {
  id: string;
  from: string;
  to: string;
  a: WireEnd;
  b: WireEnd;
}

/** How far a wire runs straight out of its connection point before it may turn. */
const STUB = 20;
/** Room a connection point takes up around its centre. */
const TERM_R = 12;
const EDGE = 8;
/** Runs that sit in the same gap are kept apart by this much. */
const LANE = 8;
/** Distances from a part where a wire may run past it. */
const PAST_PART = [20, 32];
/** The same, for the narrow gaps between rows of rooms. */
const TIGHT_PAST_PART = [3, 6, 9];
const PAST_SIDE = [20, 32];

// What a route pays for. Going through a part is worst, then sitting on top of an unrelated wire.
const HIT_COST = 100000;
const OVERLAP_COST = 4000;
const CROSS_COST = 40;
const HUG_COST = 200;
const BEND_COST = 30;
const LENGTH_COST = 0.2;

type Segment = readonly [Point, Point];

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const unique = (values: number[]) => [...new Set(values)];

/** Drops repeated points and points in the middle of a straight run. */
function tidy(points: readonly Point[]): Point[] {
  const out: Point[] = [];
  for (const p of points) {
    const last = out[out.length - 1];
    if (last && last.x === p.x && last.y === p.y) continue;
    const before = out[out.length - 2];
    if (before && last && ((before.x === last.x && last.x === p.x) || (before.y === last.y && last.y === p.y))) out.pop();
    out.push(p);
  }
  return out;
}

const segments = (points: readonly Point[]): Segment[] => points.slice(1).map((p, i) => [points[i], p]);

const hits = ([p, q]: Segment, box: PartBox) =>
  Math.min(p.x, q.x) < box.right && Math.max(p.x, q.x) > box.left && Math.min(p.y, q.y) < box.bottom && Math.max(p.y, q.y) > box.top;

const vertical = ([p, q]: Segment) => p.x === q.x;

/** Two runs lying along each other, close enough to read as one wire. */
function overlaps(s: Segment, t: Segment): boolean {
  if (vertical(s) !== vertical(t)) return false;
  const [across, along] = vertical(s) ? (['x', 'y'] as const) : (['y', 'x'] as const);
  if (Math.abs(s[0][across] - t[0][across]) >= LANE / 2) return false;
  return Math.min(s[0][along], s[1][along]) < Math.max(t[0][along], t[1][along])
    && Math.max(s[0][along], s[1][along]) > Math.min(t[0][along], t[1][along]);
}

function crosses(s: Segment, t: Segment): boolean {
  if (vertical(s) === vertical(t)) return false;
  const [up, flat] = vertical(s) ? [s, t] : [t, s];
  return up[0].x > Math.min(flat[0].x, flat[1].x) && up[0].x < Math.max(flat[0].x, flat[1].x)
    && flat[0].y > Math.min(up[0].y, up[1].y) && flat[0].y < Math.max(up[0].y, up[1].y);
}

/** Right-angle route between two connection points: around the parts, and off wires it is not joined to. */
export function routeWire(a: WireEnd, b: WireEnd, boardW: number, boardH: number, parts: readonly PartBox[] = [], others: readonly Segment[] = []): Point[] {
  const inX = (x: number) => clamp(x, EDGE, boardW - EDGE);
  const ax = inX(a.x + a.dir * STUB), bx = inX(b.x + b.dir * STUB);

  // Another part's connection point counts as part of it, so no wire seems to land on the wrong one
  const blocks = [...parts, ...parts.flatMap(p => [p.left, p.right].map(x => {
    const y = (p.top + p.bottom) / 2;
    return { left: x - TERM_R, right: x + TERM_R, top: y - TERM_R, bottom: y + TERM_R };
  }))].filter(box => ![a, b].some(e => e.x > box.left && e.x < box.right && e.y > box.top && e.y < box.bottom && box.bottom - box.top === TERM_R * 2));

  const columns = unique([ax, bx, (a.x + b.x) / 2, EDGE, boardW - EDGE, ...parts.flatMap(p => PAST_SIDE.flatMap(d => [p.left - d, p.right + d]))]);
  const near = (d: number) => parts.flatMap(p => [p.top - d, p.bottom + d]);
  // Rows hugging a part are for narrow gaps only
  const tight = new Set(TIGHT_PAST_PART.flatMap(near));
  const rows = unique([(a.y + b.y) / 2, EDGE, boardH - EDGE, ...PAST_PART.flatMap(near), ...tight])
    .filter(y => y >= EDGE && y <= boardH - EDGE);

  const routes: Point[][] = [];
  // One upright run, for ends that face each other
  for (const x of columns) {
    if (a.dir * (x - a.x) > 0 && b.dir * (x - b.x) > 0) routes.push([a, { x, y: a.y }, { x, y: b.y }, b]);
  }
  // Out of each end, then along a gap
  for (const x1 of unique([ax, inX(ax + a.dir * LANE), inX(ax + a.dir * LANE * 2)])) {
    for (const x2 of unique([bx, inX(bx - b.dir * LANE)])) {
      if (a.dir * (x1 - a.x) <= 0 || b.dir * (x2 - b.x) <= 0) continue;
      for (const y of rows) routes.push([a, { x: x1, y: a.y }, { x: x1, y }, { x: x2, y }, { x: x2, y: b.y }, b]);
    }
  }

  let best: Point[] = tidy([a, { x: ax, y: a.y }, { x: ax, y: b.y }, b]);
  let bestCost = Infinity;
  for (const route of routes) {
    const points = tidy(route);
    const segs = segments(points);
    let cost = (points.length - 2) * BEND_COST;
    for (const s of segs) {
      if (s[0].y === s[1].y && tight.has(s[0].y)) cost += HUG_COST;
      cost += (Math.abs(s[0].x - s[1].x) + Math.abs(s[0].y - s[1].y)) * LENGTH_COST;
      for (const box of blocks) if (hits(s, box)) cost += HIT_COST;
      for (const t of others) {
        if (overlaps(s, t)) cost += OVERLAP_COST;
        else if (crosses(s, t)) cost += CROSS_COST;
      }
    }
    if (cost < bestCost) { best = points; bestCost = cost; }
  }
  return best;
}

/** Routes every wire on a board. Wires joined to each other may share a run, like a real trunk; others stay apart. */
export function routeWires(jobs: readonly WireJob[], boardW: number, boardH: number, parts: readonly PartBox[]): Map<string, Point[]> {
  const group = new Map<string, string>();
  const groupOf = (t: string): string => {
    const g = group.get(t) ?? t;
    return g === t ? t : groupOf(g);
  };
  for (const j of jobs) group.set(groupOf(j.from), groupOf(j.to));

  const out = new Map<string, Point[]>();
  const done: { group: string; segs: Segment[] }[] = [];
  for (const j of jobs) {
    const g = groupOf(j.from);
    const points = routeWire(j.a, j.b, boardW, boardH, parts, done.filter(d => d.group !== g).flatMap(d => d.segs));
    out.set(j.id, points);
    done.push({ group: g, segs: segments(points) });
  }
  return out;
}

export const pathOf = (points: readonly Point[]) => points.map((p, i) => `${i ? 'L' : 'M'}${p.x} ${p.y}`).join(' ');

/** Where to write on a wire: the middle of its longest run. */
export function labelSpot(points: readonly Point[]): Point {
  const longest = segments(points).reduce((m, s) => (Math.abs(s[0].x - s[1].x) + Math.abs(s[0].y - s[1].y) > Math.abs(m[0].x - m[1].x) + Math.abs(m[0].y - m[1].y) ? s : m));
  return { x: (longest[0].x + longest[1].x) / 2, y: (longest[0].y + longest[1].y) / 2 };
}

/** The wire being dragged, in the same right angles it will end up with. */
export function draftPath({ x1, y1, x2, y2 }: { x1: number; y1: number; x2: number; y2: number }): string {
  const mid = (x1 + x2) / 2;
  return `M${x1} ${y1} H${mid} V${y2} H${x2}`;
}
