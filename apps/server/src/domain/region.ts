import { randomInt } from 'node:crypto';
import type { Kysely, Transaction } from 'kysely';
import {
  buildGraph,
  cellKey,
  generateTerrain,
  mixSeed,
  pickBiome,
  reachableFrom,
  settlementOrigin,
  type GraphModifier,
  type WorldGraph
} from '@avanpost/sim';
import type {
  ClearingTask,
  FrontierSector,
  SectorStatus,
  TerrainType,
  WorldStats
} from '@avanpost/shared';
import type { WorldBalance } from '../balance';
import { seedResidents } from './population';
import type {
  BuildingTable,
  ClearingJobTable,
  DB,
  TerrainCellTable,
  WorldSectorTable
} from '../db/schema';
import { createEconomy } from './economy';

export interface RegionCell extends TerrainCellTable {
  globalX: number;
  globalY: number;
}

export interface Region {
  sectors: WorldSectorTable[];
  cellsBySector: Map<string, RegionCell[]>;
  cells: RegionCell[];
  activeJobs: ClearingJobTable[];
  doneJobCount: number;
  reachable: Set<string>;
  cartReachable: Set<string>;
  graph: WorldGraph;
  cartGraph: WorldGraph;
  buildings: BuildingTable[];
  moveCostByKey: Map<string, number>;
  sectorById: Map<string, WorldSectorTable>;
}

type Queryable = Kysely<DB> | Transaction<DB>;

function startKey(sector: WorldSectorTable): string {
  const x = Math.floor(sector.width * 0.45) + 2;
  const y = Math.floor(sector.height * 0.4) + 2;
  return cellKey(sector.x * sector.width + x, sector.y * sector.height + y);
}

export function globalKey(sector: WorldSectorTable, cell: RegionCell): string {
  return cellKey(cell.globalX, cell.globalY);
}

export function globalKeyFor(
  region: Region,
  sectorId: string,
  x: number,
  y: number
): string | null {
  const sector = region.sectorById.get(sectorId);
  if (!sector) return null;
  return cellKey(sector.x * sector.width + x, sector.y * sector.height + y);
}

export function localizeGlobal(
  region: Region,
  globalX: number,
  globalY: number
): { sectorId: string; x: number; y: number } | null {
  for (const sector of region.sectors) {
    const localX = globalX - sector.x * sector.width;
    const localY = globalY - sector.y * sector.height;
    if (localX < 0 || localY < 0 || localX >= sector.width || localY >= sector.height) {
      continue;
    }
    return { sectorId: sector.id, x: localX, y: localY };
  }
  return null;
}

export async function loadRegion(
  queryable: Queryable,
  ownerId: string,
  balance: WorldBalance
): Promise<Region> {
  const sectors = await queryable
    .selectFrom('world_sector')
    .selectAll()
    .where('owner_id', '=', ownerId)
    .orderBy('x')
    .orderBy('y')
    .execute();

  const sectorIds = sectors.map((sector) => sector.id);
  const terrain =
    sectorIds.length > 0
      ? await queryable
          .selectFrom('terrain_cell')
          .selectAll()
          .where('sector_id', 'in', sectorIds)
          .execute()
      : [];

  const jobs = await queryable
    .selectFrom('clearing_job')
    .selectAll()
    .where('owner_id', '=', ownerId)
    .execute();

  const buildings = await queryable
    .selectFrom('building')
    .selectAll()
    .where('owner_id', '=', ownerId)
    .where('status', '<>', 'demolished')
    .execute();

  const sectorById = new Map(sectors.map((sector) => [sector.id, sector]));
  const cellsBySector = new Map<string, RegionCell[]>();
  const cells: RegionCell[] = [];

  for (const cell of terrain) {
    const sector = sectorById.get(cell.sector_id);
    if (!sector) continue;
    const regionCell: RegionCell = {
      ...cell,
      globalX: sector.x * sector.width + cell.x,
      globalY: sector.y * sector.height + cell.y
    };
    const list = cellsBySector.get(cell.sector_id) ?? [];
    list.push(regionCell);
    cellsBySector.set(cell.sector_id, list);
    cells.push(regionCell);
  }

  const sectorByIdForBuildings = new Map(sectors.map((sector) => [sector.id, sector]));
  const modifiers: GraphModifier[] = [];
  const moveCostByKey = new Map<string, number>();
  for (const building of buildings) {
    if (building.status !== 'complete' && building.status !== 'demolition') continue;
    const sector = sectorByIdForBuildings.get(building.sector_id);
    const rule = balance.buildings[building.type];
    if (!sector || !rule) continue;
    const globalX = sector.x * sector.width + building.x;
    const globalY = sector.y * sector.height + building.y;
    if (rule.walkable) {
      modifiers.push({
        x: globalX,
        y: globalY,
        passable: true,
        moveCost: rule.moveCost ?? 1,
        cartPassable: rule.cartPassable
      });
      moveCostByKey.set(cellKey(globalX, globalY), rule.moveCost ?? 1);
    } else {
      modifiers.push({ x: globalX, y: globalY, passable: false });
    }
  }

  const graphCells = cells.map((cell) => ({
    x: cell.globalX,
    y: cell.globalY,
    type: cell.terrain_type
  }));
  const graph = buildGraph(graphCells, balance.terrains, 'person', modifiers);
  const cartGraph = buildGraph(graphCells, balance.terrains, 'cart', modifiers);

  const anchorSector =
    sectors.find((sector) => sector.x === 0 && sector.y === 0) ?? sectors[0];
  const anchor = anchorSector ? startKey(anchorSector) : null;

  return {
    sectors,
    cellsBySector,
    cells,
    activeJobs: jobs.filter((job) => job.status === 'active'),
    doneJobCount: jobs.filter((job) => job.status === 'done').length,
    reachable: anchor ? reachableFrom(graph, anchor) : new Set(),
    cartReachable: anchor ? reachableFrom(cartGraph, anchor) : new Set(),
    graph,
    cartGraph,
    buildings,
    moveCostByKey,
    sectorById: new Map(sectors.map((sector) => [sector.id, sector]))
  };
}

export function findSector(
  region: Region,
  sectorX: number,
  sectorY: number
): WorldSectorTable | undefined {
  return region.sectors.find(
    (sector) => sector.x === sectorX && sector.y === sectorY
  );
}

const NEIGHBORS: ReadonlyArray<readonly [number, number]> = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1]
];

export function hasReachableNeighbor(region: Region, cell: RegionCell): boolean {
  if (region.reachable.has(globalKeyByCoords(cell.globalX, cell.globalY))) return true;
  return NEIGHBORS.some(([dx, dy]) =>
    region.reachable.has(globalKeyByCoords(cell.globalX + dx, cell.globalY + dy))
  );
}

function globalKeyByCoords(x: number, y: number): string {
  return cellKey(x, y);
}

export function frontierSectors(
  region: Region,
  worldSeed: number,
  balance: WorldBalance
): FrontierSector[] {
  const existing = new Set(region.sectors.map((sector) => `${sector.x}:${sector.y}`));
  const seen = new Set<string>();
  const frontier: FrontierSector[] = [];

  for (const sector of region.sectors) {
    for (const [dx, dy] of NEIGHBORS) {
      const x = sector.x + dx;
      const y = sector.y + dy;
      const key = `${x}:${y}`;
      if (existing.has(key) || seen.has(key)) continue;
      seen.add(key);
      const biome = pickBiome(mixSeed(worldSeed, x, y), balance.biomes);
      frontier.push({
        x,
        y,
        biome: biome.id,
        cost: balance.sector.unlock.cost,
        economyEnabled: balance.economyEnabled
      });
    }
  }

  return frontier.sort((a, b) => a.y - b.y || a.x - b.x);
}

export function clearingTasks(
  region: Region,
  balance: WorldBalance
): ClearingTask[] {
  const jobByCell = new Map(
    region.activeJobs.map((job) => [`${job.sector_id}:${job.x}:${job.y}`, job])
  );
  const tasks: ClearingTask[] = [];

  for (const sector of region.sectors) {
    for (const cell of region.cellsBySector.get(sector.id) ?? []) {
      const rule = balance.terrains[cell.terrain_type];
      if (!rule?.clearable || cell.passable) continue;
      if (!hasReachableNeighbor(region, cell)) continue;
      const job = jobByCell.get(`${cell.sector_id}:${cell.x}:${cell.y}`);
      tasks.push({
        sectorId: sector.id,
        sectorX: sector.x,
        sectorY: sector.y,
        x: cell.x,
        y: cell.y,
        terrain: cell.terrain_type,
        workDone: job?.work_done ?? 0,
        workRequired: job?.work_required ?? rule.clearingWork,
        active: Boolean(job)
      });
    }
  }

  return tasks
    .sort((a, b) => a.sectorY - b.sectorY || a.sectorX - b.sectorX || a.y - b.y || a.x - b.x)
    .slice(0, balance.clearing.maxTasks);
}

export function regionStats(region: Region): WorldStats {
  let blocked = 0;
  for (const cell of region.cells) {
    if (!cell.passable) blocked += 1;
  }
  return {
    sectors: region.sectors.length,
    cells: region.cells.length,
    reachable: region.reachable.size,
    cartReachable: region.cartReachable.size,
    blocked,
    activeClearings: region.activeJobs.length,
    clearedCells: region.doneJobCount,
    preparedSectors: region.sectors.filter((sector) => sector.status === 'prepared')
      .length,
    storageVolume: 0,
    storageCapacity: 0,
    activeHauls: 0,
    activeTransfers: 0,
    idleCarriers: 0,
    activeNodes: 0,
    buildings: 0,
    buildingsComplete: 0,
    builders: 0,
    idleBuilders: 0
  };
}

export function sectorHasReachableCell(region: Region, sectorId: string): boolean {
  const sector = region.sectors.find((item) => item.id === sectorId);
  if (!sector) return false;
  return (region.cellsBySector.get(sectorId) ?? []).some((cell) =>
    region.reachable.has(globalKey(sector, cell))
  );
}

export async function refreshSectorStatuses(
  db: Kysely<DB>,
  ownerId: string,
  balance: WorldBalance
): Promise<void> {
  const region = await loadRegion(db, ownerId, balance);
  for (const sector of region.sectors) {
    const active = region.activeJobs.some((job) => job.sector_id === sector.id);
    const reachable = sectorHasReachableCell(region, sector.id);
    const status: SectorStatus = active
      ? 'clearing'
      : reachable
        ? 'prepared'
        : 'unlocked';
    if (status !== sector.status) {
      await db
        .updateTable('world_sector')
        .set({ status })
        .where('id', '=', sector.id)
        .execute();
    }
  }
}

export interface NewWorldResult {
  worldSeed: number;
  sectorId: string;
  biome: string;
  seed: number;
}

export async function createPlayerWorld(
  db: Kysely<DB>,
  playerId: string,
  balance: WorldBalance,
  now: Date
): Promise<NewWorldResult> {
  const worldSeed = randomInt(1, 2_147_483_646);
  const seed = mixSeed(worldSeed, 0, 0);
  const biome = pickBiome(seed, balance.biomes);
  const { width, height } = balance.sector;
  const sectorId = crypto.randomUUID();
  const origin = settlementOrigin(width, height);
  const terrain = generateTerrain(seed, width, height, biome, balance.terrains, {
    stampOutcrop: balance.clearing.stampOutcrop
  });

  await db.transaction().execute(async (trx) => {
    await trx
      .insertInto('world_state')
      .values({
        owner_id: playerId,
        tick: 0,
        version: 0,
        world_seed: worldSeed,
        updated_at: now
      })
      .execute();

    await trx
      .insertInto('world_sector')
      .values({
        id: sectorId,
        owner_id: playerId,
        x: 0,
        y: 0,
        width,
        height,
        biome: biome.id,
        status: 'prepared',
        seed,
        created_at: now
      })
      .execute();

    for (let offset = 0; offset < terrain.length; offset += 500) {
      const chunk = terrain.slice(offset, offset + 500);
      await trx
        .insertInto('terrain_cell')
        .values(
          chunk.map((cell) => ({
            sector_id: sectorId,
            x: cell.x,
            y: cell.y,
            terrain_type: cell.type,
            obstacle: cell.obstacle,
            passable: cell.passable
          }))
        )
        .execute();
    }

    await createEconomy(trx, playerId, sectorId, origin, balance, now);
    await seedResidents(trx, playerId, now);
  });

  return { worldSeed, sectorId, biome: biome.id, seed };
}

export interface NewSectorPlan {
  x: number;
  y: number;
  seed: number;
  biome: string;
  width: number;
  height: number;
  terrain: ReturnType<typeof generateTerrain>;
}

export function planSector(
  worldSeed: number,
  x: number,
  y: number,
  balance: WorldBalance
): NewSectorPlan {
  const seed = mixSeed(worldSeed, x, y);
  const biome = pickBiome(seed, balance.biomes);
  const { width, height } = balance.sector;
  return {
    x,
    y,
    seed,
    biome: biome.id,
    width,
    height,
    terrain: generateTerrain(seed, width, height, biome, balance.terrains, {
      stampOutcrop: balance.clearing.stampOutcrop
    })
  };
}

export function terrainRule(balance: WorldBalance, type: TerrainType) {
  return balance.terrains[type];
}
