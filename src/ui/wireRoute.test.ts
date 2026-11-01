import { describe, expect, it } from 'vitest';
import { draftPath, drawWires, hoppedPath, labelSpot, pathOf, routeWire, routeWires, type PartBox, type Point, type WireEnd } from './wireRoute';

const W = 860, H = 440;

/** A part 136 × 92 whose left side is at x, centred on y. */
const part = (x: number, y: number): PartBox => ({ left: x, right: x + 136, top: y - 46, bottom: y + 46 });
const runs = (points: readonly Point[]) => points.slice(1).map((p, i) => [points[i], p] as const);
const hiddenBy = (points: readonly Point[], p: PartBox) =>
  runs(points).filter(([s, t]) => Math.min(s.x, t.x) < p.right && Math.max(s.x, t.x) > p.left && Math.min(s.y, t.y) < p.bottom && Math.max(s.y, t.y) > p.top).length;
const allSquare = (points: readonly Point[]) => runs(points).every(([s, t]) => s.x === t.x || s.y === t.y);
const sideways = (points: readonly Point[]) => runs(points).filter(([s, t]) => s.y === t.y && s.x !== t.x);

// Battery, switch and lamp in a row, as the board places them
const Y = 86;
const battery = part(30, Y), sw = part(362, Y), lamp = part(694, Y);
const row = [battery, sw, lamp];
const end = (x: number, dir: -1 | 1): WireEnd => ({ x, y: Y, dir });

describe('routeWire', () => {
  it('runs straight between facing ends with nothing between them', () => {
    expect(routeWire(end(battery.right, 1), end(sw.left, -1), W, H, row)).toMatchObject([{ x: battery.right, y: Y }, { x: sw.left, y: Y }]);
  });

  it('only ever bends at right angles', () => {
    const cases: [WireEnd, WireEnd][] = [
      [end(battery.right, 1), { x: sw.left, y: 300, dir: -1 }],
      [end(battery.left, -1), end(sw.left, -1)],
      [end(lamp.right, 1), end(battery.right, 1)],
      [{ x: 400, y: 300, dir: 1 }, { x: 100, y: 40, dir: -1 }],
    ];
    for (const [a, b] of cases) expect(allSquare(routeWire(a, b, W, H, row))).toBe(true);
  });

  it('goes around a part sitting between facing ends', () => {
    expect(hiddenBy(routeWire(end(battery.right, 1), end(lamp.left, -1), W, H, row), sw)).toBe(0);
  });

  it('leaves a part on the far side without crossing it', () => {
    const points = routeWire(end(battery.left, -1), end(sw.left, -1), W, H, row);
    expect(hiddenBy(points, battery)).toBe(0);
    expect(hiddenBy(points, sw)).toBe(0);
  });

  it('comes back along a row without crossing any part', () => {
    const points = routeWire(end(lamp.right, 1), end(battery.right, 1), W, H, row);
    for (const p of row) expect(hiddenBy(points, p)).toBe(0);
  });

  it('threads the gap between two rows of rooms', () => {
    const room = (x: number, y: number): PartBox => ({ left: x, right: x + 168, top: y, bottom: y + 100 });
    const rooms = [room(472, 12), room(672, 12), room(472, 124), room(672, 124)];
    const points = routeWire({ x: 420, y: 62, dir: 1 }, { x: 672, y: 174, dir: -1 }, W, 300, rooms);
    for (const r of rooms) expect(hiddenBy(points, r)).toBe(0);
  });

  it('does not run over the connection point of a part it is not wired to', () => {
    // The straight line from the battery to the lamp's far row would pass the switch's own circle
    const points = routeWire({ x: 200, y: 300, dir: 1 }, { x: 700, y: Y, dir: -1 }, W, H, [part(362, 300)]);
    expect(runs(points).some(([s, t]) => s.y === t.y && s.y === 300 && Math.max(s.x, t.x) > 350)).toBe(false);
  });

  it('keeps every wire on the board', () => {
    for (const y of [40, 220, 400]) {
      for (const p of routeWire({ x: 30, y, dir: -1 }, { x: 830, y, dir: 1 }, W, H)) {
        expect(p.x).toBeGreaterThanOrEqual(0);
        expect(p.x).toBeLessThanOrEqual(W);
        expect(p.y).toBeGreaterThanOrEqual(0);
        expect(p.y).toBeLessThanOrEqual(H);
      }
    }
  });
});

describe('routeWires', () => {
  const job = (id: string, from: string, to: string, y1: number, y2: number) => ({
    id, from, to, a: { x: 200, y: y1, dir: 1 as const }, b: { x: 600, y: y2, dir: -1 as const },
  });
  const uprights = (points: readonly Point[]) => runs(points).filter(([s, t]) => s.x === t.x).map(([s]) => s.x);

  it('keeps wires that are not joined from lying on top of each other', () => {
    const routes = routeWires([job('w1', 'a', 'b', 100, 300), job('w2', 'c', 'd', 120, 320)], W, H, []);
    const [x1] = uprights(routes.get('w1')!), [x2] = uprights(routes.get('w2')!);
    expect(Math.abs(x1 - x2)).toBeGreaterThanOrEqual(4);
  });

  it('lets wires from the same connection point share a trunk', () => {
    const routes = routeWires([job('w1', 'a', 'b', 100, 300), job('w2', 'a', 'd', 100, 200)], W, H, []);
    expect(uprights(routes.get('w1')!)[0]).toBe(uprights(routes.get('w2')!)[0]);
  });
});

describe('drawing a route', () => {
  it('writes a path of straight lines', () => {
    expect(pathOf([{ x: 1, y: 2 }, { x: 5, y: 2 }, { x: 5, y: 9 }])).toBe('M1 2 L5 2 L5 9');
  });

  it('labels a wire on its longest run', () => {
    const points = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 100 }, { x: 20, y: 100 }];
    expect(labelSpot(points)).toEqual({ x: 10, y: 50 });
    expect(sideways(points)).toHaveLength(2);
  });

  it('draws the wire being dragged with right angles too', () => {
    expect(draftPath({ x1: 0, y1: 0, x2: 100, y2: 40 })).toBe('M0 0 H50 V40 H100');
  });
});

describe('jumpers and joints', () => {
  const across = [{ x: 0, y: 50 }, { x: 100, y: 50 }];
  const upright = [[{ x: 50, y: 0 }, { x: 50, y: 100 }]] as const;

  it('hops over a crossing wire', () => {
    expect(hoppedPath(across, upright)).toBe('M0 50 L44 50 A6 6 0 0 1 56 50 L100 50');
  });

  it('hops upward whichever way the wire runs', () => {
    expect(hoppedPath([...across].reverse(), upright)).toBe('M100 50 L56 50 A6 6 0 0 0 44 50 L0 50');
  });

  it('does not hop over a wire that stops short of it', () => {
    expect(hoppedPath(across, [[{ x: 50, y: 0 }, { x: 50, y: 40 }]])).toBe('M0 50 L100 50');
  });

  const job = (id: string, from: string, to: string, ax: number, ay: number, bx: number, by: number) => ({
    id, from, to, a: { x: ax, y: ay, dir: 1 as const }, b: { x: bx, y: by, dir: -1 as const },
  });

  it('draws a hop, and no dot, where unrelated wires cross', () => {
    const jobs = [job('w1', 'a', 'b', 0, 50, 100, 50), job('w2', 'c', 'd', 50, 0, 50, 100)];
    const routes = new Map<string, Point[]>([['w1', [{ x: 0, y: 50 }, { x: 100, y: 50 }]], ['w2', [{ x: 50, y: 0 }, { x: 50, y: 100 }]]]);
    const { paths, dots } = drawWires(jobs, routes);
    expect(paths.get('w1')).toContain('A6 6');
    expect(paths.get('w2')).not.toContain('A6 6');
    expect(dots).toEqual([]);
  });

  it('draws a dot, and no hop, where joined wires split', () => {
    const jobs = [job('w1', 'a', 'b', 0, 50, 100, 50), job('w2', 'a', 'c', 0, 50, 50, 100)];
    const routes = new Map<string, Point[]>([['w1', [{ x: 0, y: 50 }, { x: 100, y: 50 }]], ['w2', [{ x: 0, y: 50 }, { x: 50, y: 50 }, { x: 50, y: 100 }]]]);
    const { paths, dots } = drawWires(jobs, routes);
    expect(dots).toEqual([{ x: 50, y: 50 }]);
    expect(paths.get('w1')).not.toContain('A6 6');
  });
});

describe('ends on the top or bottom of a part', () => {
  it('runs straight between two facing ends', () => {
    const points = routeWire({ x: 50, y: 10, dir: 1, vert: true }, { x: 50, y: 40, dir: -1, vert: true }, W, H);
    expect(points).toHaveLength(2);
  });

  it('drops straight out of the part before turning', () => {
    const points = routeWire({ x: 380, y: 200, dir: 1, vert: true }, { x: 640, y: 260, dir: -1 }, W, H);
    expect(points[1].x).toBe(380);
    expect(points[1].y).toBeGreaterThan(200);
    expect(allSquare(points)).toBe(true);
  });
});
