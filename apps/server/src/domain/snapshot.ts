import type { Kysely } from 'kysely';
import { SIM_VERSION } from '@avanpost/sim';
import type {
  BuildingSnapshot,
  BuildingStatus,
  HaulState,
  HaulTaskSnapshot,
  LaborerSnapshot,
  ResourceNodeSnapshot,
  ResidentSnapshot,
  SectorSnapshot,
  StorageSnapshot,
  TerrainCell,
  TransferState,
  TransferTaskSnapshot,
  WorldSnapshot
} from '@avanpost/shared';
import { toCatalog, type WorldBalance } from '../balance';
import type { Config } from '../config';
import type { DB } from '../db/schema';
import { loadBuildings } from './construction';
import { loadResidents } from './population';
import { loadEconomy } from './economy';
import {
  clearingTasks,
  frontierSectors,
  loadRegion,
  regionStats,
  globalKey
} from './region';

export async function buildSnapshot(
  db: Kysely<DB>,
  playerId: string,
  config: Config,
  balance: WorldBalance,
  now: Date
): Promise<WorldSnapshot> {
  const player = await db
    .selectFrom('players')
    .selectAll()
    .where('id', '=', playerId)
    .executeTakeFirstOrThrow();

  const state = await db
    .selectFrom('world_state')
    .selectAll()
    .where('owner_id', '=', playerId)
    .executeTakeFirstOrThrow();

  const region = await loadRegion(db, playerId, balance);
  const economy = balance.economyEnabled
    ? await loadEconomy(db, playerId)
    : { storages: [], nodes: [], laborers: [] };
  const activeTasks = await db
    .selectFrom('haul_task')
    .selectAll()
    .where('owner_id', '=', playerId)
    .where('status', 'not in', ['complete', 'failed'])
    .orderBy('created_at')
    .execute();
  const activeTransfers = await db
    .selectFrom('transfer_task')
    .selectAll()
    .where('owner_id', '=', playerId)
    .where('status', 'not in', ['complete', 'failed'])
    .orderBy('created_at')
    .execute();
  const buildingRows = await loadBuildings(db, playerId);
  const residentRows = await loadResidents(db, playerId);
  const taskByCarrier = new Map(
    activeTasks
      .filter((task) => task.carrier_id)
      .map((task) => [task.carrier_id as string, task.id])
  );
  const transferByCarrier = new Map(
    activeTransfers
      .filter((task) => task.carrier_id)
      .map((task) => [task.carrier_id as string, task.id])
  );
  const buildingByBuilder = new Map(
    buildingRows
      .filter((building) => building.builder_id)
      .map((building) => [building.builder_id as string, building.id])
  );
  const jobByCell = new Map(
    region.activeJobs.map((job) => [`${job.sector_id}:${job.x}:${job.y}`, job])
  );

  const sectors: SectorSnapshot[] = region.sectors.map((sector) => {
    const terrain: TerrainCell[] = [...(region.cellsBySector.get(sector.id) ?? [])]
      .sort((a, b) => a.y - b.y || a.x - b.x)
      .map((cell) => {
        const rule = balance.terrains[cell.terrain_type];
        const key = globalKey(sector, cell);
        const job = jobByCell.get(`${cell.sector_id}:${cell.x}:${cell.y}`);
        return {
          x: cell.x,
          y: cell.y,
          type: cell.terrain_type,
          obstacle: cell.obstacle,
          passable: cell.passable,
          reachable: region.reachable.has(key),
          cartReachable: region.cartReachable.has(key),
          clearable: rule.clearable,
          clearing: job
            ? { workDone: job.work_done, workRequired: job.work_required }
            : null
        };
      });

    return {
      id: sector.id,
      x: sector.x,
      y: sector.y,
      width: sector.width,
      height: sector.height,
      biome: sector.biome,
      status: sector.status,
      terrain
    };
  });

  const storages: StorageSnapshot[] = economy.storages.map((storage) => ({
    id: storage.id,
    sectorId: storage.sector_id,
    type: storage.type,
    label: balance.storageTypes[storage.type]?.label ?? storage.type,
    x: storage.x,
    y: storage.y,
    capacity: storage.capacity,
    volume: storage.volume,
    reserved: storage.reserved,
    free: Math.max(0, storage.capacity - storage.volume - storage.reserved),
    contents: storage.contents
  }));

  const nodes: ResourceNodeSnapshot[] = economy.nodes.map((node) => ({
    id: node.id,
    sectorId: node.sector_id,
    kind: node.kind,
    label: balance.nodes.find((rule) => rule.kind === node.kind)?.label ?? node.kind,
    item: node.item,
    x: node.x,
    y: node.y,
    amount: node.amount,
    maxAmount: node.max_amount,
    buffer: node.buffer,
    bufferCapacity: node.buffer_capacity,
    reserved: node.buffer_reserved,
    active: node.active,
    renewable: node.renewable,
    regenPerTick: node.regen_per_tick,
    yieldPerTick: node.yield_per_tick
  }));

  const haulTasks: HaulTaskSnapshot[] = activeTasks.map((task) => ({
    id: task.id,
    item: task.item,
    qty: task.qty,
    nodeId: task.node_id,
    storageId: task.storage_id,
    carrierId: task.carrier_id,
    status: task.status as HaulState,
    path: Array.isArray(task.path_to_storage)
      ? (task.path_to_storage as Array<[number, number]>)
      : [],
    pathIndex: task.path_index,
    stateTicks: task.state_ticks
  }));

  const buildings: BuildingSnapshot[] = buildingRows
    .filter((building) => building.status !== 'demolished')
    .map((building) => {
      const rule = balance.buildings[building.type];
      return {
        id: building.id,
        sectorId: building.sector_id,
        type: building.type,
        label: rule?.label ?? building.type,
        category: rule?.category ?? 'production',
        description: rule?.description ?? '',
        x: building.x,
        y: building.y,
        status: building.status as BuildingStatus,
        workDone: building.work_done,
        workRequired: building.work_required,
        workersLimit: building.workers_limit,
        walkable: rule?.walkable ?? false,
        tint: rule?.tint ?? '#8b7358',
        materials: building.materials.map((material) => ({
          item: material.item,
          required: material.required,
          delivered: material.delivered
        })),
        createdAt: building.created_at.toISOString(),
        completedAt: building.completed_at?.toISOString() ?? null
      };
    });

  const transferTasks: TransferTaskSnapshot[] = activeTransfers.map((task) => ({
    id: task.id,
    direction: task.direction,
    buildingId: task.building_id,
    storageId: task.storage_id,
    item: task.item,
    qty: task.qty,
    carrierId: task.carrier_id,
    status: task.status as TransferState,
    path: Array.isArray(task.path_to)
      ? (task.path_to as Array<[number, number]>)
      : [],
    pathIndex: task.path_index,
    stateTicks: task.state_ticks
  }));

  const laborers: LaborerSnapshot[] = economy.laborers.map((laborer) => ({
    id: laborer.id,
    role: laborer.role,
    status: laborer.status,
    transport: laborer.transport,
    sectorId: laborer.sector_id,
    x: laborer.x,
    y: laborer.y,
    taskId: taskByCarrier.get(laborer.id) ?? transferByCarrier.get(laborer.id) ?? null,
    nodeId: laborer.node_id,
    buildingId: buildingByBuilder.get(laborer.id) ?? null
  }));

  const baseStats = regionStats(region);

  const residents: ResidentSnapshot[] = residentRows.map((resident) => ({
    id: resident.id,
    name: resident.name,
    traits: resident.traits,
    schools: resident.schools,
    profession: resident.profession as ResidentSnapshot['profession'],
    xp: resident.xp,
    state: resident.status,
    training:
      resident.status === 'school' && resident.school_id
        ? {
            schoolId: resident.school_id as 'gather' | 'craft',
            leftTicks: resident.training_left_ticks,
            totalTicks: resident.training_total_ticks
          }
        : null
  }));

  return {
    player: {
      id: player.id,
      createdAt: player.created_at.toISOString(),
      currentPhase: player.current_phase
    },
    tick: state.tick,
    version: state.version,
    sectors,
    frontier: frontierSectors(region, state.world_seed, balance),
    clearingTasks: clearingTasks(region, balance),
    storages,
    nodes,
    haulTasks,
    buildings,
    transferTasks,
    laborers,
    residents,
    economyEnabled: balance.economyEnabled,
    stats: {
      ...baseStats,
      storageVolume: storages.reduce((total, storage) => total + storage.volume, 0),
      storageCapacity: storages.reduce(
        (total, storage) => total + storage.capacity,
        0
      ),
      activeHauls: haulTasks.length,
      activeTransfers: transferTasks.length,
      idleCarriers: laborers.filter(
        (laborer) => laborer.role === 'carrier' && laborer.status === 'idle'
      ).length,
      activeNodes: nodes.filter((node) => node.active).length,
      buildings: buildings.length,
      buildingsComplete: buildings.filter((building) => building.status === 'complete')
        .length,
      builders: laborers.filter((laborer) => laborer.role === 'builder').length,
      idleBuilders: laborers.filter(
        (laborer) => laborer.role === 'builder' && laborer.status === 'idle'
      ).length
    },
    catalog: toCatalog(balance),
    serverTime: now.toISOString(),
    simVersion: SIM_VERSION,
    buildVersion: config.appVersion
  };
}
