import { randomUUID } from 'node:crypto';
import type { Kysely, Transaction } from 'kysely';
import {
  advanceExtraction,
  cellKey,
  findPath,
  stepPath
} from '@avanpost/sim';
import type { HaulState } from '@avanpost/shared';
import type { WorldBalance } from '../balance';
import type {
  DB,
  HaulTaskTable,
  LaborerTable,
  ResourceNodeTable,
  StorageTable
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
import {
  globalKeyFor,
  localizeGlobal,
  type Region
} from './region';
import { awardLaborerXp } from './xp';

type Queryable = Kysely<DB> | Transaction<DB>;

export interface EconomyEvent {
  type: string;
  payload: Record<string, unknown>;
}

function toPoints(keys: string[]): Array<[number, number]> {
  return keys.map((key) => {
    const [x, y] = key.split(':');
    return [Number(x), Number(y)] as [number, number];
  });
}

function parsePath(value: unknown): Array<[number, number]> {
  if (!Array.isArray(value)) throw new Error('haul path must be an array');
  return value.map((point) => {
    if (!Array.isArray(point) || point.length !== 2) {
      throw new Error('haul path point must be [x, y]');
    }
    return [Number(point[0]), Number(point[1])] as [number, number];
  });
}

interface Candidate {
  node: ResourceNodeTable;
  storage: StorageRowWithContents;
  pathToSource: Array<[number, number]>;
  pathToStorage: Array<[number, number]>;
  qty: number;
}

export async function planHauls(
  queryable: Queryable,
  ownerId: string,
  region: Region,
  balance: WorldBalance,
  now: Date
): Promise<EconomyEvent[]> {
  const { storages, nodes, laborers } = await loadEconomy(queryable, ownerId);
  const idleCarriers = laborers
    .filter((laborer) => laborer.role === 'carrier' && laborer.status === 'idle')
    .sort(
      (a, b) =>
        Number(b.transport === 'cart') - Number(a.transport === 'cart')
    );
  if (idleCarriers.length === 0) return [];

  const events: EconomyEvent[] = [];
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const storageById = new Map(storages.map((storage) => [storage.id, storage]));

  for (const carrier of idleCarriers) {
    const carrierKey = globalKeyFor(region, carrier.sector_id, carrier.x, carrier.y);
    if (!carrierKey) continue;
    const graph = carrier.transport === 'cart' ? region.cartGraph : region.graph;
    const capacity = carrierCapacity(balance, carrier.transport);
    let best: Candidate | null = null;
    let bestCost = Number.POSITIVE_INFINITY;

    for (const node of nodeById.values()) {
      const available = node.buffer - node.buffer_reserved;
      if (available <= 0) continue;
      const volume = itemVolume(balance, node.item);
      const nodeKey = globalKeyFor(region, node.sector_id, node.x, node.y);
      if (!nodeKey) continue;

      for (const storage of storageById.values()) {
        if (!storageAccepts(balance, storage.type, node.item)) continue;
        const free = storageFree(storage);
        if (free < volume) continue;
        const storageKey = globalKeyFor(region, storage.sector_id, storage.x, storage.y);
        if (!storageKey) continue;

        const qty = Math.min(capacity, available, Math.floor(free / volume));
        if (qty <= 0) continue;

        const sourceKeys = findPath(graph, carrierKey, nodeKey);
        const storageKeys = findPath(graph, nodeKey, storageKey);
        if (!sourceKeys || !storageKeys) continue;

        const cost = sourceKeys.length + storageKeys.length;
        if (cost < bestCost) {
          bestCost = cost;
          best = {
            node,
            storage,
            pathToSource: toPoints(sourceKeys),
            pathToStorage: toPoints(storageKeys),
            qty
          };
        }
      }
    }

    if (!best) continue;

    const volume = itemVolume(balance, best.node.item);
    const reservedVolume = best.qty * volume;
    const taskId = randomUUID();

    await queryable
      .insertInto('haul_task')
      .values({
        id: taskId,
        owner_id: ownerId,
        node_id: best.node.id,
        storage_id: best.storage.id,
        item: best.node.item,
        qty: best.qty,
        carrier_id: carrier.id,
        status: 'reserved',
        path_to_source: JSON.stringify(
          best.pathToSource.map(([x, y]) => [x, y])
        ),
        path_to_storage: JSON.stringify(
          best.pathToStorage.map(([x, y]) => [x, y])
        ),
        path_index: 0,
        state_ticks: 0,
        reserved_source: best.qty,
        reserved_destination: reservedVolume,
        created_at: now,
        updated_at: now
      })
      .execute();

    await queryable
      .updateTable('resource_node')
      .set({ buffer_reserved: best.node.buffer_reserved + best.qty })
      .where('id', '=', best.node.id)
      .execute();
    await queryable
      .updateTable('storage')
      .set({ reserved: best.storage.reserved + reservedVolume })
      .where('id', '=', best.storage.id)
      .execute();
    await queryable
      .updateTable('laborer')
      .set({ status: 'hauling' })
      .where('id', '=', carrier.id)
      .execute();

    best.node.buffer_reserved += best.qty;
    best.storage.reserved += reservedVolume;
    carrier.status = 'hauling';

    events.push({
      type: 'HaulQueued',
      payload: {
        taskId,
        carrierId: carrier.id,
        nodeId: best.node.id,
        storageId: best.storage.id,
        item: best.node.item,
        qty: best.qty
      }
    });
  }

  return events;
}

interface TaskRuntime {
  task: HaulTaskTable;
  carrier: LaborerTable;
  node: ResourceNodeTable;
  storage: StorageTable;
  state: HaulState;
  sourcePath: Array<[number, number]>;
  storagePath: Array<[number, number]>;
  index: number;
  stateTicks: number;
  sectorId: string;
  x: number;
  y: number;
  done: boolean;
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

export async function advanceHauls(
  queryable: Queryable,
  ownerId: string,
  ticks: number,
  balance: WorldBalance,
  now: Date,
  region: Region
): Promise<EconomyEvent[]> {
  const tasks = await queryable
    .selectFrom('haul_task')
    .selectAll()
    .where('owner_id', '=', ownerId)
    .where('status', 'not in', ['complete', 'failed', 'blocked'])
    .orderBy('created_at')
    .execute();
  if (tasks.length === 0) return [];

  const laborers = await queryable
    .selectFrom('laborer')
    .selectAll()
    .where('owner_id', '=', ownerId)
    .execute();
  const carriers = new Map(laborers.map((laborer) => [laborer.id, laborer]));
  const nodes = await queryable
    .selectFrom('resource_node')
    .selectAll()
    .where('owner_id', '=', ownerId)
    .execute();
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const storages = await queryable
    .selectFrom('storage')
    .selectAll()
    .where('owner_id', '=', ownerId)
    .execute();
  const storageById = new Map(storages.map((storage) => [storage.id, storage]));

  const runtimes: TaskRuntime[] = [];
  for (const task of tasks) {
    const carrier = task.carrier_id ? carriers.get(task.carrier_id) : undefined;
    const node = nodeById.get(task.node_id);
    const storage = storageById.get(task.storage_id);
    if (!carrier || !node || !storage) {
      await queryable
        .updateTable('haul_task')
        .set({ status: 'failed', updated_at: now })
        .where('id', '=', task.id)
        .execute();
      continue;
    }
    runtimes.push({
      task,
      carrier,
      node,
      storage,
      state: task.status as HaulState,
      sourcePath: parsePath(task.path_to_source),
      storagePath: parsePath(task.path_to_storage),
      index: task.path_index,
      stateTicks: task.state_ticks,
      sectorId: carrier.sector_id,
      x: carrier.x,
      y: carrier.y,
      done: false
    });
  }

  const events: EconomyEvent[] = [];

  for (const runtime of runtimes) {
    const storageVolume = itemVolume(balance, runtime.task.item);
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
            runtime.sourcePath,
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
          if (runtime.index >= runtime.sourcePath.length - 1) {
            runtime.state = 'loading';
            runtime.stateTicks = 0;
          }
          break;
        }
        case 'loading': {
          runtime.stateTicks += 1;
          if (runtime.stateTicks >= balance.carrier.loadTicks) {
            runtime.node.buffer = Math.max(0, runtime.node.buffer - runtime.task.qty);
            runtime.node.buffer_reserved = Math.max(
              0,
              runtime.node.buffer_reserved - runtime.task.qty
            );
            runtime.sectorId = runtime.node.sector_id;
            runtime.x = runtime.node.x;
            runtime.y = runtime.node.y;
            runtime.state = 'moving';
            runtime.index = 0;
            runtime.stateTicks = 0;
          }
          break;
        }
        case 'moving': {
          const step = stepWithRoads(
            runtime.storagePath,
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
          if (runtime.index >= runtime.storagePath.length - 1) {
            runtime.state = 'unloading';
            runtime.stateTicks = 0;
          }
          break;
        }
        case 'unloading': {
          runtime.stateTicks += 1;
          if (runtime.stateTicks >= balance.carrier.unloadTicks) {
            await addStorageItem(
              queryable,
              runtime.storage.id,
              runtime.task.item,
              runtime.task.qty,
              runtime.task.qty * storageVolume
            );
            runtime.sectorId = runtime.storage.sector_id;
            runtime.x = runtime.storage.x;
            runtime.y = runtime.storage.y;
            runtime.state = 'complete';
            runtime.done = true;
            events.push({
              type: 'HaulCompleted',
              payload: {
                taskId: runtime.task.id,
                carrierId: runtime.carrier.id,
                nodeId: runtime.node.id,
                storageId: runtime.storage.id,
                item: runtime.task.item,
                qty: runtime.task.qty
              }
            });
          }
          break;
        }
        default:
          runtime.done = true;
          break;
      }
    }

    await queryable
      .updateTable('resource_node')
      .set({
        buffer: Math.max(0, runtime.node.buffer),
        buffer_reserved: Math.max(0, runtime.node.buffer_reserved)
      })
      .where('id', '=', runtime.node.id)
      .execute();

    await queryable
      .updateTable('haul_task')
      .set({
        status: runtime.state,
        path_index: runtime.index,
        state_ticks: runtime.stateTicks,
        updated_at: now
      })
      .where('id', '=', runtime.task.id)
      .execute();

    if (runtime.done) {
      await queryable
        .updateTable('laborer')
        .set({
          status: 'idle',
          x: runtime.storage.x,
          y: runtime.storage.y,
          node_id: null
        })
        .where('id', '=', runtime.carrier.id)
        .execute();
      runtime.carrier.status = 'idle';
      runtime.carrier.x = runtime.storage.x;
      runtime.carrier.y = runtime.storage.y;
    } else {
      await queryable
        .updateTable('laborer')
        .set({ x: runtime.x, y: runtime.y })
        .where('id', '=', runtime.carrier.id)
        .execute();
      runtime.carrier.x = runtime.x;
      runtime.carrier.y = runtime.y;
    }
  }

  return events;
}

export async function advanceNodes(
  queryable: Queryable,
  ownerId: string,
  ticks: number,
  balance: WorldBalance,
  now: Date
): Promise<EconomyEvent[]> {
  const nodes = await queryable
    .selectFrom('resource_node')
    .selectAll()
    .where('owner_id', '=', ownerId)
    .where('active', '=', true)
    .execute();

  const events: EconomyEvent[] = [];
  for (const node of nodes) {
    const result = advanceExtraction(
      {
        amount: node.amount,
        maxAmount: node.max_amount,
        renewable: node.renewable,
        regenPerTick: node.regen_per_tick,
        yieldPerTick: node.yield_per_tick,
        buffer: node.buffer,
        bufferCapacity: node.buffer_capacity
      },
      ticks
    );

    await queryable
      .updateTable('resource_node')
      .set({
        amount: result.amount,
        buffer: result.buffer,
        active: result.depleted ? false : node.active,
        gatherer_id: result.depleted ? null : node.gatherer_id
      })
      .where('id', '=', node.id)
      .execute();

    if (result.depleted && node.gatherer_id) {
      await queryable
        .updateTable('laborer')
        .set({ status: 'idle', node_id: null })
        .where('id', '=', node.gatherer_id)
        .execute();
    }

    if (result.gained > 0) {
      events.push({
        type: 'ResourceExtracted',
        payload: {
          nodeId: node.id,
          item: node.item,
          gained: result.gained,
          amount: result.amount,
          buffer: result.buffer
        }
      });
      events.push(
        ...(await awardLaborerXp(
          queryable,
          ownerId,
          node.gatherer_id,
          balance.xp.xpPerTask,
          'gather',
          balance.xp.levelThresholds
        ))
      );
    }
    if (result.depleted) {
      events.push({
        type: 'NodeDepleted',
        payload: { nodeId: node.id, kind: node.kind, item: node.item }
      });
    }
  }

  return events;
}
