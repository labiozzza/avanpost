import type { Kysely } from 'kysely';
import { SIM_VERSION, freeSlots, housingCapacity, levelProgress } from '@avanpost/sim';
import type {
  BuildingSnapshot,
  BuildingStatus,
  CraftOrderSnapshot,
  HaulState,
  HaulTaskSnapshot,
  LaborerSnapshot,
  ResearchStateSnapshot,
  ResourceNodeSnapshot,
  ResidentSnapshot,
  SectorSnapshot,
  StorageSnapshot,
  TechNodeSnapshot,
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
  const craftOrderRows = await db
    .selectFrom('craft_order')
    .selectAll()
    .where('owner_id', '=', playerId)
    .where('status', 'in', ['active', 'blocked'])
    .orderBy('created_at')
    .execute();
  const bufferRows = await db
    .selectFrom('building_buffer')
    .selectAll()
    .where(
      'building_id',
      'in',
      craftOrderRows.length > 0
        ? craftOrderRows.map((order) => order.building_id)
        : ['00000000-0000-0000-0000-000000000000']
    )
    .execute();
  const researchedRows = await db
    .selectFrom('researched_technology')
    .select('technology_id')
    .where('owner_id', '=', playerId)
    .execute();
  const researchProjectRow = await db
    .selectFrom('research_project')
    .selectAll()
    .where('owner_id', '=', playerId)
    .where('status', 'in', ['active', 'paused'])
    .executeTakeFirst();
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
    buildingId: buildingByBuilder.get(laborer.id) ?? null,
    residentId: laborer.resident_id
  }));

  const laborerByResident = new Map(
    economy.laborers
      .filter((laborer) => laborer.resident_id)
      .map((laborer) => [laborer.resident_id as string, laborer.id])
  );

  const baseStats = regionStats(region);

  const residents: ResidentSnapshot[] = residentRows.map((resident) => {
    const progress = levelProgress(resident.xp, { levelThresholds: balance.xp.levelThresholds });
    return {
      id: resident.id,
      name: resident.name,
      traits: resident.traits,
      schools: resident.schools,
      profession: resident.profession as ResidentSnapshot['profession'],
      xp: resident.xp,
      level: progress.level,
      xpInto: progress.into,
      xpSpan: progress.span,
      xpToNext: progress.toNext,
      state: resident.status,
      laborerId: laborerByResident.get(resident.id) ?? null,
      training:
        resident.status === 'school' && resident.school_id
          ? {
              schoolId: resident.school_id as 'gather' | 'craft',
              leftTicks: resident.training_left_ticks,
            totalTicks: resident.training_total_ticks
          }
        : null
    };
  });

  const finishedHouses = buildingRows.filter(
    (building) => building.type === 'house' && building.status === 'complete'
  ).length;
  const capacity = housingCapacity(finishedHouses, {
    baseCapacity: balance.population.baseCapacity,
    housingCapacityPerHouse: balance.population.housingCapacityPerHouse,
    startingResidents: balance.population.startingResidents
  });
  const elapsed = state.tick - state.last_migration_tick;
  const population = {
    residents: residents.length,
    capacity,
    freeSlots: freeSlots(residents.length, capacity),
    migrationEnabled: balance.population.migrationEnabled,
    nextArrivalInTicks: balance.population.migrationEnabled
      ? Math.max(0, balance.population.migrationMinTicks - elapsed)
      : 0
  };

  const researchedSet = new Set(researchedRows.map((row) => row.technology_id));

  const craftOrders: CraftOrderSnapshot[] = craftOrderRows.map((order) => {
    const recipe = balance.recipes[order.recipe_id];
    const bufferFor = (item: string): number =>
      bufferRows.find(
        (buffer) => buffer.building_id === order.building_id && buffer.item === item
      )?.qty ?? 0;
    return {
      id: order.id,
      buildingId: order.building_id,
      recipeId: order.recipe_id,
      label: recipe?.label ?? order.recipe_id,
      workerId: order.worker_id,
      progress: order.progress,
      workRequired: order.work_required,
      status: order.status,
      inputs: Object.keys(recipe?.inputs ?? {}).map((item) => ({
        item,
        qty: bufferFor(item)
      })),
      outputs: Object.keys(recipe?.outputs ?? {}).map((item) => ({
        item,
        qty: bufferFor(item)
      })),
      bufferCapacity: balance.craft.bufferCapacity
    };
  });

  const techTree: TechNodeSnapshot[] = Object.values(balance.techTree)
    .sort((a, b) => a.cost - b.cost || a.id.localeCompare(b.id))
    .map((node) => ({
      id: node.id,
      label: node.label,
      description: node.description,
      root: node.root,
      requires: node.requires,
      cost: node.cost,
      unlockRecipes: node.unlockRecipes,
      researched: researchedSet.has(node.id),
      available: node.requires.every((requirement) => researchedSet.has(requirement)),
      tint: node.tint
    }));

  const research: ResearchStateSnapshot = {
    enabled: balance.research.enabled,
    points: player.research_points,
    pointsPerTick: balance.research.pointsPerTick,
    active: researchProjectRow
      ? {
          technologyId: researchProjectRow.technology_id,
          progress: researchProjectRow.progress,
          cost: researchProjectRow.cost,
          scholarId: researchProjectRow.scholar_id,
          status: researchProjectRow.status === 'active' ? 'active' : 'paused'
        }
      : null,
    researched: [...researchedSet].sort()
  };

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
    population,
    craftOrders,
    research,
    techTree,
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
