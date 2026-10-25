import { afterEach, describe, expect, it } from 'vitest';
import { loadV2Config } from '../src/config.js';
import { createV2Server, type V2HealthDatabase } from '../src/server.js';

const config = loadV2Config({
  DATABASE_URL: 'postgres://peace_v2@127.0.0.1:5434/avanpost_v2_dev',
  TEST_DATABASE_URL: 'postgres://peace_v2@127.0.0.1:5434/avanpost_v2_test'
});

const apps: Array<ReturnType<typeof createV2Server>> = [];

function memoryDatabase(
  initialState: unknown,
  initialRevision = { worldVersion: 1, geometryVersion: 1, serverTick: 0 },
  initialLastSimulatedAt = new Date(Date.now() + 60_000)
) {
  let state = structuredClone(initialState);
  let revision = { ...initialRevision };
  let lastSimulatedAt = initialLastSimulatedAt;
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
          last_simulated_at: lastSimulatedAt,
          state
        }];
      } else if (sql.includes('FROM peace_v2_command_log')) {
        const saved = commandLog.get(String(values[0]));
        rows = saved ? [saved] : [];
      } else if (sql.startsWith('UPDATE peace_v2_world_state')) {
        revision = {
          worldVersion: Number(values[1]),
          geometryVersion: Number(values[2]),
          serverTick: sql.includes('last_simulated_at') ? Number(values[3]) : revision.serverTick
        };
        state = JSON.parse(String(sql.includes('last_simulated_at') ? values[4] : values[3])) as unknown;
        if (sql.includes('last_simulated_at')) lastSimulatedAt = new Date(values[5] as Date);
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
    const clockStart = Date.now() + 60_000;
    const initialState = {
      resources: { wood: 3 },
      storage: { id: 'storehouse-1', anchor: { x: -6, y: -1 }, footprint: { width: 2, height: 1 } },
      trees: [{ id: 'tree-1', name: 'Берёза', sourceKind: 'finite', position: { x: 3, y: 0 }, remaining: 2,
        maxRemaining: 3, state: 'standing', regrowthProgressTicks: 0, regrowthEveryTicks: null }],
      worker: {
        id: 'worker-1', name: 'Илья', position: { x: 2, y: 0 }, visualState: 'carrying_to_storage', cargo: 1,
        task: {
          id: 'delivery-task', kind: 'gather-wood', phase: 'carrying_to_storage', sourceId: 'tree-1', destinationId: 'storehouse-1',
          path: [{ x: 1, y: 0 }, { x: 0, y: 0 }, { x: -1, y: 0 }, { x: -2, y: 0 }, { x: -3, y: 0 }, { x: -4, y: 0 }],
          pathIndex: 0, progressTicks: 0, requiredTicks: 6, blockedReason: null
        }
      },
      buildings: []
    };
    const app = createV2Server(config, memoryDatabase(initialState, undefined, new Date(clockStart + 60_000)));
    apps.push(app);

    const build = await app.inject({
      method: 'POST',
      url: '/api/commands',
      headers: sessionCookie,
      payload: {
        requestId: 'build-while-carrying',
        expectedWorldVersion: 1,
        expectedGeometryVersion: 1,
        kind: 'build-cabin',
        anchor: { x: 8, y: -1 }
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
        kind: 'collect-wood', sourceId: 'tree-1'
      }
    });
    expect(deliver.statusCode).toBe(409);
    expect(deliver.json().code).toBe('WORKER_BUSY');
    await app.tickSimulation(clockStart + 60_000 + 8 * 500);
    const savedWorld = await app.inject({ method: 'GET', url: '/api/world', headers: sessionCookie });
    expect(savedWorld.statusCode).toBe(200);
    expect(savedWorld.json().worker.cargo).toBe(0);
    expect(savedWorld.json().resources.wood).toBe(4);
  });

  it('starts gathering only on arrival and resumes a saved carry task after API recreation', async () => {
    const clockStart = Date.now();
    const initialState = {
      resources: { wood: 1 },
      storage: { id: 'storehouse-1', anchor: { x: -6, y: -1 }, footprint: { width: 2, height: 1 } },
      trees: [{ id: 'tree-1', name: 'Берёза', sourceKind: 'finite', position: { x: 3, y: 0 }, remaining: 3,
        maxRemaining: 3, state: 'standing', regrowthProgressTicks: 0, regrowthEveryTicks: null }],
      worker: { id: 'worker-1', name: 'Илья', position: { x: -3, y: 0 }, visualState: 'idle', cargo: 0, task: null },
      buildings: []
    };
    const database = memoryDatabase(initialState, undefined, new Date(clockStart));
    const firstApi = createV2Server(config, database);
    apps.push(firstApi);
    const start = await firstApi.inject({
      method: 'POST', url: '/api/commands', headers: sessionCookie,
      payload: {
        requestId: 'gather-route-0001', expectedWorldVersion: 1, expectedGeometryVersion: 1,
        kind: 'collect-wood', sourceId: 'tree-1'
      }
    });
    expect(start.statusCode).toBe(200);
    expect(start.json().worker.task.phase).toBe('walking_to_source');
    expect(start.json().trees[0].remaining).toBe(3);
    expect(start.json().resources.wood).toBe(1);

    await firstApi.tickSimulation(clockStart + 2_500);
    const arrived = await firstApi.inject({ method: 'GET', url: '/api/world', headers: sessionCookie });
    expect(arrived.json().worker.position).toEqual({ x: 2, y: 0 });
    expect(arrived.json().worker.task.phase).toBe('gathering');
    expect(arrived.json().trees[0].remaining).toBe(3);
    expect(arrived.json().worker.cargo).toBe(0);

    await firstApi.tickSimulation(clockStart + 4_500);
    const gathered = await firstApi.inject({ method: 'GET', url: '/api/world', headers: sessionCookie });
    expect(gathered.json().worker.task.phase).toBe('loading');
    expect(gathered.json().resources.wood).toBe(1);
    expect(gathered.json().trees[0].remaining).toBe(3);

    await firstApi.tickSimulation(clockStart + 5_000);
    apps.splice(apps.indexOf(firstApi), 1);
    await firstApi.close();
    const restartedApi = createV2Server(config, database);
    apps.push(restartedApi);
    const afterRestart = await restartedApi.inject({ method: 'GET', url: '/api/world', headers: sessionCookie });
    expect(afterRestart.json().worker.cargo).toBe(1);
    expect(afterRestart.json().worker.task.phase).toBe('carrying_to_storage');
    expect(afterRestart.json().trees[0].remaining).toBe(2);
    expect(afterRestart.json().resources.wood).toBe(1);

    await restartedApi.tickSimulation(clockStart + 9_000);
    const unloaded = await restartedApi.inject({ method: 'GET', url: '/api/world', headers: sessionCookie });
    expect(unloaded.json().worker.cargo).toBe(0);
    expect(unloaded.json().worker.task).toBeNull();
    expect(unloaded.json().resources.wood).toBe(2);
    expect(unloaded.json().trees[0].remaining).toBe(2);
  });

  it('reports invalid saved state separately from database failure without exposing it', async () => {
    const app = createV2Server(config, memoryDatabase({
      storage: { id: 'storehouse-1', anchor: { x: -6, y: -1 }, footprint: { width: 2, height: 1 } },
      trees: [{ id: 'tree-1', name: 'Берёза', sourceKind: 'finite', position: { x: 3, y: 0 }, remaining: 2,
        maxRemaining: 3, state: 'standing', regrowthProgressTicks: 0, regrowthEveryTicks: null }],
      resources: { wood: 'private-invalid-value' },
      worker: { id: 'worker-1', name: 'Илья', position: { x: -3, y: 0 }, visualState: 'idle', cargo: 0, task: null },
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
