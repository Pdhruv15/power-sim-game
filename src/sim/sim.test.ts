import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  bandOf, branchCurrents, INSTANT_TRIP, LevelError, NEW_BREAKER, parseVilla, profileAt, pvOutput,
  Simulator, stepBreaker, sunAt, villaNetwork, type BreakerState, type VillaData,
} from './index';

const sample = (): VillaData =>
  parseVilla(JSON.parse(readFileSync(new URL('../../public/data/villa.json', import.meta.url), 'utf8')));
const circuit = (sim: Simulator, id: string) => sim.result().circuits.find(c => c.id === id)!;

describe('profiles', () => {
  it('peaks AC in the afternoon and lighting in the evening', () => {
    expect(profileAt('ac', 15)).toBe(1);
    expect(profileAt('lighting', 20)).toBe(1);
    expect(profileAt('lighting', 13)).toBeLessThan(0.1);
  });
  it('interpolates between hours and wraps midnight', () => {
    expect(profileAt('ac', 14.5)).toBeCloseTo(0.99);
    expect(profileAt('sockets', 23.5)).toBeCloseTo((0.25 + 0.15) / 2);
    expect(profileAt('ac', 24)).toBe(profileAt('ac', 0));
  });
});

describe('sun and solar', () => {
  it('rises east, is highest at noon and sets west', () => {
    expect(sunAt(6).elevation).toBeCloseTo(0);
    expect(sunAt(6).azimuth).toBeCloseTo(Math.PI / 2);
    expect(sunAt(12).elevation * 180 / Math.PI).toBeCloseTo(55);
    expect(sunAt(18).azimuth).toBeCloseTo(1.5 * Math.PI);
    expect(sunAt(0).elevation).toBeLessThan(0);
  });
  it('gives no PV at night and kWp × 0.85 at noon', () => {
    expect(pvOutput(5, sunAt(2))).toBe(0);
    expect(pvOutput(5, sunAt(12))).toBeCloseTo(4.25);
  });
});

describe('breaker', () => {
  const run = (loading: number, hours: number, from: BreakerState = NEW_BREAKER) => {
    let s = from;
    for (let t = 0; t < hours; t += 0.01) s = stepBreaker(s, loading, 0.01);
    return s;
  };
  it('never trips at or below rating', () => expect(run(1, 24).tripped).toBe(false));
  it('trips a 10 % overload after about an hour', () => {
    expect(run(1.1, 0.9).tripped).toBe(false);
    expect(run(1.1, 1.1).tripped).toBe(true);
  });
  it('trips a 50 % overload within 5 minutes', () => expect(run(1.5, 5 / 60).tripped).toBe(true));
  it('trips at once on a short circuit and stays off', () => {
    const s = stepBreaker(NEW_BREAKER, INSTANT_TRIP, 0);
    expect(s.tripped).toBe(true);
    expect(stepBreaker(s, 0, 1).tripped).toBe(true);
  });
  it('cools down below rating', () => {
    const warm = run(1.1, 0.5);
    expect(run(0.5, 1, warm).heat).toBe(0);
  });
});

describe('network', () => {
  it('sums load currents up to the main board and supply', () => {
    const net = villaNetwork(sample());
    const flow = branchCurrents(net, new Map([['C1', 2], ['C2', 3], ['DB', -1]]));
    expect(flow.get('DB')).toBe(4);
    expect(flow.get('GRID')).toBe(4);
    expect(flow.get('C1')).toBe(2);
  });
});

describe('parseVilla', () => {
  it('accepts the sample file', () => {
    const v = sample();
    expect(v.circuits).toHaveLength(8);
    expect(v.budget).toBe(1100);
    expect(v.circuits[3].cableMm2).toBe(1.5);
  });
  it('defaults the cable to 2.5 mm² and rejects unknown sizes', () => {
    const base = { project: 'x', supply: { voltage: 230, mainBreakerA: 63 }, circuits: [{ id: 'A', room: 'R', type: 'ac', kw: 1, breakerA: 10 }] };
    expect(parseVilla(base).circuits[0].cableMm2).toBe(2.5);
    const bad = { ...base, circuits: [{ ...base.circuits[0], cableMm2: 3 }] };
    expect(() => parseVilla(bad)).toThrow(/cableMm2/);
  });
  it('lists every problem', () => {
    const bad = { project: 'x', supply: { voltage: 230 }, circuits: [
      { id: 'A', room: 'R', type: 'heater', kw: 1, breakerA: 10 },
      { id: 'A', room: 'R', type: 'ac', kw: -1, breakerA: 10 },
    ] };
    try { parseVilla(bad); expect.unreachable(); } catch (e) {
      expect(e).toBeInstanceOf(LevelError);
      const p = (e as LevelError).problems.join('\n');
      expect(p).toMatch(/mainBreakerA/);
      expect(p).toMatch(/circuits\[0\]\.type/);
      expect(p).toMatch(/"A" is used twice/);
      expect(p).toMatch(/circuits\[1\]\.kw/);
    }
  });
});

describe('Simulator', () => {
  it('bands follow the 60 % / 90 % limits', () => {
    expect(bandOf(0.59)).toBe('ok');
    expect(bandOf(0.6)).toBe('warn');
    expect(bandOf(0.91)).toBe('high');
  });

  it('shows the 15:00 sample state', () => {
    const r = new Simulator(sample(), 15).result();
    expect(r.loadKw).toBeCloseTo(10.86, 1);
    expect(r.solarKw).toBeCloseTo(3.26, 1);
    expect(r.gridKw).toBeCloseTo(r.loadKw - r.solarKw);
    expect(r.circuits.find(c => c.id === 'C5')!.band).toBe('high');
    expect(r.circuits.find(c => c.id === 'C6')!.overloaded).toBe(true);
  });

  it('trips the overloaded Bedroom 2 AC during the afternoon and resets on request', () => {
    const sim = new Simulator(sample(), 12);
    sim.advance(4);
    const c6 = circuit(sim, 'C6');
    expect(c6.tripped).toBe(true);
    expect(c6.amps).toBe(0);
    expect(circuit(sim, 'C5').tripped).toBe(false);
    sim.resetBreakers();
    expect(circuit(sim, 'C6').tripped).toBe(false);
  });

  it('runs a normal day with no trips when nothing is overloaded', () => {
    const data = sample();
    data.circuits = data.circuits.filter(c => c.id !== 'C6');
    const sim = new Simulator(data, 0);
    sim.advance(24);
    expect(sim.result().circuits.some(c => c.tripped)).toBe(false);
  });

  it('cuts every circuit and the solar when the main breaker trips', () => {
    const data = sample();
    data.supply.mainBreakerA = 20;
    const sim = new Simulator(data, 19);
    sim.advance(1);
    const r = sim.result();
    expect(r.main.tripped).toBe(true);
    expect(r.loadKw).toBe(0);
    expect(r.solarKw).toBe(0);
    expect(r.circuits.every(c => c.dead)).toBe(true);
  });

  it('exports to the grid when solar exceeds the load', () => {
    const data = sample();
    data.solarKw = 20;
    const r = new Simulator(data, 11).result();
    expect(r.gridKw).toBeLessThan(0);
  });
});
