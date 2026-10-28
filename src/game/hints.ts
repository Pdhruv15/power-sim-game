import { POWER_FACTOR, profileAt, type VillaData } from '../sim';

export interface PeakNeed {
  amps: number;
  hour: number;
}

const HINT_STEP_HOURS = 0.25;

/**
 * Highest current each room asks for during the day, and all rooms together.
 * Learn mode shows these next to the breaker choices.
 */
export function peakNeeds(data: VillaData): { circuits: Map<string, PeakNeed>; total: PeakNeed } {
  const V = data.supply.voltage;
  const circuits = new Map<string, PeakNeed>();
  const total: PeakNeed = { amps: 0, hour: 0 };
  for (let hour = 0; hour < 24; hour += HINT_STEP_HOURS) {
    let sum = 0;
    for (const c of data.circuits) {
      const amps = (c.kw * profileAt(c.type, hour) * 1000) / (V * POWER_FACTOR[c.type]);
      sum += amps;
      if (amps > (circuits.get(c.id)?.amps ?? -1)) circuits.set(c.id, { amps, hour });
    }
    if (sum > total.amps) Object.assign(total, { amps: sum, hour });
  }
  return { circuits, total };
}
