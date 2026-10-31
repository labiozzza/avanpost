import type { PeaceWorldSnapshot } from '@avanpost/peace-v2-shared';
import { BUILDING_LAYOUT_VERSION, occupiedFootprintCells } from '@avanpost/peace-v2-sim';

export interface OccupancyDatabase {
  query(sql: string, values?: unknown[]): Promise<{ rowCount?: number | null } | unknown>;
}

export class OccupiedCellsConflictError extends Error {
  constructor() {
    super('G5_OCCUPIED_CELLS_CONFLICT');
    this.name = 'OccupiedCellsConflictError';
  }
}

export async function replaceWorldOccupiedCells(
  database: OccupancyDatabase,
  worldId: string,
  world: PeaceWorldSnapshot
): Promise<void> {
  const buildingVersions = new Map(world.buildings.map((building) => [building.id, building.layoutVersion]));
  const cells = occupiedFootprintCells(world).map((cell) => ({
    cell_x: cell.x,
    cell_y: cell.y,
    entity_id: cell.entityId,
    entity_kind: cell.entityKind,
    layout_version: cell.entityKind === 'building' ? buildingVersions.get(cell.entityId) ?? BUILDING_LAYOUT_VERSION : 1
  }));
  const occupied = new Set<string>();
  for (const cell of cells) {
    const key = `${cell.cell_x},${cell.cell_y}`;
    if (occupied.has(key)) throw new OccupiedCellsConflictError();
    occupied.add(key);
  }

  await database.query('DELETE FROM peace_v2_occupied_cell WHERE world_id = $1', [worldId]);
  if (cells.length === 0) return;
  await database.query(
    `INSERT INTO peace_v2_occupied_cell (world_id, cell_x, cell_y, entity_id, entity_kind, layout_version)
     SELECT $1, cells.cell_x, cells.cell_y, cells.entity_id, cells.entity_kind, cells.layout_version
     FROM jsonb_to_recordset($2::jsonb) AS cells(
       cell_x integer, cell_y integer, entity_id text, entity_kind text, layout_version integer
     )`,
    [worldId, JSON.stringify(cells)]
  );
}
