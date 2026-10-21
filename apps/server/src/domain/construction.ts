import { randomUUID } from 'node:crypto';
import type { Kysely, Transaction } from 'kysely';
import { cellKey, findPath, stepPath } from '@avanpost/sim';
import type { WorldBalance } from '../balance';
import type {
  BuildingMaterialTable,
  BuildingTable,
  DB,
  LaborerTable,
  StorageTable,
  TransferTaskTable
} from '../db/schema';
import {
  addStorageItem,
  carrierCapacity,
  itemVolume,
  loadEconomy,
  storageAccepts,
  storageFree,
  type StorageRowWithContents
} from './economy';
import type { EconomyEvent } from './logistics';
import { globalKeyFor, localizeGlobal, type Region } from './region';
import { awardLaborerXp } from './xp';

type Queryable = Kysely<DB> | Transaction<DB>;

export interface BuildingWithMaterials extends BuildingTable {
  materials: BuildingMaterialTable[];
}

interface TransferRuntime {
  task: TransferTaskTable;
  storage: StorageTable;
  building: BuildingTable;
  material: BuildingMaterialTable | null;
  state: string;
  fromPath: Array<[number, number]>;
  toPath: Array<[number, number]>;
  index: number;
  stateTicks: number;
  sectorId: string;
  x: number;
  y: number;
  done: boolean;
}

function toPoints(keys: string[]): Array<[number, number]> {
  return keys.map((key) => {
    const [x, y] = key.split(':');
    return [Number(x), Number(y)] as [number, number];
  });
}

function parsePath(value: unknown): Array<[number, number]> {
  if (!Array.isArray(value)) throw new Error('transfer path must be an array');
  return value.map((point) => {
    if (!Array.isArray(point) || point.length !== 2) {
      throw new Error('transfer path point must be [x, y]');
    }
    return [Number(point[0]), Number(point[1])] as [number, number];
  });
}

export async function loadBuildings(
  queryable: Queryable,
  ownerId: string,
  statuses?: BuildingTable['status'][]
): Promise<BuildingWithMaterials[]> {
  let query = queryable
    .selectFrom('building')
    .selectAll()
    .where('owner_id', '=', ownerId)
    .orderBy('created_at');
  if (statuses && statuses.length > 0) {
    query = query.where('status', 'in', statuses);
  }
  const buildings = await query.execute();
  if (buildings.length === 0) return [];

  const materials = await queryable
    .selectFrom('building_material')
    .selectAll()
    .where(
      'building_id',
      'in',
      buildings.map((building) => building.id)
    )
    .orderBy('item')
    .execute();
  const byBuilding = new Map<string, BuildingMaterialTable[]>();
  for (const material of materials) {
    const list = byBuilding.get(material.building_id) ?? [];
    list.push(material);
    byBuilding.set(material.building_id, list);
  }
  return buildings.map((building) => ({
    ...building,
    materials: byBuilding.get(building.id) ?? []
  }));
}

function transferQty(
  building: BuildingWithMaterials,
  item: string,
  active: TransferTaskTable[]
): number {
  const material = building.materials.find((entry) => entry.item === item);
  if (!material) return 0;
  const moving = active
    .filter(
      (task) =>
        task.building_id === building.id &&
        task.item === item &&
        task.direction === 'to_building'
    )
    .reduce((sum, task) => sum + task.qty, 0);
  return Math.max(0, material.required - material.delivered - moving);
}

function salvageQty(building: BuildingWithMaterials, item: string, active: TransferTaskTable[]): number {
  const material = building.materials.find((entry) => entry.item === item);
  if (!material) return 0;
  const moving = active
    .filter(
      (task) =>
        task.building_id === building.id &&
        task.item === item &&
        task.direction === 'to_storage'
    )
    .reduce((sum, task) => sum + task.qty, 0);
  return Math.max(0, material.delivered - moving);
}

export async function planTransfers(
  queryable: Queryable,
  ownerId: string,
  region: Region,
  balance: WorldBalance,
  now: Date
): Promise<EconomyEvent[]> {
  const { storages, laborers } = await loadEconomy(queryable, ownerId);
  const idleCarriers = laborers
    .filter((laborer) => laborer.role === 'carrier' && laborer.status === 'idle')
    .sort(
      (a, b) =>
        Number(b.transport === 'cart') - Number(a.transport === 'cart')
    );
  if (idleCarriers.length === 0) return [];

  const buildings = await loadBuildings(queryable, ownerId, [
    'awaiting_materials',
    'demolished'
  ]);
  if (buildings.length === 0) return [];

  const active = await queryable
    .selectFrom('transfer_task')
    .selectAll()
    .where('owner_id', '=', ownerId)
    .where('status', 'not in', ['complete', 'failed'])
    .execute();

  const storageById = new Map(storages.map((storage) => [storage.id, storage]));
  const events: EconomyEvent[] = [];

  for (const carrier of idleCarriers) {
    const candidate = await chooseTransfer(
      queryable,
      ownerId,
      region,
      balance,
      carrier,
      buildings,
      storages,
      active,
      now
    );
    if (!candidate) continue;
    const storage = storageById.get(candidate.storageId);
    if (!storage) continue;

    await queryable
      .insertInto('transfer_task')
      .values({
        id: candidate.id,
        owner_id: ownerId,
        building_id: candidate.buildingId,
        storage_id: candidate.storageId,
        direction: candidate.direction,
        item: candidate.item,
        qty: candidate.qty,
        carrier_id: carrier.id,
        status: 'reserved',
        path_from: JSON.stringify(candidate.pathFrom),
        path_to: JSON.stringify(candidate.pathTo),
        path_index: 0,
        state_ticks: 0,
        created_at: now,
        updated_at: now
      })
      .execute();
    await queryable
      .updateTable('laborer')
      .set({ status: 'hauling' })
      .where('id', '=', carrier.id)
      .execute();

    active.push({
      id: candidate.id,
      owner_id: ownerId,
      building_id: candidate.buildingId,
      storage_id: candidate.storageId,
      direction: candidate.direction,
      item: candidate.item,
      qty: candidate.qty,
      carrier_id: carrier.id,
      status: 'reserved',
      path_from: JSON.stringify(candidate.pathFrom),
      path_to: JSON.stringify(candidate.pathTo),
      path_index: 0,
      state_ticks: 0,
      created_at: now,
      updated_at: now
    });
    events.push({
      type: 'TransferQueued',
      payload: {
        taskId: candidate.id,
        buildingId: candidate.buildingId,
        direction: candidate.direction,
        item: candidate.item,
        qty: candidate.qty
      }
    });
  }

  return events;
}

interface TransferCandidate {
  id: string;
  buildingId: string;
  storageId: string;
  direction: 'to_building' | 'to_storage';
  item: string;
  qty: number;
  pathFrom: Array<[number, number]>;
  pathTo: Array<[number, number]>;
}

async function chooseTransfer(
  queryable: Queryable,
  ownerId: string,
  region: Region,
  balance: WorldBalance,
  carrier: LaborerTable,
  buildings: BuildingWithMaterials[],
  storages: StorageRowWithContents[],
  active: TransferTaskTable[],
  now: Date
): Promise<TransferCandidate | null> {
  const carrierKey = globalKeyFor(region, carrier.sector_id, carrier.x, carrier.y);
  if (!carrierKey) return null;
  const graph = carrier.transport === 'cart' ? region.cartGraph : region.graph;
  const capacity = carrierCapacity(balance, carrier.transport);
  let best: TransferCandidate | null = null;
  let bestCost = Number.POSITIVE_INFINITY;

  for (const building of buildings) {
    if (building.status === 'awaiting_materials') {
      for (const material of building.materials) {
        const remaining = transferQty(building, material.item, active);
        if (remaining <= 0) continue;
        const volume = itemVolume(balance, material.item);

        const buildingKey = globalKeyFor(
          region,
          building.sector_id,
          building.x,
          building.y
        );
        if (!buildingKey) continue;

        for (const storage of storages) {
          if (!storageAccepts(balance, storage.type, material.item)) continue;
          const storageKey = globalKeyFor(
            region,
            storage.sector_id,
            storage.x,
            storage.y
          );
          if (!storageKey) continue;
          const content = storage.contents.find((entry) => entry.item === material.item);
          const reservedOut = active
            .filter(
              (task) =>
                task.storage_id === storage.id &&
                task.item === material.item &&
                task.direction === 'to_building'
            )
            .reduce((sum, task) => sum + task.qty, 0);
          const available = (content?.qty ?? 0) - reservedOut;
          if (available <= 0) continue;
          const qty = Math.min(capacity, remaining, available);
          if (qty <= 0) continue;

          const fromKeys = findPath(graph, carrierKey, storageKey);
          const toKeys = findPath(graph, storageKey, buildingKey);
          if (!fromKeys || !toKeys) continue;
          const cost = fromKeys.length + toKeys.length;
          if (cost >= bestCost) continue;
          bestCost = cost;
          best = {
            id: randomUUID(),
            buildingId: building.id,
            storageId: storage.id,
            direction: 'to_building',
            item: material.item,
            qty: Math.max(1, Math.min(qty, capacity)),
            pathFrom: toPoints(fromKeys),
            pathTo: toPoints(toKeys)
          };
        }
      }
      continue;
    }

    if (building.status !== 'demolished') continue;
    for (const material of building.materials) {
      const remaining = salvageQty(building, material.item, active);
      if (remaining <= 0) continue;
      const volume = itemVolume(balance, material.item);
      if (volume <= 0) continue;

      const buildingKey = globalKeyFor(
        region,
        building.sector_id,
        building.x,
        building.y
      );
      if (!buildingKey) continue;

      for (const storage of storages) {
        if (!storageAccepts(balance, storage.type, material.item)) continue;
        const storageKey = globalKeyFor(
          region,
          storage.sector_id,
          storage.x,
          storage.y
        );
        if (!storageKey) continue;
        const free = storageFree(storage);
        if (free < volume) continue;
        const qty = Math.min(capacity, remaining, Math.floor(free / volume));
        if (qty <= 0) continue;

        const fromKeys = findPath(graph, carrierKey, buildingKey);
        const toKeys = findPath(graph, buildingKey, storageKey);
        if (!fromKeys || !toKeys) continue;
        const cost = fromKeys.length + toKeys.length;
        if (cost >= bestCost) continue;
        bestCost = cost;
        best = {
          id: randomUUID(),
          buildingId: building.id,
          storageId: storage.id,
          direction: 'to_storage',
          item: material.item,
          qty,
          pathFrom: toPoints(fromKeys),
          pathTo: toPoints(toKeys)
        };
      }
    }
  }

  if (!best) return null;

  if (best.direction === 'to_storage') {
    const volume = itemVolume(balance, best.item) * best.qty;
    const storage = storages.find((entry) => entry.id === best?.storageId);
    if (!storage) return null;
    storage.reserved += volume;
    await queryable
      .updateTable('storage')
      .set({ reserved: storage.reserved })
      .where('id', '=', storage.id)
      .where('owner_id', '=', ownerId)
      .execute();
  }
  return best;
}

function stepWithRoads(
  path: Array<[number, number]>,
  index: number,
  steps: number,
  region: Region
): { index: number; x: number; y: number } {
  let step = stepPath(path, index, steps);
  while (
    step.index < path.length - 1 &&
    region.moveCostByKey.has(cellKey(step.x, step.y))
  ) {
    step = stepPath(path, step.index, 1);
  }
  return step;
}

export async function advanceTransfers(
  queryable: Queryable,
  ownerId: string,
  ticks: number,
  balance: WorldBalance,
  now: Date,
  region: Region
): Promise<EconomyEvent[]> {
  const tasks = await queryable
    .selectFrom('transfer_task')
    .selectAll()
    .where('owner_id', '=', ownerId)
    .where('status', 'not in', ['complete', 'failed'])
    .execute();
  if (tasks.length === 0) return [];

  const storageIds = [...new Set(tasks.map((task) => task.storage_id))];
  const storages = await queryable
    .selectFrom('storage')
    .selectAll()
    .where('id', 'in', storageIds)
    .execute();
  const storageById = new Map(storages.map((storage) => [storage.id, storage]));
  const buildingRows = await loadBuildings(queryable, ownerId);
  const buildingById = new Map(buildingRows.map((building) => [building.id, building]));
  const carriers = await queryable
    .selectFrom('laborer')
    .selectAll()
    .where('owner_id', '=', ownerId)
    .where('role', '=', 'carrier')
    .execute();
  const carrierById = new Map(carriers.map((carrier) => [carrier.id, carrier]));

  const runtimes: TransferRuntime[] = [];
  for (const task of tasks) {
    if (!task.carrier_id) continue;
    const carrier = carrierById.get(task.carrier_id);
    const storage = storageById.get(task.storage_id);
    const building = buildingById.get(task.building_id);
    if (!carrier || !storage || !building) continue;
    runtimes.push({
      task,
      storage,
      building,
      material:
        building.materials.find((material) => material.item === task.item) ?? null,
      state: task.status,
      fromPath: parsePath(task.path_from),
      toPath: parsePath(task.path_to),
      index: task.path_index,
      stateTicks: task.state_ticks,
      sectorId: carrier.sector_id,
      x: carrier.x,
      y: carrier.y,
      done: false
    });
  }
  if (runtimes.length === 0) return [];

  const events: EconomyEvent[] = [];
  const itemVolumes = new Map<string, number>();

  for (const runtime of runtimes) {
    const volume = (() => {
      const known = itemVolumes.get(runtime.task.item);
      if (known !== undefined) return known;
      const value = itemVolume(balance, runtime.task.item);
      itemVolumes.set(runtime.task.item, value);
      return value;
    })();

    for (let tick = 0; tick < ticks && !runtime.done; tick += 1) {
      switch (runtime.state) {
        case 'queued':
        case 'reserved': {
          runtime.state = 'worker_to_source';
          runtime.index = 0;
          runtime.stateTicks = 0;
          tick -= 1;
          break;
        }
        case 'worker_to_source': {
          const step = stepWithRoads(
            runtime.fromPath,
            runtime.index,
            balance.carrier.moveTicksPerTile,
            region
          );
          runtime.index = step.index;
          const position = localizeGlobal(region, step.x, step.y);
          if (position) {
            runtime.sectorId = position.sectorId;
            runtime.x = position.x;
            runtime.y = position.y;
          }
          if (runtime.index >= runtime.fromPath.length - 1) {
            runtime.state = 'loading';
            runtime.stateTicks = 0;
          }
          break;
        }
        case 'loading': {
          runtime.stateTicks += 1;
          if (runtime.stateTicks >= balance.carrier.loadTicks) {
            await loadTransferSource(queryable, runtime, volume, now);
            runtime.sectorId =
              runtime.task.direction === 'to_building'
                ? runtime.storage.sector_id
                : runtime.building.sector_id;
            runtime.x =
              runtime.task.direction === 'to_building'
                ? runtime.storage.x
                : runtime.building.x;
            runtime.y =
              runtime.task.direction === 'to_building'
                ? runtime.storage.y
                : runtime.building.y;
            runtime.state = 'moving';
            runtime.index = 0;
            runtime.stateTicks = 0;
          }
          break;
        }
        case 'moving': {
          const step = stepWithRoads(
            runtime.toPath,
            runtime.index,
            balance.carrier.moveTicksPerTile,
            region
          );
          runtime.index = step.index;
          const position = localizeGlobal(region, step.x, step.y);
          if (position) {
            runtime.sectorId = position.sectorId;
            runtime.x = position.x;
            runtime.y = position.y;
          }
          if (runtime.index >= runtime.toPath.length - 1) {
            runtime.state = 'unloading';
            runtime.stateTicks = 0;
          }
          break;
        }
        case 'unloading': {
          runtime.stateTicks += 1;
          if (runtime.stateTicks >= balance.carrier.unloadTicks) {
            await unloadTransfer(queryable, runtime, volume, balance, now, events);
            runtime.sectorId =
              runtime.task.direction === 'to_building'
                ? runtime.building.sector_id
                : runtime.storage.sector_id;
            runtime.x =
              runtime.task.direction === 'to_building'
                ? runtime.building.x
                : runtime.storage.x;
            runtime.y =
              runtime.task.direction === 'to_building'
                ? runtime.building.y
                : runtime.storage.y;
            runtime.state = 'complete';
            runtime.done = true;
          }
          break;
        }
        default:
          runtime.done = true;
      }
    }

    await queryable
      .updateTable('transfer_task')
      .set({
        status: runtime.done ? 'complete' : runtime.state,
        carrier_id: runtime.done ? null : runtime.task.carrier_id,
        path_index: runtime.index,
        state_ticks: runtime.stateTicks,
        updated_at: now
      })
      .where('id', '=', runtime.task.id)
      .execute();

    if (runtime.task.carrier_id) {
      await queryable
        .updateTable('laborer')
        .set({
          status: runtime.done ? 'idle' : 'hauling',
          sector_id: runtime.sectorId,
          x: runtime.x,
          y: runtime.y
        })
        .where('id', '=', runtime.task.carrier_id)
        .execute();
    }
  }

  return events;
}

async function loadTransferSource(
  queryable: Queryable,
  runtime: TransferRuntime,
  volume: number,
  now: Date
): Promise<void> {
  if (runtime.task.direction === 'to_building') {
    const existing = await queryable
      .selectFrom('storage_item')
      .selectAll()
      .where('storage_id', '=', runtime.storage.id)
      .where('item', '=', runtime.task.item)
      .executeTakeFirst();
    if (!existing || existing.qty < runtime.task.qty) {
      runtime.state = 'failed';
      runtime.done = true;
      return;
    }
    await queryable
      .updateTable('storage_item')
      .set({ qty: existing.qty - runtime.task.qty })
      .where('storage_id', '=', runtime.storage.id)
      .where('item', '=', runtime.task.item)
      .execute();
    await queryable
      .updateTable('storage')
      .set({
        volume: Math.max(0, runtime.storage.volume - runtime.task.qty * volume)
      })
      .where('id', '=', runtime.storage.id)
      .execute();
    runtime.storage.volume -= runtime.task.qty * volume;
    return;
  }

  if (!runtime.material) {
    runtime.state = 'failed';
    runtime.done = true;
    return;
  }
  await queryable
    .updateTable('building_material')
    .set({ delivered: Math.max(0, runtime.material.delivered - runtime.task.qty) })
    .where('building_id', '=', runtime.building.id)
    .where('item', '=', runtime.task.item)
    .execute();
  runtime.material.delivered = Math.max(0, runtime.material.delivered - runtime.task.qty);
  await queryable
    .updateTable('building')
    .set({ updated_at: now })
    .where('id', '=', runtime.building.id)
    .execute();
}

async function unloadTransfer(
  queryable: Queryable,
  runtime: TransferRuntime,
  volume: number,
  balance: WorldBalance,
  now: Date,
  events: EconomyEvent[]
): Promise<void> {
  if (runtime.task.direction === 'to_storage') {
    await addStorageItem(
      queryable,
      runtime.storage.id,
      runtime.task.item,
      runtime.task.qty,
      runtime.task.qty * volume
    );
    events.push({
      type: 'SalvageStored',
      payload: {
        buildingId: runtime.building.id,
        item: runtime.task.item,
        qty: runtime.task.qty
      }
    });
    return;
  }

  if (!runtime.material) {
    runtime.state = 'failed';
    runtime.done = true;
    return;
  }
  const next = Math.min(
    runtime.material.required,
    runtime.material.delivered + runtime.task.qty
  );
  await queryable
    .updateTable('building_material')
    .set({ delivered: next })
    .where('building_id', '=', runtime.building.id)
    .where('item', '=', runtime.task.item)
    .execute();
  runtime.material.delivered = next;

  const materials = await queryable
    .selectFrom('building_material')
    .selectAll()
    .where('building_id', '=', runtime.building.id)
    .execute();
  const complete = materials.every((material) => material.delivered >= material.required);
  if (complete && runtime.building.status === 'awaiting_materials') {
    await queryable
      .updateTable('building')
      .set({ status: 'building', work_done: 0, updated_at: now })
      .where('id', '=', runtime.building.id)
      .execute();
    runtime.building.status = 'building';
    events.push({
      type: 'BuildingMaterialsDelivered',
      payload: { buildingId: runtime.building.id, type: runtime.building.type }
    });
  }
}

export async function advanceBuildings(
  queryable: Queryable,
  ownerId: string,
  ticks: number,
  balance: WorldBalance,
  now: Date
): Promise<EconomyEvent[]> {
  const active = await loadBuildings(queryable, ownerId, ['building', 'demolition']);
  if (active.length === 0) return [];

  const builders = await queryable
    .selectFrom('laborer')
    .selectAll()
    .where('owner_id', '=', ownerId)
    .where('role', '=', 'builder')
    .orderBy('created_at')
    .execute();
  const idleBuilders = builders.filter((builder) => builder.status === 'idle');
  const events: EconomyEvent[] = [];

  for (const building of active) {
    let builder: LaborerTable | undefined;
    if (building.builder_id) {
      builder = builders.find((entry) => entry.id === building.builder_id);
    } else {
      builder = idleBuilders.shift();
      if (!builder) continue;
      await queryable
        .updateTable('building')
        .set({ builder_id: builder.id, updated_at: now })
        .where('id', '=', building.id)
        .execute();
      await queryable
        .updateTable('laborer')
        .set({
          status: 'building',
          sector_id: building.sector_id,
          x: building.x,
          y: building.y,
          node_id: null
        })
        .where('id', '=', builder.id)
        .execute();
      builder.status = 'building';
      builder.sector_id = building.sector_id;
      builder.x = building.x;
      builder.y = building.y;
      building.builder_id = builder.id;
      events.push({
        type: 'BuilderAssigned',
        payload: { buildingId: building.id, builderId: builder.id }
      });
    }
    if (!builder) continue;

    const workDone = Math.min(
      building.work_required,
      building.work_done + ticks * balance.buildRate
    );
    if (workDone < building.work_required) {
      await queryable
        .updateTable('building')
        .set({ work_done: workDone, updated_at: now })
        .where('id', '=', building.id)
        .execute();
      building.work_done = workDone;
      continue;
    }

    if (building.status === 'building') {
      await queryable
        .updateTable('building')
        .set({
          status: 'complete',
          work_done: building.work_required,
          builder_id: null,
          completed_at: now,
          updated_at: now
        })
        .where('id', '=', building.id)
        .execute();
      await queryable
        .updateTable('laborer')
        .set({
          status: 'idle',
          sector_id: building.sector_id,
          x: building.x,
          y: building.y
        })
        .where('id', '=', builder.id)
        .execute();
      events.push({
        type: 'BuildingCompleted',
        payload: { buildingId: building.id, type: building.type, x: building.x, y: building.y }
      });
      events.push(
        ...(await awardLaborerXp(
          queryable,
          ownerId,
          builder.id,
          balance.xp.xpPerTask,
          'build',
          balance.xp.levelThresholds
        ))
      );
      continue;
    }

    await queryable
      .updateTable('building')
      .set({
        status: 'demolished',
        work_done: building.work_required,
        builder_id: null,
        completed_at: now,
        updated_at: now
      })
      .where('id', '=', building.id)
      .execute();
    await queryable
      .updateTable('laborer')
      .set({
        status: 'idle',
        sector_id: building.sector_id,
        x: building.x,
        y: building.y
      })
      .where('id', '=', builder.id)
      .execute();
    for (const material of building.materials) {
      await queryable
        .updateTable('building_material')
        .set({ delivered: Math.floor(material.delivered * balance.salvageRatio) })
        .where('building_id', '=', building.id)
        .where('item', '=', material.item)
        .execute();
    }
    events.push({
      type: 'BuildingDemolished',
      payload: { buildingId: building.id, type: building.type, x: building.x, y: building.y }
    });
  }

  return events;
}

export function buildingTint(balance: WorldBalance, type: string): string {
  return balance.buildings[type]?.tint ?? '#8b7358';
}

export function buildingLabel(balance: WorldBalance, type: string): string {
  return balance.buildings[type]?.label ?? type;
}
