import { describe, expect, it } from 'vitest';
import {
  LAND_GRID_CELLS, LAND_GRID_CONFIG, landCellAt, landCellById
} from './land-grid.js';

describe('continuous land grid', () => {
  it('covers the implemented world without gaps or overlapping logical edges', () => {
    expect(LAND_GRID_CELLS[0]!.left).toBe(LAND_GRID_CONFIG.left);
    expect(LAND_GRID_CELLS.at(-1)!.right).toBe(LAND_GRID_CONFIG.right);
    for (let index = 0; index < LAND_GRID_CELLS.length - 1; index++) {
      expect(LAND_GRID_CELLS[index]!.right).toBe(LAND_GRID_CELLS[index + 1]!.left);
    }
    const buildingLots = LAND_GRID_CELLS.filter((cell) => cell.role === 'building');
    expect(buildingLots).toHaveLength(9);
    expect(buildingLots.every((cell) => cell.width === 273)).toBe(true);
    expect(buildingLots.every((cell) =>
      cell.width >= LAND_GRID_CONFIG.minimumWidth && cell.width <= LAND_GRID_CONFIG.maximumWidth
    )).toBe(true);
    expect(LAND_GRID_CELLS.filter((cell) => cell.role === 'passage')
      .every((cell) => cell.number === null && cell.width > 0)).toBe(true);
    expect(LAND_GRID_CELLS[0]!.left).toBe(0);
  });

  it('reserves the existing warehouse and the old inter-plot gap as real cells', () => {
    expect(landCellById(8)).toMatchObject({ centerX: 963, role: 'building' });
    expect(landCellById(9)).toMatchObject({ centerX: 1940, role: 'reserved-resource', resource: 'stone-main' });
    expect(landCellById(11)).toMatchObject({ left: 0, right: 213.5, role: 'reserved-resource', resource: 'home-wood' });
  });

  it('numbers cells in visible left-to-right order while preserving their stable IDs', () => {
    expect(LAND_GRID_CELLS.filter((cell) => cell.role !== 'passage').map(({ id, number }) => [id, number])).toEqual([
      [11, 1], [0, 2], [1, 3], [8, 4], [2, 5], [3, 6],
      [9, 7], [4, 8], [5, 9], [6, 10], [7, 11], [10, 12]
    ]);
    const numbered = LAND_GRID_CELLS.filter((cell) => cell.number !== null).map((cell) => cell.number!);
    expect(numbered).toEqual(
      [...numbered].sort((a, b) => a - b)
    );
  });

  it('uses the same inclusive-left, exclusive-right bounds for world hit testing', () => {
    const left = landCellById(1)!;
    const right = LAND_GRID_CELLS[LAND_GRID_CELLS.indexOf(left) + 1]!;
    expect(landCellAt(left.left, LAND_GRID_CONFIG.top)).toBe(left);
    expect(landCellAt(left.right - 0.001, LAND_GRID_CONFIG.bottom)).toBe(left);
    expect(landCellAt(left.right, LAND_GRID_CONFIG.top)).toBe(right);
    expect(landCellAt(left.centerX, LAND_GRID_CONFIG.top - 1)).toBeUndefined();
  });

  it('keeps every ordinary lot hitbox centered on its equal-width construction footprint', () => {
    const legacyBuildingCenters = new Map([
      [0, 350], [1, 690], [8, 963], [2, 1240], [3, 1590],
      [4, 2380], [5, 2780], [6, 3140], [7, 3500]
    ]);
    for (const cell of LAND_GRID_CELLS.filter((candidate) => candidate.role === 'building')) {
      expect(cell.centerX).toBe((cell.left + cell.right) / 2);
      expect(cell.width).toBe(273);
      expect(cell.centerX).toBe(legacyBuildingCenters.get(cell.id));
      expect(landCellAt(cell.centerX, (cell.top + cell.bottom) / 2)).toBe(cell);
      expect(landCellAt(cell.left - 0.001, cell.top)).not.toBe(cell);
      expect(landCellAt(cell.right, cell.top)).not.toBe(cell);
    }
  });
});
