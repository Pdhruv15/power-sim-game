import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  cableDropV, GRID_ID, LevelError, levelNetwork, parseLevel, profileAt, Simulator, TRANSFORMER_ID, transformerOhms, transformerRatedAmps, type Level, type Phase,
} from './index';

const twoVillas = (): Level =>
  parseLevel(JSON.parse(readFileSync(new URL('../../public/data/two-villas.json', import.meta.url), 'utf8')));
/** Spread each villa's rooms so the phases carry similar load. */
const SPREAD: Record<string, Phase> = { 1: 'L1', 5: 'L1', 2: 'L2', 6: 'L2', 3: 'L3', 4: 'L3' };
const spread = (l: Level): Level => ({ ...l, circuits: l.circuits.map(c => ({ ...c, phase: SPREAD[c.id.slice(1)] })) });
const board = (sim: Simulator, id: string) => sim.result().boards.find(b => b.id === id)!;

describe('cableDropV', () => {
  it('counts both conductors on single-phase and one on three-phase', () => {
    expect(cableDropV(10, 2.5, 20, 1)).toBeCloseTo(3.6);
    expect(cableDropV(10, 2.5, 20, 3)).toBeCloseTo(1.8);
    expect(cableDropV(10, 2.5, 0, 1)).toBe(0);
  });
});

describe('parseLevel, board format', () => {
  it('reads the two-villa level', () => {
    const l = twoVillas();
    expect(l.boards.map(b => b.id)).toEqual(['FP', 'VA', 'VB']);
    expect(l.circuits).toHaveLength(12);
    expect(l.boards[2].cable).toEqual({ mm2: 10, lengthM: 85 });
    expect(l.points?.balance).toBe(150);
  });

  it('reports broken trees and bad circuits', () => {
    const raw = {
      project: 'x', supply: { voltage: 230 },
      boards: [
        { id: 'A', parent: null, breakerA: 100, phases: 3 },
        { id: 'B', parent: null, breakerA: 63 },
        { id: 'C', parent: 'Z', breakerA: 63, cable: { mm2: 10, lengthM: 5 } },
        { id: 'D', parent: 'A', breakerA: 63 },
        { id: 'GRID', parent: 'A', breakerA: 63, cable: { mm2: 10, lengthM: 5 } },
      ],
      circuits: [
        { id: 'X1', board: 'Q', room: 'R', type: 'ac', kw: 1, breakerA: 10 },
        { id: 'X2', board: 'A', room: 'R', type: 'ac', kw: 1, breakerA: 10, phase: 'L4' },
      ],
    };
    try { parseLevel(raw); expect.unreachable(); } catch (e) {
      const p = (e as LevelError).problems.join('\n');
      expect(p).toMatch(/exactly one board must have parent null/);
      expect(p).toMatch(/board C: parent "Z" does not exist/);
      expect(p).toMatch(/board D: needs a feeder cable/);
      expect(p).toMatch(/"GRID" is reserved/);
      expect(p).toMatch(/circuits\[0\]\.board/);
      expect(p).toMatch(/circuits\[1\]\.phase/);
    }
  });

  it('rejects boards whose parents loop', () => {
    const raw = {
      project: 'x', supply: { voltage: 230 },
      boards: [
        { id: 'T', parent: null, breakerA: 100 },
        { id: 'A', parent: 'B', breakerA: 63, cable: { mm2: 10, lengthM: 5 } },
        { id: 'B', parent: 'A', breakerA: 63, cable: { mm2: 10, lengthM: 5 } },
      ],
      circuits: [{ id: 'X', board: 'T', room: 'R', type: 'ac', kw: 1, breakerA: 10 }],
    };
    expect(() => parseLevel(raw)).toThrow(/parents form a loop/);
  });
});

describe('transformer', () => {
  const village = (): Level =>
    parseLevel(JSON.parse(readFileSync(new URL('../../public/data/village.json', import.meta.url), 'utf8')));
  /** Every home and every room spread over the three phases. */
  function spreadVillage(kva: number): Level {
    const l = village();
    l.transformer!.kva = kva;
    const ph: Phase[] = ['L1', 'L2', 'L3'];
    ['H1', 'H2', 'H3', 'H4', 'H5', 'H6'].forEach((id, i) => { l.boards.find(b => b.id === id)!.phase = ph[i % 3]; });
    l.circuits.filter(c => c.board === 'SCH' || c.board === 'SHP').forEach((c, i) => { c.phase = ph[i % 3]; });
    return l;
  }

  it('gives each phase a third of its size', () => {
    expect(transformerRatedAmps(100, 230)).toBeCloseTo(144.9, 1);
  });

  it('sits between the grid and the top board', () => {
    const net = levelNetwork(village());
    expect(net.nodes.find(n => n.id === TRANSFORMER_ID)).toMatchObject({ kind: 'transformer', parent: GRID_ID });
    expect(net.nodes.find(n => n.id === 'MAIN')!.parent).toBe(TRANSFORMER_ID);
    expect(levelNetwork(twoVillas()).nodes.find(n => n.id === 'FP')!.parent).toBe(GRID_ID);
  });

  it('reads the busiest phase as its loading, so spreading the load frees it up', () => {
    const r = new Simulator(spreadVillage(100), 12).result().transformer!;
    const onL1 = new Simulator({ ...village(), transformer: { name: 'T', kva: 100 } }, 12).result().transformer!;
    expect(r.loadKva).toBeCloseTo(onL1.loadKva);
    expect(r.loading).toBeLessThan(0.8);
    expect(onL1.loading).toBeGreaterThan(1.3);
  });

  it('overheats slower than a breaker, then cuts everything off', () => {
    const l = spreadVillage(50);
    const sim = new Simulator(l, 12);
    sim.advance(0.05);
    expect(sim.result().transformer!.tripped).toBe(false);
    sim.advance(3);
    const r = sim.result();
    expect(r.transformer!.tripped).toBe(true);
    expect(r.circuits.every(c => c.dead)).toBe(true);
    expect(r.main.tripped).toBe(false); // the main breaker itself never opened
    expect(r.transformer!.amps).toBe(0);
  });

  it('adds its own voltage drop as it loads up', () => {
    const small = new Simulator(spreadVillage(100), 12).result();
    const big = new Simulator(spreadVillage(160), 12).result();
    expect(small.main.vdPct).toBeCloseTo(small.transformer!.loading * 2);
    expect(big.main.vdPct).toBeLessThan(small.main.vdPct);
  });

  it('limits short-circuit current more when it is smaller', () => {
    const at = (kva: number) => new Simulator(spreadVillage(kva)).faultAmps('H1-1');
    expect(at(50)).toBeLessThan(at(160));
    expect(transformerOhms(100, 230)).toBeCloseTo(0.0635, 3);
  });

  it('leaves levels without a transformer as they were', () => {
    const r = new Simulator(twoVillas(), 12).result();
    expect(r.transformer).toBeNull();
    expect(r.main.vdPct).toBe(0);
  });

  it('reports a bad transformer in a level file', () => {
    const raw = {
      project: 'x', supply: { voltage: 230 }, transformer: { kva: 0 },
      boards: [{ id: 'TX', parent: null, breakerA: 100, phases: 1 }],
      circuits: [{ id: 'TX', board: 'TX', room: 'R', type: 'shop', kw: 1, breakerA: 10 }],
    };
    expect(() => parseLevel(raw)).toThrow(/transformer\.kva/);
    expect(() => parseLevel(raw)).toThrow(/top board must be three-phase/);
    expect(() => parseLevel(raw)).toThrow(/boards\[0\]\.id: "TX" is reserved/);
  });
});

describe('load profiles for shops and schools', () => {
  it('have the school busy in the morning and the shop open into the evening', () => {
    expect(profileAt('school', 10)).toBeGreaterThan(0.9);
    expect(profileAt('school', 19)).toBeLessThan(0.1);
    expect(profileAt('shop', 18)).toBeGreaterThan(0.9);
    expect(profileAt('shop', 3)).toBeLessThan(0.2);
  });
});

describe('Simulator, three-phase boards', () => {
  it('puts every room on L1 when that is how they are wired', () => {
    const sim = new Simulator(twoVillas(), 18);
    const va = board(sim, 'VA');
    expect(va.phaseAmps[1]).toBe(0);
    expect(va.phaseAmps[2]).toBe(0);
    expect(va.imbalance).toBe(1);
    expect(board(sim, 'FP').phaseAmps[0]).toBeCloseTo(va.phaseAmps[0] * 2);
  });

  it('shares the load across phases once the rooms are spread', () => {
    const sim = new Simulator(spread(twoVillas()), 18);
    const va = board(sim, 'VA');
    expect(Math.min(...va.phaseAmps)).toBeGreaterThan(10);
    expect(va.imbalance).toBeLessThan(0.25);
  });

  it('builds voltage drop from the supply to the room', () => {
    const r = new Simulator(twoVillas(), 18).result();
    const vb = r.boards.find(b => b.id === 'VB')!, va = r.boards.find(b => b.id === 'VA')!;
    expect(r.main.vdPct).toBe(0);
    expect(vb.vdPct).toBeGreaterThan(va.vdPct); // longer, thinner feeder
    const b2 = r.circuits.find(c => c.id === 'B2')!;
    expect(b2.vdPct).toBeGreaterThan(vb.vdPct);
  });

  it('cuts only the rooms behind a tripped feeder breaker', () => {
    const l = spread(twoVillas());
    l.boards[2].breakerA = 16;
    const sim = new Simulator(l, 12);
    sim.advance(3);
    const r = sim.result();
    expect(r.boards.find(b => b.id === 'VB')!.tripped).toBe(true);
    expect(r.circuits.filter(c => c.board === 'VB').every(c => c.dead)).toBe(true);
    expect(r.circuits.filter(c => c.board === 'VA').some(c => c.dead)).toBe(false);
  });
});
