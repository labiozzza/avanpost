import { describe, expect, it } from 'vitest';
import type { PeaceWorldSnapshot } from '@avanpost/peace-v2-shared';
import {
  advanceSettlement,
  createBuildCabinTask,
  createGatherWoodTask,
  validateCabinPlacement,
  CABIN_BUILD_TICKS,
  WOOD_GATHER_TICKS
} from '../src/index.js';

function world(overrides: Partial<PeaceWorldSnapshot> = {}): PeaceWorldSnapshot {
  return {
    revision: { worldVersion: 1, geometryVersion: 1, serverTick: 0 },
    resources: { wood: 1 },
    storage: { id: 'storehouse-1', anchor: { x: -6, y: -1 }, footprint: { width: 2, height: 1 } },
    tree: { id: 'tree-1', position: { x: 3, y: 0 }, remaining: 3 },
    worker: {
      id: 'worker-1', name: 'Илья', position: { x: -3, y: 0 }, visualState: 'idle', cargo: 0, task: null
    },
    buildings: [],
    ...overrides
  };
}

describe('server settlement simulation', () => {
  it('advances idle server time without staling a command snapshot', () => {
    const initial = world();
    const next = advanceSettlement(initial, 12);
    expect(next.revision.serverTick).toBe(12);
    expect(next.revision.worldVersion).toBe(initial.revision.worldVersion);
    expect(next.resources).toEqual(initial.resources);
  });

  it('only starts gathering on arrival and adds wood after loading, travel and unloading', () => {
    const initial = world();
    const task = createGatherWoodTask(initial, 'task-wood-1');
    expect(task).not.toBeNull();
    if (!task) return;
    expect(task.phase).toBe('walking_to_source');
    expect(initial.tree.remaining).toBe(3);
    expect(initial.resources.wood).toBe(1);

    let state = world({ worker: { ...initial.worker, task, visualState: task.phase } });
    const toSource = task.path.length;
    state = advanceSettlement(state, toSource);
    expect(state.worker.position).toEqual({ x: 2, y: 0 });
    expect(state.worker.task?.phase).toBe('gathering');
    expect(state.tree.remaining).toBe(3);
    expect(state.worker.cargo).toBe(0);

    state = advanceSettlement(state, WOOD_GATHER_TICKS);
    expect(state.worker.task?.phase).toBe('loading');
    expect(state.tree.remaining).toBe(3);
    expect(state.resources.wood).toBe(1);
    state = advanceSettlement(state, 1);
    expect(state.worker.task?.phase).toBe('carrying_to_storage');
    expect(state.tree.remaining).toBe(2);
    expect(state.worker.cargo).toBe(1);
    expect(state.resources.wood).toBe(1);

    const routeToStorage = state.worker.task!.path.length;
    state = advanceSettlement(state, routeToStorage);
    expect(state.worker.task?.phase).toBe('unloading');
    expect(state.worker.cargo).toBe(1);
    expect(state.resources.wood).toBe(1);
    state = advanceSettlement(state, 1);
    expect(state.resources.wood).toBe(1);
    state = advanceSettlement(state, 1);
    expect(state.resources.wood).toBe(2);
    expect(state.worker.cargo).toBe(0);
    expect(state.worker.task).toBeNull();
    expect(state.worker.visualState).toBe('idle');
  });

  it('preserves progress across snapshots and does not move when blocked', () => {
    const initial = world();
    const task = createGatherWoodTask(initial, 'task-wood-2')!;
    let state = advanceSettlement(world({ worker: { ...initial.worker, task, visualState: task.phase } }), 2);
    expect(state.worker.position).toEqual({ x: -1, y: 0 });
    expect(state.worker.task?.pathIndex).toBe(2);
    expect(state.tree.remaining).toBe(3);

    state = {
      ...state,
      worker: {
        ...state.worker,
        visualState: 'waiting_path',
        task: { ...state.worker.task!, phase: 'waiting_path', blockedReason: 'NO_PATH_TO_STORAGE' }
      }
    };
    const blocked = advanceSettlement(state, 40);
    expect(blocked.worker.position).toEqual(state.worker.position);
    expect(blocked.worker.cargo).toBe(state.worker.cargo);
    expect(blocked.tree.remaining).toBe(state.tree.remaining);
    expect(blocked.worker.task?.phase).toBe('waiting_path');
    expect(blocked.revision.serverTick).toBe(state.revision.serverTick + 40);
  });

  it('validates exact cabin placement and rejects overlap, invalid surface and missing resources', () => {
    const ready = world({ resources: { wood: 3 } });
    expect(validateCabinPlacement(ready, { x: 8, y: -1 }).reason).toBe('READY');
    expect(validateCabinPlacement(ready, { x: -6, y: -1 }).reason).toBe('OCCUPIED');
    expect(validateCabinPlacement(ready, { x: 3, y: -1 }).reason).toBe('OCCUPIED');
    expect(validateCabinPlacement(ready, { x: 8, y: 0 }).reason).toBe('INVALID_SURFACE');
    expect(validateCabinPlacement(world(), { x: 8, y: -1 }).reason).toBe('RESOURCE_MISSING');
    expect(validateCabinPlacement(world({ worker: { ...ready.worker, task: createGatherWoodTask(ready, 'busy') } }),
      { x: 8, y: -1 }).reason).toBe('WORKER_BUSY');
  });

  it('builds at the confirmed anchor through persisted foundation and scaffold stages', () => {
    const initial = world({ resources: { wood: 3 } });
    const anchor = { x: 8, y: -1 };
    const buildingId = 'cabin-chosen-8';
    const task = createBuildCabinTask(initial, 'task-build-1', buildingId, anchor);
    expect(task).not.toBeNull();
    if (!task) return;
    let state = world({
      resources: { wood: 0 },
      worker: { ...initial.worker, task, visualState: task.phase },
      buildings: [{
        id: buildingId,
        kind: 'cabin',
        anchor,
        footprint: { width: 2, height: 1 },
        state: 'planned',
        progressTicks: 0,
        progressRequired: CABIN_BUILD_TICKS,
        reservedWood: 3
      }]
    });
    state = advanceSettlement(state, task.path.length);
    expect(state.worker.position).toEqual({ x: 7, y: 0 });
    expect(state.worker.task?.phase).toBe('building');
    state = advanceSettlement(state, 2);
    expect(state.buildings[0]?.state).toBe('foundation');
    state = advanceSettlement(state, 1);
    expect(state.buildings[0]?.state).toBe('scaffold');
    state = advanceSettlement(state, CABIN_BUILD_TICKS - 3);
    expect(state.buildings[0]?.anchor).toEqual(anchor);
    expect(state.buildings[0]?.state).toBe('complete');
    expect(state.buildings[0]?.reservedWood).toBe(0);
    expect(state.worker.task).toBeNull();
  });
});
