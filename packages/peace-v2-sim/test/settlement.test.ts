import { describe, expect, it } from 'vitest';
import type { PeaceTreeNode, PeaceWorldSnapshot } from '@avanpost/peace-v2-shared';
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
    trees: [
      tree('tree-1', 3, 3),
      tree('tree-2', 8, 3),
      tree('tree-3', -12, 3),
      tree('coppice-1', 16, 1, 'renewable_plot', 1200)
    ],
    worker: {
      id: 'worker-1', name: 'Илья', position: { x: -3, y: 0 }, visualState: 'idle', cargo: 0, task: null
    },
    buildings: [],
    ...overrides
  };
}

function tree(
  id: string,
  x: number,
  remaining: number,
  sourceKind: PeaceTreeNode['sourceKind'] = 'finite',
  regrowthEveryTicks: number | null = null
): PeaceTreeNode {
  return {
    id,
    name: id,
    sourceKind,
    position: { x, y: 0 },
    remaining,
    maxRemaining: sourceKind === 'renewable_plot' ? 1 : 3,
    state: remaining > 0 ? 'standing' : 'stump',
    regrowthProgressTicks: 0,
    regrowthEveryTicks
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
    const task = createGatherWoodTask(initial, 'task-wood-1', 'tree-1');
    expect(task).not.toBeNull();
    if (!task) return;
    expect(task.phase).toBe('walking_to_source');
    expect(initial.trees[0]?.remaining).toBe(3);
    expect(initial.resources.wood).toBe(1);

    let state = world({ worker: { ...initial.worker, task, visualState: task.phase } });
    const toSource = task.path.length;
    state = advanceSettlement(state, toSource);
    expect(state.worker.position).toEqual({ x: 2, y: 0 });
    expect(state.worker.task?.phase).toBe('gathering');
    expect(state.trees[0]?.remaining).toBe(3);
    expect(state.worker.cargo).toBe(0);

    state = advanceSettlement(state, WOOD_GATHER_TICKS);
    expect(state.worker.task?.phase).toBe('loading');
    expect(state.trees[0]?.remaining).toBe(3);
    expect(state.resources.wood).toBe(1);
    state = advanceSettlement(state, 1);
    expect(state.worker.task?.phase).toBe('carrying_to_storage');
    expect(state.trees[0]?.remaining).toBe(2);
    expect(state.trees[0]?.state).toBe('standing');
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
    const task = createGatherWoodTask(initial, 'task-wood-2', 'tree-1')!;
    let state = advanceSettlement(world({ worker: { ...initial.worker, task, visualState: task.phase } }), 2);
    expect(state.worker.position).toEqual({ x: -1, y: 0 });
    expect(state.worker.task?.pathIndex).toBe(2);
    expect(state.trees[0]?.remaining).toBe(3);

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
    expect(blocked.trees[0]?.remaining).toBe(state.trees[0]?.remaining);
    expect(blocked.worker.task?.phase).toBe('waiting_path');
    expect(blocked.revision.serverTick).toBe(state.revision.serverTick + 40);
  });

  it('validates exact cabin placement and rejects overlap, invalid surface and missing resources', () => {
    const ready = world({ resources: { wood: 3 } });
    expect(validateCabinPlacement(ready, { x: 4, y: -1 }).reason).toBe('READY');
    expect(validateCabinPlacement(ready, { x: -6, y: -1 }).reason).toBe('OCCUPIED');
    expect(validateCabinPlacement(ready, { x: 3, y: -1 }).reason).toBe('OCCUPIED');
    expect(validateCabinPlacement(ready, { x: 8, y: -1 }).reason).toBe('OCCUPIED');
    expect(validateCabinPlacement(ready, { x: 4, y: 0 }).reason).toBe('INVALID_SURFACE');
    expect(validateCabinPlacement(world(), { x: 4, y: -1 }).reason).toBe('RESOURCE_MISSING');
    expect(validateCabinPlacement(world({ worker: { ...ready.worker, task: createGatherWoodTask(ready, 'busy', 'tree-1') } }),
      { x: 4, y: -1 }).reason).toBe('WORKER_BUSY');
  });

  it('rejects an exhausted node and regenerates only one coppice log after its slow server interval', () => {
    const exhausted = tree('tree-1', 3, 0);
    expect(createGatherWoodTask(world({ trees: [exhausted] }), 'exhausted-order', exhausted.id)).toBeNull();

    let state = world({ trees: [tree('coppice-1', 16, 0, 'renewable_plot', 1200)] });
    state = advanceSettlement(state, 1199);
    expect(state.trees[0]?.state).toBe('stump');
    expect(state.trees[0]?.remaining).toBe(0);
    expect(state.resources.wood).toBe(1);
    state = advanceSettlement(state, 1);
    expect(state.trees[0]?.state).toBe('standing');
    expect(state.trees[0]?.remaining).toBe(1);
    const regrown = createGatherWoodTask(state, 'regrown-order', 'coppice-1');
    expect(regrown).not.toBeNull();
    if (regrown) {
      state.worker.task = regrown;
      state.worker.visualState = regrown.phase;
      state = advanceSettlement(state, regrown.path.length + 4 + 1);
      expect(state.trees[0]?.state).toBe('stump');
      expect(state.trees[0]?.remaining).toBe(0);
      expect(state.resources.wood).toBe(1);
    }
  });

  it('builds at the confirmed anchor through persisted foundation and scaffold stages', () => {
    const initial = world({ resources: { wood: 3 } });
    const anchor = { x: 4, y: -1 };
    const buildingId = 'cabin-chosen-4';
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
    expect(state.worker.position).toEqual({ x: 3, y: 0 });
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
