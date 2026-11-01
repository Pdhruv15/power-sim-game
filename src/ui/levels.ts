/** Levels in play order. A level unlocks once the one before it has at least one star. */
export interface LevelEntry {
  id: string;
  number: number;
  title: string;
  /** Level file for a design level. Workshop levels are built from src/game/workshop.ts instead. */
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
  { id: 'level-3-building', number: 5, title: 'Apartment building', file: 'data/building.json' },
  { id: 'level-4-village', number: 6, title: 'Village', file: 'data/village.json' },
];

/** The world the player lights up, step by step. Steps with no level yet are still to come. */
export const WORLD_MAP: readonly { name: string; level?: string }[] = [
  { name: 'Circuit', level: 'level-circuit' },
  { name: 'Room', level: 'level-room' },
  { name: 'Villa', level: 'level-1-villa' },
  { name: 'Street', level: 'level-2-two-villas' },
  { name: 'Village', level: 'level-4-village' },
  { name: 'Villages' },
  { name: 'Small city' },
  { name: 'Big city' },
];
