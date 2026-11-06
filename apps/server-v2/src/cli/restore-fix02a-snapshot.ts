import { readFile } from 'node:fs/promises';
import { loadV2Env, loadV2Config } from '../config.js';
import { connectVerifiedV2Database } from '../database/connect.js';
import { replaceWorldOccupiedCells } from '../database/occupancy.js';
import { PEACE_WORLD_SCHEMA_VERSION, PeaceWorldSnapshotSchema } from '@avanpost/peace-v2-shared';

loadV2Env();
try {
  if (process.env.NODE_ENV === 'production' || process.env.AVANPOST_V2_DATABASE_OPERATION !== 'test' ||
      loadV2Config().database.test.databaseName !== 'avanpost_v2_g7_2_fix02a_test') {
    throw new Error('FIX02A_RESTORE_BLOCKED: exact disposable test database is required.');
  }
  const initialDelayMs = Number(process.env.AVANPOST_V2_FIX02A_INITIAL_DELAY_MS ?? 0);
  if (!Number.isSafeInteger(initialDelayMs) || initialDelayMs < 0 || initialDelayMs > 20_000) {
    throw new Error('FIX02A_RESTORE_BLOCKED: initial delay must be an integer from 0 to 20000 ms.');
  }
  const file = process.argv[2];
  if (!file) throw new Error('FIX02A_RESTORE_BLOCKED: snapshot path is required.');
  const snapshot = PeaceWorldSnapshotSchema.parse(JSON.parse(await readFile(file, 'utf8')));
  // Test-only capture window for Chromium. Simulation remains enabled and
  // resumes automatically when this timestamp is reached; no work/path rules
  // are bypassed.
  const client = await connectVerifiedV2Database(loadV2Config(), 'test');
  try {
    await client.query('BEGIN');
    const restored = { ...snapshot, revision: { ...snapshot.revision, worldVersion: 1, geometryVersion: 1 } };
    await client.query(`INSERT INTO peace_v2_world_state
      (world_id, world_version, geometry_version, server_tick, state, last_simulated_at, state_schema_version, updated_at)
      VALUES ($1, 1, 1, $2, $3::jsonb, $5, $4, now())
      ON CONFLICT (world_id) DO UPDATE SET world_version = 1, geometry_version = 1, server_tick = EXCLUDED.server_tick,
       state = EXCLUDED.state, last_simulated_at = EXCLUDED.last_simulated_at,
       state_schema_version = EXCLUDED.state_schema_version, updated_at = now()`,
    ['peace-home', restored.revision.serverTick, JSON.stringify(restored), PEACE_WORLD_SCHEMA_VERSION,
      new Date(Date.now() + initialDelayMs)]);
    await client.query('DELETE FROM peace_v2_command_log');
    await client.query('DELETE FROM peace_v2_sessions');
    await replaceWorldOccupiedCells(client, 'peace-home', restored);
    await client.query('COMMIT');
    console.log(JSON.stringify({ status: 'restored', database: 'avanpost_v2_g7_2_fix02a_test', worldId: 'peace-home',
      residents: restored.residents.length, buildings: restored.buildings.length, serverTick: restored.revision.serverTick,
      initialDelayMs }));
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    await client.end();
  }
} catch (error) {
  console.error(JSON.stringify({ status: 'blocked', code: (error instanceof Error ? error.message : 'blocked').split(':', 1)[0],
    detail: error instanceof Error ? error.message.slice(0, 400) : 'Unknown restore failure.' }));
  process.exitCode = 1;
}
