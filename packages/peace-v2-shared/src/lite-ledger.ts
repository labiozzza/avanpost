import { z } from 'zod';

/** Peace Lite V1's physical SKU contract. Legacy Peace V2 cargo stays binary. */
export const PeaceLiteItemIdSchema = z.enum([
  'wood', 'stone', 'vegetables', 'meat', 'metal', 'cloth', 'reagents'
]);
export type PeaceLiteItemId = z.infer<typeof PeaceLiteItemIdSchema>;

export const PeaceLiteItemDefinitionSchema = z.object({
  id: PeaceLiteItemIdSchema,
  name: z.string().min(1),
  unit: z.string().min(1),
  volumePerUnit: z.literal(1),
  compatibleStorage: z.array(z.literal('warehouse')).min(1),
  sourceSection: z.string().min(1),
  status: z.enum(['proposed', 'approved'])
}).strict();
export type PeaceLiteItemDefinition = z.infer<typeof PeaceLiteItemDefinitionSchema>;

export const PeaceLiteItemCatalogSchema = z.object({
  version: z.string().regex(/^\d+\.\d+\.\d+$/),
  status: z.enum(['proposed', 'approved']),
  sourceSection: z.string().min(1),
  contentHash: z.string().regex(/^[a-f0-9]{64}$/),
  items: z.array(PeaceLiteItemDefinitionSchema).length(7)
}).strict().superRefine((catalog, context) => {
  const ids = catalog.items.map((item) => item.id);
  const expected = [...PeaceLiteItemIdSchema.options].sort();
  if (new Set(ids).size !== expected.length || [...ids].sort().some((id, index) => id !== expected[index])) {
    context.addIssue({ code: 'custom', path: ['items'], message: 'Lite V1 item catalog must contain each of the seven physical SKUs exactly once.' });
  }
  catalog.items.forEach((item, index) => {
    if (item.sourceSection !== catalog.sourceSection || item.status !== catalog.status) {
      context.addIssue({ code: 'custom', path: ['items', index], message: 'Item provenance must match its catalog metadata.' });
    }
  });
});
export type PeaceLiteItemCatalog = z.infer<typeof PeaceLiteItemCatalogSchema>;

export const PeaceLiteItemQuantitiesSchema = z.object({
  wood: z.number().int().safe().nonnegative(),
  stone: z.number().int().safe().nonnegative(),
  vegetables: z.number().int().safe().nonnegative(),
  meat: z.number().int().safe().nonnegative(),
  metal: z.number().int().safe().nonnegative(),
  cloth: z.number().int().safe().nonnegative(),
  reagents: z.number().int().safe().nonnegative()
}).strict();
export type PeaceLiteItemQuantities = z.infer<typeof PeaceLiteItemQuantitiesSchema>;

export const PeaceLiteLedgerLocationKindSchema = z.enum([
  'source', 'buffer', 'cargo', 'storage', 'site', 'school', 'research', 'royal-point'
]);

export const PeaceLitePhysicalLocationSchema = z.object({
  locationKind: PeaceLiteLedgerLocationKindSchema,
  locationId: z.string().min(1).max(128),
  quantities: PeaceLiteItemQuantitiesSchema,
  capacity: z.number().int().safe().nonnegative().nullable(),
  reservedInbound: PeaceLiteItemQuantitiesSchema,
  reservedOutbound: PeaceLiteItemQuantitiesSchema
}).strict().superRefine((location, context) => {
  const stored = PeaceLiteItemIdSchema.options.reduce((sum, itemId) => sum + location.quantities[itemId], 0);
  const incoming = PeaceLiteItemIdSchema.options.reduce((sum, itemId) => sum + location.reservedInbound[itemId], 0);
  for (const itemId of PeaceLiteItemIdSchema.options) {
    if (location.reservedOutbound[itemId] > location.quantities[itemId]) {
      context.addIssue({ code: 'custom', path: ['reservedOutbound', itemId], message: 'Outbound reservation exceeds physical stock.' });
    }
    if (location.locationKind !== 'storage' && location.reservedInbound[itemId] > 0) {
      context.addIssue({ code: 'custom', path: ['reservedInbound', itemId], message: 'Only storage locations may have inbound reservations.' });
    }
  }
  if (location.locationKind === 'storage') {
    if (location.capacity === null) {
      context.addIssue({ code: 'custom', path: ['capacity'], message: 'Storage requires a finite capacity.' });
    } else if (stored + incoming > location.capacity) {
      context.addIssue({ code: 'custom', path: ['reservedInbound'], message: 'Stored stock plus inbound reservations exceed storage capacity.' });
    }
  } else if (location.capacity !== null) {
    context.addIssue({ code: 'custom', path: ['capacity'], message: 'Only storage locations define warehouse capacity.' });
  }
});

/**
 * Additive Lite ledger shape. `locations` are the authoritative physical stock;
 * accounting counters describe how items entered or left that stock. Reservations
 * are deliberately separate from quantities and therefore cannot mint stock.
 * In v1.0 all catalog SKUs use one volume unit per item; capacity checks use that
 * catalog contract and must be versioned if item volumes change.
 */
export const PeaceLitePhysicalLedgerSchema = z.object({
  version: z.literal(1),
  initial: PeaceLiteItemQuantitiesSchema,
  produced: PeaceLiteItemQuantitiesSchema,
  consumed: PeaceLiteItemQuantitiesSchema,
  royalDelivered: PeaceLiteItemQuantitiesSchema,
  locations: z.array(PeaceLitePhysicalLocationSchema)
}).strict().superRefine((ledger, context) => {
  const totals = Object.fromEntries(PeaceLiteItemIdSchema.options.map((itemId) => [itemId, 0])) as PeaceLiteItemQuantities;
  ledger.locations.forEach((location, index) => {
    for (const itemId of PeaceLiteItemIdSchema.options) totals[itemId] += location.quantities[itemId];
    if (ledger.locations.some((other, otherIndex) => otherIndex < index && other.locationId === location.locationId)) {
      context.addIssue({ code: 'custom', path: ['locations', index, 'locationId'], message: 'Physical ledger location IDs must be globally unique.' });
    }
  });

  for (const itemId of PeaceLiteItemIdSchema.options) {
    const expected = ledger.initial[itemId] + ledger.produced[itemId] - ledger.consumed[itemId] - ledger.royalDelivered[itemId];
    if (expected < 0 || totals[itemId] !== expected) {
      context.addIssue({
        code: 'custom', path: ['locations'],
        message: `Physical conservation failed for ${itemId}: expected ${expected}, found ${totals[itemId]}.`
      });
    }
  }
});
export type PeaceLitePhysicalLedger = z.infer<typeof PeaceLitePhysicalLedgerSchema>;

/** Explicit adapter for the legacy two-SKU snapshot. Legacy quantities are mapped
 * by physical location (never into a second shadow inventory); callers must supply
 * any cargo already detached from source buffers. */
export function normalizeLegacyWoodStoneLedger(input: {
  storages: Array<{ id: string; capacity: number; contents: Array<{ item: string; qty: number }>; reservedInbound?: Array<{ item: string; qty: number }>; reservedOutbound?: Array<{ item: string; qty: number }> }>;
  buffers?: Array<{ id: string; item: string; quantity: number; reserved?: number }>;
  cargo?: Array<{ id: string; item: string; quantity: number }>;
  sites?: Array<{ id: string; wood: number; stone: number }>;
  schools?: Array<{ id: string; wood: number }>;
}): PeaceLitePhysicalLedger {
  const empty = (): PeaceLiteItemQuantities => ({ wood: 0, stone: 0, vegetables: 0, meat: 0, metal: 0, cloth: 0, reagents: 0 });
  const add = (target: PeaceLiteItemQuantities, item: string, qty: number): void => {
    if (item !== 'wood' && item !== 'stone') throw new Error(`Legacy snapshot contains unsupported item: ${item}`);
    target[item] += z.number().int().safe().nonnegative().parse(qty);
  };
  const locations: PeaceLitePhysicalLedger['locations'] = [];
  for (const storage of input.storages) {
    const quantities = empty(); const reservedInbound = empty(); const reservedOutbound = empty();
    storage.contents.forEach(({ item, qty }) => add(quantities, item, qty));
    storage.reservedInbound?.forEach(({ item, qty }) => add(reservedInbound, item, qty));
    storage.reservedOutbound?.forEach(({ item, qty }) => add(reservedOutbound, item, qty));
    locations.push({ locationKind: 'storage', locationId: storage.id, quantities, capacity: storage.capacity, reservedInbound, reservedOutbound });
  }
  for (const buffer of input.buffers ?? []) {
    const quantities = empty(); const reservedOutbound = empty();
    add(quantities, buffer.item, buffer.quantity);
    if (buffer.reserved) add(reservedOutbound, buffer.item, buffer.reserved);
    locations.push({ locationKind: 'buffer', locationId: buffer.id, quantities, capacity: null, reservedInbound: empty(), reservedOutbound });
  }
  for (const cargo of input.cargo ?? []) {
    const quantities = empty(); add(quantities, cargo.item, cargo.quantity);
    locations.push({ locationKind: 'cargo', locationId: cargo.id, quantities, capacity: null, reservedInbound: empty(), reservedOutbound: empty() });
  }
  for (const site of input.sites ?? []) {
    const quantities = empty(); add(quantities, 'wood', site.wood); add(quantities, 'stone', site.stone);
    locations.push({ locationKind: 'site', locationId: site.id, quantities, capacity: null, reservedInbound: empty(), reservedOutbound: empty() });
  }
  for (const school of input.schools ?? []) {
    const quantities = empty(); add(quantities, 'wood', school.wood);
    locations.push({ locationKind: 'school', locationId: school.id, quantities, capacity: null, reservedInbound: empty(), reservedOutbound: empty() });
  }
  const initial = empty();
  for (const location of locations) for (const id of PeaceLiteItemIdSchema.options) initial[id] += location.quantities[id];
  return PeaceLitePhysicalLedgerSchema.parse({ version: 1, initial, produced: empty(), consumed: empty(), royalDelivered: empty(), locations });
}

/** Adapter for the actual pre-ledger PeaceWorldSnapshot representation. `resources`
 * is intentionally excluded: it is a legacy aggregate/projection, not another location. */
export function normalizeLegacyPeaceWorldSnapshot(world: {
  storages?: Array<{ id: string; capacity: number; contents: Record<string, number>; reservedInbound: Record<string, number>; reservedOutbound: Record<string, number> }>;
  storage: { id: string; capacity: number };
  resources: Record<string, number>;
  trees: Array<{ id: string; bufferQuantity: number; reservedBuffer: number }>;
  stoneDeposits: Array<{ id: string; bufferQuantity: number; reservedBuffer: number }>;
  undergroundDeposits?: Array<{ id: string; bufferQuantity: number; reservedBuffer: number }>;
  residents: Array<{ id: string; cargo: number; cargoItemId: string | null }>;
  buildings?: Array<{
    id: string;
    reservedWood: number;
    reservedStone: number;
    trainingMaterialsWood?: number;
  }>;
}): PeaceLitePhysicalLedger {
  return normalizeLegacyWoodStoneLedger({
    storages: (world.storages ?? [{ id: world.storage.id, capacity: world.storage.capacity,
      contents: { wood: world.resources.wood ?? 0, stone: world.resources.stone ?? 0 },
      reservedInbound: {}, reservedOutbound: {} }]).map((storage) => ({
      id: storage.id, capacity: storage.capacity,
      contents: Object.entries(storage.contents).map(([item, qty]) => ({ item, qty })),
      reservedInbound: Object.entries(storage.reservedInbound ?? {}).map(([item, qty]) => ({ item, qty })),
      reservedOutbound: Object.entries(storage.reservedOutbound ?? {}).map(([item, qty]) => ({ item, qty }))
    })),
    cargo: world.residents.filter((resident) => resident.cargo > 0).map((resident) => {
      if (resident.cargoItemId === null) throw new Error(`Legacy resident ${resident.id} has quantity without a cargo item.`);
      return { id: `resident:${resident.id}`, item: resident.cargoItemId, quantity: resident.cargo };
    }),
    // Construction stock has left the warehouse and remains physical at the
    // worksite. School training stock is separate from building materials.
    buffers: [
      ...world.trees.map((node) => ({ id: `tree:${node.id}`, item: 'wood', quantity: node.bufferQuantity, reserved: node.reservedBuffer })),
      ...world.stoneDeposits.map((node) => ({ id: `deposit:${node.id}`, item: 'stone', quantity: node.bufferQuantity, reserved: node.reservedBuffer })),
      ...(world.undergroundDeposits ?? []).map((deposit) => ({
        id: `underground-deposit:${deposit.id}`, item: 'stone', quantity: deposit.bufferQuantity, reserved: deposit.reservedBuffer
      }))
    ],
    sites: world.buildings?.map((building) => ({
      id: `site:${building.id}`,
      wood: building.reservedWood,
      stone: building.reservedStone
    })),
    schools: world.buildings?.filter((building) => (building.trainingMaterialsWood ?? 0) > 0).map((building) => ({
      id: `school:${building.id}`, wood: building.trainingMaterialsWood!
    }))
  });
}

export function reservePeaceLiteStorage(
  ledger: PeaceLitePhysicalLedger,
  storageId: string,
  itemId: PeaceLiteItemId,
  quantity: number,
  direction: 'inbound' | 'outbound'
): PeaceLitePhysicalLedger {
  const amount = z.number().int().safe().positive().parse(quantity);
  const current = PeaceLitePhysicalLedgerSchema.parse(ledger);
  let found = false;
  const locations = current.locations.map((location) => {
    if (location.locationKind !== 'storage' || location.locationId !== storageId) return location;
    found = true;
    const reservations = { ...location[direction === 'inbound' ? 'reservedInbound' : 'reservedOutbound'] };
    reservations[itemId] += amount;
    return direction === 'inbound'
      ? { ...location, reservedInbound: reservations }
      : { ...location, reservedOutbound: reservations };
  });
  if (!found) throw new Error(`Unknown Lite storage: ${storageId}`);
  return PeaceLitePhysicalLedgerSchema.parse({ ...current, locations });
}

export function releasePeaceLiteStorageReservation(
  ledger: PeaceLitePhysicalLedger,
  storageId: string,
  itemId: PeaceLiteItemId,
  quantity: number,
  direction: 'inbound' | 'outbound'
): PeaceLitePhysicalLedger {
  const amount = z.number().int().safe().positive().parse(quantity);
  const current = PeaceLitePhysicalLedgerSchema.parse(ledger);
  let found = false;
  const locations = current.locations.map((location) => {
    if (location.locationKind !== 'storage' || location.locationId !== storageId) return location;
    found = true;
    const field = direction === 'inbound' ? 'reservedInbound' : 'reservedOutbound';
    if (location[field][itemId] < amount) throw new Error(`Cannot release more ${direction} reservation than exists.`);
    return { ...location, [field]: { ...location[field], [itemId]: location[field][itemId] - amount } };
  });
  if (!found) throw new Error(`Unknown Lite storage: ${storageId}`);
  return PeaceLitePhysicalLedgerSchema.parse({ ...current, locations });
}

/** Move physical units between locations; transfers do not increment production or consumption. */
export function transferPeaceLiteItems(
  ledger: PeaceLitePhysicalLedger,
  sourceId: string,
  destinationId: string,
  itemId: PeaceLiteItemId,
  quantity: number
): PeaceLitePhysicalLedger {
  const amount = z.number().int().safe().positive().parse(quantity);
  const current = PeaceLitePhysicalLedgerSchema.parse(ledger);
  if (sourceId === destinationId) throw new Error('A physical transfer requires distinct locations.');
  const sourceIndex = current.locations.findIndex((location) => location.locationId === sourceId);
  const destinationIndex = current.locations.findIndex((location) => location.locationId === destinationId);
  if (sourceIndex < 0 || destinationIndex < 0) throw new Error('Physical transfer location not found.');
  const source = current.locations[sourceIndex]!;
  const destination = current.locations[destinationIndex]!;
  if (source.locationKind === 'storage' && source.reservedOutbound[itemId] < amount) {
    throw new Error('Storage stock must be reserved before outbound transfer.');
  }
  if (source.quantities[itemId] < amount) throw new Error('Insufficient physical stock for transfer.');

  const nextLocations = [...current.locations];
  nextLocations[sourceIndex] = {
    ...source,
    quantities: { ...source.quantities, [itemId]: source.quantities[itemId] - amount },
    ...(source.locationKind === 'storage'
      ? { reservedOutbound: { ...source.reservedOutbound, [itemId]: source.reservedOutbound[itemId] - amount } }
      : {})
  };

  let destinationReservedInbound = destination.reservedInbound;
  if (destination.locationKind === 'storage') {
    const totalReserved = PeaceLiteItemIdSchema.options.reduce((sum, item) => sum + destination.reservedInbound[item], 0);
    const matchedReservation = Math.min(amount, destination.reservedInbound[itemId]);
    const unreservedAmount = amount - matchedReservation;
    const usedVolume = PeaceLiteItemIdSchema.options.reduce((sum, item) => sum + destination.quantities[item], 0);
    if (destination.capacity === null || usedVolume + totalReserved + unreservedAmount > destination.capacity) {
      throw new Error('Insufficient unreserved storage capacity for transfer.');
    }
    destinationReservedInbound = { ...destination.reservedInbound, [itemId]: destination.reservedInbound[itemId] - matchedReservation };
  }
  nextLocations[destinationIndex] = {
    ...destination,
    quantities: { ...destination.quantities, [itemId]: destination.quantities[itemId] + amount },
    reservedInbound: destinationReservedInbound
  };
  return PeaceLitePhysicalLedgerSchema.parse({ ...current, locations: nextLocations });
}

export function totalPeaceLiteItem(ledger: PeaceLitePhysicalLedger, itemId: PeaceLiteItemId): number {
  return ledger.locations.reduce((total, location) => total + location.quantities[itemId], 0);
}
