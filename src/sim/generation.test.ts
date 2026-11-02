import { describe, expect, it } from 'vitest';
import { BATTERY_HOURS, planHydro, runMix, SOLAR_SHAPE, SOURCE_LIBRARY, SOURCE_TYPES, type MixSite } from './generation';

const flat = (mw: number) => Array.from({ length: 24 }, () => mw);
const site = (demand: number[], wind = flat(0.5), waterHours = 6): MixSite => ({ demand, waterHours, days: [{ name: 'Day', sun: 1, wind }] });

describe('source library', () => {
  it('describes every source, with sensible numbers', () => {
    for (const t of SOURCE_TYPES) {
      const s = SOURCE_LIBRARY[t];
      expect(s.type).toBe(t);
      expect(s.buildPerMw).toBeGreaterThan(0);
      expect(s.rampPerHour).toBeGreaterThan(0);
      expect(s.minShare).toBeLessThan(1);
      expect(s.note.length).toBeGreaterThan(0);
    }
    expect(SOURCE_LIBRARY.coal.co2).toBeGreaterThan(SOURCE_LIBRARY.gas.co2);
    expect(SOURCE_LIBRARY.nuclear.minShare).toBeGreaterThan(SOURCE_LIBRARY.coal.minShare);
  });

  it('gives solar nothing at night and most at midday', () => {
    expect(SOLAR_SHAPE[2]).toBe(0);
    expect(SOLAR_SHAPE[22]).toBe(0);
    expect(SOLAR_SHAPE.indexOf(Math.max(...SOLAR_SHAPE))).toBeGreaterThanOrEqual(11);
    expect(Math.max(...SOLAR_SHAPE)).toBeLessThanOrEqual(1);
  });
});

describe('planning hydro', () => {
  it('spends the water on the highest hours, and no more than the river gives', () => {
    const net = [1, 1, 3, 5, 3];
    const plan = planHydro(net, 4, 4);
    expect(plan.reduce((s, v) => s + v, 0)).toBeCloseTo(4, 3);
    expect(plan[3]).toBeGreaterThan(plan[2]);
    expect(plan[0]).toBe(0);
  });

  it('covers everything when there is water to spare, within its size', () => {
    expect(planHydro([1, 2, 3], 2, 100)).toEqual([1, 2, 2]);
  });
});

describe('running a day', () => {
  it('leaves homes without power at night on solar alone', () => {
    const d = runMix(site(flat(1)), { solar: 5 });
    expect(d.hours[2].short).toBeCloseTo(1);
    expect(d.hours[12].short).toBe(0);
    expect(d.hours[2].frequency).toBeLessThan(50);
    expect(d.hours[12].spilled).toBeGreaterThan(0);
  });

  it('stores midday sun in the battery and gives it back at night', () => {
    const d = runMix(site(flat(1)), { solar: 6, battery: 2 });
    expect(Math.max(...d.hours.map(h => h.charge))).toBeGreaterThan(0);
    expect(d.hours[20].out.battery).toBeGreaterThan(0);
    expect(Math.max(...d.hours.map(h => h.stored))).toBeLessThanOrEqual(2 * BATTERY_HOURS + 1e-9);
  });

  it('gives a battery nothing for free: with nothing to charge it, it is flat', () => {
    const d = runMix(site(flat(1)), { battery: 5 });
    expect(d.shortMwh).toBeCloseTo(24);
  });

  it('holds a slow plant to its ramp, so a fast rise in demand comes up short', () => {
    const demand = flat(40);
    demand[8] = 80;
    const d = runMix(site(demand), { coal: 100 });
    expect(d.hours[8].out.coal).toBeCloseTo(50); // 40 + 10 % of 100
    expect(d.hours[8].short).toBeCloseTo(30);
  });

  it('runs fast when a steady plant cannot turn down far enough', () => {
    const d = runMix(site(flat(50)), { nuclear: 100 });
    expect(d.hours[3].out.nuclear).toBeCloseTo(90);
    expect(d.hours[3].excess).toBeCloseTo(40);
    expect(d.highestHz).toBeGreaterThan(50.5);
  });

  it('runs out of water once the day’s water is used', () => {
    const d = runMix(site(flat(1), flat(0), 3), { hydro: 1 });
    expect(d.shortMwh).toBeCloseTo(21);
    expect(d.hours[23].water).toBeCloseTo(0);
  });

  it('counts spare power, cost and CO₂', () => {
    const d = runMix(site(flat(10)), { gas: 12 });
    expect(d.lowestReserve).toBeCloseTo(0.2);
    expect(d.buildCost).toBe(12 * SOURCE_LIBRARY.gas.buildPerMw);
    expect(d.fuelCost).toBeCloseTo(240 * SOURCE_LIBRARY.gas.fuelPerMwh);
    expect(d.co2PerKwh).toBeCloseTo(SOURCE_LIBRARY.gas.co2);
    expect(d.lowestHz).toBe(50);
  });

  it('uses the weather it is given', () => {
    const s: MixSite = { demand: flat(1), waterHours: 0, days: [{ name: 'Sunny', sun: 1, wind: flat(0.5) }, { name: 'Grey', sun: 0.3, wind: flat(0.1) }] };
    const sunny = runMix(s, { solar: 2, wind: 2 }, s.days[0]);
    const grey = runMix(s, { solar: 2, wind: 2 }, s.days[1]);
    expect(grey.hours[12].sunMw).toBeCloseTo(sunny.hours[12].sunMw * 0.3);
    expect(grey.hours[3].windMw).toBeCloseTo(0.2);
  });
});
