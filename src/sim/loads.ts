import { INSTANT_TRIP } from './breaker';
import { POWER_FACTOR, PROFILES } from './profiles';
import type { LoadType } from './types';

/** How a load behaves, which decides what it asks of the design. */
export type LoadBehaviour = 'heating' | 'motor' | 'electronics' | 'timed' | 'mixed';
export type LoadGroup = 'home' | 'building' | 'public';

export interface LoadInfo {
  type: LoadType;
  name: string;
  group: LoadGroup;
  behaviour: LoadBehaviour;
  /** A usual size for this load, in kW. */
  typicalKw: number;
  /** Current while starting, as a multiple of the running current. 1 means no surge. */
  startMultiple: number;
  /** What this load teaches, in one short sentence. */
  note: string;
}

const load = (type: LoadType, name: string, group: LoadGroup, behaviour: LoadBehaviour, typicalKw: number, startMultiple: number, note: string): [LoadType, LoadInfo] =>
  [type, { type, name, group, behaviour, typicalKw, startMultiple, note }];

/** Every load the game knows. Levels pick from these by type. */
export const LOAD_LIBRARY: Readonly<Record<LoadType, LoadInfo>> = Object.fromEntries([
  load('lighting', 'Lighting', 'home', 'timed', 1, 1, 'Small and steady, and busiest after dark.'),
  load('sockets', 'Sockets', 'home', 'mixed', 3, 1, 'Whatever people plug in, busiest around meals.'),
  load('ac', 'Room AC', 'home', 'motor', 2, 1, 'An inverter drive starts it gently, so it has no surge. Busiest on a hot afternoon.'),
  load('heater', 'Water heater', 'home', 'heating', 3, 1, 'A steady pull with no surge, so its breaker can sit close to its current.'),
  load('pump', 'Water pump', 'building', 'motor', 3, 6, 'A motor pulls about 6 times its running current to start, so its breaker must ride through that.'),
  load('lift', 'Lift', 'building', 'motor', 5.5, 5, 'A heavy motor that starts again and again, so its surge decides the breaker.'),
  load('computers', 'Computers', 'building', 'electronics', 2, 1, 'Busy in office hours and quiet at night.'),
  load('shop', 'Shop', 'public', 'mixed', 10, 1, 'Busy from morning to evening.'),
  load('school', 'School', 'public', 'mixed', 15, 1, 'Busy from morning to early afternoon, then nearly empty.'),
  load('ev', 'EV charger', 'public', 'timed', 7, 1, 'A big, steady pull for hours overnight, when little else is running.'),
  load('streetlight', 'Street lights', 'public', 'timed', 2, 1, 'Fully on all night and off all day.'),
  load('hospital', 'Clinic ward', 'public', 'electronics', 3, 1, 'Never really off, so a lost breaker here matters most.'),
]) as Record<LoadType, LoadInfo>;

/** Current at full load, on one phase. */
export const runningAmps = (kw: number, type: LoadType, volts: number): number => (kw * 1000) / (volts * POWER_FACTOR[type]);

/** Current in the moment a load starts. */
export const startAmps = (kw: number, type: LoadType, volts: number): number => runningAmps(kw, type, volts) * LOAD_LIBRARY[type].startMultiple;

/** A breaker opens at once when the current reaches its instant-trip level. */
export const tripsAtStart = (amps: number, breakerA: number, instant = INSTANT_TRIP): boolean => amps >= breakerA * instant;

/** Hour a surging load first starts in the day, or null if it has no surge. */
export function firstStartHour(type: LoadType): number | null {
  if (LOAD_LIBRARY[type].startMultiple <= 1) return null;
  return PROFILES[type].findIndex(v => v >= 0.5);
}
