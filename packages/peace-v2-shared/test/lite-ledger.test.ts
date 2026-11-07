import { describe, expect, it } from 'vitest';
import {
  PeaceLiteItemIdSchema,
  PeaceLitePhysicalLedgerSchema,
  totalPeaceLiteItem,
  type PeaceLiteItemQuantities
} from '../src/index.js';

const empty: PeaceLiteItemQuantities = {
  wood: 0, stone: 0, vegetables: 0, meat: 0, metal: 0, cloth: 0, reagents: 0
};

describe('Peace Lite physical ledger contract', () => {
  it('defines exactly the seven physical item IDs', () => {
    expect(PeaceLiteItemIdSchema.options).toEqual([
      'wood', 'stone', 'vegetables', 'meat', 'metal', 'cloth', 'reagents'
    ]);
    expect(PeaceLiteItemIdSchema.safeParse('ore').success).toBe(false);
  });

  it('conserves each item across physical locations after production and consumption', () => {
    const ledger = PeaceLitePhysicalLedgerSchema.parse({
      version: 1,
      initial: { ...empty, wood: 2 },
      produced: { ...empty, wood: 3, vegetables: 4 },
      consumed: { ...empty, wood: 1, vegetables: 1 },
      royalDelivered: { ...empty, vegetables: 1 },
      locations: [
        { locationKind: 'storage', locationId: 'warehouse-1', quantities: { ...empty, wood: 3, vegetables: 1 } },
        { locationKind: 'cargo', locationId: 'worker-1', quantities: { ...empty, wood: 1, vegetables: 1 } }
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
      locations: [{ locationKind: 'storage', locationId: 'warehouse-1', quantities: { ...empty, wood: 1 } }]
    };
    expect(PeaceLitePhysicalLedgerSchema.safeParse({
      ...valid,
      locations: [{ locationKind: 'storage', locationId: 'warehouse-1', quantities: empty }]
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
});
