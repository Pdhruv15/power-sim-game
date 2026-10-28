/** Best result per level, kept in this browser only. Storage can be missing or blocked, so every access is guarded. */
export interface Best {
  score: number;
  stars: number;
}

const KEY = 'power-sim:progress:v1';

export function loadProgress(): Record<string, Best> {
  try {
    const raw = localStorage.getItem(KEY);
    const data: unknown = raw ? JSON.parse(raw) : {};
    return typeof data === 'object' && data !== null ? (data as Record<string, Best>) : {};
  } catch {
    return {};
  }
}

/** Save a result if it beats the stored best. Returns the updated progress. */
export function saveResult(levelId: string, result: Best): Record<string, Best> {
  const all = loadProgress();
  const old = all[levelId];
  if (!old || result.stars > old.stars || (result.stars === old.stars && result.score > old.score)) {
    all[levelId] = result;
    try { localStorage.setItem(KEY, JSON.stringify(all)); } catch { /* storage blocked: keep in memory only */ }
  }
  return all;
}

/** Level n unlocks when level n−1 has at least one star. */
export function isUnlocked(index: number, ids: readonly string[], progress: Record<string, Best>): boolean {
  return index === 0 || (progress[ids[index - 1]]?.stars ?? 0) >= 1;
}
