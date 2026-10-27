import { describe, expect, it } from 'vitest';
import { PeaceWorldSnapshotSchema, type PeaceResident, type PeaceTreeNode, type PeaceWorldSnapshot } from '@avanpost/peace-v2-shared';
import {
  advanceSettlement,
  cancelUnstartedBuildOrder,
  createBuildCabinOrder,
  createBuildCabinTask,
  createGatherWoodTask,
  moveBuildOrder,
  scheduleWorkOrders,
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
    buildOrders: [],
    nextBuildOrderSequence: 1,
    buildings: [],
    ...overrides
  };
}

function resident(id: string, name: string, x: number, facing: PeaceResident['facing'], appearanceKey: string): PeaceResident {
  return {
    id, name, appearanceKey, position: { x, y: 0 }, facing, state: 'idle', workRole: 'none', visualState: 'idle',
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
    const orderId = 'order-cabin-chosen-4';
    const task = createBuildCabinTask(initial, 'worker-1', 'task-build-1', buildingId, orderId, anchor);
    expect(task).not.toBeNull();
    if (!task) return;
    let state = world({
      resources: { wood: 0 },
      buildOrders: [{ id: orderId, buildingId, queuePosition: 0, status: 'in_progress',
        assignedResidentId: 'worker-1', blockedReason: null }],
      nextBuildOrderSequence: 2,
      residents: [
        { ...residentAt(initial, 'worker-1'), task, state: 'working', visualState: task.phase }, residentAt(initial, 'worker-2')
      ],
      buildings: [{
        id: buildingId,
        kind: 'cabin',
        orderId,
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
    const orderId = 'parallel-order';
    const build = createBuildCabinTask(initial, 'worker-2', 'parallel-build', buildingId, orderId, anchor)!;
    expect(build.phase).toBe('building');
    let state = world({
      resources: { wood: 0 },
      buildOrders: [{ id: orderId, buildingId, queuePosition: 0, status: 'in_progress',
        assignedResidentId: 'worker-2', blockedReason: null }],
      nextBuildOrderSequence: 2,
      residents: [
        { ...residentAt(initial, 'worker-1'), task: gather, state: 'working', visualState: gather.phase },
        { ...residentAt(initial, 'worker-2'), task: build, state: 'working', visualState: build.phase }
      ],
      buildings: [{
        id: buildingId, kind: 'cabin', orderId, anchor, footprint: { width: 2, height: 1 },
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

  it('holds an unassigned build order without stock and starts it automatically after the woodcutter delivers enough', () => {
    const initial = world({ resources: { wood: 0 }, residents: [
      { ...resident('worker-1', 'Илья', -3, 'right', 'ilya'), workRole: 'woodcutter' },
      { ...resident('worker-2', 'Марья', 14, 'left', 'maria'), workRole: 'builder' }
    ] });
    const anchor = { x: 12, y: -1 };
    const buildingId = 'cabin-waiting-materials';
    const orderId = 'order-waiting-materials';
    const created = createBuildCabinOrder(initial, orderId, buildingId, anchor, 0)!;
    expect(created.order.status).toBe('waiting_materials');
    let state = world({
      resources: { wood: 0 },
      residents: initial.residents,
      buildOrders: [created.order],
      nextBuildOrderSequence: 2,
      buildings: [created.building]
    });

    state = advanceSettlement(state, 56);
    expect(state.resources.wood).toBe(0);
    expect(state.buildings[0]?.reservedWood).toBe(3);
    expect(state.buildOrders[0]?.status).toBe('in_progress');
    expect(state.buildOrders[0]?.assignedResidentId).toBe('worker-2');
    expect(residentAt(state, 'worker-1').task?.kind).toBe('gather-wood');
    expect(residentAt(state, 'worker-2').task).toMatchObject({ kind: 'build-cabin', orderId });
  });

  it('reorders and cancels only queued build orders without consuming reserved materials', () => {
    const initial = world({ resources: { wood: 1 } });
    const first = createBuildCabinOrder(initial, 'order-first', 'cabin-first', { x: 4, y: -1 }, 0)!;
    const second = createBuildCabinOrder(initial, 'order-second', 'cabin-second', { x: 12, y: -1 }, 1)!;
    const state = world({
      resources: { wood: 1 },
      buildOrders: [first.order, second.order],
      nextBuildOrderSequence: 2,
      buildings: [first.building, second.building]
    });
    expect(moveBuildOrder(state, 'order-second', 'up')).toBe(true);
    expect(state.buildOrders.sort((a, b) => a.queuePosition - b.queuePosition).map(({ id }) => id))
      .toEqual(['order-second', 'order-first']);
    expect(cancelUnstartedBuildOrder(state, 'order-first')).toBe(true);
    expect(state.buildOrders.find(({ id }) => id === 'order-first')?.status).toBe('cancelled');
    expect(state.buildings.find(({ id }) => id === 'cabin-first')?.state).toBe('cancelled');
    expect(state.resources.wood).toBe(1);
  });

  it('delivers a builder-held log directly to the highest-priority site and starts the next order', () => {
    const waitingStorageTask = (id: string, sourceId: string, assignmentSource: 'manual' | 'profession') => ({
      id, kind: 'gather-wood' as const, phase: 'waiting_storage' as const, sourceId,
      destinationId: 'storehouse-1', path: [], pathIndex: 0, progressTicks: 0, requiredTicks: WOOD_UNLOADING_TICKS,
      blockedReason: 'STORAGE_FULL', continuous: true, cancelAfterDelivery: false, assignmentSource
    });
    const starting = world({
      resources: { wood: 100 },
      residents: [
        { ...resident('worker-1', 'Илья', -4, 'right', 'ilya'), workRole: 'woodcutter', cargo: 1,
          state: 'waiting', visualState: 'waiting_storage', blockedReason: 'STORAGE_FULL',
          task: waitingStorageTask('woodcutter-carry', 'tree-1', 'profession') },
        { ...resident('worker-2', 'Марья', 14, 'left', 'maria'), workRole: 'builder', cargo: 1,
          state: 'waiting', visualState: 'waiting_storage', blockedReason: 'STORAGE_FULL',
          task: waitingStorageTask('manual-carry', 'tree-2', 'manual') }
      ]
    });
    const orderA = createBuildCabinOrder(starting, 'order-A', 'cabin-A', { x: 0, y: -1 }, 1)!;
    const orderB = createBuildCabinOrder(starting, 'order-B', 'cabin-B', { x: 4, y: -1 }, 2)!;
    let state = world({
      resources: { wood: 100 }, residents: starting.residents,
      buildOrders: [orderA.order, orderB.order], nextBuildOrderSequence: 3,
      buildings: [orderA.building, orderB.building]
    });
    expect(moveBuildOrder(state, 'order-B', 'up')).toBe(true);

    // The persisted queue order, not array order or creation order, controls dispatch.
    state = PeaceWorldSnapshotSchema.parse(structuredClone(state));
    scheduleWorkOrders(state);
    expect(state.buildOrders.find((order) => order.id === 'order-B'))
      .toMatchObject({ status: 'in_progress', assignedResidentId: 'worker-2', queuePosition: 1 });
    expect(state.buildOrders.find((order) => order.id === 'order-A'))
      .toMatchObject({ status: 'waiting_builder', assignedResidentId: null, queuePosition: 2 });
    expect(state.resources.wood).toBe(98);
    expect(state.buildings.find((building) => building.id === 'cabin-B')?.reservedWood).toBe(2);
    expect(residentAt(state, 'worker-2')).toMatchObject({
      cargo: 1, task: { kind: 'build-cabin', orderId: 'order-B', phase: 'carrying_materials_to_build' }
    });

    const carriedRouteTicks = Math.max(1, residentAt(state, 'worker-2').task!.path.length);
    state = advanceSettlement(state, carriedRouteTicks);
    expect(residentAt(state, 'worker-2')).toMatchObject({
      cargo: 0, task: { kind: 'build-cabin', orderId: 'order-B', phase: 'building' }
    });
    expect(state.buildings.find((building) => building.id === 'cabin-B')?.reservedWood).toBe(3);
    const carriedAndReservedLogs = (current: PeaceWorldSnapshot) => current.resources.wood +
      current.residents.reduce((sum, resident) => sum + resident.cargo, 0) +
      current.buildings.reduce((sum, building) => sum + building.reservedWood, 0) +
      current.trees.reduce((sum, tree) => sum + tree.remaining, 0);
    expect(carriedAndReservedLogs(state)).toBe(carriedAndReservedLogs(starting));

    state = advanceSettlement(state, CABIN_BUILD_TICKS + 2);
    expect(state.buildings.find((building) => building.id === 'cabin-B')?.state).toBe('complete');
    expect(state.buildOrders.find((order) => order.id === 'order-B')?.status).toBe('completed');
    expect(state.buildOrders.find((order) => order.id === 'order-A'))
      .toMatchObject({ status: 'in_progress', assignedResidentId: 'worker-2' });
    expect(residentAt(state, 'worker-2').task).toMatchObject({ kind: 'build-cabin', orderId: 'order-A' });
    expect(residentAt(state, 'worker-1').workRole).toBe('woodcutter');
    expect(residentAt(state, 'worker-1').task?.kind).toBe('gather-wood');
  });

  it('keeps a carried log when it cannot yet complete an order, then combines it with stored wood', () => {
    const builder = {
      ...resident('worker-2', 'Марья', 14, 'left', 'maria'),
      workRole: 'builder' as const,
      cargo: 1,
      state: 'waiting' as const,
      visualState: 'waiting_storage' as const,
      blockedReason: 'STORAGE_FULL',
      task: {
        id: 'manual-carry', kind: 'gather-wood' as const, phase: 'waiting_storage' as const,
        sourceId: 'tree-2', destinationId: 'storehouse-1', path: [], pathIndex: 0,
        progressTicks: 0, requiredTicks: WOOD_UNLOADING_TICKS, blockedReason: 'STORAGE_FULL',
        continuous: true, cancelAfterDelivery: false, assignmentSource: 'manual' as const
      }
    };
    const initial = world({ resources: { wood: 1 }, residents: [
      resident('worker-1', 'Илья', -4, 'right', 'ilya'), builder
    ] });
    const created = createBuildCabinOrder(initial, 'order-short-stock', 'cabin-short-stock', { x: 4, y: -1 }, 1)!;
    const state = world({ resources: { wood: 1 }, residents: initial.residents,
      buildOrders: [created.order], nextBuildOrderSequence: 2, buildings: [created.building] });

    scheduleWorkOrders(state);
    expect(state.buildOrders[0]?.status).toBe('waiting_materials');
    expect(residentAt(state, 'worker-2')).toMatchObject({ cargo: 1, task: { kind: 'gather-wood' } });
    expect(state.resources.wood).toBe(1);

    state.resources.wood = 2;
    scheduleWorkOrders(state);
    expect(state.resources.wood).toBe(0);
    expect(state.buildings[0]?.reservedWood).toBe(2);
    expect(residentAt(state, 'worker-2')).toMatchObject({
      cargo: 1, task: { kind: 'build-cabin', orderId: 'order-short-stock', phase: 'carrying_materials_to_build' }
    });
  });

  it('assigns the first eligible order to a free builder and reserves its materials once', () => {
    const base = world({
      resources: { wood: 3 },
      residents: [
        { ...resident('worker-1', 'Илья', -3, 'right', 'ilya'), workRole: 'none' },
        { ...resident('worker-2', 'Марья', 14, 'left', 'maria'), workRole: 'builder' }
      ]
    });
    const created = createBuildCabinOrder(base, 'queued-order-1', 'queued-cabin-1', { x: 4, y: -1 }, 0)!;
    const state = world({ resources: { wood: 3 }, residents: base.residents,
      buildOrders: [created.order], nextBuildOrderSequence: 1, buildings: [created.building] });

    expect(scheduleWorkOrders(state)).toBe(true);
    expect(state.resources.wood).toBe(0);
    expect(state.buildings[0]).toMatchObject({ state: 'in_progress', reservedWood: 3 });
    expect(state.buildOrders[0]).toMatchObject({ status: 'in_progress', assignedResidentId: 'worker-2' });
    expect(residentAt(state, 'worker-2').task).toMatchObject({ kind: 'build-cabin', orderId: 'queued-order-1' });
  });

  it('persists a changed priority and dispatches the moved order before creation order', () => {
    const base = world({
      resources: { wood: 6 },
      residents: [
        { ...resident('worker-1', 'Илья', -3, 'right', 'ilya'), workRole: 'builder' },
        { ...resident('worker-2', 'Марья', 14, 'left', 'maria'), workRole: 'builder' }
      ]
    });
    const first = createBuildCabinOrder(base, 'queue-first', 'cabin-first', { x: 4, y: -1 }, 0)!;
    const second = createBuildCabinOrder(base, 'queue-second', 'cabin-second', { x: 12, y: -1 }, 1)!;
    const state = world({ resources: { wood: 6 }, residents: base.residents,
      buildOrders: [first.order, second.order], nextBuildOrderSequence: 2,
      buildings: [first.building, second.building] });

    expect(moveBuildOrder(state, 'queue-second', 'up')).toBe(true);
    const reloaded = PeaceWorldSnapshotSchema.parse(structuredClone(state));
    scheduleWorkOrders(reloaded);
    expect(reloaded.resources.wood).toBe(0);
    expect(reloaded.buildOrders.find(({ id }) => id === 'queue-second'))
      .toMatchObject({ queuePosition: 0, status: 'in_progress', assignedResidentId: 'worker-1' });
    expect(reloaded.buildOrders.find(({ id }) => id === 'queue-first'))
      .toMatchObject({ queuePosition: 1, status: 'in_progress', assignedResidentId: 'worker-2' });
    expect(reloaded.residents.map((resident) => resident.task?.kind)).toEqual(['build-cabin', 'build-cabin']);
    expect(reloaded.buildings.map((building) => building.reservedWood)).toEqual([3, 3]);
  });
});
