/**
 * Simple breaker model for the game. It is easy to follow, not a full time-current curve:
 * - At or below its rating a breaker never trips, and it cools down.
 * - Above its rating it heats up. Small overloads take a long time to trip, big ones trip fast.
 *   1.1 × rating trips in about 1 hour, 1.5 × in about 2.5 minutes.
 * - At 5 × rating or more (a short circuit) a room breaker trips at once; a board breaker needs 10 ×.
 * Once tripped it stays off until the player resets it.
 */
export const INSTANT_TRIP = 5;
export const BOARD_INSTANT_TRIP = 10;
const HEAT_RATE = 100; // heat per hour per (loading − 1)²; heat 1 = trip
const COOL_RATE = 1;   // heat lost per hour at or below rating

export interface BreakerState {
  /** 0 = cold, 1 = trip point. */
  heat: number;
  tripped: boolean;
}

export const NEW_BREAKER: BreakerState = { heat: 0, tripped: false };

/** Advance one breaker by dtHours at the given loading (current ÷ rating). */
export function stepBreaker(state: BreakerState, loading: number, dtHours: number, instant = INSTANT_TRIP): BreakerState {
  if (state.tripped) return state;
  if (loading >= instant) return { heat: 1, tripped: true };
  const heat = loading > 1
    ? state.heat + HEAT_RATE * (loading - 1) ** 2 * dtHours
    : Math.max(0, state.heat - COOL_RATE * dtHours);
  return heat >= 1 ? { heat: 1, tripped: true } : { heat, tripped: false };
}

/** Hours until a breaker trips from its heat at a steady loading below its instant trip. Infinity at or below rating. */
export function hoursToTrip(state: BreakerState, loading: number): number {
  if (state.tripped) return 0;
  if (loading <= 1) return Infinity;
  return (1 - state.heat) / (HEAT_RATE * (loading - 1) ** 2);
}
