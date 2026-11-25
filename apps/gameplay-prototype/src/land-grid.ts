export type GridEnvironment = 'air' | 'surface' | 'soil';
export type GridCellRole = 'building' | 'reserved-resource' | 'terrain';

export interface GridFootprint {
  widthCells: number;
  heightCells: number;
}

export interface GridAnchor {
  /** Left-most column occupied by the building. */
  column: number;
  /** Lowest row occupied by the building; the surface anchor is row 1. */
  row: number;
}

export interface LandGridCell {
  id: number;
  column: number;
  row: number;
  left: number;
  right: number;
  centerX: number;
  width: number;
  top: number;
  bottom: number;
  centerY: number;
  height: number;
  number: number | null;
  environment: GridEnvironment;
  role: GridCellRole;
  resource?: 'home-wood' | 'ore-main' | 'eastern-wood';
}

export type GridMode = 'off' | 'borders' | 'planning';
export type LandCellState =
  | 'closed' | 'unlockable' | 'unlocked' | 'clearing' | 'prepared' | 'occupied' | 'construction';

export interface LandGridConfig {
  left: number;
  right: number;
  top: number;
  bottom: number;
  cellSize: number;
  columns: number;
  rows: number;
  surfaceBoundaryRow: number;
  surfaceCellRow: number;
  groundY: number;
  minimumWidth: number;
  maximumWidth: number;
}

/** One square cell is 300 Phaser world units on both axes. */
export const CELL_SIZE = 300;
export const LAND_GRID_CONFIG: LandGridConfig = {
  left: 0,
  right: 4200,
  top: -300,
  bottom: 1800,
  cellSize: CELL_SIZE,
  columns: 14,
  rows: 7,
  surfaceBoundaryRow: 3,
  surfaceCellRow: 2,
  groundY: 600,
  minimumWidth: CELL_SIZE,
  maximumWidth: CELL_SIZE
} as const;

export const WORLD_GRID_CONFIG = LAND_GRID_CONFIG;

export function gridCellId(column: number, row: number): number {
  if (row === LAND_GRID_CONFIG.surfaceCellRow) {
    // Keep the old buildable-plot IDs stable while cell coordinates become 2D.
    return [11, 0, 1, 8, 2, 3, 9, 19, 4, 5, 6, 7, 10, 20][column] ?? -1;
  }
  return 1000 + row * LAND_GRID_CONFIG.columns + column;
}

const sourceBySurfaceColumn = new Map<number, LandGridCell['resource']>([
  [0, 'home-wood'],
  [6, 'ore-main'],
  [12, 'eastern-wood'],
  [13, 'eastern-wood']
]);

function environmentForRow(row: number): GridEnvironment {
  if (row < LAND_GRID_CONFIG.surfaceCellRow) return 'air';
  if (row === LAND_GRID_CONFIG.surfaceCellRow) return 'surface';
  return 'soil';
}

function makeGridCells(): LandGridCell[] {
  const cells: LandGridCell[] = [];
  for (let row = 0; row < LAND_GRID_CONFIG.rows; row += 1) {
    for (let column = 0; column < LAND_GRID_CONFIG.columns; column += 1) {
      const left = LAND_GRID_CONFIG.left + column * CELL_SIZE;
      const top = LAND_GRID_CONFIG.top + row * CELL_SIZE;
      const surfaceResource = row === LAND_GRID_CONFIG.surfaceCellRow
        ? sourceBySurfaceColumn.get(column)
        : undefined;
      cells.push({
        id: gridCellId(column, row),
        column,
        row,
        left,
        right: left + CELL_SIZE,
        centerX: left + CELL_SIZE / 2,
        width: CELL_SIZE,
        top,
        bottom: top + CELL_SIZE,
        centerY: top + CELL_SIZE / 2,
        height: CELL_SIZE,
        number: row === LAND_GRID_CONFIG.surfaceCellRow ? column + 1 : null,
        environment: environmentForRow(row),
        role: row !== LAND_GRID_CONFIG.surfaceCellRow
          ? 'terrain'
          : surfaceResource ? 'reserved-resource' : 'building',
        ...(surfaceResource ? { resource: surfaceResource } : {})
      });
    }
  }
  if (cells.length !== LAND_GRID_CONFIG.columns * LAND_GRID_CONFIG.rows) {
    throw new Error('World grid cell count does not match its dimensions.');
  }
  if (LAND_GRID_CONFIG.right - LAND_GRID_CONFIG.left !== LAND_GRID_CONFIG.columns * CELL_SIZE ||
      LAND_GRID_CONFIG.bottom - LAND_GRID_CONFIG.top !== LAND_GRID_CONFIG.rows * CELL_SIZE ||
      LAND_GRID_CONFIG.top + LAND_GRID_CONFIG.surfaceBoundaryRow * CELL_SIZE !== LAND_GRID_CONFIG.groundY ||
      LAND_GRID_CONFIG.top + LAND_GRID_CONFIG.surfaceCellRow * CELL_SIZE !==
        LAND_GRID_CONFIG.groundY - CELL_SIZE) {
    throw new Error('World grid dimensions and surface boundary must align to CELL_SIZE.');
  }
  return cells;
}

/** All implemented air, surface, and underground cells, in row-major order. */
export const LAND_GRID_CELLS = makeGridCells();
export const LAND_SURFACE_CELLS = LAND_GRID_CELLS.filter(
  (cell) => cell.row === LAND_GRID_CONFIG.surfaceCellRow
);

const cellsById = new Map(LAND_GRID_CELLS.map((cell) => [cell.id, cell]));
const cellsByCoordinate = new Map(LAND_GRID_CELLS.map((cell) => [`${cell.column}:${cell.row}`, cell]));

export function landCellById(id: number): LandGridCell | undefined {
  return cellsById.get(id);
}

export function landCellAtCoordinate(column: number, row: number): LandGridCell | undefined {
  return cellsByCoordinate.get(`${column}:${row}`);
}

export function landCellAt(x: number, y: number): LandGridCell | undefined {
  if (!Number.isFinite(x) || !Number.isFinite(y) ||
      x < LAND_GRID_CONFIG.left || x >= LAND_GRID_CONFIG.right ||
      y < LAND_GRID_CONFIG.top || y >= LAND_GRID_CONFIG.bottom) return undefined;
  const column = Math.floor((x - LAND_GRID_CONFIG.left) / CELL_SIZE);
  const row = Math.floor((y - LAND_GRID_CONFIG.top) / CELL_SIZE);
  return landCellAtCoordinate(column, row);
}

/**
 * The anchor is the left-most cell on the building's base row. Heights extend
 * upward from that row, so a 2×2 surface building occupies rows 0 and 1.
 */
export function cellsForFootprint(anchor: GridAnchor, footprint: GridFootprint): LandGridCell[] | null {
  if (!Number.isInteger(anchor.column) || !Number.isInteger(anchor.row) ||
      !Number.isInteger(footprint.widthCells) || !Number.isInteger(footprint.heightCells) ||
      footprint.widthCells < 1 || footprint.heightCells < 1) return null;
  const topRow = anchor.row - footprint.heightCells + 1;
  if (anchor.column < 0 || anchor.column + footprint.widthCells > LAND_GRID_CONFIG.columns ||
      topRow < 0 || anchor.row >= LAND_GRID_CONFIG.rows) return null;
  const cells: LandGridCell[] = [];
  for (let row = topRow; row <= anchor.row; row += 1) {
    for (let column = anchor.column; column < anchor.column + footprint.widthCells; column += 1) {
      const cell = landCellAtCoordinate(column, row);
      if (!cell) return null;
      cells.push(cell);
    }
  }
  return cells;
}

export function footprintCenterX(anchor: GridAnchor, footprint: GridFootprint): number {
  return LAND_GRID_CONFIG.left + (anchor.column + footprint.widthCells / 2) * CELL_SIZE;
}

export const LAND_GRID_EXPANSION_ORDER = [
  gridCellId(8, LAND_GRID_CONFIG.surfaceCellRow),
  gridCellId(9, LAND_GRID_CONFIG.surfaceCellRow),
  gridCellId(10, LAND_GRID_CONFIG.surfaceCellRow),
  gridCellId(11, LAND_GRID_CONFIG.surfaceCellRow)
] as const;

export const LAND_GRID_EASTERN_CELL_IDS = [
  ...LAND_GRID_EXPANSION_ORDER,
  gridCellId(12, LAND_GRID_CONFIG.surfaceCellRow),
  gridCellId(13, LAND_GRID_CONFIG.surfaceCellRow)
] as const;

/**
 * Old map-version IDs are accepted only by the one-time save migration. These
 * map to the corresponding surface row in the new uniform grid.
 */
const legacyLandColumnById: Readonly<Record<number, number>> = {
  11: 0,
  0: 1,
  1: 2,
  8: 3,
  2: 4,
  3: 5,
  9: 6,
  4: 8,
  5: 9,
  6: 10,
  7: 11,
  10: 12
};

export function legacyLandCellIdToGridId(legacyId: number): number | undefined {
  const column = legacyLandColumnById[legacyId];
  return column === undefined ? undefined : gridCellId(column, LAND_GRID_CONFIG.surfaceCellRow);
}

export function landCellNumber(id: number): number {
  const cell = landCellById(id);
  return cell?.number ?? (cell ? cell.row * LAND_GRID_CONFIG.columns + cell.column + 1 : id + 1);
}

export function cellStateLabel(state: LandCellState): string {
  switch (state) {
    case 'closed': return 'Закрыта';
    case 'unlockable': return 'Можно открыть';
    case 'unlocked': return 'Открыта · нужна расчистка';
    case 'clearing': return 'Расчищается';
    case 'prepared': return 'Подготовлена';
    case 'occupied': return 'Занята';
    case 'construction': return 'Идёт строительство';
  }
}

// Legacy one-dimensional geometry is kept solely to migrate mapVersion ≤ 7.
export interface LegacyLandGridCell {
  id: number;
  left: number;
  right: number;
  centerX: number;
  width: number;
  top: number;
  bottom: number;
  number: number | null;
  role: 'building' | 'reserved-resource' | 'passage';
  resource?: 'home-wood' | 'ore-main' | 'eastern-wood';
}

export const LEGACY_LAND_GRID_EXPANSION_ORDER = [4, 5, 6, 7] as const;
export const LEGACY_LAND_GRID_EASTERN_CELL_IDS = [4, 5, 6, 7, 10] as const;

const legacyLayout: readonly Omit<LegacyLandGridCell, 'centerX' | 'width' | 'top' | 'bottom' | 'number'>[] = [
  { id: 11, left: 0, right: 213.5, role: 'reserved-resource', resource: 'home-wood' },
  { id: 0, left: 213.5, right: 486.5, role: 'building' },
  { id: 12, left: 486.5, right: 553.5, role: 'passage' },
  { id: 1, left: 553.5, right: 826.5, role: 'building' },
  { id: 8, left: 826.5, right: 1099.5, role: 'building' },
  { id: 13, left: 1099.5, right: 1103.5, role: 'passage' },
  { id: 2, left: 1103.5, right: 1376.5, role: 'building' },
  { id: 14, left: 1376.5, right: 1453.5, role: 'passage' },
  { id: 3, left: 1453.5, right: 1726.5, role: 'building' },
  { id: 9, left: 1726.5, right: 2153.5, role: 'reserved-resource', resource: 'ore-main' },
  { id: 15, left: 2153.5, right: 2243.5, role: 'passage' },
  { id: 4, left: 2243.5, right: 2516.5, role: 'building' },
  { id: 16, left: 2516.5, right: 2643.5, role: 'passage' },
  { id: 5, left: 2643.5, right: 2916.5, role: 'building' },
  { id: 17, left: 2916.5, right: 3003.5, role: 'passage' },
  { id: 6, left: 3003.5, right: 3276.5, role: 'building' },
  { id: 18, left: 3276.5, right: 3363.5, role: 'passage' },
  { id: 7, left: 3363.5, right: 3636.5, role: 'building' },
  { id: 10, left: 3636.5, right: 4000, role: 'reserved-resource', resource: 'eastern-wood' }
];

export const LEGACY_LAND_GRID_CELLS: readonly LegacyLandGridCell[] = (() => {
  let number = 0;
  return [...legacyLayout].sort((a, b) => a.left - b.left).map((cell) => ({
    ...cell,
    centerX: (cell.left + cell.right) / 2,
    width: cell.right - cell.left,
    top: 290,
    bottom: 616,
    number: cell.role === 'passage' ? null : ++number
  }));
})();

export const LEGACY_PLOTS = LEGACY_LAND_GRID_CELLS.filter((cell) => cell.role !== 'passage').map((cell) => ({
  id: cell.id,
  x: cell.centerX,
  y: 600,
  role: cell.role,
  ...(cell.resource ? { resource: cell.resource } : {})
})).sort((a, b) => a.id - b.id);

export function legacyLandCellById(id: number): LegacyLandGridCell | undefined {
  return LEGACY_LAND_GRID_CELLS.find((cell) => cell.id === id);
}
