import { describe, expect, it } from 'vitest';
import {
  CELL_SIZE, LAND_GRID_CELLS, LAND_GRID_CONFIG, LAND_SURFACE_CELLS,
  cellsForFootprint, gridCellId, landCellAt, landCellAtCoordinate, landCellById,
  legacyLandCellIdToGridId
} from './land-grid.js';

describe('continuous 2D world grid', () => {
  it('fills a rectangular world with identical square cells on both axes', () => {
    expect(LAND_GRID_CELLS).toHaveLength(LAND_GRID_CONFIG.columns * LAND_GRID_CONFIG.rows);
    for (const cell of LAND_GRID_CELLS) {
      expect(cell.width).toBe(CELL_SIZE);
      expect(cell.height).toBe(CELL_SIZE);
      expect(cell.right - cell.left).toBe(cell.bottom - cell.top);
      expect(cell.left).toBe(LAND_GRID_CONFIG.left + cell.column * CELL_SIZE);
      expect(cell.top).toBe(LAND_GRID_CONFIG.top + cell.row * CELL_SIZE);
    }
    for (let row = 0; row < LAND_GRID_CONFIG.rows; row += 1) {
      const cells = LAND_GRID_CELLS.filter((cell) => cell.row === row);
      expect(cells[0]!.left).toBe(LAND_GRID_CONFIG.left);
      expect(cells.at(-1)!.right).toBe(LAND_GRID_CONFIG.right);
      for (let index = 0; index < cells.length - 1; index += 1) {
        expect(cells[index]!.right).toBe(cells[index + 1]!.left);
      }
    }
    expect(LAND_GRID_CONFIG.top + LAND_GRID_CONFIG.surfaceBoundaryRow * CELL_SIZE)
      .toBe(LAND_GRID_CONFIG.groundY);
    expect(LAND_SURFACE_CELLS).toHaveLength(LAND_GRID_CONFIG.columns);
    expect(LAND_SURFACE_CELLS.every((cell) => cell.environment === 'surface' && cell.height === cell.width)).toBe(true);
    expect(LAND_GRID_CELLS.some((cell) => (cell.role as string) === 'passage')).toBe(false);
  });

  it('supports arbitrary rectangular footprints with a base-row anchor', () => {
    for (const footprint of [
      [1, 1], [2, 1], [1, 2], [2, 2], [3, 2], [2, 3], [3, 3], [8, 2]
    ]) {
      const cells = cellsForFootprint(
        { column: 2, row: LAND_GRID_CONFIG.surfaceCellRow },
        { widthCells: footprint[0]!, heightCells: footprint[1]! }
      );
      expect(cells).toHaveLength(footprint[0]! * footprint[1]!);
      expect(cells!.filter((cell) => cell.environment === 'surface')).toHaveLength(footprint[0]);
      expect(cells!.every((cell) => cell.environment === 'air' || cell.environment === 'surface')).toBe(true);
    }
    expect(cellsForFootprint({ column: 13, row: LAND_GRID_CONFIG.surfaceCellRow },
      { widthCells: 2, heightCells: 1 })).toBeNull();
    expect(cellsForFootprint({ column: 1, row: 0 }, { widthCells: 1, heightCells: 2 })).toBeNull();
    expect(cellsForFootprint({ column: 1, row: LAND_GRID_CONFIG.surfaceCellRow },
      { widthCells: 1, heightCells: 0 })).toBeNull();
    expect(cellsForFootprint({ column: 1, row: LAND_GRID_CONFIG.surfaceCellRow },
      { widthCells: 1, heightCells: 4 })).toBeNull();
  });

  it('uses inclusive-left and exclusive-right hit testing for both axes', () => {
    const cell = landCellAtCoordinate(3, LAND_GRID_CONFIG.surfaceCellRow)!;
    const right = landCellAtCoordinate(4, LAND_GRID_CONFIG.surfaceCellRow)!;
    const below = landCellAtCoordinate(3, LAND_GRID_CONFIG.surfaceCellRow + 1)!;
    expect(landCellAt(cell.left, cell.top)).toBe(cell);
    expect(landCellAt(cell.right - 0.001, cell.bottom - 0.001)).toBe(cell);
    expect(landCellAt(cell.right, cell.top)).toBe(right);
    expect(landCellAt(cell.left, cell.bottom)).toBe(below);
    expect(landCellAt(LAND_GRID_CONFIG.left - 1, cell.top)).toBeUndefined();
    expect(landCellAt(cell.left, LAND_GRID_CONFIG.bottom)).toBeUndefined();
    expect(landCellById(gridCellId(3, LAND_GRID_CONFIG.surfaceCellRow))).toBe(cell);
  });

  it('keeps resource sources as ordinary surface cells and maps legacy land IDs once', () => {
    expect(landCellAtCoordinate(0, LAND_GRID_CONFIG.surfaceCellRow)).toMatchObject({
      width: CELL_SIZE, height: CELL_SIZE, role: 'reserved-resource', resource: 'home-wood'
    });
    expect(landCellAtCoordinate(6, LAND_GRID_CONFIG.surfaceCellRow)).toMatchObject({
      width: CELL_SIZE, height: CELL_SIZE, role: 'reserved-resource', resource: 'stone-main'
    });
    expect(legacyLandCellIdToGridId(8)).toBe(gridCellId(3, LAND_GRID_CONFIG.surfaceCellRow));
    expect(legacyLandCellIdToGridId(9)).toBe(gridCellId(6, LAND_GRID_CONFIG.surfaceCellRow));
    expect(legacyLandCellIdToGridId(4)).toBe(gridCellId(8, LAND_GRID_CONFIG.surfaceCellRow));
    expect(legacyLandCellIdToGridId(14)).toBeUndefined();
  });
});
