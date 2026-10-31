import type { Level } from '../sim';

/** Equipment the player can pick in the design step, and its price in credits. */
export const BREAKER_SIZES: readonly number[] = [6, 10, 16, 20, 25, 32, 40];
/** Breakers feeding a board: the main breaker and sub-board feeders. */
export const BOARD_BREAKER_SIZES: readonly number[] = [32, 40, 50, 63, 80, 100, 125, 160];
export const SOLAR_OPTIONS: readonly number[] = [0, 3, 5, 8];
/** Transformer sizes in kVA, and their price. */
const TRANSFORMER_PRICE: Readonly<Record<number, number>> = { 50: 900, 63: 1050, 80: 1250, 100: 1500, 125: 1800, 160: 2200 };
export const TRANSFORMER_SIZES: readonly number[] = Object.keys(TRANSFORMER_PRICE).map(Number).sort((a, b) => a - b);

/** Price per metre of cable. */
const CABLE_PRICE_PER_M: Readonly<Record<number, number>> = {
  1.5: 2, 2.5: 3, 4: 4.5, 6: 6.5, 10: 10, 16: 15, 25: 22, 35: 30, 50: 40,
};
/** Room cables with no length in the level file are priced as 10 m runs. */
const DEFAULT_PRICED_LENGTH_M = 10;
const BOARD_BREAKER_PRICE: Readonly<Record<number, number>> = {
  32: 50, 40: 60, 50: 70, 63: 80, 80: 110, 100: 150, 125: 190, 160: 240,
};
const SOLAR_PRICE_PER_KWP = 120;

export const breakerPrice = (amps: number): number => (amps <= 20 ? 15 : amps <= 32 ? 20 : 30);
export const boardBreakerPrice = (amps: number): number => BOARD_BREAKER_PRICE[amps] ?? Math.round(amps * 1.5);
export const cablePrice = (mm2: number, lengthM: number): number =>
  Math.round((CABLE_PRICE_PER_M[mm2] ?? mm2) * (lengthM > 0 ? lengthM : DEFAULT_PRICED_LENGTH_M));
export const transformerPrice = (kva: number): number => TRANSFORMER_PRICE[kva] ?? Math.round(kva * 14);

/** Total price of a design: transformer, room breakers and cables, board breakers and feeder cables, solar. */
export function designCost(level: Level): number {
  const rooms = level.circuits.reduce((s, c) => s + breakerPrice(c.breakerA) + cablePrice(c.cableMm2, c.lengthM), 0);
  const boards = level.boards.reduce((s, b) =>
    s + boardBreakerPrice(b.breakerA) + (b.cable ? cablePrice(b.cable.mm2, b.cable.lengthM) : 0) + b.solarKw * SOLAR_PRICE_PER_KWP, 0);
  return rooms + boards + (level.transformer ? transformerPrice(level.transformer.kva) : 0);
}
