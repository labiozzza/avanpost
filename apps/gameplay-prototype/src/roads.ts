export interface RoadSegment {
  id: string;
  /** Segment center in world coordinates. */
  x: number;
}

export const ROAD_CONFIG = {
  segmentLength: 80,
  visualWidth: 16,
  cost: { wood: 10, stone: 5 },
  constructionSeconds: 8,
  speedMultiplier: 1.3,
  demolitionRefund: 0.25,
  foundationClearance: 120
} as const;

type Interval = readonly [start: number, end: number];

function mergedRoadIntervals(fromX: number, toX: number, roads: readonly RoadSegment[]): Interval[] {
  const low = Math.min(fromX, toX);
  const high = Math.max(fromX, toX);
  const intervals = roads.map(({ x }) => [
    Math.max(low, x - ROAD_CONFIG.segmentLength / 2),
    Math.min(high, x + ROAD_CONFIG.segmentLength / 2)
  ] as const).filter(([start, end]) => end > start).sort((a, b) => a[0] - b[0]);
  const merged: Array<[number, number]> = [];
  for (const [start, end] of intervals) {
    const last = merged.at(-1);
    if (last && start <= last[1] + 1e-8) last[1] = Math.max(last[1], end);
    else merged.push([start, end]);
  }
  return merged;
}

/** Distance on actual road surface, with overlapping segments counted once. */
export function roadDistance(fromX: number, toX: number, roads: readonly RoadSegment[]): number {
  return mergedRoadIntervals(fromX, toX, roads).reduce((sum, [start, end]) => sum + end - start, 0);
}

/** Travel time makes road speed apply only while the route overlaps a built segment. */
export function roadTravelSeconds(
  fromX: number,
  toX: number,
  roads: readonly RoadSegment[],
  groundSpeed = 140.4
): number {
  const distance = Math.abs(toX - fromX);
  const onRoad = roadDistance(fromX, toX, roads);
  return (distance - onRoad) / groundSpeed + onRoad / (groundSpeed * ROAD_CONFIG.speedMultiplier);
}

/** Advance a resident through alternating ground and road intervals using one time budget. */
export function advanceOnRoads(
  fromX: number,
  toX: number,
  deltaSeconds: number,
  roads: readonly RoadSegment[],
  groundSpeed = 140.4
): number {
  if (!Number.isFinite(fromX) || !Number.isFinite(toX) || deltaSeconds <= 0) return fromX;
  const direction = Math.sign(toX - fromX);
  if (!direction) return toX;
  let x = fromX;
  let timeLeft = deltaSeconds;
  const intervals = mergedRoadIntervals(fromX, toX, roads);
  let boundariesCrossed = 0;

  while (timeLeft > 1e-9 && direction * (toX - x) > 1e-8 && boundariesCrossed++ < intervals.length * 2 + 3) {
    const interval = intervals.find(([start, end]) => direction > 0
      ? x >= start - 1e-8 && x < end - 1e-8
      : x > start + 1e-8 && x <= end + 1e-8);
    const speed = groundSpeed * (interval ? ROAD_CONFIG.speedMultiplier : 1);
    let boundary = toX;
    for (const [start, end] of intervals) {
      for (const candidate of [start, end]) {
        if (direction > 0 && candidate > x + 1e-8 && candidate < boundary) boundary = candidate;
        if (direction < 0 && candidate < x - 1e-8 && candidate > boundary) boundary = candidate;
      }
    }
    const distance = Math.abs(boundary - x);
    const timeToBoundary = distance / speed;
    if (timeToBoundary <= timeLeft + 1e-9) {
      x = boundary;
      timeLeft = Math.max(0, timeLeft - timeToBoundary);
    } else {
      x += direction * speed * timeLeft;
      timeLeft = 0;
    }
  }
  return direction * (toX - x) <= 1e-8 ? toX : x;
}

export function snapRoadPosition(x: number, worldWidth: number): number | null {
  if (!Number.isFinite(x) || worldWidth < ROAD_CONFIG.segmentLength) return null;
  const half = ROAD_CONFIG.segmentLength / 2;
  const snapped = Math.round(x / ROAD_CONFIG.segmentLength) * ROAD_CONFIG.segmentLength;
  if (snapped < half || snapped > worldWidth - half) return null;
  return snapped;
}
