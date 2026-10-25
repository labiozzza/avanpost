import type {
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
export const WOOD_CABIN_COST = 3;

type GatherWoodTask = Extract<NonNullable<PeaceWorkerTask>, { kind: 'gather-wood' }>;
type BuildCabinTask = Extract<NonNullable<PeaceWorldSnapshot['worker']['task']>, { kind: 'build-cabin' }>;

export type PlacementReason =
  | 'READY'
  | 'WORKER_BUSY'
  | 'CARGO_NOT_EMPTY'
  | 'RESOURCE_MISSING'
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

function placementWorkPoint(world: PeaceWorldSnapshot, anchor: { x: number; y: number }) {
  const candidates = [
    { x: anchor.x - 1, y: SURFACE_ROW },
    { x: anchor.x + CABIN_FOOTPRINT.width, y: SURFACE_ROW }
  ].sort((a, b) => Math.abs(a.x - world.worker.position.x) - Math.abs(b.x - world.worker.position.x) || a.x - b.x);
  for (const point of candidates) {
    const route = surfacePath(world.worker.position, point);
    if (route) return { point, route };
  }
  return null;
}

export function validateCabinPlacement(
  world: PeaceWorldSnapshot,
  anchor: { x: number; y: number }
): CabinPlacementValidation {
  const result = (reason: PlacementReason, extra: Partial<CabinPlacementValidation> = {}): CabinPlacementValidation => ({
    valid: reason === 'READY',
    reason,
    anchor,
    footprint: CABIN_FOOTPRINT,
    ...extra
  });

  if (!Number.isSafeInteger(anchor.x) || anchor.x < MIN_WORLD_X || anchor.x + CABIN_FOOTPRINT.width - 1 > MAX_WORLD_X) {
    return result('OUT_OF_WORLD');
  }
  if (anchor.y !== BUILDING_ROW) return result('INVALID_SURFACE');
  if (world.worker.cargo > 0) return result('CARGO_NOT_EMPTY');
  if (world.worker.task) return result('WORKER_BUSY');
  if (world.resources.wood < WOOD_CABIN_COST) return result('RESOURCE_MISSING');

  const cabinCells = new Set(Array.from({ length: CABIN_FOOTPRINT.width }, (_, index) => anchor.x + index));
  const storageCells = new Set(Array.from({ length: world.storage.footprint.width }, (_, index) => world.storage.anchor.x + index));
  if ([...cabinCells].some((x) => storageCells.has(x)) ||
      [...cabinCells].some((x) => world.buildings.some((building) =>
        building.anchor.y === anchor.y && x >= building.anchor.x && x < building.anchor.x + building.footprint.width)) ||
      world.trees.some((tree) => cabinCells.has(tree.position.x))) {
    return result('OCCUPIED');
  }

  const workPoint = placementWorkPoint(world, anchor);
  if (!workPoint) return result('NO_PATH');
  return result('READY', { workPoint: workPoint.point, route: workPoint.route });
}

export function createGatherWoodTask(world: PeaceWorldSnapshot, taskId: string, sourceId: string): GatherWoodTask | null {
  const source = world.trees.find((tree) => tree.id === sourceId);
  if (world.worker.task || world.worker.cargo > 0 || !source || source.remaining < 1 || source.state !== 'standing') return null;
  const sourceWorkPoint = { x: source.position.x - 1, y: SURFACE_ROW };
  const path = surfacePath(world.worker.position, sourceWorkPoint);
  if (!path) return null;
  const phase = path.length === 0 ? 'gathering' : 'walking_to_source';
  return {
    id: taskId,
    kind: 'gather-wood',
    phase,
    sourceId: source.id,
    destinationId: world.storage.id,
    path,
    pathIndex: 0,
    progressTicks: 0,
    requiredTicks: path.length || WOOD_GATHER_TICKS,
    blockedReason: null
  };
}

export function createDeliveryTask(world: PeaceWorldSnapshot, taskId: string, sourceId = 'recovered-cargo'): GatherWoodTask | null {
  if (world.worker.task || world.worker.cargo < 1) return null;
  const storageWorkPoint = { x: world.storage.anchor.x + world.storage.footprint.width, y: SURFACE_ROW };
  const path = surfacePath(world.worker.position, storageWorkPoint);
  if (!path) return null;
  const phase = path.length === 0 ? 'unloading' : 'carrying_to_storage';
  return {
    id: taskId,
    kind: 'gather-wood',
    phase,
    sourceId,
    destinationId: world.storage.id,
    path,
    pathIndex: 0,
    progressTicks: 0,
    requiredTicks: phase === 'unloading' ? WOOD_UNLOADING_TICKS : path.length,
    blockedReason: null
  };
}

export function createBuildCabinTask(
  world: PeaceWorldSnapshot,
  taskId: string,
  buildingId: string,
  anchor: { x: number; y: number }
): BuildCabinTask | null {
  const placement = validateCabinPlacement(world, anchor);
  if (!placement.valid || !placement.workPoint || !placement.route) return null;
  const phase = placement.route.length === 0 ? 'building' : 'walking_to_build';
  return {
    id: taskId,
    kind: 'build-cabin',
    phase,
    buildingId,
    path: placement.route,
    pathIndex: 0,
    progressTicks: 0,
    requiredTicks: phase === 'building' ? CABIN_BUILD_TICKS : placement.route.length,
    blockedReason: null
  };
}

function moveAlongPath(world: PeaceWorldSnapshot, task: PeaceWorkerTask): boolean {
  if (task.pathIndex >= task.path.length) return true;
  const point = task.path[task.pathIndex];
  if (!point) return true;
  world.worker.position = { ...point };
  task.pathIndex += 1;
  task.progressTicks = task.pathIndex;
  return task.pathIndex >= task.path.length;
}

function setGatherPhase(task: GatherWoodTask, phase: GatherWoodTask['phase'], requiredTicks: number): void {
  task.phase = phase;
  task.progressTicks = 0;
  task.requiredTicks = requiredTicks;
}

function updateCabinStage(world: PeaceWorldSnapshot, task: BuildCabinTask): void {
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
    world.worker.task = null;
    world.worker.visualState = 'idle';
    return;
  }
  building.state = building.progressTicks < 3 ? 'foundation' : 'scaffold';
  task.progressTicks = building.progressTicks;
}

function advanceWoodland(world: PeaceWorldSnapshot, ticks: number): boolean {
  if (ticks < 1) return false;
  let sourceBecameAvailable = false;
  for (const tree of world.trees) {
    if (tree.sourceKind !== 'renewable_plot' || tree.state !== 'stump' || tree.remaining > 0 ||
        tree.regrowthEveryTicks === null) continue;
    const accumulated = tree.regrowthProgressTicks + ticks;
    if (accumulated >= tree.regrowthEveryTicks) {
      tree.remaining = Math.min(tree.maxRemaining, 1);
      tree.state = 'standing';
      tree.regrowthProgressTicks = 0;
      sourceBecameAvailable = true;
    } else {
      tree.regrowthProgressTicks = accumulated;
    }
  }
  return sourceBecameAvailable;
}

function harvestSource(world: PeaceWorldSnapshot, task: GatherWoodTask): PeaceTreeNode | undefined {
  return world.trees.find((tree) => tree.id === task.sourceId);
}

function advanceOneTick(world: PeaceWorldSnapshot): boolean {
  const task = world.worker.task;
  if (!task || task.phase === 'blocked' || task.phase === 'waiting_path') return false;
  world.worker.visualState = task.phase;

  if (task.kind === 'gather-wood') {
    if (task.phase === 'walking_to_source' || task.phase === 'carrying_to_storage') {
      const arrived = moveAlongPath(world, task);
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
        task.phase = 'blocked';
        task.blockedReason = 'RESOURCE_MISSING';
        world.worker.visualState = 'blocked';
        return true;
      }
      source.remaining -= 1;
      if (source.remaining === 0) {
        source.state = 'stump';
        source.regrowthProgressTicks = 0;
      }
      world.worker.cargo += 1;
      const storageWorkPoint = { x: world.storage.anchor.x + world.storage.footprint.width, y: SURFACE_ROW };
      const path = surfacePath(world.worker.position, storageWorkPoint);
      if (!path) {
        task.phase = 'waiting_path';
        task.blockedReason = 'NO_PATH_TO_STORAGE';
        world.worker.visualState = 'waiting_path';
        return true;
      }
      task.path = path;
      task.pathIndex = 0;
      setGatherPhase(task, path.length === 0 ? 'unloading' : 'carrying_to_storage',
        path.length === 0 ? WOOD_UNLOADING_TICKS : path.length);
      return true;
    }
    if (task.phase === 'unloading') {
      world.resources.wood += world.worker.cargo;
      world.worker.cargo = 0;
      world.worker.task = null;
      world.worker.visualState = 'idle';
      return true;
    }
    return false;
  }

  if (task.phase === 'walking_to_build') {
    const arrived = moveAlongPath(world, task);
    if (arrived) {
      task.phase = 'building';
      task.progressTicks = 0;
      task.requiredTicks = CABIN_BUILD_TICKS;
      world.worker.visualState = 'building';
    }
    return true;
  }
  updateCabinStage(world, task);
  return true;
}

export function advanceSettlement(world: PeaceWorldSnapshot, ticks: number): PeaceWorldSnapshot {
  if (!Number.isSafeInteger(ticks) || ticks < 0) throw new RangeError('ticks must be a nonnegative safe integer');
  const next = structuredClone(world);
  let remaining = ticks;
  while (remaining > 0 && next.worker.task &&
      next.worker.task.phase !== 'blocked' && next.worker.task.phase !== 'waiting_path') {
    next.revision.serverTick += 1;
    const regrew = advanceWoodland(next, 1);
    if (advanceOneTick(next) || regrew) next.revision.worldVersion += 1;
    if (next.worker.task) next.worker.visualState = next.worker.task.phase;
    remaining -= 1;
  }
  if (remaining > 0) {
    if (advanceWoodland(next, remaining)) next.revision.worldVersion += 1;
    next.revision.serverTick += remaining;
  }
  return next;
}

export function taskPhase(task: PeaceWorkerTask | null): string {
  return task?.phase ?? 'idle';
}
