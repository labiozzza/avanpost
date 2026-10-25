import { afterEach, describe, expect, it } from 'vitest';
import { loadV2Config } from '../src/config.js';
import { createV2Server, type V2HealthDatabase } from '../src/server.js';

const config = loadV2Config({
  DATABASE_URL: 'postgres://peace_v2@127.0.0.1:5434/avanpost_v2_dev',
  TEST_DATABASE_URL: 'postgres://peace_v2@127.0.0.1:5434/avanpost_v2_test'
});

const apps: Array<ReturnType<typeof createV2Server>> = [];

function memoryDatabase(initialState: unknown, initialRevision = { worldVersion: 1, geometryVersion: 1, serverTick: 0 }) {
  let state = structuredClone(initialState);
  let revision = { ...initialRevision };
  const commandLog = new Map<string, { payload_hash: string; response: unknown }>();

  const database: V2HealthDatabase = {
    async query<T>(sql: string, values: unknown[] = []) {
      let rows: unknown[] = [];
      if (sql.includes('SELECT EXISTS (SELECT 1 FROM peace_v2_sessions')) {
        rows = [{ valid: true }];
      } else if (sql.includes('FROM peace_v2_world_state')) {
        rows = [{
          world_version: revision.worldVersion,
          geometry_version: revision.geometryVersion,
          server_tick: revision.serverTick,
          state
        }];
      } else if (sql.includes('FROM peace_v2_command_log')) {
        const saved = commandLog.get(String(values[0]));
        rows = saved ? [saved] : [];
      } else if (sql.startsWith('UPDATE peace_v2_world_state')) {
        revision = {
          worldVersion: Number(values[1]),
          geometryVersion: Number(values[2]),
          serverTick: Number(values[3])
        };
        state = JSON.parse(String(values[4])) as unknown;
      } else if (sql.startsWith('INSERT INTO peace_v2_command_log')) {
        commandLog.set(String(values[0]), {
          payload_hash: String(values[1]),
          response: JSON.parse(String(values[2])) as unknown
        });
      }
      return { rows: rows as T[], rowCount: rows.length };
    }
  };
  return database;
}

const sessionCookie = { cookie: 'peace_v2_session=test-session' };

describe('persisted V2 world state', () => {
  afterEach(async () => {
    await Promise.all(apps.splice(0).map((app) => app.close()));
  });

  it('rejects cabin construction while carrying so delivery remains possible', async () => {
    const initialState = {
      resources: { wood: 3 },
      tree: { position: { x: 3, y: 0 }, remaining: 2 },
      worker: { id: 'worker-1', name: 'Илья', position: { x: 3, y: 0 }, visualState: 'carry', cargo: 1 },
      buildings: []
    };
    const app = createV2Server(config, memoryDatabase(initialState));
    apps.push(app);

    const build = await app.inject({
      method: 'POST',
      url: '/api/commands',
      headers: sessionCookie,
      payload: {
        requestId: 'build-while-carrying',
        expectedWorldVersion: 1,
        expectedGeometryVersion: 1,
        kind: 'build-cabin'
      }
    });

    expect(build.statusCode).toBe(409);
    expect(build.json().code).toBe('CARGO_NOT_EMPTY');
    const deliver = await app.inject({
      method: 'POST',
      url: '/api/commands',
      headers: sessionCookie,
      payload: {
        requestId: 'deliver-after-rejected-build',
        expectedWorldVersion: 1,
        expectedGeometryVersion: 1,
        kind: 'deliver-wood'
      }
    });
    expect(deliver.statusCode).toBe(200);
    expect(deliver.json().worker.cargo).toBe(0);
    expect(deliver.json().resources.wood).toBe(4);
  });

  it('reports invalid saved state separately from database failure without exposing it', async () => {
    const app = createV2Server(config, memoryDatabase({
      resources: { wood: 'private-invalid-value' },
      tree: { position: { x: 3, y: 0 }, remaining: 2 },
      worker: { id: 'worker-1', name: 'Илья', position: { x: -3, y: 0 }, visualState: 'idle', cargo: 0 },
      buildings: []
    }));
    apps.push(app);

    const response = await app.inject({ method: 'GET', url: '/api/world/preview' });
    expect(response.statusCode).toBe(503);
    expect(response.json().code).toBe('V2_WORLD_STATE_INVALID');
    expect(response.body).not.toContain('private-invalid-value');
    expect(response.body).not.toContain('V2_DB_UNAVAILABLE');
  });
});
