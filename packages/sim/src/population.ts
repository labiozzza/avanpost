export interface PopulationRules {
  baseCapacity: number;
  housingCapacityPerHouse: number;
  startingResidents: number;
}

/**
 * GDD 3.1 (line 172): a finished house adds living space; the settlement grows
 * only while there are free slots. Test 15 (line 963): no free houses means the
 * population stops growing.
 */
export function housingCapacity(
  finishedHouses: number,
  rules: PopulationRules
): number {
  const houses = Math.max(0, Math.floor(finishedHouses));
  return rules.baseCapacity + rules.housingCapacityPerHouse * houses;
}

export function freeSlots(residents: number, capacity: number): number {
  return Math.max(0, Math.floor(capacity) - Math.max(0, Math.floor(residents)));
}

export function canMigrate(
  residents: number,
  capacity: number,
  enabled: boolean
): boolean {
  return enabled && freeSlots(residents, capacity) > 0;
}

/** Deterministic identity for an incoming resident: name index and traits index. */
export function nextResidentIndex(
  residents: readonly { name: string }[],
  knownNames: readonly string[]
): number {
  if (knownNames.length === 0) return residents.length;
  const taken = new Set(residents.map((resident) => resident.name));
  for (let index = 0; index < knownNames.length; index += 1) {
    const candidate = knownNames[index];
    if (candidate !== undefined && !taken.has(candidate)) {
      return index;
    }
  }
  return residents.length;
}

export interface XpCurve {
  levelThresholds: readonly number[];
}

/** Level starts at 1. Thresholds are cumulative totals for reaching the next level. */
export function levelFor(xp: number, curve: XpCurve): number {
  const total = Math.max(0, Math.floor(xp));
  let level = 1;
  for (const threshold of curve.levelThresholds) {
    if (total >= threshold) {
      level += 1;
    } else {
      break;
    }
  }
  return level;
}

/** XP still needed to reach the following level, and the span of the current one. */
export function levelProgress(
  xp: number,
  curve: XpCurve
): { level: number; into: number; span: number; toNext: number } {
  const total = Math.max(0, Math.floor(xp));
  const level = levelFor(total, curve);
  const thresholds = curve.levelThresholds;
  const lower = level <= 1 ? 0 : (thresholds[level - 2] ?? 0);
  const upper = thresholds[level - 1];
  if (upper === undefined) {
    // Max level reached: keep the bar full against the last span.
    const span = Math.max(1, lower);
    return { level, into: span, span, toNext: 0 };
  }
  const span = Math.max(1, upper - lower);
  const into = Math.max(0, Math.min(span, total - lower));
  return { level, into, span, toNext: Math.max(0, upper - total) };
}
