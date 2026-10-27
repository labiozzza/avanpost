import { loadV2Env, loadV2Config } from '../config.js';
import { connectVerifiedV2Database } from '../database/connect.js';
import { V2DatabaseError } from '../database/identity.js';
import { COPPICE_REGROWTH_TICKS, WOOD_REGROWTH_TICKS } from '@avanpost/peace-v2-sim';

loadV2Env();

const STARTING_STATE = {
  resources: { wood: 1 },
  storage: { id: 'storehouse-1', anchor: { x: -6, y: -1 }, footprint: { width: 2, height: 1 }, woodCapacity: 100 },
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
      state: 'idle', workRole: 'none', visualState: 'idle', cargo: 0, blockedReason: null, task: null
    },
    {
      id: 'worker-2', name: 'Марья', appearanceKey: 'maria', position: { x: 14, y: 0 }, facing: 'left',
      state: 'idle', workRole: 'none', visualState: 'idle', cargo: 0, blockedReason: null, task: null
    }
  ],
  buildOrders: [],
  nextBuildOrderSequence: 1,
  buildings: []
};

const BUILDER_CARRY_PRIORITY_STATE = {
  resources: { wood: 100 },
  storage: { id: 'storehouse-1', anchor: { x: -6, y: -1 }, footprint: { width: 2, height: 1 }, woodCapacity: 100 },
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
      task: {
        id: 'fixture-woodcutter-cargo', kind: 'gather-wood', phase: 'waiting_storage', sourceId: 'tree-1',
        destinationId: 'storehouse-1', path: [], pathIndex: 0, progressTicks: 0, requiredTicks: 2,
        blockedReason: 'STORAGE_FULL', continuous: true, cancelAfterDelivery: false, assignmentSource: 'profession'
      }
    },
    {
      id: 'worker-2', name: 'Марья', appearanceKey: 'maria', position: { x: 14, y: 0 }, facing: 'left',
      state: 'waiting', workRole: 'none', visualState: 'waiting_storage', cargo: 1, blockedReason: 'STORAGE_FULL',
      task: {
        id: 'fixture-builder-cargo', kind: 'gather-wood', phase: 'waiting_storage', sourceId: 'tree-2',
        destinationId: 'storehouse-1', path: [], pathIndex: 0, progressTicks: 0, requiredTicks: 2,
        blockedReason: 'STORAGE_FULL', continuous: true, cancelAfterDelivery: false, assignmentSource: 'manual'
      }
    }
  ],
  buildOrders: [],
  nextBuildOrderSequence: 1,
  buildings: []
};

try {
  if (process.env.AVANPOST_V2_DATABASE_OPERATION !== 'test') {
    throw new Error('V2_TEST_RESET_BLOCKED: test-only operation flag is required.');
  }
  const scenario = process.argv[2] ?? 'starter';
  const scenarioState = scenario === 'starter' ? STARTING_STATE
    : scenario === 'builder-carry-priority' ? BUILDER_CARRY_PRIORITY_STATE : undefined;
  if (!scenarioState) throw new Error('V2_TEST_RESET_BLOCKED: unknown test-world scenario.');
  const config = loadV2Config();
  const client = await connectVerifiedV2Database(config, 'test');
  try {
    await client.query('BEGIN');
      const result = await client.query(
        `UPDATE peace_v2_world_state
         SET world_version = 1, geometry_version = 1, server_tick = 0, state = $1::jsonb,
             last_simulated_at = now(), state_schema_version = 6, updated_at = now()
         WHERE world_id = 'peace-home'`,
      [JSON.stringify(scenarioState)]
    );
    if (result.rowCount !== 1) throw new Error('V2_TEST_RESET_BLOCKED: the seeded test world is missing.');
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
