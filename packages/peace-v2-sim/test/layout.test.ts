import { describe, expect, it } from 'vitest';
import { PeaceWorldSnapshotSchema, type PeaceResident, type PeaceWorldSnapshot } from '@avanpost/peace-v2-shared';
import { findSurfacePath, footprintCells, validateBuildingLayout } from '../src/layout.js';

function resident(id: string, x: number, workRole: PeaceResident['workRole'] = 'builder'): PeaceResident {
  return {
    id, name: id, appearanceKey: id, position: { x, y: 0 }, facing: 'right', state: 'idle', workRole,
    visualState: 'idle', cargo: 0, cargoItemId: null, blockedReason: null, task: null,
    preferredStorageId: null, preferredHaulSourceId: null
  };
}

function surfaceCells(overrides: Array<{ x: number; y: number; supportsBuilding?: boolean; walkable?: boolean }> = []) {
  const cells = new Map<string, { position: { x: number; y: number }; supportsBuilding: boolean; walkable: boolean }>();
  for (let x = -24; x <= 24; x += 1) cells.set(`${x},0`, {
    position: { x, y: 0 }, supportsBuilding: true, walkable: true
  });
  for (const cell of overrides) cells.set(`${cell.x},${cell.y}`, {
    position: { x: cell.x, y: cell.y },
    supportsBuilding: cell.supportsBuilding ?? true,
    walkable: cell.walkable ?? true
  });
  return [...cells.values()];
}

function world(overrides: Partial<PeaceWorldSnapshot> = {}): PeaceWorldSnapshot {
  const primary = {
    id: 'storehouse-1', name: 'Склад', kind: 'warehouse' as const,
    anchor: { x: 10, y: -1 }, footprint: { width: 2, height: 1 }, capacity: 20,
    contents: { wood: 0, stone: 0 }, reservedInbound: { wood: 0, stone: 0 },
    reservedOutbound: { wood: 0, stone: 0 }, status: 'available' as const, blockedReason: null
  };
  return PeaceWorldSnapshotSchema.parse({
    revision: { worldVersion: 1, geometryVersion: 1, serverTick: 0 },
    resources: { wood: 3, stone: 0 },
    storage: { id: primary.id, anchor: primary.anchor, footprint: primary.footprint, capacity: primary.capacity },
    storages: [primary],
    trees: [{ id: 'tree-1', name: 'tree-1', position: { x: 6, y: 0 }, sourceKind: 'finite', remaining: 3,
      maxRemaining: 3, state: 'standing', regrowthProgressTicks: 0, regrowthEveryTicks: 50,
      bufferQuantity: 0, bufferCapacity: 3, reservedBuffer: 0 }],
    stoneDeposits: [{ id: 'stone-1', name: 'Жила', sourceKind: 'finite', position: { x: 8, y: 0 }, remaining: 30,
      maxRemaining: 30, bufferQuantity: 0, bufferCapacity: 3, reservedBuffer: 0, yieldPerTick: 1, state: 'available' }],
    residents: [resident('worker-1', -10), resident('worker-2', 14, 'none')],
    buildOrders: [],
    nextBuildOrderSequence: 1,
    buildings: [],
    surfaceCells: surfaceCells(),
    ...overrides
  });
}

describe('authoritative building layout geometry', () => {
  it('enumerates the existing footprint as exact world cells', () => {
    expect(footprintCells({ x: -2, y: -1 }, { width: 2, height: 1 })).toEqual([
      { x: -2, y: -1 }, { x: -1, y: -1 }
    ]);
  });

  it('accepts a supported site and returns a reachable entrance and work point', () => {
    const state = world({ residents: [resident('worker-1', 13), resident('worker-2', -10, 'none')] });
    const result = validateBuildingLayout(state, 'cabin', { x: 20, y: -1 });
    expect(result).toMatchObject({ valid: true, reason: 'READY', entrance: { x: 19, y: 0 }, workPoint: { x: 19, y: 0 } });
    expect(result.footprintCells).toEqual([{ x: 20, y: -1 }, { x: 21, y: -1 }]);
    expect(result.route?.at(-1)).toEqual({ x: 19, y: 0 });
  });

  it('rejects overlap with an occupied building cell', () => {
    const state = world({
      buildOrders: [{ id: 'order-existing', buildingId: 'house-existing', queuePosition: 0, status: 'completed', assignedResidentId: null, blockedReason: null }],
      buildings: [{ id: 'house-existing', kind: 'cabin', orderId: 'order-existing',
        anchor: { x: 0, y: -1 }, footprint: { width: 2, height: 1 }, layoutVersion: 1,
        accessibility: 'accessible', accessibilityReason: null, state: 'complete', progressTicks: 8,
        progressRequired: 8, reservedWood: 0, reservedStone: 0, inTransitWood: 0, inTransitStone: 0,
        reservedReturnWood: 0, reservedReturnStone: 0 }]
    });
    const result = validateBuildingLayout(state, 'workshop', { x: 1, y: -1 });
    expect(result).toMatchObject({ valid: false, reason: 'OCCUPIED' });
    expect(result.reasons).toContain('OCCUPIED');
  });

  it('rejects a missing support cell independently of free-space and route checks', () => {
    const state = world({ surfaceCells: surfaceCells([{ x: 1, y: 0, supportsBuilding: false }]) });
    const result = validateBuildingLayout(state, 'cabin', { x: 0, y: -1 });
    expect(result.valid).toBe(false);
    expect(result.reasons).toContain('NO_SUPPORT');
  });

  it('rejects a new building that disconnects an existing warehouse route', () => {
    const state = world({
      storage: { id: 'storehouse-1', anchor: { x: 6, y: -1 }, footprint: { width: 2, height: 1 }, capacity: 20 },
      storages: [{ id: 'storehouse-1', name: 'Склад', kind: 'warehouse', anchor: { x: 6, y: -1 },
        footprint: { width: 2, height: 1 }, capacity: 20, contents: { wood: 0, stone: 0 },
        reservedInbound: { wood: 0, stone: 0 }, reservedOutbound: { wood: 0, stone: 0 }, status: 'available', blockedReason: null }],
      residents: [resident('worker-1', 14), resident('worker-2', 15, 'none')],
      trees: [{ id: 'tree-1', name: 'tree-1', position: { x: 20, y: 0 }, sourceKind: 'finite', remaining: 3,
        maxRemaining: 3, state: 'standing', regrowthProgressTicks: 0, regrowthEveryTicks: 50,
        bufferQuantity: 0, bufferCapacity: 3, reservedBuffer: 0 }],
      stoneDeposits: [{ id: 'stone-1', name: 'Жила', sourceKind: 'finite', position: { x: 22, y: 0 }, remaining: 30,
        maxRemaining: 30, bufferQuantity: 0, bufferCapacity: 3, reservedBuffer: 0, yieldPerTick: 1, state: 'available' }]
    });
    const result = validateBuildingLayout(state, 'cabin', { x: 10, y: -1 });
    expect(result.reasons, JSON.stringify(result)).toContain('ROUTE_BLOCKED');
    expect(result.blockedRoute).toMatchObject({ from: { x: 14, y: 0 }, to: { x: 8, y: 0 } });
  });

  it('protects an active resident task route even when another worker can still reach the destination', () => {
    const activeWorker: PeaceResident = {
      ...resident('worker-1', 14),
      cargo: 1,
      cargoItemId: 'wood',
      task: {
        id: 'carry-wood', kind: 'gather-wood', phase: 'carrying_to_storage', sourceId: 'tree-1',
        destinationId: 'storehouse-1', path: [], pathIndex: 0, progressTicks: 0, requiredTicks: 1,
        blockedReason: null, continuous: false, cancelAfterDelivery: true, assignmentSource: 'manual'
      }
    };
    const state = world({
      storage: { id: 'storehouse-1', anchor: { x: 6, y: -1 }, footprint: { width: 2, height: 1 }, capacity: 20 },
      storages: [{ id: 'storehouse-1', name: 'Склад', kind: 'warehouse', anchor: { x: 6, y: -1 },
        footprint: { width: 2, height: 1 }, capacity: 20, contents: { wood: 0, stone: 0 },
        reservedInbound: { wood: 0, stone: 0 }, reservedOutbound: { wood: 0, stone: 0 }, status: 'available', blockedReason: null }],
      residents: [activeWorker, resident('worker-2', -10, 'none')]
    });
    const result = validateBuildingLayout(state, 'cabin', { x: 10, y: -1 });
    expect(result.reasons).toContain('ROUTE_BLOCKED');
    expect(result.blockedRoute).toMatchObject({ from: { x: 14, y: 0 }, to: { x: 8, y: 0 } });
  });

  it('uses a supported alternate corridor instead of treating the sprite as an obstacle', () => {
    const cells = surfaceCells([
      { x: -1, y: 1 }, { x: 0, y: 1 }, { x: 1, y: 1 }, { x: 2, y: 1 }
    ]);
    const state = world({ surfaceCells: cells });
    const path = findSurfacePath(state, { x: -2, y: 0 }, { x: 3, y: 0 }, { extraBlocked: [{ x: 0, y: 0 }, { x: 1, y: 0 }] });
    expect(path).not.toBeNull();
    expect(path?.some((point) => point.y === 1)).toBe(true);
  });

  it('reports an inaccessible entrance separately from unsupported ground', () => {
    const cells = surfaceCells([
      { x: -1, y: 0, walkable: false }, { x: 2, y: 0, walkable: false }
    ]);
    const result = validateBuildingLayout(world({ surfaceCells: cells }), 'cabin', { x: 0, y: -1 });
    expect(result.reasons).toContain('NO_ENTRANCE');
    expect(result.reasons).not.toContain('NO_SUPPORT');
  });
});
