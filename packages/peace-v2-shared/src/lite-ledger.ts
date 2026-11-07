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
  volumePerUnit: z.number().int().safe().positive(),
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
    if (location.locationKind !== 'storage' && (location.reservedInbound[itemId] > 0 || location.reservedOutbound[itemId] > 0)) {
      context.addIssue({ code: 'custom', path: ['reservedInbound', itemId], message: 'Only storage locations may have stock reservations.' });
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
