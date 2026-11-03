import { describe, expect, it } from 'vitest';
import { GRID_MISSIONS, gridCost, gridStarGoals, needsTransformers, testGrid, type GridDesign } from './grid';

const m = GRID_MISSIONS['level-grid-line'];
const design = (patch: Partial<GridDesign> = {}): GridDesign => ({ kv: 132, conductor: 'heavy', lines: 1, upMva: 100, downMva: 100, ...patch });

describe('the Power line level', () => {
  it('has a full day of demand within what the dam can make', () => {
    expect(m.city.demand).toHaveLength(24);
    expect(Math.max(...m.city.demand)).toBeLessThan(m.station.mw);
    expect(gridStarGoals(m)).toHaveLength(3);
  });

  it('can be won with three stars: 132 kV, one heavy line, and 100 MVA at each end', () => {
    const r = testGrid(m, design());
    expect(r.lessons).toEqual([]);
    expect(r.stars).toBe(3);
    expect(r.lowestVoltage).toBeGreaterThan(0.95);
    expect(r.lossShare).toBeLessThan(m.lossTarget);
  });

  it('needs no transformers at the dam’s own voltage, and they count in the cost otherwise', () => {
    expect(needsTransformers(m, design({ kv: 11 }))).toBe(false);
    expect(gridCost(m, design({ kv: 11 }))).toBe(60 * 42);
    expect(gridCost(m, design())).toBeGreaterThan(gridCost(m, design({ kv: 11 })));
  });

  it('trips the line at 11 kV: the current is far beyond any line', () => {
    const r = testGrid(m, design({ kv: 11 }));
    expect(r.held).toBe(false);
    expect(r.stars).toBe(0);
    expect(r.lessons[0]).toMatch(/^At 00:00 Line A carried \d+ A, above the 800 A it can take, so it sagged and tripped\. The city went dark\. Use a thicker line, a second line, or a higher voltage\.$/);
    expect(r.hours[12].served).toBe(0);
  });

  it('trips a line in the evening when it is only big enough for the afternoon, and its partner after it', () => {
    const r = testGrid(m, design({ kv: 132, conductor: 'light', lines: 1 }));
    expect(r.held).toBe(false);
    expect(r.lessons[0]).toMatch(/Line A carried \d+ A, above the 300 A/);
  });

  it('keeps the lights on at 33 kV, but they dim and the lines run hot', () => {
    const r = testGrid(m, design({ kv: 33, lines: 2 }));
    expect(r.held).toBe(true);
    expect(r.steady).toBe(false);
    expect(r.lessons.join(' ')).toMatch(/At 19:00 the city got only \d+ % of its normal voltage/); // its dimmest hour, the evening peak
    expect(r.lessons.join(' ')).toMatch(/The lines lost [\d.]+ % of the power on the way/);
  });

  it('switches off a transformer too small for the evening peak', () => {
    const r = testGrid(m, design({ upMva: 63 }));
    expect(r.held).toBe(false);
    expect(r.lessons[0]).toMatch(/the step-up transformer carried \d+ MVA, above its 63 MVA, and switched off/);
  });

  it('holds on two lines, at a price', () => {
    const r = testGrid(m, design({ conductor: 'medium', lines: 2 }));
    expect(r.held).toBe(true);
    expect(r.hours[19].loading[0]).toBeCloseTo(r.hours[19].loading[1]);
    expect(r.withinBudget).toBe(false);
    expect(r.stars).toBe(2);
  });
});
