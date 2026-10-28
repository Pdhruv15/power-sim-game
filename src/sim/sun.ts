/** Simple sun arc: rises east at 06:00, due south at noon, sets west at 18:00 (northern hemisphere). */
export const SUNRISE = 6;
export const SUNSET = 18;
export const MAX_ELEVATION = (55 * Math.PI) / 180;
/** Losses from heat, dust, wiring and inverter. */
export const PV_DERATE = 0.85;

export interface Sun {
  /** Radians above the horizon. Negative at night, which keeps sky blending smooth. */
  elevation: number;
  /** Compass bearing in radians, 0 = north, π/2 = east. */
  azimuth: number;
  /** sin(elevation) relative to noon: 1 at noon, 0 at sunrise/sunset, below 0 at night. */
  height: number;
}

export function sunAt(hour: number): Sun {
  const t = (hour - SUNRISE) / (SUNSET - SUNRISE);
  const elevation = Math.sin(Math.PI * t) * MAX_ELEVATION;
  const azimuth = ((90 + 180 * t) * Math.PI) / 180;
  return { elevation, azimuth, height: Math.sin(elevation) / Math.sin(MAX_ELEVATION) };
}

/** PV output in kW for the installed kWp at this sun position. */
export function pvOutput(kwp: number, sun: Sun): number {
  return kwp * PV_DERATE * Math.max(0, sun.height);
}
