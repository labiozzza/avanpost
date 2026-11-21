export interface LandGridAnchor {
  id: number;
  centerX: number;
  role?: 'building' | 'reserved-resource';
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
  number: number;
  role: 'building' | 'reserved-resource';
  resource?: 'home-wood' | 'stone-main' | 'eastern-wood';
}

export type GridMode = 'off' | 'borders' | 'planning';
export type LandCellState =
  | 'closed' | 'unlockable' | 'unlocked' | 'clearing' | 'prepared' | 'occupied' | 'construction';

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
  minimumWidth: 275,
  maximumWidth: 420
} as const;

/**
 * Stable IDs keep old saves and fixtures readable. Geometry is sorted by world
 * position, so newly inserted cells never move an existing building.
 */
export const LAND_GRID_ANCHORS: readonly LandGridAnchor[] = [
  { id: 11, centerX: 112.5, role: 'reserved-resource', resource: 'home-wood' },
  { id: 0, centerX: 350 },
  { id: 1, centerX: 690 },
  { id: 8, centerX: 963 }, // the starting warehouse already occupies this reserved slot
  { id: 2, centerX: 1240 },
  { id: 3, centerX: 1590 },
  { id: 9, centerX: 1940, role: 'reserved-resource', resource: 'stone-main' }, // preserves the existing stone source
  { id: 4, centerX: 2380 },
  { id: 5, centerX: 2780 },
  { id: 6, centerX: 3140 },
  { id: 7, centerX: 3500 },
  { id: 10, centerX: 3840, role: 'reserved-resource', resource: 'eastern-wood' }
] as const;

export const LAND_GRID_EXPANSION_ORDER = [4, 5, 6, 7] as const;
export const LAND_GRID_EASTERN_CELL_IDS = [4, 5, 6, 7, 10] as const;

function makeCells(): LandGridCell[] {
  const anchors = [...LAND_GRID_ANCHORS].sort((a, b) => a.centerX - b.centerX);
  if (new Set(anchors.map((anchor) => anchor.id)).size !== anchors.length) {
    throw new Error('Land grid IDs must be unique.');
  }
  if (anchors[0]!.centerX <= LAND_GRID_CONFIG.left ||
      anchors.at(-1)!.centerX >= LAND_GRID_CONFIG.right) {
    throw new Error('Land grid anchors must be inside the world bounds.');
  }
  const edges: number[] = [LAND_GRID_CONFIG.left];
  for (let index = 0; index < anchors.length - 1; index++) {
    edges.push((anchors[index]!.centerX + anchors[index + 1]!.centerX) / 2);
  }
  edges.push(LAND_GRID_CONFIG.right);

  const cells = anchors.map((anchor, index): LandGridCell => ({
    id: anchor.id,
    left: edges[index]!,
    right: edges[index + 1]!,
    centerX: anchor.centerX,
    width: edges[index + 1]! - edges[index]!,
    top: LAND_GRID_CONFIG.top,
    bottom: LAND_GRID_CONFIG.bottom,
    // Labels follow the visible left-to-right world order. IDs stay stable so
    // old saves can still refer to the same land cells after the geometry change.
    number: index + 1,
    role: anchor.role ?? 'building',
    ...(anchor.resource ? { resource: anchor.resource } : {})
  }));

  for (let index = 0; index < cells.length; index++) {
    const cell = cells[index]!;
    if ((cell.role === 'building' && cell.width < LAND_GRID_CONFIG.minimumWidth) ||
        cell.width > LAND_GRID_CONFIG.maximumWidth) {
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
  }
}
