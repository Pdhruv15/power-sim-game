import { stepBreaker, type BreakerState } from './breaker';

/**
 * Simple transformer model for the game:
 * - Its size in kVA is shared by the three phases, so each phase can carry a third of it.
 *   The busiest phase decides how loaded it is, which is why unbalanced phases waste a transformer.
 * - Above its rating it heats like a breaker, only four times slower. When it gets too hot it switches off,
 *   and everything it feeds loses power.
 * - It loses a little voltage as it loads up, and its own resistance limits short-circuit current.
 */
const SLOWER_THAN_BREAKER = 0.25;
/** Voltage lost inside the transformer at full load, as % of the phase voltage. */
const FULL_LOAD_DROP_PCT = 2;
/** Fraction of the phase voltage that would drive full-load current through a shorted output. */
const SHORT_CIRCUIT_SHARE = 0.04;

/** Current each phase can carry, in amps. */
export const transformerRatedAmps = (kva: number, voltage: number): number => (kva * 1000) / (3 * voltage);

/** Voltage lost inside the transformer, as % of the phase voltage. */
export const transformerDropPct = (loading: number): number => FULL_LOAD_DROP_PCT * loading;

/** The transformer's own resistance, in ohms. Bigger transformers let more short-circuit current through. */
export const transformerOhms = (kva: number, voltage: number): number =>
  (SHORT_CIRCUIT_SHARE * voltage) / transformerRatedAmps(kva, voltage);

/** Advance the transformer's heat by dtHours at the given loading (busiest phase ÷ rated amps). */
export const stepTransformer = (state: BreakerState, loading: number, dtHours: number): BreakerState =>
  stepBreaker(state, loading, dtHours * SLOWER_THAN_BREAKER, Infinity);
