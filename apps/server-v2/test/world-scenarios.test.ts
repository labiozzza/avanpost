import { describe, expect, it } from 'vitest';
import { PeaceWorldSnapshotSchema } from '@avanpost/peace-v2-shared';
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
      'construction-blocked', 'logistics-deadlock', 'multi-worker', 'g4-multi-storage', 'late-settlement'
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
  });

  it('rejects unknown scenario names rather than silently falling back to a default', () => {
    expect(() => createWorldScenario('dev')).toThrow('Unknown isolated-world scenario: dev');
  });
});
