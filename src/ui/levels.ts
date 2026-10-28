/** Levels in play order. A level unlocks once the one before it has at least one star. */
export interface LevelEntry {
  id: string;
  number: number;
  title: string;
  file: string;
}

export const LEVELS: readonly LevelEntry[] = [
  { id: 'level-1-villa', number: 1, title: 'One villa', file: 'data/villa.json' },
  { id: 'level-2-two-villas', number: 2, title: 'Two villas', file: 'data/two-villas.json' },
];
