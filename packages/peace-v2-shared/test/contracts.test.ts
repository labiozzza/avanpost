import { describe, expect, it } from 'vitest';
import {
  CommandEnvelopeSchema,
  AssignWorkIntentSchema,
  BuildIntentSchema,
  GlobalCoordinateSchema,
  PairingRequestSchema,
  ProblemDetailsSchema,
  ReadOnlyWorldPreviewSchema,
  WorldRevisionSchema
} from '../src/index.js';

describe('Peace V2 shared contracts', () => {
  it('accepts signed safe-integer world coordinates and rejects fractions/unsafe values', () => {
    expect(GlobalCoordinateSchema.parse({ x: -12, y: 0 })).toEqual({ x: -12, y: 0 });
    expect(GlobalCoordinateSchema.safeParse({ x: 1.5, y: 0 }).success).toBe(false);
    expect(GlobalCoordinateSchema.safeParse({ x: Number.MAX_SAFE_INTEGER + 1, y: 0 }).success).toBe(false);
  });

  it('requires idempotency and both optimistic versions in every command envelope', () => {
    expect(
      CommandEnvelopeSchema.parse({
        requestId: 'request-0001',
        expectedWorldVersion: 4,
        expectedGeometryVersion: 2
      })
    ).toMatchObject({ requestId: 'request-0001', expectedWorldVersion: 4, expectedGeometryVersion: 2 });
    expect(
      CommandEnvelopeSchema.safeParse({ requestId: 'request-0001', expectedWorldVersion: 4 }).success
    ).toBe(false);
    expect(
      CommandEnvelopeSchema.safeParse({
        requestId: 'request-0001',
        expectedWorldVersion: 4,
        expectedGeometryVersion: 2,
        authoritativelySetBalance: 100
      }).success
    ).toBe(false);
  });

  it('keeps stable problem details and nonnegative revision counters', () => {
    expect(
      ProblemDetailsSchema.parse({
        type: 'https://avanpost.invalid/problems/stale-world',
        title: 'Conflict',
        status: 409,
        detail: 'Fetch a fresh snapshot.',
        code: 'STALE_WORLD',
        requestId: 'request-0001'
      }).code
    ).toBe('STALE_WORLD');
    expect(WorldRevisionSchema.safeParse({ worldVersion: 1, geometryVersion: 0, serverTick: 12 }).success).toBe(true);
    expect(WorldRevisionSchema.safeParse({ worldVersion: -1, geometryVersion: 0, serverTick: 12 }).success).toBe(false);
  });

  it('validates strict pairing and typed command intents without client-authored state', () => {
    expect(PairingRequestSchema.safeParse({ code: 'one-time-code' }).success).toBe(true);
    expect(PairingRequestSchema.safeParse({ code: 'one-time-code', worldId: 'forged-world' }).success).toBe(false);
    expect(
      BuildIntentSchema.safeParse({
        requestId: 'request-0002',
        expectedWorldVersion: 1,
        expectedGeometryVersion: 1,
        kind: 'build',
        buildingId: 'house',
        anchor: { x: -1, y: 4 }
      }).success
    ).toBe(true);
    expect(
      BuildIntentSchema.safeParse({
        requestId: 'request-0002',
        expectedWorldVersion: 1,
        expectedGeometryVersion: 1,
        kind: 'build',
        buildingId: 'house',
        anchor: { x: -1, y: 4 },
        balance: 999
      }).success
    ).toBe(false);
    expect(
      AssignWorkIntentSchema.safeParse({
        requestId: 'request-0003',
        expectedWorldVersion: 1,
        expectedGeometryVersion: 1,
        kind: 'assign-work',
        residentId: 'resident-a',
        workKind: 'gather',
        targetId: 'node-a'
      }).success
    ).toBe(true);
  });

  it('keeps unpaired world previews read-only and free of owner identifiers', () => {
    const preview = {
      revision: { worldVersion: 1, geometryVersion: 1, serverTick: 2 },
      cells: [{ coordinate: { x: -1, y: 0 }, fillType: 'solid', materialId: 'stone' }],
      buildings: [{ visualKey: 'visual-house-1', buildingId: 'house', anchor: { x: -2, y: -1 }, state: 'complete' }],
      resourceNodes: [{ visualKey: 'forest-1', name: 'Берёза', position: { x: 3, y: 0 },
        sourceKind: 'finite', remaining: 2, maxRemaining: 3, state: 'standing',
        regrowthProgressTicks: 0, regrowthEveryTicks: null }],
      actors: [{ visualKey: 'actor-1', position: { x: 0, y: -1 }, visualState: 'walking_to_source', cargo: 1 }],
      resourceTotals: [{ itemId: 'wood', quantity: 4 }]
    };
    expect(ReadOnlyWorldPreviewSchema.safeParse(preview).success).toBe(true);
    expect(ReadOnlyWorldPreviewSchema.safeParse({ ...preview, ownerId: 'private-owner' }).success).toBe(false);
    expect(
      ReadOnlyWorldPreviewSchema.safeParse({
        ...preview,
        actors: [{ ...preview.actors[0], residentId: 'private-resident' }]
      }).success
    ).toBe(false);
  });
});
