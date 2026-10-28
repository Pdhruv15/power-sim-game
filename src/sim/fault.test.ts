import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { BOARD_INSTANT_TRIP, NEW_BREAKER, parseLevel, Simulator, stepBreaker, type Level } from './index';

const building = (): Level =>
  parseLevel(JSON.parse(readFileSync(new URL('../../public/data/building.json', import.meta.url), 'utf8')));
const flat = (l: Level, id: string) => l.boards.find(b => b.id === id)!;

describe('board breakers', () => {
  it('trip at once from 10 × rating, room breakers from 5 ×', () => {
    expect(stepBreaker(NEW_BREAKER, 6, 0).tripped).toBe(true);
    expect(stepBreaker(NEW_BREAKER, 6, 0, BOARD_INSTANT_TRIP).tripped).toBe(false);
    expect(stepBreaker(NEW_BREAKER, 10, 0, BOARD_INSTANT_TRIP).tripped).toBe(true);
  });
});

describe('short circuits', () => {
  it('works out the current from the supply and every cable on the way', () => {
    const l = building();
    expect(new Simulator(l).faultAmps('2B-3')).toBeCloseTo(518, -1);
    flat(l, '2B').cable = { mm2: 16, lengthM: 20 };
    expect(new Simulator(l).faultAmps('2B-3')).toBeCloseTo(561, -1); // thicker feeder, more fault current
  });

  it('opens the flat breaker too when the fault reaches its instant trip', () => {
    const f = new Simulator(building()).fault('2B-3');
    expect(f.instant).toBe(true);
    expect(f.tripped).toEqual(['2B-3', '2B']);
    expect(f.selective).toBe(false);
  });

  it('opens only the room breaker when the flat breaker is big enough', () => {
    const l = building();
    Object.assign(flat(l, '2B'), { breakerA: 63, cable: { mm2: 16, lengthM: 20 } });
    const sim = new Simulator(l);
    const f = sim.fault('2B-3');
    expect(f.tripped).toEqual(['2B-3']);
    expect(f.selective).toBe(true);
    const r = sim.result();
    expect(r.circuits.find(c => c.id === '2B-3')!.tripped).toBe(true);
    expect(r.circuits.find(c => c.id === '2B-1')!.dead).toBe(false);
  });

  it('clears slowly when a long thin cable keeps the fault current low', () => {
    const l = building();
    Object.assign(l.circuits.find(c => c.id === '2B-3')!, { cableMm2: 1.5, lengthM: 120 });
    const f = new Simulator(l).fault('2B-3');
    expect(f.amps).toBeLessThan(100);
    expect(f.instant).toBe(false);
    expect(f.tripped).toEqual(['2B-3']);
    expect(f.seconds).toBeGreaterThan(1);
  });
});

describe('single-phase boards on a three-phase riser', () => {
  it('load the phase they are connected to', () => {
    const l = building();
    flat(l, '1B').phase = 'L2';
    const f1 = new Simulator(l, 18).result().boards.find(b => b.id === 'F1')!;
    expect(f1.phaseAmps[1]).toBeGreaterThan(0);
    expect(f1.phaseAmps[0]).toBeGreaterThan(f1.phaseAmps[1]); // 1A and 1C still on L1
  });
});

describe('parseLevel, faults and board phases', () => {
  it('reads the building level', () => {
    const l = building();
    expect(l.boards).toHaveLength(9);
    expect(l.circuits).toHaveLength(18);
    expect(l.sourceOhms).toBe(0.12);
    expect(l.faults).toEqual([{ hour: 19.5, circuit: '2B-3', text: 'A kettle lead shorts in the kitchen of flat 2B' }]);
    expect(flat(l, '2B').floor).toBe(1);
  });

  it('rejects bad faults and phases', () => {
    const raw = JSON.parse(readFileSync(new URL('../../public/data/building.json', import.meta.url), 'utf8'));
    raw.faults = [{ hour: 25, circuit: 'nope' }];
    raw.boards[3].phase = 'L5';
    expect(() => parseLevel(raw)).toThrow(/faults\[0\]\.hour[\s\S]*faults\[0\]\.circuit|faults\[0\]\.circuit[\s\S]*faults\[0\]\.hour/);
    expect(() => parseLevel(raw)).toThrow(/boards\[3\]\.phase/);
  });
});
