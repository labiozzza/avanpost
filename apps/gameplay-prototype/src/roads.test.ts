import { describe, expect, it } from 'vitest';
import { advanceOnRoads, roadDistance, roadTravelSeconds, snapRoadPosition, type RoadSegment } from './roads.js';

const roads: RoadSegment[] = [{ id: 'road-1', x: 100 }];

describe('ground-road movement', () => {
  it('accelerates only the distance covered by a built road segment', () => {
    expect(roadDistance(0, 300, roads)).toBe(80);
    expect(roadTravelSeconds(0, 300, roads, 100)).toBeCloseTo(220 / 100 + 80 / 130);
    expect(advanceOnRoads(0, 300, 2.4, roads, 100)).toBeGreaterThan(240);
    expect(advanceOnRoads(0, 300, 2.4, [], 100)).toBe(240);
  });

  it('measures a 1.3 speed ratio on-road and normal speed after the segment is removed', () => {
    const onRoadSeconds = roadTravelSeconds(60, 140, roads, 100);
    const groundSeconds = roadTravelSeconds(60, 140, [], 100);
    expect(80 / onRoadSeconds).toBeCloseTo(100 * 1.3);
    expect(80 / groundSeconds).toBeCloseTo(100);
    expect(advanceOnRoads(60, 140, groundSeconds, [])).toBe(140);
  });

  it('uses the same road interval when walking in either direction', () => {
    expect(advanceOnRoads(300, 0, 2.4, roads, 100)).toBeLessThan(60);
    expect(roadTravelSeconds(300, 0, roads, 100)).toBeCloseTo(roadTravelSeconds(0, 300, roads, 100));
  });

  it('joins adjacent segments and never double-counts overlapping road', () => {
    const joined = [...roads, { id: 'road-2', x: 180 }, { id: 'road-3', x: 120 }];
    expect(roadDistance(0, 300, joined)).toBe(160);
  });

  it('snaps a placement to the segment lattice within world bounds', () => {
    expect(snapRoadPosition(101, 4000)).toBe(80);
    expect(snapRoadPosition(15, 4000)).toBeNull();
    expect(snapRoadPosition(Number.NaN, 4000)).toBeNull();
  });
});
