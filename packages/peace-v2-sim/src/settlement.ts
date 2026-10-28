import type {
  PeaceBuildOrder,
  PeaceBuilding,
  PeaceCargoItem,
  PeaceResident,
  PeaceStoneDeposit,
  PeaceTreeNode,
  PeaceWorldSnapshot,
  PeaceWorkerTask
} from '@avanpost/peace-v2-shared';
import { G33_STONE_BALANCE } from './g33-stone-config.js';

export const PEACE_V2_TICK_INTERVAL_MS = 500;
export const CABIN_FOOTPRINT = { width: 2, height: 1 } as const;
export const CABIN_BUILD_TICKS = 10;
export const WOOD_GATHER_TICKS = 4;
export const WOOD_LOADING_TICKS = 1;
export const WOOD_UNLOADING_TICKS = 2;
export const WOOD_REGROWTH_TICKS = 100;
export const COPPICE_REGROWTH_TICKS = 1200;
export const WOOD_CABIN_COST = 3;
export const WORKSHOP_BUILD_TICKS = CABIN_BUILD_TICKS;
export const STONE_MINER_ROLE = G33_STONE_BALANCE.workRole;
export const STONE_NODE_CONFIG = G33_STONE_BALANCE.stoneNode;
export const WORKSHOP_MATERIALS = G33_STONE_BALANCE.workshop.constructionMaterials;

type GatherWoodTask = Extract<NonNullable<PeaceWorkerTask>, { kind: 'gather-wood' }>;
type GatherStoneTask = Extract<NonNullable<PeaceWorkerTask>, { kind: 'gather-stone' }>;
type BuildCabinTask = Extract<NonNullable<PeaceResident['task']>, { kind: 'build-cabin' }>;
type BuildWorkshopTask = Extract<NonNullable<PeaceResident['task']>, { kind: 'build-workshop' }>;
type BuildTask = BuildCabinTask | BuildWorkshopTask;
type Resident = PeaceWorldSnapshot['residents'][number];
type BuildingKind = PeaceBuilding['kind'];

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
  materialsReserved?: boolean;
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

function storedResourceTotal(world: PeaceWorldSnapshot): number {
  return world.resources.wood + world.resources.stone;
}

function availableStorageCapacity(world: PeaceWorldSnapshot): number {
  return Math.max(0, world.storage.capacity - storedResourceTotal(world));
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
    const buildingBlocksPoint = world.buildings.some((building) => building.state !== 'cancelled' && building.id !== ignoreBuildingId &&
      building.anchor.y === point.y && point.x >= building.anchor.x && point.x < building.anchor.x + building.footprint.width);
    const occupiedByResident = world.residents.some((other) => other.id !== resident.id && samePoint(other.position, point));
    const reservedByWorksiteTask = ignoreBuildingId !== undefined && world.residents.some((other) => {
      if (other.id === resident.id || !other.task) return false;
      const task = other.task;
      const taskBuildingId = task.kind === 'build-cabin' || task.kind === 'build-workshop'
        ? task.buildingId
        : task.kind === 'gather-stone' ? task.buildingId : undefined;
      if (taskBuildingId !== ignoreBuildingId) return false;
      const target = task.path[task.path.length - 1] ?? other.position;
      return samePoint(target, point);
    });
    if (!buildingBlocksPoint && !occupiedByResident && !reservedByWorksiteTask) {
      return { point, route, waitReason: null as string | null };
    }
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
  if (resident.cargo > 0 && !options.ignoreResidentTask) return result('CARGO_NOT_EMPTY');
  if (resident.task && !options.ignoreResidentTask) return result('WORKER_BUSY');

  const cabinCells = new Set(Array.from({ length: CABIN_FOOTPRINT.width }, (_, index) => anchor.x + index));
  const storageCells = new Set(Array.from({ length: world.storage.footprint.width }, (_, index) => world.storage.anchor.x + index));
  if ([...cabinCells].some((x) => storageCells.has(x)) ||
       [...cabinCells].some((x) => world.buildings.some((building) =>
         building.id !== options.ignoreBuildingId && building.anchor.y === anchor.y &&
          building.state !== 'cancelled' && x >= building.anchor.x && x < building.anchor.x + building.footprint.width)) ||
        world.trees.some((tree) => tree.state !== 'uprooted' && cabinCells.has(tree.position.x))) {
    return result('OCCUPIED');
  }

  const workPoint = placementWorkPoint(world, resident, anchor, options.ignoreBuildingId);
  if (!workPoint) return result('NO_PATH');
  const placementReason = world.resources.wood < WOOD_CABIN_COST && !options.materialsReserved
    ? 'WAITING_MATERIALS'
    : workPoint.waitReason ? 'WAITING_WORK_POINT' : 'READY';
  return result(placementReason, { workPoint: workPoint.point, route: workPoint.route });
}

export function validateCabinOrderPlacement(
  world: PeaceWorldSnapshot,
  anchor: { x: number; y: number },
  ignoreBuildingId?: string
): CabinPlacementValidation {
  const candidates = [...world.residents]
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((resident) => validateCabinPlacement(world, anchor, resident.id, {
      ignoreBuildingId,
      ignoreResidentTask: true
    }));
  const routes = candidates.filter((candidate) => candidate.valid && candidate.route && candidate.workPoint);
  routes.sort((a, b) => {
    const waitingDifference = Number(a.reason === 'WAITING_WORK_POINT') - Number(b.reason === 'WAITING_WORK_POINT');
    return waitingDifference || a.route!.length - b.route!.length;
  });
  if (routes[0]) return routes[0];
  return candidates[0] ?? {
    valid: false, reason: 'NO_PATH', anchor, footprint: CABIN_FOOTPRINT
  };
}

export function validateWorkshopOrderPlacement(
  world: PeaceWorldSnapshot,
  anchor: { x: number; y: number },
  ignoreBuildingId?: string
): CabinPlacementValidation {
  const builders = world.residents.filter((resident) => resident.workRole === 'builder');
  const candidates = [...(builders.length > 0 ? builders : world.residents)]
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((resident) => validateCabinPlacement(world, anchor, resident.id, {
      ignoreBuildingId,
      ignoreResidentTask: true,
      materialsReserved: true
    }));
  const routes = candidates.filter((candidate) => candidate.valid && candidate.route && candidate.workPoint);
  routes.sort((a, b) => {
    const waitingDifference = Number(a.reason === 'WAITING_WORK_POINT') - Number(b.reason === 'WAITING_WORK_POINT');
    return waitingDifference || a.route!.length - b.route!.length;
  });
  const selected = routes[0] ?? candidates[0];
  if (!selected) return { valid: false, reason: 'NO_PATH', anchor, footprint: CABIN_FOOTPRINT };
  const missingMaterials = world.resources.wood < WORKSHOP_MATERIALS.wood ||
    world.resources.stone < WORKSHOP_MATERIALS.stone;
  const reason = selected.reason === 'NO_PATH' || selected.reason === 'WAITING_WORK_POINT'
    ? selected.reason : missingMaterials ? 'WAITING_MATERIALS' : selected.reason;
  return { ...selected, reason, valid: selected.valid || reason === 'WAITING_MATERIALS' };
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

function stoneDepositReservedByAnother(world: PeaceWorldSnapshot, residentId: string, depositId: string): boolean {
  return world.residents.some((resident) => resident.id !== residentId && resident.task?.kind === 'gather-stone' &&
    resident.task.sourceId === depositId && resident.task.phase !== 'waiting_resource');
}

function stoneWorkPoint(deposit: PeaceStoneDeposit): { x: number; y: number } {
  // G3.3 is the approved shallow outcrop at y=1; miners stand directly above it on the surface.
  return { x: deposit.position.x, y: SURFACE_ROW };
}

function selectStoneDeposit(
  world: PeaceWorldSnapshot,
  residentId: string,
  preferredDepositId?: string | null
): { deposit: PeaceStoneDeposit; path: Array<{ x: number; y: number }> } | null {
  const resident = world.residents.find((candidate) => candidate.id === residentId);
  if (!resident) return null;
  const reachable = world.stoneDeposits.flatMap((deposit) => {
    if ((deposit.remaining < 1 && deposit.bufferQuantity < 1) ||
        stoneDepositReservedByAnother(world, residentId, deposit.id)) return [];
    const path = surfacePath(resident.position, stoneWorkPoint(deposit));
    return path ? [{ deposit, path }] : [];
  });
  reachable.sort((a, b) => {
    if (a.deposit.id === preferredDepositId) return -1;
    if (b.deposit.id === preferredDepositId) return 1;
    return a.path.length - b.path.length || a.deposit.id.localeCompare(b.deposit.id);
  });
  return reachable[0] ?? null;
}

export function createGatherStoneTask(
  world: PeaceWorldSnapshot,
  residentId: string,
  taskId: string
): GatherStoneTask | null {
  const resident = world.residents.find((candidate) => candidate.id === residentId);
  if (!resident || resident.workRole !== STONE_MINER_ROLE || resident.task || resident.cargo > 0) return null;
  const selected = selectStoneDeposit(world, residentId);
  if (!selected) return {
    id: taskId,
    kind: 'gather-stone',
    phase: 'waiting_resource',
    sourceId: null,
    destinationId: world.storage.id,
    path: [],
    pathIndex: 0,
    progressTicks: 0,
    requiredTicks: 1,
    blockedReason: 'STONE_DEPOSIT_DEPLETED',
    continuous: true,
    cancelAfterDelivery: false,
    assignmentSource: 'workRole'
  };
  const canLoad = selected.deposit.bufferQuantity >= 1 || selected.deposit.remaining < 1;
  const phase = selected.path.length > 0 ? 'walking_to_source' : canLoad ? 'loading' : 'mining';
  return {
    id: taskId,
    kind: 'gather-stone',
    phase,
    sourceId: selected.deposit.id,
    destinationId: world.storage.id,
    path: phase === 'walking_to_source' ? selected.path : [],
    pathIndex: 0,
    progressTicks: 0,
    requiredTicks: phase === 'walking_to_source' ? selected.path.length : phase === 'loading' ? WOOD_LOADING_TICKS : 1,
    blockedReason: null,
    continuous: true,
    cancelAfterDelivery: false,
    assignmentSource: 'workRole'
  };
}

export function createStoneDeliveryTask(world: PeaceWorldSnapshot, residentId: string, taskId: string): GatherStoneTask | null {
  const resident = world.residents.find((candidate) => candidate.id === residentId);
  if (!resident || resident.task || resident.cargo < 1 || resident.cargoItemId !== 'stone') return null;
  const storagePoint = { x: world.storage.anchor.x + world.storage.footprint.width, y: SURFACE_ROW };
  const path = surfacePath(resident.position, storagePoint);
  if (!path) return null;
  const phase = path.length > 0 ? 'carrying_to_storage' : 'unloading';
  const continuous = resident.workRole === STONE_MINER_ROLE;
  return {
    id: taskId,
    kind: 'gather-stone',
    phase,
    sourceId: null,
    destinationId: world.storage.id,
    path,
    pathIndex: 0,
    progressTicks: 0,
    requiredTicks: path.length || WOOD_UNLOADING_TICKS,
    blockedReason: null,
    continuous,
    cancelAfterDelivery: !continuous,
    assignmentSource: 'recovery'
  };
}

function stoneWaitReason(world: PeaceWorldSnapshot, residentId: string): string {
  const accessibleStock = world.stoneDeposits.some((deposit) =>
    (deposit.remaining > 0 || deposit.bufferQuantity > 0) &&
    !stoneDepositReservedByAnother(world, residentId, deposit.id)
  );
  if (accessibleStock) return 'NO_PATH_TO_STONE';
  if (world.stoneDeposits.some((deposit) => deposit.remaining > 0 || deposit.bufferQuantity > 0)) return 'STONE_SOURCE_RESERVED';
  return 'STONE_DEPOSIT_EXHAUSTED';
}

function activateStoneTask(world: PeaceWorldSnapshot, resident: Resident, task: GatherStoneTask): boolean {
  const previous = `${task.phase}:${task.sourceId ?? ''}:${task.blockedReason ?? ''}`;
  const selected = selectStoneDeposit(world, resident.id, task.sourceId);
  if (!selected) {
    task.phase = 'waiting_resource';
    task.sourceId = null;
    task.path = [];
    task.pathIndex = 0;
    task.progressTicks = 0;
    task.requiredTicks = 1;
    task.blockedReason = stoneWaitReason(world, resident.id);
    residentStatus(resident);
    return previous !== `${task.phase}:${task.sourceId ?? ''}:${task.blockedReason ?? ''}`;
  }
  task.sourceId = selected.deposit.id;
  task.path = selected.path;
  task.pathIndex = 0;
  task.progressTicks = 0;
  task.phase = selected.path.length > 0 ? 'walking_to_source'
    : selected.deposit.bufferQuantity >= selected.deposit.bufferCapacity || selected.deposit.remaining === 0 ? 'loading' : 'mining';
  task.requiredTicks = task.phase === 'walking_to_source' ? selected.path.length
    : task.phase === 'loading' ? WOOD_LOADING_TICKS : 1;
  task.blockedReason = null;
  residentStatus(resident);
  return true;
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
    cancelAfterDelivery: false,
    assignmentSource: 'manual'
  };
}

export function createGatherWoodTask(
  world: PeaceWorldSnapshot,
  residentId: string,
  taskId: string,
  preferredSourceId?: string,
  assignmentSource: GatherWoodTask['assignmentSource'] = 'manual'
): GatherWoodTask | null {
  const resident = world.residents.find((candidate) => candidate.id === residentId);
  if (!resident || resident.task || resident.cargo > 0) return null;
  const selected = selectWoodSource(world, residentId, preferredSourceId);
  if (!selected) {
    const waiting = waitingGatherTask(taskId, world.storage.id, 'NO_AVAILABLE_TREES');
    waiting.assignmentSource = assignmentSource;
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
    cancelAfterDelivery: false,
    assignmentSource
  };
}

export function createDeliveryTask(
  world: PeaceWorldSnapshot,
  residentId: string,
  taskId: string,
  _sourceId = 'recovered-cargo',
  assignmentSource: GatherWoodTask['assignmentSource'] = 'manual'
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
    cancelAfterDelivery: false,
    assignmentSource
  };
}

export function createBuildCabinTask(
  world: PeaceWorldSnapshot,
  residentId: string,
  taskId: string,
  buildingId: string,
  orderId: string,
  anchor: { x: number; y: number }
): BuildCabinTask | null {
  const resident = world.residents.find((candidate) => candidate.id === residentId);
  const building = world.buildings.find((candidate) => candidate.id === buildingId);
  const carriedWood = resident?.cargoItemId === 'wood' ? resident.cargo : 0;
  const materialsAvailable = (building?.reservedWood ?? 0) + world.resources.wood + carriedWood >= WOOD_CABIN_COST;
  const placement = validateCabinPlacement(world, anchor, residentId, {
    ignoreBuildingId: buildingId,
    ignoreResidentTask: true,
    materialsReserved: materialsAvailable
  });
  if (!placement.valid || !placement.workPoint || !placement.route) return null;
  const phase = placement.reason === 'WAITING_MATERIALS'
    ? 'waiting_materials'
    : placement.reason === 'WAITING_WORK_POINT'
      ? 'waiting_path'
      : resident?.cargoItemId === 'wood' && resident.cargo > 0 ? 'carrying_materials_to_build'
        : placement.route.length === 0 ? 'building' : 'walking_to_build';
  return {
    id: taskId,
    kind: 'build-cabin',
    phase,
    buildingId,
    orderId,
    path: phase === 'waiting_materials' || phase === 'waiting_path' ? [] : placement.route,
    pathIndex: 0,
    progressTicks: 0,
    requiredTicks: phase === 'building' ? CABIN_BUILD_TICKS : phase === 'waiting_path' || phase === 'waiting_materials'
      ? 1 : placement.route.length || 1,
    blockedReason: placement.reason === 'WAITING_WORK_POINT' ? 'WORK_POINT_OCCUPIED'
      : placement.reason === 'WAITING_MATERIALS' ? 'INSUFFICIENT_WOOD' : null
  };
}

export function createBuildWorkshopTask(
  world: PeaceWorldSnapshot,
  residentId: string,
  taskId: string,
  buildingId: string,
  orderId: string,
  anchor: { x: number; y: number }
): BuildWorkshopTask | null {
  const resident = world.residents.find((candidate) => candidate.id === residentId);
  const building = world.buildings.find((candidate) => candidate.id === buildingId);
  const placement = validateCabinPlacement(world, anchor, residentId, {
    ignoreBuildingId: buildingId, ignoreResidentTask: true, materialsReserved: true
  });
  if (!placement.valid || !placement.workPoint || !placement.route) return null;
  const phase = placement.reason === 'WAITING_WORK_POINT' ? 'waiting_path'
    : resident?.cargoItemId === 'wood' && resident.cargo > 0 && (building?.reservedWood ?? 0) < WORKSHOP_MATERIALS.wood
      ? 'carrying_materials_to_build'
      : placement.route.length === 0 ? 'building' : 'walking_to_build';
  return {
    id: taskId,
    kind: 'build-workshop',
    phase,
    buildingId,
    orderId,
    path: phase === 'waiting_path' ? [] : placement.route,
    pathIndex: 0,
    progressTicks: 0,
    requiredTicks: phase === 'building' ? WORKSHOP_BUILD_TICKS : phase === 'waiting_path' ? 1 : placement.route.length || 1,
    blockedReason: placement.reason === 'WAITING_WORK_POINT' ? 'WORK_POINT_OCCUPIED' : null
  };
}

export function createBuildCabinOrder(
  world: PeaceWorldSnapshot,
  orderId: string,
  buildingId: string,
  anchor: { x: number; y: number },
  queuePosition: number
): { order: PeaceBuildOrder; building: PeaceWorldSnapshot['buildings'][number] } | null {
  const placement = validateCabinOrderPlacement(world, anchor);
  if (!placement.valid) return null;
  const status = world.resources.wood < WOOD_CABIN_COST ? 'waiting_materials'
    : placement.reason === 'WAITING_WORK_POINT' ? 'waiting_path' : 'waiting_builder';
  const buildingState = status === 'waiting_materials' ? 'waiting_materials'
    : status === 'waiting_path' ? 'planned' : 'waiting_builder';
  return {
    order: {
      id: orderId,
      buildingId,
      queuePosition,
      status,
      assignedResidentId: null,
      blockedReason: status === 'waiting_materials' ? 'INSUFFICIENT_WOOD'
        : status === 'waiting_path' ? 'WORK_POINT_OCCUPIED' : 'NO_BUILDER'
    },
    building: {
      id: buildingId,
      kind: 'cabin',
      orderId,
      anchor,
      footprint: { ...CABIN_FOOTPRINT },
      state: buildingState,
      progressTicks: 0,
      progressRequired: CABIN_BUILD_TICKS,
      reservedWood: 0,
      reservedStone: 0
    }
  };
}

export function createBuildWorkshopOrder(
  world: PeaceWorldSnapshot,
  orderId: string,
  buildingId: string,
  anchor: { x: number; y: number },
  queuePosition: number
): { order: PeaceBuildOrder; building: PeaceWorldSnapshot['buildings'][number] } | null {
  const placement = validateWorkshopOrderPlacement(world, anchor);
  if (!placement.valid) return null;
  const missingWood = world.resources.wood < WORKSHOP_MATERIALS.wood;
  const missingStone = world.resources.stone < WORKSHOP_MATERIALS.stone;
  const status: PeaceBuildOrder['status'] = missingWood || missingStone ? 'waiting_materials'
    : placement.reason === 'WAITING_WORK_POINT' ? 'waiting_path' : 'waiting_builder';
  const blockedReason = missingStone ? 'INSUFFICIENT_STONE'
    : missingWood ? 'INSUFFICIENT_WOOD'
      : status === 'waiting_path' ? 'WORK_POINT_OCCUPIED' : 'NO_BUILDER';
  return {
    order: { id: orderId, buildingId, queuePosition, status, assignedResidentId: null, blockedReason },
    building: {
      id: buildingId,
      kind: 'workshop',
      orderId,
      anchor,
      footprint: { ...CABIN_FOOTPRINT },
      state: status === 'waiting_materials' ? 'waiting_materials' : status === 'waiting_path' ? 'planned' : 'waiting_builder',
      progressTicks: 0,
      progressRequired: WORKSHOP_BUILD_TICKS,
      reservedWood: 0,
      reservedStone: 0
    }
  };
}

export function moveBuildOrder(world: PeaceWorldSnapshot, orderId: string, direction: 'up' | 'down'): boolean {
  const waiting = world.buildOrders.filter((order) =>
    ['waiting_materials', 'waiting_builder', 'waiting_path'].includes(order.status)
  ).sort((a, b) => a.queuePosition - b.queuePosition || a.id.localeCompare(b.id));
  const index = waiting.findIndex((order) => order.id === orderId);
  const adjacent = waiting[index + (direction === 'up' ? -1 : 1)];
  const current = waiting[index];
  if (!current || !adjacent) return false;
  const position = current.queuePosition;
  current.queuePosition = adjacent.queuePosition;
  adjacent.queuePosition = position;
  return true;
}

export function cancelUnstartedBuildOrder(world: PeaceWorldSnapshot, orderId: string): boolean {
  const order = world.buildOrders.find((candidate) => candidate.id === orderId);
  const building = order ? world.buildings.find((candidate) => candidate.id === order.buildingId) : undefined;
  const assignedResident = order?.assignedResidentId
    ? world.residents.find((resident) => resident.id === order.assignedResidentId) : undefined;
  const safeToCancelAssignedWait = assignedResident?.task &&
    (assignedResident.task.kind === 'build-cabin' || assignedResident.task.kind === 'build-workshop') &&
    assignedResident.task.orderId === orderId &&
    ['walking_to_build', 'carrying_materials_to_build', 'building', 'waiting_path', 'waiting_materials', 'blocked']
      .includes(assignedResident.task.phase);
  if (!order || !building || order.assignedResidentId && !safeToCancelAssignedWait || building.progressTicks > 0 ||
      !['waiting_materials', 'waiting_builder', 'waiting_path', 'in_progress', 'blocked'].includes(order.status)) return false;
  if (storedResourceTotal(world) + building.reservedWood + building.reservedStone > world.storage.capacity) return false;
  if (safeToCancelAssignedWait && assignedResident) {
    assignedResident.task = null;
    residentStatus(assignedResident);
  }
  world.resources.wood += building.reservedWood;
  world.resources.stone += building.reservedStone;
  building.reservedWood = 0;
  building.reservedStone = 0;
  building.state = 'cancelled';
  order.status = 'cancelled';
  order.assignedResidentId = null;
  order.blockedReason = null;
  for (const resident of world.residents) {
    const task = resident.task;
    if (task?.kind !== 'gather-stone' || task.orderId !== orderId || task.buildingId !== building.id) continue;
    clearStoneWorksiteTarget(task);
    sendStoneCargoToStorage(world, resident, task);
  }
  return true;
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

function updateBuildingStage(world: PeaceWorldSnapshot, resident: Resident, task: BuildTask): void {
  const building = world.buildings.find((candidate) => candidate.id === task.buildingId);
  const order = world.buildOrders.find((candidate) => candidate.id === task.orderId);
  if (!building || !order) {
    task.phase = 'blocked';
    task.blockedReason = !building ? 'BUILDING_SITE_MISSING' : 'BUILD_ORDER_MISSING';
    return;
  }
  const missingMaterials = buildingSiteMaterialWaitReason(building);
  if (missingMaterials) {
    task.phase = 'waiting_materials';
    task.blockedReason = missingMaterials;
    building.state = 'waiting_materials';
    order.status = 'in_progress';
    order.blockedReason = missingMaterials;
    residentStatus(resident);
    return;
  }
  building.progressTicks = Math.min(building.progressRequired, building.progressTicks + 1);
  if (building.progressTicks >= building.progressRequired) {
    building.state = 'complete';
    building.reservedWood = 0;
    building.reservedStone = 0;
    order.status = 'completed';
    order.assignedResidentId = null;
    order.blockedReason = null;
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
  const capacity = availableStorageCapacity(world);
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
  resident.cargoItemId = null;
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

function finishStoneDelivery(world: PeaceWorldSnapshot, resident: Resident, task: GatherStoneTask): void {
  const capacity = availableStorageCapacity(world);
  if (resident.cargo < 1 || resident.cargoItemId !== 'stone') {
    task.phase = 'blocked';
    task.blockedReason = 'CARGO_RESOURCE_MISMATCH';
    return;
  }
  if (capacity < 1) {
    task.phase = 'waiting_storage';
    task.blockedReason = 'STORAGE_FULL';
    task.progressTicks = 0;
    task.requiredTicks = WOOD_UNLOADING_TICKS;
    return;
  }
  const delivered = Math.min(capacity, resident.cargo);
  world.resources.stone += delivered;
  resident.cargo -= delivered;
  if (resident.cargo > 0) {
    task.phase = 'waiting_storage';
    task.blockedReason = 'STORAGE_FULL';
    task.progressTicks = 0;
    task.requiredTicks = WOOD_UNLOADING_TICKS;
    return;
  }
  resident.cargoItemId = null;
  if (!task.continuous || task.cancelAfterDelivery) {
    resident.task = null;
    return;
  }
  task.sourceId = null;
  task.phase = 'waiting_resource';
  task.blockedReason = stoneWaitReason(world, resident.id);
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
  resident.visualState = task.kind === 'gather-stone'
    ? task.phase === 'walking_to_source' ? 'walking_to_stone'
      : task.phase === 'mining' ? 'mining_stone'
        : task.phase === 'loading' ? 'loading_stone'
          : task.phase === 'carrying_to_build' ? 'carrying_stone_to_build'
            : task.phase === 'unloading_at_building' ? 'unloading_stone_at_build'
              : task.phase === 'carrying_to_storage' ? 'carrying_stone_to_storage'
            : task.phase === 'unloading' ? 'unloading_stone'
              : task.phase === 'waiting_resource' ? 'waiting_stone_source'
                : task.phase === 'waiting_storage' ? 'waiting_stone_storage' : task.phase
    : task.phase;
  resident.blockedReason = task.blockedReason;
  if (task.phase === 'blocked') resident.state = 'blocked';
  else if (['waiting_path', 'waiting_resource', 'waiting_materials', 'waiting_storage'].includes(task.phase)) resident.state = 'waiting';
  else resident.state = 'working';
}

function setStonePhase(task: GatherStoneTask, phase: GatherStoneTask['phase'], requiredTicks = 1): void {
  task.phase = phase;
  task.progressTicks = 0;
  task.requiredTicks = Math.max(1, requiredTicks);
}

function clearStoneWorksiteTarget(task: GatherStoneTask): void {
  delete task.buildingId;
  delete task.orderId;
  delete task.deliveryQuantity;
}

function sendStoneCargoToStorage(world: PeaceWorldSnapshot, resident: Resident, task: GatherStoneTask): void {
  clearStoneWorksiteTarget(task);
  const storagePoint = { x: world.storage.anchor.x + world.storage.footprint.width, y: SURFACE_ROW };
  const path = surfacePath(resident.position, storagePoint);
  if (!path) {
    setStonePhase(task, 'waiting_path');
    task.blockedReason = 'NO_PATH_TO_STORAGE';
    task.path = [];
    task.pathIndex = 0;
    residentStatus(resident);
    return;
  }
  task.path = path;
  task.pathIndex = 0;
  setStonePhase(task, path.length > 0 ? 'carrying_to_storage' : 'unloading',
    path.length > 0 ? path.length : WOOD_UNLOADING_TICKS);
  task.blockedReason = null;
  residentStatus(resident);
}

function finishStoneWorksiteDelivery(world: PeaceWorldSnapshot, resident: Resident, task: GatherStoneTask): void {
  const building = task.buildingId ? world.buildings.find((candidate) => candidate.id === task.buildingId) : undefined;
  const order = task.orderId ? world.buildOrders.find((candidate) => candidate.id === task.orderId) : undefined;
  if (!building || building.kind !== 'workshop' || !order || order.status === 'cancelled' || order.status === 'completed') {
    sendStoneCargoToStorage(world, resident, task);
    return;
  }

  const stoneNeeded = Math.max(0, WORKSHOP_MATERIALS.stone - building.reservedStone);
  const delivered = Math.min(task.deliveryQuantity ?? 0, stoneNeeded, resident.cargo);
  if (resident.cargoItemId !== 'stone' || delivered < 1) {
    sendStoneCargoToStorage(world, resident, task);
    return;
  }

  resident.cargo -= delivered;
  building.reservedStone += delivered;
  clearStoneWorksiteTarget(task);
  order.blockedReason = buildingSiteMaterialWaitReason(building);
  if (resident.cargo > 0) {
    if (task.continuous && !task.cancelAfterDelivery && redirectStoneRemainderToQueuedWorkshop(world, resident, task)) {
      return;
    }
    sendStoneCargoToStorage(world, resident, task);
  } else if (!task.continuous || task.cancelAfterDelivery) {
    resident.cargoItemId = null;
    resident.task = null;
    residentStatus(resident);
  } else {
    resident.cargoItemId = null;
    task.sourceId = null;
    task.path = [];
    task.pathIndex = 0;
    setStonePhase(task, 'waiting_resource');
    task.blockedReason = stoneWaitReason(world, resident.id);
    residentStatus(resident);
  }
}

function advanceStoneTaskTick(world: PeaceWorldSnapshot, resident: Resident, task: GatherStoneTask): boolean {
  if (task.phase === 'carrying_to_build') {
    if (!moveAlongPath(resident, task)) return true;
    setStonePhase(task, 'unloading_at_building', WOOD_UNLOADING_TICKS);
    task.blockedReason = null;
    residentStatus(resident);
    return true;
  }

  if (task.phase === 'walking_to_source' || task.phase === 'carrying_to_storage') {
    if (task.phase === 'walking_to_source') {
      const deposit = world.stoneDeposits.find((candidate) => candidate.id === task.sourceId);
      if (!deposit || deposit.remaining === 0 && deposit.bufferQuantity === 0) return activateStoneTask(world, resident, task);
    }
    if (!moveAlongPath(resident, task)) return true;
    if (task.phase === 'walking_to_source') {
      const deposit = world.stoneDeposits.find((candidate) => candidate.id === task.sourceId);
      if (!deposit) {
        setStonePhase(task, 'waiting_resource');
        task.sourceId = null;
        task.blockedReason = 'STONE_DEPOSIT_MISSING';
      } else {
        const loadable = deposit.bufferQuantity >= deposit.bufferCapacity || deposit.remaining === 0;
        setStonePhase(task, loadable ? 'loading' : 'mining', loadable ? WOOD_LOADING_TICKS : 1);
        task.blockedReason = null;
      }
    } else {
      setStonePhase(task, 'unloading', WOOD_UNLOADING_TICKS);
      task.blockedReason = null;
    }
    residentStatus(resident);
    return true;
  }

  if (task.phase === 'mining') {
    const deposit = world.stoneDeposits.find((candidate) => candidate.id === task.sourceId);
    if (!deposit) {
      setStonePhase(task, 'blocked');
      task.blockedReason = 'STONE_DEPOSIT_MISSING';
      residentStatus(resident);
      return true;
    }
    const mined = Math.min(deposit.yieldPerTick, deposit.remaining,
      deposit.bufferCapacity - deposit.bufferQuantity);
    if (mined < 1) {
      if (deposit.bufferQuantity > 0) {
        setStonePhase(task, 'loading', WOOD_LOADING_TICKS);
        task.blockedReason = null;
      } else {
        setStonePhase(task, 'waiting_resource');
        task.blockedReason = 'STONE_DEPOSIT_EXHAUSTED';
      }
      residentStatus(resident);
      return true;
    }
    deposit.remaining -= mined;
    deposit.bufferQuantity += mined;
    if (deposit.remaining === 0) deposit.state = 'depleted';
    if (deposit.bufferQuantity >= deposit.bufferCapacity || deposit.remaining === 0) {
      setStonePhase(task, 'loading', WOOD_LOADING_TICKS);
    } else {
      task.progressTicks = 0;
      task.requiredTicks = 1;
    }
    residentStatus(resident);
    return true;
  }

  if (task.phase === 'loading') {
    task.progressTicks += 1;
    if (task.progressTicks < task.requiredTicks) return true;
    const deposit = world.stoneDeposits.find((candidate) => candidate.id === task.sourceId);
    if (!deposit || deposit.bufferQuantity < 1 || resident.cargo > 0) {
      setStonePhase(task, deposit?.remaining ? 'mining' : 'waiting_resource');
      task.blockedReason = deposit ? 'STONE_BUFFER_EMPTY' : 'STONE_DEPOSIT_MISSING';
      residentStatus(resident);
      return true;
    }
    resident.cargo = deposit.bufferQuantity;
    resident.cargoItemId = 'stone';
    deposit.bufferQuantity = 0;
    const storagePoint = { x: world.storage.anchor.x + world.storage.footprint.width, y: SURFACE_ROW };
    const path = surfacePath(resident.position, storagePoint);
    if (!path) {
      setStonePhase(task, 'waiting_path');
      task.blockedReason = 'NO_PATH_TO_STORAGE';
      task.path = [];
      task.pathIndex = 0;
      residentStatus(resident);
      return true;
    }
    task.path = path;
    task.pathIndex = 0;
    setStonePhase(task, path.length > 0 ? 'carrying_to_storage' : 'unloading',
      path.length > 0 ? path.length : WOOD_UNLOADING_TICKS);
    task.blockedReason = null;
    residentStatus(resident);
    return true;
  }

  if (task.phase === 'unloading_at_building') {
    task.progressTicks += 1;
    if (task.progressTicks < task.requiredTicks) return true;
    finishStoneWorksiteDelivery(world, resident, task);
    return true;
  }

  if (task.phase === 'unloading') {
    task.progressTicks += 1;
    if (task.progressTicks < task.requiredTicks) return true;
    finishStoneDelivery(world, resident, task);
    residentStatus(resident);
    return true;
  }
  return false;
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
      resident.cargoItemId = 'wood';
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

  if (task.kind === 'gather-stone') return advanceStoneTaskTick(world, resident, task);

  if (task.phase === 'carrying_materials_to_build') {
    const building = world.buildings.find((candidate) => candidate.id === task.buildingId);
    const order = world.buildOrders.find((candidate) => candidate.id === task.orderId);
    if (!building || !order) {
      task.phase = 'blocked';
      task.blockedReason = !building ? 'BUILDING_SITE_MISSING' : 'BUILD_ORDER_MISSING';
      residentStatus(resident);
      return true;
    }
    if (!moveAlongPath(resident, task)) return true;
    const needed = Math.max(0, requiredBuildingMaterials(building.kind).wood - building.reservedWood);
    const delivered = Math.min(needed, resident.cargoItemId === 'wood' ? resident.cargo : 0);
    resident.cargo -= delivered;
    if (resident.cargo === 0) resident.cargoItemId = null;
    building.reservedWood += delivered;
    const missingMaterials = buildingSiteMaterialWaitReason(building);
    task.phase = missingMaterials ? 'waiting_materials' : 'building';
    task.progressTicks = 0;
    task.path = [];
    task.pathIndex = 0;
    task.requiredTicks = missingMaterials ? 1 : building.progressRequired;
    task.blockedReason = missingMaterials;
    building.state = missingMaterials ? 'waiting_materials' : 'in_progress';
    order.status = 'in_progress';
    order.blockedReason = missingMaterials;
    residentStatus(resident);
    return true;
  }

  if (task.phase === 'walking_to_build') {
    const arrived = moveAlongPath(resident, task);
    if (arrived) {
      const building = world.buildings.find((candidate) => candidate.id === task.buildingId);
      const order = world.buildOrders.find((candidate) => candidate.id === task.orderId);
      if (!building || !order) {
        task.phase = 'blocked';
        task.blockedReason = !building ? 'BUILDING_SITE_MISSING' : 'BUILD_ORDER_MISSING';
        residentStatus(resident);
        return true;
      }
      const missingMaterials = buildingSiteMaterialWaitReason(building);
      task.phase = missingMaterials ? 'waiting_materials' : 'building';
      task.progressTicks = 0;
      task.requiredTicks = missingMaterials ? 1 : building.progressRequired;
      task.blockedReason = missingMaterials;
      building.state = missingMaterials ? 'waiting_materials' : 'in_progress';
      order.blockedReason = missingMaterials;
      residentStatus(resident);
    }
    return true;
  }
  updateBuildingStage(world, resident, task);
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
      if (resident.cargo > 0 && resident.cargoItemId === 'wood' && availableStorageCapacity(world) > 0) {
        setGatherPhase(task, 'unloading', WOOD_UNLOADING_TICKS);
        task.blockedReason = null;
        residentStatus(resident);
        changed = true;
      }
      continue;
    }
    if (task.kind === 'gather-stone' && (task.phase === 'waiting_resource' ||
        task.phase === 'waiting_path' && (task.sourceId === null || task.blockedReason === 'NO_PATH_TO_STONE'))) {
      changed = activateStoneTask(world, resident, task) || changed;
      continue;
    }
    if (task.kind === 'gather-stone' && task.phase === 'waiting_path' && task.blockedReason === 'NO_PATH_TO_STORAGE' &&
        resident.cargo > 0 && resident.cargoItemId === 'stone') {
      const storagePoint = { x: world.storage.anchor.x + world.storage.footprint.width, y: SURFACE_ROW };
      const path = surfacePath(resident.position, storagePoint);
      if (path) {
        task.path = path;
        task.pathIndex = 0;
        setStonePhase(task, path.length > 0 ? 'carrying_to_storage' : 'unloading',
          path.length > 0 ? path.length : WOOD_UNLOADING_TICKS);
        task.blockedReason = null;
        residentStatus(resident);
        changed = true;
      }
      continue;
    }
    if (task.kind === 'gather-stone' && task.phase === 'waiting_storage') {
      if (resident.cargo > 0 && resident.cargoItemId === 'stone' && availableStorageCapacity(world) > 0) {
        setStonePhase(task, 'unloading', WOOD_UNLOADING_TICKS);
        task.blockedReason = null;
        residentStatus(resident);
        changed = true;
      }
      continue;
    }
    if ((task.kind === 'build-cabin' || task.kind === 'build-workshop') && task.phase === 'waiting_materials') {
      const building = world.buildings.find((candidate) => candidate.id === task.buildingId);
      const order = world.buildOrders.find((candidate) => candidate.id === task.orderId);
      if (!building || !order) {
        task.phase = 'blocked';
        task.blockedReason = !building ? 'BUILDING_SITE_MISSING' : 'BUILD_ORDER_MISSING';
        residentStatus(resident);
        changed = true;
        continue;
      }
      const missingMaterials = buildingSiteMaterialWaitReason(building);
      if (!missingMaterials) {
        task.phase = 'building';
        task.progressTicks = 0;
        task.requiredTicks = building.progressRequired;
        task.blockedReason = null;
        building.state = 'in_progress';
        order.status = 'in_progress';
        order.blockedReason = null;
        residentStatus(resident);
        changed = true;
      } else if (task.blockedReason !== missingMaterials || order.blockedReason !== missingMaterials) {
        task.blockedReason = missingMaterials;
        order.blockedReason = missingMaterials;
        building.state = 'waiting_materials';
        residentStatus(resident);
        changed = true;
      }
      continue;
    }
    if ((task.kind !== 'build-cabin' && task.kind !== 'build-workshop') || task.phase !== 'waiting_path') {
      continue;
    }
    const building = world.buildings.find((candidate) => candidate.id === task.buildingId);
    const order = world.buildOrders.find((candidate) => candidate.id === task.orderId);
    if (!building || !order) {
      task.phase = 'blocked';
      task.blockedReason = !building ? 'BUILDING_SITE_MISSING' : 'BUILD_ORDER_MISSING';
      residentStatus(resident);
      changed = true;
      continue;
    }
    const placement = validateCabinPlacement(world, building.anchor, resident.id, {
      ignoreBuildingId: building.id,
      ignoreResidentTask: true,
      materialsReserved: building.kind === 'cabin'
        ? building.reservedWood >= WOOD_CABIN_COST
        : building.reservedWood >= WORKSHOP_MATERIALS.wood && building.reservedStone >= WORKSHOP_MATERIALS.stone
    });
    if (placement.reason === 'WAITING_WORK_POINT') {
      residentStatus(resident);
      continue;
    }
    if (!placement.valid || !placement.route || !placement.workPoint) {
      task.blockedReason = placement.reason;
      order.status = 'waiting_path';
      order.blockedReason = placement.reason;
      residentStatus(resident);
      changed = true;
      continue;
    }
    building.state = 'in_progress';
    task.path = placement.route;
    task.pathIndex = 0;
    task.progressTicks = 0;
    task.requiredTicks = placement.route.length || building.progressRequired;
    const missingMaterials = buildingSiteMaterialWaitReason(building);
    task.phase = placement.route.length ? 'walking_to_build' : missingMaterials ? 'waiting_materials' : 'building';
    task.blockedReason = missingMaterials;
    order.status = 'in_progress';
    order.blockedReason = missingMaterials;
    building.state = missingMaterials ? 'waiting_materials' : 'in_progress';
    residentStatus(resident);
    changed = true;
  }
  return changed;
}

const pendingBuildOrderStatuses: PeaceBuildOrder['status'][] = ['waiting_materials', 'waiting_builder', 'waiting_path'];

function requiredBuildingMaterials(kind: BuildingKind): { wood: number; stone: number } {
  return kind === 'workshop' ? WORKSHOP_MATERIALS : { wood: WOOD_CABIN_COST, stone: 0 };
}

function setBuildOrderStatus(
  world: PeaceWorldSnapshot,
  order: PeaceBuildOrder,
  status: PeaceBuildOrder['status'],
  reason: string | null
): boolean {
  const building = world.buildings.find((candidate) => candidate.id === order.buildingId);
  let changed = order.status !== status || order.blockedReason !== reason;
  order.status = status;
  order.blockedReason = reason;
  if (building) {
    const buildingState: typeof building.state = status === 'waiting_materials' ? 'waiting_materials'
      : status === 'waiting_builder' ? 'waiting_builder'
        : status === 'waiting_path' ? 'planned'
          : status === 'in_progress' ? 'in_progress'
            : status === 'cancelled' ? 'cancelled' : status === 'blocked' ? 'blocked' : building.state;
    if (building.state !== buildingState) {
      building.state = buildingState;
      changed = true;
    }
  }
  return changed;
}

function scheduleWoodcutterRoles(world: PeaceWorldSnapshot): boolean {
  let changed = false;
  const residents = [...world.residents].sort((a, b) => a.id.localeCompare(b.id));
  for (const resident of residents) {
    if (resident.workRole !== 'woodcutter' || resident.task || resident.cargo > 0) continue;
    const taskId = `profession-wood-${resident.id}-${world.revision.worldVersion}-${world.revision.serverTick}`;
    const task = createGatherWoodTask(world, resident.id, taskId, undefined, 'profession');
    if (!task) continue;
    resident.task = task;
    residentStatus(resident);
    changed = true;
  }
  return changed;
}

function scheduleStoneMinerRoles(world: PeaceWorldSnapshot): boolean {
  let changed = false;
  const residents = [...world.residents].sort((a, b) => a.id.localeCompare(b.id));
  for (const resident of residents) {
    if (resident.workRole !== STONE_MINER_ROLE || resident.task || resident.cargo > 0) continue;
    const task = createGatherStoneTask(world, resident.id,
      `stone-role-${resident.id}-${world.revision.worldVersion}-${world.revision.serverTick}`);
    if (!task) continue;
    resident.task = task;
    residentStatus(resident);
    changed = true;
  }
  return changed;
}

function builderCanTakeQueuedOrder(
  resident: Resident,
  mayDeliverCarriedWood = false,
  mayBuildWhileCarryingStone = false
): boolean {
  if (resident.workRole !== 'builder') return false;
  if (!resident.task && resident.cargo === 0) return true;
  if (mayDeliverCarriedWood && resident.cargo > 0 && resident.cargoItemId === 'wood' &&
      (!resident.task || resident.task.kind === 'gather-wood')) return true;
  return mayBuildWhileCarryingStone && !resident.task && resident.cargo > 0 && resident.cargoItemId === 'stone';
}

function queuedBuilderWood(world: PeaceWorldSnapshot): number {
  return world.residents.reduce((maximum, resident) =>
    builderCanTakeQueuedOrder(resident, true) && resident.cargoItemId === 'wood' ? Math.max(maximum, resident.cargo) : maximum, 0);
}

function buildingSiteMaterialWaitReason(building: PeaceBuilding): string | null {
  const required = requiredBuildingMaterials(building.kind);
  if (building.reservedWood < required.wood) return 'INSUFFICIENT_WOOD';
  if (building.reservedStone < required.stone) return 'INSUFFICIENT_STONE';
  return null;
}

function workshopMaterialInTransit(
  world: PeaceWorldSnapshot,
  building: PeaceBuilding,
  order: PeaceBuildOrder,
  itemId: PeaceCargoItem
): number {
  return world.residents.reduce((total, resident) => {
    const task = resident.task;
    if (resident.cargoItemId !== itemId || resident.cargo < 1 || !task) return total;
    if (itemId === 'wood' && task.kind === 'build-workshop' && task.orderId === order.id &&
        task.phase === 'carrying_materials_to_build') {
      return total + resident.cargo;
    }
    if (itemId === 'stone' && task.kind === 'gather-stone' && task.buildingId === building.id &&
        task.orderId === order.id && task.deliveryQuantity !== undefined &&
        ['carrying_to_build', 'unloading_at_building'].includes(task.phase)) {
      return total + Math.min(task.deliveryQuantity, resident.cargo);
    }
    return total;
  }, 0);
}

function buildingMaterialWaitReason(
  world: PeaceWorldSnapshot,
  building: PeaceBuilding,
  order: PeaceBuildOrder
): string | null {
  const required = requiredBuildingMaterials(building.kind);
  const woodInTransit = workshopMaterialInTransit(world, building, order, 'wood');
  const stoneInTransit = workshopMaterialInTransit(world, building, order, 'stone');
  if (building.reservedWood + world.resources.wood + woodInTransit < required.wood) return 'INSUFFICIENT_WOOD';
  if (building.reservedStone + world.resources.stone + stoneInTransit < required.stone) return 'INSUFFICIENT_STONE';
  return null;
}

function reserveAvailableWorkshopMaterials(
  world: PeaceWorldSnapshot,
  building: PeaceBuilding,
  order: PeaceBuildOrder
): boolean {
  if (building.kind !== 'workshop') return false;
  let changed = false;
  const woodInTransit = workshopMaterialInTransit(world, building, order, 'wood');
  const stoneInTransit = workshopMaterialInTransit(world, building, order, 'stone');
  const reserveWood = Math.min(
    Math.max(0, WORKSHOP_MATERIALS.wood - building.reservedWood - woodInTransit), world.resources.wood
  );
  const reserveStone = Math.min(
    Math.max(0, WORKSHOP_MATERIALS.stone - building.reservedStone - stoneInTransit), world.resources.stone
  );
  if (reserveWood > 0) {
    world.resources.wood -= reserveWood;
    building.reservedWood += reserveWood;
    changed = true;
  }
  if (reserveStone > 0) {
    world.resources.stone -= reserveStone;
    building.reservedStone += reserveStone;
    changed = true;
  }
  return changed;
}

function assignWorkshopStoneCargo(world: PeaceWorldSnapshot, building: PeaceBuilding, order: PeaceBuildOrder): boolean {
  if (building.kind !== 'workshop') return false;
  let missing = Math.max(0, WORKSHOP_MATERIALS.stone - building.reservedStone - world.resources.stone -
    workshopMaterialInTransit(world, building, order, 'stone'));
  if (missing < 1) return false;

  let changed = false;
  const residents = [...world.residents].sort((a, b) => a.id.localeCompare(b.id));
  for (const resident of residents) {
    const task = resident.task;
    if (resident.cargoItemId !== 'stone' || resident.cargo < 1 || task?.kind !== 'gather-stone' ||
        task.buildingId !== undefined ||
        !['carrying_to_storage', 'unloading', 'unloading_at_building', 'waiting_path', 'waiting_storage'].includes(task.phase)) continue;

    const access = placementWorkPoint(world, resident, building.anchor, building.id);
    if (!access || access.waitReason) continue;
    const deliveryQuantity = Math.min(missing, resident.cargo);
    task.buildingId = building.id;
    task.orderId = order.id;
    task.deliveryQuantity = deliveryQuantity;
    task.path = access.route;
    task.pathIndex = 0;
    setStonePhase(task, access.route.length ? 'carrying_to_build' : 'unloading_at_building',
      access.route.length ? access.route.length : WOOD_UNLOADING_TICKS);
    task.blockedReason = null;
    residentStatus(resident);
    missing -= deliveryQuantity;
    changed = true;
    if (missing < 1) break;
  }
  return changed;
}

function redirectStoneRemainderToQueuedWorkshop(world: PeaceWorldSnapshot, resident: Resident, task: GatherStoneTask): boolean {
  const orders = [...world.buildOrders].sort((a, b) => a.queuePosition - b.queuePosition || a.id.localeCompare(b.id));
  for (const order of orders) {
    if (['completed', 'cancelled', 'blocked'].includes(order.status)) continue;
    const building = world.buildings.find((candidate) => candidate.id === order.buildingId);
    if (!building || building.kind !== 'workshop') continue;
    if (assignWorkshopStoneCargo(world, building, order)) {
      residentStatus(resident);
      return true;
    }
  }
  return false;
}

function scheduleBuildOrders(world: PeaceWorldSnapshot): boolean {
  let changed = false;
  const orders = [...world.buildOrders].sort((a, b) => a.queuePosition - b.queuePosition || a.id.localeCompare(b.id));
  const builders = [...world.residents].sort((a, b) => a.id.localeCompare(b.id));

  // Keep already-assigned workshops supplied. A miner's cargo is claimed by one
  // order only, and the claim remains attached to its saved gather task.
  for (const order of orders) {
    if (order.status !== 'in_progress') continue;
    const building = world.buildings.find((candidate) => candidate.id === order.buildingId);
    if (!building || building.kind !== 'workshop') continue;
    changed = reserveAvailableWorkshopMaterials(world, building, order) || changed;
    changed = assignWorkshopStoneCargo(world, building, order) || changed;
    const missing = buildingMaterialWaitReason(world, building, order);
    if (order.blockedReason !== missing) {
      order.blockedReason = missing;
      changed = true;
    }
  }

  for (const order of orders) {
    if (!pendingBuildOrderStatuses.includes(order.status)) continue;
    if (order.requiresExplicitBuilder && !order.assignedResidentId) {
      if (order.status === 'waiting_builder' && order.blockedReason !== 'EXPLICIT_BUILDER_REQUIRED') {
        changed = setBuildOrderStatus(world, order, 'waiting_builder', 'EXPLICIT_BUILDER_REQUIRED') || changed;
      }
      continue;
    }
    const building = world.buildings.find((candidate) => candidate.id === order.buildingId);
    if (!building) {
      changed = setBuildOrderStatus(world, order, 'blocked', 'BUILDING_SITE_MISSING') || changed;
      continue;
    }
    const placement = building.kind === 'workshop'
      ? validateWorkshopOrderPlacement(world, building.anchor, building.id)
      : validateCabinOrderPlacement(world, building.anchor, building.id);
    if (!placement.valid && placement.reason !== 'WAITING_MATERIALS') {
      changed = setBuildOrderStatus(world, order,
        placement.reason === 'NO_PATH' ? 'waiting_path' : 'blocked', placement.reason) || changed;
      continue;
    }
    if (placement.reason === 'NO_PATH' || placement.reason === 'WAITING_WORK_POINT') {
      changed = setBuildOrderStatus(world, order, 'waiting_path', placement.reason === 'WAITING_WORK_POINT'
        ? 'WORK_POINT_OCCUPIED' : 'NO_PATH_TO_BUILD_SITE') || changed;
      continue;
    }

    if (building.kind === 'workshop') {
      let waitingReason: string | null = null;
      let assignedResident: Resident | undefined;
      let assignedTask: BuildWorkshopTask | undefined;
      const orderBuilders = order.assignedResidentId
        ? builders.filter((resident) => resident.id === order.assignedResidentId) : builders;
      for (const resident of orderBuilders) {
        if (!builderCanTakeQueuedOrder(resident, true, Boolean(order.assignedResidentId))) continue;
        const task = createBuildWorkshopTask(world, resident.id, `build-${order.id}-${resident.id}`,
          building.id, order.id, building.anchor);
        if (!task || task.phase === 'waiting_path') {
          waitingReason = task?.blockedReason ?? 'NO_PATH_TO_BUILD_SITE';
          continue;
        }
        assignedResident = resident;
        assignedTask = task;
        break;
      }

      if (assignedResident && assignedTask) {
        assignedResident.task = assignedTask;
        residentStatus(assignedResident);
        order.status = 'in_progress';
        order.assignedResidentId = assignedResident.id;
        order.requiresExplicitBuilder = false;
        building.state = 'in_progress';
        changed = true;
      }
      changed = reserveAvailableWorkshopMaterials(world, building, order) || changed;
      changed = assignWorkshopStoneCargo(world, building, order) || changed;
      const missingMaterials = buildingMaterialWaitReason(world, building, order);
      if (order.assignedResidentId) {
        order.blockedReason = missingMaterials;
        if (missingMaterials && assignedResident?.task?.phase === 'building' && building.progressTicks === 0) {
          assignedResident.task.phase = 'waiting_materials';
          assignedResident.task.blockedReason = buildingSiteMaterialWaitReason(building) ?? missingMaterials;
          assignedResident.task.path = [];
          assignedResident.task.pathIndex = 0;
          assignedResident.task.progressTicks = 0;
          assignedResident.task.requiredTicks = 1;
          residentStatus(assignedResident);
          building.state = 'waiting_materials';
        }
        continue;
      }
      const pendingStatus: PeaceBuildOrder['status'] = waitingReason ? 'waiting_path'
        : missingMaterials ? 'waiting_materials' : 'waiting_builder';
      changed = setBuildOrderStatus(world, order, pendingStatus,
        waitingReason ?? missingMaterials ?? 'NO_BUILDER') || changed;
      continue;
    }

    const missingMaterials = building.reservedWood + world.resources.wood + queuedBuilderWood(world) < WOOD_CABIN_COST
      ? 'INSUFFICIENT_WOOD' : null;
    if (missingMaterials) {
      changed = setBuildOrderStatus(world, order, 'waiting_materials', missingMaterials) || changed;
      continue;
    }

    let waitingReason: string | null = null;
    const orderBuilders = order.assignedResidentId
      ? builders.filter((resident) => resident.id === order.assignedResidentId) : builders;
    for (const resident of orderBuilders) {
      if (!builderCanTakeQueuedOrder(resident, true, Boolean(order.assignedResidentId))) continue;
      const taskId = `build-${order.id}-${resident.id}`;
      const task = createBuildCabinTask(world, resident.id, taskId, building.id, order.id, building.anchor);
      if (!task || task.phase === 'waiting_path') {
        waitingReason = task?.blockedReason ?? 'NO_PATH_TO_BUILD_SITE';
        continue;
      }
      if (building.kind === 'cabin' && building.reservedWood < WOOD_CABIN_COST) {
        const needed = WOOD_CABIN_COST - building.reservedWood;
        const cargoDeliveredAtSite = task.phase === 'carrying_materials_to_build'
          ? Math.min(resident.cargoItemId === 'wood' ? resident.cargo : 0, needed) : 0;
        const fromStorage = needed - cargoDeliveredAtSite;
        if (world.resources.wood < fromStorage) continue;
        world.resources.wood -= fromStorage;
        building.reservedWood += fromStorage;
      }
      order.status = 'in_progress';
      order.assignedResidentId = resident.id;
      order.requiresExplicitBuilder = false;
      order.blockedReason = null;
      building.state = 'in_progress';
      resident.task = task;
      residentStatus(resident);
      changed = true;
      break;
    }
    if (!order.assignedResidentId) {
      changed = setBuildOrderStatus(world, order, waitingReason ? 'waiting_path' : 'waiting_builder',
        waitingReason ?? 'NO_BUILDER') || changed;
    }
  }

  const pending = orders.filter((order) => pendingBuildOrderStatuses.includes(order.status) && !order.assignedResidentId);
  for (const resident of builders) {
    if (!builderCanTakeQueuedOrder(resident) || resident.task || resident.cargo > 0) continue;
    if (pending.length === 0) {
      resident.state = 'idle';
      resident.visualState = 'idle';
      resident.blockedReason = null;
      continue;
    }
    const priority = pending[0];
    if (!priority) continue;
    const status = priority.status === 'waiting_materials' ? 'waiting_materials'
      : priority.status === 'waiting_path' ? 'waiting_path' : 'waiting_resource';
    const reason = priority.blockedReason ?? (status === 'waiting_materials' ? 'INSUFFICIENT_WOOD'
      : status === 'waiting_path' ? 'NO_PATH_TO_BUILD_SITE' : 'NO_BUILDER');
    if (resident.state !== 'waiting' || resident.visualState !== status || resident.blockedReason !== reason) changed = true;
    resident.state = 'waiting';
    resident.visualState = status;
    resident.blockedReason = reason;
  }
  return changed;
}

function scheduleWorkforce(world: PeaceWorldSnapshot): boolean {
  let changed = activateWaitingTasks(world);
  changed = scheduleWoodcutterRoles(world) || changed;
  changed = scheduleStoneMinerRoles(world) || changed;
  changed = scheduleBuildOrders(world) || changed;
  return changed;
}

export function scheduleWorkOrders(world: PeaceWorldSnapshot): boolean {
  return scheduleWorkforce(world);
}

export function advanceSettlement(world: PeaceWorldSnapshot, ticks: number): PeaceWorldSnapshot {
  if (!Number.isSafeInteger(ticks) || ticks < 0) throw new RangeError('ticks must be a nonnegative safe integer');
  const next = structuredClone(world);
  let remaining = ticks;
  const orderedResidents = [...next.residents].sort((a, b) => a.id.localeCompare(b.id));
  while (remaining > 0) {
    let changed = scheduleWorkforce(next);
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
        changed = scheduleWorkforce(next) || changed;
        if (changed) next.revision.worldVersion += 1;
        remaining -= 1;
        continue;
      }
      const regrew = advanceWoodland(next, remaining);
      if (regrew) {
        changed = true;
         changed = scheduleWorkforce(next) || changed;
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
    changed = scheduleWorkforce(next) || changed;
    if (changed) next.revision.worldVersion += 1;
    remaining -= 1;
  }
  return next;
}

export function taskPhase(task: PeaceWorkerTask | null): string {
  return task?.phase ?? 'idle';
}
