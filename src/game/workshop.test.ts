import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseLevel, type Level } from '../sim';
import { runDay } from './runDay';
import { scoreDay } from './score';
import { buildCost, coinsEarned, MISSIONS, newVillaBuild, powerOn, villaDesign, type Build, type PartKind, type PlacedPart, type VillaBuild } from './workshop';

const part = (id: string, kind: PartKind, breakerA?: number): PlacedPart => ({ id, kind, x: 0, y: 0, ...(breakerA && { breakerA }) });
/** Wires as "from to" or "from to mm2". */
const wires = (mm2: number, ...list: string[]) => list.map((l, i) => {
  const [from, to, size] = l.split(' ');
  return { id: `w${i}`, from, to, mm2: size ? Number(size) : mm2 };
});

describe('Level: single circuit', () => {
  const m = MISSIONS['level-circuit'];
  const parts = [part('B', 'battery'), part('S', 'switch'), part('L', 'lamp')];
  const build = (...list: string[]): Build => ({ parts, wires: wires(1.5, ...list) });

  it('gives 3 stars for a tidy loop through the switch', () => {
    const r = powerOn(m, build('B.a S.a', 'S.b L.a', 'L.b B.b'));
    expect(r.stars).toBe(3);
    expect(r.tip).toBeNull();
    expect(r.steps.map(s => s.lit)).toEqual([['L'], []]);
    expect(r.steps[0].amps).toBeCloseTo(1, 1);
  });

  it('works whichever way round the lamp and the battery are wired', () => {
    expect(powerOn(m, build('B.b S.b', 'S.a L.b', 'L.a B.a')).stars).toBe(3);
  });

  it('asks for the missing parts first', () => {
    const r = powerOn(m, { parts: [parts[0]], wires: [] });
    expect(r.stars).toBe(0);
    expect(r.steps).toHaveLength(0);
    expect(r.tip).toMatch(/switch and the lamp/);
  });

  it('explains an open loop', () => {
    const r = powerOn(m, build('B.a S.a', 'S.b L.a'));
    expect(r.stars).toBe(0);
    expect(r.tip).toMatch(/closed loop/);
    expect(r.focus).toBe('L');
  });

  it('catches a short circuit, even through the closed switch', () => {
    const direct = powerOn(m, build('B.a B.b'));
    expect(direct.tip).toMatch(/short circuit/);
    const throughSwitch = powerOn(m, build('B.a S.a', 'S.b B.b', 'B.a L.a', 'L.b B.b'));
    expect(throughSwitch.stars).toBe(0);
    expect(throughSwitch.tip).toMatch(/short circuit/);
  });

  it('gives 1 star when the switch is left out of the loop', () => {
    const r = powerOn(m, build('B.a L.a', 'L.b B.b', 'S.a S.b'));
    expect(r.stars).toBe(1);
    expect(r.steps[1].ok).toBe(false);
    expect(r.tip).toMatch(/Put the switch in the loop/);
  });

  it('holds back the third star for a spare wire', () => {
    const r = powerOn(m, { parts: [...parts], wires: wires(1.5, 'B.a S.a', 'S.b L.a', 'L.b B.b', 'L.a S.b') });
    expect(r.stars).toBe(3); // a doubled wire still carries current
    const dangling = powerOn(m, { parts: [...parts, part('X', 'lamp')], wires: wires(1.5, 'B.a S.a', 'S.b L.a', 'L.b B.b', 'L.a X.a') });
    expect(dangling.stars).toBe(2);
    expect(dangling.tip).toMatch(/carries no current/);
  });
});

describe('Level: one room', () => {
  const m = MISSIONS['level-room'];
  const room = (breakerA: number, mm2: number, ...extra: string[]): Build => ({
    parts: [part('G', 'supply'), part('K', 'breaker', breakerA), part('L', 'light'), part('P', 'socket')],
    wires: wires(mm2, 'G.a K.a', 'K.b L.a', 'K.b P.a', 'L.b G.b', 'P.b G.b', ...extra),
  });

  it('gives 3 stars for a 20 A breaker on 2.5 mm² cable', () => {
    const r = powerOn(m, room(20, 2.5));
    expect(r.stars).toBe(3);
    expect(r.steps.map(s => s.label)).toEqual(['Light on', 'Kettle on', 'Kettle lead shorts']);
    expect(r.steps[1].amps).toBeCloseTo(16, 0);
    expect(r.steps[2].open).toEqual(['K']);
    expect(r.steps[2].lit).toEqual([]); // the room's one breaker opened
    expect(buildCost(m, room(20, 2.5))).toBe(90);
  });

  it('trips an undersized breaker when the kettle goes on', () => {
    const r = powerOn(m, room(10, 2.5));
    expect(r.stars).toBe(0);
    expect(r.steps[1].open).toEqual(['K']);
    expect(r.tip).toMatch(/through a 10 A breaker/);
  });

  it('lets a breaker at exactly the load hold, but keeps the third star back', () => {
    const r = powerOn(m, room(16, 2.5));
    expect(r.stars).toBe(2);
    expect(r.tip).toMatch(/Keep normal peaks under 90 %/);
  });

  it('calls a breaker bigger than its cable unsafe', () => {
    const r = powerOn(m, room(20, 1.5));
    expect(r.stars).toBe(1);
    expect(r.tip).toMatch(/20 A breaker on 1.5 mm²/);
  });

  it('calls a room with no breaker unsafe, though everything works', () => {
    const r = powerOn(m, {
      parts: [part('G', 'supply'), part('L', 'light'), part('P', 'socket')],
      wires: wires(2.5, 'G.a L.a', 'G.a P.a', 'L.b G.b', 'P.b G.b'),
    });
    expect(r.stars).toBe(1);
    expect(r.steps[2].ok).toBe(false);
    expect(r.tip).toMatch(/Put a breaker between L and the socket/);
  });

  it('catches a breaker on the neutral side: it cuts the current but leaves the room live', () => {
    const r = powerOn(m, {
      parts: [part('G', 'supply'), part('K', 'breaker', 20), part('L', 'light'), part('P', 'socket')],
      wires: wires(2.5, 'G.a L.a', 'G.a P.a', 'L.b K.a', 'P.b K.a', 'K.b G.b'),
    });
    expect(r.stars).toBe(1);
    expect(r.tip).toMatch(/Put breakers on the L side/);
  });

  it('catches a light with no protection beside a protected socket', () => {
    const r = powerOn(m, {
      parts: [part('G', 'supply'), part('K', 'breaker', 20), part('L', 'light'), part('P', 'socket')],
      wires: wires(2.5, 'G.a K.a', 'K.b P.a', 'P.b G.b', 'G.a L.a', 'L.b G.b'),
    });
    expect(r.stars).toBe(1);
    expect(r.tip).toMatch(/Room light stays live/);
  });

  it('accepts two breakers with thinner cable for the light', () => {
    const r = powerOn(m, {
      parts: [part('G', 'supply'), part('K1', 'breaker', 6), part('K2', 'breaker', 20), part('L', 'light'), part('P', 'socket')],
      wires: wires(2.5, 'G.a K1.a 1.5', 'K1.b L.a 1.5', 'L.b G.b 1.5', 'G.a K2.a', 'K2.b P.a', 'P.b G.b'),
    });
    expect(r.stars).toBe(3);
    expect(r.steps[2].open).toEqual(['K2']);
    expect(r.steps[2].lit).toEqual(['L']); // only the faulty circuit goes off
  });

  it('notices loads wired in a line', () => {
    const r = powerOn(m, {
      parts: [part('G', 'supply'), part('K', 'breaker', 20), part('L', 'light'), part('P', 'socket')],
      wires: wires(2.5, 'G.a K.a', 'K.b L.a', 'L.b P.a', 'P.b G.b'),
    });
    expect(r.stars).toBe(0);
    expect(r.tip).toMatch(/side by side/);
  });

  it('catches L touching N', () => {
    expect(powerOn(m, room(20, 2.5, 'G.a G.b')).tip).toMatch(/short circuit/);
  });

  it('keeps the third star back when over budget', () => {
    const m2 = { ...m, budget: 80 };
    const r = powerOn(m2, room(20, 2.5));
    expect(r.stars).toBe(2);
    expect(r.tip).toMatch(/90 credits against a budget of 80/);
  });
});

describe('Villa build', () => {
  const villa = (): Level => parseLevel(JSON.parse(readFileSync(new URL('../../public/data/villa.json', import.meta.url), 'utf8')));
  const SAFE: Record<string, [number, number]> = {
    C1: [6, 1.5], C2: [20, 2.5], C3: [6, 1.5], C4: [20, 2.5], C5: [20, 2.5], C6: [16, 2.5], C7: [10, 1.5], C8: [16, 2.5],
  };
  function complete(l: Level): VillaBuild {
    const b = newVillaBuild(l, 80, 6);
    b.boardPlaced = true;
    b.supplyWired = true;
    b.solarKw = 5;
    for (const c of l.circuits) b.rooms[c.id] = { breakerA: SAFE[c.id][0], mm2: SAFE[c.id][1] };
    return b;
  }

  it('says what to connect next, one thing at a time', () => {
    const l = villa();
    const b = newVillaBuild(l, 32, 6);
    expect(villaDesign(l, b).tip).toMatch(/Place the villa board/);
    b.boardPlaced = true;
    expect(villaDesign(l, b).tip).toMatch(/Wire the street supply/);
    b.supplyWired = true;
    expect(villaDesign(l, b).tip).toMatch(/8 rooms have no cable/);
    for (const c of l.circuits) b.rooms[c.id].mm2 = 2.5;
    b.rooms.C4.mm2 = null;
    expect(villaDesign(l, b).tip).toBe('Kitchen has no cable yet. Wire the board to every room.');
  });

  it('feeds the same day simulation and scoring, and a good build earns 3 stars', () => {
    const l = villa();
    const { design } = villaDesign(l, complete(l));
    expect(design!.boards[0]).toMatchObject({ breakerA: 80, solarKw: 5 });
    expect(design!.circuits.find(c => c.id === 'C6')).toMatchObject({ breakerA: 16, cableMm2: 2.5 });
    const card = scoreDay(design!, runDay(design!));
    expect(card.stars).toBe(3);
    expect(card.lessons.some(x => x.kind === 'mistake')).toBe(false);
  });

  it('gets the same honest result for a poor build, and leaves the level file untouched', () => {
    const l = villa();
    const b = complete(l);
    b.rooms.C6.breakerA = 6;
    const { design } = villaDesign(l, b);
    expect(scoreDay(design!, runDay(design!)).lessons.map(x => x.title)).toContain('Breaker too small: Bedroom 2');
    expect(l.circuits.find(c => c.id === 'C6')!.breakerA).toBe(10);
  });
});

describe('coinsEarned', () => {
  it('pays only for stars beyond the best so far', () => {
    expect(coinsEarned(0, 1)).toBe(20);
    expect(coinsEarned(0, 3)).toBe(60);
    expect(coinsEarned(1, 3)).toBe(40);
    expect(coinsEarned(3, 3)).toBe(0);
    expect(coinsEarned(3, 1)).toBe(0);
  });
});
