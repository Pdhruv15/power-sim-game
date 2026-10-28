import { LOAD_TYPES, type Circuit, type LoadType, type VillaData } from './types';

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

/** Check raw JSON and return typed villa data, or throw a LevelError. */
export function parseVilla(raw: unknown): VillaData {
  const problems: string[] = [];
  if (!isObj(raw)) throw new LevelError(['the file must contain a JSON object']);

  const project = typeof raw.project === 'string' && raw.project.trim() ? raw.project : '';
  if (!project) problems.push('project: give the project a name');

  const orientation = raw.orientation ?? 0;
  if (typeof orientation !== 'number' || !Number.isFinite(orientation)) problems.push('orientation: must be a number of degrees');

  const supply = isObj(raw.supply) ? raw.supply : {};
  if (!isPositive(supply.voltage)) problems.push('supply.voltage: must be a positive number of volts');
  if (!isPositive(supply.mainBreakerA)) problems.push('supply.mainBreakerA: must be a positive number of amps');

  const solarKw = raw.solarKw ?? 0;
  if (typeof solarKw !== 'number' || !Number.isFinite(solarKw) || solarKw < 0) problems.push('solarKw: must be 0 or more');

  const circuits: Circuit[] = [];
  if (!Array.isArray(raw.circuits) || raw.circuits.length === 0) {
    problems.push('circuits: add at least one circuit');
  } else {
    const seen = new Set<string>();
    raw.circuits.forEach((c: unknown, i) => {
      const at = `circuits[${i}]`;
      if (!isObj(c)) { problems.push(`${at}: must be an object`); return; }
      const id = typeof c.id === 'string' ? c.id.trim() : '';
      if (!id) problems.push(`${at}.id: missing`);
      else if (seen.has(id)) problems.push(`${at}.id: "${id}" is used twice`);
      seen.add(id);
      if (typeof c.room !== 'string' || !c.room.trim()) problems.push(`${at}.room: missing`);
      if (!LOAD_TYPES.includes(c.type as LoadType)) problems.push(`${at}.type: must be one of ${LOAD_TYPES.join(', ')}`);
      if (!isPositive(c.kw)) problems.push(`${at}.kw: must be a positive number`);
      if (!isPositive(c.breakerA)) problems.push(`${at}.breakerA: must be a positive number`);
      circuits.push({ id, room: String(c.room ?? ''), type: c.type as LoadType, kw: Number(c.kw), breakerA: Number(c.breakerA) });
    });
  }

  if (problems.length) throw new LevelError(problems);
  return {
    project,
    orientation: orientation as number,
    supply: { voltage: supply.voltage as number, mainBreakerA: supply.mainBreakerA as number },
    solarKw: solarKw as number,
    circuits,
  };
}
