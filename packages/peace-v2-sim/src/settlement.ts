import type {
  PeaceBuildOrder,
  PeaceBuilding,
  PeaceCargoItem,
  PeaceLogisticsPriority,
  PeaceLogisticsTask,
  PeaceResident,
  PeaceStorage,
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
type HaulTask = Extract<NonNullable<PeaceWorkerTask>, { kind: 'haul' }>;
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

function getStorages(world: PeaceWorldSnapshot): PeaceStorage[] {
  return world.storages ?? [{
    id: world.storage.id, name: 'Склад', kind: 'warehouse', anchor: world.storage.anchor,
    footprint: world.storage.footprint, capacity: world.storage.capacity, contents: world.resources,
    reservedInbound: { wood: 0, stone: 0 }, reservedOutbound: { wood: 0, stone: 0 },
    status: storedResourceTotal(world) >= world.storage.capacity ? 'full' : 'available', blockedReason: null
  }];
}

function storageById(world: PeaceWorldSnapshot, storageId: string): PeaceStorage | undefined {
  return getStorages(world).find((storage) => storage.id === storageId);
}

function storageUsedVolume(storage: PeaceStorage): number {
  return storage.contents.wood + storage.contents.stone;
}

function storageReservedInboundVolume(storage: PeaceStorage): number {
  return storage.reservedInbound.wood + storage.reservedInbound.stone;
}

function storageFreeVolume(storage: PeaceStorage): number {
  return Math.max(0, storage.capacity - storageUsedVolume(storage) - storageReservedInboundVolume(storage));
}

function updateStorageState(storage: PeaceStorage): void {
  storage.status = storageFreeVolume(storage) === 0 ? 'full' : 'available';
  storage.blockedReason = null;
}

function synchronizeStorageTotals(world: PeaceWorldSnapshot): void {
  if (!world.storages?.length) return;
  const totals = world.storages.reduce((sum, storage) => {
    updateStorageState(storage);
    return { wood: sum.wood + storage.contents.wood, stone: sum.stone + storage.contents.stone };
  }, { wood: 0, stone: 0 });
  world.resources = totals;
  const primary = world.storages.find((storage) => storage.id === world.storage.id) ?? world.storages[0]!;
  world.storage = { id: primary.id, anchor: primary.anchor, footprint: primary.footprint, capacity: primary.capacity };
}

function storageAccessPoint(storage: PeaceStorage): { x: number; y: number } {
  return { x: storage.anchor.x + storage.footprint.width, y: SURFACE_ROW };
}

function chooseStorageForDelivery(
  world: PeaceWorldSnapshot,
  from: { x: number; y: number },
  quantity: number,
  preferredStorageId?: string | null,
  allowFull = false
): { storage: PeaceStorage; route: Array<{ x: number; y: number }> } | null {
  const allCandidates = getStorages(world).flatMap((storage) => {
    const route = surfacePath(from, storageAccessPoint(storage));
    return route ? [{ storage, route }] : [];
  });
  const candidates = allCandidates.filter(({ storage }) => storageFreeVolume(storage) >= quantity);
  if (candidates.length === 0 && allowFull) candidates.push(...allCandidates);
  candidates.sort((a, b) => {
    if (a.storage.id === preferredStorageId) return -1;
    if (b.storage.id === preferredStorageId) return 1;
    return a.route.length - b.route.length || a.storage.id.localeCompare(b.storage.id);
  });
  return candidates[0] ?? null;
}

function availableStorageCapacity(world: PeaceWorldSnapshot, storageId?: string): number {
  if (!world.storages?.length) return Math.max(0, world.storage.capacity - storedResourceTotal(world));
  if (storageId) {
    const storage = storageById(world, storageId);
    return storage ? storageFreeVolume(storage) : 0;
  }
  return world.storages.reduce((total, storage) => total + storageFreeVolume(storage), 0);
}

function hasHaulerRole(world: PeaceWorldSnapshot): boolean {
  return world.residents.some((resident) => resident.workRole === 'hauler');
}

function distributedStorageMode(world: PeaceWorldSnapshot): boolean {
  return hasHaulerRole(world) || Boolean(world.storages && world.storages.length > 1);
}

function storedAt(world: PeaceWorldSnapshot, storageId: string, itemId: PeaceCargoItem): number {
  if (!world.storages) return storageId === world.storage.id ? world.resources[itemId] : 0;
  return world.storages.find((storage) => storage.id === storageId)?.contents[itemId] ?? 0;
}

function reservedOutAt(world: PeaceWorldSnapshot, storageId: string, itemId: PeaceCargoItem): number {
  if (!world.storages) return 0;
  return world.storages.find((storage) => storage.id === storageId)?.reservedOutbound[itemId] ?? 0;
}

function reserveStorageOutput(world: PeaceWorldSnapshot, storageId: string, itemId: PeaceCargoItem, quantity: number): boolean {
  const storage = storageById(world, storageId);
  if (!storage || storage.contents[itemId] - storage.reservedOutbound[itemId] < quantity) return false;
  storage.reservedOutbound[itemId] += quantity;
  return true;
}

function releaseStorageOutput(world: PeaceWorldSnapshot, storageId: string, itemId: PeaceCargoItem, quantity: number): void {
  const storage = storageById(world, storageId);
  if (!storage) return;
  storage.reservedOutbound[itemId] = Math.max(0, storage.reservedOutbound[itemId] - quantity);
}

function adjustStorageStock(world: PeaceWorldSnapshot, storageId: string, itemId: PeaceCargoItem, delta: number): boolean {
  const storage = storageById(world, storageId);
  if (!storage) return false;
  const nextQuantity = storage.contents[itemId] + delta;
  if (nextQuantity < 0) return false;
  storage.contents[itemId] = nextQuantity;
  synchronizeStorageTotals(world);
  return true;
}

function storageWorkPoint(storage: PeaceStorage): { x: number; y: number } {
  return { x: storage.anchor.x + storage.footprint.width, y: SURFACE_ROW };
}

function routeToStorage(world: PeaceWorldSnapshot, from: { x: number; y: number }, storageId: string) {
  const storage = storageById(world, storageId);
  if (!storage) return null;
  const point = storageWorkPoint(storage);
  const route = surfacePath(from, point);
  return route ? { storage, point, route } : null;
}

function chooseSourceStorage(
  world: PeaceWorldSnapshot,
  resident: Resident,
  itemId: PeaceCargoItem,
  quantity: number,
  destination: { x: number; y: number },
  preferredStorageId?: string | null
): { storage: PeaceStorage; route: Array<{ x: number; y: number }> } | null {
  const candidates = getStorages(world).flatMap((storage) => {
    if (storage.contents[itemId] - storage.reservedOutbound[itemId] < quantity) return [];
    const access = routeToStorage(world, destination, storage.id);
    const workerToSource = surfacePath(resident.position, storageWorkPoint(storage));
    if (!access || !workerToSource) return [];
    return [{ storage, route: workerToSource }];
  });
  candidates.sort((a, b) => {
    if (a.storage.id === preferredStorageId) return -1;
    if (b.storage.id === preferredStorageId) return 1;
    return a.route.length - b.route.length || a.storage.id.localeCompare(b.storage.id);
  });
  return candidates[0] ?? null;
}

function redirectGatherWoodDelivery(world: PeaceWorldSnapshot, resident: Resident, task: GatherWoodTask): boolean {
  const destination = chooseStorageForDelivery(world, resident.position, 1, resident.preferredStorageId);
  if (!destination) return false;
  task.destinationId = destination.storage.id;
  task.path = destination.route;
  task.pathIndex = 0;
  task.progressTicks = 0;
  task.phase = destination.route.length ? 'carrying_to_storage' : 'unloading';
  task.requiredTicks = destination.route.length || WOOD_UNLOADING_TICKS;
  task.blockedReason = null;
  residentStatus(resident);
  return true;
}

function redirectGatherStoneDelivery(world: PeaceWorldSnapshot, resident: Resident, task: GatherStoneTask, allowFull = false): boolean {
  const destination = chooseStorageForDelivery(world, resident.position, 1, resident.preferredStorageId, allowFull);
  if (!destination) return false;
  task.destinationId = destination.storage.id;
  task.path = destination.route;
  task.pathIndex = 0;
  task.progressTicks = 0;
  setStonePhase(task, destination.route.length ? 'carrying_to_storage' : 'unloading',
    destination.route.length || WOOD_UNLOADING_TICKS);
  task.blockedReason = null;
  residentStatus(resident);
  return true;
}

interface HaulPlan {
  sourceKind: HaulTask['sourceKind'];
  sourceId: string;
  destinationKind: HaulTask['destinationKind'];
  destinationId: string;
  orderId?: string;
  itemId: PeaceCargoItem;
  quantity: number;
  assignmentSource?: HaulTask['assignmentSource'];
  demandKey?: string;
  priority?: PeaceLogisticsPriority;
  routeLength?: number;
  queuePosition?: number;
  preferredDestination?: boolean;
  preferredStorageId?: string | null;
  fallbackReason?: string | null;
}

function logisticsPriorityRank(world: PeaceWorldSnapshot, priority: PeaceLogisticsPriority): number {
  return world.logisticsPolicy.priorityOrder.indexOf(priority);
}

function haulDemandKey(plan: HaulPlan): string {
  return plan.demandKey ?? `${plan.sourceKind}:${plan.sourceId}:${plan.itemId}:${plan.destinationKind}:${plan.destinationId}:${plan.orderId ?? 'none'}`;
}

function logisticsPlanKey(plan: HaulPlan): string {
  return `${haulDemandKey(plan)}|${plan.sourceKind}:${plan.sourceId}|${plan.itemId}|${plan.destinationKind}:${plan.destinationId}`;
}

function haulSourcePosition(world: PeaceWorldSnapshot, sourceKind: HaulTask['sourceKind'], sourceId: string) {
  if (sourceKind === 'tree-buffer') {
    const tree = world.trees.find((candidate) => candidate.id === sourceId);
    return tree ? sourceWorkPoint(tree) : null;
  }
  if (sourceKind === 'stone-buffer') {
    const deposit = world.stoneDeposits.find((candidate) => candidate.id === sourceId);
    return deposit ? stoneWorkPoint(deposit) : null;
  }
  const storage = storageById(world, sourceId);
  return storage ? storageWorkPoint(storage) : null;
}

function haulSourceAvailable(world: PeaceWorldSnapshot, plan: HaulPlan): number {
  if (plan.sourceKind === 'tree-buffer') {
    const tree = world.trees.find((candidate) => candidate.id === plan.sourceId);
    return tree ? tree.bufferQuantity - tree.reservedBuffer : 0;
  }
  if (plan.sourceKind === 'stone-buffer') {
    const deposit = world.stoneDeposits.find((candidate) => candidate.id === plan.sourceId);
    return deposit ? deposit.bufferQuantity - deposit.reservedBuffer : 0;
  }
  const storage = storageById(world, plan.sourceId);
  return storage ? storage.contents[plan.itemId] - storage.reservedOutbound[plan.itemId] : 0;
}

function releaseHaulSourceReservation(world: PeaceWorldSnapshot, task: HaulTask): void {
  if (task.sourceKind === 'tree-buffer') {
    const tree = world.trees.find((candidate) => candidate.id === task.sourceId);
    if (tree) tree.reservedBuffer = Math.max(0, tree.reservedBuffer - task.quantity);
  } else if (task.sourceKind === 'stone-buffer') {
    const deposit = world.stoneDeposits.find((candidate) => candidate.id === task.sourceId);
    if (deposit) deposit.reservedBuffer = Math.max(0, deposit.reservedBuffer - task.quantity);
  } else {
    releaseStorageOutput(world, task.sourceId, task.itemId, task.quantity);
  }
}

function releaseHaulDestinationReservation(world: PeaceWorldSnapshot, task: HaulTask): void {
  if (!task.destinationReserved) return;
  if (task.destinationKind === 'storage') {
    const storage = storageById(world, task.destinationId);
    if (storage) storage.reservedInbound[task.itemId] = Math.max(0, storage.reservedInbound[task.itemId] - task.quantity);
    if (storage) updateStorageState(storage);
  } else {
    const building = world.buildings.find((candidate) => candidate.id === task.destinationId);
    if (building) {
      if (task.itemId === 'wood') building.inTransitWood = Math.max(0, building.inTransitWood - task.quantity);
      else building.inTransitStone = Math.max(0, building.inTransitStone - task.quantity);
    }
  }
  task.destinationReserved = false;
}

function reserveHaulSource(world: PeaceWorldSnapshot, plan: HaulPlan): boolean {
  if (haulSourceAvailable(world, plan) < plan.quantity) return false;
  if (plan.sourceKind === 'tree-buffer') {
    const tree = world.trees.find((candidate) => candidate.id === plan.sourceId);
    if (!tree) return false;
    tree.reservedBuffer += plan.quantity;
    return true;
  }
  if (plan.sourceKind === 'stone-buffer') {
    const deposit = world.stoneDeposits.find((candidate) => candidate.id === plan.sourceId);
    if (!deposit) return false;
    deposit.reservedBuffer += plan.quantity;
    return true;
  }
  return reserveStorageOutput(world, plan.sourceId, plan.itemId, plan.quantity);
}

function reserveHaulDestination(world: PeaceWorldSnapshot, plan: HaulPlan): boolean {
  if (plan.destinationKind === 'storage') {
    const storage = storageById(world, plan.destinationId);
    if (!storage || storageFreeVolume(storage) < plan.quantity) return false;
    storage.reservedInbound[plan.itemId] += plan.quantity;
    updateStorageState(storage);
    return true;
  }
  const building = world.buildings.find((candidate) => candidate.id === plan.destinationId);
  const order = plan.orderId && world.buildOrders.find((candidate) => candidate.id === plan.orderId);
  if (!building || !order || order.buildingId !== building.id || ['cancelled', 'completed', 'blocked'].includes(order.status)) return false;
  const required = requiredBuildingMaterials(building.kind);
  const delivered = plan.itemId === 'wood' ? building.reservedWood : building.reservedStone;
  const inbound = plan.itemId === 'wood' ? building.inTransitWood : building.inTransitStone;
  if (delivered + inbound + plan.quantity > required[plan.itemId]) return false;
  if (plan.itemId === 'wood') building.inTransitWood += plan.quantity;
  else building.inTransitStone += plan.quantity;
  return true;
}

function logisticsPriorityForPlan(world: PeaceWorldSnapshot, plan: HaulPlan): PeaceLogisticsPriority {
  if (plan.priority) return plan.priority;
  if (plan.destinationKind === 'building') {
    const building = world.buildings.find((candidate) => candidate.id === plan.destinationId);
    return building && building.progressTicks > 0 ? 'active_construction' : 'ready_construction';
  }
  return plan.sourceKind === 'storage' ? 'rebalancing' : 'buffer_clearance';
}

function createLogisticsQueueTask(
  world: PeaceWorldSnapshot,
  resident: Resident | null,
  taskId: string | null,
  plan: HaulPlan,
  status: PeaceLogisticsTask['status'],
  blockedReason: string | null = null
): PeaceLogisticsTask {
  const priority = logisticsPriorityForPlan(world, plan);
  return {
    id: `logistics-${world.nextLogisticsSequence++}`,
    demandKey: haulDemandKey(plan),
    kind: priority,
    itemId: plan.itemId,
    sourceKind: plan.sourceKind,
    sourceId: plan.sourceId,
    destinationKind: plan.destinationKind,
    destinationId: plan.destinationId,
    preferredStorageId: plan.preferredStorageId ?? null,
    fallbackReason: plan.fallbackReason ?? null,
    orderId: plan.orderId ?? null,
    requiredQuantity: plan.quantity,
    allocatedQuantity: resident ? plan.quantity : 0,
    deliveredQuantity: 0,
    priorityRank: logisticsPriorityRank(world, priority),
    queuePosition: plan.queuePosition ?? null,
    status,
    assignedResidentId: resident?.id ?? null,
    haulTaskId: taskId,
    blockedReason,
    createdTick: world.revision.serverTick
  };
}

function claimLogisticsQueueTask(
  world: PeaceWorldSnapshot,
  resident: Resident,
  taskId: string,
  plan: HaulPlan
): PeaceLogisticsTask {
  const demandKey = haulDemandKey(plan);
  const pending = world.logisticsTasks.find((task) => task.demandKey === demandKey &&
    task.sourceKind === plan.sourceKind && task.sourceId === plan.sourceId &&
    task.destinationKind === plan.destinationKind && task.destinationId === plan.destinationId &&
    task.itemId === plan.itemId && task.assignedResidentId === null && task.allocatedQuantity === 0 &&
    ['queued', 'waiting', 'blocked'].includes(task.status));
  if (pending) {
    pending.requiredQuantity = plan.quantity;
    pending.allocatedQuantity = plan.quantity;
    pending.priorityRank = logisticsPriorityRank(world, pending.kind);
    pending.queuePosition = plan.queuePosition ?? null;
    pending.preferredStorageId = plan.preferredStorageId ?? null;
    pending.fallbackReason = plan.fallbackReason ?? null;
    pending.status = 'assigned';
    pending.assignedResidentId = resident.id;
    pending.haulTaskId = taskId;
    pending.blockedReason = null;
    return pending;
  }
  const queued = createLogisticsQueueTask(world, resident, taskId, plan, 'assigned');
  world.logisticsTasks.push(queued);
  return queued;
}

function recordWaitingLogisticsTask(
  world: PeaceWorldSnapshot,
  plan: HaulPlan,
  reason: string,
  status: PeaceLogisticsTask['status'] = 'waiting'
): boolean {
  if (plan.quantity < 1) return false;
  const demandKey = haulDemandKey(plan);
  const queued = world.logisticsTasks.find((task) => task.demandKey === demandKey &&
    task.sourceKind === plan.sourceKind && task.sourceId === plan.sourceId &&
    task.destinationKind === plan.destinationKind && task.destinationId === plan.destinationId &&
    task.itemId === plan.itemId && task.assignedResidentId === null &&
    ['queued', 'waiting', 'blocked'].includes(task.status));
  if (queued) {
    const changed = queued.requiredQuantity !== plan.quantity || queued.status !== status || queued.blockedReason !== reason;
    queued.kind = logisticsPriorityForPlan(world, plan);
    queued.requiredQuantity = plan.quantity;
    queued.priorityRank = logisticsPriorityRank(world, queued.kind);
    queued.queuePosition = plan.queuePosition ?? null;
    queued.preferredStorageId = plan.preferredStorageId ?? null;
    queued.fallbackReason = plan.fallbackReason ?? null;
    queued.status = status;
    queued.blockedReason = reason;
    return changed;
  }
  world.logisticsTasks.push(createLogisticsQueueTask(world, null, null, plan, status, reason));
  return true;
}

function pruneStaleQueuedLogisticsTasks(world: PeaceWorldSnapshot, livePlanKeys: Set<string>): boolean {
  let changed = false;
  for (const task of world.logisticsTasks) {
    if (task.assignedResidentId !== null || !['queued', 'waiting'].includes(task.status)) continue;
    const key = `${task.demandKey}|${task.sourceKind}:${task.sourceId}|${task.itemId}|${task.destinationKind}:${task.destinationId}`;
    if (livePlanKeys.has(key)) continue;
    task.status = 'cancelled';
    task.blockedReason = 'DEMAND_RECONCILED';
    changed = true;
  }
  return changed;
}

function createHaulTask(world: PeaceWorldSnapshot, resident: Resident, taskId: string, plan: HaulPlan): HaulTask | null {
  if (world.logisticsPolicy.carryCapacity !== null) {
    plan.quantity = Math.min(plan.quantity, world.logisticsPolicy.carryCapacity);
  }
  if (resident.task || resident.cargo > 0 || plan.quantity < 1 || haulSourceAvailable(world, plan) < plan.quantity) return null;
  const sourcePoint = haulSourcePosition(world, plan.sourceKind, plan.sourceId);
  if (!sourcePoint) return null;
  const sourceRoute = surfacePath(resident.position, sourcePoint);
  if (!sourceRoute) return null;
  let destinationPoint: { x: number; y: number } | undefined;
  let destinationRoute: Array<{ x: number; y: number }> | null = null;
  if (plan.destinationKind === 'storage') {
    const destination = storageById(world, plan.destinationId);
    if (!destination || storageFreeVolume(destination) < plan.quantity) return null;
    destinationPoint = storageWorkPoint(destination);
    destinationRoute = surfacePath(sourcePoint, destinationPoint);
  } else {
    const building = world.buildings.find((candidate) => candidate.id === plan.destinationId);
    if (!building || !plan.orderId) return null;
    const atSource = { ...resident, position: sourcePoint };
    const access = placementWorkPoint(world, atSource, building.anchor, building.id);
    if (!access || access.waitReason) return null;
    destinationPoint = access.point;
    destinationRoute = access.route;
  }
  if (!destinationPoint || !destinationRoute) return null;
  if (!reserveHaulSource(world, plan)) return null;
  if (!reserveHaulDestination(world, plan)) {
    releaseHaulSourceReservation(world, {
      id: taskId, kind: 'haul', phase: 'walking_to_source', sourceKind: plan.sourceKind, sourceId: plan.sourceId,
      destinationKind: plan.destinationKind, destinationId: plan.destinationId, ...(plan.orderId ? { orderId: plan.orderId } : {}),
      logisticsTaskId: null, destinationReserved: true,
      itemId: plan.itemId, quantity: plan.quantity, assignmentSource: plan.assignmentSource ?? 'workRole',
      path: [], pathIndex: 0, progressTicks: 0, requiredTicks: 1, blockedReason: null
    });
    return null;
  }
  const queueTask = claimLogisticsQueueTask(world, resident, taskId, plan);
  const task: HaulTask = {
    id: taskId,
    kind: 'haul',
    phase: sourceRoute.length ? 'walking_to_source' : 'loading',
    sourceKind: plan.sourceKind,
    sourceId: plan.sourceId,
    destinationKind: plan.destinationKind,
    destinationId: plan.destinationId,
    ...(plan.orderId ? { orderId: plan.orderId } : {}),
    logisticsTaskId: queueTask.id,
    destinationReserved: true,
    itemId: plan.itemId,
    quantity: plan.quantity,
    assignmentSource: plan.assignmentSource ?? 'workRole',
    path: sourceRoute,
    pathIndex: 0,
    progressTicks: 0,
    requiredTicks: sourceRoute.length || WOOD_LOADING_TICKS,
    blockedReason: null
  };
  resident.task = task;
  residentStatus(resident);
  return task;
}

function completeLogisticsQueueTask(world: PeaceWorldSnapshot, resident: Resident, task: HaulTask): void {
  const queueTask = task.logisticsTaskId && world.logisticsTasks.find((candidate) => candidate.id === task.logisticsTaskId);
  if (!queueTask) return;
  queueTask.deliveredQuantity = Math.min(queueTask.requiredQuantity, queueTask.deliveredQuantity + task.quantity);
  queueTask.allocatedQuantity = 0;
  queueTask.status = queueTask.deliveredQuantity >= queueTask.requiredQuantity ? 'completed' : 'queued';
  queueTask.assignedResidentId = null;
  queueTask.haulTaskId = null;
  queueTask.blockedReason = null;
}

function cancelLogisticsQueueTask(world: PeaceWorldSnapshot, task: HaulTask, reason: string): void {
  if (!task.logisticsTaskId) return;
  const queueTask = world.logisticsTasks.find((candidate) => candidate.id === task.logisticsTaskId);
  if (!queueTask) return;
  queueTask.allocatedQuantity = 0;
  queueTask.assignedResidentId = null;
  queueTask.haulTaskId = null;
  queueTask.status = 'cancelled';
  queueTask.blockedReason = reason;
}

function retargetCancelledWorksiteHaul(world: PeaceWorldSnapshot, resident: Resident, task: HaulTask, cancelledOrderId: string): boolean {
  const storageRoutes = getStorages(world).map((storage) => ({
    storage,
    route: surfacePath(resident.position, storageWorkPoint(storage)),
    free: storageFreeVolume(storage)
  })).filter((candidate) => candidate.route !== null)
    .sort((a, b) => {
      if (a.storage.id === resident.preferredStorageId) return -1;
      if (b.storage.id === resident.preferredStorageId) return 1;
      const aFits = a.free >= resident.cargo ? 0 : 1;
      const bFits = b.free >= resident.cargo ? 0 : 1;
      return aFits - bFits || a.route!.length - b.route!.length || a.storage.id.localeCompare(b.storage.id);
    });
  const destination = storageRoutes[0]?.storage ?? getStorages(world)[0];
  if (!destination) return false;
  releaseHaulDestinationReservation(world, task);
  task.destinationKind = 'storage';
  task.destinationId = destination.id;
  delete task.orderId;
  task.destinationReserved = false;
  const route = surfacePath(resident.position, storageWorkPoint(destination));
  if (route && storageFreeVolume(destination) >= task.quantity) {
    destination.reservedInbound[task.itemId] += task.quantity;
    updateStorageState(destination);
    task.destinationReserved = true;
    setHaulPhase(task, route.length ? 'carrying' : 'unloading', route,
      route.length || WOOD_UNLOADING_TICKS);
    task.blockedReason = null;
  } else if (route) {
    task.phase = 'waiting_storage';
    task.path = [];
    task.pathIndex = 0;
    task.progressTicks = 0;
    task.requiredTicks = 1;
    task.blockedReason = 'STORAGE_FULL';
  } else {
    task.phase = 'waiting_path';
    task.path = [];
    task.pathIndex = 0;
    task.progressTicks = 0;
    task.requiredTicks = 1;
    task.blockedReason = 'NO_PATH_TO_STORAGE';
  }
  const queueTask = task.logisticsTaskId && world.logisticsTasks.find((candidate) => candidate.id === task.logisticsTaskId);
  if (queueTask) {
    queueTask.demandKey = `cancelled-order:${cancelledOrderId}:${task.itemId}:${destination.id}`;
    queueTask.kind = 'buffer_clearance';
    queueTask.priorityRank = logisticsPriorityRank(world, queueTask.kind);
    queueTask.destinationKind = 'storage';
    queueTask.destinationId = destination.id;
    queueTask.orderId = null;
    queueTask.queuePosition = null;
    queueTask.requiredQuantity = task.quantity;
    queueTask.allocatedQuantity = task.quantity;
    queueTask.assignedResidentId = resident.id;
    queueTask.haulTaskId = task.id;
    queueTask.status = task.phase === 'waiting_path' ? 'blocked'
      : task.phase === 'waiting_storage' ? 'waiting' : 'in_transit';
    queueTask.blockedReason = task.blockedReason;
  }
  residentStatus(resident);
  return true;
}

function syncLogisticsQueue(world: PeaceWorldSnapshot): boolean {
  let changed = false;
  const activeQueueIds = new Set<string>();
  for (const resident of world.residents) {
    const task = resident.task;
    if (task?.kind !== 'haul') continue;
    let queueTask = task.logisticsTaskId
      ? world.logisticsTasks.find((candidate) => candidate.id === task.logisticsTaskId)
      : undefined;
    if (!queueTask) {
      const plan: HaulPlan = {
        sourceKind: task.sourceKind, sourceId: task.sourceId,
        destinationKind: task.destinationKind, destinationId: task.destinationId,
        ...(task.orderId ? { orderId: task.orderId } : {}), itemId: task.itemId,
        quantity: task.quantity, demandKey: `recovered:${task.id}`
      };
      queueTask = createLogisticsQueueTask(world, resident, task.id, plan, 'assigned');
      world.logisticsTasks.push(queueTask);
      task.logisticsTaskId = queueTask.id;
      changed = true;
    }
    activeQueueIds.add(queueTask.id);
    const status: PeaceLogisticsTask['status'] = task.phase === 'blocked' ? 'blocked'
      : task.phase.startsWith('waiting_') ? 'waiting'
        : task.phase === 'carrying' || task.phase === 'unloading' ? 'in_transit' : 'assigned';
    const rank = logisticsPriorityRank(world, queueTask.kind);
    const queuePosition = queueTask.orderId
      ? world.buildOrders.find((order) => order.id === queueTask.orderId)?.queuePosition ?? null : null;
    if (queueTask.assignedResidentId !== resident.id || queueTask.haulTaskId !== task.id ||
        queueTask.allocatedQuantity !== task.quantity || queueTask.status !== status ||
        queueTask.blockedReason !== task.blockedReason || queueTask.priorityRank !== rank || queueTask.queuePosition !== queuePosition) changed = true;
    queueTask.assignedResidentId = resident.id;
    queueTask.haulTaskId = task.id;
    queueTask.allocatedQuantity = task.quantity;
    queueTask.status = status;
    queueTask.priorityRank = rank;
    queueTask.queuePosition = queuePosition;
    queueTask.blockedReason = task.blockedReason;
  }
  for (const queueTask of world.logisticsTasks) {
    if (!queueTask.assignedResidentId || activeQueueIds.has(queueTask.id) ||
        ['completed', 'cancelled'].includes(queueTask.status)) continue;
    queueTask.assignedResidentId = null;
    queueTask.haulTaskId = null;
    queueTask.allocatedQuantity = 0;
    queueTask.status = 'queued';
    queueTask.blockedReason = 'NO_WORKER';
    changed = true;
  }
  const cutoff = world.revision.serverTick - 120;
  const retained = world.logisticsTasks.filter((task) =>
    !['completed', 'cancelled'].includes(task.status) || task.createdTick >= cutoff);
  if (retained.length !== world.logisticsTasks.length) {
    world.logisticsTasks.splice(0, world.logisticsTasks.length, ...retained);
    changed = true;
  }
  return changed;
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
  const overlapsStorage = getStorages(world).some((storage) => storage.anchor.y === anchor.y &&
    [...cabinCells].some((x) => x >= storage.anchor.x && x < storage.anchor.x + storage.footprint.width));
  if (overlapsStorage ||
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
    if (source.remaining < 1 || source.state !== 'standing' || sourceReservedByAnother(world, residentId, source.id) ||
        hasHaulerRole(world) && source.bufferQuantity >= source.bufferCapacity) return [];
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
        stoneDepositReservedByAnother(world, residentId, deposit.id) ||
        hasHaulerRole(world) && deposit.bufferQuantity >= deposit.bufferCapacity) return [];
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
    blockedReason: stoneWaitReason(world, residentId),
    continuous: true,
    cancelAfterDelivery: false,
    assignmentSource: 'workRole'
  };
  const canLoad = hasHaulerRole(world)
    ? selected.deposit.bufferQuantity >= selected.deposit.bufferCapacity || selected.deposit.remaining < 1
    : selected.deposit.bufferQuantity >= 1 || selected.deposit.remaining < 1;
  const waitingForHauler = hasHaulerRole(world) && canLoad;
  const phase = selected.path.length > 0 ? 'walking_to_source' : waitingForHauler ? 'waiting_resource' : canLoad ? 'loading' : 'mining';
  const destination = chooseStorageForDelivery(world, stoneWorkPoint(selected.deposit), 1, resident.preferredStorageId, true);
  return {
    id: taskId,
    kind: 'gather-stone',
    phase,
    sourceId: selected.deposit.id,
    destinationId: destination?.storage.id ?? world.storage.id,
    path: phase === 'walking_to_source' ? selected.path : [],
    pathIndex: 0,
    progressTicks: 0,
    requiredTicks: phase === 'walking_to_source' ? selected.path.length : phase === 'loading' ? WOOD_LOADING_TICKS : 1,
    blockedReason: waitingForHauler ? 'SOURCE_BUFFER_FULL' : null,
    continuous: true,
    cancelAfterDelivery: false,
    assignmentSource: 'workRole'
  };
}

export function createStoneDeliveryTask(world: PeaceWorldSnapshot, residentId: string, taskId: string): GatherStoneTask | null {
  const resident = world.residents.find((candidate) => candidate.id === residentId);
  if (!resident || resident.task || resident.cargo < 1 || resident.cargoItemId !== 'stone') return null;
  const destination = chooseStorageForDelivery(world, resident.position, resident.cargo, resident.preferredStorageId, true);
  if (!destination) return null;
  const path = destination.route;
  const phase = path.length > 0 ? 'carrying_to_storage' : 'unloading';
  const continuous = resident.workRole === STONE_MINER_ROLE;
  return {
    id: taskId,
    kind: 'gather-stone',
    phase,
    sourceId: null,
    destinationId: destination.storage.id,
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
  if (hasHaulerRole(world) && world.stoneDeposits.some((deposit) =>
    deposit.bufferQuantity >= deposit.bufferCapacity)) return 'SOURCE_BUFFER_FULL';
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
  const waitingForHauler = hasHaulerRole(world) &&
    (selected.deposit.bufferQuantity >= selected.deposit.bufferCapacity || selected.deposit.remaining === 0);
  task.phase = selected.path.length > 0 ? 'walking_to_source'
    : waitingForHauler ? 'waiting_resource'
      : !hasHaulerRole(world) && (selected.deposit.bufferQuantity >= 1 || selected.deposit.remaining === 0) ? 'loading' : 'mining';
  task.requiredTicks = task.phase === 'walking_to_source' ? selected.path.length
    : task.phase === 'loading' ? WOOD_LOADING_TICKS : 1;
  task.blockedReason = waitingForHauler ? 'SOURCE_BUFFER_FULL' : null;
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
    const fallback = chooseStorageForDelivery(world, resident.position, 1, resident.preferredStorageId, true)?.storage.id ?? world.storage.id;
    const waiting = waitingGatherTask(taskId, fallback, 'NO_AVAILABLE_TREES');
    waiting.assignmentSource = assignmentSource;
    waitForWoodSource(world, resident, waiting);
    return waiting;
  }
  const phase = selected.path.length === 0 ? 'gathering' : 'walking_to_source';
  const destination = chooseStorageForDelivery(world, sourceWorkPoint(selected.source), 1, resident.preferredStorageId, true);
  return {
    id: taskId,
    kind: 'gather-wood',
    phase,
    sourceId: selected.source.id,
    destinationId: destination?.storage.id ?? world.storage.id,
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
  const destination = chooseStorageForDelivery(world, resident.position, resident.cargo, resident.preferredStorageId, true);
  if (!destination) return null;
  const path = destination.route;
  const phase = path.length === 0 ? 'unloading' : 'carrying_to_storage';
  return {
    id: taskId,
    kind: 'gather-wood',
    phase,
    sourceId: null,
    destinationId: destination.storage.id,
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
      reservedStone: 0,
      inTransitWood: 0,
      inTransitStone: 0
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
      reservedStone: 0,
      inTransitWood: 0,
      inTransitStone: 0
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
  const worksiteHauls = world.residents.filter((resident) => resident.task?.kind === 'haul' &&
    resident.task.destinationKind === 'building' && resident.task.orderId === orderId);
  const assignedResident = order?.assignedResidentId
    ? world.residents.find((resident) => resident.id === order.assignedResidentId) : undefined;
  const safeToCancelAssignedWait = assignedResident?.task &&
    (assignedResident.task.kind === 'build-cabin' || assignedResident.task.kind === 'build-workshop') &&
    assignedResident.task.orderId === orderId &&
    ['walking_to_build', 'carrying_materials_to_build', 'building', 'waiting_path', 'waiting_materials', 'blocked']
      .includes(assignedResident.task.phase) || Boolean(assignedResident && !assignedResident.task &&
        ['waiting_materials', 'waiting_builder', 'waiting_path'].includes(order?.status ?? ''));
  if (!order || !building || order.assignedResidentId && !safeToCancelAssignedWait || building.progressTicks > 0 ||
      !['waiting_materials', 'waiting_builder', 'waiting_path', 'in_progress', 'blocked'].includes(order.status)) return false;
  if (distributedStorageMode(world) && (building.reservedWood > 0 || building.reservedStone > 0)) return false;
  if (!distributedStorageMode(world) && storedResourceTotal(world) > world.storage.capacity) return false;
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
    if (resident.task?.kind === 'haul' && resident.task.destinationKind === 'building' && resident.task.orderId === orderId) {
      if (resident.cargo > 0) {
        if (!retargetCancelledWorksiteHaul(world, resident, resident.task, orderId)) return false;
      } else {
        releaseHaulSourceReservation(world, resident.task);
        releaseHaulDestinationReservation(world, resident.task);
        cancelLogisticsQueueTask(world, resident.task, 'BUILD_ORDER_CANCELLED');
        resident.task = null;
        residentStatus(resident);
      }
      continue;
    }
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
  const capacity = availableStorageCapacity(world, task.destinationId);
  if (capacity < 1 || resident.cargo < 1) {
    if (resident.cargo > 0 && redirectGatherWoodDelivery(world, resident, task)) return;
    task.phase = 'waiting_storage';
    task.blockedReason = 'STORAGE_FULL';
    task.progressTicks = 0;
    task.requiredTicks = WOOD_UNLOADING_TICKS;
    return;
  }
  const delivered = Math.min(capacity, resident.cargo);
  if (!adjustStorageStock(world, task.destinationId, 'wood', delivered)) {
    if (redirectGatherWoodDelivery(world, resident, task)) return;
    task.phase = 'waiting_storage';
    task.blockedReason = 'STORAGE_FULL';
    task.progressTicks = 0;
    task.requiredTicks = WOOD_UNLOADING_TICKS;
    return;
  }
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
  const capacity = availableStorageCapacity(world, task.destinationId);
  if (resident.cargo < 1 || resident.cargoItemId !== 'stone') {
    task.phase = 'blocked';
    task.blockedReason = 'CARGO_RESOURCE_MISMATCH';
    return;
  }
  if (capacity < 1) {
    if (redirectGatherStoneDelivery(world, resident, task)) return;
    task.phase = 'waiting_storage';
    task.blockedReason = 'STORAGE_FULL';
    task.progressTicks = 0;
    task.requiredTicks = WOOD_UNLOADING_TICKS;
    return;
  }
  const delivered = Math.min(capacity, resident.cargo);
  if (!adjustStorageStock(world, task.destinationId, 'stone', delivered)) {
    if (redirectGatherStoneDelivery(world, resident, task)) return;
    task.phase = 'waiting_storage';
    task.blockedReason = 'STORAGE_FULL';
    task.progressTicks = 0;
    task.requiredTicks = WOOD_UNLOADING_TICKS;
    return;
  }
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
  resident.visualState = task.kind === 'haul'
    ? task.phase === 'walking_to_source' ? 'hauling_to_source'
      : task.phase === 'loading' ? 'hauling_loading'
        : task.phase === 'carrying' ? task.destinationKind === 'building' ? 'hauling_to_worksite' : 'hauling_to_storage'
          : task.phase === 'unloading' ? 'hauling_unloading'
            : task.phase === 'waiting_path' || task.phase === 'waiting_storage' || task.phase === 'waiting_source'
              ? 'waiting_haul' : task.phase
    : task.kind === 'gather-stone'
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
  if (!redirectGatherStoneDelivery(world, resident, task, true)) {
    setStonePhase(task, 'waiting_path');
    task.blockedReason = 'NO_PATH_TO_STORAGE';
    task.path = [];
    task.pathIndex = 0;
    residentStatus(resident);
  }
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

function haulDestinationRoute(world: PeaceWorldSnapshot, resident: Resident, task: HaulTask) {
  if (task.destinationKind === 'storage') {
    const storage = storageById(world, task.destinationId);
    if (!storage) return null;
    const point = storageWorkPoint(storage);
    const route = surfacePath(resident.position, point);
    return route ? { point, route } : null;
  }
  const building = world.buildings.find((candidate) => candidate.id === task.destinationId);
  if (!building) return null;
  const access = placementWorkPoint(world, resident, building.anchor, building.id);
  return access && !access.waitReason ? { point: access.point, route: access.route } : null;
}

function setHaulPhase(task: HaulTask, phase: HaulTask['phase'], route: Array<{ x: number; y: number }>, requiredTicks: number): void {
  task.phase = phase;
  task.path = route;
  task.pathIndex = 0;
  task.progressTicks = 0;
  task.requiredTicks = Math.max(1, requiredTicks);
}

function activateHaulTask(world: PeaceWorldSnapshot, resident: Resident, task: HaulTask): boolean {
  if (resident.cargo > 0 && resident.cargoItemId === task.itemId) {
    const destination = haulDestinationRoute(world, resident, task);
    if (!destination) {
      if (task.phase !== 'waiting_path' || task.blockedReason !== 'NO_PATH_TO_DESTINATION') {
        task.phase = 'waiting_path';
        task.blockedReason = 'NO_PATH_TO_DESTINATION';
        task.path = [];
        task.pathIndex = 0;
        task.progressTicks = 0;
        task.requiredTicks = 1;
        residentStatus(resident);
        return true;
      }
      return false;
    }
    if (task.destinationKind === 'storage') {
      const storage = storageById(world, task.destinationId);
      if (!storage) {
        task.phase = 'waiting_storage';
        task.blockedReason = 'STORAGE_NOT_FOUND';
        residentStatus(resident);
        return true;
      }
      if (!task.destinationReserved) {
        if (storageFreeVolume(storage) < task.quantity) {
          if (task.phase !== 'waiting_storage' || task.blockedReason !== 'STORAGE_FULL') {
            task.phase = 'waiting_storage';
            task.blockedReason = 'STORAGE_FULL';
            task.path = [];
            task.pathIndex = 0;
            task.progressTicks = 0;
            task.requiredTicks = 1;
            residentStatus(resident);
            return true;
          }
          return false;
        }
        storage.reservedInbound[task.itemId] += task.quantity;
        updateStorageState(storage);
        task.destinationReserved = true;
      }
    }
    setHaulPhase(task, destination.route.length ? 'carrying' : 'unloading', destination.route,
      destination.route.length || WOOD_UNLOADING_TICKS);
    task.blockedReason = null;
    residentStatus(resident);
    return true;
  }

  const sourcePoint = haulSourcePosition(world, task.sourceKind, task.sourceId);
  if (!sourcePoint) {
    if (task.phase !== 'waiting_source' || task.blockedReason !== 'HAUL_SOURCE_MISSING') {
      task.phase = 'waiting_source';
      task.blockedReason = 'HAUL_SOURCE_MISSING';
      task.path = [];
      task.pathIndex = 0;
      residentStatus(resident);
      return true;
    }
    return false;
  }
  const route = surfacePath(resident.position, sourcePoint);
  if (!route) {
    if (task.phase !== 'waiting_path' || task.blockedReason !== 'NO_PATH_TO_SOURCE') {
      task.phase = 'waiting_path';
      task.blockedReason = 'NO_PATH_TO_SOURCE';
      task.path = [];
      task.pathIndex = 0;
      residentStatus(resident);
      return true;
    }
    return false;
  }
  setHaulPhase(task, route.length ? 'walking_to_source' : 'loading', route,
    route.length || WOOD_LOADING_TICKS);
  task.blockedReason = null;
  residentStatus(resident);
  return true;
}

function loadHaulSource(world: PeaceWorldSnapshot, resident: Resident, task: HaulTask): boolean {
  if (task.sourceKind === 'tree-buffer') {
    const tree = world.trees.find((candidate) => candidate.id === task.sourceId);
    if (!tree || tree.bufferQuantity < task.quantity || tree.reservedBuffer < task.quantity) return false;
    tree.bufferQuantity -= task.quantity;
    tree.reservedBuffer -= task.quantity;
  } else if (task.sourceKind === 'stone-buffer') {
    const deposit = world.stoneDeposits.find((candidate) => candidate.id === task.sourceId);
    if (!deposit || deposit.bufferQuantity < task.quantity || deposit.reservedBuffer < task.quantity) return false;
    deposit.bufferQuantity -= task.quantity;
    deposit.reservedBuffer -= task.quantity;
  } else {
    const storage = storageById(world, task.sourceId);
    if (!storage || storage.contents[task.itemId] < task.quantity || storage.reservedOutbound[task.itemId] < task.quantity) return false;
    storage.reservedOutbound[task.itemId] -= task.quantity;
    storage.contents[task.itemId] -= task.quantity;
    synchronizeStorageTotals(world);
  }
  resident.cargo = task.quantity;
  resident.cargoItemId = task.itemId;
  const destination = haulDestinationRoute(world, resident, task);
  if (!destination) {
    task.phase = 'waiting_path';
    task.blockedReason = 'NO_PATH_TO_DESTINATION';
    task.path = [];
    task.pathIndex = 0;
    task.progressTicks = 0;
    task.requiredTicks = 1;
  } else {
    setHaulPhase(task, destination.route.length ? 'carrying' : 'unloading', destination.route,
      destination.route.length || WOOD_UNLOADING_TICKS);
    task.blockedReason = null;
  }
  residentStatus(resident);
  return true;
}

function finishHaul(world: PeaceWorldSnapshot, resident: Resident, task: HaulTask): boolean {
  if (resident.cargo !== task.quantity || resident.cargoItemId !== task.itemId) {
    task.phase = 'blocked';
    task.blockedReason = 'HAUL_CARGO_MISMATCH';
    residentStatus(resident);
    return true;
  }
  if (task.destinationKind === 'storage') {
    const storage = storageById(world, task.destinationId);
    if (!storage || !task.destinationReserved || storage.reservedInbound[task.itemId] < task.quantity ||
        storageUsedVolume(storage) + storageReservedInboundVolume(storage) > storage.capacity) {
      task.phase = 'waiting_storage';
      task.blockedReason = 'STORAGE_FULL';
      task.progressTicks = 0;
      residentStatus(resident);
      return true;
    }
    storage.reservedInbound[task.itemId] -= task.quantity;
    storage.contents[task.itemId] += task.quantity;
    synchronizeStorageTotals(world);
  } else {
    const building = world.buildings.find((candidate) => candidate.id === task.destinationId);
    const order = task.orderId && world.buildOrders.find((candidate) => candidate.id === task.orderId);
    if (!building || !order || order.status === 'cancelled' || order.status === 'completed') {
      task.phase = 'blocked';
      task.blockedReason = 'BUILD_ORDER_UNAVAILABLE';
      residentStatus(resident);
      return true;
    }
    if (task.itemId === 'wood') {
      building.inTransitWood = Math.max(0, building.inTransitWood - task.quantity);
      building.reservedWood += task.quantity;
    } else {
      building.inTransitStone = Math.max(0, building.inTransitStone - task.quantity);
      building.reservedStone += task.quantity;
    }
    building.state = 'waiting_materials';
  }
  completeLogisticsQueueTask(world, resident, task);
  resident.cargo = 0;
  resident.cargoItemId = null;
  resident.task = null;
  residentStatus(resident);
  return true;
}

function advanceHaulTaskTick(world: PeaceWorldSnapshot, resident: Resident, task: HaulTask): boolean {
  if (task.phase === 'walking_to_source' || task.phase === 'carrying') {
    if (!moveAlongPath(resident, task)) return true;
    if (task.phase === 'walking_to_source') setHaulPhase(task, 'loading', [], WOOD_LOADING_TICKS);
    else setHaulPhase(task, 'unloading', [], WOOD_UNLOADING_TICKS);
    residentStatus(resident);
    return true;
  }
  if (task.phase === 'loading') {
    task.progressTicks += 1;
    if (task.progressTicks < task.requiredTicks) return true;
    return loadHaulSource(world, resident, task);
  }
  if (task.phase === 'unloading') {
    task.progressTicks += 1;
    if (task.progressTicks < task.requiredTicks) return true;
    return finishHaul(world, resident, task);
  }
  return false;
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
        const waitForHauler = hasHaulerRole(world) && loadable;
        setStonePhase(task, waitForHauler ? 'waiting_resource' : loadable ? 'loading' : 'mining',
          loadable && !waitForHauler ? WOOD_LOADING_TICKS : 1);
        task.blockedReason = waitForHauler ? 'SOURCE_BUFFER_FULL' : null;
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
      if (hasHaulerRole(world)) {
        setStonePhase(task, 'waiting_resource');
        task.blockedReason = 'SOURCE_BUFFER_FULL';
      } else {
        setStonePhase(task, 'loading', WOOD_LOADING_TICKS);
      }
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
    if (hasHaulerRole(world)) {
      setStonePhase(task, 'waiting_resource');
      task.blockedReason = 'SOURCE_BUFFER_FULL';
      residentStatus(resident);
      return true;
    }
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
    const destination = chooseStorageForDelivery(world, resident.position, resident.cargo, resident.preferredStorageId, true);
    if (!destination) {
      setStonePhase(task, 'waiting_path');
      task.blockedReason = 'NO_PATH_TO_STORAGE';
      task.path = [];
      task.pathIndex = 0;
      residentStatus(resident);
      return true;
    }
    task.destinationId = destination.storage.id;
    task.path = destination.route;
    task.pathIndex = 0;
    setStonePhase(task, destination.route.length > 0 ? 'carrying_to_storage' : 'unloading',
      destination.route.length > 0 ? destination.route.length : WOOD_UNLOADING_TICKS);
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
      if (hasHaulerRole(world)) {
        if (source.bufferQuantity >= source.bufferCapacity) {
          task.phase = 'waiting_resource';
          task.sourceId = null;
          task.blockedReason = 'SOURCE_BUFFER_FULL';
          task.path = [];
          task.pathIndex = 0;
          task.progressTicks = 0;
          task.requiredTicks = 1;
          residentStatus(resident);
          return true;
        }
        source.remaining -= 1;
        source.bufferQuantity += 1;
        if (source.remaining === 0) source.state = 'stump';
        task.phase = 'waiting_resource';
        task.sourceId = null;
        task.blockedReason = source.bufferQuantity >= source.bufferCapacity
          ? 'SOURCE_BUFFER_FULL' : 'WAITING_FOR_HAUL';
        task.path = [];
        task.pathIndex = 0;
        task.progressTicks = 0;
        task.requiredTicks = 1;
        residentStatus(resident);
        return true;
      }
      source.remaining -= 1;
      if (source.remaining === 0) {
        source.state = 'stump';
      }
      resident.cargo += 1;
      resident.cargoItemId = 'wood';
      const destination = storageById(world, task.destinationId) ?? getStorages(world)[0]!;
      const storageWorkPoint = storageAccessPoint(destination);
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
  if (task.kind === 'haul') return advanceHaulTaskTick(world, resident, task);

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
    } else if (hasHaulerRole(world) && unlocked.every((tree) =>
      tree.bufferQuantity >= tree.bufferCapacity)) {
      task.phase = 'waiting_resource';
      task.sourceId = null;
      task.blockedReason = 'SOURCE_BUFFER_FULL';
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
    if (task.kind === 'haul' && ['waiting_path', 'waiting_storage', 'waiting_source'].includes(task.phase)) {
      changed = activateHaulTask(world, resident, task) || changed;
      continue;
    }
    if (task.kind === 'gather-wood' && (task.phase === 'waiting_resource' ||
        task.phase === 'waiting_path' && (task.sourceId === null || task.blockedReason === 'NO_PATH_TO_SOURCE'))) {
      changed = activateGatherTask(world, resident, task) || changed;
      continue;
    }
    if (task.kind === 'gather-wood' && task.phase === 'waiting_storage') {
      if (resident.cargo > 0 && resident.cargoItemId === 'wood') {
        if (availableStorageCapacity(world, task.destinationId) > 0) {
          setGatherPhase(task, 'unloading', WOOD_UNLOADING_TICKS);
          task.blockedReason = null;
          residentStatus(resident);
          changed = true;
        } else if (redirectGatherWoodDelivery(world, resident, task)) {
          changed = true;
        }
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
      changed = redirectGatherStoneDelivery(world, resident, task) || changed;
      continue;
    }
    if (task.kind === 'gather-stone' && task.phase === 'waiting_storage') {
      if (resident.cargo > 0 && resident.cargoItemId === 'stone') {
        if (availableStorageCapacity(world, task.destinationId) > 0) {
          setStonePhase(task, 'unloading', WOOD_UNLOADING_TICKS);
          task.blockedReason = null;
          residentStatus(resident);
          changed = true;
        } else if (redirectGatherStoneDelivery(world, resident, task)) {
          changed = true;
        }
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
const logisticsBuildOrderStatuses: PeaceBuildOrder['status'][] = [...pendingBuildOrderStatuses, 'in_progress'];

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

function requiredForBuilding(building: PeaceBuilding): { wood: number; stone: number } {
  return requiredBuildingMaterials(building.kind);
}

function worksiteHaulCandidates(
  world: PeaceWorldSnapshot,
  building: PeaceBuilding,
  resident: Resident,
  itemId: PeaceCargoItem,
  quantity: number
): HaulPlan[] {
  const buildingAccess = placementWorkPoint(world, resident, building.anchor, building.id);
  if (!buildingAccess || buildingAccess.waitReason) return [];
  const order = world.buildOrders.find((candidate) => candidate.id === building.orderId);
  const priority: PeaceLogisticsPriority = building.progressTicks > 0 || order?.status === 'in_progress'
    ? 'active_construction' : 'ready_construction';
  const sources: Array<{ kind: HaulTask['sourceKind']; id: string; available: number; point: { x: number; y: number } }> = [];
  for (const storage of getStorages(world)) {
    const available = storage.contents[itemId] - storage.reservedOutbound[itemId];
    if (available > 0 && storage.status !== 'blocked') {
      sources.push({ kind: 'storage', id: storage.id, available, point: storageWorkPoint(storage) });
    }
  }
  if (itemId === 'wood') {
    for (const tree of world.trees) {
      const available = tree.bufferQuantity - tree.reservedBuffer;
      if (available > 0) sources.push({ kind: 'tree-buffer', id: tree.id, available, point: sourceWorkPoint(tree) });
    }
  } else {
    for (const deposit of world.stoneDeposits) {
      const available = deposit.bufferQuantity - deposit.reservedBuffer;
      if (available > 0) sources.push({ kind: 'stone-buffer', id: deposit.id, available, point: stoneWorkPoint(deposit) });
    }
  }
  return sources.flatMap((source) => {
    const toSite = surfacePath(source.point, buildingAccess.point);
    if (!toSite) return [];
    const sourceRoute = surfacePath(resident.position, source.point);
    if (!sourceRoute) return [];
    return [{
      sourceKind: source.kind,
      sourceId: source.id,
      destinationKind: 'building' as const,
      destinationId: building.id,
      orderId: building.orderId,
      itemId,
      quantity: Math.min(quantity, source.available),
      assignmentSource: 'workRole' as const,
      demandKey: `construction:${building.orderId}:${itemId}`,
      priority,
      queuePosition: order?.queuePosition ?? Number.MAX_SAFE_INTEGER,
      routeLength: sourceRoute.length + toSite.length
    }];
  }).filter((plan) => plan.quantity > 0)
    .sort((a, b) => {
      if (a.sourceId === resident.preferredHaulSourceId) return -1;
      if (b.sourceId === resident.preferredHaulSourceId) return 1;
      return (a.routeLength ?? Number.MAX_SAFE_INTEGER) - (b.routeLength ?? Number.MAX_SAFE_INTEGER) ||
        a.sourceId.localeCompare(b.sourceId);
    });
}

function haulerWorksitePlans(world: PeaceWorldSnapshot, carrier: Resident): HaulPlan[] {
  const orders = [...world.buildOrders].filter((order) =>
    logisticsBuildOrderStatuses.includes(order.status) && order.assignedResidentId
  ).sort((a, b) => a.queuePosition - b.queuePosition || a.id.localeCompare(b.id));
  return orders.flatMap((order) => {
    if (carrier.workRole === 'builder' && order.assignedResidentId !== carrier.id) return [];
    const building = world.buildings.find((candidate) => candidate.id === order.buildingId);
    if (!building) return [];
    const required = requiredForBuilding(building);
    const missingWood = Math.max(0, required.wood - building.reservedWood - building.inTransitWood);
    const missingStone = Math.max(0, required.stone - building.reservedStone - building.inTransitStone);
    const plans: HaulPlan[] = [];
    if (missingWood > 0) plans.push(...worksiteHaulCandidates(world, building, carrier, 'wood', missingWood));
    if (missingStone > 0) plans.push(...worksiteHaulCandidates(world, building, carrier, 'stone', missingStone));
    return plans;
  });
}

function bufferToStorageHaulCandidates(world: PeaceWorldSnapshot, carrier: Resident): HaulPlan[] {
  const sources: Array<{
    sourceKind: HaulTask['sourceKind']; sourceId: string; itemId: PeaceCargoItem;
    quantity: number; capacity: number; point: { x: number; y: number }
  }> = [
    ...world.trees.filter((tree) => tree.bufferQuantity > tree.reservedBuffer).map((tree) => ({
      sourceKind: 'tree-buffer' as const, sourceId: tree.id, itemId: 'wood' as const,
      quantity: tree.bufferQuantity - tree.reservedBuffer, capacity: tree.bufferCapacity, point: sourceWorkPoint(tree)
    })),
    ...world.stoneDeposits.filter((deposit) => deposit.bufferQuantity > deposit.reservedBuffer).map((deposit) => ({
      sourceKind: 'stone-buffer' as const, sourceId: deposit.id, itemId: 'stone' as const,
      quantity: deposit.bufferQuantity - deposit.reservedBuffer, capacity: deposit.bufferCapacity, point: stoneWorkPoint(deposit)
    }))
  ];
  const maxCarry = world.logisticsPolicy.carryCapacity ?? Number.MAX_SAFE_INTEGER;
  const plans: HaulPlan[] = [];
  const fallbackReason = (sourcePoint: { x: number; y: number }, storageId: string): string | null => {
    const preferredId = carrier.preferredStorageId;
    if (!preferredId || preferredId === storageId) return null;
    const preferred = storageById(world, preferredId);
    if (!preferred) return 'PREFERRED_STORAGE_MISSING';
    if (storageFreeVolume(preferred) < 1) return 'PREFERRED_STORAGE_FULL';
    if (!surfacePath(sourcePoint, storageWorkPoint(preferred))) return 'NO_PATH_TO_PREFERRED_STORAGE';
    return 'PREFERRED_STORAGE_NOT_SELECTED';
  };
  for (const source of sources) {
    const toSource = surfacePath(carrier.position, source.point);
    if (!toSource) continue;
    for (const storage of getStorages(world)) {
      const free = storageFreeVolume(storage);
      if (free < 1 || storage.status === 'blocked') continue;
      const toStorage = surfacePath(source.point, storageWorkPoint(storage));
      if (!toStorage) continue;
      const quantity = Math.min(source.quantity, free, maxCarry);
      if (quantity < 1) continue;
      const priority = source.quantity >= source.capacity ? 'buffer_clearance' : 'warehouse_restock';
      plans.push({
        sourceKind: source.sourceKind, sourceId: source.sourceId, destinationKind: 'storage',
        destinationId: storage.id, itemId: source.itemId, quantity, assignmentSource: 'workRole',
        demandKey: `buffer:${source.sourceKind}:${source.sourceId}:${source.itemId}:${storage.id}`,
        priority, preferredDestination: carrier.preferredStorageId === storage.id,
        preferredStorageId: carrier.preferredStorageId,
        fallbackReason: fallbackReason(source.point, storage.id),
        routeLength: toSource.length + toStorage.length
      });
    }
  }
  return plans;
}

function storageRebalanceHaulCandidates(world: PeaceWorldSnapshot, carrier: Resident): HaulPlan[] {
  const destination = carrier.preferredStorageId ? storageById(world, carrier.preferredStorageId) : undefined;
  if (!destination || storageFreeVolume(destination) < 1) return [];
  const maxCarry = world.logisticsPolicy.carryCapacity ?? Number.MAX_SAFE_INTEGER;
  const plans: HaulPlan[] = [];
  for (const source of getStorages(world)) {
    if (source.id === destination.id || source.status === 'blocked') continue;
    const toSource = surfacePath(carrier.position, storageWorkPoint(source));
    if (!toSource) continue;
    const toDestination = surfacePath(storageWorkPoint(source), storageWorkPoint(destination));
    if (!toDestination) continue;
    for (const itemId of ['wood', 'stone'] as const) {
      const available = source.contents[itemId] - source.reservedOutbound[itemId];
      const quantity = Math.min(available, storageFreeVolume(destination), maxCarry);
      if (quantity < 1) continue;
      plans.push({
        sourceKind: 'storage', sourceId: source.id, destinationKind: 'storage', destinationId: destination.id,
        itemId, quantity, assignmentSource: 'manual', demandKey: `rebalance:${source.id}:${destination.id}:${itemId}`,
        priority: 'rebalancing', preferredDestination: true, preferredStorageId: destination.id,
        fallbackReason: null, routeLength: toSource.length + toDestination.length
      });
    }
  }
  return plans;
}

function haulerPlans(world: PeaceWorldSnapshot, carrier: Resident): HaulPlan[] {
  return [
    ...haulerWorksitePlans(world, carrier),
    ...bufferToStorageHaulCandidates(world, carrier),
    ...storageRebalanceHaulCandidates(world, carrier)
  ];
}

function recordBlockedBufferDemands(world: PeaceWorldSnapshot): boolean {
  let changed = false;
  const maxCarry = world.logisticsPolicy.carryCapacity ?? Number.MAX_SAFE_INTEGER;
  const sources = [
    ...world.trees.filter((tree) => tree.bufferQuantity > tree.reservedBuffer).map((tree) => ({
      sourceKind: 'tree-buffer' as const, sourceId: tree.id, itemId: 'wood' as const,
      quantity: tree.bufferQuantity - tree.reservedBuffer, capacity: tree.bufferCapacity, point: sourceWorkPoint(tree)
    })),
    ...world.stoneDeposits.filter((deposit) => deposit.bufferQuantity > deposit.reservedBuffer).map((deposit) => ({
      sourceKind: 'stone-buffer' as const, sourceId: deposit.id, itemId: 'stone' as const,
      quantity: deposit.bufferQuantity - deposit.reservedBuffer, capacity: deposit.bufferCapacity, point: stoneWorkPoint(deposit)
    }))
  ];
  const storages = getStorages(world);
  for (const source of sources) {
    const reachable = storages.filter((storage) => storageFreeVolume(storage) > 0 &&
      Boolean(surfacePath(source.point, storageWorkPoint(storage))));
    if (reachable.length > 0) continue;
    const target = storages.find((storage) => storage.id === world.residents.find((resident) =>
      resident.workRole === 'hauler' && resident.preferredStorageId)?.preferredStorageId) ?? storages[0];
    if (!target) continue;
    const plan: HaulPlan = {
      sourceKind: source.sourceKind, sourceId: source.sourceId, destinationKind: 'storage', destinationId: target.id,
      itemId: source.itemId, quantity: Math.min(source.quantity, maxCarry), assignmentSource: 'workRole',
      demandKey: `buffer:${source.sourceKind}:${source.sourceId}:${source.itemId}:${target.id}`,
      priority: source.quantity >= source.capacity ? 'buffer_clearance' : 'warehouse_restock'
    };
    const anyCapacity = storages.some((storage) => storageFreeVolume(storage) > 0);
    const preferredCarrier = world.residents.find((resident) => resident.workRole === 'hauler' && resident.preferredStorageId);
    const preferred = preferredCarrier?.preferredStorageId ? storageById(world, preferredCarrier.preferredStorageId) : undefined;
    const reason = preferred && storageFreeVolume(preferred) < 1 ? 'PREFERRED_STORAGE_FULL'
      : preferred && !surfacePath(source.point, storageWorkPoint(preferred)) ? 'NO_PATH_TO_PREFERRED_STORAGE'
        : !anyCapacity ? 'STORAGE_FULL' : 'NO_PATH_TO_STORAGE';
    plan.preferredStorageId = preferredCarrier?.preferredStorageId ?? null;
    plan.fallbackReason = reason;
    changed = recordWaitingLogisticsTask(world, plan, reason, 'blocked') || changed;
  }
  return changed;
}

function recordBlockedConstructionDemands(world: PeaceWorldSnapshot): boolean {
  let changed = false;
  const haulers = world.residents.filter((resident) => resident.workRole === 'hauler');
  for (const order of world.buildOrders) {
    if (!logisticsBuildOrderStatuses.includes(order.status) || !order.assignedResidentId) continue;
    const building = world.buildings.find((candidate) => candidate.id === order.buildingId);
    if (!building) continue;
    const required = requiredForBuilding(building);
    const priority: PeaceLogisticsPriority = building.progressTicks > 0 || order.status === 'in_progress'
      ? 'active_construction' : 'ready_construction';
    for (const itemId of ['wood', 'stone'] as const) {
      const delivered = itemId === 'wood' ? building.reservedWood : building.reservedStone;
      const inbound = itemId === 'wood' ? building.inTransitWood : building.inTransitStone;
      const missing = Math.max(0, required[itemId] - delivered - inbound);
      if (missing < 1) continue;
      const candidates = haulers.flatMap((carrier) => worksiteHaulCandidates(world, building, carrier, itemId, missing));
      if (candidates.length > 0) continue;
      const sources: Array<{ kind: HaulTask['sourceKind']; id: string; available: number }> = [];
      for (const storage of getStorages(world)) {
        sources.push({ kind: 'storage', id: storage.id, available: storage.contents[itemId] - storage.reservedOutbound[itemId] });
      }
      if (itemId === 'wood') {
        for (const tree of world.trees) sources.push({ kind: 'tree-buffer', id: tree.id, available: tree.bufferQuantity - tree.reservedBuffer });
      } else {
        for (const deposit of world.stoneDeposits) sources.push({ kind: 'stone-buffer', id: deposit.id, available: deposit.bufferQuantity - deposit.reservedBuffer });
      }
      const source = sources.sort((a, b) => b.available - a.available || a.id.localeCompare(b.id))[0];
      if (!source) continue;
      const sourceKind = source.kind;
      const plan: HaulPlan = {
        sourceKind, sourceId: source.id, destinationKind: 'building', destinationId: building.id,
        orderId: order.id, itemId, quantity: Math.max(1, Math.min(missing, Math.max(0, source.available))),
        assignmentSource: 'workRole', demandKey: `construction:${order.id}:${itemId}`, priority
      };
      const reason = source.available < 1 ? 'NO_ITEM' : 'NO_PATH_TO_WORKSITE';
      changed = recordWaitingLogisticsTask(world, plan, reason, 'blocked') || changed;
    }
  }
  return changed;
}

function startHaulerWorksiteTask(world: PeaceWorldSnapshot, carrier: Resident): boolean {
  const orders = [...world.buildOrders].filter((order) =>
    logisticsBuildOrderStatuses.includes(order.status) && order.assignedResidentId
  ).sort((a, b) => a.queuePosition - b.queuePosition || a.id.localeCompare(b.id));
  for (const order of orders) {
    if (carrier.workRole === 'builder' && order.assignedResidentId !== carrier.id) continue;
    const building = world.buildings.find((candidate) => candidate.id === order.buildingId);
    if (!building) continue;
    const required = requiredForBuilding(building);
    const missingWood = Math.max(0, required.wood - building.reservedWood - building.inTransitWood);
    const missingStone = Math.max(0, required.stone - building.reservedStone - building.inTransitStone);
    for (const [itemId, missing] of [['wood', missingWood], ['stone', missingStone]] as const) {
      if (missing < 1) continue;
      const candidates = worksiteHaulCandidates(world, building, carrier, itemId, missing);
      for (const candidate of candidates) {
        if (createHaulTask(world, carrier, `haul-${order.id}-${carrier.id}-${itemId}`, candidate)) return true;
      }
      if (candidates.length === 0) {
        order.blockedReason = availablePhysicalResource(world, itemId) > 0 ? 'NO_PATH_TO_STORAGE'
          : itemId === 'wood' ? 'INSUFFICIENT_WOOD' : 'INSUFFICIENT_STONE';
        setBuildOrderStatus(world, order, order.blockedReason === 'NO_PATH_TO_STORAGE' ? 'waiting_path' : 'waiting_materials', order.blockedReason);
      }
    }
  }
  return false;
}

function availablePhysicalResource(world: PeaceWorldSnapshot, itemId: PeaceCargoItem): number {
  const warehouseStock = getStorages(world).reduce((sum, storage) =>
    sum + Math.max(0, storage.contents[itemId] - storage.reservedOutbound[itemId]), 0);
  const bufferedStock = itemId === 'wood'
    ? world.trees.reduce((sum, tree) => sum + Math.max(0, tree.bufferQuantity - tree.reservedBuffer), 0)
    : world.stoneDeposits.reduce((sum, deposit) => sum + Math.max(0, deposit.bufferQuantity - deposit.reservedBuffer), 0);
  const unassignedCargo = world.residents.reduce((sum, resident) => {
    if (resident.cargoItemId !== itemId || resident.cargo < 1) return sum;
    const task = resident.task;
    if (task?.kind === 'haul' || task?.kind === 'build-cabin' || task?.kind === 'build-workshop') return sum;
    if (task?.kind === 'gather-stone' && task.deliveryQuantity !== undefined) return sum;
    return sum + resident.cargo;
  }, 0);
  return warehouseStock + bufferedStock + unassignedCargo;
}

function distributedMaterialWaitReason(
  world: PeaceWorldSnapshot,
  building: PeaceBuilding,
  resident: Resident,
  itemId: PeaceCargoItem,
  missing: number
): string {
  if (availablePhysicalResource(world, itemId) < missing) return itemId === 'wood' ? 'INSUFFICIENT_WOOD' : 'INSUFFICIENT_STONE';
  return worksiteHaulCandidates(world, building, resident, itemId, missing).length > 0
    ? 'WAITING_FOR_HAUL' : 'NO_PATH_TO_STORAGE';
}

function scheduleDistributedBuildOrders(world: PeaceWorldSnapshot): boolean {
  let changed = false;
  const orders = [...world.buildOrders].sort((a, b) => a.queuePosition - b.queuePosition || a.id.localeCompare(b.id));
  const builders = [...world.residents].filter((resident) => resident.workRole === 'builder')
    .sort((a, b) => a.id.localeCompare(b.id));
  for (const order of orders) {
    if (!pendingBuildOrderStatuses.includes(order.status)) continue;
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

    let owner = order.assignedResidentId ? builders.find((resident) => resident.id === order.assignedResidentId) : undefined;
    if (!owner) {
      owner = builders.find((resident) => !resident.task && resident.cargo === 0 &&
        !orders.some((other) => other.id !== order.id && other.assignedResidentId === resident.id &&
          pendingBuildOrderStatuses.includes(other.status)));
      if (!owner) {
        changed = setBuildOrderStatus(world, order, 'waiting_builder', 'NO_BUILDER') || changed;
        continue;
      }
      order.assignedResidentId = owner.id;
      order.requiresExplicitBuilder = false;
      changed = true;
    }
    if (owner.task) {
      const ownsBuildTask = (owner.task.kind === 'build-cabin' || owner.task.kind === 'build-workshop') &&
        owner.task.orderId === order.id;
      const haulsForOrder = owner.task.kind === 'haul' && owner.task.destinationKind === 'building' &&
        owner.task.destinationId === building.id;
      if (ownsBuildTask || haulsForOrder) continue;
      changed = setBuildOrderStatus(world, order, 'waiting_materials', 'WAITING_FOR_HAUL') || changed;
      continue;
    }

    const required = requiredForBuilding(building);
    const missingWood = Math.max(0, required.wood - building.reservedWood);
    const missingStone = Math.max(0, required.stone - building.reservedStone);
    if (missingWood > 0 || missingStone > 0) {
      const itemId: PeaceCargoItem = missingWood > 0 ? 'wood' : 'stone';
      const missing = missingWood > 0 ? missingWood : missingStone;
      const inbound = itemId === 'wood' ? building.inTransitWood : building.inTransitStone;
      const reason = inbound >= missing ? 'WAITING_FOR_HAUL'
        : distributedMaterialWaitReason(world, building, owner, itemId, Math.max(0, missing - inbound));
      if (owner.state !== 'waiting' || owner.visualState !== 'waiting_materials' || owner.blockedReason !== reason) changed = true;
      owner.state = 'waiting';
      owner.visualState = 'waiting_materials';
      owner.blockedReason = reason;
      changed = setBuildOrderStatus(world, order, 'waiting_materials', reason) || changed;
      continue;
    }

    const taskId = `build-${order.id}-${owner.id}`;
    const task = building.kind === 'workshop'
      ? createBuildWorkshopTask(world, owner.id, taskId, building.id, order.id, building.anchor)
      : createBuildCabinTask(world, owner.id, taskId, building.id, order.id, building.anchor);
    if (!task || task.phase === 'waiting_path') {
      changed = setBuildOrderStatus(world, order, 'waiting_path', task?.blockedReason ?? 'NO_PATH_TO_BUILD_SITE') || changed;
      continue;
    }
    owner.task = task;
    residentStatus(owner);
    changed = setBuildOrderStatus(world, order, 'in_progress', null) || changed;
    order.assignedResidentId = owner.id;
    changed = true;
  }
  return changed;
}

function scheduleHaulerRoles(world: PeaceWorldSnapshot): boolean {
  let changed = false;
  const hasHauler = hasHaulerRole(world);
  const haulers = [...world.residents].filter((resident) => resident.workRole === 'hauler')
    .sort((a, b) => a.id.localeCompare(b.id));
  const carryLimit = world.logisticsPolicy.carryCapacity ?? Number.MAX_SAFE_INTEGER;
  for (const carrier of haulers) {
    for (const plan of haulerPlans(world, carrier)) {
      const queuedPlan = { ...plan, quantity: Math.min(plan.quantity, carryLimit) };
      if (queuedPlan.quantity > 0) changed = recordWaitingLogisticsTask(world, queuedPlan, 'NO_WORKER', 'queued') || changed;
    }
  }
  const free = new Set(haulers.filter((carrier) => !carrier.task && carrier.cargo === 0).map((carrier) => carrier.id));
  const attempted = new Set<string>();
  while (free.size > 0) {
    const candidates = haulers.flatMap((carrier) => free.has(carrier.id)
      ? haulerPlans(world, carrier).map((plan) => ({ carrier, plan })) : []);
    candidates.sort((a, b) => {
      const priorityA = logisticsPriorityRank(world, a.plan.priority ?? 'warehouse_restock');
      const priorityB = logisticsPriorityRank(world, b.plan.priority ?? 'warehouse_restock');
      return priorityA - priorityB ||
        (a.plan.queuePosition ?? Number.MAX_SAFE_INTEGER) - (b.plan.queuePosition ?? Number.MAX_SAFE_INTEGER) ||
        Number(b.plan.preferredDestination) - Number(a.plan.preferredDestination) ||
        (a.plan.routeLength ?? Number.MAX_SAFE_INTEGER) - (b.plan.routeLength ?? Number.MAX_SAFE_INTEGER) ||
        a.carrier.id.localeCompare(b.carrier.id) ||
        a.plan.demandKey?.localeCompare(b.plan.demandKey ?? '') ||
        a.plan.sourceId.localeCompare(b.plan.sourceId);
    });
    let assigned = false;
    for (const candidate of candidates) {
      const { carrier, plan } = candidate;
      const key = `${carrier.id}:${haulDemandKey(plan)}:${plan.sourceKind}:${plan.sourceId}:${plan.destinationId}`;
      if (attempted.has(key)) continue;
      attempted.add(key);
      plan.quantity = Math.min(plan.quantity, carryLimit);
      if (plan.quantity < 1) continue;
      const taskId = `haul-${world.revision.serverTick}-${world.nextLogisticsSequence}-${carrier.id}`;
      if (!createHaulTask(world, carrier, taskId, plan)) continue;
      carrier.state = 'working';
      free.delete(carrier.id);
      changed = true;
      assigned = true;
      break;
    }
    if (assigned) continue;
    break;
  }

  changed = recordBlockedBufferDemands(world) || changed;
  changed = recordBlockedConstructionDemands(world) || changed;
  for (const carrier of haulers.filter((candidate) => candidate.task || candidate.cargo > 0)) {
    const assigned = haulerPlans(world, carrier);
    for (const plan of assigned) {
      const queuedPlan = { ...plan, quantity: Math.min(plan.quantity, carryLimit) };
      if (queuedPlan.quantity > 0) changed = recordWaitingLogisticsTask(world, queuedPlan, 'NO_WORKER', 'queued') || changed;
    }
  }
  const livePlanKeys = new Set(haulers.flatMap((carrier) => haulerPlans(world, carrier).map(logisticsPlanKey)));
  changed = pruneStaleQueuedLogisticsTasks(world, livePlanKeys) || changed;

  for (const carrier of haulers) {
    if (carrier.task || carrier.cargo > 0) continue;
    const plans = haulerPlans(world, carrier);
    if (plans.length > 0) continue;
    const hasBufferStock = world.trees.some((tree) => tree.bufferQuantity > tree.reservedBuffer) ||
      world.stoneDeposits.some((deposit) => deposit.bufferQuantity > deposit.reservedBuffer);
    const hasPreferredTransfer = Boolean(carrier.preferredStorageId);
    const blocked = hasBufferStock || hasPreferredTransfer;
    const sources = [
      ...world.trees.filter((tree) => tree.bufferQuantity > tree.reservedBuffer).map(sourceWorkPoint),
      ...world.stoneDeposits.filter((deposit) => deposit.bufferQuantity > deposit.reservedBuffer).map(stoneWorkPoint)
    ];
    const storages = getStorages(world);
    const anyStorageCapacity = storages.some((storage) => storageFreeVolume(storage) > 0);
    const anyStorageRoute = sources.some((source) => storages.some((storage) =>
      Boolean(surfacePath(source, storageWorkPoint(storage)))));
    const nextState = blocked ? 'waiting' : 'idle';
    const nextVisual = blocked ? 'waiting_haul' : 'idle';
    if (carrier.state !== nextState || carrier.visualState !== nextVisual) changed = true;
    carrier.state = nextState;
    carrier.visualState = nextVisual;
    const preferredStorage = carrier.preferredStorageId ? storageById(world, carrier.preferredStorageId) : undefined;
    carrier.blockedReason = blocked ? preferredStorage && storageFreeVolume(preferredStorage) < 1
      ? 'PREFERRED_STORAGE_FULL'
      : preferredStorage && !sources.some((source) => surfacePath(source, storageWorkPoint(preferredStorage)))
        ? 'NO_PATH_TO_PREFERRED_STORAGE'
        : hasBufferStock && anyStorageCapacity && !anyStorageRoute ? 'NO_PATH_TO_STORAGE' : 'STORAGE_FULL' : null;
  }
  if (!hasHauler) {
    const builders = [...world.residents].filter((resident) => resident.workRole === 'builder' && !resident.task && resident.cargo === 0)
      .sort((a, b) => a.id.localeCompare(b.id));
    for (const builder of builders) {
      const orders = [...world.buildOrders].filter((order) => pendingBuildOrderStatuses.includes(order.status) &&
        order.assignedResidentId === builder.id).sort((a, b) => a.queuePosition - b.queuePosition || a.id.localeCompare(b.id));
      for (const order of orders) {
        const building = world.buildings.find((candidate) => candidate.id === order.buildingId);
        if (!building) continue;
        const required = requiredForBuilding(building);
        const missingWood = Math.max(0, required.wood - building.reservedWood - building.inTransitWood);
        const missingStone = Math.max(0, required.stone - building.reservedStone - building.inTransitStone);
        let started = startHaulerWorksiteTask(world, builder);
        if (started) {
          builder.state = 'working';
          changed = true;
          break;
        }
      }
    }
  }
  return changed;
}

function scheduleBuildOrders(world: PeaceWorldSnapshot): boolean {
  if (distributedStorageMode(world)) return scheduleDistributedBuildOrders(world);
  let changed = false;
  const orders = [...world.buildOrders].sort((a, b) => a.queuePosition - b.queuePosition || a.id.localeCompare(b.id));
  const builders = [...world.residents].sort((a, b) => a.id.localeCompare(b.id));

  // G3.4 stored this flag on queued orders to require a manual drag assignment.
  // Builder roles now opt into automatic dispatch; normalize old saves without
  // changing queue position, reservations, or any in-flight work.
  for (const order of orders) {
    if (!order.requiresExplicitBuilder && order.blockedReason !== 'EXPLICIT_BUILDER_REQUIRED') continue;
    order.requiresExplicitBuilder = false;
    if (order.blockedReason === 'EXPLICIT_BUILDER_REQUIRED') order.blockedReason = 'NO_BUILDER';
    changed = true;
  }

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
        const owner = assignedResident ?? builders.find((resident) => resident.id === order.assignedResidentId);
        if (missingMaterials) {
          const task = owner?.task;
          if ((task?.kind === 'build-cabin' || task?.kind === 'build-workshop') && building.progressTicks === 0) {
            task.phase = 'waiting_materials';
            task.blockedReason = buildingSiteMaterialWaitReason(building) ?? missingMaterials;
            task.path = [];
            task.pathIndex = 0;
            task.progressTicks = 0;
            task.requiredTicks = 1;
            residentStatus(owner!);
          }
          changed = setBuildOrderStatus(world, order, 'waiting_materials', missingMaterials) || changed;
        } else if (order.status === 'waiting_materials') {
          changed = setBuildOrderStatus(world, order, 'in_progress', null) || changed;
        } else if (order.blockedReason !== null) {
          order.blockedReason = null;
          changed = true;
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
  if (distributedStorageMode(world)) {
    changed = scheduleHaulerRoles(world) || changed;
    changed = scheduleBuildOrders(world) || changed;
  }
  changed = syncLogisticsQueue(world) || changed;
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
