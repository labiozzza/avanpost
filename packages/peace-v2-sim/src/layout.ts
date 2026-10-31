import type {
  GlobalCoordinate,
  PeaceBuilding,
  PeaceBuildingKind,
  PeaceStorage,
  PeaceSurfaceCell,
  PeaceWorldSnapshot
} from '@avanpost/peace-v2-shared';

export const MIN_WORLD_X = -24;
export const MAX_WORLD_X = 24;
export const SURFACE_ROW = 0;
export const BUILDING_LAYOUT_VERSION = 1;

export interface PeaceBuildingLayout {
  footprint: { width: number; height: number };
  supportMask: GlobalCoordinate[];
  walkThroughMask: GlobalCoordinate[];
  entrances: GlobalCoordinate[];
  workPoints: GlobalCoordinate[];
}

const standardFootprint = { width: 2, height: 1 };
const standardGroundMask = [{ x: 0, y: 1 }, { x: 1, y: 1 }];

export const PEACE_BUILDING_LAYOUTS: Readonly<Record<PeaceBuildingKind, PeaceBuildingLayout>> = {
  cabin: {
    footprint: standardFootprint,
    supportMask: standardGroundMask,
    walkThroughMask: standardGroundMask,
    entrances: [{ x: -1, y: 1 }, { x: 2, y: 1 }],
    workPoints: [{ x: -1, y: 1 }, { x: 2, y: 1 }]
  },
  workshop: {
    footprint: standardFootprint,
    supportMask: standardGroundMask,
    walkThroughMask: standardGroundMask,
    entrances: [{ x: -1, y: 1 }, { x: 2, y: 1 }],
    workPoints: [{ x: -1, y: 1 }, { x: 2, y: 1 }]
  }
};

export type BuildingLayoutFailure = 'OUT_OF_WORLD' | 'OCCUPIED' | 'NO_SUPPORT' | 'NO_ENTRANCE' | 'NO_PATH' | 'ROUTE_BLOCKED';
export type BuildingLayoutReason = 'READY' | BuildingLayoutFailure;

export interface LayoutValidationResult {
  valid: boolean;
  reason: BuildingLayoutReason;
  reasons: BuildingLayoutFailure[];
  anchor: GlobalCoordinate;
  footprint: { width: number; height: number };
  footprintCells: GlobalCoordinate[];
  occupiedCells: GlobalCoordinate[];
  supportCells: GlobalCoordinate[];
  unsupportedCells: GlobalCoordinate[];
  walkBlockedCells: GlobalCoordinate[];
  overlapCells: GlobalCoordinate[];
  entrance?: GlobalCoordinate;
  workPoint?: GlobalCoordinate;
  route?: GlobalCoordinate[];
  blockedRoute?: { from: GlobalCoordinate; to: GlobalCoordinate };
}

export interface BuildingAccessibility {
  status: 'accessible' | 'blocked';
  reason: 'NO_ENTRANCE' | 'NO_PATH' | null;
  entrance?: GlobalCoordinate;
  workPoint?: GlobalCoordinate;
}

export function coordinateKey(point: GlobalCoordinate): string {
  return `${point.x},${point.y}`;
}

export function translateCell(anchor: GlobalCoordinate, offset: GlobalCoordinate): GlobalCoordinate {
  return { x: anchor.x + offset.x, y: anchor.y + offset.y };
}

export function footprintCells(anchor: GlobalCoordinate, footprint: { width: number; height: number }): GlobalCoordinate[] {
  const cells: GlobalCoordinate[] = [];
  for (let y = 0; y < footprint.height; y += 1) {
    for (let x = 0; x < footprint.width; x += 1) cells.push({ x: anchor.x + x, y: anchor.y + y });
  }
  return cells;
}

export function layoutForBuilding(kind: PeaceBuildingKind): PeaceBuildingLayout {
  return PEACE_BUILDING_LAYOUTS[kind];
}

export function buildingEntrancePoints(building: PeaceBuilding): GlobalCoordinate[] {
  const points = [
    ...(building.entrance ? [building.entrance] : []),
    ...layoutForBuilding(building.kind).entrances.map((offset) => translateCell(building.anchor, offset))
  ];
  return [...new Map(points.map((point) => [coordinateKey(point), point])).values()];
}

export function buildingWorkPoints(building: PeaceBuilding): GlobalCoordinate[] {
  const points = [
    ...(building.workPoint ? [building.workPoint] : []),
    ...layoutForBuilding(building.kind).workPoints.map((offset) => translateCell(building.anchor, offset))
  ];
  return [...new Map(points.map((point) => [coordinateKey(point), point])).values()];
}

export function storageEntrance(storage: PeaceStorage): GlobalCoordinate {
  return storage.entrance ?? {
    x: storage.anchor.x + storage.footprint.width,
    y: storage.anchor.y + storage.footprint.height
  };
}

export function storageEntrancePoints(storage: PeaceStorage): GlobalCoordinate[] {
  if (storage.entrances?.length) return storage.entrances;
  if (storage.entrance) return [storage.entrance];
  return [storageEntrance(storage)];
}

export function storageWorkPoints(storage: PeaceStorage): GlobalCoordinate[] {
  if (storage.workPoints?.length) return storage.workPoints;
  if (storage.workPoint) return [storage.workPoint];
  return storageEntrancePoints(storage);
}

export function storageWorkPoint(storage: PeaceStorage): GlobalCoordinate {
  return storage.workPoint ?? storageEntrance(storage);
}

export function occupiedFootprintCells(world: PeaceWorldSnapshot): Array<GlobalCoordinate & { entityId: string; entityKind: 'building' | 'warehouse' }> {
  const occupied: Array<GlobalCoordinate & { entityId: string; entityKind: 'building' | 'warehouse' }> = [];
  for (const building of world.buildings) {
    if (building.state === 'cancelled' || building.state === 'demolished') continue;
    occupied.push(...footprintCells(building.anchor, building.footprint).map((cell) => ({
      ...cell, entityId: building.id, entityKind: 'building' as const
    })));
  }
  for (const storage of world.storages ?? []) {
    occupied.push(...footprintCells(storage.anchor, storage.footprint).map((cell) => ({
      ...cell, entityId: storage.id, entityKind: 'warehouse' as const
    })));
  }
  if (!world.storages) {
    occupied.push(...footprintCells(world.storage.anchor, world.storage.footprint).map((cell) => ({
      ...cell, entityId: world.storage.id, entityKind: 'warehouse' as const
    })));
  }
  return occupied;
}

export function occupiedCellsForWorld(world: PeaceWorldSnapshot): Array<GlobalCoordinate & { entityId: string; entityKind: 'building' | 'warehouse' }> {
  return occupiedFootprintCells(world);
}

function surfaceCells(world: PeaceWorldSnapshot): Map<string, PeaceSurfaceCell> {
  if (world.surfaceCells.length > 0) {
    return new Map(world.surfaceCells.map((cell) => [coordinateKey(cell.position), cell]));
  }
  const flat = new Map<string, PeaceSurfaceCell>();
  for (let x = MIN_WORLD_X; x <= MAX_WORLD_X; x += 1) {
    const cell: PeaceSurfaceCell = { position: { x, y: SURFACE_ROW }, supportsBuilding: true, walkable: true };
    flat.set(coordinateKey(cell.position), cell);
  }
  return flat;
}

function walkBlockedCells(world: PeaceWorldSnapshot, ignoreEntityId?: string): Set<string> {
  const blocked = new Set<string>();
  for (const building of world.buildings) {
    if (building.state === 'cancelled' || building.state === 'demolished' || building.id === ignoreEntityId) continue;
    for (const offset of layoutForBuilding(building.kind).walkThroughMask) {
      blocked.add(coordinateKey(translateCell(building.anchor, offset)));
    }
  }
  for (const storage of world.storages ?? []) {
    if (storage.id === ignoreEntityId) continue;
    const groundY = storage.anchor.y + storage.footprint.height;
    for (let x = storage.anchor.x; x < storage.anchor.x + storage.footprint.width; x += 1) {
      blocked.add(coordinateKey({ x, y: groundY }));
    }
  }
  if (!world.storages && world.storage.id !== ignoreEntityId) {
    const groundY = world.storage.anchor.y + world.storage.footprint.height;
    for (let x = world.storage.anchor.x; x < world.storage.anchor.x + world.storage.footprint.width; x += 1) {
      blocked.add(coordinateKey({ x, y: groundY }));
    }
  }
  return blocked;
}

export function findSurfacePath(
  world: PeaceWorldSnapshot,
  from: GlobalCoordinate,
  to: GlobalCoordinate,
  options: { ignoreEntityId?: string; extraBlocked?: readonly GlobalCoordinate[] } = {}
): GlobalCoordinate[] | null {
  if (world.surfaceCells.length === 0) {
    if (from.y !== SURFACE_ROW || to.y !== SURFACE_ROW || from.x < MIN_WORLD_X || from.x > MAX_WORLD_X ||
        to.x < MIN_WORLD_X || to.x > MAX_WORLD_X) return null;
    if (coordinateKey(from) === coordinateKey(to)) return [];
    const direction = Math.sign(to.x - from.x);
    const legacyPath: GlobalCoordinate[] = [];
    for (let x = from.x + direction; direction > 0 ? x <= to.x : x >= to.x; x += direction) {
      legacyPath.push({ x, y: SURFACE_ROW });
    }
    return legacyPath;
  }
  const cells = surfaceCells(world);
  const blocked = walkBlockedCells(world, options.ignoreEntityId);
  for (const point of options.extraBlocked ?? []) blocked.add(coordinateKey(point));
  const fromKey = coordinateKey(from);
  const toKey = coordinateKey(to);
  const fromCell = cells.get(fromKey);
  const toCell = cells.get(toKey);
  if (!fromCell?.walkable || !toCell?.walkable || blocked.has(fromKey) || blocked.has(toKey)) return null;
  if (fromKey === toKey) return [];

  const queue: GlobalCoordinate[] = [from];
  const visited = new Set([fromKey]);
  const previous = new Map<string, string>();
  const byKey = new Map<string, GlobalCoordinate>([[fromKey, from]]);
  const directions: GlobalCoordinate[] = [
    { x: -1, y: 0 }, { x: 1, y: 0 }, { x: 0, y: -1 }, { x: 0, y: 1 }
  ];
  for (let index = 0; index < queue.length; index += 1) {
    const point = queue[index];
    if (!point) continue;
    const neighbors = directions.map((direction) => ({ x: point.x + direction.x, y: point.y + direction.y }))
      .filter((candidate) => cells.get(coordinateKey(candidate))?.walkable && !blocked.has(coordinateKey(candidate)))
      .sort((a, b) => Math.abs(a.x - to.x) + Math.abs(a.y - to.y) - Math.abs(b.x - to.x) - Math.abs(b.y - to.y) ||
        a.y - b.y || a.x - b.x);
    for (const neighbor of neighbors) {
      const key = coordinateKey(neighbor);
      if (visited.has(key)) continue;
      visited.add(key);
      previous.set(key, coordinateKey(point));
      byKey.set(key, neighbor);
      if (key === toKey) {
        const path: GlobalCoordinate[] = [];
        let cursor = toKey;
        while (cursor !== fromKey) {
          const step = byKey.get(cursor);
          const parent = previous.get(cursor);
          if (!step || !parent) return null;
          path.push(step);
          cursor = parent;
        }
        return path.reverse();
      }
      queue.push(neighbor);
    }
  }
  return null;
}

export function validateBuildingLayout(
  world: PeaceWorldSnapshot,
  kind: PeaceBuildingKind,
  anchor: GlobalCoordinate,
  options: { ignoreBuildingId?: string; residentId?: string } = {}
): LayoutValidationResult {
  const layout = layoutForBuilding(kind);
  const cells = footprintCells(anchor, layout.footprint);
  const walkCells = layout.walkThroughMask.map((offset) => translateCell(anchor, offset));
  const occupied = occupiedFootprintCells(world).filter((cell) => cell.entityId !== options.ignoreBuildingId);
  const occupiedKeys = new Set(occupied.map(coordinateKey));
  const overlapCells = cells.filter((cell) => occupiedKeys.has(coordinateKey(cell)));
  const reasons: BuildingLayoutFailure[] = [];
  if (cells.some((cell) => !Number.isSafeInteger(cell.x) || cell.x < MIN_WORLD_X || cell.x > MAX_WORLD_X)) {
    reasons.push('OUT_OF_WORLD');
  }
  const resourceOverlapCells = walkCells.filter((cell) =>
    world.trees.some((tree) => tree.state !== 'uprooted' && coordinateKey(tree.position) === coordinateKey(cell)) ||
    world.stoneDeposits.some((deposit) => coordinateKey(deposit.position) === coordinateKey(cell)));
  if (overlapCells.length > 0 || resourceOverlapCells.length > 0) reasons.push('OCCUPIED');

  const cellsByPosition = surfaceCells(world);
  const supportCells = layout.supportMask.map((offset) => translateCell(anchor, offset));
  const unsupportedCells = supportCells.filter((cell) => !cellsByPosition.get(coordinateKey(cell))?.supportsBuilding);
  if (unsupportedCells.length > 0) reasons.push('NO_SUPPORT');

  const extraBlocked = walkCells;
  const entrances = layout.entrances.map((offset) => translateCell(anchor, offset));
  const workPoints = layout.workPoints.map((offset) => translateCell(anchor, offset));
  const builder = options.residentId ? world.residents.find((resident) => resident.id === options.residentId)
    : world.residents.find((resident) => resident.workRole === 'builder') ?? world.residents[0];
  const routeCandidates = entrances.flatMap((entrance) => workPoints.map((workPoint) => {
    const entranceRoute = builder ? findSurfacePath(world, builder.position, entrance, {
      ignoreEntityId: options.ignoreBuildingId, extraBlocked
    }) : null;
    const path = builder ? findSurfacePath(world, builder.position, workPoint, {
      ignoreEntityId: options.ignoreBuildingId, extraBlocked
    }) : null;
    return { entrance, workPoint, entranceRoute, path };
  })).filter((candidate) => candidate.entranceRoute !== null && candidate.path !== null);
  const selectedRoute = routeCandidates.sort((a, b) => a.path!.length + a.entranceRoute!.length -
    b.path!.length - b.entranceRoute!.length ||
    a.entrance.y - b.entrance.y || a.entrance.x - b.entrance.x ||
    a.workPoint.y - b.workPoint.y || a.workPoint.x - b.workPoint.x)[0];
  if (!selectedRoute) {
    if (!entrances.some((point) => cellsByPosition.get(coordinateKey(point))?.walkable)) reasons.push('NO_ENTRANCE');
    else reasons.push('NO_PATH');
  }

  const routeBrokenGroup = criticalWorkPointGroups(world).find((targets) => {
    const reachableBefore = world.residents.some((resident) => targets.some((target) =>
      findSurfacePath(world, resident.position, target) !== null));
    if (!reachableBefore) return false;
    return !world.residents.some((resident) => targets.some((target) =>
      findSurfacePath(world, resident.position, target, { extraBlocked }) !== null));
  });
  const blockedRoute = routeBrokenGroup && world.residents.flatMap((resident) => routeBrokenGroup.flatMap((target) => {
    const wasReachable = findSurfacePath(world, resident.position, target) !== null;
    const nowReachable = findSurfacePath(world, resident.position, target, { extraBlocked }) !== null;
    return wasReachable && !nowReachable ? [{ from: resident.position, to: target }] : [];
  }))[0];
  const blockedTaskRoute = world.residents.flatMap((resident) => {
    const targets = taskRouteTargets(world, resident);
    const reachableBefore = targets.some((target) => findSurfacePath(world, resident.position, target) !== null);
    if (!reachableBefore || targets.some((target) => findSurfacePath(world, resident.position, target, { extraBlocked }) !== null)) return [];
    const target = targets.find((candidate) => findSurfacePath(world, resident.position, candidate) !== null);
    return target ? [{ from: resident.position, to: target }] : [];
  })[0];
  const routeBlock = blockedRoute ?? blockedTaskRoute;
  if (routeBlock) reasons.push('ROUTE_BLOCKED');
  const reason: BuildingLayoutReason = reasons[0] ?? 'READY';
  return {
    valid: reasons.length === 0,
    reason,
    reasons,
    anchor,
    footprint: layout.footprint,
    footprintCells: cells,
    occupiedCells: cells,
    supportCells,
    unsupportedCells,
    walkBlockedCells: extraBlocked,
    overlapCells,
    ...(selectedRoute ? { entrance: selectedRoute.entrance, workPoint: selectedRoute.workPoint, route: selectedRoute.path! } : {}),
    ...(routeBlock ? { blockedRoute: routeBlock } : {})
  };
}

export function buildingAccessibility(world: PeaceWorldSnapshot, building: PeaceBuilding): BuildingAccessibility {
  const entrances = buildingEntrancePoints(building);
  const workPoints = buildingWorkPoints(building);
  const cells = surfaceCells(world);
  const entrancesOnSurface = entrances.filter((point) => cells.get(coordinateKey(point))?.walkable);
  if (entrancesOnSurface.length === 0) return { status: 'blocked', reason: 'NO_ENTRANCE' };
  const access = world.residents.flatMap((resident) => workPoints.flatMap((workPoint) => {
    const route = findSurfacePath(world, resident.position, workPoint);
    if (!route) return [];
    const entrance = entrancesOnSurface.find((point) => coordinateKey(point) === coordinateKey(workPoint)) ?? entrancesOnSurface[0]!;
    return [{ entrance, workPoint, route }];
  })).sort((a, b) => a.route.length - b.route.length || a.workPoint.y - b.workPoint.y || a.workPoint.x - b.workPoint.x)[0];
  return access ? { status: 'accessible', reason: null, entrance: access.entrance, workPoint: access.workPoint }
    : { status: 'blocked', reason: 'NO_PATH' };
}

export function criticalWorkPointGroups(world: PeaceWorldSnapshot): GlobalCoordinate[][] {
  const groups = [
    ...(world.storages ?? []).map((storage) => storageEntrancePoints(storage)),
    ...(world.trees.filter((tree) => tree.state !== 'uprooted').map((tree) => [tree.position])),
    ...world.stoneDeposits.map((deposit) => [deposit.position]),
    ...world.buildings.filter((building) => building.state !== 'cancelled' && building.state !== 'demolished')
      .map((building) => [...buildingEntrancePoints(building), ...buildingWorkPoints(building)])
  ];
  if (!world.storages) {
    groups.push([{ x: world.storage.anchor.x + world.storage.footprint.width,
      y: world.storage.anchor.y + world.storage.footprint.height }]);
  }
  return groups.map((group) => [...new Map(group.map((point) => [coordinateKey(point), point])).values()])
    .filter((group) => group.length > 0);
}

function sourceWorkPoint(world: PeaceWorldSnapshot, sourceKind: string, sourceId: string): GlobalCoordinate | undefined {
  if (sourceKind === 'tree-buffer') {
    const tree = world.trees.find((candidate) => candidate.id === sourceId);
    return tree ? { x: tree.position.x - 1, y: SURFACE_ROW } : undefined;
  }
  if (sourceKind === 'stone-buffer') return world.stoneDeposits.find((candidate) => candidate.id === sourceId)?.position;
  if (sourceKind === 'building-site') {
    const building = world.buildings.find((candidate) => candidate.id === sourceId);
    return building ? buildingWorkPoints(building)[0] : undefined;
  }
  const storage = world.storages?.find((candidate) => candidate.id === sourceId) ??
    (!world.storages && world.storage.id === sourceId ? {
      id: world.storage.id, name: 'Склад', kind: 'warehouse' as const, anchor: world.storage.anchor,
      footprint: world.storage.footprint, capacity: world.storage.capacity, contents: world.resources,
      reservedInbound: { wood: 0, stone: 0 }, reservedOutbound: { wood: 0, stone: 0 }, status: 'available' as const, blockedReason: null
    } : undefined);
  return storage ? storageWorkPoints(storage)[0] : undefined;
}

function taskRouteTargets(world: PeaceWorldSnapshot, resident: PeaceWorldSnapshot['residents'][number]): GlobalCoordinate[] {
  const task = resident.task;
  if (!task || ['blocked', 'waiting_path', 'waiting_resource', 'waiting_materials', 'waiting_storage'].includes(task.phase)) return [];
  if (task.kind === 'build-cabin' || task.kind === 'build-workshop') {
    const building = world.buildings.find((candidate) => candidate.id === task.buildingId);
    return building ? buildingWorkPoints(building) : [];
  }
  if (task.kind === 'haul') {
    if (task.phase === 'walking_to_source') {
      const source = sourceWorkPoint(world, task.sourceKind, task.sourceId);
      return source ? [source] : [];
    }
    if (task.destinationKind === 'storage') {
      const storage = world.storages?.find((candidate) => candidate.id === task.destinationId);
      if (storage) return storageWorkPoints(storage);
      return !world.storages && world.storage.id === task.destinationId
        ? storageWorkPoints({ id: world.storage.id, name: 'Склад', kind: 'warehouse', anchor: world.storage.anchor,
          footprint: world.storage.footprint, capacity: world.storage.capacity, contents: world.resources,
          reservedInbound: { wood: 0, stone: 0 }, reservedOutbound: { wood: 0, stone: 0 }, status: 'available', blockedReason: null })
        : [];
    }
    const destination = world.buildings.find((candidate) => candidate.id === task.destinationId);
    return destination ? buildingWorkPoints(destination) : [];
  }
  if (task.kind === 'gather-wood') {
    if (['walking_to_source', 'gathering', 'loading'].includes(task.phase) && task.sourceId) {
      const tree = world.trees.find((candidate) => candidate.id === task.sourceId);
      return tree ? [{ x: tree.position.x - 1, y: SURFACE_ROW }] : [];
    }
    const storage = world.storages?.find((candidate) => candidate.id === task.destinationId);
    if (storage) return storageWorkPoints(storage);
    return !world.storages && world.storage.id === task.destinationId
      ? [{ x: world.storage.anchor.x + world.storage.footprint.width, y: world.storage.anchor.y + world.storage.footprint.height }]
      : [];
  }
  if (task.kind === 'gather-stone') {
    if (task.buildingId) {
      const building = world.buildings.find((candidate) => candidate.id === task.buildingId);
      if (building) return buildingWorkPoints(building);
    }
    if (['walking_to_source', 'mining', 'loading'].includes(task.phase) && task.sourceId) {
      const deposit = world.stoneDeposits.find((candidate) => candidate.id === task.sourceId);
      return deposit ? [deposit.position] : [];
    }
    const storage = world.storages?.find((candidate) => candidate.id === task.destinationId);
    return storage ? storageWorkPoints(storage) : [];
  }
  return [];
}
