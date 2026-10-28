import { CABLE_AMPS, CABLE_SIZES, DEFAULT_CABLE } from './cables';
import { GRID_ID } from './network';
import { LOAD_TYPES, PHASES, type Board, type Circuit, type FaultEvent, type Level, type LoadType, type Phase } from './types';

/** Thrown when a level file is not valid. The message lists every problem found. */
export class LevelError extends Error {
  constructor(readonly problems: string[]) {
    super(`Level file is not valid:\n- ${problems.join('\n- ')}`);
    this.name = 'LevelError';
  }
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const isPositive = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v > 0;
const isNonNegative = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0;
const isCable = (v: unknown): boolean => typeof v === 'number' && v in CABLE_AMPS;

/** Typical supply resistance close to a distribution transformer. */
const DEFAULT_SOURCE_OHMS = 0.03;

/** Board id used when a villa-format file (Level 1) is converted. */
export const VILLA_BOARD_ID = 'DB';

/**
 * Check raw JSON and return a typed level, or throw a LevelError.
 * Two formats are accepted:
 *  - board format: `boards` plus `circuits` with `board`, `phase` and `lengthM`
 *  - villa format (Level 1): `supply.mainBreakerA`, `solarKw` and circuits on one board
 */
export function parseLevel(raw: unknown): Level {
  const problems: string[] = [];
  if (!isObj(raw)) throw new LevelError(['the file must contain a JSON object']);

  const project = typeof raw.project === 'string' && raw.project.trim() ? raw.project : '';
  if (!project) problems.push('project: give the project a name');
  const orientation = raw.orientation ?? 0;
  if (typeof orientation !== 'number' || !Number.isFinite(orientation)) problems.push('orientation: must be a number of degrees');
  const supply = isObj(raw.supply) ? raw.supply : {};
  if (!isPositive(supply.voltage)) problems.push('supply.voltage: must be a positive number of volts');

  const villaFormat = !Array.isArray(raw.boards);
  const boards = villaFormat ? villaBoard(raw, supply, problems) : parseBoards(raw.boards as unknown[], problems);
  const circuits = parseCircuits(raw.circuits, boards, villaFormat, problems);

  const sourceOhms = supply.sourceOhms ?? DEFAULT_SOURCE_OHMS;
  if (!isPositive(sourceOhms)) problems.push('supply.sourceOhms: must be a positive number of ohms');
  const faults = parseFaults(raw.faults, circuits, problems);

  const budget = raw.budget;
  if (budget !== undefined && !isPositive(budget)) problems.push('budget: must be a positive number');
  const points = raw.points;
  if (points !== undefined && (!isObj(points) || !Object.values(points).every(isNonNegative))) {
    problems.push('points: must map score parts to points, e.g. { "supply": 400 }');
  }

  if (problems.length) throw new LevelError(problems);
  return {
    id: typeof raw.id === 'string' && raw.id ? raw.id : 'level',
    title: typeof raw.title === 'string' && raw.title ? raw.title : project,
    project,
    ...(typeof raw.intro === 'string' && raw.intro && { intro: raw.intro }),
    orientation: orientation as number,
    voltage: supply.voltage as number,
    boards,
    circuits,
    ...(budget !== undefined && { budget: budget as number }),
    ...(points !== undefined && { points: points as Record<string, number> }),
    sourceOhms: sourceOhms as number,
    faults,
  };
}

/** Level 1 files describe one single-phase board through `supply` and `solarKw`. */
function villaBoard(raw: Obj, supply: Obj, problems: string[]): Board[] {
  if (!isPositive(supply.mainBreakerA)) problems.push('supply.mainBreakerA: must be a positive number of amps');
  const solarKw = raw.solarKw ?? 0;
  if (!isNonNegative(solarKw)) problems.push('solarKw: must be 0 or more');
  return [{
    id: VILLA_BOARD_ID, name: 'Villa DB', parent: null, breakerA: Number(supply.mainBreakerA), phases: 1, cable: null,
    solarKw: Number(solarKw), phase: 'L1',
  }];
}

function parseBoards(list: unknown[], problems: string[]): Board[] {
  const boards: Board[] = [];
  const seen = new Set<string>();
  list.forEach((b: unknown, i) => {
    const at = `boards[${i}]`;
    if (!isObj(b)) { problems.push(`${at}: must be an object`); return; }
    const id = typeof b.id === 'string' ? b.id.trim() : '';
    if (!id) problems.push(`${at}.id: missing`);
    else if (seen.has(id)) problems.push(`${at}.id: "${id}" is used twice`);
    else if (id === GRID_ID) problems.push(`${at}.id: "${GRID_ID}" is reserved for the grid supply`);
    seen.add(id);
    const parent = b.parent ?? null;
    if (parent !== null && typeof parent !== 'string') problems.push(`${at}.parent: must be a board id or null`);
    if (!isPositive(b.breakerA)) problems.push(`${at}.breakerA: must be a positive number`);
    const phases = b.phases ?? 1;
    if (phases !== 1 && phases !== 3) problems.push(`${at}.phases: must be 1 or 3`);
    let cable: Board['cable'] = null;
    if (b.cable !== undefined && b.cable !== null) {
      const c = isObj(b.cable) ? b.cable : {};
      if (!isCable(c.mm2)) problems.push(`${at}.cable.mm2: must be one of ${CABLE_SIZES.join(', ')}`);
      if (!isPositive(c.lengthM)) problems.push(`${at}.cable.lengthM: must be a positive number of metres`);
      cable = { mm2: Number(c.mm2), lengthM: Number(c.lengthM) };
    }
    const solarKw = b.solarKw ?? 0;
    if (!isNonNegative(solarKw)) problems.push(`${at}.solarKw: must be 0 or more`);
    const phase = b.phase ?? 'L1';
    if (!PHASES.includes(phase as Phase)) problems.push(`${at}.phase: must be one of ${PHASES.join(', ')}`);
    if (b.floor !== undefined && !(Number.isInteger(b.floor) && (b.floor as number) >= 0)) problems.push(`${at}.floor: must be 0 or a whole number above`);
    boards.push({
      id, name: typeof b.name === 'string' && b.name ? b.name : id, parent: parent as string | null,
      breakerA: Number(b.breakerA), phases: phases as 1 | 3, cable, solarKw: Number(solarKw), phase: phase as Phase,
      ...(b.floor !== undefined && { floor: b.floor as number }),
    });
  });

  const tops = boards.filter(b => b.parent === null);
  if (tops.length !== 1) problems.push('boards: exactly one board must have parent null (the one fed from the grid)');
  for (const b of boards) {
    if (b.parent !== null && !seen.has(b.parent)) problems.push(`board ${b.id}: parent "${b.parent}" does not exist`);
    if (b.parent !== null && !b.cable) problems.push(`board ${b.id}: needs a feeder cable from its parent`);
  }
  // Reject loops: walking up from any board must reach the top
  const parentOf = new Map(boards.map(b => [b.id, b.parent]));
  for (const b of boards) {
    let at: string | null | undefined = b.id;
    for (let steps = 0; at && steps <= boards.length; steps++) at = parentOf.get(at);
    if (at) problems.push(`board ${b.id}: its parents form a loop`);
  }
  return boards;
}

function parseCircuits(list: unknown, boards: Board[], villaFormat: boolean, problems: string[]): Circuit[] {
  const circuits: Circuit[] = [];
  if (!Array.isArray(list) || list.length === 0) {
    problems.push('circuits: add at least one circuit');
    return circuits;
  }
  const boardIds = new Set(boards.map(b => b.id));
  const seen = new Set<string>(boardIds);
  list.forEach((c: unknown, i) => {
    const at = `circuits[${i}]`;
    if (!isObj(c)) { problems.push(`${at}: must be an object`); return; }
    const id = typeof c.id === 'string' ? c.id.trim() : '';
    if (!id) problems.push(`${at}.id: missing`);
    else if (seen.has(id)) problems.push(`${at}.id: "${id}" is used twice`);
    seen.add(id);
    const board = villaFormat ? VILLA_BOARD_ID : c.board;
    if (typeof board !== 'string' || !boardIds.has(board)) problems.push(`${at}.board: must be one of ${[...boardIds].join(', ')}`);
    if (typeof c.room !== 'string' || !c.room.trim()) problems.push(`${at}.room: missing`);
    if (!LOAD_TYPES.includes(c.type as LoadType)) problems.push(`${at}.type: must be one of ${LOAD_TYPES.join(', ')}`);
    if (!isPositive(c.kw)) problems.push(`${at}.kw: must be a positive number`);
    if (!isPositive(c.breakerA)) problems.push(`${at}.breakerA: must be a positive number`);
    const cableMm2 = c.cableMm2 ?? DEFAULT_CABLE;
    if (!isCable(cableMm2)) problems.push(`${at}.cableMm2: must be one of ${CABLE_SIZES.join(', ')}`);
    const lengthM = c.lengthM ?? 0;
    if (!isNonNegative(lengthM)) problems.push(`${at}.lengthM: must be 0 or more`);
    const phase = c.phase ?? 'L1';
    if (!PHASES.includes(phase as Phase)) problems.push(`${at}.phase: must be one of ${PHASES.join(', ')}`);
    circuits.push({
      id, board: String(board), room: String(c.room ?? ''), type: c.type as LoadType, kw: Number(c.kw),
      breakerA: Number(c.breakerA), cableMm2: Number(cableMm2), lengthM: Number(lengthM), phase: phase as Phase,
    });
  });
  return circuits;
}

function parseFaults(list: unknown, circuits: Circuit[], problems: string[]): FaultEvent[] {
  if (list === undefined) return [];
  if (!Array.isArray(list)) { problems.push('faults: must be a list'); return []; }
  const ids = new Set(circuits.map(c => c.id));
  return list.map((f: unknown, i): FaultEvent => {
    const at = `faults[${i}]`;
    const o = isObj(f) ? f : {};
    if (!(typeof o.hour === 'number' && o.hour >= 0 && o.hour < 24)) problems.push(`${at}.hour: must be from 0 to below 24`);
    if (typeof o.circuit !== 'string' || !ids.has(o.circuit)) problems.push(`${at}.circuit: must be a circuit id`);
    return { hour: Number(o.hour), circuit: String(o.circuit), text: typeof o.text === 'string' && o.text ? o.text : 'A cable shorts' };
  });
}
