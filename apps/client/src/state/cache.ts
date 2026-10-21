import type { WorldSnapshot } from '@avanpost/shared';

const CACHE_KEY = 'avanpost.snapshot.v5';

export interface CachedSnapshot {
  savedAt: string;
  snapshot: WorldSnapshot;
}

export function saveSnapshot(snapshot: WorldSnapshot): void {
  try {
    const payload: CachedSnapshot = {
      savedAt: new Date().toISOString(),
      snapshot
    };
    localStorage.setItem(CACHE_KEY, JSON.stringify(payload));
  } catch {
    // cache is best-effort
  }
}

export function loadSnapshot(): CachedSnapshot | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CachedSnapshot;
    if (!parsed.snapshot?.player?.id || !Array.isArray(parsed.snapshot.sectors)) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}
