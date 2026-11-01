import { describe, expect, it } from 'vitest';
import { wirePath, type WireEnd } from './wireRoute';

const W = 860, H = 440;

/** Points along the curve. */
function sample(d: string): { x: number; y: number }[] {
  const n = d.match(/-?[\d.]+/g)!.map(Number);
  const [x0, y0, x1, y1, x2, y2, x3, y3] = n;
  return Array.from({ length: 41 }, (_, i) => {
    const t = i / 40, u = 1 - t;
    return {
      x: u ** 3 * x0 + 3 * u * u * t * x1 + 3 * u * t * t * x2 + t ** 3 * x3,
      y: u ** 3 * y0 + 3 * u * u * t * y1 + 3 * u * t * t * y2 + t ** 3 * y3,
    };
  });
}
/** A part 136 × 76 whose left side is at x, centred on y. */
const part = (x: number, y: number) => ({ left: x, right: x + 136, top: y - 38, bottom: y + 38 });
const hiddenBy = (d: string, p: ReturnType<typeof part>) =>
  sample(d).filter(q => q.x > p.left && q.x < p.right && q.y > p.top && q.y < p.bottom).length;

// Battery, switch and lamp in a row, as the board places them
const Y = 78;
const battery = part(30, Y), sw = part(362, Y), lamp = part(694, Y);
const row = [battery, sw, lamp];
const end = (x: number, dir: -1 | 1): WireEnd => ({ x, y: Y, dir });

describe('wirePath', () => {
  it('runs straight between facing ends with nothing between them', () => {
    const d = wirePath(end(battery.right, 1), end(sw.left, -1), W, H, row);
    expect(sample(d).every(q => Math.abs(q.y - Y) < 1e-6)).toBe(true);
  });

  it('goes around a part sitting between facing ends', () => {
    const d = wirePath(end(battery.right, 1), end(lamp.left, -1), W, H, row);
    expect(hiddenBy(d, sw)).toBe(0);
  });

  it('swings clear of its own part when leaving the far side', () => {
    const d = wirePath(end(battery.left, -1), end(sw.left, -1), W, H, row);
    expect(hiddenBy(d, battery)).toBeLessThan(6);
    expect(Math.max(...sample(d).map(q => q.y))).toBeGreaterThan(battery.bottom + 10);
  });

  it('swings around the parts in a row on the long way back', () => {
    const d = wirePath(end(lamp.right, 1), end(battery.right, 1), W, H, row);
    expect(hiddenBy(d, sw)).toBe(0);
    expect(hiddenBy(d, lamp)).toBeLessThan(6);
  });

  it('keeps every part of a wire on the board', () => {
    for (const y of [40, 220, 400]) {
      const d = wirePath({ x: 30, y, dir: -1 }, { x: 830, y, dir: 1 }, W, H);
      for (const q of sample(d)) {
        expect(q.x).toBeGreaterThanOrEqual(0);
        expect(q.x).toBeLessThanOrEqual(W);
        expect(q.y).toBeGreaterThanOrEqual(0);
        expect(q.y).toBeLessThanOrEqual(H);
      }
    }
  });

  it('swings up instead when the row is at the bottom of the board', () => {
    const d = wirePath({ x: 30, y: 400, dir: -1 }, { x: 362, y: 400, dir: -1 }, W, H);
    expect(Math.min(...sample(d).map(q => q.y))).toBeLessThan(362);
  });
});
