import { GlobalCoordinateSchema, type GlobalCoordinate } from '@avanpost/peace-v2-shared';

export interface SectorCoordinate {
  sectorX: number;
  sectorY: number;
  localX: number;
  localY: number;
}

function assertSectorSize(size: number): void {
  if (!Number.isSafeInteger(size) || size <= 0) {
    throw new RangeError('V2_SECTOR_SIZE_INVALID: sector size must be a positive safe integer.');
  }
}

function parseGlobalCoordinate(value: unknown): GlobalCoordinate {
  const result = GlobalCoordinateSchema.safeParse(value);
  if (!result.success) {
    throw new RangeError('V2_COORDINATE_INVALID: global coordinates must be signed safe integers.');
  }
  return result.data;
}

export function toSectorCoordinate(global: GlobalCoordinate, sectorSize: number): SectorCoordinate {
  assertSectorSize(sectorSize);
  const coordinate = parseGlobalCoordinate(global);
  const sectorX = Math.floor(coordinate.x / sectorSize);
  const sectorY = Math.floor(coordinate.y / sectorSize);
  return {
    sectorX,
    sectorY,
    localX: coordinate.x - sectorX * sectorSize,
    localY: coordinate.y - sectorY * sectorSize
  };
}

export function toGlobalCoordinate(sector: SectorCoordinate, sectorSize: number): GlobalCoordinate {
  assertSectorSize(sectorSize);
  for (const value of [sector.sectorX, sector.sectorY, sector.localX, sector.localY]) {
    if (!Number.isSafeInteger(value)) {
      throw new RangeError('V2_COORDINATE_INVALID: sector and local coordinates must be safe integers.');
    }
  }
  if (sector.localX < 0 || sector.localX >= sectorSize || sector.localY < 0 || sector.localY >= sectorSize) {
    throw new RangeError('V2_LOCAL_COORDINATE_OUT_OF_RANGE: local coordinate must belong to the declared sector.');
  }

  return parseGlobalCoordinate({
    x: sector.sectorX * sectorSize + sector.localX,
    y: sector.sectorY * sectorSize + sector.localY
  });
}
