import { describe, expect, it } from 'vitest';
import {
  CONDUCTOR_IDS, CONDUCTORS, GRID_TRANSFORMER_MVA, gridTransformerCost, gridTransformerLoading, LINE_KV, lineAmps, linkCost, solveLink, type Line,
} from './transmission';

const line = (conductor: string, lengthKm = 40, out = false): Line => ({ conductor, lengthKm, out });

describe('transmission parts', () => {
  it('describe every conductor, with buried cable dearer than any overhead line', () => {
    for (const id of CONDUCTOR_IDS) {
      const c = CONDUCTORS[id];
      expect(c.id).toBe(id);
      expect(c.ohmsPerKm).toBeGreaterThan(0);
      expect(c.amps).toBeGreaterThan(0);
      expect(c.note.length).toBeGreaterThan(0);
    }
    const cheapestCable = Math.min(...CONDUCTOR_IDS.filter(id => CONDUCTORS[id].kind === 'cable').map(id => CONDUCTORS[id].costPerKm));
    const dearestLine = Math.max(...CONDUCTOR_IDS.filter(id => CONDUCTORS[id].kind === 'overhead').map(id => CONDUCTORS[id].costPerKm));
    expect(cheapestCable).toBeGreaterThan(dearestLine);
    expect(LINE_KV).toEqual([11, 33, 132]);
  });

  it('size grid transformers by the power through them', () => {
    expect(gridTransformerLoading(85, 100)).toBeCloseTo(85 / 0.95 / 100);
    expect(gridTransformerLoading(85, 63)).toBeGreaterThan(1);
    expect(gridTransformerCost(100) / 100).toBeLessThan(gridTransformerCost(10) / 10);
    expect([...GRID_TRANSFORMER_MVA].sort((a, b) => a - b)).toEqual(GRID_TRANSFORMER_MVA);
  });
});

describe('carrying power over a line', () => {
  it('needs far less current at a higher voltage', () => {
    expect(lineAmps(85, 132)).toBeCloseTo(391, 0);
    expect(lineAmps(85, 11)).toBeCloseTo(4696, 0);
    expect(lineAmps(85, 11) / lineAmps(85, 132)).toBeCloseTo(12);
    expect(lineAmps(0, 132)).toBe(0);
  });

  it('loses 144 times less on the same line at twelve times the voltage', () => {
    const at = (kv: number) => solveLink({ kv, lines: [line('heavy')] }, 85).lossMw;
    expect(at(11) / at(132)).toBeCloseTo(144);
    expect(at(132)).toBeCloseTo(3 * 391 ** 2 * 0.1 * 40 / 1e6, 1);
  });

  it('shares the current equally between two lines the same, halving the loss', () => {
    const one = solveLink({ kv: 132, lines: [line('medium')] }, 80);
    const two = solveLink({ kv: 132, lines: [line('medium'), line('medium')] }, 80);
    expect(two.amps[0]).toBeCloseTo(one.amps[0] / 2);
    expect(two.amps[1]).toBeCloseTo(two.amps[0]);
    expect(two.lossMw).toBeCloseTo(one.lossMw / 2);
    expect(two.dropPct).toBeCloseTo(one.dropPct / 2);
  });

  it('sends more of the current down the line it flows through more easily', () => {
    const r = solveLink({ kv: 132, lines: [line('heavy'), line('light')] }, 80);
    expect(r.amps[0]).toBeGreaterThan(r.amps[1]);
    expect(r.amps[0] + r.amps[1]).toBeGreaterThanOrEqual(lineAmps(80, 132) - 1e-6);
  });

  it('puts everything on the other line when one is out, and nothing gets through when both are', () => {
    const r = solveLink({ kv: 132, lines: [line('medium'), line('medium', 40, true)] }, 80);
    expect(r.amps[1]).toBe(0);
    expect(r.amps[0]).toBeCloseTo(lineAmps(80, 132));
    expect(r.loading[0]).toBeCloseTo(lineAmps(80, 132) / CONDUCTORS.medium.amps);
    const dark = solveLink({ kv: 132, lines: [line('medium', 40, true), line('medium', 40, true)] }, 80);
    expect(dark).toMatchObject({ connected: false, lossMw: 0, dropPct: 0 });
  });

  it('drops more voltage on an overhead line than on buried cable of about the same resistance', () => {
    const overhead = solveLink({ kv: 33, lines: [line('medium', 20)] }, 20);
    const cable = solveLink({ kv: 33, lines: [{ conductor: 'cable', lengthKm: 20 * (CONDUCTORS.medium.ohmsPerKm / CONDUCTORS.cable.ohmsPerKm) }] }, 20);
    expect(overhead.dropPct).toBeGreaterThan(cable.dropPct);
  });

  it('prices a link by its conductors and lengths', () => {
    expect(linkCost({ kv: 132, lines: [line('medium', 42), line('medium', 45)] })).toBe(CONDUCTORS.medium.costPerKm * 87);
  });
});
