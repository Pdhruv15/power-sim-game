/**
 * Cable sizes the player can pick, with the current each one can carry safely (amps).
 * Simple rounded game values for copper cable; real values depend on how it is installed.
 */
export const CABLE_AMPS: Readonly<Record<number, number>> = {
  1.5: 16, 2.5: 24, 4: 32, 6: 40, 10: 55, 16: 70, 25: 90, 35: 110, 50: 135,
};
export const CABLE_SIZES: readonly number[] = Object.keys(CABLE_AMPS).map(Number).sort((a, b) => a - b);
export const DEFAULT_CABLE = 2.5;

export const cableAmps = (mm2: number): number => CABLE_AMPS[mm2] ?? 0;

/** Resistivity of warm copper, ohm·mm²/m. One conductor's resistance = ρ × length ÷ size. */
const COPPER_RHO = 0.0225;

/**
 * Voltage lost along a cable, in volts (phase to neutral).
 * Single-phase: current goes out and back, so both conductors count.
 * Three-phase: the phases share the return, so one conductor counts (balanced load).
 */
export function cableDropV(amps: number, mm2: number, lengthM: number, phases: 1 | 3): number {
  if (mm2 <= 0 || lengthM <= 0) return 0;
  return ((phases === 1 ? 2 : 1) * amps * COPPER_RHO * lengthM) / mm2;
}

/** Resistance of a phase and neutral pair, out and back, in ohms. Used for short-circuit current. */
export function loopOhms(mm2: number, lengthM: number): number {
  return mm2 > 0 && lengthM > 0 ? (2 * COPPER_RHO * lengthM) / mm2 : 0;
}
