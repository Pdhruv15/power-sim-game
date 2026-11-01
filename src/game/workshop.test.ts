import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseLevel, type Level, type Phase } from '../sim';
import { runDay } from './runDay';
import { scoreDay } from './score';
import { buildCost, coinsEarned, MISSIONS, newSiteBuild, powerOn, siteDesign, wireConductor, type Build, type PartKind, type PlacedPart, type SiteBuild } from './workshop';

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

  it('holds back the third star for a switch or lamp wired the wrong way round', () => {
    const sw = powerOn(m, build('B.a S.b', 'S.a L.a', 'L.b B.b'));
    expect(sw.stars).toBe(2);
    expect(sw.tip).toMatch(/switch is the wrong way round/);
    expect(sw.focus).toBe('S');
    const lamp = powerOn(m, build('B.a S.a', 'S.b L.b', 'L.a B.b'));
    expect(lamp.stars).toBe(2);
    expect(lamp.tip).toMatch(/lamp is the wrong way round/);
  });
});

describe('Level: one room, from a distribution board', () => {
  const m = MISSIONS['level-room'];
  const LIGHT = ['mcb2.b A.a 1.5', 'nbar.b A.b 1.5', 'ebar.b A.c 1.5'];
  const SOCKET = ['mcb1.b C.a', 'nbar.b C.b', 'ebar.b C.c'];
  const room = (socketA: number, lightA: number, ...list: string[]): Build => ({
    parts: [
      ...m.start.parts.map(p => (p.id === 'mcb1' ? { ...p, breakerA: socketA } : p.id === 'mcb2' ? { ...p, breakerA: lightA } : p)),
      part('A', 'light'), part('C', 'socket'),
    ],
    wires: [...m.start.wires, ...wires(2.5, ...list)],
  });

  it('gives 3 stars for a breaker each, thinner cable on the light, and both loads earthed', () => {
    const b = room(20, 6, ...LIGHT, ...SOCKET);
    const r = powerOn(m, b);
    expect(r.stars).toBe(3);
    expect(r.tip).toBeNull();
    expect(r.steps.map(s => s.label)).toEqual(['Light on', 'Kettle on', 'Kettle lead shorts']);
    expect(r.steps[1].amps).toBeCloseTo(16, 0);
    expect(buildCost(m, b)).toBe(105);
  });

  it('opens only the faulty circuit, so the light stays on', () => {
    const r = powerOn(m, room(20, 6, ...LIGHT, ...SOCKET));
    expect(r.steps[2].open).toEqual(['mcb1']);
    expect(r.steps[2].lit).toEqual(['A']);
  });

  it('does not charge for what comes with the board', () => {
    expect(buildCost(m, m.start)).toBe(30); // the two breakers
  });

  it('trips an undersized breaker when the kettle goes on', () => {
    const r = powerOn(m, room(10, 6, ...LIGHT, ...SOCKET));
    expect(r.stars).toBe(0);
    expect(r.steps[1].open).toEqual(['mcb1']);
    expect(r.tip).toMatch(/through a 10 A breaker/);
  });

  it('lets a breaker close to its load hold, but keeps the third star back', () => {
    const r = powerOn(m, room(16, 6, ...LIGHT, ...SOCKET));
    expect(r.stars).toBe(2);
    expect(r.tip).toMatch(/Keep normal peaks under 90 %/);
  });

  it('calls a breaker bigger than its cable unsafe', () => {
    const r = powerOn(m, room(20, 6, ...LIGHT, 'mcb1.b C.a 1.5', 'nbar.b C.b 1.5', 'ebar.b C.c 1.5'));
    expect(r.stars).toBe(1);
    expect(r.tip).toMatch(/20 A breaker on 1.5 mm²/);
  });

  it('counts a load with no earth as unsafe, though it works', () => {
    const r = powerOn(m, room(20, 6, ...LIGHT, 'mcb1.b C.a', 'nbar.b C.b'));
    expect(r.stars).toBe(1);
    expect(r.tip).toMatch(/Connect E on the socket and kettle to the E bar/);
    expect(r.focus).toBe('C');
  });

  it('refuses earth joined to live or neutral', () => {
    expect(powerOn(m, room(20, 6, ...LIGHT, ...SOCKET, 'mcb1.b ebar.b')).tip).toMatch(/Earth is joined to L or N/);
    expect(powerOn(m, room(20, 6, ...LIGHT, ...SOCKET, 'nbar.b ebar.b')).stars).toBe(0);
    expect(powerOn(m, room(20, 6, ...LIGHT, 'mcb1.b C.a', 'nbar.b C.b', 'mcb1.b C.c')).stars).toBe(0);
  });

  it('counts a load with L and N swapped as unsafe', () => {
    const r = powerOn(m, room(20, 6, 'mcb2.b A.b 1.5', 'nbar.b A.a 1.5', 'ebar.b A.c 1.5', ...SOCKET));
    expect(r.stars).toBe(1);
    expect(r.tip).toMatch(/stay live/);
    expect(r.focus).toBe('A');
  });

  it('holds back the third star when two loads share a breaker', () => {
    const r = powerOn({ ...m, budget: 200 }, room(20, 6, 'mcb1.b A.a', 'nbar.b A.b', 'ebar.b A.c', ...SOCKET));
    expect(r.stars).toBe(2);
    expect(r.tip).toMatch(/Two wires share one connection/);
  });

  it('catches a load wired straight to the L bar, past its breaker', () => {
    const r = powerOn(m, room(20, 6, 'lbar.a A.a 1.5', 'nbar.b A.b 1.5', 'ebar.b A.c 1.5', ...SOCKET));
    expect(r.stars).toBe(1);
    expect(r.tip).toMatch(/Room light stays live/);
  });

  it('notices loads wired in a line', () => {
    const r = powerOn(m, room(20, 6, 'mcb1.b A.a', 'A.b C.a', 'nbar.b C.b', 'ebar.b A.c', 'ebar.b C.c'));
    expect(r.stars).toBe(0);
    expect(r.tip).toMatch(/side by side/);
  });

  it('treats a bar as one piece of metal, so L to the N bar is a short circuit', () => {
    expect(powerOn(m, room(20, 6, ...LIGHT, ...SOCKET, 'mcb1.b nbar.b')).tip).toMatch(/short circuit/);
  });

  it('keeps the third star back when over budget', () => {
    const r = powerOn(m, room(20, 6, 'mcb2.b A.a', 'nbar.b A.b', 'ebar.b A.c', ...SOCKET));
    expect(r.stars).toBe(2);
    expect(r.tip).toMatch(/120 credits against a budget of 110/);
  });

  it('says which conductor each wire belongs to', () => {
    const b = room(20, 6, ...LIGHT, ...SOCKET);
    const of = (from: string) => wireConductor(b, b.wires.find(w => w.from === from)!);
    expect([of('mcb2.b'), of('nbar.b'), of('ebar.b')]).toEqual(['L', 'N', 'E']);
  });
});

describe('Villa build', () => {
  const villa = (): Level => parseLevel(JSON.parse(readFileSync(new URL('../../public/data/villa.json', import.meta.url), 'utf8')));
  const SAFE: Record<string, [number, number]> = {
    C1: [6, 1.5], C2: [20, 2.5], C3: [6, 1.5], C4: [20, 2.5], C5: [20, 2.5], C6: [16, 2.5], C7: [10, 1.5], C8: [16, 2.5],
  };
  function complete(l: Level): SiteBuild {
    const b = newSiteBuild(l, 80, 6);
    b.boards.DB.placed = true;
    b.supplyWired = true;
    b.solarKw = 5;
    for (const c of l.circuits) b.rooms[c.id] = { breakerA: SAFE[c.id][0], mm2: SAFE[c.id][1], phase: 'L1' };
    return b;
  }

  it('says what to connect next, one thing at a time', () => {
    const l = villa();
    const b = newSiteBuild(l, 32, 6);
    expect(siteDesign(l, b).tip).toMatch(/Place the Villa DB/);
    b.boards.DB.placed = true;
    expect(siteDesign(l, b).tip).toMatch(/Wire the street supply/);
    b.supplyWired = true;
    expect(siteDesign(l, b).tip).toMatch(/8 rooms have no cable/);
    for (const c of l.circuits) b.rooms[c.id].mm2 = 2.5;
    b.rooms.C4.mm2 = null;
    expect(siteDesign(l, b).tip).toBe('Kitchen has no cable yet. Wire each board to its rooms.');
  });

  it('feeds the same day simulation and scoring, and a good build earns 3 stars', () => {
    const l = villa();
    const { design } = siteDesign(l, complete(l));
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
    const { design } = siteDesign(l, b);
    expect(scoreDay(design!, runDay(design!)).lessons.map(x => x.title)).toContain('Breaker too small: Bedroom 2');
    expect(l.circuits.find(c => c.id === 'C6')!.breakerA).toBe(10);
  });
});

describe('Street build (two villas)', () => {
  const street = (): Level => parseLevel(JSON.parse(readFileSync(new URL('../../public/data/two-villas.json', import.meta.url), 'utf8')));
  const SPREAD: Record<string, Phase> = { 1: 'L1', 5: 'L1', 2: 'L2', 6: 'L2', 3: 'L3', 4: 'L3' };
  function complete(l: Level): SiteBuild {
    const b = newSiteBuild(l, 32, 6);
    b.supplyWired = true;
    b.boards.FP = { placed: true, breakerA: 100, mm2: null };
    b.boards.VA = { placed: true, breakerA: 63, mm2: 16 };
    b.boards.VB = { placed: true, breakerA: 40, mm2: 10 };
    for (const c of l.circuits) b.rooms[c.id] = { breakerA: c.breakerA, mm2: c.cableMm2, phase: SPREAD[c.id.slice(1)] };
    return b;
  }

  it('asks for each board and feeder in turn', () => {
    const l = street();
    const b = newSiteBuild(l, 32, 6);
    expect(siteDesign(l, b).tip).toMatch(/Place the Feeder pillar/);
    b.boards.FP.placed = true;
    expect(siteDesign(l, b).tip).toMatch(/Place the Villa A/);
    b.boards.VA.placed = b.boards.VB.placed = true;
    b.supplyWired = true;
    expect(siteDesign(l, b).tip).toBe('Villa A has no feeder cable yet. Wire it from the board above it.');
  });

  it('gives full marks for spread phases and safe feeders', () => {
    const l = street();
    const { design } = siteDesign(l, complete(l));
    expect(design!.boards.find(x => x.id === 'VB')!.cable).toEqual({ mm2: 10, lengthM: 85 }); // the length stays the level's
    const card = scoreDay(design!, runDay(design!));
    expect(card.total).toBe(1000);
    expect(card.stars).toBe(3);
  });

  it('shows the phase lesson when every room is left on L1', () => {
    const l = street();
    const b = complete(l);
    for (const id of Object.keys(b.rooms)) b.rooms[id].phase = 'L1';
    const { design } = siteDesign(l, b);
    expect(scoreDay(design!, runDay(design!)).lessons.map(x => x.title)).toContain('Phases unbalanced: Villa A');
  });

  it('flags a feeder breaker bigger than its cable', () => {
    const l = street();
    const b = complete(l);
    b.boards.VB.breakerA = 63;
    const { design } = siteDesign(l, b);
    expect(scoreDay(design!, runDay(design!)).lessons.map(x => x.title)).toContain('Breaker bigger than the feeder cable: Villa B');
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
