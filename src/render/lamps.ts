/** Daylight (0 = night, 1 = full sun) below which people switch the lights on. */
export const LIGHTS_ON_BELOW = 0.35;

/**
 * How bright a room's lights are, from 0 (off) to 1. They come on as the light fades, in rooms
 * that have power and something running. A tripped or dead room stays dark.
 */
export function roomGlow(dead: boolean, demandKw: number, daylight: number): number {
  if (dead || demandKw <= 0 || daylight >= LIGHTS_ON_BELOW) return 0;
  return Math.min(1, (LIGHTS_ON_BELOW - daylight) / LIGHTS_ON_BELOW + 0.4);
}
