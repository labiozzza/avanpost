import type { GlobalCoordinate, PeaceLadder, PeaceWorldSnapshot, UndergroundCell } from '@avanpost/peace-v2-shared';
import { coordinateKey } from './layout.js';

export const UNDERGROUND_NEIGHBOR_MASK = { north: 1, east: 2, south: 4, west: 8 } as const;

export interface UndergroundTileSpec {
  frame: number;
  flipX: boolean;
  flipY: boolean;
}

const TILE_SPECS: Record<number, UndergroundTileSpec> = {
  0: { frame: 4, flipX: false, flipY: false },
  1: { frame: 8, flipX: false, flipY: false },
  2: { frame: 5, flipX: false, flipY: false },
  3: { frame: 12, flipX: true, flipY: false },
  4: { frame: 10, flipX: false, flipY: true },
  5: { frame: 9, flipX: false, flipY: false },
  6: { frame: 12, flipX: true, flipY: true },
  7: { frame: 7, flipX: true, flipY: true },
  8: { frame: 6, flipX: false, flipY: false },
  9: { frame: 12, flipX: false, flipY: false },
  10: { frame: 4, flipX: false, flipY: false },
  11: { frame: 7, flipX: false, flipY: true },
  12: { frame: 13, flipX: false, flipY: false },
  13: { frame: 7, flipX: true, flipY: false },
  14: { frame: 7, flipX: false, flipY: false },
  15: { frame: 11, flipX: false, flipY: false }
};

export function undergroundTileForMask(mask: number): UndergroundTileSpec {
  return TILE_SPECS[mask & 15]!;
}

export function undergroundConnectionMask(
  cell: Pick<UndergroundCell, 'position' | 'state' | 'floorSupported'>,
  cells: ReadonlyMap<string, Pick<UndergroundCell, 'position' | 'state' | 'floorSupported'>>,
  ladders: readonly Pick<PeaceLadder, 'top' | 'bottom' | 'state'>[]
): number {
  const { x, y } = cell.position;
  const tunnelAt = (point: GlobalCoordinate) => cells.get(coordinateKey(point));
  const horizontallyConnected = (point: GlobalCoordinate) => {
    const neighbor = tunnelAt(point);
    return neighbor?.state === 'tunnel' && cell.floorSupported && neighbor.floorSupported;
  };
  const verticallyConnected = (point: GlobalCoordinate) => ladders.some((ladder) => ladder.state === 'complete' &&
    (coordinateKey(ladder.top) === coordinateKey(cell.position) && coordinateKey(ladder.bottom) === coordinateKey(point) ||
     coordinateKey(ladder.bottom) === coordinateKey(cell.position) && coordinateKey(ladder.top) === coordinateKey(point)));
  return (verticallyConnected({ x, y: y - 1 }) ? UNDERGROUND_NEIGHBOR_MASK.north : 0) |
    (horizontallyConnected({ x: x + 1, y }) ? UNDERGROUND_NEIGHBOR_MASK.east : 0) |
    (verticallyConnected({ x, y: y + 1 }) ? UNDERGROUND_NEIGHBOR_MASK.south : 0) |
    (horizontallyConnected({ x: x - 1, y }) ? UNDERGROUND_NEIGHBOR_MASK.west : 0);
}

export function undergroundFloorLine(cellTop: number, cellSize: number): number {
  // Tunnel source frames place the walking surface about 3/4 down the cell, not at its bottom edge.
  return cellTop + Math.round(cellSize * 0.76);
}
