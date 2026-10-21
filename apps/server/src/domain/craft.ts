import { randomUUID } from 'node:crypto';
import type { Kysely, Transaction } from 'kysely';
import { cellKey, findPath, type WorldGraph } from '@avanpost/sim';
import {
  ErrorCode,
  PROFESSIONS,
  type CancelCraftCommand,
  type StartCraftCommand
} from '@avanpost/shared';
import type { WorldBalance } from '../balance';
import type { BuildingBufferTable, BuildingTable, DB, LaborerTable } from '../db/schema';
import { AppError } from '../errors';
import {
  carrierCapacity,
  itemVolume,
  loadEconomy,
  storageAccepts,
  storageFree,
  type StorageRowWithContents
} from './economy';
import { executeCommand, type OutboxEvent } from './commands';
import type { Region } from './region';
import { globalKeyFor } from './region';

type Queryable = Kysely<DB> | Transaction<DB>;

export interface CraftOrderRow {
  id: string;
  building_id: string;
  recipe_id: string;
  worker_id: string | null;
  progress: number;
  work_required: number;
  status: 'active' | 'blocked' | 'complete' | 'cancelled';
}

export async function loadBuffers(
  queryable: Queryable,
  buildingIds: readonly string[]
): Promise<BuildingBufferTable[]> {
  if (buildingIds.length === 0) return [];
  return queryable
    .selectFrom('building_buffer')
    .selectAll()
    .where('building_id', 'in', [...buildingIds])
    .execute();
}

async function isTechnologyResearched(
  queryable: Queryable,
  ownerId: string,
  technologyId: string
): Promise<boolean> {
  const row = await queryable
    .selectFrom('researched_technology')
    .select('technology_id')
    .where('owner_id', '=', ownerId)
    .where('technology_id', '=', technologyId)
    .executeTakeFirst();
  return Boolean(row);
}

/** GDD 3.3: the recipe may only run in its station, unlocked by a technology. */
async function assertRecipeUnlocked(
  queryable: Queryable,
  ownerId: string,
  balance: WorldBalance,
  buildingType: string,
  recipeId: string
): Promise<void> {
  const recipe = balance.recipes[recipeId];
  if (!recipe) {
    throw new AppError(404, ErrorCode.RECIPE_NOT_FOUND, `unknown recipe ${recipeId}`);
  }
  if (recipe.station !== buildingType) {
    throw new AppError(
      409,
      ErrorCode.RECIPE_LOCKED,
      `recipe ${recipeId} requires a ${recipe.station}`
    );
  }
  if (!(await isTechnologyResearched(queryable, ownerId, recipe.unlockTechnology))) {
    throw new AppError(
      409,
      ErrorCode.RECIPE_LOCKED,
      `recipe ${recipeId} needs technology ${recipe.unlockTechnology}`
    );
  }
}

export async function startCraftCommand(
  db: Kysely<DB>,
  ownerId: string,
  command: StartCraftCommand,
  balance: WorldBalance,
  now: Date
): Promise<{ replayed: boolean }> {
  return executeCommand(
    db,
    ownerId,
    command,
    'start_craft',
    {
      building_id: command.building_id,
      recipe_id: command.recipe_id,
      worker_id: command.worker_id ?? null
    },
    now,
    async ({ trx }) => {
      const building = await trx
        .selectFrom('building')
        .selectAll()
        .where('id', '=', command.building_id)
        .where('owner_id', '=', ownerId)
        .executeTakeFirst();
      if (!building) {
        throw new AppError(404, ErrorCode.BUILDING_NOT_FOUND, 'building not found');
      }
      if (building.status !== 'complete') {
        throw new AppError(
          409,
          ErrorCode.BUILDING_NOT_COMPLETE,
          'station must be complete before crafting'
        );
      }

      await assertRecipeUnlocked(trx, ownerId, balance, building.type, command.recipe_id);
      const recipe = balance.recipes[command.recipe_id]!;

      const existing = await trx
        .selectFrom('craft_order')
        .select('id')
        .where('building_id', '=', building.id)
        .where('status', 'in', ['active', 'blocked'])
        .executeTakeFirst();
      if (existing) {
        throw new AppError(409, ErrorCode.CRAFT_ALREADY_ACTIVE, 'station already busy');
      }
      const buffered = await trx
        .selectFrom('building_buffer')
        .select('item')
        .where('building_id', '=', building.id)
        .where('qty', '>', 0)
        .executeTakeFirst();
      const moving = await trx
        .selectFrom('transfer_task')
        .select('id')
        .where('building_id', '=', building.id)
        .where('direction', 'in', ['to_buffer', 'from_buffer'])
        .where('status', 'not in', ['complete', 'failed'])
        .executeTakeFirst();
      if (buffered || moving) {
        throw new AppError(409, ErrorCode.BUILDING_BUSY, 'station buffer is not empty');
      }

      const worker = await trx
        .selectFrom('resident')
        .selectAll()
        .where('id', '=', command.worker_id)
        .where('owner_id', '=', ownerId)
        .executeTakeFirst();
      if (!worker) {
        throw new AppError(404, ErrorCode.RESIDENT_NOT_FOUND, 'worker not found');
      }
      if (worker.status !== 'idle' || worker.profession !== recipe.requiredProfession) {
        throw new AppError(
          409,
          ErrorCode.WRONG_PROFESSION,
          `recipe ${command.recipe_id} needs an idle ${recipe.requiredProfession}`
        );
      }
      if (!PROFESSIONS.includes(worker.profession as (typeof PROFESSIONS)[number])) {
        throw new AppError(
          409,
          ErrorCode.WRONG_PROFESSION,
          `unknown profession ${worker.profession}`
        );
      }
      const busy = await trx
        .selectFrom('craft_order')
        .select('id')
        .where('worker_id', '=', command.worker_id)
        .where('status', 'in', ['active', 'blocked'])
        .executeTakeFirst();
      if (busy) {
        throw new AppError(409, ErrorCode.BUILDING_BUSY, 'worker is already crafting');
      }

      const orderId = randomUUID();
      await trx
        .insertInto('craft_order')
        .values({
          id: orderId,
          owner_id: ownerId,
          building_id: building.id,
          recipe_id: command.recipe_id,
          worker_id: command.worker_id,
          progress: 0,
          work_required: recipe.productionSeconds,
          status: 'active',
          created_at: now,
          updated_at: now
        })
        .execute();

      return {
        events: [
          {
            type: 'CraftStarted',
            payload: {
              orderId,
              buildingId: building.id,
              recipeId: command.recipe_id,
              workerId: command.worker_id
            }
          }
        ]
      };
    }
  );
}

export async function cancelCraftCommand(
  db: Kysely<DB>,
  ownerId: string,
  command: CancelCraftCommand,
  now: Date
): Promise<{ replayed: boolean }> {
  return executeCommand(
    db,
    ownerId,
    command,
    'cancel_craft',
    { building_id: command.building_id },
    now,
    async ({ trx }) => {
      const order = await trx
        .selectFrom('craft_order')
        .selectAll()
        .where('building_id', '=', command.building_id)
        .where('owner_id', '=', ownerId)
        .where('status', 'in', ['active', 'blocked'])
        .executeTakeFirst();
      if (!order) {
        throw new AppError(404, ErrorCode.CRAFT_NOT_FOUND, 'no active craft order');
      }
      await trx
        .updateTable('craft_order')
        .set({ status: 'cancelled', updated_at: now })
        .where('id', '=', order.id)
        .execute();
      return {
        events: [
          {
            type: 'CraftCancelled',
            payload: { orderId: order.id, buildingId: order.building_id }
          }
        ]
      };
    }
  );
}

/**
 * GDD 3.3 / 4.1: the station turns buffered inputs into buffered outputs on the
 * authoritative tick. Inputs must already sit in the building buffer (delivered
 * by carriers); outputs land in the buffer and are hauled out by carriers.
 */
export async function advanceCraft(
  queryable: Queryable,
  ownerId: string,
  ticks: number,
  balance: WorldBalance,
  now: Date
): Promise<OutboxEvent[]> {
  const orders = await queryable
    .selectFrom('craft_order')
    .selectAll()
    .where('owner_id', '=', ownerId)
    .where('status', 'in', ['active', 'blocked'])
    .execute();
  if (orders.length === 0) return [];

  const buildingIds = [...new Set(orders.map((order) => order.building_id))];
  const buildings = await queryable
    .selectFrom('building')
    .selectAll()
    .where('id', 'in', buildingIds)
    .execute();
  const buildingById = new Map(buildings.map((building) => [building.id, building]));

  const bufferRows = await queryable
    .selectFrom('building_buffer')
    .selectAll()
    .where('building_id', 'in', buildingIds)
    .execute();
  const bufferByKey = new Map(
    bufferRows.map((buffer) => [`${buffer.building_id}:${buffer.item}`, buffer])
  );

  const events: OutboxEvent[] = [];

  for (const order of orders) {
    const building = buildingById.get(order.building_id);
    const recipe = balance.recipes[order.recipe_id];
    if (!building || building.status !== 'complete' || !recipe) continue;

    const worker = order.worker_id
      ? await queryable
          .selectFrom('resident')
          .select(['profession', 'status'])
          .where('id', '=', order.worker_id)
          .where('owner_id', '=', ownerId)
          .executeTakeFirst()
      : null;
    if (
      !worker ||
      worker.status !== 'idle' ||
      worker.profession !== recipe.requiredProfession
    ) {
      if (order.status !== 'blocked') {
        await queryable
          .updateTable('craft_order')
          .set({ status: 'blocked', updated_at: now })
          .where('id', '=', order.id)
          .execute();
      }
      continue;
    }

    // Inputs are consumed once when work begins, not once per advance request.
    if (order.progress === 0) {
      const hasInputs = Object.entries(recipe.inputs).every(([item, need]) => {
        const buffer = bufferByKey.get(`${building.id}:${item}`);
        return (buffer?.qty ?? 0) >= need;
      });
      if (!hasInputs) {
        if (order.status !== 'blocked') {
          await queryable
            .updateTable('craft_order')
            .set({ status: 'blocked', updated_at: now })
            .where('id', '=', order.id)
            .execute();
        }
        continue;
      }

      for (const [item, need] of Object.entries(recipe.inputs)) {
        const key = `${building.id}:${item}`;
        const buffer = bufferByKey.get(key);
        if (!buffer) continue;
        const nextQty = buffer.qty - need;
        await queryable
          .updateTable('building_buffer')
          .set({ qty: nextQty })
          .where('building_id', '=', building.id)
          .where('item', '=', item)
          .execute();
        buffer.qty = nextQty;
      }
    }

    if (order.status === 'blocked') {
      await queryable
        .updateTable('craft_order')
        .set({ status: 'active', updated_at: now })
        .where('id', '=', order.id)
        .execute();
      order.status = 'active';
    }

    const progress = Math.min(order.work_required, order.progress + ticks);
    if (progress < order.work_required) {
      await queryable
        .updateTable('craft_order')
        .set({ progress, updated_at: now })
        .where('id', '=', order.id)
        .execute();
      order.progress = progress;
      continue;
    }

    const bufferedQty = [...bufferByKey.values()]
      .filter((buffer) => buffer.building_id === building.id)
      .reduce((sum, buffer) => sum + buffer.qty, 0);
    const outputQty = Object.values(recipe.outputs).reduce((sum, qty) => sum + qty, 0);
    if (bufferedQty + outputQty > balance.craft.bufferCapacity) {
      await queryable
        .updateTable('craft_order')
        .set({ progress: order.work_required, status: 'blocked', updated_at: now })
        .where('id', '=', order.id)
        .execute();
      continue;
    }

    for (const [item, qty] of Object.entries(recipe.outputs)) {
      const key = `${building.id}:${item}`;
      const buffer = bufferByKey.get(key);
      if (buffer) {
        await queryable
          .updateTable('building_buffer')
          .set({ qty: buffer.qty + qty })
          .where('building_id', '=', building.id)
          .where('item', '=', item)
          .execute();
        buffer.qty += qty;
      } else {
        await queryable
          .insertInto('building_buffer')
          .values({ building_id: building.id, item, qty, reserved: 0 })
          .execute();
      }
    }

    await queryable
      .updateTable('craft_order')
      .set({
        status: 'complete',
        progress: order.work_required,
        updated_at: now
      })
      .where('id', '=', order.id)
      .execute();

    events.push({
      type: 'CraftCompleted',
      payload: {
        orderId: order.id,
        buildingId: building.id,
        recipeId: order.recipe_id,
        outputs: recipe.outputs
      }
    });
  }

  return events;
}

/**
 * Deliver recipe inputs from storage into the station buffer and haul produced
 * outputs back to storage. Reuses the I.2 carrier state machine through
 * transfer_task rows with the buffer directions.
 */
export async function planProductionTransfers(
  queryable: Queryable,
  ownerId: string,
  region: Region,
  balance: WorldBalance,
  now: Date
): Promise<OutboxEvent[]> {
  const { storages, laborers } = await loadEconomy(queryable, ownerId);
  const idleCarriers = laborers
    .filter((laborer) => laborer.role === 'carrier' && laborer.status === 'idle')
    .sort((a, b) => Number(b.transport === 'cart') - Number(a.transport === 'cart'));
  if (idleCarriers.length === 0) return [];

  const orders = await queryable
    .selectFrom('craft_order')
    .selectAll()
    .where('owner_id', '=', ownerId)
    .where('status', 'in', ['active', 'blocked', 'complete', 'cancelled'])
    .execute();
  if (orders.length === 0) return [];

  const buildingIds = [...new Set(orders.map((order) => order.building_id))];
  const buildings = await queryable
    .selectFrom('building')
    .selectAll()
    .where('id', 'in', buildingIds)
    .execute();
  const buildingById = new Map(buildings.map((building) => [building.id, building]));

  const bufferRows = await queryable
    .selectFrom('building_buffer')
    .selectAll()
    .where('building_id', 'in', buildingIds)
    .execute();
  const bufferByKey = new Map(
    bufferRows.map((buffer) => [`${buffer.building_id}:${buffer.item}`, buffer])
  );

  const active = await queryable
    .selectFrom('transfer_task')
    .selectAll()
    .where('owner_id', '=', ownerId)
    .where('status', 'not in', ['complete', 'failed'])
    .execute();

  const storageById = new Map(storages.map((storage) => [storage.id, storage]));
  const events: OutboxEvent[] = [];

  for (const carrier of idleCarriers) {
    const candidate = chooseProductionTransfer(
      region,
      balance,
      carrier,
      orders,
      buildingById,
      bufferByKey,
      storages,
      active
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

interface ProductionCandidate {
  id: string;
  buildingId: string;
  storageId: string;
  direction: 'to_buffer' | 'from_buffer';
  item: string;
  qty: number;
  pathFrom: Array<[number, number]>;
  pathTo: Array<[number, number]>;
}

function toPoints(keys: string[]): Array<[number, number]> {
  return keys.map((key) => {
    const [x, y] = key.split(':');
    return [Number(x), Number(y)] as [number, number];
  });
}

function accessKeys(graph: WorldGraph, key: string): string[] {
  if (graph.has(key)) return [key];
  const [xText, yText] = key.split(':');
  const x = Number(xText);
  const y = Number(yText);
  if (!Number.isInteger(x) || !Number.isInteger(y)) return [];
  return [
    cellKey(x + 1, y),
    cellKey(x - 1, y),
    cellKey(x, y + 1),
    cellKey(x, y - 1)
  ].filter((candidate) => graph.has(candidate));
}

function chooseProductionTransfer(
  region: Region,
  balance: WorldBalance,
  carrier: LaborerTable,
  orders: CraftOrderRow[],
  buildingById: Map<string, BuildingTable>,
  bufferByKey: Map<string, BuildingBufferTable>,
  storages: StorageRowWithContents[],
  active: {
    building_id: string;
    storage_id: string;
    item: string;
    direction: string;
    qty: number;
  }[]
): ProductionCandidate | null {
  const rawCarrierKey = globalKeyFor(region, carrier.sector_id, carrier.x, carrier.y);
  if (!rawCarrierKey) return null;
  const graph = carrier.transport === 'cart' ? region.cartGraph : region.graph;
  const carrierKeys = accessKeys(graph, rawCarrierKey);
  if (carrierKeys.length === 0) return null;
  const capacity = carrierCapacity(balance, carrier.transport);
  let best: ProductionCandidate | null = null;
  let bestCost = Number.POSITIVE_INFINITY;

  for (const order of orders) {
    const building = buildingById.get(order.building_id);
    const recipe = balance.recipes[order.recipe_id];
    if (!building || !recipe) continue;
    const rawBuildingKey = globalKeyFor(region, building.sector_id, building.x, building.y);
    if (!rawBuildingKey) continue;
    const buildingKeys = accessKeys(graph, rawBuildingKey);
    if (buildingKeys.length === 0) continue;

    const consider = (
      direction: 'to_buffer' | 'from_buffer',
      item: string,
      qty: number,
      storage: StorageRowWithContents
    ): void => {
      if (qty <= 0) return;
      const storageKey = globalKeyFor(region, storage.sector_id, storage.x, storage.y);
      if (!storageKey || !graph.has(storageKey)) return;
      const sourceKeys = direction === 'to_buffer' ? [storageKey] : buildingKeys;
      const destinationKeys = direction === 'to_buffer' ? buildingKeys : [storageKey];
      for (const carrierKey of carrierKeys) {
        for (const sourceKey of sourceKeys) {
          const fromKeys = findPath(graph, carrierKey, sourceKey);
          if (!fromKeys) continue;
          for (const destinationKey of destinationKeys) {
            const toKeys = findPath(graph, sourceKey, destinationKey);
            if (!toKeys) continue;
            const cost = fromKeys.length + toKeys.length;
            if (cost >= bestCost) continue;
            bestCost = cost;
            best = {
              id: randomUUID(),
              buildingId: building.id,
              storageId: storage.id,
              direction,
              item,
              qty: Math.max(1, Math.min(qty, capacity)),
              pathFrom: toPoints(fromKeys),
              pathTo: toPoints(toKeys)
            };
          }
        }
      }
    };

    // Inputs: deliver until an unfinished order has a full batch in its buffer.
    if (
      order.status !== 'complete' &&
      order.status !== 'cancelled' &&
      order.progress === 0
    ) {
      for (const [item, need] of Object.entries(recipe.inputs)) {
        const buffer = bufferByKey.get(`${building.id}:${item}`);
        const have = buffer?.qty ?? 0;
        const incoming = active
          .filter(
            (task) =>
              task.building_id === building.id &&
              task.item === item &&
              task.direction === 'to_buffer'
          )
          .reduce((sum, task) => sum + task.qty, 0);
        const missing = need - have - incoming;
        if (missing <= 0) continue;
        for (const storage of storages) {
          if (!storageAccepts(balance, storage.type, item)) continue;
          const content = storage.contents.find((entry) => entry.item === item);
          const reservedOut = active
            .filter(
              (task) =>
                task.storage_id === storage.id &&
                task.item === item &&
                task.direction === 'to_buffer'
            )
            .reduce((sum, task) => sum + task.qty, 0);
          const available = (content?.qty ?? 0) - reservedOut;
          if (available <= 0) continue;
          consider('to_buffer', item, Math.min(missing, available), storage);
        }
      }
    }

    // Outputs: haul produced goods out of the buffer.
    const haulItems =
      order.status === 'cancelled'
        ? [...new Set([...Object.keys(recipe.inputs), ...Object.keys(recipe.outputs)])]
        : Object.keys(recipe.outputs);
    for (const item of haulItems) {
      const buffer = bufferByKey.get(`${building.id}:${item}`);
      const have = buffer?.qty ?? 0;
      const outgoing = active
        .filter(
          (task) =>
            task.building_id === building.id &&
            task.item === item &&
            task.direction === 'from_buffer'
        )
        .reduce((sum, task) => sum + task.qty, 0);
      const available = have - outgoing;
      if (available <= 0) continue;
      for (const storage of storages) {
        if (!storageAccepts(balance, storage.type, item)) continue;
        const volume = itemVolume(balance, item);
        const reservedVolume = active
          .filter(
            (task) =>
              task.storage_id === storage.id &&
              (task.direction === 'from_buffer' || task.direction === 'to_storage')
          )
          .reduce(
            (sum, task) => sum + task.qty * itemVolume(balance, task.item),
            0
          );
        const capacityQty = Math.floor((storageFree(storage) - reservedVolume) / volume);
        if (capacityQty <= 0) continue;
        consider('from_buffer', item, Math.min(available, capacityQty), storage);
      }
    }
  }

  return best;
}
