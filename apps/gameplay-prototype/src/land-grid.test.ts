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
    expect(LAND_GRID_CELLS.every((cell) =>
      (cell.role === 'reserved-resource' || cell.width >= LAND_GRID_CONFIG.minimumWidth) &&
      cell.width <= LAND_GRID_CONFIG.maximumWidth
    )).toBe(true);
    expect(LAND_GRID_CELLS[0]!.left).toBe(0);
  });

  it('reserves the existing warehouse and the old inter-plot gap as real cells', () => {
    expect(landCellById(8)).toMatchObject({ centerX: 963, role: 'building' });
    expect(landCellById(9)).toMatchObject({ centerX: 1940, role: 'reserved-resource', resource: 'stone-main' });
    expect(landCellById(11)).toMatchObject({ left: 0, role: 'reserved-resource', resource: 'home-wood' });
  });

  it('numbers cells in visible left-to-right order while preserving their stable IDs', () => {
    expect(LAND_GRID_CELLS.map(({ id, number }) => [id, number])).toEqual([
      [11, 1], [0, 2], [1, 3], [8, 4], [2, 5], [3, 6],
      [9, 7], [4, 8], [5, 9], [6, 10], [7, 11], [10, 12]
    ]);
    expect(LAND_GRID_CELLS.map((cell) => cell.number)).toEqual(
      [...LAND_GRID_CELLS].map((cell) => cell.number).sort((a, b) => a - b)
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
});
