import { loadV2Env, loadV2Config } from '../config.js';
import { connectVerifiedV2Database } from '../database/connect.js';
import { replaceWorldOccupiedCells } from '../database/occupancy.js';
import { createWorldScenario } from '../testing/world-scenarios.js';
import { V2DatabaseError } from '../database/identity.js';
import { COPPICE_REGROWTH_TICKS, G33_STONE_BALANCE, WOOD_REGROWTH_TICKS, WOOD_UNLOADING_TICKS } from '@avanpost/peace-v2-sim';
import { ensurePhysicalStorageSnapshot, PEACE_WORLD_SCHEMA_VERSION, PeaceWorldSnapshotSchema } from '@avanpost/peace-v2-shared';

loadV2Env();

const G33_STONE_NODE = {
  id: G33_STONE_BALANCE.stoneNode.id,
  name: 'Каменная жила',
  sourceKind: 'finite',
  position: { x: G33_STONE_BALANCE.stoneNode.dx, y: G33_STONE_BALANCE.stoneNode.dy },
  remaining: G33_STONE_BALANCE.stoneNode.initialAmount,
  maxRemaining: G33_STONE_BALANCE.stoneNode.initialAmount,
  bufferQuantity: 0,
  bufferCapacity: G33_STONE_BALANCE.stoneNode.bufferCapacity,
  yieldPerTick: G33_STONE_BALANCE.stoneNode.yieldPerTick,
  state: 'available'
};

const STARTING_STATE = {
  resources: { wood: 1, stone: 0 },
  storage: { id: 'storehouse-1', anchor: { x: -6, y: -1 }, footprint: { width: 2, height: 1 }, capacity: 100 },
  trees: [
    {
      id: 'tree-1', name: 'Старая берёза', sourceKind: 'finite', position: { x: 3, y: 0 },
      remaining: 3, maxRemaining: 3, state: 'standing', regrowthProgressTicks: 0, regrowthEveryTicks: WOOD_REGROWTH_TICKS
    },
    {
      id: 'tree-2', name: 'Восточная роща', sourceKind: 'finite', position: { x: 8, y: 0 },
      remaining: 3, maxRemaining: 3, state: 'standing', regrowthProgressTicks: 0, regrowthEveryTicks: WOOD_REGROWTH_TICKS
    },
    {
      id: 'tree-3', name: 'Западный склон', sourceKind: 'finite', position: { x: -12, y: 0 },
      remaining: 3, maxRemaining: 3, state: 'standing', regrowthProgressTicks: 0, regrowthEveryTicks: WOOD_REGROWTH_TICKS
    },
    {
      id: 'coppice-1', name: 'Возобновляемая поросль', sourceKind: 'renewable_plot', position: { x: 16, y: 0 },
      remaining: 1, maxRemaining: 1, state: 'standing', regrowthProgressTicks: 0, regrowthEveryTicks: COPPICE_REGROWTH_TICKS
    }
  ],
  residents: [
    {
      id: 'worker-1', name: 'Илья', appearanceKey: 'ilya', position: { x: -3, y: 0 }, facing: 'right',
      state: 'idle', workRole: 'none', visualState: 'idle', cargo: 0, cargoItemId: null, blockedReason: null, task: null
    },
    {
      id: 'worker-2', name: 'Марья', appearanceKey: 'maria', position: { x: 14, y: 0 }, facing: 'left',
      state: 'idle', workRole: 'none', visualState: 'idle', cargo: 0, cargoItemId: null, blockedReason: null, task: null
    }
  ],
  buildOrders: [],
  nextBuildOrderSequence: 1,
  stoneDeposits: [G33_STONE_NODE],
  buildings: []
};

const BUILDER_CARRY_PRIORITY_STATE = {
  resources: { wood: 100, stone: 0 },
  storage: { id: 'storehouse-1', anchor: { x: -6, y: -1 }, footprint: { width: 2, height: 1 }, capacity: 100 },
  trees: [
    {
      id: 'tree-1', name: 'Старая берёза', sourceKind: 'finite', position: { x: 3, y: 0 },
      remaining: 3, maxRemaining: 3, state: 'standing', regrowthProgressTicks: 0, regrowthEveryTicks: WOOD_REGROWTH_TICKS
    },
    {
      id: 'tree-2', name: 'Восточная роща', sourceKind: 'finite', position: { x: 8, y: 0 },
      remaining: 3, maxRemaining: 3, state: 'standing', regrowthProgressTicks: 0, regrowthEveryTicks: WOOD_REGROWTH_TICKS
    },
    {
      id: 'tree-3', name: 'Западный склон', sourceKind: 'finite', position: { x: -12, y: 0 },
      remaining: 3, maxRemaining: 3, state: 'standing', regrowthProgressTicks: 0, regrowthEveryTicks: WOOD_REGROWTH_TICKS
    },
    {
      id: 'coppice-1', name: 'Возобновляемая поросль', sourceKind: 'renewable_plot', position: { x: 16, y: 0 },
      remaining: 1, maxRemaining: 1, state: 'standing', regrowthProgressTicks: 0, regrowthEveryTicks: COPPICE_REGROWTH_TICKS
    }
  ],
  residents: [
    {
      id: 'worker-1', name: 'Илья', appearanceKey: 'ilya', position: { x: -4, y: 0 }, facing: 'right',
      state: 'waiting', workRole: 'woodcutter', visualState: 'waiting_storage', cargo: 1, blockedReason: 'STORAGE_FULL',
      cargoItemId: 'wood',
      task: {
        id: 'fixture-woodcutter-cargo', kind: 'gather-wood', phase: 'waiting_storage', sourceId: 'tree-1',
        destinationId: 'storehouse-1', path: [], pathIndex: 0, progressTicks: 0, requiredTicks: 2,
        blockedReason: 'STORAGE_FULL', continuous: true, cancelAfterDelivery: false, assignmentSource: 'profession'
      }
    },
    {
      id: 'worker-2', name: 'Марья', appearanceKey: 'maria', position: { x: 14, y: 0 }, facing: 'left',
      state: 'waiting', workRole: 'none', visualState: 'waiting_storage', cargo: 1, blockedReason: 'STORAGE_FULL',
      cargoItemId: 'wood',
      task: {
        id: 'fixture-builder-cargo', kind: 'gather-wood', phase: 'waiting_storage', sourceId: 'tree-2',
        destinationId: 'storehouse-1', path: [], pathIndex: 0, progressTicks: 0, requiredTicks: 2,
        blockedReason: 'STORAGE_FULL', continuous: true, cancelAfterDelivery: false, assignmentSource: 'manual'
      }
    }
  ],
  buildOrders: [],
  nextBuildOrderSequence: 1,
  stoneDeposits: [G33_STONE_NODE],
  buildings: []
};

const G33_STONE_WORKSHOP_STATE = {
  ...STARTING_STATE,
  resources: { wood: 12, stone: 0 }
};

const G33_FULL_STORE_WORKSHOP_STATE = {
  ...STARTING_STATE,
  resources: { wood: 100, stone: 0 },
  stoneDeposits: [{ ...G33_STONE_NODE, remaining: 582 }],
  residents: [
    {
      id: 'worker-1', name: 'Илья', appearanceKey: 'ilya', position: { x: -13, y: 0 }, facing: 'right',
      state: 'waiting', workRole: 'stone_miner', visualState: 'waiting_stone_storage', cargo: 18,
      cargoItemId: 'stone', blockedReason: 'STORAGE_FULL',
      task: {
        id: 'fixture-full-store-stone', kind: 'gather-stone', phase: 'waiting_storage',
        sourceId: G33_STONE_NODE.id, destinationId: 'storehouse-1', path: [], pathIndex: 0,
        progressTicks: 0, requiredTicks: WOOD_UNLOADING_TICKS, blockedReason: 'STORAGE_FULL',
        continuous: true, cancelAfterDelivery: false, assignmentSource: 'workRole'
      }
    },
    {
      id: 'worker-2', name: 'Марья', appearanceKey: 'maria', position: { x: 14, y: 0 }, facing: 'left',
      state: 'waiting', workRole: 'builder', visualState: 'waiting_storage', cargo: 1,
      cargoItemId: 'wood', blockedReason: 'STORAGE_FULL',
      task: {
        id: 'fixture-full-store-wood', kind: 'gather-wood', phase: 'waiting_storage', sourceId: 'tree-2',
        destinationId: 'storehouse-1', path: [], pathIndex: 0, progressTicks: 0,
        requiredTicks: WOOD_UNLOADING_TICKS, blockedReason: 'STORAGE_FULL',
        continuous: false, cancelAfterDelivery: true, assignmentSource: 'profession'
      }
    }
  ]
};

const G34_SOURCE_ASSIGNMENT_STATE = {
  ...STARTING_STATE,
  resources: { wood: 40, stone: 0 },
  residents: STARTING_STATE.residents.map((resident) => resident.id === 'worker-2'
    ? { ...resident, position: { x: 0, y: 0 } }
    : resident)
};

const G34_LEGACY_ORDER_STATE = {
  ...G34_SOURCE_ASSIGNMENT_STATE,
  residents: STARTING_STATE.residents.map((resident) => resident.id === 'worker-2'
    ? { ...resident, workRole: 'builder' as const }
    : resident),
  buildings: [{
    id: 'legacy-cabin-1', kind: 'cabin', orderId: 'legacy-cabin-order-1',
    anchor: { x: 12, y: -1 }, footprint: { width: 2, height: 1 }, state: 'planned',
    progressTicks: 0, progressRequired: 10, reservedWood: 0, reservedStone: 0
  }],
  buildOrders: [{
    id: 'legacy-cabin-order-1', buildingId: 'legacy-cabin-1', queuePosition: 1,
    status: 'waiting_builder', assignedResidentId: null, blockedReason: null
  }],
  nextBuildOrderSequence: 2
};

const G34_FULL_STORE_STONE_CARGO_STATE = {
  ...G34_SOURCE_ASSIGNMENT_STATE,
  resources: { wood: 77, stone: 23 },
  residents: [
    {
      id: 'worker-1', name: 'Илья', appearanceKey: 'ilya', position: { x: -4, y: 0 }, facing: 'right',
      state: 'waiting', workRole: 'none', visualState: 'waiting_stone_storage', cargo: 1,
      cargoItemId: 'stone', blockedReason: 'STORAGE_FULL',
      task: {
        id: 'g34-builder-stone-cargo', kind: 'gather-stone', phase: 'waiting_storage',
        sourceId: G33_STONE_NODE.id, destinationId: 'storehouse-1', path: [], pathIndex: 0,
        progressTicks: 0, requiredTicks: WOOD_UNLOADING_TICKS, blockedReason: 'STORAGE_FULL',
        continuous: false, cancelAfterDelivery: true, assignmentSource: 'workRole'
      }
    },
    {
      id: 'worker-2', name: 'Марья', appearanceKey: 'maria', position: { x: 14, y: 0 }, facing: 'left',
      state: 'idle', workRole: 'none', visualState: 'idle', cargo: 0,
      cargoItemId: null, blockedReason: null, task: null
    }
  ]
};

const G34_RESERVED_STONE_STATE = {
  ...G34_SOURCE_ASSIGNMENT_STATE,
  resources: { wood: 53, stone: 0 },
  residents: [
    {
      id: 'worker-1', name: 'Илья', appearanceKey: 'ilya', position: { x: 0, y: 0 }, facing: 'right',
      state: 'working', workRole: 'builder', visualState: 'building', cargo: 0,
      cargoItemId: null, blockedReason: null,
      task: {
        id: 'g34-existing-workshop-task', kind: 'build-workshop', phase: 'building',
        buildingId: 'workshop-reserved-1', orderId: 'workshop-reserved-order-1',
        path: [], pathIndex: 0, progressTicks: 0, requiredTicks: 1000, blockedReason: null
      }
    },
    {
      id: 'worker-2', name: 'Марья', appearanceKey: 'maria', position: { x: 14, y: 0 }, facing: 'left',
      state: 'idle', workRole: 'builder', visualState: 'idle', cargo: 0,
      cargoItemId: null, blockedReason: null, task: null
    }
  ],
  buildings: [
    {
      id: 'workshop-reserved-1', kind: 'workshop', orderId: 'workshop-reserved-order-1',
      anchor: { x: -2, y: -1 }, footprint: { width: 2, height: 1 }, state: 'in_progress',
      progressTicks: 0, progressRequired: 1000, reservedWood: 12, reservedStone: 6
    },
    {
      id: 'workshop-waiting-2', kind: 'workshop', orderId: 'workshop-waiting-order-2',
      anchor: { x: 10, y: -1 }, footprint: { width: 2, height: 1 }, state: 'waiting_materials',
      progressTicks: 0, progressRequired: 10, reservedWood: 0, reservedStone: 0
    }
  ],
  buildOrders: [
    {
      id: 'workshop-reserved-order-1', buildingId: 'workshop-reserved-1', queuePosition: 1,
      status: 'in_progress', assignedResidentId: 'worker-1', requiresExplicitBuilder: false, blockedReason: null
    },
    {
      id: 'workshop-waiting-order-2', buildingId: 'workshop-waiting-2', queuePosition: 2,
      status: 'waiting_materials', assignedResidentId: null, requiresExplicitBuilder: true,
      blockedReason: 'INSUFFICIENT_STONE'
    }
  ],
  nextBuildOrderSequence: 3
};

const G35_UPROOTED_TARGET_STATE = {
  ...G34_SOURCE_ASSIGNMENT_STATE,
  trees: G34_SOURCE_ASSIGNMENT_STATE.trees.map((tree) => ({
    ...tree, remaining: 0, state: 'uprooted' as const, regrowthProgressTicks: 0
  }))
};

try {
  if (process.env.AVANPOST_V2_DATABASE_OPERATION !== 'test') {
    throw new Error('V2_TEST_RESET_BLOCKED: test-only operation flag is required.');
  }
  const scenario = process.argv[2] ?? 'starter';
  const scenarioState = scenario.startsWith('g5-') ? createWorldScenario(scenario)
    : scenario === 'starter' ? STARTING_STATE
    : scenario === 'builder-carry-priority' ? BUILDER_CARRY_PRIORITY_STATE
      : scenario === 'g33-stone-workshop' ? G33_STONE_WORKSHOP_STATE
        : scenario === 'g33-full-store-workshop' ? G33_FULL_STORE_WORKSHOP_STATE
          : scenario === 'g34-source-assignment' ? G34_SOURCE_ASSIGNMENT_STATE
            : scenario === 'g34-legacy-order' ? G34_LEGACY_ORDER_STATE
                : scenario === 'g34-full-store-stone-cargo' ? G34_FULL_STORE_STONE_CARGO_STATE
                  : scenario === 'g34-reserved-stone' ? G34_RESERVED_STONE_STATE
                    : scenario === 'g35-uprooted-target' ? G35_UPROOTED_TARGET_STATE : undefined;
  if (!scenarioState) throw new Error('V2_TEST_RESET_BLOCKED: unknown test-world scenario.');
  const state = ensurePhysicalStorageSnapshot(PeaceWorldSnapshotSchema.parse({
    ...scenarioState,
    revision: { worldVersion: 1, geometryVersion: 1, serverTick: 0 }
  }));
  const config = loadV2Config();
  const client = await connectVerifiedV2Database(config, 'test');
  try {
    await client.query('BEGIN');
    const result = await client.query(
      `UPDATE peace_v2_world_state
       SET world_version = 1, geometry_version = 1, server_tick = 0, state = $1::jsonb,
        last_simulated_at = now(), state_schema_version = $2, updated_at = now()
       WHERE world_id = 'peace-home'`, [JSON.stringify(state), PEACE_WORLD_SCHEMA_VERSION]
    );
    if (result.rowCount !== 1) throw new Error('V2_TEST_RESET_BLOCKED: the seeded test world is missing.');
    await replaceWorldOccupiedCells(client, 'peace-home', state);
    await client.query('DELETE FROM peace_v2_command_log');
    await client.query('DELETE FROM peace_v2_sessions');
    await client.query('COMMIT');
    console.log(JSON.stringify({ status: 'reset', database: config.database.test.databaseName, scenario }));
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    await client.end();
  }
} catch (error) {
  const code = error instanceof V2DatabaseError ? error.code : 'V2_TEST_RESET_BLOCKED';
  console.error(JSON.stringify({ status: 'blocked', code }));
  process.exitCode = 1;
}
