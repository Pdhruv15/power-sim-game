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

/**
 * Level n unlocks when level n−1 has at least one star. A level with a star at or after it stays open,
 * so players who got there before earlier levels were added keep their place.
 */
export function isUnlocked(index: number, ids: readonly string[], progress: Record<string, Best>): boolean {
  return index === 0 || ids.slice(index - 1).some(id => (progress[id]?.stars ?? 0) >= 1);
}

/** Coins, and what they have bought. */
export interface Wallet {
  coins: number;
  owned: string[];
}

const WALLET_KEY = 'power-sim:wallet:v1';

export function loadWallet(startingCoins: number): Wallet {
  try {
    const raw = localStorage.getItem(WALLET_KEY);
    const data = raw ? (JSON.parse(raw) as Partial<Wallet>) : null;
    if (data && typeof data.coins === 'number' && Array.isArray(data.owned)) return { coins: data.coins, owned: data.owned };
  } catch { /* storage blocked or damaged: start fresh */ }
  return { coins: startingCoins, owned: [] };
}

export function saveWallet(wallet: Wallet): void {
  try { localStorage.setItem(WALLET_KEY, JSON.stringify(wallet)); } catch { /* storage blocked: keep in memory only */ }
}
