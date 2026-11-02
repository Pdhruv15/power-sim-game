import { BANDS, cableAmps, INSTANT_TRIP, joinedPoints, NEW_BREAKER, solveCircuit, stepBreaker, topBoard, type Level, type Phase, type Resistor } from '../sim';
import { breakerPrice, cablePrice } from './catalog';
import { fmt } from './format';

/**
 * Workshop levels: the player places parts and wires them up freely, then presses Power On.
 * Nothing runs while they build. Power On tries the build in a few short steps, and the
 * real circuit decides what happens, so any wiring gets an honest result.
 */
export type PartKind = 'battery' | 'supply' | 'switch' | 'breaker' | 'lamp' | 'light' | 'socket' | 'lbar' | 'nbar' | 'ebar' | 'mainswitch';

export interface PlacedPart {
  id: string;
  kind: PartKind;
  x: number;
  y: number;
  /** Breaker size, in amps. */
  breakerA?: number;
  /** Shown instead of the kind's name, to tell two of a kind apart. */
  label?: string;
  /** Comes with the level and stays where it is. */
  fixed?: boolean;
}

/** One of a part's connection points, such as "<part id>.a". */
export type Terminal = string;

export interface Wire {
  id: string;
  from: Terminal;
  to: Terminal;
  mm2: number;
  /** Comes with the level, already connected. */
  fixed?: boolean;
}

export interface Build {
  parts: PlacedPart[];
  wires: Wire[];
}

export interface Mission {
  id: string;
  kind: 'circuit' | 'room';
  title: string;
  goal: string;
  /** Most of each part the player may place. */
  tray: Partial<Record<PartKind, number>>;
  volts: number;
  /** Resistance of the source itself, in ohms. */
  sourceOhms: number;
  wireLengthM: number;
  /** Cable sizes on offer, in mm². */
  cables: readonly number[];
  breakers: readonly number[];
  /** Spending limit for 3 stars. Null when parts are free. */
  budget: number | null;
  /** What each star asks for. */
  stars: readonly [string, string, string];
  /** Steps a bought hint reveals. */
  hint: readonly string[];
  /** Number on each part's two connection points. Matching numbers are wired together. */
  guide: Partial<Record<PartKind, readonly [number, number]>>;
  /** What is on the board before the player starts. */
  start: Build;
}

export const PART_INFO: Readonly<Record<PartKind, { name: string; a: string; b: string; c?: string; watts?: number }>> = {
  battery: { name: 'Battery', a: '+', b: '−' },
  supply: { name: 'Street supply', a: 'L', b: 'N', c: 'E' },
  switch: { name: 'Switch', a: 'IN', b: 'OUT' },
  breaker: { name: 'Breaker', a: 'IN', b: 'OUT' },
  lamp: { name: 'Lamp', a: 'IN', b: 'OUT', watts: 12 },
  light: { name: 'Room light', a: 'L', b: 'N', c: 'E', watts: 230 },
  socket: { name: 'Socket and kettle', a: 'L', b: 'N', c: 'E', watts: 3450 },
  lbar: { name: 'L bar', a: '', b: '' },
  nbar: { name: 'N bar', a: '', b: '' },
  ebar: { name: 'E bar', a: '', b: '' },
  mainswitch: { name: 'Main switch', a: 'IN', b: 'OUT' },
};

/** A bus bar is one solid piece of metal: every point on it is the same point. */
export const isBar = (k: PartKind) => k === 'lbar' || k === 'nbar' || k === 'ebar';
/** A part's connection points. The third one on a load or the supply is its earth. */
export const partEnds = (k: PartKind): readonly string[] => (k === 'lbar' || PART_INFO[k].c ? ['a', 'b', 'c'] : ['a', 'b']);

const fixedPart = (id: string, kind: PartKind, x: number, y: number, extra: Partial<PlacedPart> = {}): PlacedPart => ({ id, kind, x, y, fixed: true, ...extra });
const fixedWire = (from: string, to: string): Wire => ({ id: `fixed:${from}`, from, to, mm2: 16, fixed: true });

/** A ready-made distribution board: the street feeds its main switch and bars, and the main switch feeds the breakers through the L bar. */
const ROOM_START: Build = {
  parts: [
    fixedPart('street', 'supply', 20, 160),
    fixedPart('main', 'mainswitch', 200, 140, { label: 'Main 40 A' }),
    fixedPart('lbar', 'lbar', 320, 80),
    fixedPart('mcb1', 'breaker', 340, 120, { label: 'MCB 1', breakerA: 6 }),
    fixedPart('mcb2', 'breaker', 440, 120, { label: 'MCB 2', breakerA: 6 }),
    fixedPart('nbar', 'nbar', 220, 273),
    fixedPart('ebar', 'ebar', 220, 340),
  ],
  wires: [
    fixedWire('street.a', 'main.a'), fixedWire('main.b', 'lbar.a'), fixedWire('lbar.b', 'mcb1.a'), fixedWire('lbar.c', 'mcb2.a'),
    fixedWire('street.b', 'nbar.a'), fixedWire('street.c', 'ebar.a'),
  ],
};

export const MISSIONS: Readonly<Record<string, Mission>> = {
  'level-circuit': {
    id: 'level-circuit', kind: 'circuit', title: 'Single circuit',
    goal: 'Light the lamp from the battery, and make the switch turn it on and off.',
    tray: { battery: 1, switch: 1, lamp: 1 }, volts: 12, sourceOhms: 0.5, wireLengthM: 1, cables: [1.5], breakers: [], budget: null,
    stars: ['The lamp lights up', 'The switch controls the lamp', 'IN and OUT the right way, no spare wires'],
    hint: ['Battery + to switch IN.', 'Switch OUT to lamp IN.', 'Lamp OUT to battery −.'],
    guide: { battery: [1, 3], switch: [1, 2], lamp: [2, 3] },
    start: { parts: [], wires: [] },
  },
  'level-room': {
    id: 'level-room', kind: 'room', title: 'One room',
    goal: 'Feed the light and the kettle socket from the distribution board. Give each its own breaker, and earth them both.',
    tray: { light: 1, socket: 1 }, volts: 230, sourceOhms: 0.03, wireLengthM: 5,
    cables: [1.5, 2.5], breakers: [6, 10, 16, 20], budget: 110,
    stars: ['The light and kettle both work', 'Safe: breaker on L, both loads earthed, big enough cable', 'Within budget, breakers under 90 %, one wire on each connection'],
    hint: [
      'MCB 1 OUT to L on the socket, and MCB 2 OUT to L on the light.',
      'N bar to N on each load, and E bar to E on each load.',
      'The kettle needs a 20 A breaker with 2.5 mm² cable.',
      'The light only needs 6 A and 1.5 mm², which keeps you in budget.',
    ],
    guide: {},
    start: ROOM_START,
  },
};

export interface TestStep {
  label: string;
  /** What this step shows, in one short sentence. */
  text: string;
  ok: boolean;
  /** Parts running at full power. */
  lit: string[];
  /** Current through each wire, in amps. */
  wireAmps: Record<string, number>;
  /** Breakers open by the end of this step. */
  open: string[];
  /** Total current from the source. */
  amps: number;
}

export interface PowerOnReport {
  steps: TestStep[];
  stars: 0 | 1 | 2 | 3;
  /** True when the first star is earned. */
  held: boolean;
  /** One line on the first thing to fix. Null at 3 stars. */
  tip: string | null;
  /** Part or wire the tip is about. */
  focus: string | null;
}

/** A closed switch or breaker has almost no resistance. */
const CLOSED_OHMS = 0.001;
/** A shorted kettle lead: almost no resistance left. */
const SHORT_OHMS = 0.02;
/** A part counts as working from this share of its full power. */
const LIT_SHARE = 0.8;
/** Below this a wire is carrying nothing. */
const NO_CURRENT_A = 0.01;
const COPPER_OHM_MM2_PER_M = 0.0225;
/** How long the kettle test runs, and its time step, in hours. */
const KETTLE_RUN_HOURS = 0.5;
const KETTLE_STEP_HOURS = 0.005;

const isSource = (k: PartKind) => k === 'battery' || k === 'supply';
const isLoad = (k: PartKind) => PART_INFO[k].watts !== undefined;

const wireOhms = (m: Mission, w: Wire) => (COPPER_OHM_MM2_PER_M * m.wireLengthM) / w.mm2;

/** Price of a build, in credits. Sources and loads come with the job. */
export function buildCost(m: Mission, b: Build): number {
  if (m.budget === null) return 0;
  return b.parts.reduce((s, p) => s + (p.kind === 'breaker' ? breakerPrice(p.breakerA ?? 0) : 0), 0)
    + b.wires.reduce((s, w) => s + (w.fixed ? 0 : cablePrice(w.mm2, m.wireLengthM)), 0);
}

interface Setup {
  /** Switches and breakers open for this try. */
  open?: readonly string[];
  /** Loads switched off for this try. */
  off?: readonly string[];
  /** A load whose lead has shorted. */
  shorted?: string;
}

function solve(m: Mission, b: Build, setup: Setup) {
  const parts: Resistor[] = [];
  for (const p of b.parts) {
    if (isBar(p.kind)) {
      partEnds(p.kind).slice(1).forEach(end => parts.push({ id: `${p.id}:${end}`, a: `${p.id}.a`, b: `${p.id}.${end}`, ohms: CLOSED_OHMS }));
      continue;
    }
    if (isSource(p.kind) || setup.off?.includes(p.id) || setup.open?.includes(p.id)) continue;
    const watts = PART_INFO[p.kind].watts;
    const ohms = p.id === setup.shorted ? SHORT_OHMS : watts !== undefined ? m.volts ** 2 / watts : CLOSED_OHMS;
    parts.push({ id: p.id, a: `${p.id}.a`, b: `${p.id}.b`, ohms });
  }
  const wires = b.wires.map((w): Resistor => ({ id: w.id, a: w.from, b: w.to, ohms: wireOhms(m, w) }));
  const sources = b.parts.filter(p => isSource(p.kind))
    .map(p => ({ id: p.id, plus: `${p.id}.a`, minus: `${p.id}.b`, volts: m.volts, ohms: m.sourceOhms }));
  const s = solveCircuit([...parts, ...wires], sources);
  const lit = b.parts.filter(p => {
    const watts = PART_INFO[p.kind].watts;
    if (watts === undefined || p.id === setup.shorted) return false;
    const amps = s.amps.get(p.id) ?? 0;
    return amps ** 2 * (m.volts ** 2 / watts) >= LIT_SHARE * watts;
  }).map(p => p.id);
  return {
    lit,
    partAmps: (id: string) => Math.abs(s.amps.get(id) ?? 0),
    wireAmps: Object.fromEntries(b.wires.map(w => [w.id, Math.abs(s.amps.get(w.id) ?? 0)])),
    amps: [...s.sourceAmps.values()].reduce((sum, a) => sum + Math.abs(a), 0),
  };
}

/** Points joined by wires and closed switches or breakers alone, with nothing to limit the current. */
function joined(b: Build, open: readonly string[] = []) {
  return joinedPoints([
    ...b.wires.map(w => [w.from, w.to] as const),
    ...b.parts.filter(p => (p.kind === 'switch' || p.kind === 'breaker' || p.kind === 'mainswitch') && !open.includes(p.id)).map(p => [`${p.id}.a`, `${p.id}.b`] as const),
    ...b.parts.filter(p => isBar(p.kind)).flatMap(p => partEnds(p.kind).slice(1).map(end => [`${p.id}.a`, `${p.id}.${end}`] as const)),
  ]);
}

/** A part whose second connection point is nearer the source than its first. */
const backwardsPart = (reach: ReturnType<typeof joined>, parts: readonly PlacedPart[], source: Terminal) =>
  parts.find(p => reach(`${p.id}.b`, source) && !reach(`${p.id}.a`, source));

const report = (steps: TestStep[], stars: 0 | 1 | 2 | 3, tip: string | null, focus: string | null = null): PowerOnReport =>
  ({ steps, stars, held: stars >= 1, tip, focus });

const missingTip = (m: Mission, b: Build): string | null => {
  const missing = (Object.keys(m.tray) as PartKind[]).filter(k => k !== 'breaker' && !isBar(k) && !b.parts.some(p => p.kind === k));
  return missing.length ? `Place the ${missing.map(k => PART_INFO[k].name.toLowerCase()).join(' and the ')} first.` : null;
};

/** Which conductor a wire belongs to, once everything is switched on. Null when the build has no street supply. */
export function wireConductor(b: Build, w: Wire): 'L' | 'N' | 'E' | null {
  const supply = b.parts.find(p => p.kind === 'supply');
  if (!supply) return null;
  const reach = joined(b);
  return reach(w.from, `${supply.id}.a`) ? 'L' : reach(w.from, `${supply.id}.b`) ? 'N' : reach(w.from, `${supply.id}.c`) ? 'E' : null;
}

/** Press Power On: try the build and say what happened. Pure function of the mission and the build. */
export function powerOn(m: Mission, b: Build): PowerOnReport {
  const missing = missingTip(m, b);
  if (missing) return report([], 0, missing);
  return m.kind === 'circuit' ? testCircuit(m, b) : testRoom(m, b);
}

function testCircuit(m: Mission, b: Build): PowerOnReport {
  const battery = b.parts.find(p => p.kind === 'battery')!;
  const lamp = b.parts.find(p => p.kind === 'lamp')!;
  const sw = b.parts.find(p => p.kind === 'switch')!;
  const step = (label: string, text: string, ok: boolean, on: boolean): TestStep => {
    const s = solve(m, b, { open: on ? [] : [sw.id] });
    return { label, text, ok, lit: s.lit, wireAmps: s.wireAmps, open: [], amps: s.amps };
  };

  if (joined(b)(`${battery.id}.a`, `${battery.id}.b`)) {
    const s = step('Switch on', 'Battery + reaches battery − with no lamp in the way.', false, true);
    return report([s], 0, 'That is a short circuit: the wire gets hot and the lamp stays dark. Current must pass through the lamp.', battery.id);
  }
  const on = solve(m, b, {});
  if (!on.lit.includes(lamp.id)) {
    return report([step('Switch on', 'The lamp stays dark.', false, true)],
      0, 'Current needs a closed loop: from battery +, through the lamp, and back to battery −.', lamp.id);
  }
  const first = step('Switch on', `The lamp lights up with ${fmt(on.amps)} A flowing.`, true, true);
  const off = solve(m, b, { open: [sw.id] });
  if (off.lit.includes(lamp.id)) {
    const second = step('Switch off', 'The lamp stays on, so the switch is not doing anything.', false, false);
    return report([first, second], 1, 'Put the switch in the loop, so opening it breaks the path to the lamp.', sw.id);
  }
  const second = step('Switch off', 'The loop opens and the lamp goes out.', true, false);
  const spare = b.wires.find(w => on.wireAmps[w.id] < NO_CURRENT_A);
  if (spare) return report([first, second], 2, 'One wire carries no current. Remove it for the third star.', spare.id);
  // IN is the side the current reaches first
  const plus = `${battery.id}.a`;
  const backwards = backwardsPart(joined(b, [sw.id]), [sw], plus) ?? backwardsPart(joined(b), [lamp], plus);
  if (backwards) return report([first, second], 2, `The ${PART_INFO[backwards.kind].name.toLowerCase()} is the wrong way round. It still works, but the side nearer battery + should be IN.`, backwards.id);
  return report([first, second], 3, null);
}

function testRoom(m: Mission, b: Build): PowerOnReport {
  const supply = b.parts.find(p => p.kind === 'supply')!;
  const light = b.parts.find(p => p.kind === 'light')!;
  const socket = b.parts.find(p => p.kind === 'socket')!;
  const breakers = b.parts.filter(p => p.kind === 'breaker');
  const L = `${supply.id}.a`, N = `${supply.id}.b`, E = `${supply.id}.c`;
  const steps: TestStep[] = [];
  const reach = joined(b);

  // Earth carries nothing until a fault, so it never joins L or N
  const liveEarth = [E, `${light.id}.c`, `${socket.id}.c`].find(t => reach(t, L) || reach(t, N));
  if (liveEarth) return report([], 0, 'Earth is joined to L or N here, which can make metal cases live. Earth wires go only from the E bar to E on each load.', liveEarth.split('.')[0]);

  // Step 1: the light on its own
  const lightOnly = solve(m, b, { off: [socket.id] });
  const touching = joined(b)(L, N);
  steps.push({
    label: 'Light on',
    text: touching ? 'L reaches N with nothing in the way.' : lightOnly.lit.includes(light.id) ? `The light comes on at ${fmt(lightOnly.amps)} A.` : 'The light stays dark.',
    ok: !touching && lightOnly.lit.includes(light.id), lit: lightOnly.lit, wireAmps: lightOnly.wireAmps, open: [], amps: lightOnly.amps,
  });
  if (touching) return report(steps, 0, 'That is a short circuit: L reaches N with no load in the way. Current must pass through the light and the kettle.', supply.id);
  const both = solve(m, b, {});
  const inLine = 'Give the light and the kettle each their own path from L to N, side by side. In a line, they share the voltage.';
  if (!lightOnly.lit.includes(light.id)) {
    // Only lit through the kettle means the two are in a line
    const throughKettle = both.partAmps(light.id) >= NO_CURRENT_A;
    return report(steps, 0, throughKettle ? inLine : 'The light needs a closed loop: from L, through the light, and back to N.', light.id);
  }

  // Step 2: the kettle too. Breakers heat for a while and may trip.
  if (!both.lit.includes(socket.id) || !both.lit.includes(light.id)) {
    steps.push({ label: 'Kettle on', text: 'The kettle barely warms up.', ok: false, lit: both.lit, wireAmps: both.wireAmps, open: [], amps: both.amps });
    return report(steps, 0, both.partAmps(socket.id) >= NO_CURRENT_A ? inLine : 'The kettle needs a closed loop too: from L, through the socket, and back to N.', socket.id);
  }
  const tripped = breakers.find(p => {
    let state = NEW_BREAKER;
    for (let t = 0; t < KETTLE_RUN_HOURS && !state.tripped; t += KETTLE_STEP_HOURS) {
      state = stepBreaker(state, both.partAmps(p.id) / (p.breakerA ?? 1), KETTLE_STEP_HOURS);
    }
    return state.tripped;
  });
  if (tripped) {
    const after = solve(m, b, { open: [tripped.id] });
    const needs = both.partAmps(tripped.id);
    steps.push({ label: 'Kettle on', text: `${fmt(needs)} A heats the ${tripped.breakerA} A breaker until it trips.`, ok: false, lit: after.lit, wireAmps: after.wireAmps, open: [tripped.id], amps: after.amps });
    return report(steps, 0, `The room draws ${fmt(needs)} A through a ${tripped.breakerA} A breaker. Pick one bigger than the current it carries.`, tripped.id);
  }
  steps.push({ label: 'Kettle on', text: `Both run together at ${fmt(both.amps)} A.`, ok: true, lit: both.lit, wireAmps: both.wireAmps, open: [], amps: both.amps });

  // Step 3: the kettle lead shorts. A breaker should open at once.
  const fault = solve(m, b, { shorted: socket.id });
  const opened = breakers.filter(p => fault.partAmps(p.id) >= (p.breakerA ?? 0) * INSTANT_TRIP).map(p => p.id);
  const afterFault = solve(m, b, { open: opened, off: [socket.id] });
  const cleared = opened.length > 0 && fault.partAmps(socket.id) > 0 && solve(m, b, { shorted: socket.id, open: opened }).partAmps(socket.id) < NO_CURRENT_A;
  const unsafe = (text: string, tip: string, focus: string | null) => {
    steps.push({ label: 'Kettle lead shorts', text, ok: false, lit: fault.lit, wireAmps: fault.wireAmps, open: opened, amps: fault.amps });
    return report(steps, 1, tip, focus);
  };
  if (!cleared) {
    return unsafe(`${fmt(fault.amps, 0)} A flows and nothing cuts it off.`,
      'Put a breaker between L and the socket, so a fault cuts the power at once.', socket.id);
  }
  // With every breaker open, nothing in the room should still touch L
  const dead = joined(b, breakers.map(p => p.id));
  const liveLoad = b.parts.find(p => isLoad(p.kind) && (dead(`${p.id}.a`, L) || dead(`${p.id}.b`, L)));
  if (liveLoad) {
    return unsafe('The breaker opens, but the room is still connected to L.',
      `${PART_INFO[liveLoad.kind].name} stays live with its breaker open, which can give a shock. Put breakers on the L side.`, liveLoad.id);
  }
  const swapped = backwardsPart(reach, [light, socket], L);
  if (swapped) {
    return unsafe(`The ${PART_INFO[swapped.kind].name} has L and N swapped.`,
      'It still runs, but it can stay live when it looks safe. Bring the breaker wire to L and the return wire to N.', swapped.id);
  }
  const unearthed = [light, socket].find(p => !reach(`${p.id}.c`, E));
  if (unearthed) {
    const name = PART_INFO[unearthed.kind].name;
    return unsafe(`${name} has no earth.`, `If a live wire touches its metal case, nothing trips and the case stays live. Connect E on the ${name.toLowerCase()} to the E bar.`, unearthed.id);
  }
  // Every wire needs a breaker it cannot out-carry: opening that breaker is what stops the wire's current
  for (const w of b.wires) {
    if (both.wireAmps[w.id] < NO_CURRENT_A) continue;
    const guards = breakers.filter(p => solve(m, b, { open: [p.id] }).wireAmps[w.id] < NO_CURRENT_A);
    // A wire shared by several breakers, like a bar's feed: together they cut it, so it only has to carry the room
    const shared = guards.length === 0 && solve(m, b, { open: breakers.map(p => p.id) }).wireAmps[w.id] < NO_CURRENT_A;
    if (shared && both.wireAmps[w.id] <= cableAmps(w.mm2)) continue;
    const guard = guards.length ? Math.min(...guards.map(p => p.breakerA ?? 0)) : Infinity;
    if (guard > cableAmps(w.mm2)) {
      return unsafe(`The breaker lets ${guard === Infinity ? 'any current' : `${guard} A`} through a wire good for ${cableAmps(w.mm2)} A.`,
        guard === Infinity
          ? `One ${w.mm2} mm² wire has no breaker that can cut its current. Route it through a breaker.`
          : `A ${guard} A breaker on ${w.mm2} mm² cable lets the cable overheat first. Use thicker cable, or a smaller breaker if the room allows.`, w.id);
    }
  }
  steps.push({ label: 'Kettle lead shorts', text: `${fmt(fault.amps, 0)} A flows, and the breaker opens at once.`, ok: true, lit: afterFault.lit, wireAmps: afterFault.wireAmps, open: opened, amps: afterFault.amps });

  // Third star: a tidy, affordable build
  const cost = buildCost(m, b);
  if (m.budget !== null && cost > m.budget) return report(steps, 2, `This build costs ${cost} credits against a budget of ${m.budget}. Use fewer parts or thinner cable where it is safe.`);
  const busy = breakers.find(p => both.partAmps(p.id) / (p.breakerA ?? 1) > BANDS.high);
  if (busy) return report(steps, 2, `The ${busy.breakerA} A breaker runs at ${fmt((both.partAmps(busy.id) / (busy.breakerA ?? 1)) * 100, 0)} %. Keep normal peaks under 90 %.`, busy.id);
  const spare = b.wires.find(w => !w.fixed && !reach(w.from, E) && both.wireAmps[w.id] < NO_CURRENT_A);
  if (spare) return report(steps, 2, 'One wire carries no current. Remove it for the third star.', spare.id);
  // Real terminals take one wire. Sharing a connection is what a bus bar is for.
  const crowded = b.parts.find(p => !isBar(p.kind) && partEnds(p.kind).some(end => b.wires.filter(w => w.from === `${p.id}.${end}` || w.to === `${p.id}.${end}`).length > 1));
  if (crowded) return report(steps, 2, `Two wires share one connection on the ${PART_INFO[crowded.kind].name.toLowerCase()}. Give each load its own breaker, and use the bars to share N and E.`, crowded.id);
  return report(steps, 3, null);
}

/**
 * A site the player builds from the street: boards in the level's tree, a feeder cable to each board below
 * the top one, then a cable and a breaker to each room. At this size wiring every return path by hand
 * is busywork, so one wire stands for each run.
 */
export interface SiteBuild {
  /** The street supply is wired to the top board. */
  supplyWired: boolean;
  solarKw: number;
  /** Per board: placed yet, its breaker, and its feeder cable once it is wired. */
  boards: Record<string, { placed: boolean; breakerA: number; mm2: number | null }>;
  /** Per room: its breaker, its phase, and the size of its cable once it is wired. */
  rooms: Record<string, { breakerA: number; phase: Phase; mm2: number | null }>;
}

/** An empty site: nothing wired, and the smallest breakers, as they come out of the box. */
export function newSiteBuild(level: Level, boardBreakerA: number, roomBreakerA: number): SiteBuild {
  return {
    supplyWired: false, solarKw: 0,
    boards: Object.fromEntries(level.boards.map(b => [b.id, { placed: false, breakerA: boardBreakerA, mm2: null }])),
    rooms: Object.fromEntries(level.circuits.map(c => [c.id, { breakerA: roomBreakerA, phase: 'L1' as Phase, mm2: null }])),
  };
}

/**
 * Turn a finished build into a design the day simulation can run.
 * It needs every connection first, and until then it says what is missing.
 */
export function siteDesign(level: Level, b: SiteBuild): { design: Level; tip: null } | { design: null; tip: string } {
  const unplaced = level.boards.find(x => !b.boards[x.id]?.placed);
  if (unplaced) return { design: null, tip: `Place the ${unplaced.name} first. The rooms get their power through it.` };
  const top = topBoard(level);
  if (!b.supplyWired) return { design: null, tip: `Wire the street supply to the ${top.name}, so power can reach the site.` };
  const unfed = level.boards.find(x => x.parent !== null && b.boards[x.id].mm2 == null);
  if (unfed) return { design: null, tip: `${unfed.name} has no feeder cable yet. Wire it from the board above it.` };
  const dark = level.circuits.filter(c => b.rooms[c.id]?.mm2 == null);
  if (dark.length) {
    return { design: null, tip: `${dark.length === 1 ? `${dark[0].room} has` : `${dark.length} rooms have`} no cable yet. Wire each board to its rooms.` };
  }
  return {
    tip: null,
    design: {
      ...level,
      boards: level.boards.map(x => ({
        ...x, breakerA: b.boards[x.id].breakerA,
        ...(x.id === top.id && { solarKw: b.solarKw }),
        ...(x.cable && { cable: { ...x.cable, mm2: b.boards[x.id].mm2! } }),
      })),
      circuits: level.circuits.map(c => ({ ...c, breakerA: b.rooms[c.id].breakerA, cableMm2: b.rooms[c.id].mm2!, phase: b.rooms[c.id].phase })),
    },
  };
}

/** A part in the player's hand while building a site in 3D. A cable stays in hand for room after room. */
export type SiteTool = { kind: 'board' } | { kind: 'supply' } | { kind: 'cable'; mm2: number };

/** What was clicked: a room (by circuit id) or a board. */
export interface SiteTarget {
  kind: 'room' | 'board';
  id: string;
}

/** Use the part in hand on what was clicked. Returns the new build, or why nothing happened. */
export function applySiteTool(level: Level, b: SiteBuild, tool: SiteTool, target: SiteTarget): { build: SiteBuild; tip: null } | { build: null; tip: string } {
  const room = target.kind === 'room' ? level.circuits.find(c => c.id === target.id) : undefined;
  const board = level.boards.find(x => x.id === (room ? room.board : target.id));
  if (!board) return { build: null, tip: 'There is nothing to connect there.' };
  const placeFirst = { build: null, tip: `Place the ${board.name} first. The rooms get their power through it.` };
  const setBoard = (patch: Partial<SiteBuild['boards'][string]>) => ({ ...b, boards: { ...b.boards, [board.id]: { ...b.boards[board.id], ...patch } } });

  if (tool.kind === 'board') {
    if (b.boards[board.id].placed) return { build: null, tip: `The ${board.name} is already in place.` };
    return { build: setBoard({ placed: true }), tip: null };
  }
  if (tool.kind === 'supply') {
    const top = topBoard(level);
    if (room || board.id !== top.id) return { build: null, tip: `The street cable goes to the ${top.name}. Click the ${top.name}.` };
    if (!b.boards[top.id].placed) return placeFirst;
    return { build: { ...b, supplyWired: true }, tip: null };
  }
  if (!b.boards[board.id].placed) return placeFirst;
  if (room) return { build: { ...b, rooms: { ...b.rooms, [room.id]: { ...b.rooms[room.id], mm2: tool.mm2 } } }, tip: null };
  const parent = level.boards.find(x => x.id === board.parent);
  if (!parent) return { build: null, tip: `The ${board.name} is fed by the street cable, not a room cable.` };
  if (!b.boards[parent.id].placed) return { build: null, tip: `Place the ${parent.name} first. ${board.name} gets its power through it.` };
  return { build: setBoard({ mm2: tool.mm2 }), tip: null };
}

/** Coins for each star count. Only stars beyond the best so far pay out, so replays stay fair. */
const COINS_AT_STARS: readonly number[] = [0, 20, 40, 60];
export const coinsEarned = (bestStars: number, stars: number): number =>
  Math.max(0, COINS_AT_STARS[stars] - COINS_AT_STARS[bestStars]);

/** Things coins can buy. None are needed to finish a level. */
export const SHOP_ITEMS: readonly { id: string; name: string; price: number }[] = [
  { id: 'warm-lamps', name: 'Warm lamp glow', price: 25 },
  { id: 'gold-wires', name: 'Gold wires', price: 40 },
];
export const HINT_PRICE = 15;
/** Coins a new player starts with: enough for one hint. */
export const STARTING_COINS = 20;
