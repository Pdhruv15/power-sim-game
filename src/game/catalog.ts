import type { VillaData } from '../sim';

/** Equipment the player can pick in the design step, and its price in credits. */
export const BREAKER_SIZES: readonly number[] = [6, 10, 16, 20, 25, 32, 40];
export const MAIN_BREAKER_SIZES: readonly number[] = [40, 63, 80, 100];
export const SOLAR_OPTIONS: readonly number[] = [0, 3, 5, 8];

const CABLE_PRICE: Readonly<Record<number, number>> = { 1.5: 20, 2.5: 30, 4: 45, 6: 65, 10: 100 };
const MAIN_PRICE: Readonly<Record<number, number>> = { 40: 60, 63: 80, 80: 110, 100: 150 };
const SOLAR_PRICE_PER_KWP = 120;

export const breakerPrice = (amps: number): number => (amps <= 20 ? 15 : amps <= 32 ? 20 : 30);
export const cablePrice = (mm2: number): number => CABLE_PRICE[mm2] ?? Math.round(mm2 * 10);
export const mainBreakerPrice = (amps: number): number => MAIN_PRICE[amps] ?? Math.round(amps * 1.5);

/** Total price of a design: breakers, cables, main breaker and solar. */
export function designCost(d: VillaData): number {
  const circuits = d.circuits.reduce((s, c) => s + breakerPrice(c.breakerA) + cablePrice(c.cableMm2), 0);
  return circuits + mainBreakerPrice(d.supply.mainBreakerA) + d.solarKw * SOLAR_PRICE_PER_KWP;
}
