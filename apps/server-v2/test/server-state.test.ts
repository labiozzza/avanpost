import { afterEach, describe, expect, it } from 'vitest';
import { loadV2Config } from '../src/config.js';
import { createV2Server, type V2HealthDatabase } from '../src/server.js';
import { createWorldScenario } from '../src/testing/world-scenarios.js';
import { COPPICE_REGROWTH_TICKS, G33_STONE_BALANCE, WOOD_REGROWTH_TICKS } from '@avanpost/peace-v2-sim';
import type { PeaceWorldSnapshot } from '@avanpost/peace-v2-shared';

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
  let state = structuredClone(initialState) as PeaceWorldSnapshot;
  state.resources.stone ??= 0;
  const storage = state.storage as unknown as Record<string, unknown>;
  storage.capacity ??= storage.woodCapacity ?? 100;
  delete storage.woodCapacity;
  state.stoneDeposits ??= [{
    id: G33_STONE_BALANCE.stoneNode.id, name: 'Каменная жила', sourceKind: 'finite',
    position: { x: G33_STONE_BALANCE.stoneNode.dx, y: G33_STONE_BALANCE.stoneNode.dy },
    remaining: G33_STONE_BALANCE.stoneNode.initialAmount,
    maxRemaining: G33_STONE_BALANCE.stoneNode.initialAmount,
    bufferQuantity: 0,
    bufferCapacity: G33_STONE_BALANCE.stoneNode.bufferCapacity,
    reservedBuffer: 0,
    yieldPerTick: G33_STONE_BALANCE.stoneNode.yieldPerTick,
    state: 'available'
  }];
  state.buildOrders ??= [];
  state.nextBuildOrderSequence ??= 1;
  for (const resident of state.residents) {
    resident.workRole ??= 'none';
    resident.cargoItemId ??= resident.cargo > 0 ? 'wood' : null;
    if (resident.task?.kind === 'gather-wood') resident.task.assignmentSource ??= 'manual';
  }
  for (const [index, building] of state.buildings.entries()) {
    building.reservedStone ??= 0;
    const assignedResident = state.residents.find((resident) =>
      (resident.task?.kind === 'build-cabin' || resident.task?.kind === 'build-workshop') &&
      resident.task.buildingId === building.id);
    const orderId = building.orderId ?? ((assignedResident?.task?.kind === 'build-cabin' || assignedResident?.task?.kind === 'build-workshop')
      ? assignedResident.task.orderId : undefined) ?? `test-order-${building.id}`;
    building.orderId = orderId;
    if (assignedResident?.task?.kind === 'build-cabin' || assignedResident?.task?.kind === 'build-workshop') {
      assignedResident.task.orderId = orderId;
    }
    if (!state.buildOrders.some((order) => order.id === orderId)) {
      state.buildOrders.push({
        id: orderId,
        buildingId: building.id,
        queuePosition: index,
        status: building.state === 'complete' ? 'completed'
          : building.state === 'cancelled' ? 'cancelled'
            : assignedResident ? 'in_progress'
              : building.state === 'waiting_materials' ? 'waiting_materials' : 'waiting_builder',
        assignedResidentId: assignedResident?.id ?? null,
        blockedReason: null
      });
    }
  }
  state.nextBuildOrderSequence = Math.max(state.nextBuildOrderSequence, ...state.buildOrders.map((order) => order.queuePosition + 1));
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
        state = JSON.parse(String(sql.includes('last_simulated_at') ? values[4] : values[3])) as PeaceWorldSnapshot;
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

  it('autonomously dispatches a role-builder while the other resident safely finishes delivery', async () => {
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
          state: 'idle', workRole: 'builder', visualState: 'idle', cargo: 0, blockedReason: null, task: null
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
        anchor: { x: 10, y: -1 }
      }
    });

    expect(carrierBuild.statusCode).toBe(200);
    expect(carrierBuild.json().residents[0].task.phase).toBe('carrying_to_storage');
    expect(carrierBuild.json().residents[1].task).toMatchObject({ kind: 'build-cabin' });
    expect(carrierBuild.json().buildOrders[0]).toMatchObject({ status: 'in_progress', assignedResidentId: 'worker-2' });
    expect(carrierBuild.json().buildOrders[0].requiresExplicitBuilder ?? false).toBe(false);
    expect(carrierBuild.json().resources.wood).toBe(0);
    expect(carrierBuild.json().buildings[0].reservedWood).toBe(3);
    expect(carrierBuild.json().residents[1].task).toMatchObject({ kind: 'build-cabin', orderId: carrierBuild.json().buildOrders[0].id });
    const deliver = await app.inject({
      method: 'POST',
      url: '/api/commands',
      headers: sessionCookie,
      payload: {
        requestId: 'deliver-after-rejected-build',
        expectedWorldVersion: carrierBuild.json().revision.worldVersion,
        expectedGeometryVersion: carrierBuild.json().revision.geometryVersion,
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
    expect(savedWorld.json().residents[1].task).toMatchObject({ kind: 'build-cabin' });
    expect(savedWorld.json().buildOrders[0]).toMatchObject({ status: 'in_progress', assignedResidentId: 'worker-2' });
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
          state: 'idle', workRole: 'none', visualState: 'idle', cargo: 0, blockedReason: null, task: null }
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
          state: 'idle', workRole: 'none', visualState: 'idle', cargo: 0, blockedReason: null, task: null }
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
          state: 'idle', workRole: 'none', visualState: 'idle', cargo: 0, blockedReason: null, task: null }
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
    const queuedBuild = await app.inject({
      method: 'POST', url: '/api/commands', headers: sessionCookie,
      payload: {
        requestId: 'same-worker-second-task', expectedWorldVersion: second.json().revision.worldVersion,
        expectedGeometryVersion: 1, kind: 'build-cabin', residentId: 'worker-1', anchor: { x: 10, y: -1 }
      }
    });
    expect(queuedBuild.statusCode).toBe(200);
    expect(queuedBuild.json().residents[0].task.kind).toBe('gather-wood');
    expect(queuedBuild.json().buildOrders[0]).toMatchObject({ status: 'waiting_builder', assignedResidentId: null });

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
          state: 'idle', workRole: 'builder', visualState: 'idle', cargo: 0, blockedReason: null, task: null }
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
    const assignment = await app.inject({
      method: 'POST', url: '/api/commands', headers: sessionCookie,
      payload: {
        requestId: 'assign-builder-to-free-storage-cabin',
        expectedWorldVersion: build.json().revision.worldVersion,
        expectedGeometryVersion: build.json().revision.geometryVersion,
        kind: 'assign-resident', residentId: 'worker-2',
        target: { kind: 'build-order', orderId: build.json().buildOrders[0].id }
      }
    });
    expect(assignment.statusCode).toBe(200);
    expect(assignment.json().resources.wood).toBe(0);
    expect(assignment.json().buildings[0].state).toBe('waiting_materials');
    expect(assignment.json().buildings[0].reservedWood).toBe(0);
    expect(assignment.json().buildOrders[0]).toMatchObject({ status: 'waiting_materials', assignedResidentId: 'worker-2' });
    expect(assignment.json().residents[1].task).toBeNull();

    const gather = await app.inject({
      method: 'POST', url: '/api/commands', headers: sessionCookie,
      payload: {
        requestId: 'gather-while-builder-waits', expectedWorldVersion: assignment.json().revision.worldVersion,
        expectedGeometryVersion: assignment.json().revision.geometryVersion,
        kind: 'collect-wood', residentId: 'worker-1', sourceId: 'tree-1'
      }
    });
    expect(gather.statusCode).toBe(200);
    expect(gather.json().residents[0].task.phase).toBe('walking_to_source');
    expect(gather.json().residents[1].task).toBeNull();
    expect(gather.json().buildOrders[0]).toMatchObject({ status: 'waiting_materials', assignedResidentId: 'worker-2' });
    await app.tickSimulation(lastSimulatedAt.getTime() + 10 * 500);
    const carrying = await app.inject({ method: 'GET', url: '/api/world', headers: sessionCookie });
    expect(carrying.json().residents[0].task.phase).toBe('carrying_to_storage');
    expect(carrying.json().residents[0].cargo).toBe(1);
    expect(carrying.json().residents[1].task).toBeNull();
    expect(carrying.json().buildOrders[0]).toMatchObject({ status: 'waiting_materials', assignedResidentId: 'worker-2' });
    expect(carrying.json().buildings[0].reservedWood).toBe(0);
    await app.tickSimulation(lastSimulatedAt.getTime() + 18 * 500);
    const unloaded = await app.inject({ method: 'GET', url: '/api/world', headers: sessionCookie });
    expect(unloaded.json().resources.wood).toBe(1);
    expect(unloaded.json().residents[0].task.phase).toBe('walking_to_source');
    expect(unloaded.json().residents[1].task).toBeNull();
    expect(unloaded.json().buildOrders[0]).toMatchObject({ status: 'waiting_materials', assignedResidentId: 'worker-2' });
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
          state: 'idle', workRole: 'builder', visualState: 'idle', cargo: 0, blockedReason: null, task: null }
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
          state: 'idle', workRole: 'builder', visualState: 'idle', cargo: 0, blockedReason: null, task: null }
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
    expect(build.json().buildOrders[0]).toMatchObject({ status: 'in_progress', assignedResidentId: 'worker-2' });
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

  it('keeps a manual gather task separate from the woodcutter role and resumes the role after cancellation', async () => {
    const clockStart = Date.now() + 60_000;
    const app = createV2Server(config, memoryDatabase({
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
    }, undefined, new Date(clockStart + 60_000)));
    apps.push(app);

    const role = await app.inject({
      method: 'POST', url: '/api/commands', headers: sessionCookie,
      payload: {
        requestId: 'set-woodcutter-role-0001', expectedWorldVersion: 1, expectedGeometryVersion: 1,
        kind: 'set-work-role', residentId: 'worker-1', workRole: 'woodcutter'
      }
    });
    expect(role.statusCode).toBe(200);
    expect(role.json().residents[0]).toMatchObject({
      workRole: 'woodcutter', task: { kind: 'gather-wood', assignmentSource: 'profession' }
    });

    const manual = await app.inject({
      method: 'POST', url: '/api/commands', headers: sessionCookie,
      payload: {
        requestId: 'override-woodcutter-role-0001', expectedWorldVersion: role.json().revision.worldVersion,
        expectedGeometryVersion: role.json().revision.geometryVersion,
        kind: 'collect-wood', residentId: 'worker-1'
      }
    });
    expect(manual.statusCode).toBe(200);
    expect(manual.json().residents[0]).toMatchObject({
      workRole: 'woodcutter', task: { kind: 'gather-wood', assignmentSource: 'manual' }
    });

    const cancel = await app.inject({
      method: 'POST', url: '/api/commands', headers: sessionCookie,
      payload: {
        requestId: 'restore-woodcutter-role-0001', expectedWorldVersion: manual.json().revision.worldVersion,
        expectedGeometryVersion: manual.json().revision.geometryVersion,
        kind: 'cancel-woodcutting', residentId: 'worker-1'
      }
    });
    expect(cancel.statusCode).toBe(200);
    expect(cancel.json().residents[0]).toMatchObject({
      workRole: 'woodcutter', task: { kind: 'gather-wood', assignmentSource: 'profession' }
    });
  });

  it('routes a builder-held log to the reordered cabin and resumes the next priority after API restart', async () => {
    const clockStart = Date.now() + 60_000;
    const initialState = {
      resources: { wood: 100 },
      storage: { id: 'storehouse-1', anchor: { x: -6, y: -1 }, footprint: { width: 2, height: 1 }, woodCapacity: 100 },
      trees: [
        { id: 'tree-1', name: 'Берёза', sourceKind: 'finite', position: { x: 3, y: 0 }, remaining: 3,
          maxRemaining: 3, state: 'standing', regrowthProgressTicks: 0, regrowthEveryTicks: WOOD_REGROWTH_TICKS },
        { id: 'tree-2', name: 'Роща', sourceKind: 'finite', position: { x: 8, y: 0 }, remaining: 3,
          maxRemaining: 3, state: 'standing', regrowthProgressTicks: 0, regrowthEveryTicks: WOOD_REGROWTH_TICKS }
      ],
      residents: [
        { id: 'worker-1', name: 'Илья', appearanceKey: 'ilya', position: { x: -4, y: 0 }, facing: 'right',
          state: 'waiting', workRole: 'woodcutter', visualState: 'waiting_storage', cargo: 1, blockedReason: 'STORAGE_FULL',
          task: { id: 'woodcutter-carry', kind: 'gather-wood', phase: 'waiting_storage', sourceId: 'tree-1',
            destinationId: 'storehouse-1', path: [], pathIndex: 0, progressTicks: 0, requiredTicks: 2,
            blockedReason: 'STORAGE_FULL', continuous: true, cancelAfterDelivery: false, assignmentSource: 'profession' }
        },
        { id: 'worker-2', name: 'Марья', appearanceKey: 'maria', position: { x: 14, y: 0 }, facing: 'left',
          state: 'waiting', workRole: 'none', visualState: 'waiting_storage', cargo: 1, blockedReason: 'STORAGE_FULL',
          task: { id: 'builder-carry', kind: 'gather-wood', phase: 'waiting_storage', sourceId: 'tree-2',
            destinationId: 'storehouse-1', path: [], pathIndex: 0, progressTicks: 0, requiredTicks: 2,
            blockedReason: 'STORAGE_FULL', continuous: true, cancelAfterDelivery: false, assignmentSource: 'manual' }
        }
      ],
      buildOrders: [], nextBuildOrderSequence: 1, buildings: []
    };
    const database = memoryDatabase(initialState, undefined, new Date(clockStart + 60_000));
    const firstApi = createV2Server(config, database);
    apps.push(firstApi);

    const createA = await firstApi.inject({
      method: 'POST', url: '/api/commands', headers: sessionCookie,
      payload: { requestId: 'priority-create-order-a', expectedWorldVersion: 1, expectedGeometryVersion: 1,
        kind: 'build-cabin', anchor: { x: 0, y: -1 } }
    });
    expect(createA.statusCode).toBe(200);
    const orderA = createA.json().buildOrders.find((order: { buildingId: string }) =>
      order.buildingId === 'cabin-priority-create-order-a');
    expect(orderA).toMatchObject({ status: 'waiting_builder', queuePosition: 1 });

    const createB = await firstApi.inject({
      method: 'POST', url: '/api/commands', headers: sessionCookie,
      payload: { requestId: 'priority-create-order-b',
        expectedWorldVersion: createA.json().revision.worldVersion,
        expectedGeometryVersion: createA.json().revision.geometryVersion,
        kind: 'build-cabin', anchor: { x: 12, y: -1 } }
    });
    expect(createB.statusCode).toBe(200);
    const orderB = createB.json().buildOrders.find((order: { buildingId: string }) =>
      order.buildingId === 'cabin-priority-create-order-b');
    expect(orderB).toMatchObject({ status: 'waiting_builder', queuePosition: 2 });

    const movePayload = {
      requestId: 'priority-move-order-b',
      expectedWorldVersion: createB.json().revision.worldVersion,
      expectedGeometryVersion: createB.json().revision.geometryVersion,
      kind: 'move-build-order', orderId: orderB.id, direction: 'up'
    };
    const moved = await firstApi.inject({ method: 'POST', url: '/api/commands', headers: sessionCookie, payload: movePayload });
    expect(moved.statusCode).toBe(200);
    expect(moved.json().buildOrders.find((order: { id: string }) => order.id === orderB.id)?.queuePosition).toBe(1);
    const replay = await firstApi.inject({ method: 'POST', url: '/api/commands', headers: sessionCookie, payload: movePayload });
    expect(replay.statusCode).toBe(200);
    expect(replay.json()).toEqual(moved.json());

    const role = await firstApi.inject({
      method: 'POST', url: '/api/commands', headers: sessionCookie,
      payload: { requestId: 'priority-set-builder', expectedWorldVersion: moved.json().revision.worldVersion,
        expectedGeometryVersion: moved.json().revision.geometryVersion,
        kind: 'set-work-role', residentId: 'worker-2', workRole: 'builder' }
    });
    expect(role.statusCode).toBe(200);
    expect(role.json().buildOrders.find((order: { id: string }) => order.id === orderB.id))
      .toMatchObject({ status: 'in_progress', assignedResidentId: 'worker-2', queuePosition: 1 });
    expect(role.json().buildOrders.find((order: { id: string }) => order.id === orderA.id))
      .toMatchObject({ status: 'waiting_builder', assignedResidentId: null, queuePosition: 2 });
    expect(role.json().resources.wood).toBe(98);
    expect(role.json().buildings.find((building: { id: string }) => building.id === orderB.buildingId)?.reservedWood).toBe(2);
    expect(role.json().residents.find((resident: { id: string }) => resident.id === 'worker-2'))
      .toMatchObject({ workRole: 'builder', cargo: 1,
        task: { kind: 'build-cabin', orderId: orderB.id, phase: 'carrying_materials_to_build' } });

    await firstApi.tickSimulation(clockStart + 60_000 + 2 * 500);
    const delivered = await firstApi.inject({ method: 'GET', url: '/api/world', headers: sessionCookie });
    expect(delivered.json().resources.wood).toBe(99);
    expect(delivered.json().buildings.find((building: { id: string }) => building.id === orderB.buildingId)?.reservedWood).toBe(3);
    expect(delivered.json().residents.find((resident: { id: string }) => resident.id === 'worker-2'))
      .toMatchObject({ cargo: 0, task: { kind: 'build-cabin', orderId: orderB.id, phase: 'building' } });

    apps.splice(apps.indexOf(firstApi), 1);
    await firstApi.close();
    const restartedApi = createV2Server(config, database);
    apps.push(restartedApi);
    await restartedApi.tickSimulation(clockStart + 60_000 + 13 * 500);
    const afterRestart = await restartedApi.inject({ method: 'GET', url: '/api/world', headers: sessionCookie });
    expect(afterRestart.json().buildOrders.find((order: { id: string }) => order.id === orderB.id))
      .toMatchObject({ status: 'completed', queuePosition: 1 });
    expect(afterRestart.json().buildOrders.find((order: { id: string }) => order.id === orderA.id))
      .toMatchObject({ status: 'in_progress', assignedResidentId: 'worker-2', requiresExplicitBuilder: false, queuePosition: 2 });
    expect(afterRestart.json().buildings.find((building: { id: string }) => building.id === orderA.buildingId)?.reservedWood).toBe(3);
    expect(afterRestart.json().residents.find((resident: { id: string }) => resident.id === 'worker-1'))
      .toMatchObject({ workRole: 'woodcutter', task: { kind: 'gather-wood' } });
  });

  it('keeps direct stone-to-workshop delivery when the miner changes role mid-route', async () => {
    const clockStart = Date.now() + 60_000;
    const app = createV2Server(config, memoryDatabase({
      resources: { wood: 89, stone: 0 },
      storage: { id: 'storehouse-1', anchor: { x: -6, y: -1 }, footprint: { width: 2, height: 1 }, capacity: 100 },
      trees: [
        { id: 'tree-1', name: 'Берёза', sourceKind: 'finite', position: { x: 3, y: 0 }, remaining: 3,
          maxRemaining: 3, state: 'standing', regrowthProgressTicks: 0, regrowthEveryTicks: WOOD_REGROWTH_TICKS }
      ],
      stoneDeposits: [{
        id: G33_STONE_BALANCE.stoneNode.id, name: 'Каменная жила', sourceKind: 'finite',
        position: { x: 5, y: 1 }, remaining: 582, maxRemaining: 600, bufferQuantity: 0,
        bufferCapacity: G33_STONE_BALANCE.stoneNode.bufferCapacity,
        yieldPerTick: G33_STONE_BALANCE.stoneNode.yieldPerTick, state: 'available'
      }],
      residents: [
        { id: 'worker-1', name: 'Илья', appearanceKey: 'ilya', position: { x: -13, y: 0 }, facing: 'right',
          state: 'working', workRole: 'stone_miner', visualState: 'carrying_stone_to_build', cargo: 18,
          cargoItemId: 'stone', blockedReason: null, task: {
            id: 'miner-delivering-to-site', kind: 'gather-stone', phase: 'carrying_to_build',
            sourceId: G33_STONE_BALANCE.stoneNode.id, destinationId: 'storehouse-1',
            path: Array.from({ length: 24 }, (_, index) => ({ x: -12 + index, y: 0 })), pathIndex: 0,
            progressTicks: 0, requiredTicks: 24, blockedReason: null, continuous: true,
            cancelAfterDelivery: false, assignmentSource: 'workRole', buildingId: 'workshop-live',
            orderId: 'workshop-order-live', deliveryQuantity: 6
          } },
        { id: 'worker-2', name: 'Марья', appearanceKey: 'maria', position: { x: 14, y: 0 }, facing: 'left',
          state: 'working', workRole: 'builder', visualState: 'carrying_materials_to_build', cargo: 1,
          cargoItemId: 'wood', blockedReason: null, task: {
            id: 'builder-delivering-to-site', kind: 'build-workshop', phase: 'carrying_materials_to_build',
            buildingId: 'workshop-live', orderId: 'workshop-order-live', path: [], pathIndex: 0,
            progressTicks: 0, requiredTicks: 1, blockedReason: null
          } }
      ],
      buildings: [{ id: 'workshop-live', kind: 'workshop', orderId: 'workshop-order-live',
        anchor: { x: 12, y: -1 }, footprint: { width: 2, height: 1 }, state: 'in_progress',
        progressTicks: 0, progressRequired: 10, reservedWood: 11, reservedStone: 0 }],
      buildOrders: [{ id: 'workshop-order-live', buildingId: 'workshop-live', queuePosition: 0,
        status: 'in_progress', assignedResidentId: 'worker-2', blockedReason: null }],
      nextBuildOrderSequence: 1
    }, { worldVersion: 1, geometryVersion: 1, serverTick: 0 }, new Date(clockStart + 60_000)));
    apps.push(app);

    const changedRole = await app.inject({
      method: 'POST', url: '/api/commands', headers: sessionCookie,
      payload: {
        requestId: 'change-miner-role-during-delivery', expectedWorldVersion: 1, expectedGeometryVersion: 1,
        kind: 'set-work-role', residentId: 'worker-1', workRole: 'none'
      }
    });
    expect(changedRole.statusCode).toBe(200);
    expect(changedRole.json().residents.find((resident: { id: string }) => resident.id === 'worker-1'))
      .toMatchObject({ workRole: 'none', cargo: 18, cargoItemId: 'stone', task: {
        kind: 'gather-stone', phase: 'carrying_to_build', buildingId: 'workshop-live',
        orderId: 'workshop-order-live', deliveryQuantity: 6, continuous: false, cancelAfterDelivery: true
      } });

    await app.tickSimulation(clockStart + 60_000 + 50 * 500);
    const completed = await app.inject({ method: 'GET', url: '/api/world', headers: sessionCookie });
    expect(completed.statusCode).toBe(200);
    expect(completed.json().buildOrders[0]).toMatchObject({ status: 'completed', assignedResidentId: null });
    expect(completed.json().buildings[0]).toMatchObject({ state: 'complete', reservedWood: 0, reservedStone: 0 });
    expect(completed.json().resources).toEqual({ wood: 89, stone: 11 });
    expect(completed.json().residents.find((resident: { id: string }) => resident.id === 'worker-1'))
      .toMatchObject({ workRole: 'none', cargo: 1, cargoItemId: 'stone', task: { kind: 'gather-stone', phase: 'waiting_storage' } });
    expect(completed.json().residents.find((resident: { id: string }) => resident.id === 'worker-2'))
      .toMatchObject({ workRole: 'builder', cargo: 0, task: null });
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

  it('assigns a resident to a physical warehouse and previews all warehouse stocks', async () => {
    const clockStart = Date.now() + 60_000;
    const fixture = createWorldScenario('g4-multi-storage');
    fixture.resources = { wood: 12, stone: 0 };
    fixture.storages![0]!.contents = { wood: 8, stone: 0 };
    fixture.storages![1]!.contents = { wood: 4, stone: 0 };
    fixture.storages![0]!.status = 'available';
    for (const resident of fixture.residents) {
      resident.workRole = 'none';
      resident.task = null;
      resident.cargo = 0;
      resident.cargoItemId = null;
      resident.state = 'idle';
      resident.visualState = 'idle';
      resident.blockedReason = null;
      resident.preferredStorageId = null;
      resident.preferredHaulSourceId = null;
    }
    for (const tree of fixture.trees) {
      tree.bufferQuantity = 0;
      tree.reservedBuffer = 0;
    }
    fixture.stoneDeposits[0]!.bufferQuantity = 0;
    fixture.stoneDeposits[0]!.reservedBuffer = 0;
    const database = memoryDatabase(fixture, undefined, new Date(clockStart + 60_000));
    const app = createV2Server(config, database);
    apps.push(app);

    const preview = await app.inject({ method: 'GET', url: '/api/world/preview' });
    expect(preview.statusCode).toBe(200);
    expect(preview.json().storages).toHaveLength(2);
    expect(preview.json().buildings.filter((building: { buildingId: string }) => building.buildingId === 'storehouse')).toHaveLength(2);

    const world = await app.inject({ method: 'GET', url: '/api/world', headers: sessionCookie });
    const assigned = await app.inject({
      method: 'POST', url: '/api/commands', headers: sessionCookie,
      payload: {
        requestId: 'assign-hauler-warehouse-0001', expectedWorldVersion: world.json().revision.worldVersion,
        expectedGeometryVersion: world.json().revision.geometryVersion,
        kind: 'assign-resident', residentId: 'worker-1', target: { kind: 'storage', storageId: 'storehouse-2' }
      }
    });
    expect(assigned.statusCode).toBe(200);
    expect(assigned.json().residents.find((resident: { id: string }) => resident.id === 'worker-1'))
      .toMatchObject({ workRole: 'hauler', preferredStorageId: 'storehouse-2' });
    expect(assigned.json().residents.filter((resident: { task?: { kind: string } | null }) => resident.task?.kind === 'haul')).toHaveLength(1);

    await app.tickSimulation(clockStart + 60_000 + 7 * 500);
    const midRoute = await app.inject({ method: 'GET', url: '/api/world', headers: sessionCookie });
    expect(midRoute.json().residents.find((resident: { id: string }) => resident.id === 'worker-1'))
      .toMatchObject({ cargo: 8, cargoItemId: 'wood', task: { kind: 'haul', phase: 'carrying', quantity: 8 } });
    expect(midRoute.json().storages.map((storage: { contents: { wood: number } }) => storage.contents.wood)).toEqual([0, 4]);

    const restartedApi = createV2Server(config, database);
    apps.push(restartedApi);
    const afterRestart = await restartedApi.inject({ method: 'GET', url: '/api/world', headers: sessionCookie });
    expect(afterRestart.json().residents.find((resident: { id: string }) => resident.id === 'worker-1'))
      .toMatchObject({ cargo: 8, cargoItemId: 'wood', task: { kind: 'haul', phase: 'carrying', quantity: 8 } });
    await restartedApi.tickSimulation(clockStart + 60_000 + 50 * 500);
    const delivered = await restartedApi.inject({ method: 'GET', url: '/api/world', headers: sessionCookie });
    expect(delivered.json().storages.map((storage: { contents: { wood: number } }) => storage.contents.wood)).toEqual([0, 12]);
    expect(delivered.json().resources).toEqual({ wood: 12, stone: 0 });
    expect(delivered.json().residents.find((resident: { id: string }) => resident.id === 'worker-1'))
      .toMatchObject({ cargo: 0, cargoItemId: null, task: null });
  });
});
