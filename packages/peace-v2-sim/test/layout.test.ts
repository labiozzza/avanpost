import { describe, expect, it } from 'vitest';
import { PeaceWorldSnapshotSchema, type PeaceResident, type PeaceWorldSnapshot } from '@avanpost/peace-v2-shared';
import {
  disconnectedPreparedTerritory,
  expansionBatchConnectsToHome,
  findSurfacePath,
  footprintCells,
  validateBuildingLayout
} from '../src/layout.js';
import { ensureTerritoryWorld } from '../src/territory.js';

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

function expansionWorld(): PeaceWorldSnapshot {
  const snapshot = ensureTerritoryWorld(world());
  return PeaceWorldSnapshotSchema.parse(snapshot);
}

describe('home-rooted territory connectivity', () => {
  it('hydrates pre-G6.1 saves with schema defaults without moving existing world entities', () => {
    const saved = world({ surfaceCells: [] });
    const { worldSeed: _worldSeed, territoryGeneratorVersion: _generatorVersion,
      sectors: _sectors, clearingJobs: _clearingJobs, nextClearingSequence: _nextClearingSequence,
      ...legacyState } = saved;
    const legacy = PeaceWorldSnapshotSchema.parse(legacyState);
    const hydrated = ensureTerritoryWorld(legacy);
    expect(hydrated.worldSeed).toBe('peace-home');
    expect(hydrated.clearingJobs).toEqual([]);
    expect(hydrated.nextClearingSequence).toBe(1);
    expect(hydrated.surfaceCells).toEqual(saved.surfaceCells);
    expect(hydrated.residents.map(({ id, position }) => ({ id, position })))
      .toEqual(saved.residents.map(({ id, position }) => ({ id, position })));
    expect(hydrated.buildings).toEqual(saved.buildings);
    expect(hydrated.resources).toEqual(saved.resources);
  });

  it('accepts one frontier cell and a five-cell side-connected chain', () => {
    const snapshot = expansionWorld();
    expect(expansionBatchConnectsToHome(snapshot, [{ x: 25, y: 0 }])).toBe(true);
    expect(expansionBatchConnectsToHome(snapshot, [25, 26, 27, 28, 29].map((x) => ({ x, y: 0 })))).toBe(true);
  });

  it('accepts an arbitrary connected shape on a multi-row surface', () => {
    const snapshot = expansionWorld();
    expect(expansionBatchConnectsToHome(snapshot, [
      { x: 25, y: 0 }, { x: 26, y: 0 }, { x: 26, y: 1 }, { x: 27, y: 1 }, { x: 27, y: 2 }
    ])).toBe(true);
  });

  it('rejects a cell beyond two unprepared cells, a remote group and separated groups', () => {
    const snapshot = expansionWorld();
    expect(expansionBatchConnectsToHome(snapshot, [{ x: 27, y: 0 }])).toBe(false);
    expect(expansionBatchConnectsToHome(snapshot, [27, 28, 29, 30].map((x) => ({ x, y: 0 })))).toBe(false);
    expect(expansionBatchConnectsToHome(snapshot, [25, 26, 28, 29].map((x) => ({ x, y: 0 })))).toBe(false);
  });

  it('rejects diagonal-only contact and prevents removing a bridge cell from a batch', () => {
    const snapshot = expansionWorld();
    expect(expansionBatchConnectsToHome(snapshot, [{ x: 25, y: 1 }])).toBe(false);
    const selected = [{ x: 25, y: 0 }, { x: 26, y: 0 }, { x: 27, y: 0 }];
    expect(expansionBatchConnectsToHome(snapshot, selected)).toBe(true);
    expect(expansionBatchConnectsToHome(snapshot, selected.filter((cell) => cell.x !== 26))).toBe(false);
  });

  it('does not treat a disconnected prepared legacy island as an expansion root', () => {
    const snapshot = expansionWorld();
    const rightSector = snapshot.sectors.find((sector) => sector.id === 'sector-1-0')!;
    rightSector.ownerId = 'peace-home';
    rightSector.state = 'unlocked';
    snapshot.surfaceCells.push(...[27, 28, 29, 30].map((x) => ({
      position: { x, y: 0 }, supportsBuilding: true, walkable: true,
      sectorId: rightSector.id, prepared: true, terrainType: 'meadow' as const
    })));
    expect(disconnectedPreparedTerritory(snapshot)).toContainEqual({ x: 27, y: 0 });
    expect(expansionBatchConnectsToHome(snapshot, [31, 32].map((x) => ({ x, y: 0 })))).toBe(false);
  });
});

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

  it('allows an ordinary building footprint beside a route without treating its facade as a wall', () => {
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
    expect(result).toMatchObject({ valid: true, reason: 'READY' });
    expect(result.reasons).not.toContain('ROUTE_BLOCKED');
    expect(findSurfacePath(state, { x: 14, y: 0 }, { x: 8, y: 0 })).not.toBeNull();
  });

  it('keeps an active resident task route traversable in front of ordinary buildings', () => {
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
    expect(result).toMatchObject({ valid: true, reason: 'READY' });
    expect(findSurfacePath(state, activeWorker.position, { x: 8, y: 0 })).not.toBeNull();
  });

  it('lets residents and loaded haulers pass in front of warehouses and multiple consecutive buildings', () => {
    const buildings = [-2, 0, 2].map((x, index) => ({
      id: `house-${index}`, kind: 'cabin' as const, orderId: `order-${index}`, anchor: { x, y: -1 },
      footprint: { width: 2, height: 1 }, layoutVersion: 1, accessibility: 'accessible' as const,
      accessibilityReason: null, state: 'complete' as const, progressTicks: 8, progressRequired: 8,
      reservedWood: 0, reservedStone: 0, inTransitWood: 0, inTransitStone: 0,
      reservedReturnWood: 0, reservedReturnStone: 0
    }));
    const orders = buildings.map((building, index) => ({
      id: `order-${index}`, buildingId: building.id, queuePosition: index, status: 'completed' as const,
      assignedResidentId: null, blockedReason: null
    }));
    const state = world({ buildings, buildOrders: orders });
    const residentPath = findSurfacePath(state, { x: -5, y: 0 }, { x: 5, y: 0 });
    const loadedHaulerPath = findSurfacePath(state, { x: 5, y: 0 }, { x: -5, y: 0 });
    expect(residentPath?.map((point) => point.x)).toEqual([-4, -3, -2, -1, 0, 1, 2, 3, 4, 5]);
    expect(loadedHaulerPath).toHaveLength(10);
    expect(findSurfacePath(state, { x: 9, y: 0 }, { x: 12, y: 0 })).toHaveLength(3);
  });

  it('keeps real non-walkable terrain impassable even though ordinary buildings are passable', () => {
    const state = world({ surfaceCells: surfaceCells([
      { x: -5, y: 0, walkable: false }, { x: 0, y: 0, walkable: false }
    ]) });
    expect(findSurfacePath(state, { x: -2, y: 0 }, { x: 2, y: 0 })).toBeNull();
    expect(validateBuildingLayout(state, 'cabin', { x: -1, y: -1 }).valid).toBe(false);
    expect(validateBuildingLayout(state, 'cabin', { x: -1, y: -1 }).reasons).toContain('NO_PATH');
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
