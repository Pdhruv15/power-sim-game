import type { LoadType } from './types';

/**
 * Hourly demand as a fraction of each circuit's connected kW (index = hour 0–23).
 * AC peaks mid-afternoon, lighting peaks in the evening, sockets peak at breakfast and dinner.
 */
export const PROFILES: Record<LoadType, readonly number[]> = {
  //        00  01  02  03  04  05  06  07  08  09  10  11  12  13  14  15  16  17  18  19  20  21  22  23
  ac:      [.45,.42,.40,.38,.38,.40,.45,.50,.55,.62,.70,.78,.86,.93,.98,1.0,.97,.90,.80,.72,.65,.58,.52,.48],
  lighting:[.10,.06,.05,.05,.05,.10,.30,.35,.15,.08,.05,.05,.05,.05,.05,.05,.08,.25,.70,.95,1.0,.90,.60,.25],
  sockets: [.15,.12,.10,.10,.10,.15,.45,.70,.50,.35,.35,.40,.55,.45,.35,.35,.45,.65,.85,.90,.80,.60,.40,.25],
};

/** Power factor per load type, used to turn kW into amps. */
export const POWER_FACTOR: Record<LoadType, number> = { ac: 0.9, lighting: 0.95, sockets: 0.95 };

/** Wrap any hour into 0 ≤ h < 24. */
export const wrapHour = (hour: number): number => ((hour % 24) + 24) % 24;

/** Demand fraction at any time of day, interpolated between hourly points. */
export function profileAt(type: LoadType, hour: number): number {
  const p = PROFILES[type];
  const h = wrapHour(hour), i = Math.floor(h), f = h - i;
  return p[i] * (1 - f) + p[(i + 1) % 24] * f;
}
