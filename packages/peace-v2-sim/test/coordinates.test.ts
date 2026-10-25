import { describe, expect, it } from 'vitest';
import { toGlobalCoordinate, toSectorCoordinate } from '../src/coordinates.js';

describe('signed world coordinate transforms', () => {
  it.each([
    { x: -129, y: -1 },
    { x: -128, y: -128 },
    { x: -1, y: 0 },
    { x: 0, y: 0 },
    { x: 127, y: 128 },
    { x: 255, y: 383 }
  ])('round-trips global coordinates %#', (global) => {
    const sector = toSectorCoordinate(global, 128);
    expect(toGlobalCoordinate(sector, 128)).toEqual(global);
    expect(sector.localX).toBeGreaterThanOrEqual(0);
    expect(sector.localX).toBeLessThan(128);
    expect(sector.localY).toBeGreaterThanOrEqual(0);
    expect(sector.localY).toBeLessThan(128);
  });

  it('uses floor-based sector ownership for negative coordinates', () => {
    expect(toSectorCoordinate({ x: -1, y: -129 }, 128)).toEqual({
      sectorX: -1,
      sectorY: -2,
      localX: 127,
      localY: 127
    });
  });

  it('rejects unsafe and out-of-sector local coordinates', () => {
    expect(() => toSectorCoordinate({ x: Number.MAX_SAFE_INTEGER + 1, y: 0 }, 128)).toThrow(
      'V2_COORDINATE_INVALID'
    );
    expect(() => toGlobalCoordinate({ sectorX: 0, sectorY: 0, localX: 128, localY: 0 }, 128)).toThrow(
      'V2_LOCAL_COORDINATE_OUT_OF_RANGE'
    );
    expect(() => toSectorCoordinate({ x: 0, y: 0 }, 0)).toThrow('V2_SECTOR_SIZE_INVALID');
  });
});
