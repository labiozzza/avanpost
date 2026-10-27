import { afterEach, describe, expect, it } from 'vitest';
import { loadV2Config } from '../src/config.js';
import { createV2Server, type V2HealthDatabase } from '../src/server.js';
import { COPPICE_REGROWTH_TICKS, WOOD_REGROWTH_TICKS } from '@avanpost/peace-v2-sim';

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

  it('lets another resident build while the carrier delivers, but rejects a second task on the carrier', async () => {
    const clockStart = Date.now() + 60_000;
    const initialState = {
      resources: { wood: 3 },
      storage: { id: 'storehouse-1', anchor: { x: -6, y: -1 }, footprint: { width: 2, height: 1 }, woodCapacity: 100 },
      trees: [{ id: 'tree-1', name: 'Берёза', sourceKind: 'finite', position: { x: 3, y: 0 }, remaining: 2,
        maxRemaining: 3, state: 'standing', regrowthProgressTicks: 0, regrowthEveryTicks: 100 }],
      residents: [
        {
          id: 'worker-1', name: 'Илья', appearanceKey: 'ilya', position: { x: 2, y: 0 }, facing: 'left',
          state: 'working', visualState: 'carrying_to_storage', cargo: 1, blockedReason: null,
          task: {
            id: 'delivery-task', kind: 'gather-wood', phase: 'carrying_to_storage', sourceId: 'tree-1', destinationId: 'storehouse-1',
            path: [{ x: 1, y: 0 }, { x: 0, y: 0 }, { x: -1, y: 0 }, { x: -2, y: 0 }, { x: -3, y: 0 }, { x: -4, y: 0 }],
            pathIndex: 0, progressTicks: 0, requiredTicks: 6, blockedReason: null,
            continuous: true, cancelAfterDelivery: false
          }
        },
        {
          id: 'worker-2', name: 'Марья', appearanceKey: 'maria', position: { x: 14, y: 0 }, facing: 'left',
          state: 'idle', visualState: 'idle', cargo: 0, blockedReason: null, task: null
        }
      ],
      buildings: []
    };
    const app = createV2Server(config, memoryDatabase(initialState, undefined, new Date(clockStart + 60_000)));
    apps.push(app);

    const carrierBuild = await app.inject({
      method: 'POST',
      url: '/api/commands',
      headers: sessionCookie,
      payload: {
        requestId: 'build-while-carrying',
        expectedWorldVersion: 1,
        expectedGeometryVersion: 1,
        kind: 'build-cabin',
        residentId: 'worker-1', anchor: { x: 10, y: -1 }
      }
    });

    expect(carrierBuild.statusCode).toBe(409);
    expect(carrierBuild.json().code).toBe('CARGO_NOT_EMPTY');
    const parallelBuild = await app.inject({
      method: 'POST', url: '/api/commands', headers: sessionCookie,
      payload: {
        requestId: 'maria-build-while-ilya-delivers',
        expectedWorldVersion: 1, expectedGeometryVersion: 1,
        kind: 'build-cabin', residentId: 'worker-2', anchor: { x: 10, y: -1 }
      }
    });
    expect(parallelBuild.statusCode).toBe(200);
    expect(parallelBuild.json().residents[0].task.phase).toBe('carrying_to_storage');
    expect(parallelBuild.json().residents[1].task.phase).toBe('walking_to_build');
    expect(parallelBuild.json().resources.wood).toBe(0);
    const deliver = await app.inject({
      method: 'POST',
      url: '/api/commands',
      headers: sessionCookie,
      payload: {
        requestId: 'deliver-after-rejected-build',
        expectedWorldVersion: parallelBuild.json().revision.worldVersion,
        expectedGeometryVersion: parallelBuild.json().revision.geometryVersion,
        kind: 'collect-wood', residentId: 'worker-1', sourceId: 'tree-1'
      }
    });
    expect(deliver.statusCode).toBe(409);
    expect(deliver.json().code).toBe('WORKER_BUSY');
    await app.tickSimulation(clockStart + 60_000 + 8 * 500);
    const savedWorld = await app.inject({ method: 'GET', url: '/api/world', headers: sessionCookie });
    expect(savedWorld.statusCode).toBe(200);
    expect(savedWorld.json().residents[0].cargo).toBe(0);
    expect(savedWorld.json().residents[0].task.phase).toBe('walking_to_source');
    expect(savedWorld.json().residents[1].task.phase).toBe('building');
    expect(savedWorld.json().buildings[0].anchor).toEqual({ x: 10, y: -1 });
    expect(savedWorld.json().resources.wood).toBe(1);
  });

  it('accepts a stale simulation revision when geometry still matches and revalidates the locked world', async () => {
    const clockStart = Date.now() + 60_000;
    const initialState = {
      resources: { wood: 1 },
      storage: { id: 'storehouse-1', anchor: { x: -6, y: -1 }, footprint: { width: 2, height: 1 }, woodCapacity: 100 },
      trees: [{ id: 'tree-1', name: 'Берёза', sourceKind: 'finite', position: { x: 3, y: 0 }, remaining: 3,
        maxRemaining: 3, state: 'standing', regrowthProgressTicks: 0, regrowthEveryTicks: WOOD_REGROWTH_TICKS }],
      residents: [
        { id: 'worker-1', name: 'Илья', appearanceKey: 'ilya', position: { x: -3, y: 0 }, facing: 'right',
          state: 'idle', visualState: 'idle', cargo: 0, blockedReason: null, task: null },
        { id: 'worker-2', name: 'Марья', appearanceKey: 'maria', position: { x: 14, y: 0 }, facing: 'left',
          state: 'idle', visualState: 'idle', cargo: 0, blockedReason: null, task: null }
      ],
      buildings: []
    };
    const app = createV2Server(config, memoryDatabase(initialState,
      { worldVersion: 8, geometryVersion: 1, serverTick: 20 }, new Date(clockStart + 60_000)));
    apps.push(app);
    const accepted = await app.inject({
      method: 'POST', url: '/api/commands', headers: sessionCookie,
      payload: {
        requestId: 'stale-sim-revision-still-valid', expectedWorldVersion: 1, expectedGeometryVersion: 1,
        kind: 'collect-wood', residentId: 'worker-1'
      }
    });
    expect(accepted.statusCode).toBe(200);
    expect(accepted.json().residents[0].task.phase).toBe('walking_to_source');

    const future = await app.inject({
      method: 'POST', url: '/api/commands', headers: sessionCookie,
      payload: {
        requestId: 'future-sim-revision-refused', expectedWorldVersion: 999, expectedGeometryVersion: 1,
        kind: 'cancel-woodcutting', residentId: 'worker-1'
      }
    });
    expect(future.statusCode).toBe(409);
    expect(future.json().code).toBe('STALE_WORLD');
    const unchanged = await app.inject({ method: 'GET', url: '/api/world', headers: sessionCookie });
    expect(unchanged.json().residents[0].task.phase).toBe('walking_to_source');
    const staleGeometry = await app.inject({
      method: 'POST', url: '/api/commands', headers: sessionCookie,
      payload: {
        requestId: 'stale-geometry-refused', expectedWorldVersion: unchanged.json().revision.worldVersion,
        expectedGeometryVersion: 0, kind: 'cancel-woodcutting', residentId: 'worker-1'
      }
    });
    expect(staleGeometry.statusCode).toBe(409);
    expect(staleGeometry.json().code).toBe('STALE_GEOMETRY');
  });

  it('starts gathering only on arrival and resumes a saved carry task after API recreation', async () => {
    const clockStart = Date.now();
    const initialState = {
      resources: { wood: 1 },
      storage: { id: 'storehouse-1', anchor: { x: -6, y: -1 }, footprint: { width: 2, height: 1 }, woodCapacity: 100 },
      trees: [{ id: 'tree-1', name: 'Берёза', sourceKind: 'finite', position: { x: 3, y: 0 }, remaining: 3,
        maxRemaining: 3, state: 'standing', regrowthProgressTicks: 0, regrowthEveryTicks: 100 }],
      residents: [
        { id: 'worker-1', name: 'Илья', appearanceKey: 'ilya', position: { x: -3, y: 0 }, facing: 'right',
          state: 'idle', visualState: 'idle', cargo: 0, blockedReason: null, task: null },
        { id: 'worker-2', name: 'Марья', appearanceKey: 'maria', position: { x: 14, y: 0 }, facing: 'left',
          state: 'idle', visualState: 'idle', cargo: 0, blockedReason: null, task: null }
      ],
      buildings: []
    };
    const database = memoryDatabase(initialState, undefined, new Date(clockStart));
    const firstApi = createV2Server(config, database);
    apps.push(firstApi);
    const start = await firstApi.inject({
      method: 'POST', url: '/api/commands', headers: sessionCookie,
      payload: {
        requestId: 'gather-route-0001', expectedWorldVersion: 1, expectedGeometryVersion: 1,
        kind: 'collect-wood', residentId: 'worker-1', sourceId: 'tree-1'
      }
    });
    expect(start.statusCode).toBe(200);
    expect(start.json().residents[0].task.phase).toBe('walking_to_source');
    expect(start.json().trees[0].remaining).toBe(3);
    expect(start.json().resources.wood).toBe(1);

    await firstApi.tickSimulation(clockStart + 2_500);
    const arrived = await firstApi.inject({ method: 'GET', url: '/api/world', headers: sessionCookie });
    expect(arrived.json().residents[0].position).toEqual({ x: 2, y: 0 });
    expect(arrived.json().residents[0].task.phase).toBe('gathering');
    expect(arrived.json().trees[0].remaining).toBe(3);
    expect(arrived.json().residents[0].cargo).toBe(0);

    await firstApi.tickSimulation(clockStart + 4_500);
    const gathered = await firstApi.inject({ method: 'GET', url: '/api/world', headers: sessionCookie });
    expect(gathered.json().residents[0].task.phase).toBe('loading');
    expect(gathered.json().resources.wood).toBe(1);
    expect(gathered.json().trees[0].remaining).toBe(3);

    await firstApi.tickSimulation(clockStart + 5_000);
    apps.splice(apps.indexOf(firstApi), 1);
    await firstApi.close();
    const restartedApi = createV2Server(config, database);
    apps.push(restartedApi);
    const afterRestart = await restartedApi.inject({ method: 'GET', url: '/api/world', headers: sessionCookie });
    expect(afterRestart.json().residents[0].cargo).toBe(1);
    expect(afterRestart.json().residents[0].task.phase).toBe('carrying_to_storage');
    expect(afterRestart.json().trees[0].remaining).toBe(2);
    expect(afterRestart.json().resources.wood).toBe(1);

    await restartedApi.tickSimulation(clockStart + 9_000);
    const unloaded = await restartedApi.inject({ method: 'GET', url: '/api/world', headers: sessionCookie });
    expect(unloaded.json().residents[0].cargo).toBe(0);
    expect(unloaded.json().residents[0].task.phase).toBe('walking_to_source');
    expect(unloaded.json().resources.wood).toBe(2);
    expect(unloaded.json().trees[0].remaining).toBe(2);
  });

  it('serializes competing same-tree assignments and keeps the second resident waiting without duplicate harvest', async () => {
    const clockStart = Date.now() + 60_000;
    const initialState = {
      resources: { wood: 3 },
      storage: { id: 'storehouse-1', anchor: { x: -6, y: -1 }, footprint: { width: 2, height: 1 }, woodCapacity: 100 },
      trees: [{ id: 'tree-1', name: 'Берёза', sourceKind: 'finite', position: { x: 3, y: 0 }, remaining: 3,
        maxRemaining: 3, state: 'standing', regrowthProgressTicks: 0, regrowthEveryTicks: 100 }],
      residents: [
        { id: 'worker-1', name: 'Илья', appearanceKey: 'ilya', position: { x: -3, y: 0 }, facing: 'right',
          state: 'idle', visualState: 'idle', cargo: 0, blockedReason: null, task: null },
        { id: 'worker-2', name: 'Марья', appearanceKey: 'maria', position: { x: 14, y: 0 }, facing: 'left',
          state: 'idle', visualState: 'idle', cargo: 0, blockedReason: null, task: null }
      ],
      buildings: []
    };
    const app = createV2Server(config, memoryDatabase(initialState, undefined, new Date(clockStart + 60_000)));
    apps.push(app);

    const first = await app.inject({
      method: 'POST', url: '/api/commands', headers: sessionCookie,
      payload: {
        requestId: 'same-tree-worker-1', expectedWorldVersion: 1, expectedGeometryVersion: 1,
        kind: 'collect-wood', residentId: 'worker-1', sourceId: 'tree-1'
      }
    });
    expect(first.statusCode).toBe(200);
    const second = await app.inject({
      method: 'POST', url: '/api/commands', headers: sessionCookie,
      payload: {
        requestId: 'same-tree-worker-2', expectedWorldVersion: first.json().revision.worldVersion,
        expectedGeometryVersion: 1, kind: 'collect-wood', residentId: 'worker-2', sourceId: 'tree-1'
      }
    });
    expect(second.statusCode).toBe(200);
    expect(second.json().residents[0].task.phase).toBe('walking_to_source');
    expect(second.json().residents[1].task.phase).toBe('waiting_resource');
    expect(second.json().residents[1].task.blockedReason).toBe('SOURCE_RESERVED');
    const incompatible = await app.inject({
      method: 'POST', url: '/api/commands', headers: sessionCookie,
      payload: {
        requestId: 'same-worker-second-task', expectedWorldVersion: second.json().revision.worldVersion,
        expectedGeometryVersion: 1, kind: 'build-cabin', residentId: 'worker-1', anchor: { x: 10, y: -1 }
      }
    });
    expect(incompatible.statusCode).toBe(409);
    expect(incompatible.json().code).toBe('WORKER_BUSY');

    await app.tickSimulation(clockStart + 60_000 + 10 * 500);
    const active = await app.inject({ method: 'GET', url: '/api/world', headers: sessionCookie });
    expect(active.json().trees[0].remaining).toBe(2);
    expect(active.json().residents[0].cargo).toBe(1);
    expect(active.json().residents[0].task.phase).toBe('carrying_to_storage');
    expect(active.json().residents[1].task.phase).toBe('waiting_resource');
    expect(active.json().residents[1].task.blockedReason).toBe('WORK_POINT_OCCUPIED');
    expect(active.json().resources.wood).toBe(3);
  });

  it('persists a builder waiting for materials while the other resident gathers', async () => {
    const clockStart = Date.now() + 60_000;
    const lastSimulatedAt = new Date(clockStart + 60_000);
    const initialState = {
      resources: { wood: 0 },
      storage: { id: 'storehouse-1', anchor: { x: -6, y: -1 }, footprint: { width: 2, height: 1 }, woodCapacity: 100 },
      trees: [{ id: 'tree-1', name: 'Берёза', sourceKind: 'finite', position: { x: 3, y: 0 }, remaining: 3,
        maxRemaining: 3, state: 'standing', regrowthProgressTicks: 0, regrowthEveryTicks: 100 }],
      residents: [
        { id: 'worker-1', name: 'Илья', appearanceKey: 'ilya', position: { x: -3, y: 0 }, facing: 'right',
          state: 'idle', visualState: 'idle', cargo: 0, blockedReason: null, task: null },
        { id: 'worker-2', name: 'Марья', appearanceKey: 'maria', position: { x: 14, y: 0 }, facing: 'left',
          state: 'idle', visualState: 'idle', cargo: 0, blockedReason: null, task: null }
      ],
      buildings: []
    };
    const app = createV2Server(config, memoryDatabase(initialState, undefined, lastSimulatedAt));
    apps.push(app);
    const build = await app.inject({
      method: 'POST', url: '/api/commands', headers: sessionCookie,
      payload: {
        requestId: 'builder-waits-for-wood', expectedWorldVersion: 1, expectedGeometryVersion: 1,
        kind: 'build-cabin', residentId: 'worker-2', anchor: { x: 12, y: -1 }
      }
    });
    expect(build.statusCode).toBe(200);
    expect(build.json().resources.wood).toBe(0);
    expect(build.json().buildings[0].state).toBe('waiting_materials');
    expect(build.json().buildings[0].reservedWood).toBe(0);
    expect(build.json().residents[1].task.phase).toBe('waiting_materials');
    expect(build.json().residents[1].blockedReason).toBe('INSUFFICIENT_WOOD');

    const gather = await app.inject({
      method: 'POST', url: '/api/commands', headers: sessionCookie,
      payload: {
        requestId: 'gather-while-builder-waits', expectedWorldVersion: build.json().revision.worldVersion,
        expectedGeometryVersion: build.json().revision.geometryVersion,
        kind: 'collect-wood', residentId: 'worker-1', sourceId: 'tree-1'
      }
    });
    expect(gather.statusCode).toBe(200);
    expect(gather.json().residents[0].task.phase).toBe('walking_to_source');
    expect(gather.json().residents[1].task.phase).toBe('waiting_materials');
    await app.tickSimulation(lastSimulatedAt.getTime() + 10 * 500);
    const carrying = await app.inject({ method: 'GET', url: '/api/world', headers: sessionCookie });
    expect(carrying.json().residents[0].task.phase).toBe('carrying_to_storage');
    expect(carrying.json().residents[0].cargo).toBe(1);
    expect(carrying.json().residents[1].task.phase).toBe('waiting_materials');
    expect(carrying.json().buildings[0].reservedWood).toBe(0);
    await app.tickSimulation(lastSimulatedAt.getTime() + 18 * 500);
    const unloaded = await app.inject({ method: 'GET', url: '/api/world', headers: sessionCookie });
    expect(unloaded.json().resources.wood).toBe(1);
    expect(unloaded.json().residents[0].task.phase).toBe('walking_to_source');
    expect(unloaded.json().residents[1].task.phase).toBe('waiting_materials');
    expect(unloaded.json().residents[1].blockedReason).toBe('INSUFFICIENT_WOOD');
    expect(unloaded.json().buildings[0].reservedWood).toBe(0);
  });

  it('assigns both residents distinct nearest sources and preserves both harvests without manual source selection', async () => {
    const clockStart = Date.now() + 60_000;
    const initialState = {
      resources: { wood: 0 },
      storage: { id: 'storehouse-1', anchor: { x: -6, y: -1 }, footprint: { width: 2, height: 1 }, woodCapacity: 100 },
      trees: [
        { id: 'tree-1', name: 'Берёза', sourceKind: 'finite', position: { x: 3, y: 0 }, remaining: 3,
          maxRemaining: 3, state: 'standing', regrowthProgressTicks: 0, regrowthEveryTicks: WOOD_REGROWTH_TICKS },
        { id: 'coppice-1', name: 'Поросль', sourceKind: 'renewable_plot', position: { x: 16, y: 0 }, remaining: 1,
          maxRemaining: 1, state: 'standing', regrowthProgressTicks: 0, regrowthEveryTicks: COPPICE_REGROWTH_TICKS }
      ],
      residents: [
        { id: 'worker-1', name: 'Илья', appearanceKey: 'ilya', position: { x: -3, y: 0 }, facing: 'right',
          state: 'idle', visualState: 'idle', cargo: 0, blockedReason: null, task: null },
        { id: 'worker-2', name: 'Марья', appearanceKey: 'maria', position: { x: 14, y: 0 }, facing: 'left',
          state: 'idle', visualState: 'idle', cargo: 0, blockedReason: null, task: null }
      ],
      buildings: []
    };
    const app = createV2Server(config, memoryDatabase(initialState, undefined, new Date(clockStart + 60_000)));
    apps.push(app);
    const first = await app.inject({
      method: 'POST', url: '/api/commands', headers: sessionCookie,
      payload: {
        requestId: 'auto-wood-worker-1', expectedWorldVersion: 1, expectedGeometryVersion: 1,
        kind: 'collect-wood', residentId: 'worker-1'
      }
    });
    expect(first.statusCode).toBe(200);
    expect(first.json().residents[0].task.sourceId).toBe('tree-1');
    const second = await app.inject({
      method: 'POST', url: '/api/commands', headers: sessionCookie,
      payload: {
        requestId: 'auto-wood-worker-2', expectedWorldVersion: first.json().revision.worldVersion,
        expectedGeometryVersion: 1, kind: 'collect-wood', residentId: 'worker-2'
      }
    });
    expect(second.statusCode).toBe(200);
    expect(second.json().residents[1].task.sourceId).toBe('coppice-1');

    await app.tickSimulation(clockStart + 60_000 + 11 * 500);
    const harvesting = await app.inject({ method: 'GET', url: '/api/world', headers: sessionCookie });
    expect(harvesting.json().residents.map((resident: { cargo: number }) => resident.cargo)).toEqual([1, 1]);
    expect(harvesting.json().trees.map((tree: { remaining: number }) => tree.remaining)).toEqual([2, 0]);
    expect(harvesting.json().resources.wood).toBe(0);
    expect(harvesting.json().residents.map((resident: { task: { continuous: boolean } | null }) => resident.task?.continuous)).toEqual([true, true]);
  });

  it('cancels repeat work after safe delivery and keeps the cancellation through API restart', async () => {
    const clockStart = Date.now() + 60_000;
    const initialState = {
      resources: { wood: 0 },
      storage: { id: 'storehouse-1', anchor: { x: -6, y: -1 }, footprint: { width: 2, height: 1 }, woodCapacity: 100 },
      trees: [{ id: 'tree-1', name: 'Берёза', sourceKind: 'finite', position: { x: 3, y: 0 }, remaining: 2,
        maxRemaining: 3, state: 'standing', regrowthProgressTicks: 0, regrowthEveryTicks: WOOD_REGROWTH_TICKS }],
      residents: [
        { id: 'worker-1', name: 'Илья', appearanceKey: 'ilya', position: { x: 2, y: 0 }, facing: 'left',
          state: 'working', visualState: 'carrying_to_storage', cargo: 1, blockedReason: null,
          task: { id: 'cancel-after-carry', kind: 'gather-wood', phase: 'carrying_to_storage', sourceId: 'tree-1',
            destinationId: 'storehouse-1', path: [{ x: 1, y: 0 }, { x: 0, y: 0 }, { x: -1, y: 0 },
              { x: -2, y: 0 }, { x: -3, y: 0 }, { x: -4, y: 0 }], pathIndex: 0, progressTicks: 0,
            requiredTicks: 6, blockedReason: null, continuous: true, cancelAfterDelivery: false }
        },
        { id: 'worker-2', name: 'Марья', appearanceKey: 'maria', position: { x: 14, y: 0 }, facing: 'left',
          state: 'idle', visualState: 'idle', cargo: 0, blockedReason: null, task: null }
      ],
      buildings: []
    };
    const database = memoryDatabase(initialState, undefined, new Date(clockStart + 60_000));
    const firstApi = createV2Server(config, database);
    apps.push(firstApi);
    const cancel = await firstApi.inject({
      method: 'POST', url: '/api/commands', headers: sessionCookie,
      payload: {
        requestId: 'cancel-continuous-woodcutting', expectedWorldVersion: 1, expectedGeometryVersion: 1,
        kind: 'cancel-woodcutting', residentId: 'worker-1'
      }
    });
    expect(cancel.statusCode).toBe(200);
    expect(cancel.json().residents[0].task).toMatchObject({ continuous: false, cancelAfterDelivery: true });
    apps.splice(apps.indexOf(firstApi), 1);
    await firstApi.close();
    const restartedApi = createV2Server(config, database);
    apps.push(restartedApi);
    await restartedApi.tickSimulation(clockStart + 60_000 + 8 * 500);
    const delivered = await restartedApi.inject({ method: 'GET', url: '/api/world', headers: sessionCookie });
    expect(delivered.json().resources.wood).toBe(1);
    expect(delivered.json().residents[0].cargo).toBe(0);
    expect(delivered.json().residents[0].task).toBeNull();
  });

  it('keeps cargo at a full storehouse and unloads it once capacity is freed by a real build command', async () => {
    const clockStart = Date.now() + 60_000;
    const initialState = {
      resources: { wood: 3 },
      storage: { id: 'storehouse-1', anchor: { x: -6, y: -1 }, footprint: { width: 2, height: 1 }, woodCapacity: 3 },
      trees: [{ id: 'tree-1', name: 'Берёза', sourceKind: 'finite', position: { x: 3, y: 0 }, remaining: 2,
        maxRemaining: 3, state: 'standing', regrowthProgressTicks: 0, regrowthEveryTicks: WOOD_REGROWTH_TICKS }],
      residents: [
        { id: 'worker-1', name: 'Илья', appearanceKey: 'ilya', position: { x: -4, y: 0 }, facing: 'left',
          state: 'working', visualState: 'unloading', cargo: 1, blockedReason: null,
          task: { id: 'full-store-delivery', kind: 'gather-wood', phase: 'unloading', sourceId: 'tree-1',
            destinationId: 'storehouse-1', path: [], pathIndex: 0, progressTicks: 1, requiredTicks: 2,
            blockedReason: null, continuous: true, cancelAfterDelivery: false }
        },
        { id: 'worker-2', name: 'Марья', appearanceKey: 'maria', position: { x: 14, y: 0 }, facing: 'left',
          state: 'idle', visualState: 'idle', cargo: 0, blockedReason: null, task: null }
      ],
      buildings: []
    };
    const app = createV2Server(config, memoryDatabase(initialState, undefined, new Date(clockStart + 60_000)));
    apps.push(app);
    await app.tickSimulation(clockStart + 60_000 + 500);
    const waiting = await app.inject({ method: 'GET', url: '/api/world', headers: sessionCookie });
    expect(waiting.json().resources.wood).toBe(3);
    expect(waiting.json().residents[0].cargo).toBe(1);
    expect(waiting.json().residents[0].task.phase).toBe('waiting_storage');
    await app.tickSimulation(clockStart + 60_000 + 30 * 500);
    const stillWaiting = await app.inject({ method: 'GET', url: '/api/world', headers: sessionCookie });
    expect(stillWaiting.json().resources.wood).toBe(3);
    expect(stillWaiting.json().residents[0].cargo).toBe(1);
    expect(stillWaiting.json().residents[0].task.phase).toBe('waiting_storage');

    const build = await app.inject({
      method: 'POST', url: '/api/commands', headers: sessionCookie,
      payload: {
        requestId: 'free-storage-with-cabin', expectedWorldVersion: stillWaiting.json().revision.worldVersion,
        expectedGeometryVersion: stillWaiting.json().revision.geometryVersion,
        kind: 'build-cabin', residentId: 'worker-2', anchor: { x: 10, y: -1 }
      }
    });
    expect(build.statusCode).toBe(200);
    expect(build.json().resources.wood).toBe(0);
    await app.tickSimulation(clockStart + 60_000 + 32 * 500);
    const resumed = await app.inject({ method: 'GET', url: '/api/world', headers: sessionCookie });
    expect(resumed.json().resources.wood).toBe(1);
    expect(resumed.json().residents[0].cargo).toBe(0);
    expect(resumed.json().residents[0].task.phase).toBe('walking_to_source');
    expect(resumed.json().buildings[0].reservedWood).toBe(3);
  });

  it('keeps an uprooted stump permanent after API restart and elapsed regrowth time', async () => {
    const clockStart = Date.now() + 60_000;
    const initialState = {
      resources: { wood: 1 },
      storage: { id: 'storehouse-1', anchor: { x: -6, y: -1 }, footprint: { width: 2, height: 1 }, woodCapacity: 100 },
      trees: [{ id: 'tree-1', name: 'Берёза', sourceKind: 'finite', position: { x: 3, y: 0 }, remaining: 0,
        maxRemaining: 3, state: 'stump', regrowthProgressTicks: 99, regrowthEveryTicks: WOOD_REGROWTH_TICKS }],
      residents: [
        { id: 'worker-1', name: 'Илья', appearanceKey: 'ilya', position: { x: -3, y: 0 }, facing: 'right',
          state: 'idle', visualState: 'idle', cargo: 0, blockedReason: null, task: null },
        { id: 'worker-2', name: 'Марья', appearanceKey: 'maria', position: { x: 14, y: 0 }, facing: 'left',
          state: 'idle', visualState: 'idle', cargo: 0, blockedReason: null, task: null }
      ],
      buildings: []
    };
    const database = memoryDatabase(initialState, undefined, new Date(clockStart + 60_000));
    const firstApi = createV2Server(config, database);
    apps.push(firstApi);
    const uproot = await firstApi.inject({
      method: 'POST', url: '/api/commands', headers: sessionCookie,
      payload: {
        requestId: 'uproot-tree-1', expectedWorldVersion: 1, expectedGeometryVersion: 1,
        kind: 'uproot-stump', residentId: 'worker-1', treeId: 'tree-1'
      }
    });
    expect(uproot.statusCode).toBe(200);
    expect(uproot.json().trees[0]).toMatchObject({ state: 'uprooted', remaining: 0, regrowthProgressTicks: 0 });
    apps.splice(apps.indexOf(firstApi), 1);
    await firstApi.close();
    const restartedApi = createV2Server(config, database);
    apps.push(restartedApi);
    await restartedApi.tickSimulation(clockStart + 60_000 + WOOD_REGROWTH_TICKS * 500);
    const afterRestart = await restartedApi.inject({ method: 'GET', url: '/api/world', headers: sessionCookie });
    expect(afterRestart.json().trees[0]).toMatchObject({ state: 'uprooted', remaining: 0 });
    expect(afterRestart.json().revision.geometryVersion).toBe(uproot.json().revision.geometryVersion);
  });

  it('reports invalid saved state separately from database failure without exposing it', async () => {
    const app = createV2Server(config, memoryDatabase({
      storage: { id: 'storehouse-1', anchor: { x: -6, y: -1 }, footprint: { width: 2, height: 1 }, woodCapacity: 100 },
      trees: [{ id: 'tree-1', name: 'Берёза', sourceKind: 'finite', position: { x: 3, y: 0 }, remaining: 2,
        maxRemaining: 3, state: 'standing', regrowthProgressTicks: 0, regrowthEveryTicks: 100 }],
      resources: { wood: 'private-invalid-value' },
      residents: [
        { id: 'worker-1', name: 'Илья', appearanceKey: 'ilya', position: { x: -3, y: 0 }, facing: 'right',
          state: 'idle', visualState: 'idle', cargo: 0, blockedReason: null, task: null },
        { id: 'worker-2', name: 'Марья', appearanceKey: 'maria', position: { x: 14, y: 0 }, facing: 'left',
          state: 'idle', visualState: 'idle', cargo: 0, blockedReason: null, task: null }
      ],
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
