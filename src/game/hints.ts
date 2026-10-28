import { branchCurrents, levelNetwork, maxPhase, onPhase, POWER_FACTOR, profileAt, type Level, type PhaseAmps } from '../sim';

export interface PeakNeed {
  /** Highest current; for a board, on its busiest phase. */
  amps: number;
  hour: number;
  /** Board only: phase currents at that moment. */
  phaseAmps?: PhaseAmps;
}

const HINT_STEP_HOURS = 0.25;

/**
 * Highest current each room and each board asks for during the day, with no trips and no solar.
 * Learn mode shows these next to the breaker choices.
 */
export function peakNeeds(level: Level): { circuits: Map<string, PeakNeed>; boards: Map<string, PeakNeed> } {
  const net = levelNetwork(level);
  const circuits = new Map<string, PeakNeed>();
  const boards = new Map<string, PeakNeed>();
  for (let hour = 0; hour < 24; hour += HINT_STEP_HOURS) {
    const injected = new Map<string, PhaseAmps>();
    for (const c of level.circuits) {
      const amps = (c.kw * profileAt(c.type, hour) * 1000) / (level.voltage * POWER_FACTOR[c.type]);
      injected.set(c.id, onPhase(level, c.id, amps));
      if (amps > (circuits.get(c.id)?.amps ?? -1)) circuits.set(c.id, { amps, hour });
    }
    const branch = branchCurrents(net, injected);
    for (const b of level.boards) {
      const phaseAmps = branch.get(b.id)!;
      const amps = maxPhase(phaseAmps);
      if (amps > (boards.get(b.id)?.amps ?? -1)) boards.set(b.id, { amps, hour, phaseAmps: [...phaseAmps] });
    }
  }
  return { circuits, boards };
}
