import { describe, expect, it } from 'vitest';
import {
  PeaceLiteItemIdSchema,
  PeaceLitePhysicalLedgerSchema,
  releasePeaceLiteStorageReservation,
  reservePeaceLiteStorage,
  totalPeaceLiteItem,
  normalizeLegacyWoodStoneLedger,
  normalizeLegacyPeaceWorldSnapshot,
  transferPeaceLiteItems,
  type PeaceLiteItemQuantities
} from '../src/index.js';

const empty: PeaceLiteItemQuantities = {
  wood: 0, stone: 0, vegetables: 0, meat: 0, metal: 0, cloth: 0, reagents: 0
};
const location = (locationKind: 'storage' | 'cargo', locationId: string, quantities: PeaceLiteItemQuantities,
  capacity: number | null = null, reservedInbound = empty, reservedOutbound = empty) => ({
  locationKind, locationId, quantities, capacity, reservedInbound, reservedOutbound
});

describe('Peace Lite physical ledger contract', () => {
  it('defines exactly the seven physical item IDs', () => {
    expect(PeaceLiteItemIdSchema.options).toEqual([
      'wood', 'stone', 'vegetables', 'meat', 'metal', 'cloth', 'reagents'
    ]);
    expect(PeaceLiteItemIdSchema.safeParse('ore').success).toBe(false);
  });

  it('normalizes legacy stock, inbound/outbound reservations, and in-flight cargo without losing units', () => {
    const migrated = normalizeLegacyWoodStoneLedger({
      storages: [{ id: 'wh', capacity: 10, contents: [{ item: 'wood', qty: 3 }, { item: 'stone', qty: 2 }],
        reservedInbound: [{ item: 'wood', qty: 1 }], reservedOutbound: [{ item: 'stone', qty: 1 }] }],
      buffers: [{ id: 'node', item: 'wood', quantity: 2, reserved: 1 }],
      cargo: [{ id: 'carrier', item: 'stone', quantity: 1 }]
    });
    expect(totalPeaceLiteItem(migrated, 'wood')).toBe(5);
    expect(totalPeaceLiteItem(migrated, 'stone')).toBe(3);
    expect(migrated.locations.find((entry) => entry.locationId === 'wh')?.reservedInbound.wood).toBe(1);
    expect(migrated.locations.find((entry) => entry.locationId === 'carrier')?.quantities.stone).toBe(1);
    expect(() => normalizeLegacyWoodStoneLedger({ storages: [], buffers: [], cargo: [{ id: 'bad', item: 'ore', quantity: 1 }] })).toThrow(/unsupported item/);
  });

  it('adapts the persisted PeaceWorldSnapshot fields without counting resources projection twice', () => {
    const migrated = normalizeLegacyPeaceWorldSnapshot({
      resources: { wood: 99, stone: 99 }, storage: { id: 'legacy', capacity: 9 },
      storages: [{ id: 'wh', capacity: 9, contents: { wood: 2, stone: 1 }, reservedInbound: { wood: 1, stone: 0 }, reservedOutbound: { wood: 0, stone: 1 } }],
      trees: [{ id: 't', bufferQuantity: 2, reservedBuffer: 1 }],
      stoneDeposits: [{ id: 'd', bufferQuantity: 1, reservedBuffer: 0 }],
      residents: [{ id: 'r', cargo: 1, cargoItemId: 'wood' }],
      buildings: [{ id: 'cabin', reservedWood: 3, reservedStone: 2 },
        { id: 'school', reservedWood: 0, reservedStone: 0, trainingMaterialsWood: 1 }]
    });
    expect(totalPeaceLiteItem(migrated, 'wood')).toBe(9);
    expect(totalPeaceLiteItem(migrated, 'stone')).toBe(4);
    expect(migrated.locations.some((location) => location.locationId === 'resident:r')).toBe(true);
    expect(migrated.locations.find((location) => location.locationId === 'tree:t')?.reservedOutbound.wood).toBe(1);
    expect(migrated.locations.find((location) => location.locationId === 'site:cabin')?.quantities.wood).toBe(3);
    expect(migrated.locations.find((location) => location.locationId === 'school:school')?.quantities.wood).toBe(1);
  });

  it('conserves each item across physical locations after production and consumption', () => {
    const ledger = PeaceLitePhysicalLedgerSchema.parse({
      version: 1,
      initial: { ...empty, wood: 2 },
      produced: { ...empty, wood: 3, vegetables: 4 },
      consumed: { ...empty, wood: 1, vegetables: 1 },
      royalDelivered: { ...empty, vegetables: 1 },
      locations: [
        location('storage', 'warehouse-1', { ...empty, wood: 3, vegetables: 1 }, 10),
        location('cargo', 'worker-1', { ...empty, wood: 1, vegetables: 1 })
      ]
    });

    expect(totalPeaceLiteItem(ledger, 'wood')).toBe(4);
    expect(totalPeaceLiteItem(ledger, 'vegetables')).toBe(2);
  });

  it('rejects stock creation, negative conservation, duplicate locations and unknown item keys', () => {
    const valid = {
      version: 1,
      initial: { ...empty, wood: 1 },
      produced: empty,
      consumed: empty,
      royalDelivered: empty,
      locations: [location('storage', 'warehouse-1', { ...empty, wood: 1 }, 4)]
    };
    expect(PeaceLitePhysicalLedgerSchema.safeParse({
      ...valid,
      locations: [location('storage', 'warehouse-1', empty, 4)]
    }).success).toBe(false);
    expect(PeaceLitePhysicalLedgerSchema.safeParse({
      ...valid,
      consumed: { ...empty, wood: 2 }
    }).success).toBe(false);
    expect(PeaceLitePhysicalLedgerSchema.safeParse({
      ...valid,
      locations: [...valid.locations, ...valid.locations]
    }).success).toBe(false);
    expect(PeaceLitePhysicalLedgerSchema.safeParse({
      ...valid,
      initial: { ...empty, ore: 1 }
    }).success).toBe(false);
  });

  it('counts inbound reservations against capacity without counting them as physical stock', () => {
    const validLedger = {
      version: 1,
      initial: { ...empty, wood: 3 },
      produced: empty,
      consumed: empty,
      royalDelivered: empty,
      locations: [location('storage', 'warehouse-1', { ...empty, wood: 3 }, 5, { ...empty, stone: 2 })]
    };
    const parsed = PeaceLitePhysicalLedgerSchema.parse(validLedger);
    expect(totalPeaceLiteItem(parsed, 'stone')).toBe(0);
    expect(PeaceLitePhysicalLedgerSchema.safeParse({
      ...validLedger,
      locations: [location('storage', 'warehouse-1', { ...empty, wood: 3 }, 4, { ...empty, stone: 2 })]
    }).success).toBe(false);
    expect(PeaceLitePhysicalLedgerSchema.safeParse({
      ...validLedger,
      locations: [location('storage', 'warehouse-1', { ...empty, wood: 3 }, 5, empty, { ...empty, wood: 4 })]
    }).success).toBe(false);
  });

  it('moves stock through reserved storage and cargo without duplication or capacity overrun', () => {
    const initial = PeaceLitePhysicalLedgerSchema.parse({
      version: 1,
      initial: { ...empty, wood: 4 },
      produced: empty,
      consumed: empty,
      royalDelivered: empty,
      locations: [
        location('storage', 'warehouse-source', { ...empty, wood: 4 }, 8),
        location('cargo', 'carrier-1', empty),
        location('storage', 'warehouse-destination', empty, 3)
      ]
    });
    const outboundReserved = reservePeaceLiteStorage(initial, 'warehouse-source', 'wood', 3, 'outbound');
    const inboundReserved = reservePeaceLiteStorage(outboundReserved, 'warehouse-destination', 'wood', 3, 'inbound');
    const carried = transferPeaceLiteItems(inboundReserved, 'warehouse-source', 'carrier-1', 'wood', 3);
    const stored = transferPeaceLiteItems(carried, 'carrier-1', 'warehouse-destination', 'wood', 3);

    expect(totalPeaceLiteItem(stored, 'wood')).toBe(4);
    expect(stored.locations.map((entry) => entry.quantities.wood)).toEqual([1, 0, 3]);
    expect(stored.locations[0]?.reservedOutbound.wood).toBe(0);
    expect(stored.locations[2]?.reservedInbound.wood).toBe(0);
    expect(() => transferPeaceLiteItems(stored, 'warehouse-source', 'carrier-1', 'wood', 1)).toThrow(/reserved/);
  });

  it('releases reservations only when they exist and keeps release non-physical', () => {
    const initial = PeaceLitePhysicalLedgerSchema.parse({
      version: 1,
      initial: { ...empty, stone: 2 },
      produced: empty,
      consumed: empty,
      royalDelivered: empty,
      locations: [location('storage', 'warehouse-1', { ...empty, stone: 2 }, 4)]
    });
    const reserved = reservePeaceLiteStorage(initial, 'warehouse-1', 'stone', 2, 'outbound');
    const released = releasePeaceLiteStorageReservation(reserved, 'warehouse-1', 'stone', 2, 'outbound');

    expect(totalPeaceLiteItem(released, 'stone')).toBe(2);
    expect(released.locations[0]?.reservedOutbound.stone).toBe(0);
    expect(() => releasePeaceLiteStorageReservation(released, 'warehouse-1', 'stone', 1, 'outbound')).toThrow(/reservation/);
  });
});
