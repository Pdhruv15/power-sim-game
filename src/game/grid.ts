import {
  CONDUCTORS, gridTransformerCost, gridTransformerLoading, linkCost, solveLink, TOWN_POWER_FACTOR, type Line, type Link,
} from '../sim';
import { fmt } from './format';

/** A transmission level: carry a station's output to a city over a set distance. */
export interface GridMission {
  station: { name: string; mw: number; kv: number };
  city: { name: string; demand: readonly number[] };
  lengthKm: number;
  /** Credits a day for the lines and transformers. */
  budget: number;
  /** Most of the day's energy the lines may lose, as a share. */
  lossTarget: number;
  goal: string;
}

/** What the player picks. */
export interface GridDesign {
  kv: number;
  conductor: string;
  /** Lines side by side, all the same. */
  lines: 1 | 2;
  /** Sizes of the step-up and step-down transformers in MVA. Not needed at the station's own voltage. */
  upMva: number;
  downMva: number;
}

/** The city's voltage must stay within this share of normal. */
export const VOLTAGE_BAND = 0.05;

export interface GridHour {
  hour: number;
  demand: number;
  /** MW that reached the city. */
  served: number;
  lossMw: number;
  /** City voltage as a share of normal. */
  voltage: number;
  amps: number[];
  loading: number[];
  out: boolean[];
  upLoading: number;
  downLoading: number;
}

export interface GridReport {
  hours: GridHour[];
  held: boolean;
  steady: boolean;
  withinBudget: boolean;
  stars: number;
  cost: number;
  /** Share of the energy sent that was lost on the way. */
  lossShare: number;
  lowestVoltage: number;
  lessons: string[];
}

export const gridStarGoals = (m: GridMission): string[] => [
  'Power the city every hour',
  `Keep the voltage within ${VOLTAGE_BAND * 100} % and lose under ${fmt(m.lossTarget * 100, 0)} %`,
  `Within ${m.budget} credits a day`,
];

/** Step-up and step-down transformers are needed only when the line runs above the station's voltage. */
export const needsTransformers = (m: GridMission, d: GridDesign): boolean => d.kv !== m.station.kv;

export function gridCost(m: GridMission, d: GridDesign): number {
  const lines = linkCost({ kv: d.kv, lines: Array.from({ length: d.lines }, () => ({ conductor: d.conductor, lengthKm: m.lengthKm })) });
  return lines + (needsTransformers(m, d) ? gridTransformerCost(d.upMva) + gridTransformerCost(d.downMva) : 0);
}

const clock = (h: number) => `${String(h).padStart(2, '0')}:00`;
const LINE_NAMES = ['Line A', 'Line B'];

/** Run the city's day over the design, hour by hour. A line or transformer pushed past its limit trips and stays off. */
export function testGrid(m: GridMission, d: GridDesign): GridReport {
  const lines: Line[] = Array.from({ length: d.lines }, () => ({ conductor: d.conductor, lengthKm: m.lengthKm, out: false }));
  const steps = needsTransformers(m, d);
  let upOut = false, downOut = false;
  const hours: GridHour[] = [];
  const trips: string[] = [];

  m.city.demand.forEach((demand, hour) => {
    const link: Link = { kv: d.kv, lines };
    let r = solveLink(link, demand);
    // A line past its limit sags and trips; the others take its share, and may trip in turn
    for (let guard = 0; guard < lines.length && r.connected; guard++) {
      const over = r.loading.findIndex((l, i) => !lines[i].out && l > 1);
      if (over < 0) break;
      trips.push(`At ${clock(hour)} ${LINE_NAMES[over]} carried ${fmt(r.amps[over], 0)} A, above the ${CONDUCTORS[d.conductor].amps} A it can take, so it sagged and tripped.`);
      lines[over].out = true;
      r = solveLink(link, demand);
    }
    const sent = demand + r.lossMw;
    const upLoading = steps ? gridTransformerLoading(sent, d.upMva) : 0;
    const downLoading = steps ? gridTransformerLoading(demand, d.downMva) : 0;
    if (steps && !upOut && upLoading > 1) {
      upOut = true;
      trips.push(`At ${clock(hour)} the step-up transformer carried ${fmt(sent / TOWN_POWER_FACTOR, 0)} MVA, above its ${d.upMva} MVA, and switched off. Pick a bigger one.`);
    }
    if (steps && !downOut && downLoading > 1) {
      downOut = true;
      trips.push(`At ${clock(hour)} the step-down transformer carried ${fmt(demand / TOWN_POWER_FACTOR, 0)} MVA, above its ${d.downMva} MVA, and switched off. Pick a bigger one.`);
    }
    const through = r.connected && !upOut && !downOut;
    // The station makes no more than it can; losses come out of the city's share
    const served = through ? Math.max(0, Math.min(demand, m.station.mw - r.lossMw)) : 0;
    hours.push({
      hour, demand, served, lossMw: through ? r.lossMw : 0, voltage: through ? 1 - r.dropPct / 100 : 0,
      amps: r.amps, loading: r.loading, out: lines.map(l => !!l.out), upLoading, downLoading,
    });
  });

  const lessons: string[] = [];
  if (trips.length) lessons.push(`${trips[0]} The city went dark.${trips[0].includes('Line') ? ' Use a thicker line, a second line, or a higher voltage.' : ''}`);
  const short = hours.find(h => h.served < h.demand - 1e-6 && h.voltage > 0);
  if (short) {
    lessons.push(`At ${clock(short.hour)} the city and the losses on the way needed ${fmt(short.demand + short.lossMw, 0)} MW, more than the ${m.station.name.toLowerCase()}'s ${m.station.mw} MW. Cut the losses with a higher voltage or thicker lines.`);
  }
  const held = hours.every(h => h.served >= h.demand - 1e-6);

  const powered = hours.filter(h => h.voltage > 0);
  const lowestVoltage = powered.length ? Math.min(...powered.map(h => h.voltage)) : 0;
  // The worst hour, so the lesson names the time it matters most
  const lowest = powered.reduce<GridHour | null>((a, h) => (!a || h.voltage < a.voltage ? h : a), null);
  const dim = lowest && lowest.voltage < 1 - VOLTAGE_BAND ? lowest : null;
  if (dim) {
    lessons.push(`At ${clock(dim.hour)} the city got only ${fmt(dim.voltage * 100, 0)} % of its normal voltage, so lamps dim and motors struggle. Raise the line voltage, or use a thicker line.`);
  }
  const sentMwh = hours.reduce((s, h) => s + h.served + h.lossMw, 0);
  const lossShare = sentMwh > 0 ? hours.reduce((s, h) => s + h.lossMw, 0) / sentMwh : 0;
  if (lossShare > m.lossTarget) {
    lessons.push(`The lines lost ${fmt(lossShare * 100, 1)} % of the power on the way, as heat. A higher voltage needs less current, and the loss falls with the square of the current.`);
  }
  const steady = !dim && lossShare <= m.lossTarget;
  const cost = gridCost(m, d);
  const withinBudget = cost <= m.budget;
  if (!withinBudget) lessons.push(`It costs ${fmt(cost, 0)} credits a day, over the ${m.budget} budget. Buried cable and big transformers cost the most.`);

  const stars = held ? 1 + (steady ? 1 : 0) + (withinBudget ? 1 : 0) : 0;
  return { hours, held, steady, withinBudget, stars, cost, lossShare, lowestVoltage, lessons };
}

export const GRID_MISSIONS: Readonly<Record<string, GridMission>> = {
  'level-grid-line': {
    station: { name: 'Hydro dam', mw: 100, kv: 11 },
    city: {
      name: 'City',
      demand: [44, 41, 40, 40, 42, 48, 56, 63, 66, 68, 70, 72, 73, 74, 75, 74, 73, 75, 79, 80, 76, 68, 58, 50],
    },
    lengthKm: 42,
    budget: 4000,
    lossTarget: 0.03,
    goal: 'The dam in the hills makes power at 11 kV. Carry it 42 km to the city, which needs up to 80 MW in the evening. Pick the line voltage, the line, and the transformers at each end.',
  },
};
