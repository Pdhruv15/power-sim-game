import { describe, expect, it } from 'vitest';
import { joinedPoints, solveCircuit, type Resistor, type Source } from './circuit';

const battery: Source = { id: 'B', plus: 'p', minus: 'm', volts: 12, ohms: 1e-3 };
const r = (id: string, a: string, b: string, ohms: number): Resistor => ({ id, a, b, ohms });

describe('solveCircuit', () => {
  it('gives voltage ÷ resistance around one closed loop', () => {
    const s = solveCircuit([r('L', 'p', 'm', 12)], [battery]);
    expect(s.amps.get('L')).toBeCloseTo(1, 3);
    expect(s.sourceAmps.get('B')).toBeCloseTo(1, 3);
    expect(s.volts.get('m')).toBe(0);
  });

  it('shares voltage in series and adds current in parallel', () => {
    const series = solveCircuit([r('A', 'p', 'x', 12), r('B', 'x', 'm', 12)], [battery]);
    expect(series.amps.get('A')).toBeCloseTo(0.5, 3);
    expect(series.volts.get('x')).toBeCloseTo(6, 2);
    const parallel = solveCircuit([r('A', 'p', 'm', 12), r('B', 'p', 'm', 12)], [battery]);
    expect(parallel.sourceAmps.get('B')).toBeCloseTo(2, 2);
  });

  it('passes no current through an open loop', () => {
    const s = solveCircuit([r('L', 'p', 'x', 12)], [battery]);
    expect(Math.abs(s.amps.get('L')!)).toBeLessThan(1e-6);
    expect(s.sourceAmps.get('B')).toBeCloseTo(0, 5);
  });

  it('lets the source resistance limit a short circuit', () => {
    const s = solveCircuit([r('W', 'p', 'm', 0.01)], [{ ...battery, ohms: 0.5 }]);
    expect(s.amps.get('W')).toBeCloseTo(12 / 0.51, 3);
  });

  it('runs current backwards through a part wired the other way round', () => {
    const s = solveCircuit([r('L', 'm', 'p', 12)], [battery]);
    expect(s.amps.get('L')).toBeCloseTo(-1, 3);
  });

  it('copes with parts cut off from the source, and with no source at all', () => {
    const island = solveCircuit([r('L', 'p', 'm', 12), r('X', 'u', 'v', 5)], [battery]);
    expect(island.amps.get('L')).toBeCloseTo(1, 3);
    expect(island.amps.get('X')).toBeCloseTo(0, 6);
    const none = solveCircuit([r('X', 'u', 'v', 5)], []);
    expect(none.amps.get('X')).toBeCloseTo(0, 6);
  });
});

describe('joinedPoints', () => {
  it('joins points through chains of links', () => {
    const joined = joinedPoints([['a', 'b'], ['b', 'c'], ['x', 'y']]);
    expect(joined('a', 'c')).toBe(true);
    expect(joined('a', 'x')).toBe(false);
    expect(joined('q', 'q')).toBe(true);
    expect(joined('q', 'a')).toBe(false);
  });
});
