import territoryJson from '../../../content/peace-v2/g6.1-territory.json';
import {
  parsePeaceTerritoryCatalog,
  MAX_EXPANSION_CELLS,
  type PeaceBiome,
  type PeaceClearingJob,
  type GlobalCoordinate,
  type PeaceSectorObstacle,
  type PeaceSector,
  type PeaceStoneDeposit,
  type PeaceTreeNode,
  type PeaceWorldSnapshot
} from '@avanpost/peace-v2-shared';
import {
  coordinateKey,
  expansionBatchConnectsToHome,
  findSurfacePath,
  footprintCells
} from './layout.js';

export const G6_TERRITORY_CATALOG = parsePeaceTerritoryCatalog(territoryJson);

export function sectorBoundsFor(sectorX: number, sectorY: number, catalog = G6_TERRITORY_CATALOG) {
  const minX = catalog.sectorGrid.originX + sectorX * catalog.sectorGrid.widthCells;
  const minY = catalog.sectorGrid.originY + sectorY * catalog.sectorGrid.heightCells;
  return {
    minX,
    maxX: minX + catalog.sectorGrid.widthCells - 1,
    minY,
    maxY: minY + catalog.sectorGrid.heightCells - 1
  };
}

export function sectorCoordinatesFor(position: GlobalCoordinate, catalog = G6_TERRITORY_CATALOG): { sectorX: number; sectorY: number } {
  return {
    sectorX: Math.floor((position.x - catalog.sectorGrid.originX) / catalog.sectorGrid.widthCells),
    sectorY: Math.floor((position.y - catalog.sectorGrid.originY) / catalog.sectorGrid.heightCells)
  };
}

export function sectorIdFor(sectorX: number, sectorY: number): string {
  return `sector-${sectorX}-${sectorY}`;
}

export function deterministicSectorSeed(worldSeed: string, sectorX: number, sectorY: number, generatorVersion: number): string {
  const source = `${worldSeed}|${generatorVersion}|${sectorX}|${sectorY}`;
  let hash = 0x811c9dc5;
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

function makeSector(
  world: PeaceWorldSnapshot,
  sectorX: number,
  sectorY: number,
  state: PeaceSector['state'],
  ownerId: string | null,
  catalog = G6_TERRITORY_CATALOG,
  override?: typeof catalog.scenarioOverrides[string]
): PeaceSector {
  const bounds = sectorBoundsFor(sectorX, sectorY, catalog);
  const seed = deterministicSectorSeed(world.worldSeed, sectorX, sectorY, catalog.generatorVersion);
  return {
    id: sectorIdFor(sectorX, sectorY),
    sectorX,
    sectorY,
    bounds,
    seed,
    generatorVersion: catalog.generatorVersion,
    biome: override?.biome ?? (state === 'unknown' || state === 'unlockable' ? null : catalog.biomes[0]!),
    state,
    ownerId,
    explored: state === 'occupied',
    unlockCost: override?.unlockCost ?? catalog.unlockCost,
    clearWorkTicks: override?.clearWorkTicks ?? catalog.clearWorkTicks,
    clearYield: override
      ? { wood: override.obstacleYield.treeWood, stone: override.obstacleYield.stone }
      : { wood: catalog.obstacleYield.treeWood, stone: catalog.obstacleYield.stone },
    obstacles: ownerId ? [] : sectorObstaclePlan(
      sectorX, sectorY, bounds, seed, override?.obstaclePattern ?? catalog.obstaclePattern
    ),
    testOverride: Boolean(override),
    preparationTargets: []
  };
}

function sectorObstaclePlan(
  sectorX: number,
  sectorY: number,
  bounds: PeaceSector['bounds'],
  seed: string,
  pattern: PeaceSectorObstacle['kind'][]
): PeaceSectorObstacle[] {
  const startX = bounds.minX + 2 + hashSectorCell(seed, sectorX, sectorY) % 2;
  return pattern.map((kind, index) => {
    const x = startX + index * 2;
    return { id: `${kind}-${sectorX}-${sectorY}-${x}`, kind, position: { x, y: 0 } };
  }).filter((obstacle) => obstacle.position.x <= bounds.maxX);
}

/** Hydrates pre-sector snapshots without moving a single saved coordinate or entity. */
export function ensureTerritoryWorld(
  world: PeaceWorldSnapshot,
  options: { catalog?: typeof G6_TERRITORY_CATALOG; scenarioId?: string } = {}
): PeaceWorldSnapshot {
  const catalog = options.catalog ?? G6_TERRITORY_CATALOG;
  world.worldSeed ||= 'peace-home';
  world.territoryGeneratorVersion ||= catalog.generatorVersion;
  world.clearingJobs ??= [];
  world.nextClearingSequence ??= 1;
  // Existing saves encoded uncleared trees/stone as non-walkable surface cells.
  // These obstacles remain relevant to preparation/placement, but never block
  // resident movement. Do not mark the cell prepared or building-supported.
  const obstacleIds = new Set([
    ...world.trees.map((tree) => tree.id),
    ...world.stoneDeposits.map((deposit) => deposit.id)
  ]);
  for (const cell of world.surfaceCells) {
    if (cell.obstacleId && obstacleIds.has(cell.obstacleId)) cell.walkable = true;
  }
  if (world.sectors.length === 0) {
    const override = options.scenarioId ? catalog.scenarioOverrides[options.scenarioId] : undefined;
    const ownerId = world.worldSeed;
    const home = makeSector(world, 0, 0, 'occupied', ownerId, catalog);
    home.biome = catalog.biomes[0]!;
    home.explored = true;
    const neighbors = [-1, 1].map((sectorX) => makeSector(world, sectorX, 0, 'unlockable', null, catalog, override));
    const unknown = [-2, 2].map((sectorX) => makeSector(world, sectorX, 0, 'unknown', null, catalog));
    world.sectors = [home, ...neighbors, ...unknown];
  }
  for (const sector of world.sectors) {
    if (sector.obstacles.length === 0 && sector.ownerId === null) {
      sector.obstacles = sectorObstaclePlan(sector.sectorX, sector.sectorY, sector.bounds, sector.seed, catalog.obstaclePattern);
    }
  }

  const home = world.sectors.find((sector) => sector.ownerId !== null) ?? world.sectors.find((sector) => sector.sectorX === 0 && sector.sectorY === 0);
  if (home) {
    for (const cell of world.surfaceCells) {
      if (!cell.sectorId) {
        const coordinates = sectorCoordinatesFor(cell.position, catalog);
        cell.sectorId = sectorIdFor(coordinates.sectorX, coordinates.sectorY);
      }
      if (cell.sectorId === home.id) {
        cell.prepared ??= true;
        cell.terrainType ??= home.biome ?? catalog.biomes[0]!;
      }
    }
    const assignSector = <T extends { position?: GlobalCoordinate; anchor?: GlobalCoordinate; sectorId?: string }>(entity: T) => {
      if (entity.sectorId) return;
      const point = entity.position ?? entity.anchor;
      if (!point) return;
      const coordinates = sectorCoordinatesFor(point, catalog);
      entity.sectorId = sectorIdFor(coordinates.sectorX, coordinates.sectorY);
    };
    world.trees.forEach(assignSector);
    world.stoneDeposits.forEach(assignSector);
    world.buildings.forEach(assignSector);
    world.storages?.forEach(assignSector);
  }
  refreshTerritoryStates(world);
  return world;
}

export function refreshTerritoryStates(world: PeaceWorldSnapshot): void {
  const cells = new Map(world.surfaceCells.map((cell) => [`${cell.position.x},${cell.position.y}`, cell]));
  for (const sector of world.sectors) {
    if (!sector.ownerId) {
      sector.state = isSectorAdjacentToOwner(world, sector) ? 'unlockable' : 'unknown';
      continue;
    }
    const buildings = world.buildings.filter((building) => building.sectorId === sector.id &&
      !['cancelled', 'demolished'].includes(building.state));
    const hasStorage = (world.storages ?? []).some((storage) => {
      const coordinates = sectorCoordinatesFor(storage.anchor);
      return (storage.sectorId ?? sectorIdFor(coordinates.sectorX, coordinates.sectorY)) === sector.id;
    });
    const legacyStorageCoordinates = sectorCoordinatesFor(world.storage.anchor);
    const hasLegacyStorage = !world.storages &&
      sectorIdFor(legacyStorageCoordinates.sectorX, legacyStorageCoordinates.sectorY) === sector.id;
    if (buildings.length > 0 || hasStorage || hasLegacyStorage) {
      sector.state = 'occupied';
      continue;
    }
    if (sector.preparationTargets.length > 0 && sector.preparationTargets.every((target) =>
      cells.get(`${target.x},${target.y}`)?.prepared === true)) {
      sector.state = 'prepared';
      continue;
    }
    if (world.clearingJobs.some((job) => job.sectorId === sector.id &&
        ['in_progress', 'waiting_worker', 'waiting_path'].includes(job.status))) {
      sector.state = 'clearing';
    } else if (sector.state === 'occupied' || sector.state === 'prepared' || sector.state === 'clearing') {
      sector.state = 'unlocked';
    }
  }
}

export function isSectorAdjacentToOwner(world: PeaceWorldSnapshot, sector: PeaceSector): boolean {
  return world.sectors.some((owned) => owned.ownerId !== null &&
    Math.abs(owned.sectorX - sector.sectorX) + Math.abs(owned.sectorY - sector.sectorY) === 1);
}

export type SectorMutationFailure =
  | 'SECTOR_NOT_FOUND'
  | 'SECTOR_NOT_UNLOCKABLE'
  | 'SECTOR_NOT_ADJACENT'
  | 'SECTOR_OVERRIDE_NOT_ALLOWED'
  | 'INSUFFICIENT_RESOURCES'
  | 'CELL_NOT_IN_SECTOR'
  | 'CELL_ALREADY_PREPARED'
  | 'CLEARING_ALREADY_ACTIVE'
  | 'CLEARING_JOB_NOT_FOUND'
  | 'RESIDENT_NOT_FOUND'
  | 'CLEARING_WORKER_BUSY'
  | 'CLEARING_OBSTACLE_MISSING'
  | 'NO_CLEARING_WORKER'
  | 'NO_PATH_TO_CLEARING_SITE'
  | 'EXPANSION_NOT_CONNECTED'
  | 'MAX_EXPANSION_CELLS_EXCEEDED';

export type SectorMutationResult<T> = { ok: true; value: T } | { ok: false; reason: SectorMutationFailure };

function spendSectorUnlockCost(world: PeaceWorldSnapshot, cost: PeaceSector['unlockCost']): boolean {
  if (!world.storages?.length) {
    if (world.resources.wood < cost.wood || world.resources.stone < cost.stone) return false;
    world.resources.wood -= cost.wood;
    world.resources.stone -= cost.stone;
    return true;
  }
  const storages = [...world.storages].sort((a, b) => a.id.localeCompare(b.id));
  const plan = new Map<string, { wood: number; stone: number }>();
  for (const itemId of ['wood', 'stone'] as const) {
    let remaining = cost[itemId];
    for (const storage of storages) {
      const available = Math.max(0, storage.contents[itemId] - storage.reservedOutbound[itemId]);
      const amount = Math.min(available, remaining);
      if (amount > 0) {
        const change = plan.get(storage.id) ?? { wood: 0, stone: 0 };
        change[itemId] = amount;
        plan.set(storage.id, change);
        remaining -= amount;
      }
      if (remaining === 0) break;
    }
    if (remaining > 0) return false;
  }
  for (const storage of storages) {
    const debit = plan.get(storage.id);
    if (!debit) continue;
    storage.contents.wood -= debit.wood;
    storage.contents.stone -= debit.stone;
    storage.status = storage.contents.wood + storage.contents.stone +
      storage.reservedInbound.wood + storage.reservedInbound.stone >= storage.capacity ? 'full' : 'available';
  }
  world.resources = storages.reduce((sum, storage) => ({
    wood: sum.wood + storage.contents.wood,
    stone: sum.stone + storage.contents.stone
  }), { wood: 0, stone: 0 });
  return true;
}

export function unlockSector(world: PeaceWorldSnapshot, sectorId: string, allowTestOverride = false): SectorMutationResult<PeaceSector> {
  const sector = world.sectors.find((candidate) => candidate.id === sectorId);
  if (!sector) return { ok: false, reason: 'SECTOR_NOT_FOUND' };
  if (sector.state !== 'unlockable') return { ok: false, reason: 'SECTOR_NOT_UNLOCKABLE' };
  if (!isSectorAdjacentToOwner(world, sector)) return { ok: false, reason: 'SECTOR_NOT_ADJACENT' };
  if (sector.testOverride && !allowTestOverride) return { ok: false, reason: 'SECTOR_OVERRIDE_NOT_ALLOWED' };
  if (world.surfaceCells.some((cell) => cell.position.y === 0 &&
      cell.position.x >= sector.bounds.minX && cell.position.x <= sector.bounds.maxX)) {
    return { ok: false, reason: 'SECTOR_NOT_UNLOCKABLE' };
  }
  if (!spendSectorUnlockCost(world, sector.unlockCost)) return { ok: false, reason: 'INSUFFICIENT_RESOURCES' };

  const seedHash = hashSectorCell(sector.seed, sector.sectorX, sector.sectorY);
  const biome = sector.biome ?? G6_TERRITORY_CATALOG.biomes[seedHash % G6_TERRITORY_CATALOG.biomes.length]! as PeaceBiome;
  sector.biome = biome;
  sector.state = 'unlocked';
  sector.ownerId = world.worldSeed;
  sector.explored = true;

  const treeYield = sector.clearYield.wood;
  const stoneYield = sector.clearYield.stone;
  const obstacleByCell = new Map(sector.obstacles.map((obstacle) => [coordinateKey(obstacle.position), obstacle]));
  const preparedTargetCells = new Set(sector.obstacles.map((obstacle) => coordinateKey(obstacle.position)));
  for (let x = sector.bounds.minX; x <= sector.bounds.maxX; x += 1) {
    const key = `${x},0`;
    if (world.surfaceCells.some((cell) => coordinateKey(cell.position) === key)) return { ok: false, reason: 'SECTOR_NOT_UNLOCKABLE' };
    const obstacle = obstacleByCell.get(key);
    world.surfaceCells.push({
      // Obstacles are work targets, not movement walls. Residents can cross these
      // cells while the clearing job independently tracks whether they were removed.
      position: { x, y: 0 }, supportsBuilding: !obstacle, walkable: true,
      sectorId: sector.id, prepared: !preparedTargetCells.has(key), terrainType: biome,
      ...(obstacle ? { obstacleId: obstacle.id } : {})
    });
  }
  for (const obstacle of sector.obstacles) {
    if (obstacle.kind === 'tree') {
      world.trees.push({
        id: obstacle.id, sectorId: sector.id, name: 'Дерево в густой роще', position: obstacle.position,
        sourceKind: 'finite', remaining: Math.max(1, treeYield), maxRemaining: Math.max(1, treeYield),
        state: 'standing', regrowthProgressTicks: 0, regrowthEveryTicks: null, bufferQuantity: 0,
        bufferCapacity: Math.max(1, treeYield), reservedBuffer: 0
      } satisfies PeaceTreeNode);
    } else {
      world.stoneDeposits.push({
        id: obstacle.id, sectorId: sector.id, name: 'Каменный завал', sourceKind: 'finite',
        position: obstacle.position, remaining: Math.max(1, stoneYield), maxRemaining: Math.max(1, stoneYield),
        bufferQuantity: 0, bufferCapacity: Math.max(1, stoneYield), reservedBuffer: 0, yieldPerTick: 1, state: 'available'
      } satisfies PeaceStoneDeposit);
    }
  }
  world.surfaceCells.sort((a, b) => a.position.y - b.position.y || a.position.x - b.position.x);
  sector.preparationTargets = sector.obstacles.map((obstacle) => obstacle.position);
  refreshTerritoryStates(world);
  return { ok: true, value: sector };
}

export function startSectorExpansion(world: PeaceWorldSnapshot, sectorId: string, allowTestOverride = false):
  SectorMutationResult<PeaceSector> {
  const result = unlockSector(world, sectorId, allowTestOverride);
  if (!result.ok) return result;
  for (const target of result.value.preparationTargets) {
    const job = createClearingJob(world, result.value.id, target, { assignImmediately: false });
    if (!job.ok) return job;
  }
  return { ok: true, value: result.value };
}

/** Begins one atomic, connected cell-expansion cycle. Sector generation/ownership remains sector-scoped. */
export function startCellExpansion(
  world: PeaceWorldSnapshot, sectorId: string, positions: GlobalCoordinate[], allowTestOverride = false
): SectorMutationResult<PeaceClearingJob[]> {
  const staged = structuredClone(world);
  const result = startCellExpansionInPlace(staged, sectorId, positions, allowTestOverride);
  if (!result.ok) return result;
  Object.assign(world, staged);
  return { ok: true, value: world.clearingJobs.filter((job) => result.value.some((created) => created.id === job.id)) };
}

function startCellExpansionInPlace(
  world: PeaceWorldSnapshot, sectorId: string, positions: GlobalCoordinate[], allowTestOverride: boolean
): SectorMutationResult<PeaceClearingJob[]> {
  if (positions.length < 1 || positions.length > MAX_EXPANSION_CELLS) {
    return { ok: false, reason: 'MAX_EXPANSION_CELLS_EXCEEDED' };
  }
  const keys = positions.map(coordinateKey);
  if (new Set(keys).size !== keys.length) return { ok: false, reason: 'CELL_ALREADY_PREPARED' };
  if (world.clearingJobs.some((job) => ['queued', 'in_progress', 'waiting_worker', 'waiting_path'].includes(job.status))) {
    return { ok: false, reason: 'CLEARING_ALREADY_ACTIVE' };
  }
  const sector = world.sectors.find((candidate) => candidate.id === sectorId);
  if (!sector) return { ok: false, reason: 'SECTOR_NOT_FOUND' };
  const newSector = sector.state === 'unlockable';
  if (newSector) {
    if (!isSectorAdjacentToOwner(world, sector)) return { ok: false, reason: 'SECTOR_NOT_ADJACENT' };
    if (sector.testOverride && !allowTestOverride) return { ok: false, reason: 'SECTOR_OVERRIDE_NOT_ALLOWED' };
    if (positions.some((position) => position.y !== 0 || position.x < sector.bounds.minX || position.x > sector.bounds.maxX)) {
      return { ok: false, reason: 'CELL_NOT_IN_SECTOR' };
    }
    if (world.surfaceCells.some((cell) => cell.position.y === 0 &&
        cell.position.x >= sector.bounds.minX && cell.position.x <= sector.bounds.maxX)) {
      return { ok: false, reason: 'SECTOR_NOT_UNLOCKABLE' };
    }
  } else if (!sector.ownerId || !['unlocked', 'clearing'].includes(sector.state)) {
    return { ok: false, reason: 'SECTOR_NOT_UNLOCKABLE' };
  }
  const cells = positions.map((position) => world.surfaceCells.find((cell) => cell.sectorId === sectorId &&
    coordinateKey(cell.position) === coordinateKey(position)));
  if (!newSector && cells.some((cell) => !cell || cell.prepared !== false)) return { ok: false, reason: 'CELL_ALREADY_PREPARED' };
  const blocked = new Set(world.buildings.filter((building) => !['cancelled', 'demolished'].includes(building.state))
    .flatMap((building) => footprintCells(building.anchor, building.footprint).map(coordinateKey)));
  for (const storage of world.storages ?? []) blocked.add(`${storage.anchor.x},${storage.anchor.y}`);
  blocked.add(`${world.storage.anchor.x},${world.storage.anchor.y}`);
  if (positions.some((position) => blocked.has(coordinateKey(position)))) return { ok: false, reason: 'CELL_ALREADY_PREPARED' };
  if (!expansionBatchConnectsToHome(world, positions)) return { ok: false, reason: 'EXPANSION_NOT_CONNECTED' };
  if (!world.residents.some((resident) => !resident.task && resident.cargo === 0)) {
    return { ok: false, reason: 'NO_CLEARING_WORKER' };
  }
  if (newSector) {
    const unlocked = unlockSector(world, sectorId, allowTestOverride);
    if (!unlocked.ok) return unlocked;
    for (const cell of world.surfaceCells) if (cell.sectorId === sectorId) cell.prepared = false;
  }
  const jobs: PeaceClearingJob[] = [];
  for (const position of positions) {
    const result = createClearingJob(world, sectorId, position, { assignImmediately: false });
    if (!result.ok) return result;
    jobs.push(result.value);
  }
  sector.preparationTargets = world.surfaceCells.filter((cell) => cell.sectorId === sectorId).map((cell) => cell.position);
  scheduleClearingJobs(world);
  return { ok: true, value: jobs };
}

function assignClearingJob(world: PeaceWorldSnapshot, job: PeaceClearingJob, preferredResidentId?: string): boolean {
  if (job.assignedResidentId || ['completed', 'cancelled'].includes(job.status)) return false;
  const cell = world.surfaceCells.find((candidate) => candidate.sectorId === job.sectorId &&
    coordinateKey(candidate.position) === coordinateKey(job.position));
  if (!cell) {
    job.status = 'waiting_path';
    job.blockedReason = 'CLEARING_CELL_MISSING';
    return true;
  }
  // A persisted job can outlive the obstacle it was created for. Close it
  // without touching a replacement obstacle or assigning a worker to empty
  // ground; the cell is already clear and must not produce another resource.
  if (!cell.obstacleId || cell.obstacleId !== job.obstacleId) {
    job.status = 'completed';
    job.assignedResidentId = null;
    job.progressTicks = job.requiredTicks;
    job.blockedReason = null;
    if (!cell.obstacleId) {
      cell.prepared = true;
      cell.supportsBuilding = true;
      cell.walkable = true;
    }
    refreshTerritoryStates(world);
    return true;
  }
  if (job.blockedReason === 'CLEARING_OUTPUT_UNAVAILABLE' && job.obstacleId) {
    const tree = job.obstacleKind === 'tree' ? world.trees.find((candidate) => candidate.id === job.obstacleId) : undefined;
    const deposit = job.obstacleKind === 'stone' ? world.stoneDeposits.find((candidate) => candidate.id === job.obstacleId) : undefined;
    const outputCanBeStored = tree
      ? tree.state === 'stump' && tree.remaining === 0 ||
        tree.remaining >= job.outputQuantity && tree.bufferQuantity + job.outputQuantity <= tree.bufferCapacity
      : deposit
        ? deposit.state === 'depleted' && deposit.remaining === 0 ||
          deposit.remaining >= job.outputQuantity && deposit.bufferQuantity + job.outputQuantity <= deposit.bufferCapacity
        : false;
    if (!outputCanBeStored) return false;
    job.blockedReason = null;
  }
  const workPoints = [
    { x: job.position.x - 1, y: job.position.y }, { x: job.position.x + 1, y: job.position.y },
    { x: job.position.x, y: job.position.y - 1 }, { x: job.position.x, y: job.position.y + 1 }
  ].filter((point) => world.surfaceCells.some((candidate) => coordinateKey(candidate.position) === coordinateKey(point) &&
    candidate.walkable && !candidate.obstacleId));
  if (workPoints.length === 0) {
    job.status = 'waiting_path';
    job.blockedReason = 'NO_CLEARING_WORKPOINT';
    return true;
  }
  const candidates = world.residents.flatMap((resident) => {
    if (preferredResidentId && resident.id !== preferredResidentId) return [];
    if (resident.task || resident.cargo > 0) return [];
    return workPoints.flatMap((workPoint) => {
      const path = findSurfacePath(world, resident.position, workPoint);
      return path ? [{ resident, workPoint, path }] : [];
    });
  }).sort((a, b) => Number(a.resident.workRole === 'hauler') - Number(b.resident.workRole === 'hauler') ||
    a.path.length - b.path.length || a.resident.id.localeCompare(b.resident.id) ||
    a.workPoint.y - b.workPoint.y || a.workPoint.x - b.workPoint.x);
  const worker = candidates[0];
  if (!worker) {
    const hasFreeWorker = world.residents.some((resident) => !resident.task && resident.cargo === 0);
    job.status = hasFreeWorker ? 'waiting_path' : 'waiting_worker';
    job.blockedReason = hasFreeWorker ? 'NO_PATH_TO_CLEARING_SITE' : 'NO_FREE_WORKER';
    return true;
  }
  const sector = world.sectors.find((candidate) => candidate.id === job.sectorId);
  if (!sector) {
    job.status = 'waiting_path';
    job.blockedReason = 'CLEARING_SECTOR_MISSING';
    return true;
  }
  job.workPoint = worker.workPoint;
  job.assignedResidentId = worker.resident.id;
  job.status = 'in_progress';
  job.blockedReason = null;
  worker.resident.task = {
    id: `clear-task-${job.id}`, kind: 'clear-cell', phase: worker.path.length > 0 ? 'walking_to_worksite' : 'clearing',
    jobId: job.id, sectorId: job.sectorId, position: job.position, workPoint: worker.workPoint,
    path: worker.path, pathIndex: 0, progressTicks: job.progressTicks, requiredTicks: job.requiredTicks, blockedReason: null
  };
  worker.resident.state = 'working';
  worker.resident.visualState = worker.path.length > 0 ? 'walking_to_clearing' : 'clearing';
  worker.resident.blockedReason = null;
  sector.state = 'clearing';
  return true;
}

export function assignClearingJobToResident(
  world: PeaceWorldSnapshot,
  jobId: string,
  residentId: string
): SectorMutationResult<PeaceClearingJob> {
  const job = world.clearingJobs.find((candidate) => candidate.id === jobId);
  if (!job) return { ok: false, reason: 'CLEARING_JOB_NOT_FOUND' };
  const resident = world.residents.find((candidate) => candidate.id === residentId);
  if (!resident) return { ok: false, reason: 'RESIDENT_NOT_FOUND' };
  if (job.assignedResidentId || !['queued', 'waiting_worker', 'waiting_path'].includes(job.status)) {
    return { ok: false, reason: 'CLEARING_ALREADY_ACTIVE' };
  }
  if (resident.task || resident.cargo > 0) return { ok: false, reason: 'CLEARING_WORKER_BUSY' };
  assignClearingJob(world, job, residentId);
  if (job.assignedResidentId !== residentId) return { ok: false, reason: 'NO_PATH_TO_CLEARING_SITE' };
  refreshTerritoryStates(world);
  return { ok: true, value: job };
}

export function scheduleClearingJobs(world: PeaceWorldSnapshot): boolean {
  let changed = false;
  const waiting = world.clearingJobs.filter((job) => ['queued', 'waiting_worker', 'waiting_path'].includes(job.status))
    .sort((a, b) => a.createdTick - b.createdTick || a.position.x - b.position.x || a.position.y - b.position.y || a.id.localeCompare(b.id));
  for (const job of waiting) changed = assignClearingJob(world, job) || changed;
  refreshTerritoryStates(world);
  return changed;
}

export function createClearingJob(
  world: PeaceWorldSnapshot,
  sectorId: string,
  position: GlobalCoordinate,
  options: { assignImmediately?: boolean } = {}
): SectorMutationResult<PeaceClearingJob> {
  const sector = world.sectors.find((candidate) => candidate.id === sectorId);
  if (!sector || !sector.ownerId || ['unknown', 'unlockable'].includes(sector.state)) {
    return { ok: false, reason: 'SECTOR_NOT_FOUND' };
  }
  const cell = world.surfaceCells.find((candidate) => candidate.sectorId === sectorId && coordinateKey(candidate.position) === coordinateKey(position));
  if (!cell) return { ok: false, reason: 'CELL_NOT_IN_SECTOR' };
  if (cell.prepared !== false && !cell.obstacleId) return { ok: false, reason: 'CELL_ALREADY_PREPARED' };
  if (world.clearingJobs.some((job) => job.sectorId === sectorId && coordinateKey(job.position) === coordinateKey(position) &&
      ['queued', 'in_progress', 'waiting_worker', 'waiting_path'].includes(job.status))) return { ok: false, reason: 'CLEARING_ALREADY_ACTIVE' };

  let obstacleKind: PeaceClearingJob['obstacleKind'] = 'ground';
  let outputItemId: PeaceClearingJob['outputItemId'] = null;
  let outputQuantity = 0;
  if (cell.obstacleId) {
    const tree = world.trees.find((candidate) => candidate.id === cell.obstacleId);
    const stone = world.stoneDeposits.find((candidate) => candidate.id === cell.obstacleId);
    if (tree && tree.state === 'standing' && tree.remaining > 0) {
      obstacleKind = 'tree';
      outputItemId = 'wood';
      outputQuantity = Math.min(sector.clearYield.wood, tree.remaining);
    } else if (stone && stone.remaining > 0) {
      obstacleKind = 'stone';
      outputItemId = 'stone';
      outputQuantity = Math.min(sector.clearYield.stone, stone.remaining);
    } else {
      return { ok: false, reason: 'CLEARING_OBSTACLE_MISSING' };
    }
    if (outputQuantity < 1) outputItemId = null;
  }

  const jobId = `clear-${world.nextClearingSequence}-${sector.sectorX}-${sector.sectorY}-${position.x}-${position.y}`;
  const job: PeaceClearingJob = {
    id: jobId, sectorId, position, workPoint: position, obstacleId: cell.obstacleId ?? null, obstacleKind,
    outputItemId, outputQuantity, assignedResidentId: null, status: 'queued', progressTicks: 0,
    requiredTicks: sector.clearWorkTicks[obstacleKind], blockedReason: null, createdTick: world.revision.serverTick
  };
  world.clearingJobs.push(job);
  world.nextClearingSequence += 1;
  job.status = 'queued';
  job.assignedResidentId = null;
  job.blockedReason = null;
  if (options.assignImmediately !== false) assignClearingJob(world, job);
  return { ok: true, value: job };
}

export function updateClearingJobCompletion(world: PeaceWorldSnapshot, job: PeaceClearingJob): boolean {
  const sector = world.sectors.find((candidate) => candidate.id === job.sectorId);
  const cell = world.surfaceCells.find((candidate) => candidate.sectorId === job.sectorId && coordinateKey(candidate.position) === coordinateKey(job.position));
  if (!sector || !cell) return false;
  if (job.obstacleId && job.obstacleKind === 'tree') {
    const tree = world.trees.find((candidate) => candidate.id === job.obstacleId);
    if (!tree) return false;
    // A tree may have been harvested after the clearing order was created. Its
    // remaining stump still needs removal, but there is no second wood output.
    if (tree.state === 'stump' && tree.remaining === 0) {
      job.outputItemId = null;
      job.outputQuantity = 0;
    }
    if (tree.remaining < job.outputQuantity || tree.bufferQuantity + job.outputQuantity > tree.bufferCapacity) return false;
    tree.remaining -= job.outputQuantity;
    tree.state = 'uprooted';
    tree.bufferQuantity += job.outputQuantity;
  } else if (job.obstacleId && job.obstacleKind === 'stone') {
    const deposit = world.stoneDeposits.find((candidate) => candidate.id === job.obstacleId);
    if (!deposit) return false;
    if (deposit.state === 'depleted' && deposit.remaining === 0) {
      job.outputItemId = null;
      job.outputQuantity = 0;
    }
    if (deposit.remaining < job.outputQuantity || deposit.bufferQuantity + job.outputQuantity > deposit.bufferCapacity) return false;
    deposit.remaining -= job.outputQuantity;
    if (deposit.remaining === 0) deposit.state = 'depleted';
    deposit.bufferQuantity += job.outputQuantity;
  }
  cell.obstacleId = null;
  cell.prepared = true;
  cell.supportsBuilding = true;
  cell.walkable = true;
  job.status = 'completed';
  const resident = job.assignedResidentId
    ? world.residents.find((candidate) => candidate.id === job.assignedResidentId)
    : undefined;
  job.assignedResidentId = null;
  job.progressTicks = job.requiredTicks;
  job.blockedReason = null;
  if (resident?.task?.kind === 'clear-cell' && resident.task.jobId === job.id) {
    resident.task = null;
    resident.state = 'idle';
    resident.visualState = 'idle';
    resident.blockedReason = null;
  }
  refreshTerritoryStates(world);
  world.revision.geometryVersion += 1;
  return true;
}

export function hashSectorCell(seed: string, x: number, y: number): number {
  return Number.parseInt(deterministicSectorSeed(seed, x, y, 1), 16) >>> 0;
}
