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
  quantities: PeaceLiteItemQuantitiesSchema
}).strict();

/**
 * Additive Lite ledger shape. `locations` are the authoritative physical stock;
 * accounting counters describe how items entered or left that stock. Reservations
 * are deliberately not represented as quantities and therefore cannot mint stock.
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
    if (ledger.locations.some((other, otherIndex) => otherIndex < index &&
      other.locationKind === location.locationKind && other.locationId === location.locationId)) {
      context.addIssue({ code: 'custom', path: ['locations', index], message: 'Physical ledger locations must be unique.' });
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

export function totalPeaceLiteItem(ledger: PeaceLitePhysicalLedger, itemId: PeaceLiteItemId): number {
  return ledger.locations.reduce((total, location) => total + location.quantities[itemId], 0);
}
