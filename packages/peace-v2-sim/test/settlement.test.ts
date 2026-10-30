import { describe, expect, it } from 'vitest';
import { PeaceWorldSnapshotSchema, type PeaceResident, type PeaceTreeNode, type PeaceWorldSnapshot } from '@avanpost/peace-v2-shared';
import {
  advanceSettlement,
  G33_STONE_BALANCE,
  cancelUnstartedBuildOrder,
  createBuildCabinOrder,
  createBuildCabinTask,
  createBuildWorkshopOrder,
  createGatherWoodTask,
  moveBuildOrder,
  scheduleWorkOrders,
  validateCabinPlacement,
  CABIN_BUILD_TICKS,
  WOOD_GATHER_TICKS,
  WOOD_LOADING_TICKS,
  WOOD_UNLOADING_TICKS,
  WOOD_REGROWTH_TICKS,
  COPPICE_REGROWTH_TICKS,
  STONE_MINER_ROLE,
  WORKSHOP_BUILD_TICKS,
  WORKSHOP_MATERIALS
} from '../src/index.js';

function world(overrides: Omit<Partial<PeaceWorldSnapshot>, 'resources'> & {
  resources?: Partial<PeaceWorldSnapshot['resources']>
} = {}): PeaceWorldSnapshot {
  return PeaceWorldSnapshotSchema.parse({
    revision: { worldVersion: 1, geometryVersion: 1, serverTick: 0 },
    storage: { id: 'storehouse-1', anchor: { x: -6, y: -1 }, footprint: { width: 2, height: 1 }, capacity: 100 },
    trees: [
      tree('tree-1', 3, 3),
      tree('tree-2', 8, 3),
      tree('tree-3', -12, 3),
      tree('coppice-1', 16, 1, 'renewable_plot', COPPICE_REGROWTH_TICKS)
    ],
    stoneDeposits: [{
      id: G33_STONE_BALANCE.stoneNode.id, name: 'Каменная жила', sourceKind: 'finite',
      position: { x: G33_STONE_BALANCE.stoneNode.dx, y: G33_STONE_BALANCE.stoneNode.dy },
      remaining: G33_STONE_BALANCE.stoneNode.initialAmount, maxRemaining: G33_STONE_BALANCE.stoneNode.initialAmount,
      bufferQuantity: 0, bufferCapacity: G33_STONE_BALANCE.stoneNode.bufferCapacity,
      yieldPerTick: G33_STONE_BALANCE.stoneNode.yieldPerTick, state: 'available'
    }],
    residents: [resident('worker-1', 'Илья', -3, 'right', 'ilya'), resident('worker-2', 'Марья', 14, 'left', 'maria')],
    buildOrders: [],
    nextBuildOrderSequence: 1,
    buildings: [],
    ...overrides,
    resources: { wood: 1, stone: 0, ...overrides.resources }
  });
}

function resident(id: string, name: string, x: number, facing: PeaceResident['facing'], appearanceKey: string): PeaceResident {
  return {
    id, name, appearanceKey, position: { x, y: 0 }, facing, state: 'idle', workRole: 'none', visualState: 'idle',
    cargo: 0, cargoItemId: null, blockedReason: null, task: null,
    preferredStorageId: null, preferredHaulSourceId: null
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
    regrowthEveryTicks,
    bufferQuantity: 0,
    bufferCapacity: 3,
    reservedBuffer: 0
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
      storage: { id: 'storehouse-1', anchor: { x: -6, y: -1 }, footprint: { width: 2, height: 1 }, capacity: 1 }
    });
    const task = createGatherWoodTask(initial, 'worker-1', 'full-storehouse-order', 'tree-1')!;
    let state = world({
      resources: { wood: 1 },
      storage: initial.storage,
      residents: [
        { ...residentAt(initial, 'worker-1'), position: { x: -4, y: 0 }, cargo: 1, cargoItemId: 'wood',
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
        reservedWood: 3,
        reservedStone: 0,
        inTransitWood: 0,
        inTransitStone: 0
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
        state: 'planned', progressTicks: 0, progressRequired: CABIN_BUILD_TICKS, reservedWood: 3, reservedStone: 0,
        inTransitWood: 0, inTransitStone: 0
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
        { ...resident('worker-1', 'Илья', -4, 'right', 'ilya'), workRole: 'woodcutter', cargo: 1, cargoItemId: 'wood',
          state: 'waiting', visualState: 'waiting_storage', blockedReason: 'STORAGE_FULL',
          task: waitingStorageTask('woodcutter-carry', 'tree-1', 'profession') },
        { ...resident('worker-2', 'Марья', 14, 'left', 'maria'), workRole: 'builder', cargo: 1, cargoItemId: 'wood',
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
      cargoItemId: 'wood' as const,
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

  it('normalizes legacy explicit-only orders and autonomously builds two queued cabins in order', () => {
    const initial = world({ resources: { wood: 6 } });
    const first = createBuildCabinOrder(initial, 'legacy-queue-first', 'legacy-cabin-first', { x: 4, y: -1 }, 0)!;
    const second = createBuildCabinOrder(initial, 'legacy-queue-second', 'legacy-cabin-second', { x: 12, y: -1 }, 1)!;
    const state = world({
      resources: { wood: 6 },
      buildOrders: [
        { ...first.order, requiresExplicitBuilder: true, blockedReason: 'EXPLICIT_BUILDER_REQUIRED' },
        { ...second.order, requiresExplicitBuilder: true, blockedReason: 'EXPLICIT_BUILDER_REQUIRED' }
      ],
      nextBuildOrderSequence: 3,
      buildings: [first.building, second.building]
    });

    scheduleWorkOrders(state);
    expect(state.buildOrders.map((order) => order.requiresExplicitBuilder)).toEqual([false, false]);
    expect(state.buildOrders.map((order) => order.blockedReason)).toEqual(['NO_BUILDER', 'NO_BUILDER']);

    residentAt(state, 'worker-1').workRole = 'builder';
    scheduleWorkOrders(state);
    expect(state.buildOrders.find((order) => order.id === first.order.id))
      .toMatchObject({ status: 'in_progress', assignedResidentId: 'worker-1', queuePosition: 0 });
    expect(state.buildOrders.find((order) => order.id === second.order.id))
      .toMatchObject({ status: 'waiting_builder', assignedResidentId: null, queuePosition: 1 });
    expect(state.resources.wood).toBe(3);
    expect(state.buildings.map((building) => building.reservedWood)).toEqual([3, 0]);

    let progressed = state;
    for (let tick = 0; tick < CABIN_BUILD_TICKS * 4 && progressed.buildOrders[0]?.status !== 'completed'; tick += 1) {
      progressed = advanceSettlement(progressed, 1);
    }
    expect(progressed.buildOrders.find((order) => order.id === first.order.id)?.status).toBe('completed');
    expect(progressed.buildOrders.find((order) => order.id === second.order.id))
      .toMatchObject({ status: 'in_progress', assignedResidentId: 'worker-1', queuePosition: 1 });
    expect(progressed.residents.filter((resident) => resident.task?.kind === 'build-cabin'))
      .toHaveLength(1);
    expect(progressed.resources.wood).toBe(0);
    expect(progressed.buildings.find((building) => building.id === second.building.id)?.reservedWood).toBe(3);
  });

  it('mines finite stone and conserves deposit, buffer, cargo and stored material', () => {
    const initial = world({
      residents: [
        { ...resident('worker-1', 'Илья', -3, 'right', 'ilya'), workRole: STONE_MINER_ROLE },
        resident('worker-2', 'Марья', 14, 'left', 'maria')
      ]
    });

    const progressed = advanceSettlement(initial, 5000);
    const deposit = progressed.stoneDeposits[0]!;

    expect(progressed.resources.stone).toBeGreaterThan(0);
    expect(deposit.remaining).toBeLessThan(G33_STONE_BALANCE.stoneNode.initialAmount);
    expect(deposit.remaining).toBeGreaterThanOrEqual(0);
    expect(deposit.bufferQuantity).toBeLessThanOrEqual(deposit.bufferCapacity);
    expect(progressed.residents.every((actor) => actor.cargoItemId !== 'stone' || actor.cargo > 0)).toBe(true);
    expect(deposit.remaining + deposit.bufferQuantity + progressed.resources.stone +
      progressed.residents.reduce((sum, actor) => sum + (actor.cargoItemId === 'stone' ? actor.cargo : 0), 0))
      .toBe(G33_STONE_BALANCE.stoneNode.initialAmount);
    expect(PeaceWorldSnapshotSchema.safeParse(progressed).success).toBe(true);
  });

  it('stops finite extraction at zero without exceeding storage capacity', () => {
    const initial = world({
      storage: { id: 'storehouse-1', anchor: { x: -6, y: -1 }, footprint: { width: 2, height: 1 }, capacity: 1000 },
      resources: { wood: 0, stone: 0 },
      residents: [
        { ...resident('worker-1', 'Илья', -3, 'right', 'ilya'), workRole: STONE_MINER_ROLE },
        resident('worker-2', 'Марья', 14, 'left', 'maria')
      ]
    });

    const exhausted = advanceSettlement(initial, 15000);
    expect(exhausted.stoneDeposits[0]).toMatchObject({ remaining: 0, bufferQuantity: 0, state: 'depleted' });
    expect(exhausted.resources.stone).toBe(G33_STONE_BALANCE.stoneNode.initialAmount);
    expect(exhausted.resources.wood + exhausted.resources.stone).toBeLessThanOrEqual(exhausted.storage.capacity);
  });

  it('reserves and consumes a workshop recipe exactly once through construction', () => {
    const base = world({
      resources: { wood: WORKSHOP_MATERIALS.wood * 2, stone: WORKSHOP_MATERIALS.stone * 2 },
      residents: [
        { ...resident('worker-1', 'Илья', -3, 'right', 'ilya'), workRole: 'builder' },
        resident('worker-2', 'Марья', 14, 'left', 'maria')
      ]
    });
    const created = createBuildWorkshopOrder(base, 'workshop-order-1', 'workshop-1', { x: 22, y: -1 }, 0);
    expect(created).not.toBeNull();
    const state = world({
      resources: base.resources,
      residents: base.residents,
      buildOrders: [created!.order],
      buildings: [created!.building]
    });

    scheduleWorkOrders(state);
    expect(state.resources).toEqual({ wood: WORKSHOP_MATERIALS.wood, stone: WORKSHOP_MATERIALS.stone });
    expect(state.buildings[0]).toMatchObject({ reservedWood: WORKSHOP_MATERIALS.wood, reservedStone: WORKSHOP_MATERIALS.stone });

    const completed = advanceSettlement(state, WORKSHOP_BUILD_TICKS + 1000);
    expect(completed.buildings[0]).toMatchObject({ kind: 'workshop', state: 'complete', reservedWood: 0, reservedStone: 0 });
    expect(completed.resources).toEqual({ wood: WORKSHOP_MATERIALS.wood, stone: WORKSHOP_MATERIALS.stone });
  });

  it('unblocks a workshop order when the miner unloads stone into storage', () => {
    const base = world({
      resources: { wood: WORKSHOP_MATERIALS.wood, stone: 0 },
      residents: [
        { ...resident('worker-1', 'Илья', -3, 'right', 'ilya'), workRole: STONE_MINER_ROLE },
        { ...resident('worker-2', 'Марья', 14, 'left', 'maria'), workRole: 'builder' }
      ]
    });
    const created = createBuildWorkshopOrder(base, 'waiting-workshop-order', 'waiting-workshop', { x: 12, y: -1 }, 0)!;
    const state = world({ resources: base.resources, residents: base.residents,
      buildOrders: [created.order], buildings: [created.building] });

    expect(created.order.status).toBe('waiting_materials');
    scheduleWorkOrders(state);
    expect(state.buildings[0]).toMatchObject({ reservedWood: WORKSHOP_MATERIALS.wood, reservedStone: 0 });

    const completed = advanceSettlement(state, 15_000);
    expect(completed.buildOrders[0]?.status).toBe('completed');
    expect(completed.buildings[0]).toMatchObject({ state: 'complete', reservedWood: 0, reservedStone: 0 });
    expect(completed.stoneDeposits[0]!.remaining).toBeLessThan(G33_STONE_BALANCE.stoneNode.initialAmount);
    const conservedStone = completed.stoneDeposits.reduce((sum, node) => sum + node.remaining + node.bufferQuantity, 0) +
      completed.resources.stone + completed.residents.reduce((sum, actor) =>
        sum + (actor.cargoItemId === 'stone' ? actor.cargo : 0), 0);
    expect(conservedStone).toBe(G33_STONE_BALANCE.stoneNode.initialAmount - WORKSHOP_MATERIALS.stone);
    expect(completed.resources.wood + completed.residents.reduce((sum, actor) =>
      sum + (actor.cargoItemId === 'wood' ? actor.cargo : 0), 0) +
      completed.buildings.reduce((sum, building) => sum + building.reservedWood, 0) +
      completed.trees.reduce((sum, tree) => sum + tree.remaining, 0)).toBe(
      base.trees.reduce((sum, tree) => sum + tree.remaining, 0)
    );
  });

  it('builds a workshop from carried wood and stone while the shared warehouse is full', () => {
    const initial = world({
      resources: { wood: 100, stone: 0 },
      stoneDeposits: [{ ...world().stoneDeposits[0]!, remaining: 582 }],
      residents: [
        {
          ...resident('worker-1', 'Илья', -13, 'right', 'ilya'),
          state: 'waiting', workRole: STONE_MINER_ROLE, visualState: 'waiting_stone_storage',
          cargo: 18, cargoItemId: 'stone', blockedReason: 'STORAGE_FULL',
          task: {
            id: 'fixture-stone-cargo', kind: 'gather-stone', phase: 'waiting_storage', sourceId: G33_STONE_BALANCE.stoneNode.id,
            destinationId: 'storehouse-1', path: [], pathIndex: 0, progressTicks: 0, requiredTicks: WOOD_UNLOADING_TICKS,
            blockedReason: 'STORAGE_FULL', continuous: true, cancelAfterDelivery: false, assignmentSource: 'workRole'
          }
        },
        {
          ...resident('worker-2', 'Марья', 14, 'left', 'maria'),
          state: 'waiting', workRole: 'builder', visualState: 'waiting_storage',
          cargo: 1, cargoItemId: 'wood', blockedReason: 'STORAGE_FULL',
          task: {
            id: 'fixture-builder-wood', kind: 'gather-wood', phase: 'waiting_storage', sourceId: 'tree-2',
            destinationId: 'storehouse-1', path: [], pathIndex: 0, progressTicks: 0, requiredTicks: WOOD_UNLOADING_TICKS,
            blockedReason: 'STORAGE_FULL', continuous: false, cancelAfterDelivery: true, assignmentSource: 'profession'
          }
        }
      ]
    });
    const created = createBuildWorkshopOrder(initial, 'full-store-order', 'full-store-workshop', { x: 12, y: -1 }, 0)!;
    const queued = structuredClone(initial);
    queued.buildOrders.push(created.order);
    queued.buildings.push(created.building);
    queued.nextBuildOrderSequence = 2;

    expect(scheduleWorkOrders(queued)).toBe(true);
    const assigned = PeaceWorldSnapshotSchema.parse(structuredClone(queued));
    const assignedWorkshop = assigned.buildings[0]!;
    expect(assigned.resources).toEqual({ wood: 89, stone: 0 });
    expect(assigned.resources.wood + assigned.resources.stone).toBeLessThanOrEqual(assigned.storage.capacity);
    expect(assignedWorkshop).toMatchObject({ reservedWood: 11, reservedStone: 0 });
    expect(assigned.buildOrders[0]).toMatchObject({ status: 'in_progress', assignedResidentId: 'worker-2' });
    expect(residentAt(assigned, 'worker-2').task).toMatchObject({
      kind: 'build-workshop', phase: 'carrying_materials_to_build', orderId: 'full-store-order'
    });
    expect(residentAt(assigned, 'worker-1').task).toMatchObject({
      kind: 'gather-stone', phase: 'carrying_to_build', buildingId: 'full-store-workshop',
      orderId: 'full-store-order', deliveryQuantity: 6
    });

    const midFlight = PeaceWorldSnapshotSchema.parse(structuredClone(advanceSettlement(assigned, 8)));
    expect(midFlight.residents.some((actor) => actor.task?.kind === 'gather-stone' &&
      actor.task.phase === 'carrying_to_build' && actor.task.deliveryQuantity === 6)).toBe(true);
    const completed = advanceSettlement(midFlight, 1500);

    expect(completed.buildOrders[0]?.status).toBe('completed');
    expect(completed.buildings[0]).toMatchObject({ kind: 'workshop', state: 'complete', reservedWood: 0, reservedStone: 0 });
    expect(completed.resources).toEqual({ wood: 89, stone: 11 });
    expect(residentAt(completed, 'worker-1')).toMatchObject({
      workRole: STONE_MINER_ROLE, cargo: 1, cargoItemId: 'stone', task: { kind: 'gather-stone', phase: 'waiting_storage' }
    });
    expect(residentAt(completed, 'worker-2')).toMatchObject({ workRole: 'builder', cargo: 0, task: null });
    const remainingStone = completed.stoneDeposits.reduce((sum, deposit) => sum + deposit.remaining + deposit.bufferQuantity, 0) +
      completed.resources.stone + completed.residents.reduce((sum, actor) =>
        sum + (actor.cargoItemId === 'stone' ? actor.cargo : 0), 0);
    expect(remainingStone).toBe(G33_STONE_BALANCE.stoneNode.initialAmount - WORKSHOP_MATERIALS.stone);
    expect(PeaceWorldSnapshotSchema.safeParse(completed).success).toBe(true);
  });

  it('allocates one carried stone batch to the highest-priority workshop only', () => {
    const base = world({
      resources: { wood: 100, stone: 0 },
      residents: [
        {
          ...resident('worker-1', 'Илья', -13, 'right', 'ilya'), workRole: STONE_MINER_ROLE,
          cargo: 18, cargoItemId: 'stone',
          task: {
            id: 'competing-stone', kind: 'gather-stone', phase: 'waiting_storage', sourceId: G33_STONE_BALANCE.stoneNode.id,
            destinationId: 'storehouse-1', path: [], pathIndex: 0, progressTicks: 0, requiredTicks: 2,
            blockedReason: 'STORAGE_FULL', continuous: true, cancelAfterDelivery: false, assignmentSource: 'workRole'
          }
        },
        {
          ...resident('worker-2', 'Марья', 14, 'left', 'maria'), workRole: 'builder', cargo: 1, cargoItemId: 'wood',
          task: {
            id: 'competing-wood', kind: 'gather-wood', phase: 'waiting_storage', sourceId: 'tree-2',
            destinationId: 'storehouse-1', path: [], pathIndex: 0, progressTicks: 0, requiredTicks: 2,
            blockedReason: 'STORAGE_FULL', continuous: false, cancelAfterDelivery: true, assignmentSource: 'profession'
          }
        }
      ]
    });
    const first = createBuildWorkshopOrder(base, 'priority-workshop-a', 'priority-workshop-a-site', { x: 12, y: -1 }, 0)!;
    const second = createBuildWorkshopOrder(base, 'priority-workshop-b', 'priority-workshop-b-site', { x: 20, y: -1 }, 1)!;
    const state = structuredClone(base);
    state.buildOrders.push(first.order, second.order);
    state.buildings.push(first.building, second.building);
    state.nextBuildOrderSequence = 3;

    scheduleWorkOrders(state);
    expect(state.buildOrders.find((order) => order.id === first.order.id))
      .toMatchObject({ status: 'in_progress', assignedResidentId: 'worker-2' });
    expect(state.residents.find((actor) => actor.id === 'worker-1')?.task)
      .toMatchObject({ kind: 'gather-stone', orderId: first.order.id, deliveryQuantity: 6 });
    expect(state.buildOrders.find((order) => order.id === second.order.id)?.status).toBe('waiting_materials');
    expect(state.residents.filter((actor) => actor.task?.kind === 'gather-stone' && actor.task.deliveryQuantity !== undefined))
      .toHaveLength(1);
  });

  it('routes leftover carried stone to the next workshop in queue priority', () => {
    const base = world({
      resources: { wood: 100, stone: 0 },
      residents: [
        {
          ...resident('worker-1', 'Илья', -13, 'right', 'ilya'), workRole: STONE_MINER_ROLE,
          cargo: 18, cargoItemId: 'stone', task: {
            id: 'priority-stone-cargo', kind: 'gather-stone', phase: 'waiting_storage', sourceId: G33_STONE_BALANCE.stoneNode.id,
            destinationId: 'storehouse-1', path: [], pathIndex: 0, progressTicks: 0, requiredTicks: 2,
            blockedReason: 'STORAGE_FULL', continuous: true, cancelAfterDelivery: false, assignmentSource: 'workRole'
          }
        },
        {
          ...resident('worker-2', 'Марья', 14, 'left', 'maria'), workRole: 'builder', cargo: 1, cargoItemId: 'wood',
          task: {
            id: 'priority-wood-cargo', kind: 'gather-wood', phase: 'waiting_storage', sourceId: 'tree-2',
            destinationId: 'storehouse-1', path: [], pathIndex: 0, progressTicks: 0, requiredTicks: 2,
            blockedReason: 'STORAGE_FULL', continuous: false, cancelAfterDelivery: true, assignmentSource: 'profession'
          }
        }
      ]
    });
    const first = createBuildWorkshopOrder(base, 'courier-priority-a', 'courier-site-a', { x: 12, y: -1 }, 0)!;
    const second = createBuildWorkshopOrder(base, 'courier-priority-b', 'courier-site-b', { x: 20, y: -1 }, 1)!;
    const state = structuredClone(base);
    state.buildOrders.push(first.order, second.order);
    state.buildings.push(first.building, second.building);
    state.nextBuildOrderSequence = 3;
    scheduleWorkOrders(state);

    const progressed = PeaceWorldSnapshotSchema.parse(structuredClone(advanceSettlement(state, 30)));
    expect(progressed.buildings.find((building) => building.id === first.building.id)?.reservedStone).toBe(6);
    expect(progressed.residents.find((actor) => actor.id === 'worker-1')).toMatchObject({
      cargo: 12, cargoItemId: 'stone', task: { kind: 'gather-stone', buildingId: second.building.id,
        orderId: second.order.id, deliveryQuantity: 6, phase: 'carrying_to_build' }
    });
    expect(progressed.buildings.find((building) => building.id === second.building.id)?.reservedStone).toBe(0);
    expect(progressed.resources.wood + progressed.resources.stone).toBeLessThanOrEqual(progressed.storage.capacity);
  });

  it('leaves cargo and stock unchanged when both workshop access points have no route', () => {
    const base = world({
      resources: { wood: 100, stone: 0 },
      residents: [
        { ...resident('worker-1', 'Илья', -13, 'right', 'ilya'), workRole: STONE_MINER_ROLE,
          cargo: 18, cargoItemId: 'stone', task: {
            id: 'no-route-stone', kind: 'gather-stone', phase: 'waiting_storage', sourceId: G33_STONE_BALANCE.stoneNode.id,
            destinationId: 'storehouse-1', path: [], pathIndex: 0, progressTicks: 0, requiredTicks: 2,
            blockedReason: 'STORAGE_FULL', continuous: true, cancelAfterDelivery: false, assignmentSource: 'workRole'
          } },
        { ...resident('worker-2', 'Марья', -4, 'left', 'maria'), workRole: 'builder', cargo: 1, cargoItemId: 'wood', task: {
          id: 'no-route-wood', kind: 'gather-wood', phase: 'waiting_storage', sourceId: 'tree-2',
          destinationId: 'storehouse-1', path: [], pathIndex: 0, progressTicks: 0, requiredTicks: 2,
          blockedReason: 'STORAGE_FULL', continuous: false, cancelAfterDelivery: true, assignmentSource: 'profession'
        } },
        resident('blocker-left', 'Блокер 1', 11, 'right', 'ilya'),
        resident('blocker-right', 'Блокер 2', 14, 'left', 'maria')
      ]
    });
    const created = createBuildWorkshopOrder(base, 'no-route-order', 'no-route-workshop', { x: 12, y: -1 }, 0)!;
    const state = structuredClone(base);
    state.buildOrders.push(created.order);
    state.buildings.push(created.building);
    state.nextBuildOrderSequence = 2;

    scheduleWorkOrders(state);
    expect(state.buildOrders[0]).toMatchObject({ status: 'waiting_path', blockedReason: 'WORK_POINT_OCCUPIED' });
    expect(state.resources).toEqual({ wood: 100, stone: 0 });
    expect(state.buildings[0]).toMatchObject({ reservedWood: 0, reservedStone: 0 });
    expect(residentAt(state, 'worker-1')).toMatchObject({ cargo: 18, cargoItemId: 'stone', task: { phase: 'waiting_storage' } });
    expect(residentAt(state, 'worker-2')).toMatchObject({ cargo: 1, cargoItemId: 'wood', task: { kind: 'gather-wood', phase: 'waiting_storage' } });
  });

  it('cancels a no-progress workshop without dropping linked courier cargo or reservations', () => {
    const base = world({
      resources: { wood: 100, stone: 0 },
      residents: [
        { ...resident('worker-1', 'Илья', -13, 'right', 'ilya'), workRole: STONE_MINER_ROLE,
          cargo: 18, cargoItemId: 'stone', task: {
            id: 'cancel-stone', kind: 'gather-stone', phase: 'waiting_storage', sourceId: G33_STONE_BALANCE.stoneNode.id,
            destinationId: 'storehouse-1', path: [], pathIndex: 0, progressTicks: 0, requiredTicks: 2,
            blockedReason: 'STORAGE_FULL', continuous: true, cancelAfterDelivery: false, assignmentSource: 'workRole'
          } },
        { ...resident('worker-2', 'Марья', 14, 'left', 'maria'), workRole: 'builder', cargo: 1, cargoItemId: 'wood', task: {
          id: 'cancel-wood', kind: 'gather-wood', phase: 'waiting_storage', sourceId: 'tree-2',
          destinationId: 'storehouse-1', path: [], pathIndex: 0, progressTicks: 0, requiredTicks: 2,
          blockedReason: 'STORAGE_FULL', continuous: false, cancelAfterDelivery: true, assignmentSource: 'profession'
        } }
      ]
    });
    const created = createBuildWorkshopOrder(base, 'cancel-order', 'cancel-workshop', { x: 12, y: -1 }, 0)!;
    const state = structuredClone(base);
    state.buildOrders.push(created.order);
    state.buildings.push(created.building);
    state.nextBuildOrderSequence = 2;

    scheduleWorkOrders(state);
    expect(state.buildOrders[0]?.status).toBe('in_progress');
    expect(cancelUnstartedBuildOrder(state, created.order.id)).toBe(true);
    expect(state.buildOrders[0]).toMatchObject({ status: 'cancelled', assignedResidentId: null });
    expect(state.buildings[0]).toMatchObject({ state: 'cancelled', reservedWood: 0, reservedStone: 0 });
    expect(state.resources).toEqual({ wood: 100, stone: 0 });
    expect(residentAt(state, 'worker-2')).toMatchObject({ cargo: 1, cargoItemId: 'wood', task: null });
    expect(residentAt(state, 'worker-1')).toMatchObject({ cargo: 18, cargoItemId: 'stone', task: { kind: 'gather-stone', phase: 'carrying_to_storage' } });
    expect(PeaceWorldSnapshotSchema.safeParse(state).success).toBe(true);
  });

  it('keeps a workshop waiting without inventing either missing recipe input', () => {
    const base = world({ resources: { wood: 0, stone: 0 }, residents: [
      resident('worker-1', 'Илья', -3, 'right', 'ilya'),
      { ...resident('worker-2', 'Марья', 14, 'left', 'maria'), workRole: 'builder' }
    ] });
    const created = createBuildWorkshopOrder(base, 'short-recipe-order', 'short-recipe-workshop', { x: 12, y: -1 }, 0)!;
    const state = structuredClone(base);
    state.buildOrders.push(created.order);
    state.buildings.push(created.building);

    scheduleWorkOrders(state);
    expect(state.resources).toEqual({ wood: 0, stone: 0 });
    expect(state.buildings[0]).toMatchObject({ reservedWood: 0, reservedStone: 0 });
    expect(state.buildOrders[0]).toMatchObject({ status: 'waiting_materials', assignedResidentId: 'worker-2' });
    expect(residentAt(state, 'worker-2').task).toMatchObject({ kind: 'build-workshop', phase: 'waiting_materials' });
  });

  it('physically transfers reserved stock between warehouses and prevents a second hauler claiming the same logs', () => {
    const state = world({
      resources: { wood: 6, stone: 0 },
      storages: [
        { id: 'storehouse-1', name: 'Западный склад', kind: 'warehouse', anchor: { x: -6, y: -1 },
          footprint: { width: 2, height: 1 }, capacity: 10, contents: { wood: 4, stone: 0 },
          reservedInbound: { wood: 0, stone: 0 }, reservedOutbound: { wood: 0, stone: 0 }, status: 'available', blockedReason: null },
        { id: 'storehouse-2', name: 'Восточный склад', kind: 'warehouse', anchor: { x: 10, y: -1 },
          footprint: { width: 2, height: 1 }, capacity: 10, contents: { wood: 2, stone: 0 },
          reservedInbound: { wood: 0, stone: 0 }, reservedOutbound: { wood: 0, stone: 0 }, status: 'available', blockedReason: null }
      ],
      residents: [
        { ...resident('worker-1', 'Илья', -3, 'right', 'ilya'), workRole: 'hauler',
          preferredStorageId: 'storehouse-2', preferredHaulSourceId: 'storehouse-1' },
        { ...resident('worker-2', 'Марья', 14, 'left', 'maria'), workRole: 'hauler',
          preferredStorageId: 'storehouse-2', preferredHaulSourceId: 'storehouse-1' }
      ]
    });

    expect(scheduleWorkOrders(state)).toBe(true);
    expect(state.residents.filter((actor) => actor.task?.kind === 'haul')).toHaveLength(1);
    expect(state.residents.find((actor) => actor.task?.kind === 'haul')?.task).toMatchObject({
      kind: 'haul', sourceKind: 'storage', sourceId: 'storehouse-1', destinationKind: 'storage',
      destinationId: 'storehouse-2', itemId: 'wood', quantity: 4
    });
    expect(state.storages?.[0]?.reservedOutbound.wood).toBe(4);
    expect(state.storages?.[1]?.reservedInbound.wood).toBe(4);
    expect(state.logisticsTasks).toMatchObject([{
      kind: 'rebalancing', itemId: 'wood', sourceKind: 'storage', sourceId: 'storehouse-1',
      destinationKind: 'storage', destinationId: 'storehouse-2', requiredQuantity: 4, allocatedQuantity: 4,
      status: 'assigned', assignedResidentId: 'worker-1'
    }]);
    expect(PeaceWorldSnapshotSchema.safeParse(state).success).toBe(true);

    const completed = advanceSettlement(state, 40);
    expect(completed.storages?.map((storage) => storage.contents.wood)).toEqual([0, 6]);
    expect(completed.storages?.map((storage) => storage.reservedInbound.wood)).toEqual([0, 0]);
    expect(completed.storages?.map((storage) => storage.reservedOutbound.wood)).toEqual([0, 0]);
    expect(completed.logisticsTasks[0]).toMatchObject({ status: 'completed', deliveredQuantity: 4, allocatedQuantity: 0 });
    expect(completed.resources).toEqual({ wood: 6, stone: 0 });
    expect(PeaceWorldSnapshotSchema.safeParse(completed).success).toBe(true);
  });

  it('splits a larger warehouse request across haulers without duplicating source reservations', () => {
    const state = world({
      resources: { wood: 8, stone: 0 },
      storages: [
        { id: 'storehouse-1', name: 'Источник', kind: 'warehouse', anchor: { x: -6, y: -1 },
          footprint: { width: 2, height: 1 }, capacity: 16, contents: { wood: 8, stone: 0 },
          reservedInbound: { wood: 0, stone: 0 }, reservedOutbound: { wood: 0, stone: 0 }, status: 'available', blockedReason: null },
        { id: 'storehouse-2', name: 'Получатель', kind: 'warehouse', anchor: { x: 10, y: -1 },
          footprint: { width: 2, height: 1 }, capacity: 16, contents: { wood: 0, stone: 0 },
          reservedInbound: { wood: 0, stone: 0 }, reservedOutbound: { wood: 0, stone: 0 }, status: 'available', blockedReason: null }
      ],
      logisticsPolicy: { priorityOrder: ['active_construction', 'ready_construction', 'buffer_clearance', 'warehouse_restock', 'rebalancing'], carryCapacity: 3 },
      residents: [
        { ...resident('worker-1', 'Илья', -3, 'right', 'ilya'), workRole: 'hauler',
          preferredStorageId: 'storehouse-2', preferredHaulSourceId: 'storehouse-1' },
        { ...resident('worker-2', 'Марья', 14, 'left', 'maria'), workRole: 'hauler',
          preferredStorageId: 'storehouse-2', preferredHaulSourceId: 'storehouse-1' }
      ]
    });

    expect(scheduleWorkOrders(state)).toBe(true);
    const assignments = state.residents.filter((actor) => actor.task?.kind === 'haul');
    expect(assignments).toHaveLength(2);
    expect(assignments.map((actor) => actor.task?.kind === 'haul' ? actor.task.quantity : 0)).toEqual([3, 3]);
    expect(state.storages?.[0]?.reservedOutbound.wood).toBe(6);
    expect(state.storages?.[1]?.reservedInbound.wood).toBe(6);
    expect(state.logisticsTasks.filter((task) => task.assignedResidentId)).toMatchObject([
      { demandKey: 'rebalance:storehouse-1:storehouse-2:wood', kind: 'rebalancing', allocatedQuantity: 3 },
      { demandKey: 'rebalance:storehouse-1:storehouse-2:wood', kind: 'rebalancing', allocatedQuantity: 3 }
    ]);
    expect(new Set(state.logisticsTasks.filter((task) => task.assignedResidentId).map((task) => task.assignedResidentId)).size).toBe(2);
    expect(PeaceWorldSnapshotSchema.safeParse(state).success).toBe(true);

    const completed = advanceSettlement(state, 55);
    expect(completed.storages?.map((storage) => storage.contents.wood)).toEqual([0, 8]);
    expect(completed.resources).toEqual({ wood: 8, stone: 0 });
    expect(completed.logisticsTasks.filter((task) => task.demandKey === 'rebalance:storehouse-1:storehouse-2:wood')
      .every((task) => task.status === 'completed')).toBe(true);
    expect(PeaceWorldSnapshotSchema.safeParse(completed).success).toBe(true);
  });

  it('dispatches active-construction materials ahead of buffer restocking and preserves build queue priority', () => {
    const state = world({
      resources: { wood: 6, stone: 0 },
      storages: [{ id: 'storehouse-1', name: 'Склад', kind: 'warehouse', anchor: { x: -6, y: -1 },
        footprint: { width: 2, height: 1 }, capacity: 10, contents: { wood: 6, stone: 0 },
        reservedInbound: { wood: 0, stone: 0 }, reservedOutbound: { wood: 0, stone: 0 }, status: 'available', blockedReason: null }],
      trees: [{ ...tree('tree-1', 3, 0), state: 'stump', bufferQuantity: 2, bufferCapacity: 3 }],
      residents: [
        { ...resident('worker-1', 'Илья', -3, 'right', 'ilya'), workRole: 'builder',
          task: { id: 'active-builder-task', kind: 'build-cabin', phase: 'waiting_materials', buildingId: 'active-site',
            orderId: 'active-order', path: [], pathIndex: 0, progressTicks: 0, requiredTicks: CABIN_BUILD_TICKS, blockedReason: 'WAITING_FOR_HAUL' } },
        { ...resident('worker-2', 'Марья', 14, 'left', 'maria'), workRole: 'hauler' },
        { ...resident('worker-3', 'Оля', -14, 'right', 'maria'), workRole: 'builder' }
      ]
    });
    const active = createBuildCabinOrder(state, 'active-order', 'active-site', { x: 0, y: -1 }, 0)!;
    active.order.status = 'waiting_materials';
    active.order.assignedResidentId = 'worker-1';
    active.order.blockedReason = 'WAITING_FOR_HAUL';
    active.building.state = 'foundation';
    active.building.progressTicks = 1;
    state.buildOrders.push(active.order);
    state.buildings.push(active.building);
    const queued = createBuildCabinOrder(state, 'queued-order', 'queued-site', { x: 12, y: -1 }, 1)!;
    state.buildOrders.push(queued.order);
    state.buildings.push(queued.building);

    scheduleWorkOrders(state);
    expect(residentAt(state, 'worker-2').task).toMatchObject({ kind: 'haul', destinationKind: 'building', destinationId: 'active-site', orderId: 'active-order' });
    const assigned = state.logisticsTasks.find((task) => task.assignedResidentId === 'worker-2');
    expect(assigned).toMatchObject({ kind: 'active_construction', priorityRank: 0, orderId: 'active-order' });
    expect(state.logisticsTasks.some((task) => task.demandKey === 'construction:queued-order:wood' && task.kind === 'ready_construction')).toBe(true);
    expect(PeaceWorldSnapshotSchema.safeParse(state).success).toBe(true);
  });

  it('hauls tree-buffer stock to a physical warehouse without changing the total item count', () => {
    const bufferedTree = { ...tree('tree-1', 3, 0), state: 'stump' as const, bufferQuantity: 3, bufferCapacity: 3 };
    const state = world({
      resources: { wood: 0, stone: 0 },
      storages: [{ id: 'storehouse-1', name: 'Склад', kind: 'warehouse', anchor: { x: -6, y: -1 },
        footprint: { width: 2, height: 1 }, capacity: 10, contents: { wood: 0, stone: 0 },
        reservedInbound: { wood: 0, stone: 0 }, reservedOutbound: { wood: 0, stone: 0 }, status: 'available', blockedReason: null }],
      trees: [bufferedTree],
      residents: [
        { ...resident('worker-1', 'Илья', -3, 'right', 'ilya'), workRole: 'hauler', preferredStorageId: 'storehouse-1' },
        resident('worker-2', 'Марья', 14, 'left', 'maria')
      ]
    });

    expect(scheduleWorkOrders(state)).toBe(true);
    expect(residentAt(state, 'worker-1').task).toMatchObject({
      kind: 'haul', sourceKind: 'tree-buffer', sourceId: 'tree-1', destinationKind: 'storage', quantity: 3
    });
    expect(state.trees[0]).toMatchObject({ bufferQuantity: 3, reservedBuffer: 3 });
    expect(PeaceWorldSnapshotSchema.safeParse(state).success).toBe(true);

    const completed = advanceSettlement(state, 40);
    expect(completed.trees[0]).toMatchObject({ bufferQuantity: 0, reservedBuffer: 0 });
    expect(completed.storages?.[0]?.contents.wood).toBe(3);
    expect(residentAt(completed, 'worker-1')).toMatchObject({ cargo: 0, task: null });
    expect(completed.resources.wood + completed.trees[0]!.bufferQuantity +
      completed.residents.reduce((sum, resident) => sum + (resident.cargoItemId === 'wood' ? resident.cargo : 0), 0)).toBe(3);
    expect(PeaceWorldSnapshotSchema.safeParse(completed).success).toBe(true);
  });

  it('feeds a hauler from the woodcutter source buffer without direct-to-warehouse delivery', () => {
    const state = world({
      resources: { wood: 0, stone: 0 },
      storages: [{ id: 'storehouse-1', name: 'Склад', kind: 'warehouse', anchor: { x: -6, y: -1 },
        footprint: { width: 2, height: 1 }, capacity: 10, contents: { wood: 0, stone: 0 },
        reservedInbound: { wood: 0, stone: 0 }, reservedOutbound: { wood: 0, stone: 0 }, status: 'available', blockedReason: null }],
      trees: [{ ...tree('tree-1', 3, 3), bufferCapacity: 1 }],
      residents: [
        { ...resident('worker-1', 'Илья', -3, 'right', 'ilya'), workRole: 'woodcutter' },
        { ...resident('worker-2', 'Марья', 14, 'left', 'maria'), workRole: 'hauler' }
      ]
    });
    expect(scheduleWorkOrders(state)).toBe(true);
    expect(residentAt(state, 'worker-1').task?.kind).toBe('gather-wood');

    const progressed = advanceSettlement(state, 60);
    const treeRemaining = progressed.trees[0]!.remaining;
    const buffered = progressed.trees[0]!.bufferQuantity;
    const stored = progressed.storages![0]!.contents.wood;
    const carried = progressed.residents.reduce((sum, resident) =>
      sum + (resident.cargoItemId === 'wood' ? resident.cargo : 0), 0);
    expect(progressed.storages?.[0]?.reservedInbound.wood).toBeGreaterThanOrEqual(0);
    expect(treeRemaining + buffered + stored + carried).toBe(3);
    expect(PeaceWorldSnapshotSchema.safeParse(progressed).success).toBe(true);
  });

  it('partially hauls stone when the selected warehouse has less space than the source buffer', () => {
    const state = world({
      resources: { wood: 16, stone: 0 },
      storages: [
        { id: 'storehouse-1', name: 'Главный', kind: 'warehouse', anchor: { x: -6, y: -1 },
          footprint: { width: 2, height: 1 }, capacity: 16, contents: { wood: 16, stone: 0 },
          reservedInbound: { wood: 0, stone: 0 }, reservedOutbound: { wood: 0, stone: 0 }, status: 'full', blockedReason: null },
        { id: 'storehouse-2', name: 'Восточный', kind: 'warehouse', anchor: { x: 10, y: -1 },
          footprint: { width: 2, height: 1 }, capacity: 16, contents: { wood: 0, stone: 0 },
          reservedInbound: { wood: 0, stone: 0 }, reservedOutbound: { wood: 0, stone: 0 }, status: 'available', blockedReason: null }
      ],
      stoneDeposits: [{ id: G33_STONE_BALANCE.stoneNode.id, name: 'Каменная жила', sourceKind: 'finite',
        position: { x: 5, y: 1 }, remaining: 582, maxRemaining: 600, bufferQuantity: 18,
        bufferCapacity: G33_STONE_BALANCE.stoneNode.bufferCapacity, reservedBuffer: 0,
        yieldPerTick: G33_STONE_BALANCE.stoneNode.yieldPerTick, state: 'available' }],
      residents: [
        { ...resident('worker-1', 'Илья', -3, 'right', 'ilya'), workRole: 'hauler' },
        resident('worker-2', 'Марья', 14, 'left', 'maria')
      ]
    });

    expect(scheduleWorkOrders(state)).toBe(true);
    expect(residentAt(state, 'worker-1').task).toMatchObject({
      kind: 'haul', sourceKind: 'stone-buffer', itemId: 'stone', quantity: 16,
      destinationKind: 'storage', destinationId: 'storehouse-2'
    });
    expect(state.stoneDeposits[0]?.reservedBuffer).toBe(16);
    expect(state.storages?.[1]?.reservedInbound.stone).toBe(16);

    const delivered = advanceSettlement(state, 40);
    expect(delivered.stoneDeposits[0]).toMatchObject({ bufferQuantity: 2, reservedBuffer: 0 });
    expect(delivered.storages?.[1]?.contents.stone).toBe(16);
    expect(delivered.storages?.[1]?.reservedInbound.stone).toBe(0);
    expect(delivered.resources).toEqual({ wood: 16, stone: 16 });
    expect(PeaceWorldSnapshotSchema.safeParse(delivered).success).toBe(true);
  });

  it('keeps a source buffer intact when every destination warehouse is out of route', () => {
    const storage = { id: 'storehouse-1', anchor: { x: 24, y: -1 }, footprint: { width: 2, height: 1 }, capacity: 10 };
    const state = world({
      storage,
      resources: { wood: 0, stone: 0 },
      storages: [{ id: storage.id, name: 'Склад', kind: 'warehouse', anchor: storage.anchor, footprint: storage.footprint,
        capacity: storage.capacity, contents: { wood: 0, stone: 0 }, reservedInbound: { wood: 0, stone: 0 },
        reservedOutbound: { wood: 0, stone: 0 }, status: 'available', blockedReason: null }],
      trees: [{ ...tree('tree-1', 3, 0), state: 'stump', bufferQuantity: 2, bufferCapacity: 3 }],
      residents: [
        { ...resident('worker-1', 'Илья', -3, 'right', 'ilya'), workRole: 'hauler' },
        resident('worker-2', 'Марья', 14, 'left', 'maria')
      ]
    });

    scheduleWorkOrders(state);
    expect(residentAt(state, 'worker-1')).toMatchObject({ state: 'waiting', visualState: 'waiting_haul', blockedReason: 'NO_PATH_TO_STORAGE', task: null });
    expect(state.trees[0]).toMatchObject({ bufferQuantity: 2, reservedBuffer: 0 });
    expect(state.resources).toEqual({ wood: 0, stone: 0 });
    expect(state.logisticsTasks).toMatchObject([{
      kind: 'warehouse_restock', status: 'blocked', blockedReason: 'NO_PATH_TO_STORAGE',
      sourceKind: 'tree-buffer', sourceId: 'tree-1', assignedResidentId: null, allocatedQuantity: 0
    }]);
    expect(PeaceWorldSnapshotSchema.safeParse(state).success).toBe(true);
  });

  it('falls back from a full preferred warehouse and waits without reservations when all warehouses are full', () => {
    const full = (id: string, anchorX: number) => ({ id, name: id, kind: 'warehouse' as const,
      anchor: { x: anchorX, y: -1 }, footprint: { width: 2, height: 1 }, capacity: 2,
      contents: { wood: 2, stone: 0 }, reservedInbound: { wood: 0, stone: 0 },
      reservedOutbound: { wood: 0, stone: 0 }, status: 'full' as const, blockedReason: null });
    const bufferedTree = { ...tree('tree-1', 3, 0), state: 'stump' as const, bufferQuantity: 2, bufferCapacity: 3 };
    const fallback = world({
      resources: { wood: 2, stone: 0 },
      storages: [full('storehouse-1', -6), { ...full('storehouse-2', 10), capacity: 5, contents: { wood: 0, stone: 0 }, status: 'available' }],
      trees: [bufferedTree],
      residents: [
        { ...resident('worker-1', 'Илья', -3, 'right', 'ilya'), workRole: 'hauler', preferredStorageId: 'storehouse-1' },
        resident('worker-2', 'Марья', 14, 'left', 'maria')
      ]
    });
    scheduleWorkOrders(fallback);
    expect(residentAt(fallback, 'worker-1').task).toMatchObject({ kind: 'haul', destinationId: 'storehouse-2', quantity: 2 });
    expect(fallback.storages?.[0]?.reservedInbound.wood).toBe(0);
    expect(fallback.storages?.[1]?.reservedInbound.wood).toBe(2);

    const allFull = world({
      resources: { wood: 2, stone: 0 },
      storages: [full('storehouse-1', -6)],
      trees: [bufferedTree],
      residents: [
        { ...resident('worker-1', 'Илья', -3, 'right', 'ilya'), workRole: 'hauler' },
        resident('worker-2', 'Марья', 14, 'left', 'maria')
      ]
    });
    scheduleWorkOrders(allFull);
    expect(residentAt(allFull, 'worker-1')).toMatchObject({ state: 'waiting', blockedReason: 'STORAGE_FULL', task: null });
    expect(allFull.trees[0]).toMatchObject({ bufferQuantity: 2, reservedBuffer: 0 });
    expect(allFull.storages?.[0]?.reservedInbound.wood).toBe(0);
    expect(allFull.logisticsTasks.some((task) => task.status === 'blocked' && task.blockedReason === 'STORAGE_FULL')).toBe(true);
    expect(PeaceWorldSnapshotSchema.safeParse(allFull).success).toBe(true);
  });

  it('splits a warehouse transfer into carry-capacity batches for multiple haulers', () => {
    const state = world({
      resources: { wood: 8, stone: 0 },
      logisticsPolicy: { priorityOrder: ['active_construction', 'ready_construction', 'buffer_clearance', 'warehouse_restock', 'rebalancing'], carryCapacity: 3 },
      storages: [
        { id: 'storehouse-1', name: 'Источник', kind: 'warehouse', anchor: { x: -6, y: -1 },
          footprint: { width: 2, height: 1 }, capacity: 16, contents: { wood: 8, stone: 0 },
          reservedInbound: { wood: 0, stone: 0 }, reservedOutbound: { wood: 0, stone: 0 }, status: 'available', blockedReason: null },
        { id: 'storehouse-2', name: 'Получатель', kind: 'warehouse', anchor: { x: 10, y: -1 },
          footprint: { width: 2, height: 1 }, capacity: 16, contents: { wood: 0, stone: 0 },
          reservedInbound: { wood: 0, stone: 0 }, reservedOutbound: { wood: 0, stone: 0 }, status: 'available', blockedReason: null }
      ],
      residents: [
        { ...resident('worker-1', 'Илья', -3, 'right', 'ilya'), workRole: 'hauler',
          preferredStorageId: 'storehouse-2', preferredHaulSourceId: 'storehouse-1' },
        { ...resident('worker-2', 'Марья', 14, 'left', 'maria'), workRole: 'hauler',
          preferredStorageId: 'storehouse-2', preferredHaulSourceId: 'storehouse-1' }
      ]
    });

    expect(scheduleWorkOrders(state)).toBe(true);
    const activeHauls = state.residents.filter((actor) => actor.task?.kind === 'haul');
    expect(activeHauls).toHaveLength(2);
    expect(activeHauls.map((actor) => actor.task?.kind === 'haul' ? actor.task.quantity : 0)).toEqual([3, 3]);
    expect(state.storages?.[0]?.reservedOutbound.wood).toBe(6);
    expect(state.storages?.[1]?.reservedInbound.wood).toBe(6);
    const assignments = state.logisticsTasks.filter((task) => task.assignedResidentId);
    expect(assignments).toHaveLength(2);
    expect(assignments.every((task) => task.kind === 'rebalancing' && task.allocatedQuantity === 3)).toBe(true);
    expect(new Set(assignments.map((task) => task.assignedResidentId)).size).toBe(2);
    expect(PeaceWorldSnapshotSchema.safeParse(state).success).toBe(true);

    const completed = advanceSettlement(state, 80);
    expect(completed.storages?.map((storage) => storage.contents.wood)).toEqual([0, 8]);
    expect(completed.resources).toEqual({ wood: 8, stone: 0 });
    expect(PeaceWorldSnapshotSchema.safeParse(completed).success).toBe(true);
  });

  it('dispatches active-construction batches before ready construction and source-buffer restocking', () => {
    const state = world({
      resources: { wood: 6, stone: 0 },
      logisticsPolicy: { priorityOrder: ['active_construction', 'ready_construction', 'buffer_clearance', 'warehouse_restock', 'rebalancing'], carryCapacity: 3 },
      storages: [{ id: 'storehouse-1', name: 'Склад', kind: 'warehouse', anchor: { x: -6, y: -1 },
        footprint: { width: 2, height: 1 }, capacity: 16, contents: { wood: 6, stone: 0 },
        reservedInbound: { wood: 0, stone: 0 }, reservedOutbound: { wood: 0, stone: 0 }, status: 'available', blockedReason: null }],
      trees: [{ ...tree('tree-1', 3, 0), state: 'stump' as const, bufferQuantity: 2, bufferCapacity: 3 }],
      residents: [
        { ...resident('worker-1', 'Илья', -3, 'right', 'ilya'), workRole: 'builder' },
        { ...resident('worker-2', 'Марья', 2, 'left', 'maria'), workRole: 'builder' },
        { ...resident('worker-3', 'Оля', -14, 'right', 'ilya'), workRole: 'hauler' },
        { ...resident('worker-4', 'Павел', 14, 'left', 'maria'), workRole: 'hauler' }
      ]
    });
    const active = createBuildCabinOrder(state, 'active-order', 'active-site', { x: 0, y: -1 }, 0)!;
    active.order.status = 'in_progress';
    active.order.assignedResidentId = 'worker-1';
    active.order.blockedReason = 'WAITING_FOR_HAUL';
    active.building.state = 'foundation';
    active.building.progressTicks = 1;
    state.buildOrders.push(active.order);
    state.buildings.push(active.building);
    residentAt(state, 'worker-1').task = {
      id: 'active-builder-task', kind: 'build-cabin', phase: 'building', buildingId: active.building.id,
      orderId: active.order.id, path: [], pathIndex: 0, progressTicks: 0, requiredTicks: CABIN_BUILD_TICKS, blockedReason: null
    };
    residentAt(state, 'worker-1').state = 'working';
    residentAt(state, 'worker-1').visualState = 'building';
    const ready = createBuildCabinOrder(state, 'ready-order', 'ready-site', { x: 12, y: -1 }, 1)!;
    state.buildOrders.push(ready.order);
    state.buildings.push(ready.building);

    expect(scheduleWorkOrders(state)).toBe(true);
    const worksiteHauls = state.residents.filter((actor) => actor.task?.kind === 'haul' && actor.task.destinationKind === 'building');
    expect(worksiteHauls).toHaveLength(2);
    expect(worksiteHauls.map((actor) => actor.task?.kind === 'haul' ? actor.task.orderId : null)).toEqual(['active-order', 'ready-order']);
    expect(state.buildings.find((building) => building.id === 'active-site')?.inTransitWood).toBe(3);
    expect(state.buildings.find((building) => building.id === 'ready-site')?.inTransitWood).toBe(2);
    const assignedQueue = state.logisticsTasks.filter((task) => task.assignedResidentId);
    expect(assignedQueue.map((task) => task.kind)).toEqual(['active_construction', 'ready_construction']);
    expect(state.trees[0]?.bufferQuantity).toBe(2);
    expect(PeaceWorldSnapshotSchema.safeParse(state).success).toBe(true);
  });

  it('uses physical warehouse stock for construction and safely retargets loaded cargo on cancellation', () => {
    const state = world({
      resources: { wood: 3, stone: 0 },
      storages: [{ id: 'storehouse-1', name: 'Склад', kind: 'warehouse', anchor: { x: -6, y: -1 },
        footprint: { width: 2, height: 1 }, capacity: 10, contents: { wood: 3, stone: 0 },
        reservedInbound: { wood: 0, stone: 0 }, reservedOutbound: { wood: 0, stone: 0 }, status: 'available', blockedReason: null }],
      residents: [
        { ...resident('worker-1', 'Илья', -3, 'right', 'ilya'), workRole: 'builder' },
        { ...resident('worker-2', 'Марья', 14, 'left', 'maria'), workRole: 'hauler', preferredStorageId: 'storehouse-1' }
      ]
    });
    const created = createBuildCabinOrder(state, 'haul-build-order', 'haul-build-site', { x: 0, y: -1 }, 0)!;
    state.buildOrders.push(created.order);
    state.buildings.push(created.building);

    expect(scheduleWorkOrders(state)).toBe(true);
    expect(residentAt(state, 'worker-2').task).toMatchObject({
      kind: 'haul', sourceKind: 'storage', sourceId: 'storehouse-1', destinationKind: 'building',
      destinationId: 'haul-build-site', orderId: 'haul-build-order', itemId: 'wood', quantity: 3
    });
    expect(state.storages?.[0]?.reservedOutbound.wood).toBe(3);
    expect(state.buildings[0]?.inTransitWood).toBe(3);
    expect(PeaceWorldSnapshotSchema.safeParse(state).success).toBe(true);

    const cancelledBeforeLoading = structuredClone(state);
    expect(cancelUnstartedBuildOrder(cancelledBeforeLoading, 'haul-build-order')).toBe(true);
    expect(cancelledBeforeLoading.storages?.[0]).toMatchObject({ contents: { wood: 3 }, reservedOutbound: { wood: 0 } });
    expect(cancelledBeforeLoading.buildings[0]?.inTransitWood).toBe(0);
    expect(residentAt(cancelledBeforeLoading, 'worker-2')).toMatchObject({ cargo: 0, task: null });
    expect(PeaceWorldSnapshotSchema.safeParse(cancelledBeforeLoading).success).toBe(true);

    const loaded = advanceSettlement(state, 20);
    expect(residentAt(loaded, 'worker-2').cargo).toBe(3);
    expect(cancelUnstartedBuildOrder(loaded, 'haul-build-order')).toBe(true);
    expect(residentAt(loaded, 'worker-2')).toMatchObject({
      cargo: 3, cargoItemId: 'wood', task: { kind: 'haul', destinationKind: 'storage', destinationId: 'storehouse-1' }
    });
    expect(loaded.buildOrders[0]?.status).toBe('cancelled');
    expect(loaded.buildings[0]?.inTransitWood).toBe(0);
    expect(PeaceWorldSnapshotSchema.safeParse(loaded).success).toBe(true);

    const recovered = advanceSettlement(loaded, 40);
    expect(recovered.buildOrders[0]?.status).toBe('cancelled');
    expect(recovered.storages?.[0]?.contents.wood).toBe(3);
    expect(recovered.resources).toEqual({ wood: 3, stone: 0 });
    expect(residentAt(recovered, 'worker-2')).toMatchObject({ cargo: 0, cargoItemId: null, task: null });
    expect(PeaceWorldSnapshotSchema.safeParse(recovered).success).toBe(true);
  });

});
