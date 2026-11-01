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

/** Sideways reach of a wire leaving its part. */
const MIN_REACH = 40;
/** How far a wire swings clear of the parts in its row. */
const SWING = 90;
const EDGE = 4;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/**
 * Curve between two connection points that stays visible: a wire leaving a part on the far side,
 * or with a part in its way, swings clear rather than passing straight over them.
 */
export function wirePath(a: WireEnd, b: WireEnd, boardW: number, boardH: number, parts: readonly PartBox[] = []): string {
  const faceAway = a.dir * (b.x - a.x) < 0 || b.dir * (a.x - b.x) < 0;
  const [left, right] = [Math.min(a.x, b.x), Math.max(a.x, b.x)];
  const [high, low0] = [Math.min(a.y, b.y), Math.max(a.y, b.y)];
  const inTheWay = parts.some(p => p.right > left && p.left < right && p.top < low0 && p.bottom > high);
  const reach = Math.max(MIN_REACH, Math.abs(a.x - b.x) / 2);
  const c1x = clamp(a.x + a.dir * reach, EDGE, boardW - EDGE);
  const c2x = clamp(b.x + b.dir * reach, EDGE, boardW - EDGE);
  if (!faceAway && !inTheWay) return `M${a.x} ${a.y} C${c1x} ${a.y} ${c2x} ${b.y} ${b.x} ${b.y}`;

  // Swing below the row, or above it when there is no room below. Longer runs swing further, so wires in a row do not overlap.
  const swing = SWING + Math.abs(a.x - b.x) / 12;
  const low = Math.max(a.y, b.y) + swing * 1.34;
  const y = low < boardH - EDGE ? low : Math.min(a.y, b.y) - swing * 1.34;
  const cy = clamp(y, EDGE, boardH - EDGE);
  return `M${a.x} ${a.y} C${c1x} ${cy} ${c2x} ${cy} ${b.x} ${b.y}`;
}
