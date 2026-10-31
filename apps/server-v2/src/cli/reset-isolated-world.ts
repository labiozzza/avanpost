import { loadV2Env, loadV2Config } from '../config.js';
import { connectVerifiedV2Database } from '../database/connect.js';
import { replaceWorldOccupiedCells } from '../database/occupancy.js';
import { V2DatabaseError } from '../database/identity.js';
import { PEACE_WORLD_SCHEMA_VERSION, PeaceWorldSnapshotSchema } from '@avanpost/peace-v2-shared';
import {
  createWorldScenario,
  listWorldScenarios,
  WORLD_SCENARIO_DESCRIPTIONS,
  type WorldScenarioName
} from '../testing/world-scenarios.js';
import { assertScenarioResetAllowed } from '../testing/reset-guard.js';

loadV2Env();

if (process.argv[2] === '--list') {
  console.log(JSON.stringify({ scenarios: listWorldScenarios().map((name) => ({
    name, description: WORLD_SCENARIO_DESCRIPTIONS[name]
  })) }));
  process.exit(0);
}

const startedAt = performance.now();

try {
  const operation = process.env.AVANPOST_V2_DATABASE_OPERATION;
  assertScenarioResetAllowed(operation, process.env.NODE_ENV);
  const scenario = process.argv[2] ?? 'basic';
  const scenarioName = scenario as WorldScenarioName;
  const seedWorld = createWorldScenario(scenarioName);
  const config = loadV2Config();
  const client = await connectVerifiedV2Database(config, operation);
  try {
    await client.query('BEGIN');
    const current = await client.query<{ world_version: number; geometry_version: number }>(
      'SELECT world_version, geometry_version FROM peace_v2_world_state WHERE world_id = $1 FOR UPDATE', ['peace-home']
    );
    const worldVersion = current.rows[0] ? Number(current.rows[0].world_version) + 1 : 1;
    const geometryVersion = current.rows[0] ? Number(current.rows[0].geometry_version) + 1 : 1;
    const validState = PeaceWorldSnapshotSchema.parse({
      ...seedWorld,
      revision: { ...seedWorld.revision, worldVersion, geometryVersion, serverTick: 0 }
    });
    if (current.rows[0]) {
      const updated = await client.query(
        `UPDATE peace_v2_world_state SET world_version = $2, geometry_version = $3, server_tick = 0,
         state = $4::jsonb, last_simulated_at = now(), state_schema_version = $5, updated_at = now()
         WHERE world_id = $1`, [
          'peace-home', worldVersion, geometryVersion, JSON.stringify(validState), PEACE_WORLD_SCHEMA_VERSION
        ]
      );
      if (updated.rowCount !== 1) throw new Error('V2_SCENARIO_RESET_BLOCKED: world row changed during reset.');
    } else {
      await client.query(
        `INSERT INTO peace_v2_world_state
         (world_id, world_version, geometry_version, server_tick, state, last_simulated_at, state_schema_version, updated_at)
         VALUES ($1, $2, $3, 0, $4::jsonb, now(), $5, now())`,
        ['peace-home', worldVersion, geometryVersion, JSON.stringify(validState), PEACE_WORLD_SCHEMA_VERSION]
      );
    }
    await replaceWorldOccupiedCells(client, 'peace-home', validState);
    await client.query('DELETE FROM peace_v2_command_log');
    await client.query('DELETE FROM peace_v2_sessions');
    await client.query('COMMIT');
    const database = operation === 'test' ? config.database.test.databaseName : config.database.manual.databaseName;
    console.log(JSON.stringify({
      status: 'ready', environment: operation, database, worldId: 'peace-home', schemaVersion: PEACE_WORLD_SCHEMA_VERSION,
      worldVersion, geometryVersion, residents: validState.residents.length,
      resources: validState.resources, buildings: validState.buildings.length, scenario,
      description: WORLD_SCENARIO_DESCRIPTIONS[scenarioName], durationMs: Math.round(performance.now() - startedAt)
    }));
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    await client.end();
  }
} catch (error) {
  const code = error instanceof V2DatabaseError ? error.code
    : error instanceof Error && error.message.startsWith('V2_') ? error.message.split(':', 1)[0]
      : 'V2_SCENARIO_RESET_BLOCKED';
  console.error(JSON.stringify({ status: 'blocked', code }));
  process.exitCode = 1;
}
