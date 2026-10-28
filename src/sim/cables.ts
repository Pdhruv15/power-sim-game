/**
 * Cable sizes the player can pick, with the current each one can carry safely (amps).
 * Simple rounded game values for copper cable in a wall; real values depend on how it is installed.
 */
export const CABLE_AMPS: Readonly<Record<number, number>> = { 1.5: 16, 2.5: 24, 4: 32, 6: 40, 10: 55 };
export const CABLE_SIZES: readonly number[] = Object.keys(CABLE_AMPS).map(Number).sort((a, b) => a - b);
export const DEFAULT_CABLE = 2.5;

export const cableAmps = (mm2: number): number => CABLE_AMPS[mm2] ?? 0;
