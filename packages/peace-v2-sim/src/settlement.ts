import type {
  PeaceResident,
  PeaceTreeNode,
  PeaceWorldSnapshot,
  PeaceWorkerTask
} from '@avanpost/peace-v2-shared';

export const PEACE_V2_TICK_INTERVAL_MS = 500;
export const CABIN_FOOTPRINT = { width: 2, height: 1 } as const;
export const CABIN_BUILD_TICKS = 10;
export const WOOD_GATHER_TICKS = 4;
export const WOOD_LOADING_TICKS = 1;
export const WOOD_UNLOADING_TICKS = 2;
export const WOOD_REGROWTH_TICKS = 100;
export const COPPICE_REGROWTH_TICKS = 1200;
export const WOOD_CABIN_COST = 3;

type GatherWoodTask = Extract<NonNullable<PeaceWorkerTask>, { kind: 'gather-wood' }>;
type BuildCabinTask = Extract<NonNullable<PeaceResident['task']>, { kind: 'build-cabin' }>;
type Resident = PeaceWorldSnapshot['residents'][number];

export type PlacementReason =
  | 'READY'
  | 'WORKER_BUSY'
  | 'RESIDENT_MISSING'
  | 'CARGO_NOT_EMPTY'
  | 'RESOURCE_MISSING'
  | 'WAITING_MATERIALS'
  | 'WAITING_WORK_POINT'
  | 'OUT_OF_WORLD'
  | 'INVALID_SURFACE'
  | 'OCCUPIED'
  | 'NO_PATH';

export interface CabinPlacementValidation {
  valid: boolean;
  reason: PlacementReason;
  anchor: { x: number; y: number };
  footprint: typeof CABIN_FOOTPRINT;
  workPoint?: { x: number; y: number };
  route?: Array<{ x: number; y: number }>;
}

export interface CabinPlacementOptions {
  ignoreBuildingId?: string;
  ignoreResidentTask?: boolean;
}

const MIN_WORLD_X = -24;
const MAX_WORLD_X = 24;
const BUILDING_ROW = -1;
const SURFACE_ROW = 0;

function samePoint(a: { x: number; y: number }, b: { x: number; y: number }): boolean {
  return a.x === b.x && a.y === b.y;
}

function surfacePath(
  from: { x: number; y: number },
  to: { x: number; y: number }
): Array<{ x: number; y: number }> | null {
  if (from.y !== SURFACE_ROW || to.y !== SURFACE_ROW || from.x < MIN_WORLD_X || from.x > MAX_WORLD_X ||
      to.x < MIN_WORLD_X || to.x > MAX_WORLD_X) return null;
  if (samePoint(from, to)) return [];
  const direction = Math.sign(to.x - from.x);
  const path: Array<{ x: number; y: number }> = [];
  for (let x = from.x + direction; direction > 0 ? x <= to.x : x >= to.x; x += direction) {
    path.push({ x, y: SURFACE_ROW });
  }
  return path;
}

function placementWorkPoint(
  world: PeaceWorldSnapshot,
  resident: Resident,
  anchor: { x: number; y: number },
  ignoreBuildingId?: string
) {
  const candidates = [
    { x: anchor.x - 1, y: SURFACE_ROW },
    { x: anchor.x + CABIN_FOOTPRINT.width, y: SURFACE_ROW }
  ].sort((a, b) => Math.abs(a.x - resident.position.x) - Math.abs(b.x - resident.position.x) || a.x - b.x);
  const reachable: Array<{ point: { x: number; y: number }; route: Array<{ x: number; y: number }> }> = [];
  for (const point of candidates) {
    const route = surfacePath(resident.position, point);
    if (!route) continue;
    const buildingBlocksPoint = world.buildings.some((building) => building.id !== ignoreBuildingId &&
      building.anchor.y === point.y && point.x >= building.anchor.x && point.x < building.anchor.x + building.footprint.width);
    const occupiedByResident = world.residents.some((other) => other.id !== resident.id && samePoint(other.position, point));
    if (!buildingBlocksPoint && !occupiedByResident) return { point, route, waitReason: null as string | null };
    reachable.push({ point, route });
  }
  const fallback = reachable[0];
  return fallback ? { ...fallback, waitReason: 'WORK_POINT_OCCUPIED' } : null;
}

export function validateCabinPlacement(
  world: PeaceWorldSnapshot,
  anchor: { x: number; y: number },
  residentId: string,
  options: CabinPlacementOptions = {}
): CabinPlacementValidation {
  const result = (reason: PlacementReason, extra: Partial<CabinPlacementValidation> = {}): CabinPlacementValidation => ({
    valid: reason === 'READY' || reason === 'WAITING_MATERIALS' || reason === 'WAITING_WORK_POINT',
    reason,
    anchor,
    footprint: CABIN_FOOTPRINT,
    ...extra
  });

  if (!Number.isSafeInteger(anchor.x) || anchor.x < MIN_WORLD_X || anchor.x + CABIN_FOOTPRINT.width - 1 > MAX_WORLD_X) {
    return result('OUT_OF_WORLD');
  }
  if (anchor.y !== BUILDING_ROW) return result('INVALID_SURFACE');
  const resident = world.residents.find((candidate) => candidate.id === residentId);
  if (!resident) return result('RESIDENT_MISSING');
  if (resident.cargo > 0) return result('CARGO_NOT_EMPTY');
  if (resident.task && !options.ignoreResidentTask) return result('WORKER_BUSY');

  const cabinCells = new Set(Array.from({ length: CABIN_FOOTPRINT.width }, (_, index) => anchor.x + index));
  const storageCells = new Set(Array.from({ length: world.storage.footprint.width }, (_, index) => world.storage.anchor.x + index));
  if ([...cabinCells].some((x) => storageCells.has(x)) ||
       [...cabinCells].some((x) => world.buildings.some((building) =>
         building.id !== options.ignoreBuildingId && building.anchor.y === anchor.y &&
           x >= building.anchor.x && x < building.anchor.x + building.footprint.width)) ||
        world.trees.some((tree) => tree.state !== 'uprooted' && cabinCells.has(tree.position.x))) {
    return result('OCCUPIED');
  }

  const workPoint = placementWorkPoint(world, resident, anchor, options.ignoreBuildingId);
  if (!workPoint) return result('NO_PATH');
  const placementReason = world.resources.wood < WOOD_CABIN_COST
    ? 'WAITING_MATERIALS'
    : workPoint.waitReason ? 'WAITING_WORK_POINT' : 'READY';
  return result(placementReason, { workPoint: workPoint.point, route: workPoint.route });
}

function sourceReservedByAnother(world: PeaceWorldSnapshot, residentId: string, sourceId: string): boolean {
  return world.residents.some((resident) => resident.id !== residentId && resident.task?.kind === 'gather-wood' &&
    resident.task.sourceId === sourceId &&
    ['walking_to_source', 'gathering', 'loading'].includes(resident.task.phase));
}

function sourceWorkPoint(source: PeaceTreeNode): { x: number; y: number } {
  return { x: source.position.x - 1, y: SURFACE_ROW };
}

function selectWoodSource(
  world: PeaceWorldSnapshot,
  residentId: string,
  preferredSourceId?: string
): { source: PeaceTreeNode; path: Array<{ x: number; y: number }> } | null {
  const resident = world.residents.find((candidate) => candidate.id === residentId);
  if (!resident) return null;
  const reachable = world.trees.flatMap((source) => {
    if (source.remaining < 1 || source.state !== 'standing' || sourceReservedByAnother(world, residentId, source.id)) return [];
    const point = sourceWorkPoint(source);
    if (world.residents.some((other) => other.id !== residentId && samePoint(other.position, point))) return [];
    const path = surfacePath(resident.position, point);
    return path ? [{ source, path }] : [];
  });
  reachable.sort((a, b) => {
    if (a.source.id === preferredSourceId) return -1;
    if (b.source.id === preferredSourceId) return 1;
    return a.path.length - b.path.length || a.source.id.localeCompare(b.source.id);
  });
  return reachable[0] ?? null;
}

function waitingGatherTask(taskId: string, destinationId: string, reason: string): GatherWoodTask {
  return {
    id: taskId,
    kind: 'gather-wood',
    phase: 'waiting_resource',
    sourceId: null,
    destinationId,
    path: [],
    pathIndex: 0,
    progressTicks: 0,
    requiredTicks: 1,
    blockedReason: reason,
    continuous: true,
    cancelAfterDelivery: false
  };
}

export function createGatherWoodTask(
  world: PeaceWorldSnapshot,
  residentId: string,
  taskId: string,
  preferredSourceId?: string
): GatherWoodTask | null {
  const resident = world.residents.find((candidate) => candidate.id === residentId);
  if (!resident || resident.task || resident.cargo > 0) return null;
  const selected = selectWoodSource(world, residentId, preferredSourceId);
  if (!selected) {
    const waiting = waitingGatherTask(taskId, world.storage.id, 'NO_AVAILABLE_TREES');
    waitForWoodSource(world, resident, waiting);
    return waiting;
  }
  const phase = selected.path.length === 0 ? 'gathering' : 'walking_to_source';
  return {
    id: taskId,
    kind: 'gather-wood',
    phase,
    sourceId: selected.source.id,
    destinationId: world.storage.id,
    path: selected.path,
    pathIndex: 0,
    progressTicks: 0,
    requiredTicks: selected.path.length || WOOD_GATHER_TICKS,
    blockedReason: null,
    continuous: true,
    cancelAfterDelivery: false
  };
}

export function createDeliveryTask(
  world: PeaceWorldSnapshot,
  residentId: string,
  taskId: string,
  _sourceId = 'recovered-cargo'
): GatherWoodTask | null {
  const resident = world.residents.find((candidate) => candidate.id === residentId);
  if (!resident || resident.task || resident.cargo < 1) return null;
  const storageWorkPoint = { x: world.storage.anchor.x + world.storage.footprint.width, y: SURFACE_ROW };
  const path = surfacePath(resident.position, storageWorkPoint);
  if (!path) return null;
  const phase = path.length === 0 ? 'unloading' : 'carrying_to_storage';
  return {
    id: taskId,
    kind: 'gather-wood',
    phase,
    sourceId: null,
    destinationId: world.storage.id,
    path,
    pathIndex: 0,
    progressTicks: 0,
    requiredTicks: phase === 'unloading' ? WOOD_UNLOADING_TICKS : path.length,
    blockedReason: null,
    continuous: false,
    cancelAfterDelivery: false
  };
}

export function createBuildCabinTask(
  world: PeaceWorldSnapshot,
  residentId: string,
  taskId: string,
  buildingId: string,
  anchor: { x: number; y: number }
): BuildCabinTask | null {
  const placement = validateCabinPlacement(world, anchor, residentId);
  if (!placement.valid || !placement.workPoint || !placement.route) return null;
  const phase = placement.reason === 'WAITING_MATERIALS'
    ? 'waiting_materials'
    : placement.reason === 'WAITING_WORK_POINT'
      ? 'waiting_path'
      : placement.route.length === 0 ? 'building' : 'walking_to_build';
  return {
    id: taskId,
    kind: 'build-cabin',
    phase,
    buildingId,
    path: phase === 'waiting_materials' || phase === 'waiting_path' ? [] : placement.route,
    pathIndex: 0,
    progressTicks: 0,
    requiredTicks: phase === 'building' ? CABIN_BUILD_TICKS : phase === 'waiting_path' || phase === 'waiting_materials'
      ? 1 : placement.route.length,
    blockedReason: placement.reason === 'WAITING_WORK_POINT' ? 'WORK_POINT_OCCUPIED'
      : placement.reason === 'WAITING_MATERIALS' ? 'INSUFFICIENT_WOOD' : null
  };
}

function moveAlongPath(resident: Resident, task: PeaceWorkerTask): boolean {
  if (task.pathIndex >= task.path.length) return true;
  const point = task.path[task.pathIndex];
  if (!point) return true;
  if (point.x !== resident.position.x) resident.facing = point.x < resident.position.x ? 'left' : 'right';
  resident.position = { ...point };
  task.pathIndex += 1;
  task.progressTicks = task.pathIndex;
  return task.pathIndex >= task.path.length;
}

function setGatherPhase(task: GatherWoodTask, phase: GatherWoodTask['phase'], requiredTicks: number): void {
  task.phase = phase;
  task.progressTicks = 0;
  task.requiredTicks = requiredTicks;
}

function updateCabinStage(world: PeaceWorldSnapshot, resident: Resident, task: BuildCabinTask): void {
  const building = world.buildings.find((candidate) => candidate.id === task.buildingId);
  if (!building) {
    task.phase = 'blocked';
    task.blockedReason = 'BUILDING_SITE_MISSING';
    return;
  }
  building.progressTicks = Math.min(CABIN_BUILD_TICKS, building.progressTicks + 1);
  if (building.progressTicks >= CABIN_BUILD_TICKS) {
    building.state = 'complete';
    building.reservedWood = 0;
    resident.task = null;
    return;
  }
  building.state = building.progressTicks < 3 ? 'foundation' : 'scaffold';
  task.progressTicks = building.progressTicks;
}

function advanceWoodland(world: PeaceWorldSnapshot, ticks: number): boolean {
  if (ticks < 1) return false;
  let sourceBecameAvailable = false;
  for (const tree of world.trees) {
    if (tree.state === 'uprooted' || tree.regrowthEveryTicks === null || tree.remaining >= tree.maxRemaining) continue;
    const accumulated = tree.regrowthProgressTicks + ticks;
    if (accumulated >= tree.regrowthEveryTicks) {
      const recoveredLogs = Math.floor(accumulated / tree.regrowthEveryTicks);
      const oldRemaining = tree.remaining;
      tree.remaining = Math.min(tree.maxRemaining, tree.remaining + recoveredLogs);
      tree.state = tree.remaining > 0 ? 'standing' : 'stump';
      tree.regrowthProgressTicks = tree.remaining >= tree.maxRemaining ? 0 : accumulated % tree.regrowthEveryTicks;
      sourceBecameAvailable = sourceBecameAvailable || tree.remaining > oldRemaining;
    } else {
      tree.regrowthProgressTicks = accumulated;
    }
  }
  return sourceBecameAvailable;
}

function harvestSource(world: PeaceWorldSnapshot, task: GatherWoodTask): PeaceTreeNode | undefined {
  return task.sourceId ? world.trees.find((tree) => tree.id === task.sourceId) : undefined;
}

function finishWoodDelivery(world: PeaceWorldSnapshot, resident: Resident, task: GatherWoodTask): void {
  const capacity = world.storage.woodCapacity - world.resources.wood;
  if (capacity < 1 || resident.cargo < 1) {
    task.phase = 'waiting_storage';
    task.blockedReason = 'STORAGE_FULL';
    task.progressTicks = 0;
    task.requiredTicks = WOOD_UNLOADING_TICKS;
    return;
  }
  const delivered = Math.min(capacity, resident.cargo);
  world.resources.wood += delivered;
  resident.cargo -= delivered;
  if (resident.cargo > 0) {
    task.phase = 'waiting_storage';
    task.blockedReason = 'STORAGE_FULL';
    task.progressTicks = 0;
    task.requiredTicks = WOOD_UNLOADING_TICKS;
    return;
  }
  if (!task.continuous || task.cancelAfterDelivery) {
    resident.task = null;
    return;
  }
  task.sourceId = null;
  task.phase = 'waiting_resource';
  task.blockedReason = 'NO_AVAILABLE_TREES';
  task.path = [];
  task.pathIndex = 0;
  task.progressTicks = 0;
  task.requiredTicks = 1;
}

function residentStatus(resident: Resident): void {
  const task = resident.task;
  if (!task) {
    resident.state = 'idle';
    resident.visualState = 'idle';
    resident.blockedReason = null;
    return;
  }
  resident.visualState = task.phase;
  resident.blockedReason = task.blockedReason;
  if (task.phase === 'blocked') resident.state = 'blocked';
  else if (['waiting_path', 'waiting_resource', 'waiting_materials', 'waiting_storage'].includes(task.phase)) resident.state = 'waiting';
  else resident.state = 'working';
}

function advanceOneResidentTick(world: PeaceWorldSnapshot, resident: Resident): boolean {
  const task = resident.task;
  if (!task || task.phase === 'blocked' || task.phase === 'waiting_path' ||
      task.phase === 'waiting_resource' || task.phase === 'waiting_materials' || task.phase === 'waiting_storage') return false;

  if (task.kind === 'gather-wood') {
    if (task.phase === 'walking_to_source' || task.phase === 'carrying_to_storage') {
      if (task.phase === 'walking_to_source' && !harvestSource(world, task)) {
        task.sourceId = null;
        task.phase = 'waiting_resource';
        task.blockedReason = 'NO_AVAILABLE_TREES';
        task.path = [];
        task.pathIndex = 0;
        return true;
      }
      const arrived = moveAlongPath(resident, task);
      if (!arrived) return true;
      if (task.phase === 'walking_to_source') setGatherPhase(task, 'gathering', WOOD_GATHER_TICKS);
      else setGatherPhase(task, 'unloading', WOOD_UNLOADING_TICKS);
      return true;
    }
    task.progressTicks += 1;
    if (task.progressTicks < task.requiredTicks) return true;
    if (task.phase === 'gathering') {
      setGatherPhase(task, 'loading', WOOD_LOADING_TICKS);
      return true;
    }
    if (task.phase === 'loading') {
      const source = harvestSource(world, task);
      if (!source || source.remaining < 1 || source.state !== 'standing') {
        task.sourceId = null;
        task.phase = 'waiting_resource';
        task.blockedReason = 'RESOURCE_MISSING';
        return true;
      }
      source.remaining -= 1;
      if (source.remaining === 0) {
        source.state = 'stump';
      }
      resident.cargo += 1;
      const storageWorkPoint = { x: world.storage.anchor.x + world.storage.footprint.width, y: SURFACE_ROW };
      const path = surfacePath(resident.position, storageWorkPoint);
      if (!path) {
        task.phase = 'waiting_path';
        task.blockedReason = 'NO_PATH_TO_STORAGE';
        return true;
      }
      task.path = path;
      task.pathIndex = 0;
      setGatherPhase(task, path.length === 0 ? 'unloading' : 'carrying_to_storage',
        path.length === 0 ? WOOD_UNLOADING_TICKS : path.length);
      return true;
    }
    if (task.phase === 'unloading') {
      finishWoodDelivery(world, resident, task);
      return true;
    }
    return false;
  }

  if (task.phase === 'walking_to_build') {
    const arrived = moveAlongPath(resident, task);
    if (arrived) {
      task.phase = 'building';
      task.progressTicks = 0;
      task.requiredTicks = CABIN_BUILD_TICKS;
    }
    return true;
  }
  updateCabinStage(world, resident, task);
  return true;
}

function residentHasSourceLock(resident: Resident, sourceId: string): boolean {
  const task = resident.task;
  return task?.kind === 'gather-wood' && task.sourceId === sourceId &&
    ['walking_to_source', 'gathering', 'loading'].includes(task.phase);
}

function waitForWoodSource(world: PeaceWorldSnapshot, resident: Resident, task: GatherWoodTask): void {
  const available = world.trees.filter((tree) => tree.state === 'standing' && tree.remaining > 0);
  if (available.length === 0) {
    task.phase = 'waiting_resource';
    task.sourceId = null;
    task.blockedReason = 'NO_AVAILABLE_TREES';
  } else {
    const unlocked = available.filter((tree) => !sourceReservedByAnother(world, resident.id, tree.id));
    const openWorkPoints = unlocked.filter((tree) => !world.residents.some((other) => other.id !== resident.id &&
      samePoint(other.position, sourceWorkPoint(tree))));
    if (unlocked.length === 0) {
      task.phase = 'waiting_resource';
      task.sourceId = null;
      task.blockedReason = 'SOURCE_RESERVED';
    } else if (openWorkPoints.length === 0) {
      task.phase = 'waiting_resource';
      task.sourceId = null;
      task.blockedReason = 'WORK_POINT_OCCUPIED';
    } else {
      task.phase = 'waiting_path';
      task.sourceId = null;
      task.blockedReason = 'NO_PATH_TO_SOURCE';
    }
  }
  task.path = [];
  task.pathIndex = 0;
  task.progressTicks = 0;
  task.requiredTicks = 1;
}

function activateGatherTask(world: PeaceWorldSnapshot, resident: Resident, task: GatherWoodTask): boolean {
  const selected = selectWoodSource(world, resident.id, task.sourceId ?? undefined);
  if (!selected) {
    const previousPhase = task.phase;
    const previousReason = task.blockedReason;
    waitForWoodSource(world, resident, task);
    residentStatus(resident);
    return task.phase !== previousPhase || task.blockedReason !== previousReason;
  }
  task.sourceId = selected.source.id;
  task.path = selected.path;
  task.pathIndex = 0;
  task.progressTicks = 0;
  task.requiredTicks = selected.path.length || WOOD_GATHER_TICKS;
  task.phase = selected.path.length ? 'walking_to_source' : 'gathering';
  task.blockedReason = null;
  residentStatus(resident);
  return true;
}

function activateWaitingTasks(world: PeaceWorldSnapshot): boolean {
  let changed = false;
  const residents = [...world.residents].sort((a, b) => a.id.localeCompare(b.id));
  for (const resident of residents) {
    const task = resident.task;
    if (!task) continue;
    if (task.kind === 'gather-wood' && (task.phase === 'waiting_resource' ||
        task.phase === 'waiting_path' && (task.sourceId === null || task.blockedReason === 'NO_PATH_TO_SOURCE'))) {
      changed = activateGatherTask(world, resident, task) || changed;
      continue;
    }
    if (task.kind === 'gather-wood' && task.phase === 'waiting_storage') {
      if (resident.cargo > 0 && world.resources.wood < world.storage.woodCapacity) {
        setGatherPhase(task, 'unloading', WOOD_UNLOADING_TICKS);
        task.blockedReason = null;
        residentStatus(resident);
        changed = true;
      }
      continue;
    }
    if (task.kind !== 'build-cabin' ||
        task.phase !== 'waiting_materials' && !(task.phase === 'waiting_path' && task.blockedReason === 'WORK_POINT_OCCUPIED')) {
      continue;
    }
    const building = world.buildings.find((candidate) => candidate.id === task.buildingId);
    if (!building) {
      task.phase = 'blocked';
      task.blockedReason = 'BUILDING_SITE_MISSING';
      residentStatus(resident);
      changed = true;
      continue;
    }
    if (building.reservedWood === 0 && world.resources.wood < WOOD_CABIN_COST) {
      task.phase = 'waiting_materials';
      task.blockedReason = 'INSUFFICIENT_WOOD';
      building.state = 'waiting_materials';
      residentStatus(resident);
      continue;
    }
    const placement = validateCabinPlacement(world, building.anchor, resident.id, {
      ignoreBuildingId: building.id,
      ignoreResidentTask: true
    });
    if (placement.reason === 'WAITING_WORK_POINT') {
      if (building.reservedWood === 0) {
        world.resources.wood -= WOOD_CABIN_COST;
        building.reservedWood = WOOD_CABIN_COST;
      }
      task.phase = 'waiting_path';
      task.blockedReason = 'WORK_POINT_OCCUPIED';
      building.state = 'planned';
      residentStatus(resident);
      changed = true;
      continue;
    }
    if (!placement.valid || !placement.route || !placement.workPoint) {
      task.phase = 'waiting_path';
      task.blockedReason = placement.reason;
      if (building.reservedWood === 0 && world.resources.wood >= WOOD_CABIN_COST) {
        world.resources.wood -= WOOD_CABIN_COST;
        building.reservedWood = WOOD_CABIN_COST;
      }
      building.state = building.reservedWood > 0 ? 'planned' : 'waiting_materials';
      residentStatus(resident);
      changed = true;
      continue;
    }
    if (building.reservedWood === 0) {
      if (world.resources.wood < WOOD_CABIN_COST) continue;
      world.resources.wood -= WOOD_CABIN_COST;
      building.reservedWood = WOOD_CABIN_COST;
    }
    building.state = 'planned';
    task.path = placement.route;
    task.pathIndex = 0;
    task.progressTicks = 0;
    task.requiredTicks = placement.route.length || CABIN_BUILD_TICKS;
    task.phase = placement.route.length ? 'walking_to_build' : 'building';
    task.blockedReason = null;
    residentStatus(resident);
    changed = true;
  }
  return changed;
}

export function advanceSettlement(world: PeaceWorldSnapshot, ticks: number): PeaceWorldSnapshot {
  if (!Number.isSafeInteger(ticks) || ticks < 0) throw new RangeError('ticks must be a nonnegative safe integer');
  const next = structuredClone(world);
  let remaining = ticks;
  const orderedResidents = [...next.residents].sort((a, b) => a.id.localeCompare(b.id));
  while (remaining > 0) {
    let changed = activateWaitingTasks(next);
    const hasRunnableWork = orderedResidents.some((resident) => {
      const phase = resident.task?.phase;
      return phase !== undefined && !['blocked', 'waiting_path', 'waiting_resource', 'waiting_materials', 'waiting_storage'].includes(phase);
    });
    if (!hasRunnableWork) {
      const waitingWoodcutters = orderedResidents.some((resident) => resident.task?.kind === 'gather-wood' &&
        resident.task.continuous && ['waiting_resource', 'waiting_path'].includes(resident.task.phase));
      const canRegrow = next.trees.some((tree) => tree.state !== 'uprooted' && tree.regrowthEveryTicks !== null &&
        tree.remaining < tree.maxRemaining);
      if (waitingWoodcutters && canRegrow) {
        next.revision.serverTick += 1;
        changed = advanceWoodland(next, 1) || changed;
        changed = activateWaitingTasks(next) || changed;
        if (changed) next.revision.worldVersion += 1;
        remaining -= 1;
        continue;
      }
      const regrew = advanceWoodland(next, remaining);
      if (regrew) {
        changed = true;
        changed = activateWaitingTasks(next) || changed;
      }
      next.revision.serverTick += remaining;
      if (changed) next.revision.worldVersion += 1;
      break;
    }

    next.revision.serverTick += 1;
    changed = advanceWoodland(next, 1) || changed;
    for (const resident of orderedResidents) {
      changed = advanceOneResidentTick(next, resident) || changed;
      residentStatus(resident);
    }
    changed = activateWaitingTasks(next) || changed;
    if (changed) next.revision.worldVersion += 1;
    remaining -= 1;
  }
  return next;
}

export function taskPhase(task: PeaceWorkerTask | null): string {
  return task?.phase ?? 'idle';
}
