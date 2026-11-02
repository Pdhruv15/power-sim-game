import { describe, expect, it } from 'vitest';
import { firstStartHour, LOAD_LIBRARY, runningAmps, startAmps, tripsAtStart } from './loads';
import { POWER_FACTOR, PROFILES } from './profiles';
import { parseLevel } from './parse';
import { Simulator } from './simulate';
import { LOAD_TYPES } from './types';

describe('load library', () => {
  it('describes every load type, with a full day of demand that reaches 100 %', () => {
    for (const type of LOAD_TYPES) {
      expect(LOAD_LIBRARY[type].type).toBe(type);
      expect(LOAD_LIBRARY[type].note.length).toBeGreaterThan(0);
      expect(POWER_FACTOR[type]).toBeGreaterThan(0);
      expect(PROFILES[type]).toHaveLength(24);
      expect(Math.max(...PROFILES[type])).toBeLessThanOrEqual(1);
    }
  });

  it('works out running and starting current', () => {
    expect(runningAmps(3, 'pump', 230)).toBeCloseTo(15.35, 1);
    expect(startAmps(3, 'pump', 230)).toBeCloseTo(92.1, 0);
    expect(startAmps(3, 'heater', 230)).toBeCloseTo(runningAmps(3, 'heater', 230));
  });

  it('trips a breaker at once only from its instant level', () => {
    expect(tripsAtStart(92, 16)).toBe(true);  // opens from 80 A
    expect(tripsAtStart(92, 20)).toBe(false); // opens from 100 A
    expect(tripsAtStart(100, 20)).toBe(true);
  });

  it('starts surging loads when their demand first rises, and no others', () => {
    expect(firstStartHour('pump')).toBe(6);
    expect(firstStartHour('lift')).toBe(7);
    expect(firstStartHour('heater')).toBeNull();
    expect(firstStartHour('ac')).toBeNull();
  });
});

describe('starting a motor', () => {
  const level = (pumpA: number, mainA = 63) => parseLevel({
    id: 'x', title: 'x', project: 'x', orientation: 0, supply: { voltage: 230 },
    boards: [{ id: 'B', name: 'Board', parent: null, breakerA: mainA, phases: 3 }],
    circuits: [{ id: 'P', board: 'B', room: 'Pump', type: 'pump', kw: 3, breakerA: pumpA, cableMm2: 2.5, lengthM: 10, phase: 'L1' }],
  });

  it('opens a breaker the surge reaches', () => {
    const sim = new Simulator(level(16));
    expect(sim.startMotor('P')).toMatchObject({ circuit: 'P', tripped: ['P'] });
    expect(sim.result().circuits[0].tripped).toBe(true);
  });

  it('leaves a big enough breaker closed', () => {
    const sim = new Simulator(level(20));
    expect(sim.startMotor('P').tripped).toEqual([]);
    expect(sim.result().circuits[0].tripped).toBe(false);
  });

  it('opens a board breaker too small for the surge', () => {
    const sim = new Simulator(level(20, 6));
    expect(sim.startMotor('P').tripped).toEqual(['B']);
  });

  it('does nothing when the motor has no power to start with', () => {
    const sim = new Simulator(level(16));
    sim.startMotor('P');
    expect(sim.startMotor('P').tripped).toEqual([]);
  });
});
