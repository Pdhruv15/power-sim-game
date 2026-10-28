import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseVilla, type VillaData } from '../sim';
import { designCost, hhmm, peakNeeds, runDay, scoreDay } from './index';

const sample = (): VillaData =>
  parseVilla(JSON.parse(readFileSync(new URL('../../public/data/villa.json', import.meta.url), 'utf8')));

/** The sample level with its three mistakes fixed. */
function fixed(): VillaData {
  const d = sample();
  const set = (id: string, breakerA: number, cableMm2: number) => Object.assign(d.circuits.find(c => c.id === id)!, { breakerA, cableMm2 });
  set('C4', 20, 2.5); // kitchen cable was too small for its breaker
  set('C5', 20, 2.5); // master bedroom ran above 90 %
  set('C6', 16, 2.5); // bedroom 2 breaker tripped
  return d;
}
const score = (d: VillaData) => scoreDay(d, runDay(d));
const part = (d: VillaData, key: string) => score(d).parts.find(p => p.key === key)!.points;

describe('designCost', () => {
  it('adds breakers, cables, main breaker and solar', () => {
    expect(designCost(sample())).toBe(990);
    expect(designCost(fixed())).toBe(1010);
  });
});

describe('runDay', () => {
  it('records frames from 00:00 to 24:00', () => {
    const day = runDay(sample());
    expect(day.frames).toHaveLength(481);
    expect(day.frames[0].hour).toBe(0);
    expect(day.frames.at(-1)!.hour).toBeCloseTo(24);
  });
  it('logs the Bedroom 2 trip in the afternoon', () => {
    const day = runDay(sample());
    const trip = day.events.find(e => e.kind === 'trip')!;
    expect(trip.circuitId).toBe('C6');
    expect(trip.hour).toBeGreaterThan(12);
    expect(trip.hour).toBeLessThan(16);
    expect(day.energy.supplied).toBeLessThan(day.energy.demand);
  });
  it('supplies all demand when nothing trips', () => {
    const day = runDay(fixed());
    expect(day.tripHour.size).toBe(0);
    expect(day.energy.supplied).toBeCloseTo(day.energy.demand);
  });
});

describe('scoreDay', () => {
  it('gives the starting design 1 star with two mistakes and one warning', () => {
    const s = score(sample());
    expect(s.total).toBe(745);
    expect(s.stars).toBe(1);
    const titles = s.lessons.map(l => l.title);
    expect(titles).toContain('Breaker too small: Bedroom 2');
    expect(titles).toContain('Breaker bigger than the cable: Kitchen');
    expect(titles).toContain('Running close to the limit: Master Bedroom');
    expect(s.lessons[0].kind).toBe('mistake');
  });

  it('gives the fixed design 3 stars and flags the busy main breaker', () => {
    const s = score(fixed());
    expect(s.stars).toBe(3);
    expect(s.lessons.some(l => l.kind === 'mistake')).toBe(false);
    expect(s.lessons.map(l => l.title)).toContain('Main breaker overloaded');
  });

  it('gives full loading points once the main breaker is upsized', () => {
    const d = fixed();
    d.supply.mainBreakerA = 80;
    expect(part(d, 'loading')).toBe(150);
    expect(score(d).total).toBe(955);
  });

  it('takes 125 safety points per breaker bigger than its cable', () => {
    const d = fixed();
    Object.assign(d.circuits[0], { breakerA: 40, cableMm2: 1.5 });
    expect(part(d, 'safety')).toBe(125);
    Object.assign(d.circuits[1], { breakerA: 40, cableMm2: 1.5 });
    expect(part(d, 'safety')).toBe(0);
  });

  it('caps stars below 3 when there is a mistake', () => {
    const d = fixed();
    d.supply.mainBreakerA = 80;
    Object.assign(d.circuits[0], { breakerA: 20, cableMm2: 1.5 });
    expect(score(d).total).toBeGreaterThanOrEqual(750);
    expect(score(d).stars).toBe(2);
  });

  it('reduces cost points when over budget', () => {
    const d = sample();
    d.budget = 900; // 990 is 10 % over → 100 × (1 − 0.4)
    expect(part(d, 'cost')).toBe(60);
    expect(score(d).lessons.map(l => l.title)).toContain('Over budget');
  });

  it('explains a main breaker trip', () => {
    const d = fixed();
    d.supply.mainBreakerA = 20;
    const s = score(d);
    expect(s.lessons[0].title).toBe('Main breaker too small');
    expect(s.stars).toBeLessThan(2);
  });

  it('gives no solar points without panels', () => {
    const d = fixed();
    d.solarKw = 0;
    expect(part(d, 'solar')).toBe(0);
    expect(score(d).lessons.map(l => l.title)).not.toContain('Solar helped');
  });
});

describe('hhmm', () => {
  it('formats times and the end of the day', () => {
    expect(hhmm(13.5)).toBe('13:30');
    expect(hhmm(24)).toBe('24:00');
  });
});

describe('peakNeeds', () => {
  it('finds each room peak and the whole-villa peak', () => {
    const { circuits, total } = peakNeeds(sample());
    const bed2 = circuits.get('C6')!;
    expect(bed2.amps).toBeCloseTo(11.59, 1);
    expect(bed2.hour).toBe(15);
    expect(circuits.get('C1')!.hour).toBe(20);
    expect(total.amps).toBeGreaterThan(50);
  });
});
