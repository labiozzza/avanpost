import { describe, expect, it } from 'vitest';
import type { PeaceResident, PeaceTreeNode, PeaceWorldSnapshot } from '@avanpost/peace-v2-shared';
import {
  advanceSettlement,
  createBuildCabinTask,
  createGatherWoodTask,
  validateCabinPlacement,
  CABIN_BUILD_TICKS,
  WOOD_GATHER_TICKS,
  WOOD_LOADING_TICKS,
  WOOD_UNLOADING_TICKS,
  WOOD_REGROWTH_TICKS,
  COPPICE_REGROWTH_TICKS
} from '../src/index.js';

function world(overrides: Partial<PeaceWorldSnapshot> = {}): PeaceWorldSnapshot {
  return {
    revision: { worldVersion: 1, geometryVersion: 1, serverTick: 0 },
    resources: { wood: 1 },
    storage: { id: 'storehouse-1', anchor: { x: -6, y: -1 }, footprint: { width: 2, height: 1 }, woodCapacity: 100 },
    trees: [
      tree('tree-1', 3, 3),
      tree('tree-2', 8, 3),
      tree('tree-3', -12, 3),
      tree('coppice-1', 16, 1, 'renewable_plot', COPPICE_REGROWTH_TICKS)
    ],
    residents: [resident('worker-1', 'Илья', -3, 'right', 'ilya'), resident('worker-2', 'Марья', 14, 'left', 'maria')],
    buildings: [],
    ...overrides
  };
}

function resident(id: string, name: string, x: number, facing: PeaceResident['facing'], appearanceKey: string): PeaceResident {
  return {
    id, name, appearanceKey, position: { x, y: 0 }, facing, state: 'idle', visualState: 'idle',
    cargo: 0, blockedReason: null, task: null
  };
}

function residentAt(current: PeaceWorldSnapshot, id: string): PeaceResident {
  const found = current.residents.find((candidate) => candidate.id === id);
  if (!found) throw new Error(`Resident ${id} is missing in test fixture.`);
  return found;
}

function tree(
  id: string,
  x: number,
  remaining: number,
  sourceKind: PeaceTreeNode['sourceKind'] = 'finite',
  regrowthEveryTicks: number | null = WOOD_REGROWTH_TICKS
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
    const task = createGatherWoodTask(initial, 'worker-1', 'task-wood-1', 'tree-1');
    expect(task).not.toBeNull();
    if (!task) return;
    expect(task.phase).toBe('walking_to_source');
    expect(initial.trees[0]?.remaining).toBe(3);
    expect(initial.resources.wood).toBe(1);

    let state = world({ residents: [
      { ...residentAt(initial, 'worker-1'), task, state: 'working', visualState: task.phase }, residentAt(initial, 'worker-2')
    ] });
    const toSource = task.path.length;
    state = advanceSettlement(state, toSource);
    expect(residentAt(state, 'worker-1').position).toEqual({ x: 2, y: 0 });
    expect(residentAt(state, 'worker-1').task?.phase).toBe('gathering');
    expect(state.trees[0]?.remaining).toBe(3);
    expect(residentAt(state, 'worker-1').cargo).toBe(0);

    state = advanceSettlement(state, WOOD_GATHER_TICKS);
    expect(residentAt(state, 'worker-1').task?.phase).toBe('loading');
    expect(state.trees[0]?.remaining).toBe(3);
    expect(state.resources.wood).toBe(1);
    state = advanceSettlement(state, 1);
    expect(residentAt(state, 'worker-1').task?.phase).toBe('carrying_to_storage');
    expect(state.trees[0]?.remaining).toBe(2);
    expect(state.trees[0]?.state).toBe('standing');
    expect(residentAt(state, 'worker-1').cargo).toBe(1);
    expect(state.resources.wood).toBe(1);

    const routeToStorage = residentAt(state, 'worker-1').task!.path.length;
    state = advanceSettlement(state, routeToStorage);
    expect(residentAt(state, 'worker-1').task?.phase).toBe('unloading');
    expect(residentAt(state, 'worker-1').cargo).toBe(1);
    expect(state.resources.wood).toBe(1);
    state = advanceSettlement(state, 1);
    expect(state.resources.wood).toBe(1);
    state = advanceSettlement(state, 1);
    expect(state.resources.wood).toBe(2);
    expect(residentAt(state, 'worker-1').cargo).toBe(0);
    expect(residentAt(state, 'worker-1').task).toMatchObject({
      kind: 'gather-wood', continuous: true, phase: 'walking_to_source', sourceId: 'tree-1'
    });
  });

  it('preserves progress across snapshots and does not move when blocked', () => {
    const initial = world();
    const task = createGatherWoodTask(initial, 'worker-1', 'task-wood-2', 'tree-1')!;
    let state = advanceSettlement(world({ residents: [
      { ...residentAt(initial, 'worker-1'), task, state: 'working', visualState: task.phase }, residentAt(initial, 'worker-2')
    ] }), 2);
    expect(residentAt(state, 'worker-1').position).toEqual({ x: -1, y: 0 });
    expect(residentAt(state, 'worker-1').task?.pathIndex).toBe(2);
    expect(state.trees[0]?.remaining).toBe(3);

    state = {
      ...state,
      residents: [
        { ...residentAt(state, 'worker-1'), state: 'waiting', visualState: 'waiting_path',
          task: { ...residentAt(state, 'worker-1').task!, phase: 'waiting_path', blockedReason: 'NO_PATH_TO_STORAGE' } },
        residentAt(state, 'worker-2')
      ]
    };
    const blocked = advanceSettlement(state, 40);
    expect(residentAt(blocked, 'worker-1').position).toEqual(residentAt(state, 'worker-1').position);
    expect(residentAt(blocked, 'worker-1').cargo).toBe(residentAt(state, 'worker-1').cargo);
    expect(blocked.trees[0]?.remaining).toBe(state.trees[0]?.remaining);
    expect(residentAt(blocked, 'worker-1').task?.phase).toBe('waiting_path');
    expect(blocked.revision.serverTick).toBe(state.revision.serverTick + 40);
  });

  it('validates exact cabin placement and rejects overlap, invalid surface and missing resources', () => {
    const ready = world({ resources: { wood: 3 } });
    expect(validateCabinPlacement(ready, { x: 4, y: -1 }, 'worker-1').reason).toBe('READY');
    expect(validateCabinPlacement(ready, { x: -6, y: -1 }, 'worker-1').reason).toBe('OCCUPIED');
    expect(validateCabinPlacement(ready, { x: 3, y: -1 }, 'worker-1').reason).toBe('OCCUPIED');
    expect(validateCabinPlacement(ready, { x: 8, y: -1 }, 'worker-1').reason).toBe('OCCUPIED');
    expect(validateCabinPlacement(ready, { x: 4, y: 0 }, 'worker-1').reason).toBe('INVALID_SURFACE');
    expect(validateCabinPlacement(world(), { x: 4, y: -1 }, 'worker-1').reason).toBe('WAITING_MATERIALS');
    const busyTask = createGatherWoodTask(ready, 'worker-1', 'busy', 'tree-1');
    expect(validateCabinPlacement(world({ residents: [
      { ...residentAt(ready, 'worker-1'), task: busyTask, state: 'working', visualState: busyTask!.phase }, residentAt(ready, 'worker-2')
    ] }), { x: 4, y: -1 }, 'worker-1').reason).toBe('WORKER_BUSY');
  });

  it('regrows each ordinary tree one log per configured interval until it reaches its mature capacity', () => {
    let state = world({ trees: [tree('tree-1', 3, 0)] });
    state = advanceSettlement(state, WOOD_REGROWTH_TICKS - 1);
    expect(state.trees[0]).toMatchObject({ state: 'stump', remaining: 0, regrowthProgressTicks: 99 });
    state = advanceSettlement(state, 1);
    expect(state.trees[0]).toMatchObject({ state: 'standing', remaining: 1, regrowthProgressTicks: 0 });
    state = advanceSettlement(state, WOOD_REGROWTH_TICKS);
    expect(state.trees[0]).toMatchObject({ state: 'standing', remaining: 2 });
    state = advanceSettlement(state, WOOD_REGROWTH_TICKS);
    expect(state.trees[0]).toMatchObject({ state: 'standing', remaining: 3 });
    expect(createGatherWoodTask(state, 'worker-1', 'regrown-tree-order', 'tree-1')?.sourceId).toBe('tree-1');
  });

  it('keeps an auto-woodcutting order waiting for regrowth and resumes it without a new command', () => {
    const treeNode = tree('tree-1', 3, 0);
    const initial = world({ trees: [treeNode] });
    const task = createGatherWoodTask(initial, 'worker-1', 'waiting-auto-work', 'tree-1')!;
    expect(task.phase).toBe('waiting_resource');
    expect(task.blockedReason).toBe('NO_AVAILABLE_TREES');
    let state = world({ trees: [treeNode], residents: [
      { ...residentAt(initial, 'worker-1'), task, state: 'waiting', visualState: task.phase }, residentAt(initial, 'worker-2')
    ] });
    state = advanceSettlement(state, WOOD_REGROWTH_TICKS - 1);
    expect(residentAt(state, 'worker-1').task?.phase).toBe('waiting_resource');
    state = advanceSettlement(state, 1);
    expect(state.trees[0]?.remaining).toBe(1);
    expect(residentAt(state, 'worker-1').task?.phase).toBe('walking_to_source');
    expect(residentAt(state, 'worker-1').task).toMatchObject({ kind: 'gather-wood', sourceId: 'tree-1' });
  });

  it('chooses the next nearest tree automatically after the current tree is exhausted', () => {
    const initial = world({ resources: { wood: 0 }, trees: [
      tree('tree-near', 3, 1), tree('tree-next', 8, 3)
    ] });
    const task = createGatherWoodTask(initial, 'worker-1', 'continuous-order')!;
    expect(task.sourceId).toBe('tree-near');
    let state = world({ resources: { wood: 0 }, trees: initial.trees, residents: [
      { ...residentAt(initial, 'worker-1'), task, state: 'working', visualState: task.phase }, residentAt(initial, 'worker-2')
    ] });

    state = advanceSettlement(state, task.path.length + WOOD_GATHER_TICKS + WOOD_LOADING_TICKS + 6 + WOOD_UNLOADING_TICKS);
    expect(state.trees[0]).toMatchObject({ state: 'stump', remaining: 0 });
    expect(state.resources.wood).toBe(1);
    expect(residentAt(state, 'worker-1').cargo).toBe(0);
    expect(residentAt(state, 'worker-1').task).toMatchObject({
      kind: 'gather-wood', continuous: true, phase: 'walking_to_source', sourceId: 'tree-next'
    });
  });

  it('assigns concurrent woodcutters distinct nearest targets and harvests each source once', () => {
    const initial = world();
    const firstTask = createGatherWoodTask(initial, 'worker-1', 'auto-wood-1')!;
    const firstAssigned = world({ residents: [
      { ...residentAt(initial, 'worker-1'), task: firstTask, state: 'working', visualState: firstTask.phase },
      residentAt(initial, 'worker-2')
    ] });
    const secondTask = createGatherWoodTask(firstAssigned, 'worker-2', 'auto-wood-2')!;
    expect(firstTask.sourceId).toBe('tree-1');
    expect(secondTask.sourceId).toBe('coppice-1');
    const state = advanceSettlement(world({ residents: [
      { ...residentAt(initial, 'worker-1'), task: firstTask, state: 'working', visualState: firstTask.phase },
      { ...residentAt(initial, 'worker-2'), task: secondTask, state: 'working', visualState: secondTask.phase }
    ] }), 11);
    expect(state.trees.find((treeNode) => treeNode.id === 'tree-1')?.remaining).toBe(2);
    expect(state.trees.find((treeNode) => treeNode.id === 'coppice-1')?.remaining).toBe(0);
    expect(state.residents.map(({ cargo }) => cargo)).toEqual([1, 1]);
    expect(state.resources.wood).toBe(1);
  });

  it('never regrows an uprooted stump', () => {
    const uprooted = { ...tree('tree-1', 3, 0), state: 'uprooted' as const, regrowthProgressTicks: 99 };
    const state = advanceSettlement(world({ trees: [uprooted] }), WOOD_REGROWTH_TICKS * 5);
    expect(state.trees[0]).toMatchObject({ state: 'uprooted', remaining: 0, regrowthProgressTicks: 99 });
    expect(createGatherWoodTask(state, 'worker-1', 'uprooted-order', 'tree-1')?.sourceId).toBeNull();
  });

  it('keeps carried wood at a full storehouse and resumes unloading when capacity is available', () => {
    const initial = world({
      resources: { wood: 1 },
      storage: { id: 'storehouse-1', anchor: { x: -6, y: -1 }, footprint: { width: 2, height: 1 }, woodCapacity: 1 }
    });
    const task = createGatherWoodTask(initial, 'worker-1', 'full-storehouse-order', 'tree-1')!;
    let state = world({
      resources: { wood: 1 },
      storage: initial.storage,
      residents: [
        { ...residentAt(initial, 'worker-1'), position: { x: -4, y: 0 }, cargo: 1,
          task: { ...task, phase: 'unloading', path: [], pathIndex: 0, progressTicks: 0, requiredTicks: 1 },
          state: 'working', visualState: 'unloading' },
        residentAt(initial, 'worker-2')
      ]
    });
    state = advanceSettlement(state, 1);
    expect(state.resources.wood).toBe(1);
    expect(residentAt(state, 'worker-1').cargo).toBe(1);
    expect(residentAt(state, 'worker-1').task?.phase).toBe('waiting_storage');
    state = advanceSettlement(state, 80);
    expect(state.resources.wood).toBe(1);
    expect(residentAt(state, 'worker-1').cargo).toBe(1);
    expect(residentAt(state, 'worker-1').task?.phase).toBe('waiting_storage');

    state.resources.wood = 0;
    state = advanceSettlement(state, WOOD_UNLOADING_TICKS);
    expect(state.resources.wood).toBe(1);
    expect(residentAt(state, 'worker-1').cargo).toBe(0);
    expect(residentAt(state, 'worker-1').task?.phase).toBe('walking_to_source');
  });

  it('builds at the confirmed anchor through persisted foundation and scaffold stages', () => {
    const initial = world({ resources: { wood: 3 } });
    const anchor = { x: 4, y: -1 };
    const buildingId = 'cabin-chosen-4';
    const task = createBuildCabinTask(initial, 'worker-1', 'task-build-1', buildingId, anchor);
    expect(task).not.toBeNull();
    if (!task) return;
    let state = world({
      resources: { wood: 0 },
      residents: [
        { ...residentAt(initial, 'worker-1'), task, state: 'working', visualState: task.phase }, residentAt(initial, 'worker-2')
      ],
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
    expect(residentAt(state, 'worker-1').position).toEqual({ x: 3, y: 0 });
    expect(residentAt(state, 'worker-1').task?.phase).toBe('building');
    state = advanceSettlement(state, 2);
    expect(state.buildings[0]?.state).toBe('foundation');
    state = advanceSettlement(state, 1);
    expect(state.buildings[0]?.state).toBe('scaffold');
    state = advanceSettlement(state, CABIN_BUILD_TICKS - 3);
    expect(state.buildings[0]?.anchor).toEqual(anchor);
    expect(state.buildings[0]?.state).toBe('complete');
    expect(state.buildings[0]?.reservedWood).toBe(0);
    expect(residentAt(state, 'worker-1').task).toBeNull();
  });

  it('advances a gatherer and builder independently during the same server ticks', () => {
    const initial = world({ resources: { wood: 3 } });
    const gather = createGatherWoodTask(initial, 'worker-1', 'parallel-gather', 'tree-1')!;
    const anchor = { x: 12, y: -1 };
    const buildingId = 'cabin-parallel-builder';
    const build = createBuildCabinTask(initial, 'worker-2', 'parallel-build', buildingId, anchor)!;
    expect(build.phase).toBe('building');
    let state = world({
      resources: { wood: 0 },
      residents: [
        { ...residentAt(initial, 'worker-1'), task: gather, state: 'working', visualState: gather.phase },
        { ...residentAt(initial, 'worker-2'), task: build, state: 'working', visualState: build.phase }
      ],
      buildings: [{
        id: buildingId, kind: 'cabin', anchor, footprint: { width: 2, height: 1 },
        state: 'planned', progressTicks: 0, progressRequired: CABIN_BUILD_TICKS, reservedWood: 3
      }]
    });

    state = advanceSettlement(state, 5);
    expect(residentAt(state, 'worker-1').task?.phase).toBe('gathering');
    expect(residentAt(state, 'worker-2').task?.phase).toBe('building');
    expect(state.buildings[0]?.state).toBe('scaffold');
    expect(state.buildings[0]?.progressTicks).toBe(5);
    expect(residentAt(state, 'worker-1').cargo).toBe(0);
    expect(residentAt(state, 'worker-2').cargo).toBe(0);
  });

  it('queues a competing same-tree assignment without duplicating its log and retains the wait reason', () => {
    const initial = world({ trees: [tree('tree-1', 3, 3)] });
    const firstTask = createGatherWoodTask(initial, 'worker-1', 'tree-claim-1', 'tree-1')!;
    const carrying = world({ trees: [tree('tree-1', 3, 3)], residents: [
      { ...residentAt(initial, 'worker-1'), task: firstTask, state: 'working', visualState: firstTask.phase },
      residentAt(initial, 'worker-2')
    ] });
    const secondTask = createGatherWoodTask(carrying, 'worker-2', 'tree-claim-2', 'tree-1')!;
    expect(secondTask.phase).toBe('waiting_resource');
    expect(secondTask.blockedReason).toBe('SOURCE_RESERVED');
    carrying.residents[1]!.task = secondTask;
    carrying.residents[1]!.state = 'waiting';
    carrying.residents[1]!.visualState = secondTask.phase;

    let state = advanceSettlement(carrying, 5);
    expect(state.trees[0]?.remaining).toBe(3);
    expect(residentAt(state, 'worker-2').task?.phase).toBe('waiting_resource');
    state = advanceSettlement(state, WOOD_GATHER_TICKS + 1);
    expect(state.trees[0]?.remaining).toBe(2);
    expect(residentAt(state, 'worker-1').cargo).toBe(1);
    expect(residentAt(state, 'worker-2').task?.phase).toBe('waiting_resource');
    expect(residentAt(state, 'worker-2').blockedReason).toBe('WORK_POINT_OCCUPIED');
  });

  it('keeps a gather order waiting when its sole work point is occupied, then resumes it', () => {
    const initial = world({ trees: [tree('tree-1', 3, 3)], residents: [
      resident('worker-1', 'Илья', -3, 'right', 'ilya'), resident('worker-2', 'Марья', 2, 'left', 'maria')
    ] });
    const task = createGatherWoodTask(initial, 'worker-1', 'occupied-source-point', 'tree-1')!;
    expect(task.phase).toBe('waiting_resource');
    expect(task.blockedReason).toBe('WORK_POINT_OCCUPIED');
    let state = world({ trees: [tree('tree-1', 3, 3)], residents: [
      { ...residentAt(initial, 'worker-1'), task, state: 'waiting', visualState: task.phase, blockedReason: task.blockedReason },
      residentAt(initial, 'worker-2')
    ] });
    state = advanceSettlement(state, 4);
    expect(residentAt(state, 'worker-1').task?.phase).toBe('waiting_resource');
    expect(residentAt(state, 'worker-1').blockedReason).toBe('WORK_POINT_OCCUPIED');

    state.residents[1]!.position = { x: 10, y: 0 };
    state = advanceSettlement(state, 1);
    expect(residentAt(state, 'worker-1').task?.phase).toBe('walking_to_source');
    expect(residentAt(state, 'worker-1').blockedReason).toBeNull();
    expect(state.trees[0]?.remaining).toBe(3);
  });

  it('holds a cabin order without stock, then reserves once and resumes when wood arrives', () => {
    const initial = world({ resources: { wood: 0 } });
    const anchor = { x: 12, y: -1 };
    const buildingId = 'cabin-waiting-materials';
    const task = createBuildCabinTask(initial, 'worker-2', 'wait-for-wood', buildingId, anchor)!;
    expect(task.phase).toBe('waiting_materials');
    expect(task.blockedReason).toBe('INSUFFICIENT_WOOD');
    let state = world({
      resources: { wood: 0 },
      residents: [residentAt(initial, 'worker-1'), {
        ...residentAt(initial, 'worker-2'), task, state: 'waiting', visualState: task.phase,
        blockedReason: task.blockedReason
      }],
      buildings: [{
        id: buildingId, kind: 'cabin', anchor, footprint: { width: 2, height: 1 },
        state: 'waiting_materials', progressTicks: 0, progressRequired: CABIN_BUILD_TICKS, reservedWood: 0
      }]
    });
    expect(validateCabinPlacement(state, anchor, 'worker-2').reason).toBe('WORKER_BUSY');

    state.resources.wood = 3;
    state = advanceSettlement(state, 1);
    expect(state.resources.wood).toBe(0);
    expect(residentAt(state, 'worker-2').task?.phase).toBe('building');
    expect(state.buildings[0]?.reservedWood).toBe(3);
    expect(state.buildings[0]?.progressTicks).toBe(1);
  });
});
