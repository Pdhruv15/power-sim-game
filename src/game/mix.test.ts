import { describe, expect, it } from 'vitest';
import { SOURCE_TYPES, type Mix } from '../sim';
import { MIX_MISSIONS, mixStarGoals, testMix } from './mix';

/** A mix found by searching each level: it earns all three stars. */
const BEST: Record<string, Mix> = {
  'level-mix-valley': { solar: 5, wind: 3, hydro: 1, battery: 0.5, diesel: 1.5 },
  'level-mix-city': { solar: 110, wind: 70, hydro: 40, diesel: 15, gas: 40, geothermal: 40 },
  'level-mix-metro': { solar: 450, wind: 300, hydro: 300, battery: 50, diesel: 175, gas: 200, biomass: 50, geothermal: 150, nuclear: 300 },
};

describe('power-mix levels', () => {
  it('offer known sources, each once, on 24-hour days', () => {
    for (const m of Object.values(MIX_MISSIONS)) {
      const types = m.offers.map(o => o.type);
      expect(new Set(types).size).toBe(types.length);
      for (const t of types) expect(SOURCE_TYPES).toContain(t);
      expect(m.site.demand).toHaveLength(24);
      for (const w of m.site.days) expect(w.wind).toHaveLength(24);
      expect(mixStarGoals(m)).toHaveLength(3);
    }
  });

  it('can each be won with three stars, using sizes the level offers', () => {
    for (const [id, mix] of Object.entries(BEST)) {
      const m = MIX_MISSIONS[id];
      for (const [t, mw] of Object.entries(mix)) {
        const o = m.offers.find(x => x.type === t)!;
        expect(mw / o.step).toBeLessThanOrEqual(o.max);
        expect(Number.isInteger(mw / o.step)).toBe(true);
      }
      const r = testMix(m, mix);
      expect(r.lessons).toEqual([]);
      expect(r.stars).toBe(3);
    }
  });

  it('explains solar with nothing behind it at night', () => {
    const r = testMix(MIX_MISSIONS['level-mix-valley'], { solar: 5 });
    expect(r.held).toBe(false);
    expect(r.stars).toBe(0);
    expect(r.lessons[0]).toMatch(/^On the sunny day, at 00:00 the sun was down: .* MW of homes lost power\. Solar makes nothing at night/);
  });

  it('holds on diesel alone, but it is dear and dirty', () => {
    const r = testMix(MIX_MISSIONS['level-mix-valley'], { diesel: 3 });
    expect(r.held).toBe(true);
    expect(r.stars).toBe(1);
    expect(r.lessons.join(' ')).toMatch(/over the 300 budget/);
    expect(r.lessons.join(' ')).toMatch(/800 g of CO₂ per kWh, above the 200 g goal/);
  });

  it('warns when too little is spare', () => {
    const r = testMix(MIX_MISSIONS['level-mix-valley'], { diesel: 2 });
    expect(r.held).toBe(true);
    expect(r.spareOk).toBe(false);
    expect(r.lessons[0]).toMatch(/only 0 % was spare/);
  });

  it('explains a slow plant that cannot follow the morning rise', () => {
    const r = testMix(MIX_MISSIONS['level-mix-metro'], { coal: 900 });
    expect(r.lessons[0]).toMatch(/at 06:00 demand rose faster than coal can follow: .* It changes only 10 % an hour/);
  });

  it('explains a steady plant that cannot turn down at night', () => {
    const r = testMix(MIX_MISSIONS['level-mix-metro'], { nuclear: 900, gas: 200 });
    expect(r.lessons.join(' ')).toMatch(/nuclear could not turn down far enough, so the grid ran fast/);
  });
});
