/** Levels in play order. A level unlocks once the one before it has at least one star. */
export interface LevelEntry {
  id: string;
  number: number;
  title: string;
  /** Level file for a design level. Workshop and power-mix levels are built from src/game instead. */
  file?: string;
  /** A design level the player builds from an empty plan: what the build asks of them. */
  buildGoal?: string;
}

export const LEVELS: readonly LevelEntry[] = [
  { id: 'level-circuit', number: 1, title: 'Single circuit' },
  { id: 'level-room', number: 2, title: 'One room' },
  {
    id: 'level-1-villa', number: 3, title: 'One villa', file: 'data/villa.json',
    buildGoal: 'Build this villa from the street: a board, then a cable and a breaker to each room. Keep every room on for a whole day, and keep each cable safe.',
  },
  {
    id: 'level-2-two-villas', number: 4, title: 'Two villas', file: 'data/two-villas.json',
    buildGoal: 'Feed two villas from a pillar at the gate. Villa B is far away, so its feeder needs thought. Spread the rooms over L1, L2 and L3, and keep the voltage at every room within 5 %.',
  },
  {
    id: 'level-services', number: 5, title: 'Service block', file: 'data/services.json',
    buildGoal: 'Feed the services of a small block. Look each load up in the library: motors pull far more to start than to run, so their breakers need room for the surge.',
  },
  { id: 'level-3-building', number: 6, title: 'Apartment building', file: 'data/building.json' },
  {
    id: 'level-4-village', number: 7, title: 'Village', file: 'data/village.json',
    buildGoal: 'Build the village power: pick the transformer, place the village board and the lane pillars, then feed each home, the school and the shop. Homes are single-phase, so spread them over L1, L2 and L3.',
  },
  // Power-mix levels are built from src/game/mix.ts
  { id: 'level-mix-valley', number: 8, title: 'Valley villages' },
  { id: 'level-mix-city', number: 9, title: 'Small city' },
  { id: 'level-mix-metro', number: 10, title: 'Big city' },
];

/** The world the player lights up, step by step. Steps with no level yet are still to come. */
export const WORLD_MAP: readonly { name: string; level?: string }[] = [
  { name: 'Circuit', level: 'level-circuit' },
  { name: 'Room', level: 'level-room' },
  { name: 'Villa', level: 'level-1-villa' },
  { name: 'Street', level: 'level-2-two-villas' },
  { name: 'Block', level: 'level-services' },
  { name: 'Village', level: 'level-4-village' },
  { name: 'Villages', level: 'level-mix-valley' },
  { name: 'Small city', level: 'level-mix-city' },
  { name: 'Big city', level: 'level-mix-metro' },
];
