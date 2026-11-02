import { pvOutput, sunAt } from './sun';

/**
 * Power sources for a whole grid, run hour by hour through one day.
 * Game rules, kept simple: each kind of source is one block of its total size, and the grid
 * frequency is a plain rule that falls when supply is short and rises when there is too much.
 */
export type SourceType = 'solar' | 'wind' | 'hydro' | 'battery' | 'diesel' | 'gas' | 'biomass' | 'coal' | 'geothermal' | 'nuclear';

export const SOURCE_TYPES: readonly SourceType[] = ['solar', 'wind', 'hydro', 'battery', 'diesel', 'gas', 'biomass', 'coal', 'geothermal', 'nuclear'];

/** Weather decides the output; on demand runs when asked; a store moves energy to later. */
export type SourceGroup = 'weather' | 'demand' | 'store';

export interface SourceInfo {
  type: SourceType;
  name: string;
  group: SourceGroup;
  /** Credits a day to pay for building 1 MW of it. */
  buildPerMw: number;
  /** Credits of fuel per MWh made. */
  fuelPerMwh: number;
  /** CO₂ while running, in g per kWh made. */
  co2: number;
  /** Most it can change its output in an hour, as a share of its size. */
  rampPerHour: number;
  /** Lowest output it can run at steadily, as a share of its size. */
  minShare: number;
  /** Its catch, in a few words. */
  short: string;
  /** What it teaches, in one short sentence. */
  note: string;
}

const source = (
  type: SourceType, name: string, group: SourceGroup, buildPerMw: number, fuelPerMwh: number, co2: number,
  rampPerHour: number, minShare: number, short: string, note: string,
): [SourceType, SourceInfo] => [type, { type, name, group, buildPerMw, fuelPerMwh, co2, rampPerHour, minShare, short, note }];

export const SOURCE_LIBRARY: Readonly<Record<SourceType, SourceInfo>> = Object.fromEntries([
  source('solar', 'Solar', 'weather', 11, 0, 0, 1, 0, 'Daylight only', 'Free power at midday and none at night.'),
  source('wind', 'Wind', 'weather', 16, 0, 0, 1, 0, 'Changes hourly', 'Free power whenever it blows, which may not be when you need it.'),
  source('hydro', 'Hydro', 'demand', 33, 0, 0, 1, 0, 'Fast, needs water', 'Turns up in minutes, but the river gives only so much water a day.'),
  source('battery', 'Battery', 'store', 22, 0, 0, 1, 0, 'Stores for later', 'Holds four hours at full power. It charges only from spare power.'),
  source('diesel', 'Diesel', 'demand', 5, 25, 800, 1, 0, 'Backup, costly', 'Cheap to build and starts at once, but its fuel is dear and dirty.'),
  source('gas', 'Gas', 'demand', 11, 5, 450, 0.6, 0, 'Fast to ramp', 'Follows demand well, and burns half the CO₂ of coal.'),
  source('biomass', 'Biomass', 'demand', 33, 6, 100, 0.25, 0.3, 'Needs fuel supply', 'Burns wood and crop waste. Low CO₂ if the fuel is regrown.'),
  source('coal', 'Coal', 'demand', 27, 3, 950, 0.1, 0.4, 'Slow, high CO₂', 'Cheap fuel, but it changes only 10 % an hour and is the dirtiest.'),
  source('geothermal', 'Geothermal', 'demand', 44, 0, 50, 0.05, 0.8, 'Steady, site-tied', 'Heat from deep underground, the same output day and night.'),
  source('nuclear', 'Nuclear', 'demand', 48, 1, 10, 0.02, 0.9, 'Steady, very large', 'Huge, clean and steady, but it barely turns down at night.'),
]) as Record<SourceType, SourceInfo>;

/** Hours a battery holds at full power. */
export const BATTERY_HOURS = 4;
/** Share of charging energy a battery gives back. */
export const BATTERY_EFFICIENCY = 0.9;
/** Grid frequency with supply and demand matched. */
export const NOMINAL_HZ = 50;
/** Game rule: each 1 % of demand out of balance moves the frequency by 0.05 Hz. */
export const HZ_PER_SHARE = 5;
/** Frequency the grid must stay within. */
export const HZ_BAND = 0.5;

/** One kind of day the mix is tested on. */
export interface Weather {
  name: string;
  /** Share of a clear day's sunshine that reaches the panels. */
  sun: number;
  /** Wind for each hour, as a share of a turbine's full output. */
  wind: readonly number[];
}

/** The place being supplied. */
export interface MixSite {
  /** Demand for each hour of the day, in MW. */
  demand: readonly number[];
  /** Hours at full output the river's water allows hydro in a day. */
  waterHours: number;
  /** The days the mix must get through. */
  days: readonly Weather[];
}

/** Built size of each source, in MW. Sources left out are not built. */
export type Mix = Partial<Record<SourceType, number>>;

export interface MixHour {
  hour: number;
  demand: number;
  /** Output of each source, in MW. A battery's is what it gives back. */
  out: Record<SourceType, number>;
  /** Power going into the battery, in MW. */
  charge: number;
  /** Sun and wind power that had nowhere to go. */
  spilled: number;
  /** Demand that could not be met: those homes lost power. */
  short: number;
  /** Power the steady plants could not turn down. */
  excess: number;
  frequency: number;
  /** Power that could still be added within the hour, as a share of demand. */
  reserve: number;
  /** Energy left in the battery at the end of the hour, in MWh. */
  stored: number;
  /** Hydro water left at the end of the hour, in MWh. */
  water: number;
  /** What sun and wind could have made this hour. */
  sunMw: number;
  windMw: number;
  /** Highest output each slow plant could reach this hour. */
  ceiling: Partial<Record<SourceType, number>>;
}

export interface MixDay {
  hours: MixHour[];
  /** Credits a day to pay for building the mix. */
  buildCost: number;
  /** Credits of fuel over the day. */
  fuelCost: number;
  /** MWh asked for, and MWh delivered. */
  demandMwh: number;
  servedMwh: number;
  shortMwh: number;
  /** Average CO₂ of the power delivered, in g per kWh. */
  co2PerKwh: number;
  lowestHz: number;
  highestHz: number;
  lowestReserve: number;
}

/** Sources that can be asked for more, cheapest to run first. Hydro and the battery are planned apart. */
const FLEXIBLE: readonly SourceType[] = ['geothermal', 'nuclear', 'coal', 'biomass', 'gas'];

const zeroOut = (): Record<SourceType, number> => Object.fromEntries(SOURCE_TYPES.map(t => [t, 0])) as Record<SourceType, number>;

export const buildCost = (mix: Mix): number => SOURCE_TYPES.reduce((s, t) => s + (mix[t] ?? 0) * SOURCE_LIBRARY[t].buildPerMw, 0);

/** Solar output at a 1 MW farm for each hour, taken at the middle of the hour. */
export const SOLAR_SHAPE: readonly number[] = Array.from({ length: 24 }, (_, h) => pvOutput(1, sunAt(h + 0.5)));

/**
 * Spread the day's water over the hours with the most demand left after sun and wind,
 * so the river covers the peaks rather than running dry early.
 */
export function planHydro(net: readonly number[], mw: number, waterMwh: number): number[] {
  const at = (level: number) => net.map(n => Math.min(mw, Math.max(0, n - level)));
  const used = (level: number) => at(level).reduce((s, v) => s + v, 0);
  if (mw <= 0 || waterMwh <= 0) return net.map(() => 0);
  if (used(0) <= waterMwh) return at(0);
  let lo = 0, hi = Math.max(...net);
  for (let i = 0; i < 50; i++) {
    const mid = (lo + hi) / 2;
    if (used(mid) > waterMwh) lo = mid; else hi = mid;
  }
  return at(hi);
}

/** Run the mix through one kind of day, one hour at a time. */
export function runMix(site: MixSite, mix: Mix, weather: Weather = site.days[0]): MixDay {
  const size = (t: SourceType) => Math.max(0, mix[t] ?? 0);
  const storeMwh = size('battery') * BATTERY_HOURS;
  const dayWater = size('hydro') * site.waterHours;
  let stored = storeMwh / 2;
  let water = dayWater;
  const sunMw = SOLAR_SHAPE.map(v => v * weather.sun * size('solar'));
  const windMw = weather.wind.map(v => v * size('wind'));
  const hydroPlan = planHydro(site.demand.map((d, h) => d - sunMw[h] - windMw[h]), size('hydro'), dayWater);
  const prev = zeroOut();
  const hours: MixHour[] = [];

  const step = (demand: number, hour: number, first: boolean): MixHour => {
    const out = zeroOut();
    const ceiling: Partial<Record<SourceType, number>> = {};
    const floor: Partial<Record<SourceType, number>> = {};
    for (const t of [...FLEXIBLE, 'diesel'] as SourceType[]) {
      const cap = size(t);
      if (cap <= 0) continue;
      const { rampPerHour, minShare } = SOURCE_LIBRARY[t];
      // The very first hour has no hour before it, so any output is reachable
      floor[t] = first ? cap * minShare : Math.max(cap * minShare, prev[t] - rampPerHour * cap);
      ceiling[t] = first ? cap : Math.min(cap, prev[t] + rampPerHour * cap);
      out[t] = floor[t]!;
    }
    out.solar = sunMw[hour];
    out.wind = windMw[hour];
    let need = demand - SOURCE_TYPES.reduce((s, t) => s + out[t], 0);
    let charge = 0, spilled = 0, excess = 0;

    if (need < 0) {
      let surplus = -need;
      charge = Math.min(size('battery'), (storeMwh - stored) / BATTERY_EFFICIENCY, surplus);
      stored += charge * BATTERY_EFFICIENCY;
      surplus -= charge;
      const weather = out.solar + out.wind;
      spilled = Math.min(surplus, weather);
      if (weather > 0) {
        out.solar -= spilled * (out.solar / weather);
        out.wind -= spilled * (out.wind / weather);
      }
      excess = surplus - spilled;
      need = 0;
    } else {
      const take = (t: SourceType, most: number) => {
        const add = Math.max(0, Math.min(most, need));
        out[t] += add;
        need -= add;
        return add;
      };
      water -= take('hydro', Math.min(hydroPlan[hour], water));
      for (const t of FLEXIBLE) if (ceiling[t] !== undefined) take(t, ceiling[t]! - out[t]);
      stored -= take('battery', Math.min(size('battery'), stored));
      if (ceiling.diesel !== undefined) take('diesel', ceiling.diesel - out.diesel);
      // Water saved for later is still there for a shortfall now
      water -= take('hydro', Math.min(size('hydro') - out.hydro, water));
    }

    const short = need;
    const balance = (excess - short) / demand;
    const frequency = Math.min(NOMINAL_HZ + 2.5, Math.max(NOMINAL_HZ - 2.5, NOMINAL_HZ + HZ_PER_SHARE * balance));
    let spare = Math.min(size('hydro') - out.hydro, water) + Math.min(size('battery') - out.battery, stored);
    for (const t of [...FLEXIBLE, 'diesel'] as SourceType[]) if (ceiling[t] !== undefined) spare += ceiling[t]! - out[t];
    Object.assign(prev, out);
    return {
      hour, demand, out, charge, spilled, short, excess, frequency, reserve: spare / demand,
      stored, water, sunMw: sunMw[hour], windMw: windMw[hour], ceiling,
    };
  };

  // The day runs twice and only the second is kept, so the battery and the slow plants
  // start where a day like it leaves them, not half full for free
  for (let day = 0; day < 2; day++) {
    water = dayWater;
    hours.length = 0;
    site.demand.forEach((demand, hour) => hours.push(step(demand, hour, day === 0 && hour === 0)));
  }

  const sum = (f: (h: MixHour) => number) => hours.reduce((s, h) => s + f(h), 0);
  const servedMwh = sum(h => h.demand - h.short);
  const co2Kg = sum(h => SOURCE_TYPES.reduce((s, t) => s + h.out[t] * SOURCE_LIBRARY[t].co2, 0));
  return {
    hours,
    buildCost: buildCost(mix),
    fuelCost: sum(h => SOURCE_TYPES.reduce((s, t) => s + h.out[t] * SOURCE_LIBRARY[t].fuelPerMwh, 0)),
    demandMwh: sum(h => h.demand),
    servedMwh,
    shortMwh: sum(h => h.short),
    co2PerKwh: servedMwh > 0 ? co2Kg / servedMwh : 0,
    lowestHz: Math.min(...hours.map(h => h.frequency)),
    highestHz: Math.max(...hours.map(h => h.frequency)),
    lowestReserve: Math.min(...hours.map(h => h.reserve)),
  };
}
