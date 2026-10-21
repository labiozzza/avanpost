import { randomUUID } from 'node:crypto';
import type { Kysely, Transaction } from 'kysely';
import { settlementOrigin } from '@avanpost/sim';
import { ErrorCode, type Transport } from '@avanpost/shared';
import type { WorldBalance } from '../balance';
import type {
  DB,
  LaborerTable,
  ResourceNodeTable,
  StorageTable,
  WorldSectorTable
} from '../db/schema';
import { AppError } from '../errors';

type Queryable = Kysely<DB> | Transaction<DB>;

export interface StorageRowWithContents extends StorageTable {
  contents: Array<{ item: string; qty: number }>;
}

export function itemVolume(balance: WorldBalance, itemId: string): number {
  const item = balance.items[itemId];
  if (!item) throw new Error(`unknown item ${itemId}`);
  return item.volume;
}

export function storageAccepts(
  balance: WorldBalance,
  storageType: string,
  itemId: string
): boolean {
  const type = balance.storageTypes[storageType];
  const item = balance.items[itemId];
  return Boolean(type && item && type.categories.includes(item.category));
}

export function storageFree(storage: StorageTable): number {
  return Math.max(0, storage.capacity - storage.volume - storage.reserved);
}

export function carrierCapacity(balance: WorldBalance, transport: Transport): number {
  return transport === 'cart' ? balance.carrier.cartCapacity : balance.carrier.capacity;
}

export async function loadStorages(
  queryable: Queryable,
  ownerId: string
): Promise<StorageRowWithContents[]> {
  const storages = await queryable
    .selectFrom('storage')
    .selectAll()
    .where('owner_id', '=', ownerId)
    .orderBy('type')
    .orderBy('x')
    .execute();
  if (storages.length === 0) return [];

  const items = await queryable
    .selectFrom('storage_item')
    .selectAll()
    .where(
      'storage_id',
      'in',
      storages.map((storage) => storage.id)
    )
    .orderBy('item')
    .execute();

  const byStorage = new Map<string, Array<{ item: string; qty: number }>>();
  for (const item of items) {
    const list = byStorage.get(item.storage_id) ?? [];
    list.push({ item: item.item, qty: item.qty });
    byStorage.set(item.storage_id, list);
  }

  return storages.map((storage) => ({
    ...storage,
    contents: byStorage.get(storage.id) ?? []
  }));
}

export async function createEconomy(
  queryable: Queryable,
  ownerId: string,
  sectorId: string,
  origin: { x: number; y: number },
  balance: WorldBalance,
  now: Date
): Promise<void> {
  const storageIds: string[] = [];
  let firstStorageCell: { x: number; y: number } | null = null;

  for (const config of balance.startingStorages) {
    const type = balance.storageTypes[config.type];
    if (!type) throw new Error(`unknown storage type ${config.type}`);

    let volume = 0;
    for (const [itemId, qty] of Object.entries(config.items)) {
      volume += itemVolume(balance, itemId) * qty;
    }

    const storageId = randomUUID();
    const x = origin.x + config.dx;
    const y = origin.y + config.dy;
    storageIds.push(storageId);
    firstStorageCell ??= { x, y };

    await queryable
      .insertInto('storage')
      .values({
        id: storageId,
        owner_id: ownerId,
        sector_id: sectorId,
        type: config.type,
        x,
        y,
        capacity: type.capacity,
        volume,
        reserved: 0,
        created_at: now
      })
      .execute();

    for (const [itemId, qty] of Object.entries(config.items)) {
      if (qty <= 0) continue;
      await queryable
        .insertInto('storage_item')
        .values({ storage_id: storageId, item: itemId, qty })
        .execute();
    }
  }

  for (const node of balance.nodes) {
    await queryable
      .insertInto('resource_node')
      .values({
        id: randomUUID(),
        owner_id: ownerId,
        sector_id: sectorId,
        kind: node.kind,
        item: node.item,
        x: origin.x + node.dx,
        y: origin.y + node.dy,
        amount: node.amount,
        max_amount: node.amount,
        renewable: node.renewable,
        regen_per_tick: node.regenPerTick,
        yield_per_tick: node.yieldPerTick,
        buffer: 0,
        buffer_reserved: 0,
        buffer_capacity: node.bufferCapacity,
        active: false,
        gatherer_id: null,
        created_at: now
      })
      .execute();
  }

  const carrierCell = firstStorageCell ?? { x: origin.x, y: origin.y };
  for (let index = 0; index < balance.carrier.count; index += 1) {
    await queryable
      .insertInto('laborer')
      .values({
        id: randomUUID(),
        owner_id: ownerId,
        sector_id: sectorId,
        role: 'carrier',
        status: 'idle',
        transport: index < balance.carrier.cartCount ? 'cart' : 'person',
        x: carrierCell.x,
        y: carrierCell.y,
        node_id: null,
        created_at: now
      })
      .execute();
  }
  for (let index = 0; index < balance.gathererCount; index += 1) {
    await queryable
      .insertInto('laborer')
      .values({
        id: randomUUID(),
        owner_id: ownerId,
        sector_id: sectorId,
        role: 'gatherer',
        status: 'idle',
        transport: 'person',
        x: origin.x + 2,
        y: origin.y + 2,
        node_id: null,
        created_at: now
      })
      .execute();
  }
  for (let index = 0; index < balance.builderCount; index += 1) {
    await queryable
      .insertInto('laborer')
      .values({
        id: randomUUID(),
        owner_id: ownerId,
        sector_id: sectorId,
        role: 'builder',
        status: 'idle',
        transport: 'person',
        x: origin.x + 3,
        y: origin.y + 2,
        node_id: null,
        created_at: now
      })
      .execute();
  }
}

export async function chargeSectorCost(
  queryable: Queryable,
  ownerId: string,
  balance: WorldBalance
): Promise<{ logs: number; stone: number }> {
  const required = [
    { item: 'logs', qty: balance.sector.unlock.cost.wood },
    { item: 'stone', qty: balance.sector.unlock.cost.stone }
  ].filter((entry) => entry.qty > 0);

  const storages = await loadStorages(queryable, ownerId);
  for (const entry of required) {
    const available = storages.reduce(
      (total, storage) =>
        total + (storage.contents.find((item) => item.item === entry.item)?.qty ?? 0),
      0
    );
    if (available < entry.qty) {
      throw new AppError(
        409,
        ErrorCode.INSUFFICIENT_RESOURCE,
        `нужно ${entry.qty} ${entry.item}, на складах ${available}`
      );
    }
  }

  for (const entry of required) {
    let remaining = entry.qty;
    for (const storage of storages) {
      if (remaining <= 0) break;
      const content = storage.contents.find((item) => item.item === entry.item);
      if (!content || content.qty <= 0) continue;
      const take = Math.min(content.qty, remaining);
      const volume = take * itemVolume(balance, entry.item);
      if (content.qty - take <= 0) {
        await queryable
          .deleteFrom('storage_item')
          .where('storage_id', '=', storage.id)
          .where('item', '=', entry.item)
          .execute();
      } else {
        await queryable
          .updateTable('storage_item')
          .set({ qty: content.qty - take })
          .where('storage_id', '=', storage.id)
          .where('item', '=', entry.item)
          .execute();
      }
      await queryable
        .updateTable('storage')
        .set({ volume: Math.max(0, storage.volume - volume) })
        .where('id', '=', storage.id)
        .execute();
      content.qty -= take;
      storage.volume = Math.max(0, storage.volume - volume);
      remaining -= take;
    }
  }

  return {
    logs: balance.sector.unlock.cost.wood,
    stone: balance.sector.unlock.cost.stone
  };
}

export async function addStorageItem(
  queryable: Queryable,
  storageId: string,
  item: string,
  qty: number,
  volume: number
): Promise<void> {
  const existing = await queryable
    .selectFrom('storage_item')
    .selectAll()
    .where('storage_id', '=', storageId)
    .where('item', '=', item)
    .executeTakeFirst();
  if (existing) {
    await queryable
      .updateTable('storage_item')
      .set({ qty: existing.qty + qty })
      .where('storage_id', '=', storageId)
      .where('item', '=', item)
      .execute();
  } else {
    await queryable
      .insertInto('storage_item')
      .values({ storage_id: storageId, item, qty })
      .execute();
  }
  const storage = await queryable
    .selectFrom('storage')
    .selectAll()
    .where('id', '=', storageId)
    .executeTakeFirstOrThrow();
  await queryable
    .updateTable('storage')
    .set({
      volume: Math.min(storage.capacity, storage.volume + volume),
      reserved: Math.max(0, storage.reserved - volume)
    })
    .where('id', '=', storageId)
    .execute();
}

export interface EconomyRows {
  storages: StorageRowWithContents[];
  nodes: ResourceNodeTable[];
  laborers: LaborerTable[];
}

export async function loadEconomy(
  queryable: Queryable,
  ownerId: string
): Promise<EconomyRows> {
  const [storages, nodes, laborers] = await Promise.all([
    loadStorages(queryable, ownerId),
    queryable
      .selectFrom('resource_node')
      .selectAll()
      .where('owner_id', '=', ownerId)
      .orderBy('kind')
      .execute(),
    queryable
      .selectFrom('laborer')
      .selectAll()
      .where('owner_id', '=', ownerId)
      .orderBy('created_at')
      .execute()
  ]);
  return { storages, nodes, laborers };
}

export function storageLabel(balance: WorldBalance, type: string): string {
  return balance.storageTypes[type]?.label ?? type;
}

export function pendingEconomySector(
  sector: WorldSectorTable,
  balance: WorldBalance
): { x: number; y: number } {
  return settlementOrigin(sector.width, sector.height);
}
