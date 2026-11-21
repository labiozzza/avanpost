export interface LandGridAnchor {
  id: number;
  centerX: number;
  role?: 'building' | 'reserved-resource' | 'passage';
  resource?: 'home-wood' | 'stone-main' | 'eastern-wood';
}

export interface LandGridCell {
  id: number;
  left: number;
  right: number;
  centerX: number;
  width: number;
  top: number;
  bottom: number;
  number: number | null;
  role: 'building' | 'reserved-resource' | 'passage';
  resource?: 'home-wood' | 'stone-main' | 'eastern-wood';
}

export type GridMode = 'off' | 'borders' | 'planning';
export type LandCellState =
  | 'closed' | 'unlockable' | 'unlocked' | 'clearing' | 'prepared' | 'occupied' | 'construction' | 'passage';

export interface LandGridConfig {
  left: number;
  right: number;
  top: number;
  bottom: number;
  minimumWidth: number;
  maximumWidth: number;
}

export const LAND_GRID_CONFIG: LandGridConfig = {
  left: 0,
  right: 4000,
  top: 290,
  bottom: 616,
  minimumWidth: 273,
  maximumWidth: 420
} as const;

/**
 * Building lots have one fixed 273 world-unit footprint. Narrow pass-through
 * strips fill the historic gaps between their stable centers, so older
 * buildings stay in their original lots while the actual lots become equal.
 * The original land IDs remain unchanged for save compatibility.
 */
interface LandGridLayoutCell {
  id: number;
  left: number;
  right: number;
  role: 'building' | 'reserved-resource' | 'passage';
  resource?: 'home-wood' | 'stone-main' | 'eastern-wood';
}

export const LAND_GRID_LAYOUT: readonly LandGridLayoutCell[] = [
  { id: 11, left: 0, right: 213.5, role: 'reserved-resource', resource: 'home-wood' },
  { id: 0, left: 213.5, right: 486.5, role: 'building' },
  { id: 12, left: 486.5, right: 553.5, role: 'passage' },
  { id: 1, left: 553.5, right: 826.5, role: 'building' },
  { id: 8, left: 826.5, right: 1099.5, role: 'building' },
  { id: 13, left: 1099.5, right: 1103.5, role: 'passage' },
  { id: 2, left: 1103.5, right: 1376.5, role: 'building' },
  { id: 14, left: 1376.5, right: 1453.5, role: 'passage' },
  { id: 3, left: 1453.5, right: 1726.5, role: 'building' },
  { id: 9, left: 1726.5, right: 2153.5, role: 'reserved-resource', resource: 'stone-main' },
  { id: 15, left: 2153.5, right: 2243.5, role: 'passage' },
  { id: 4, left: 2243.5, right: 2516.5, role: 'building' },
  { id: 16, left: 2516.5, right: 2643.5, role: 'passage' },
  { id: 5, left: 2643.5, right: 2916.5, role: 'building' },
  { id: 17, left: 2916.5, right: 3003.5, role: 'passage' },
  { id: 6, left: 3003.5, right: 3276.5, role: 'building' },
  { id: 18, left: 3276.5, right: 3363.5, role: 'passage' },
  { id: 7, left: 3363.5, right: 3636.5, role: 'building' },
  { id: 10, left: 3636.5, right: 4000, role: 'reserved-resource', resource: 'eastern-wood' }
] as const;

export const LAND_GRID_EXPANSION_ORDER = [4, 5, 6, 7] as const;
export const LAND_GRID_EASTERN_CELL_IDS = [4, 5, 6, 7, 10] as const;

function makeCells(): LandGridCell[] {
  const layout = [...LAND_GRID_LAYOUT].sort((a, b) => a.left - b.left);
  if (new Set(layout.map((cell) => cell.id)).size !== layout.length) {
    throw new Error('Land grid IDs must be unique.');
  }
  let number = 0;
  const cells = layout.map((entry): LandGridCell => ({
    id: entry.id,
    left: entry.left,
    right: entry.right,
    centerX: (entry.left + entry.right) / 2,
    width: entry.right - entry.left,
    top: LAND_GRID_CONFIG.top,
    bottom: LAND_GRID_CONFIG.bottom,
    // Land parcel numbering stays stable; pass-through strips are not plots.
    number: entry.role === 'passage' ? null : ++number,
    role: entry.role,
    ...(entry.resource ? { resource: entry.resource } : {})
  }));

  for (let index = 0; index < cells.length; index++) {
    const cell = cells[index]!;
    if (cell.role === 'building' &&
        (cell.width < LAND_GRID_CONFIG.minimumWidth || cell.width > LAND_GRID_CONFIG.maximumWidth)) {
      throw new Error(`Land cell ${cell.id} width ${cell.width} is outside the safe range.`);
    }
    const next = cells[index + 1];
    if (next && cell.right !== next.left) {
      throw new Error(`Land cells ${cell.id} and ${next.id} are not contiguous.`);
    }
  }
  if (cells[0]!.left !== LAND_GRID_CONFIG.left || cells.at(-1)!.right !== LAND_GRID_CONFIG.right) {
    throw new Error('Land grid must reserve the complete implemented world.');
  }
  return cells;
}

export const LAND_GRID_CELLS = makeCells();

export function landCellById(id: number): LandGridCell | undefined {
  return LAND_GRID_CELLS.find((cell) => cell.id === id);
}

export function landCellAt(x: number, y: number): LandGridCell | undefined {
  if (y < LAND_GRID_CONFIG.top || y > LAND_GRID_CONFIG.bottom) return undefined;
  return LAND_GRID_CELLS.find((cell) => x >= cell.left && x < cell.right);
}

export function cellStateLabel(state: LandCellState): string {
  switch (state) {
    case 'closed': return 'Закрыта';
    case 'unlockable': return 'Можно открыть';
    case 'unlocked': return 'Открыта · нужна расчистка';
    case 'clearing': return 'Расчищается';
    case 'prepared': return 'Подготовлена';
    case 'occupied': return 'Занята зданием';
    case 'construction': return 'Идёт строительство';
    case 'passage': return 'Проход · без застройки';
  }
}
