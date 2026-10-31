import { describe, expect, it } from 'vitest';
import { PeaceWorldSnapshotSchema } from '@avanpost/peace-v2-shared';
import { scheduleWorkOrders } from '@avanpost/peace-v2-sim';
import { validateBuildingLayout } from '@avanpost/peace-v2-sim';
import {
  createWorldScenario,
  listWorldScenarios,
  WORLD_SCENARIO_DESCRIPTIONS
} from '../src/testing/world-scenarios.js';

describe('isolated world scenario catalog', () => {
  it.each(listWorldScenarios())('creates repeatable, schema-valid %s worlds', (name) => {
    const first = createWorldScenario(name);
    const second = createWorldScenario(name);
    expect(PeaceWorldSnapshotSchema.safeParse(first).success).toBe(true);
    expect(second).toEqual(first);
    expect(first.residents.length).toBeGreaterThanOrEqual(2);
    expect(first.trees.length).toBeGreaterThan(0);
    expect(first.stoneDeposits.length).toBeGreaterThan(0);
    expect(WORLD_SCENARIO_DESCRIPTIONS[name].length).toBeGreaterThan(10);
  });

  it('contains every requested scenario with valid construction cross-links and reservations', () => {
    expect(listWorldScenarios()).toEqual([
      'empty', 'basic', 'resources-full', 'lumberjack', 'stone-mining', 'construction', 'construction-role-transition',
       'construction-blocked', 'logistics-deadlock', 'multi-worker', 'g4-multi-storage', 'g4-logistics-priority',
       'g5-construction-layout', 'g5-support-invalid', 'g5-route-blocked', 'g5-logistics-blocked',
       'g5-demolition-cleanup', 'late-settlement'
    ]);
    for (const name of listWorldScenarios()) {
      const world = createWorldScenario(name);
      for (const order of world.buildOrders) {
        const building = world.buildings.find((candidate) => candidate.id === order.buildingId);
        expect(building?.orderId).toBe(order.id);
        expect(building!.reservedWood).toBeGreaterThanOrEqual(0);
        expect(building!.reservedStone).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it('models role dispatch, blocked materials, logistics cargo, and a late settlement distinctly', () => {
    const construction = createWorldScenario('construction');
    expect(construction.residents.some((resident) => resident.workRole === 'builder')).toBe(true);
    expect(construction.buildOrders).toHaveLength(2);

    const blocked = createWorldScenario('construction-blocked');
    expect(blocked.buildOrders[0]).toMatchObject({ status: 'waiting_materials', blockedReason: 'INSUFFICIENT_WOOD' });

    const logistics = createWorldScenario('logistics-deadlock');
    expect(logistics.residents.some((resident) => resident.cargoItemId === 'wood' && resident.cargo > 0)).toBe(true);
    expect(logistics.residents.some((resident) => resident.cargoItemId === 'stone' && resident.cargo > 0)).toBe(true);

    const late = createWorldScenario('late-settlement');
    expect(late.buildings.filter((building) => building.kind === 'cabin')).toHaveLength(3);
    expect(late.buildings.filter((building) => building.kind === 'workshop')).toHaveLength(1);
    expect(late.buildOrders.every((order) => order.status === 'completed')).toBe(true);

    const distributed = createWorldScenario('g4-multi-storage');
    expect(distributed.storages).toHaveLength(2);
    expect(distributed.residents.map((resident) => resident.workRole).sort())
      .toEqual(['builder', 'hauler', 'stone_miner', 'woodcutter'].sort());
    expect(distributed.residents.find((resident) => resident.workRole === 'builder'))
      .toMatchObject({ cargo: 1, cargoItemId: 'wood', task: { kind: 'gather-wood', phase: 'waiting_storage' } });
    expect(distributed.storages?.map((storage) => storage.contents.wood)).toEqual([16, 0]);
    expect(distributed.stoneDeposits[0]?.bufferQuantity).toBe(6);
    expect(distributed.trees.find((tree) => tree.id === 'tree-3')).toMatchObject({ bufferQuantity: 3, bufferCapacity: 3 });
    expect(distributed.buildOrders).toHaveLength(1);
    expect(distributed.buildOrders[0]).toMatchObject({ status: 'waiting_materials', blockedReason: 'INSUFFICIENT_STONE' });

    const priorityLogistics = createWorldScenario('g4-logistics-priority');
    expect(priorityLogistics.residents.filter((resident) => resident.workRole === 'hauler')).toHaveLength(2);
    expect(priorityLogistics.logisticsPolicy.carryCapacity).toBe(3);
    const priorityOrders = [...priorityLogistics.buildOrders].sort((a, b) => a.queuePosition - b.queuePosition);
    expect(priorityOrders.map((order) => order.queuePosition)).toEqual([0, 1]);
    expect(priorityOrders.map((order) => order.status)).toEqual(['waiting_builder', 'waiting_materials']);

    expect(scheduleWorkOrders(priorityLogistics)).toBe(true);
    const assignedHaulers = priorityLogistics.residents.filter((resident) => resident.workRole === 'hauler');
    expect(assignedHaulers.every((resident) => resident.task?.kind === 'haul')).toBe(true);
    expect(new Set(assignedHaulers.map((resident) => resident.task?.kind === 'haul' ? resident.task.sourceId : '')).size).toBe(2);
    expect(priorityLogistics.logisticsTasks.filter((task) => task.assignedResidentId)).toHaveLength(2);
    expect(priorityLogistics.logisticsTasks.filter((task) => task.assignedResidentId).map((task) => task.kind).sort())
      .toEqual(['buffer_clearance', 'warehouse_restock'].sort());
    expect(PeaceWorldSnapshotSchema.safeParse(priorityLogistics).success).toBe(true);
  });

  it('rejects unknown scenario names rather than silently falling back to a default', () => {
    expect(() => createWorldScenario('dev')).toThrow('Unknown isolated-world scenario: dev');
  });

  it('seeds G5 geometry for both support and route rejection, with a real active haul path', () => {
    const world = createWorldScenario('g5-construction-layout');
    expect(world.surfaceCells).toHaveLength(68);
    expect(world.surfaceCells.filter((cell) => cell.visualFeature === 'narrow-passage')).toHaveLength(9);
    expect(world.surfaceCells.filter((cell) => cell.visualFeature === 'unstable-ground')).toHaveLength(2);
    expect(world.buildings.map((building) => building.state)).toEqual(['complete', 'complete']);
    expect(world.nextBuildOrderSequence).toBe(3);
    expect(world.storages).toHaveLength(2);
    expect(world.residents[1]?.task).toMatchObject({ kind: 'haul', phase: 'carrying', destinationId: 'storehouse-2' });
    expect(world.residents[1]?.task?.path.length).toBeGreaterThan(20);
    expect(world.residents[1]?.task?.path.some((cell) => cell.x >= 12 && cell.x <= 20 && cell.y === 0)).toBe(true);
    const demolitionWorld = createWorldScenario('g5-demolition-cleanup');
    expect(demolitionWorld.residents[1]).toMatchObject({ cargo: 0, workRole: 'none', task: null });
    expect(demolitionWorld.storages?.[1]?.reservedInbound.wood).toBe(0);
    const blockedDelivery = createWorldScenario('g5-logistics-blocked');
    expect(blockedDelivery.buildOrders.at(-1)).toMatchObject({ status: 'waiting_materials', blockedReason: 'NO_PATH_TO_STORAGE' });
    expect(blockedDelivery.buildings.at(-1)).toMatchObject({ anchor: { x: 12, y: -1 }, reservedWood: 1 });
    const validSite = validateBuildingLayout(world, 'cabin', { x: -22, y: -1 });
    expect(validSite.valid, JSON.stringify(validSite)).toBe(true);
    const supportBlocked = validateBuildingLayout(createWorldScenario('g5-support-invalid'), 'cabin', { x: 0, y: -1 });
    expect(supportBlocked.reason).toBe('NO_SUPPORT');
    expect(supportBlocked.reasons).not.toContain('OCCUPIED');
    expect(validateBuildingLayout(world, 'cabin', { x: -2, y: -1 }).valid).toBe(true);

    const routeWorld = createWorldScenario('g5-route-blocked');
    const cargoBefore = routeWorld.residents[1]!.cargo;
    const routeBlock = validateBuildingLayout(routeWorld, 'cabin', { x: 12, y: -1 });
    expect(routeBlock.reason).toBe('ROUTE_BLOCKED');
    expect(routeBlock.reasons).not.toContain('OCCUPIED');
    expect(routeBlock.blockedRoute).toBeDefined();
    expect(routeWorld.residents[1]!.cargo).toBe(cargoBefore);
    expect(validateBuildingLayout(routeWorld, 'cabin', { x: -2, y: -1 }).valid).toBe(true);
  });
});
