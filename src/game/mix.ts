import { HZ_BAND, NOMINAL_HZ, runMix, SOURCE_LIBRARY, SOURCE_TYPES, type Mix, type MixDay, type MixHour, type MixSite, type SourceType } from '../sim';
import { fmt } from './format';

/** A source the player can build on a level, in steps of a set size. */
export interface MixOffer {
  type: SourceType;
  /** MW added by each step. */
  step: number;
  /** Most steps allowed. */
  max: number;
}

/** A power-mix level: build sources until the place has power every hour. */
export interface MixMission {
  site: MixSite;
  offers: readonly MixOffer[];
  /** Credits a day for building and fuel. */
  budget: number;
  /** CO₂ the third star asks for, in g per kWh. */
  co2Target: number;
  goal: string;
}

/** Spare power every hour must stay at or above this share of demand. */
export const MIN_RESERVE = 0.1;

export interface MixReport {
  days: MixDay[];
  /** Power every hour of every day, with the frequency in its band. */
  held: boolean;
  spareOk: boolean;
  withinBudget: boolean;
  clean: boolean;
  stars: number;
  /** Credits a day: building, plus the fuel of an average day. */
  cost: number;
  /** CO₂ over all the days, in g per kWh. */
  co2: number;
  /** What went wrong, most important first, in plain words. */
  lessons: string[];
}

export const mixStarGoals = (m: MixMission): string[] => [
  m.site.days.length > 1 ? `Power every hour, on all ${m.site.days.length} days` : 'Power every hour',
  `Keep ${MIN_RESERVE * 100} % spare, within ${m.budget} credits a day`,
  `Under ${m.co2Target} g of CO₂ per kWh`,
];

const VALLEY_WIND = [.5, .5, .45, .4, .4, .35, .3, .25, .2, .2, .25, .3, .35, .35, .4, .45, .45, .4, .3, .2, .15, .2, .3, .4];
const CITY_WIND = [.6, .6, .55, .5, .45, .4, .35, .3, .3, .3, .35, .4, .4, .45, .5, .5, .45, .4, .3, .25, .3, .4, .5, .55];
const CITY_DEMAND = [55, 50, 48, 47, 50, 60, 78, 90, 95, 98, 102, 108, 112, 115, 116, 114, 112, 115, 120, 118, 108, 95, 80, 65];
/** A sunny day, and a grey one with a quarter of the wind. */
const twoDays = (wind: readonly number[]) => [
  { name: 'Sunny day', sun: 1, wind },
  { name: 'Calm, grey day', sun: 0.3, wind: wind.map(v => v * 0.25) },
];
const offer = (type: SourceType, step: number, max: number): MixOffer => ({ type, step, max });

export const MIX_MISSIONS: Readonly<Record<string, MixMission>> = {
  'level-mix-valley': {
    site: {
      demand: [0.8, 0.7, 0.7, 0.7, 0.8, 1.0, 1.3, 1.4, 1.3, 1.2, 1.2, 1.2, 1.3, 1.2, 1.2, 1.2, 1.3, 1.6, 2.0, 2.0, 1.8, 1.5, 1.2, 0.9],
      waterHours: 6,
      days: twoDays(VALLEY_WIND),
    },
    offers: [offer('solar', 0.5, 10), offer('wind', 0.5, 6), offer('hydro', 0.5, 2), offer('battery', 0.5, 6), offer('diesel', 0.5, 6)],
    budget: 300,
    co2Target: 200,
    goal: 'Three villages in a valley have no grid. Build their power: it must last every hour, on a sunny day and on a calm, grey one.',
  },
  'level-mix-city': {
    site: { demand: CITY_DEMAND, waterHours: 5, days: twoDays(CITY_WIND) },
    offers: [
      offer('solar', 10, 12), offer('wind', 10, 10), offer('hydro', 10, 4), offer('battery', 10, 8),
      offer('diesel', 5, 10), offer('gas', 20, 8), offer('biomass', 10, 4), offer('geothermal', 10, 4),
    ],
    budget: 8000,
    co2Target: 100,
    goal: 'A small city needs its own power stations. Hot springs nearby allow some geothermal. Keep it running on both days.',
  },
  'level-mix-metro': {
    site: { demand: CITY_DEMAND.map(v => v * 8), waterHours: 6, days: twoDays(CITY_WIND) },
    offers: [
      offer('solar', 50, 12), offer('wind', 50, 12), offer('hydro', 50, 6), offer('battery', 50, 8), offer('diesel', 25, 8),
      offer('gas', 100, 8), offer('biomass', 50, 4), offer('coal', 150, 6), offer('geothermal', 50, 4), offer('nuclear', 300, 3),
    ],
    budget: 66000,
    co2Target: 55,
    goal: 'A big city, and every kind of power station. Big steady plants are cheap per unit but slow; fast ones cost more to run.',
  },
};

const clock = (hour: number) => `${String(hour).padStart(2, '0')}:00`;
const TINY = 1e-6;

/** Why this hour came up short, in one or two short sentences. */
function shortLesson(mix: Mix, h: MixHour, when: string): string {
  const size = (t: SourceType) => mix[t] ?? 0;
  const lost = `${fmt(h.short)} MW of homes lost power`;
  const slow = (['nuclear', 'coal', 'geothermal', 'biomass'] as SourceType[])
    .find(t => size(t) > 0 && h.ceiling[t] !== undefined && h.ceiling[t]! < size(t) - TINY);
  if (size('solar') > 0 && h.sunMw < 0.05 * size('solar')) {
    return size('battery') > 0
      ? `${when} the sun was down and the battery was empty: ${lost}. Store more, or add a source that runs at night.`
      : `${when} the sun was down: ${lost}. Solar makes nothing at night, so add a battery or a source that runs after dark.`;
  }
  if (slow) {
    return `${when} demand rose faster than ${SOURCE_LIBRARY[slow].name.toLowerCase()} can follow: ${lost}. It changes only ${SOURCE_LIBRARY[slow].rampPerHour * 100} % an hour, so add something fast.`;
  }
  if (size('hydro') > 0 && h.water < TINY) {
    return `${when} the river had no water left for hydro: ${lost}. Hydro is fast, but each day brings only so much water.`;
  }
  if (size('wind') > 0 && h.windMw < 0.3 * size('wind')) {
    return `${when} the wind had dropped: ${lost}. Wind can fall away for hours, so keep something steady behind it.`;
  }
  return `${when} demand was ${fmt(h.demand)} MW and everything together made only ${fmt(h.demand - h.short)} MW: ${lost}. Build more.`;
}

/** Run every day of the level and score the mix. */
export function testMix(m: MixMission, mix: Mix): MixReport {
  const days = m.site.days.map(w => runMix(m.site, mix, w));
  const named = (i: number) => (days.length > 1 ? `On the ${m.site.days[i].name.toLowerCase()}, at` : 'At');
  const lessons: string[] = [];

  days.forEach((d, i) => {
    const h = d.hours.find(x => x.short > TINY);
    if (h) lessons.push(shortLesson(mix, h, `${named(i)} ${clock(h.hour)}`));
  });
  days.forEach((d, i) => {
    const h = d.hours.find(x => x.frequency > NOMINAL_HZ + HZ_BAND);
    if (!h) return;
    const stuck = SOURCE_TYPES.filter(t => SOURCE_LIBRARY[t].minShare > 0 && (mix[t] ?? 0) > 0).map(t => SOURCE_LIBRARY[t].name.toLowerCase());
    lessons.push(`${named(i)} ${clock(h.hour)} ${stuck.join(' and ') || 'the plants'} could not turn down far enough, so the grid ran fast at ${fmt(h.frequency, 2)} Hz. Add a battery to soak it up, or build less of them.`);
  });
  const held = lessons.length === 0;

  const tight = days.map((d, i) => ({ i, h: d.hours.find(x => x.short <= TINY && x.reserve < MIN_RESERVE) })).find(x => x.h);
  if (tight?.h) {
    lessons.push(`${named(tight.i)} ${clock(tight.h.hour)} only ${fmt(tight.h.reserve * 100, 0)} % was spare. If one plant had tripped, homes would have lost power: keep at least ${MIN_RESERVE * 100} % spare.`);
  }
  const spareOk = days.every(d => d.lowestReserve >= MIN_RESERVE);
  const cost = days[0].buildCost + days.reduce((s, d) => s + d.fuelCost, 0) / days.length;
  const withinBudget = cost <= m.budget;
  if (!withinBudget) {
    lessons.push(`It costs ${fmt(cost, 0)} credits a day, over the ${m.budget} budget. Building is paid off a little every day, and fuel is paid while it burns.`);
  }
  const served = days.reduce((s, d) => s + d.servedMwh, 0);
  const co2 = served > 0 ? days.reduce((s, d) => s + d.co2PerKwh * d.servedMwh, 0) / served : 0;
  const clean = co2 <= m.co2Target;
  if (!clean) {
    lessons.push(`${fmt(co2, 0)} g of CO₂ per kWh, above the ${m.co2Target} g goal. Sun, wind, water and nuclear burn nothing; diesel, gas and coal do.`);
  }
  const stars = held ? 1 + (spareOk && withinBudget ? 1 : 0) + (clean ? 1 : 0) : 0;
  return { days, held, spareOk, withinBudget, clean, stars, cost, co2, lessons };
}
