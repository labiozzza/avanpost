import undergroundBalance from '../../../content/peace-v2/g6.2-underground.json';
import type {
  GlobalCoordinate,
  PeaceLadder,
  PeaceWorldSnapshot,
  UndergroundCell,
  UndergroundDeposit,
  UndergroundJob,
  UndergroundPlan,
  UndergroundRouteStep
} from '@avanpost/peace-v2-shared';
import { UNDERGROUND_BALANCE } from '@avanpost/peace-v2-shared';
import { coordinateKey, findSurfacePath, isSupportedUndergroundPosition, storageWorkPoints } from './layout.js';

export const G6_2_UNDERGROUND_BALANCE = undergroundBalance;

function hash(seed: string): number {
  let value = 0x811c9dc5;
  for (let index = 0; index < seed.length; index += 1) {
    value ^= seed.charCodeAt(index);
    value = Math.imul(value, 0x01000193) >>> 0;
  }
  return value >>> 0;
}

export function generatedGeology(worldSeed: string, x: number, y: number, version = UNDERGROUND_BALANCE.generatorVersion): UndergroundCell['geology'] {
  const value = hash(`${worldSeed}|${version}|${x}|${y}`);
  if (y >= UNDERGROUND_BALANCE.sectorDepth - 2 || value % 31 === 0) return 'bedrock';
  if (y <= 2) return value % 5 === 0 ? 'clay' : 'humus';
  if (value % 7 === 0) return 'clay';
  if (value % 3 === 0) return 'stone';
  return 'clay';
}

function sectorForCoordinate(world: PeaceWorldSnapshot, point: GlobalCoordinate) {
  return world.sectors.find((sector) => point.x >= sector.bounds.minX && point.x <= sector.bounds.maxX &&
    point.y >= 1 && point.y <= UNDERGROUND_BALANCE.sectorDepth && sector.sectorY === 0);
}

/** Adds deterministic, saved geological rows once; existing underground edits are never regenerated. */
export function ensureUndergroundWorld(world: PeaceWorldSnapshot): PeaceWorldSnapshot {
  if (world.undergroundCells.length > 0) return world;
  world.undergroundCells = [];
  world.undergroundDeposits ??= [];
  world.undergroundJobs ??= [];
  world.undergroundPlans ??= [];
  world.ladders ??= [];
  world.nextUndergroundSequence ??= 1;
  const version = UNDERGROUND_BALANCE.generatorVersion;
  for (const sector of world.sectors.filter((item) => item.sectorY === 0)) {
    for (let x = sector.bounds.minX; x <= sector.bounds.maxX; x += 1) {
      for (let y = 1; y <= UNDERGROUND_BALANCE.sectorDepth; y += 1) {
        const geology = generatedGeology(world.worldSeed, x, y, version);
        world.undergroundCells.push({ position: { x, y }, sectorId: sector.id, geology,
          revealed: sector.ownerId !== null && x >= -2 && x <= 2 && y === 1,
          state: 'solid', movementCost: 1, floorSupported: true });
      }
    }
  }
  for (const sector of world.sectors.filter((item) => item.ownerId !== null && item.sectorY === 0)) {
    const candidates = world.undergroundCells.filter((cell) => cell.sectorId === sector.id &&
      cell.geology === 'stone' && cell.position.y >= 4 && cell.position.y <= 12);
    if (!candidates.length) continue;
    const chosen = candidates[hash(`${world.worldSeed}|${version}|deposit|${sector.sectorX}`) % candidates.length]!;
    world.undergroundDeposits.push(makeDeposit(sector.id, chosen.position));
  }
  world.nextUndergroundSequence = Math.max(1, world.nextUndergroundSequence);
  return world;
}

function makeDeposit(sectorId: string, position: GlobalCoordinate, initialQuantity = UNDERGROUND_BALANCE.depositQuantity): UndergroundDeposit {
  return { id: `udeposit-${position.x}-${position.y}`, sectorId, position, resource: 'stone',
    initialQuantity, remaining: initialQuantity, bufferQuantity: 0,
    bufferCapacity: UNDERGROUND_BALANCE.depositBufferCapacity, reservedBuffer: 0, revealed: false, state: 'available' };
}

export function undergroundCell(world: PeaceWorldSnapshot, point: GlobalCoordinate): UndergroundCell | undefined {
  return world.undergroundCells.find((cell) => coordinateKey(cell.position) === coordinateKey(point));
}

function isWalkable(world: PeaceWorldSnapshot, point: GlobalCoordinate): boolean {
  if (point.y <= 0) return world.surfaceCells.some((cell) => coordinateKey(cell.position) === coordinateKey(point) && cell.walkable);
  return isSupportedUndergroundPosition(world, point);
}

function ladderConnects(world: PeaceWorldSnapshot, a: GlobalCoordinate, b: GlobalCoordinate): boolean {
  return world.ladders.some((ladder) => ladder.state === 'complete' &&
    (coordinateKey(ladder.top) === coordinateKey(a) && coordinateKey(ladder.bottom) === coordinateKey(b) ||
     coordinateKey(ladder.bottom) === coordinateKey(a) && coordinateKey(ladder.top) === coordinateKey(b)));
}

export function undergroundWorkPoint(world: PeaceWorldSnapshot, target: GlobalCoordinate, from?: GlobalCoordinate): GlobalCoordinate | null {
  const candidates = [
    { x: target.x, y: target.y - 1 }, { x: target.x - 1, y: target.y },
    { x: target.x + 1, y: target.y }, { x: target.x, y: target.y + 1 }
  ];
  return candidates.filter((point) => isWalkable(world, point) && (!from || findSurfacePath(world, from, point) !== null))
    .sort((a, b) => a.y - b.y || a.x - b.x)[0] ?? null;
}

/** A section is movable only if removing its edge preserves every already-reachable tunnel and active worksite. */
export function canSafelyRelocateLadder(world: PeaceWorldSnapshot, ladderId: string, exceptPlanId?: string): boolean {
  const ladder = world.ladders.find((item) => item.id === ladderId && item.state === 'complete');
  if (!ladder || ladder.assignedResidentId || world.undergroundPlans.some((plan) => plan.id !== exceptPlanId &&
      ['planned', 'in_progress', 'blocked'].includes(plan.state) &&
      plan.steps.slice(plan.currentStep).some((step) => 'ladderId' in step && step.ladderId === ladder.id))) return false;
  const edge = new Set([coordinateKey(ladder.top), coordinateKey(ladder.bottom)]);
  if (world.residents.some((resident) => edge.has(coordinateKey(resident.position)) ||
      (resident.task?.path ?? []).some((point, index, path) => index > 0 &&
        edge.has(coordinateKey(point)) && edge.has(coordinateKey(path[index - 1]!))))) return false;

  const withoutLadder: PeaceWorldSnapshot = { ...world, ladders: world.ladders.filter((item) => item.id !== ladder.id) };
  const surfaceResidents = world.residents.filter((resident) => resident.position.y <= 0);
  const reachableTunnels = world.undergroundCells.filter((cell) => cell.state === 'tunnel' && cell.floorSupported &&
    surfaceResidents.some((resident) => findSurfacePath(world, resident.position, cell.position) !== null));
  if (reachableTunnels.some((cell) => !surfaceResidents.some((resident) =>
    findSurfacePath(withoutLadder, resident.position, cell.position) !== null))) return false;

  for (const resident of world.residents.filter((item) => item.position.y > 0)) {
    if (!surfaceResidents.some((surface) => findSurfacePath(withoutLadder, resident.position, surface.position) !== null)) return false;
  }
  const activeJobs = world.undergroundJobs.filter((job) => ['queued', 'in_progress', 'waiting_path'].includes(job.status));
  for (const job of activeJobs) {
    const candidates = [
      { x: job.target.x, y: job.target.y - 1 }, { x: job.target.x - 1, y: job.target.y },
      { x: job.target.x + 1, y: job.target.y }, { x: job.target.x, y: job.target.y + 1 }
    ].filter((point) => isWalkable(withoutLadder, point));
    if (candidates.length && !world.residents.some((resident) => resident.position.y <= 0 &&
        candidates.some((point) => findSurfacePath(withoutLadder, resident.position, point) !== null))) return false;
  }
  return true;
}

function reusableLadder(world: PeaceWorldSnapshot, a: GlobalCoordinate, b: GlobalCoordinate): PeaceLadder | undefined {
  return world.ladders.find((ladder) => ladder.state === 'complete' &&
    (coordinateKey(ladder.top) === coordinateKey(a) && coordinateKey(ladder.bottom) === coordinateKey(b) ||
     coordinateKey(ladder.bottom) === coordinateKey(a) && coordinateKey(ladder.top) === coordinateKey(b)));
}

function workPointFor(world: PeaceWorldSnapshot, residentId: string, target: GlobalCoordinate): { point: GlobalCoordinate; path: GlobalCoordinate[] } | null {
  const resident = world.residents.find((candidate) => candidate.id === residentId);
  if (!resident) return null;
  const candidates = [
    { x: target.x, y: target.y - 1 }, { x: target.x - 1, y: target.y },
    { x: target.x + 1, y: target.y }, { x: target.x, y: target.y + 1 }
  ].flatMap((point) => {
    const path = findSurfacePath(world, resident.position, point);
    return path ? [{ point, path }] : [];
  });
  return candidates.sort((a, b) => a.path.length - b.path.length || a.point.y - b.point.y || a.point.x - b.point.x)[0] ?? null;
}

export type UndergroundFailure = 'INVALID_BATCH' | 'CELL_NOT_FOUND' | 'SECTOR_NOT_OWNED' | 'BEDROCK' |
  'CELL_ALREADY_TUNNEL' | 'CELL_NOT_CONNECTED' | 'DUPLICATE_JOB' | 'NO_WORKER' | 'DEPOSIT_NOT_FOUND' |
  'DEPOSIT_NOT_REVEALED' | 'DEPOSIT_DEPLETED' | 'DEPOSIT_NOT_ACCESSED' | 'INSUFFICIENT_MATERIALS' |
  'NO_PATH_TO_LADDER_SITE' | 'LADDER_IN_USE';
export type UndergroundResult<T> = { ok: true; value: T } | { ok: false; reason: UndergroundFailure };

export function queueExcavation(world: PeaceWorldSnapshot, positions: GlobalCoordinate[], planId: string | null = null): UndergroundResult<UndergroundJob[]> {
  ensureUndergroundWorld(world);
  if (positions.length < 1 || positions.length > UNDERGROUND_BALANCE.excavationMaxCells ||
      new Set(positions.map(coordinateKey)).size !== positions.length) return { ok: false, reason: 'INVALID_BATCH' };
  const jobs: UndergroundJob[] = [];
  const remaining = new Map(positions.map((position) => [coordinateKey(position), position]));
  const connected = new Set<string>();
  for (const position of positions) {
    const adjacent = [
      { x: position.x, y: position.y - 1 }, { x: position.x - 1, y: position.y },
      { x: position.x + 1, y: position.y }, { x: position.x, y: position.y + 1 }
    ];
    if (adjacent.some((point) => isWalkable(world, point) && world.residents.some((resident) =>
        findSurfacePath(world, resident.position, point) !== null))) connected.add(coordinateKey(position));
  }
  let expanded = true;
  while (expanded) {
    expanded = false;
    for (const position of positions) {
      const key = coordinateKey(position);
      if (connected.has(key)) continue;
      const adjacentKeys = [
        `${position.x},${position.y - 1}`, `${position.x - 1},${position.y}`,
        `${position.x + 1},${position.y}`, `${position.x},${position.y + 1}`
      ];
      if (adjacentKeys.some((adjacent) => connected.has(adjacent))) {
        connected.add(key); expanded = true;
      }
    }
  }
  if (connected.size !== remaining.size) return { ok: false, reason: 'CELL_NOT_CONNECTED' };
  for (const position of positions) {
    const cell = undergroundCell(world, position);
    if (!cell) return { ok: false, reason: 'CELL_NOT_FOUND' };
    const sector = sectorForCoordinate(world, position);
    if (!sector?.ownerId) return { ok: false, reason: 'SECTOR_NOT_OWNED' };
    if (cell.geology === 'bedrock') return { ok: false, reason: 'BEDROCK' };
    if (cell.state !== 'solid') return { ok: false, reason: 'CELL_ALREADY_TUNNEL' };
    if (world.undergroundJobs.some((job) => ['queued', 'in_progress', 'waiting_path'].includes(job.status) &&
        coordinateKey(job.target) === coordinateKey(position))) return { ok: false, reason: 'DUPLICATE_JOB' };
    const requiredTicks = cell.geology === 'humus' ? UNDERGROUND_BALANCE.excavationWorkTicks.humus
      : cell.geology === 'clay' ? UNDERGROUND_BALANCE.excavationWorkTicks.clay : UNDERGROUND_BALANCE.excavationWorkTicks.stone;
    const job: UndergroundJob = { id: `underground-job-${world.nextUndergroundSequence++}`, kind: 'excavate', target: position,
      depositId: null, assignedResidentId: null, status: 'queued', progressTicks: 0, requiredTicks,
      outputQuantity: 0, blockedReason: null, createdTick: world.revision.serverTick, planId };
    jobs.push(job);
  }
  world.undergroundJobs.push(...jobs);
  dispatchUndergroundJobs(world);
  world.revision.geometryVersion += 1;
  return { ok: true, value: jobs };
}

export function queueUndergroundMining(world: PeaceWorldSnapshot, depositId: string): UndergroundResult<UndergroundJob> {
  const deposit = world.undergroundDeposits.find((item) => item.id === depositId);
  if (!deposit) return { ok: false, reason: 'DEPOSIT_NOT_FOUND' };
  if (!deposit.revealed) return { ok: false, reason: 'DEPOSIT_NOT_REVEALED' };
  if (deposit.state === 'depleted' || deposit.remaining < 1) return { ok: false, reason: 'DEPOSIT_DEPLETED' };
  if (!world.residents.some((resident) => undergroundWorkPoint(world, deposit.position, resident.position))) {
    return { ok: false, reason: 'DEPOSIT_NOT_ACCESSED' };
  }
  if (world.undergroundJobs.some((job) => job.kind === 'mine' && job.depositId === depositId &&
      ['queued', 'in_progress', 'waiting_path'].includes(job.status))) return { ok: false, reason: 'DUPLICATE_JOB' };
  const job: UndergroundJob = { id: `underground-job-${world.nextUndergroundSequence++}`, kind: 'mine',
    target: deposit.position, depositId, assignedResidentId: null, status: 'queued', progressTicks: 0,
    requiredTicks: UNDERGROUND_BALANCE.mineWorkTicks, outputQuantity: UNDERGROUND_BALANCE.mineYield,
    blockedReason: null, createdTick: world.revision.serverTick, planId: null };
  world.undergroundJobs.push(job);
  dispatchUndergroundJobs(world);
  return { ok: true, value: job };
}

/** Finds a deterministic route from an existing reachable tunnel to a work cell beside the deposit. */
export function previewUndergroundRoute(world: PeaceWorldSnapshot, depositId: string): UndergroundResult<Pick<UndergroundPlan, 'depositId' | 'target' | 'path' | 'steps' | 'currentStep' | 'state' | 'blockedReason' | 'createdTick'>> {
  if (world.undergroundPlans.some((plan) => plan.depositId === depositId && ['planned', 'in_progress', 'cancelling'].includes(plan.state))) {
    return { ok: false, reason: 'DUPLICATE_JOB' };
  }
  const deposit = world.undergroundDeposits.find((item) => item.id === depositId);
  if (!deposit) return { ok: false, reason: 'DEPOSIT_NOT_FOUND' };
  if (!deposit.revealed) return { ok: false, reason: 'DEPOSIT_NOT_REVEALED' };
  if (deposit.remaining < 1) return { ok: false, reason: 'DEPOSIT_DEPLETED' };
  const starts = world.undergroundCells.filter((cell) => cell.state === 'tunnel' && cell.floorSupported && world.residents.some((resident) =>
    resident.position.y > 0 && findSurfacePath(world, resident.position, cell.position) !== null));
  if (!starts.length) return { ok: false, reason: 'DEPOSIT_NOT_ACCESSED' };
  const targets = [
    { x: deposit.position.x, y: deposit.position.y - 1 }, { x: deposit.position.x - 1, y: deposit.position.y },
    { x: deposit.position.x + 1, y: deposit.position.y }, { x: deposit.position.x, y: deposit.position.y + 1 }
  ];
  const cells = new Map(world.undergroundCells.map((cell) => [coordinateKey(cell.position), cell]));
  const queue: GlobalCoordinate[] = starts.map((cell) => cell.position).sort((a, b) => a.y - b.y || a.x - b.x);
  const previous = new Map<string, string | null>(queue.map((point) => [coordinateKey(point), null]));
  let goal: GlobalCoordinate | undefined;
  for (let cursor = 0; cursor < queue.length && !goal; cursor += 1) {
    const point = queue[cursor]!;
    if (targets.some((target) => coordinateKey(target) === coordinateKey(point))) { goal = point; break; }
    const neighbors = [
      { x: point.x - 1, y: point.y }, { x: point.x + 1, y: point.y },
      { x: point.x, y: point.y - 1 }, { x: point.x, y: point.y + 1 }
    ].sort((a, b) => a.y - b.y || a.x - b.x);
    for (const next of neighbors) {
      const key = coordinateKey(next), cell = cells.get(key);
      if (previous.has(key) || !cell || cell.geology === 'bedrock' || !sectorForCoordinate(world, next)?.ownerId) continue;
      if (!cell.floorSupported) continue;
      if (world.undergroundDeposits.some((item) => coordinateKey(item.position) === key && item.id !== depositId)) continue;
      if (cell.state === 'tunnel' && !isSupportedUndergroundPosition(world, next)) continue;
      if (next.y < point.y && cell.state !== 'tunnel') continue;
      previous.set(key, coordinateKey(point)); queue.push(next);
    }
  }
  if (!goal) return { ok: false, reason: 'CELL_NOT_CONNECTED' };
  const reverse: GlobalCoordinate[] = [];
  let key: string | null = coordinateKey(goal);
  while (key) {
    const [x, y] = key.split(',').map(Number);
    reverse.push({ x: x!, y: y! }); key = previous.get(key) ?? null;
  }
  const path = reverse.reverse();
  const steps: UndergroundRouteStep[] = [];
  const reservedForRelocation = new Set<string>();
  for (let index = 1; index < path.length; index += 1) {
    const point = path[index]!, prev = path[index - 1]!, cell = cells.get(coordinateKey(point))!;
    if (cell.state === 'solid') steps.push({ kind: 'excavate', position: point });
    if (point.y > prev.y) {
      const existing = reusableLadder(world, prev, point);
      if (existing) {
        steps.push({ kind: 'reuse-ladder', ladderId: existing.id, x: point.x, topDepth: prev.y, depth: point.y });
        continue;
      }
      const candidate = world.ladders.filter((ladder) => !reservedForRelocation.has(ladder.id) &&
        ladder.state === 'complete' && !(ladder.top.x === point.x && ladder.bottom.x === point.x &&
          Math.max(ladder.top.y, prev.y) < Math.min(ladder.bottom.y, point.y)) && canSafelyRelocateLadder(world, ladder.id))
        .sort((a, b) => Math.abs(a.top.x - point.x) + a.top.y - (Math.abs(b.top.x - point.x) + b.top.y) || a.id.localeCompare(b.id))[0];
      if (candidate) {
        reservedForRelocation.add(candidate.id);
        steps.push({ kind: 'relocate-ladder', ladderId: candidate.id, x: point.x, topDepth: prev.y, depth: point.y });
      } else {
        steps.push({ kind: 'build-ladder', x: point.x, topDepth: prev.y, depth: point.y });
      }
    }
  }
  const ladderCount = steps.filter((step) => step.kind === 'build-ladder').length;
  const availableWood = (world.storages ?? []).reduce((sum, storage) => sum + storage.contents.wood - storage.reservedOutbound.wood, 0);
  if (availableWood < ladderCount * UNDERGROUND_BALANCE.ladderWood) return { ok: false, reason: 'INSUFFICIENT_MATERIALS' };
  return { ok: true, value: { depositId, target: deposit.position, path, steps, currentStep: 0,
    state: 'planned', blockedReason: null, createdTick: world.revision.serverTick } };
}

/** Persists and starts one route step; later steps are released only after the current step completes. */
export function queueUndergroundRoute(world: PeaceWorldSnapshot, depositId: string): UndergroundResult<UndergroundPlan> {
  if (world.undergroundPlans.some((plan) => plan.depositId === depositId && ['planned', 'in_progress', 'cancelling'].includes(plan.state))) {
    return { ok: false, reason: 'DUPLICATE_JOB' };
  }
  const preview = previewUndergroundRoute(world, depositId);
  if (!preview.ok) return preview;
  if (!preview.value.steps.length) return { ok: false, reason: 'DEPOSIT_NOT_ACCESSED' };
  const plan: UndergroundPlan = { id: `underground-plan-${world.nextUndergroundSequence++}`, ...preview.value };
  world.undergroundPlans.push(plan);
  advanceUndergroundPlans(world);
  return { ok: true, value: plan };
}

function startLadderRelocation(
  world: PeaceWorldSnapshot,
  ladder: PeaceLadder,
  destinationTop: GlobalCoordinate,
  destinationDepth: number,
  planId: string
): UndergroundResult<PeaceLadder> {
  const destinationBottom = undergroundCell(world, { x: destinationTop.x, y: destinationDepth });
  if (destinationDepth !== destinationTop.y + 1 || !isWalkable(world, destinationTop) ||
      destinationBottom?.state !== 'tunnel' || !destinationBottom.floorSupported) {
    return { ok: false, reason: 'CELL_NOT_CONNECTED' };
  }
  if (world.ladders.some((item) => item.id !== ladder.id && item.state !== 'demolished' &&
      item.top.x === destinationTop.x && Math.max(item.top.y, destinationTop.y) < Math.min(item.bottom.y, destinationDepth))) {
    return { ok: false, reason: 'DUPLICATE_JOB' };
  }
  const withoutLadder: PeaceWorldSnapshot = { ...world, ladders: world.ladders.filter((item) => item.id !== ladder.id) };
  const workers = world.residents.filter((resident) => resident.task === null && resident.cargo === 0 &&
    resident.workRole !== 'woodcutter' && resident.workRole !== 'stone_miner')
    .flatMap((resident) => {
      const toSource = findSurfacePath(withoutLadder, resident.position, ladder.top);
      const toDestination = findSurfacePath(withoutLadder, ladder.top, destinationTop);
      return toSource && toDestination ? [{ resident, toSource }] : [];
    }).sort((a, b) => a.toSource.length - b.toSource.length || a.resident.id.localeCompare(b.resident.id));
  const worker = workers[0];
  if (!worker) return { ok: false, reason: 'NO_PATH_TO_LADDER_SITE' };

  ladder.state = 'relocating';
  ladder.assignedResidentId = worker.resident.id;
  ladder.blockedReason = null;
  worker.resident.task = {
    id: `task-relocate-${ladder.id}-${planId}`,
    kind: 'relocate-ladder',
    phase: 'walking_to_ladder',
    ladderId: ladder.id,
    destinationTop,
    destinationDepth,
    waitingPhase: null,
    path: worker.toSource.length ? worker.toSource : [ladder.top],
    pathIndex: 0,
    progressTicks: 0,
    requiredTicks: ladder.progressRequired,
    blockedReason: null
  };
  worker.resident.state = 'working';
  worker.resident.visualState = worker.toSource.length ? 'walking_to_build' : 'carrying_ladder';
  worker.resident.blockedReason = null;
  return { ok: true, value: ladder };
}

export function cancelUndergroundRoute(world: PeaceWorldSnapshot, planId: string): UndergroundResult<UndergroundPlan> {
  const plan = world.undergroundPlans.find((item) => item.id === planId);
  if (!plan) return { ok: false, reason: 'CELL_NOT_FOUND' };
  for (const job of world.undergroundJobs.filter((item) => item.planId === planId && ['queued', 'waiting_path'].includes(item.status))) {
    job.status = 'cancelled'; job.blockedReason = 'PLAN_CANCELLED';
  }
  for (const ladder of world.ladders.filter((item) => item.planId === planId && item.state === 'planned')) demolishLadder(world, ladder.id);
  plan.state = 'cancelled'; plan.blockedReason = null;
  return { ok: true, value: plan };
}

export function advanceUndergroundPlans(world: PeaceWorldSnapshot): boolean {
  let changed = false;
  for (const plan of world.undergroundPlans) {
    if (!['planned', 'in_progress'].includes(plan.state)) continue;
    const step = plan.steps[plan.currentStep];
    if (!step) { plan.state = 'completed'; changed = true; continue; }
    if (step.kind === 'excavate') {
      const active = world.undergroundJobs.find((job) => job.planId === plan.id && job.kind === 'excavate' &&
        coordinateKey(job.target) === coordinateKey(step.position) && ['queued', 'in_progress', 'waiting_path'].includes(job.status));
      if (active) continue;
       const cell = undergroundCell(world, step.position);
       if (!cell || cell.state === 'tunnel' && cell.floorSupported) { plan.currentStep += 1; changed = true; continue; }
       if (cell.state === 'tunnel' && !cell.floorSupported) {
         plan.state = 'blocked'; plan.blockedReason = 'CELL_NOT_CONNECTED'; changed = true; continue;
       }
      const result = queueExcavation(world, [step.position], plan.id);
      if (!result.ok) { plan.state = 'blocked'; plan.blockedReason = result.reason; changed = true; continue; }
      plan.state = 'in_progress'; changed = true;
    } else if (step.kind === 'reuse-ladder') {
      const ladder = reusableLadder(world, { x: step.x, y: step.topDepth }, { x: step.x, y: step.depth });
      if (!ladder || ladder.id !== step.ladderId) {
        plan.state = 'blocked'; plan.blockedReason = 'LADDER_IN_USE'; changed = true; continue;
      }
      plan.currentStep += 1; changed = true;
    } else if (step.kind === 'relocate-ladder') {
      const ladder = world.ladders.find((item) => item.id === step.ladderId);
      if (ladder?.state === 'complete' && ladder.top.x === step.x && ladder.top.y === step.topDepth &&
          ladder.bottom.y === step.depth) {
        plan.currentStep += 1; changed = true; continue;
      }
      if (ladder?.state === 'relocating') continue;
      if (!ladder || !canSafelyRelocateLadder(world, ladder.id, plan.id)) {
        plan.state = 'blocked'; plan.blockedReason = 'LADDER_IN_USE'; changed = true; continue;
      }
      const result = startLadderRelocation(world, ladder, { x: step.x, y: step.topDepth }, step.depth, plan.id);
      if (!result.ok) { plan.state = 'blocked'; plan.blockedReason = result.reason; changed = true; continue; }
      plan.state = 'in_progress'; changed = true;
    } else {
      const built = world.ladders.some((ladder) => ladder.planId === plan.id && ladder.state === 'complete' &&
        ladder.top.y === step.topDepth && ladder.bottom.y === step.depth && ladder.top.x === step.x);
      if (built) { plan.currentStep += 1; changed = true; continue; }
      const active = world.ladders.some((ladder) => ladder.planId === plan.id && ladder.top.y === step.topDepth && ladder.bottom.y === step.depth &&
        ladder.state !== 'demolished');
      if (active) continue;
      const result = createLadder(world, step.x, step.depth, undefined, step.topDepth, plan.id);
      if (!result.ok) { plan.state = 'blocked'; plan.blockedReason = result.reason; changed = true; continue; }
      plan.state = 'in_progress'; changed = true;
    }
  }
  return changed;
}

function workerTask(world: PeaceWorldSnapshot, residentId: string, job: UndergroundJob, path: GlobalCoordinate[]): void {
  const resident = world.residents.find((item) => item.id === residentId)!;
  resident.task = { id: `task-${job.id}`, kind: 'underground-work', phase: path.length ? 'walking_to_worksite' : 'working',
    progressTicks: 0, requiredTicks: job.requiredTicks, blockedReason: null, path, pathIndex: 0,
    jobId: job.id, target: job.target };
  resident.state = path.length ? 'working' : 'working';
  resident.visualState = path.length ? 'walking_to_underground' : job.kind === 'mine' ? 'mining_underground' : 'excavating';
  resident.blockedReason = null;
  job.assignedResidentId = resident.id;
  job.status = 'in_progress';
  job.blockedReason = null;
}

export function dispatchUndergroundJobs(world: PeaceWorldSnapshot): boolean {
  let changed = false;
  const jobs = world.undergroundJobs.filter((job) => job.assignedResidentId === null &&
    ['queued', 'waiting_path'].includes(job.status)).sort((a, b) => a.createdTick - b.createdTick || a.id.localeCompare(b.id));
  for (const job of jobs) {
    const cell = undergroundCell(world, job.target);
    if (job.kind === 'excavate' && (!cell || cell.state !== 'solid' || cell.geology === 'bedrock')) {
      job.status = 'cancelled'; job.blockedReason = 'CELL_UNAVAILABLE'; changed = true; continue;
    }
    if (job.kind === 'mine') {
      const deposit = job.depositId && world.undergroundDeposits.find((item) => item.id === job.depositId);
      if (!deposit || deposit.remaining < 1 || deposit.bufferQuantity >= deposit.bufferCapacity) {
        job.status = 'waiting_path'; job.blockedReason = !deposit || deposit.remaining < 1 ? 'DEPOSIT_DEPLETED' : 'LOCAL_BUFFER_FULL';
        continue;
      }
    }
    const workers = world.residents.filter((resident) => resident.task === null && resident.cargo === 0)
      .flatMap((resident) => {
        const access = workPointFor(world, resident.id, job.target);
        return access ? [{ resident, ...access }] : [];
      }).sort((a, b) => a.path.length - b.path.length || a.resident.id.localeCompare(b.resident.id));
    const selected = workers[0];
    if (!selected) {
      job.status = 'waiting_path'; job.blockedReason = 'NO_PATH_TO_EXCAVATION';
      changed = true; continue;
    }
    workerTask(world, selected.resident.id, job, selected.path);
    changed = true;
  }
  return changed;
}

function revealAdjacentGeology(world: PeaceWorldSnapshot, point: GlobalCoordinate): void {
  const nearby = world.undergroundCells.filter((cell) => Math.abs(cell.position.x - point.x) + Math.abs(cell.position.y - point.y) <= 1);
  for (const cell of nearby) cell.revealed = true;
  for (const deposit of world.undergroundDeposits) {
    if (nearby.some((cell) => coordinateKey(cell.position) === coordinateKey(deposit.position))) deposit.revealed = true;
  }
}

export function advanceUndergroundWork(world: PeaceWorldSnapshot): boolean {
  let changed = dispatchUndergroundJobs(world);
  for (const resident of world.residents) {
    const task = resident.task;
    if (task?.kind !== 'underground-work') continue;
    const job = world.undergroundJobs.find((item) => item.id === task.jobId);
    if (!job || !['in_progress', 'waiting_path'].includes(job.status)) continue;
    if (task.phase === 'waiting_path' || job.status === 'waiting_path') {
      const access = workPointFor(world, resident.id, job.target);
      if (!access) {
        job.status = 'waiting_path'; job.blockedReason = 'NO_PATH_TO_EXCAVATION';
        resident.state = 'waiting'; resident.visualState = 'waiting_path'; resident.blockedReason = job.blockedReason;
        continue;
      }
      task.path = access.path; task.pathIndex = 0;
      task.phase = access.path.length ? 'walking_to_worksite' : 'working';
      job.status = 'in_progress'; job.blockedReason = null;
      resident.state = 'working'; resident.blockedReason = null;
      resident.visualState = access.path.length ? 'walking_to_underground' : job.kind === 'mine' ? 'mining_underground' : 'excavating';
      changed = true;
      if (access.path.length) continue;
    }
    if (task.pathIndex < task.path.length) {
      const next = task.path[task.pathIndex]!;
      if (!isWalkable(world, next) || !findSurfacePath(world, resident.position, next)) {
        task.phase = 'waiting_path'; job.status = 'waiting_path'; job.blockedReason = 'UNDERGROUND_ROUTE_CHANGED';
        resident.state = 'waiting'; resident.visualState = 'waiting_path'; resident.blockedReason = 'UNDERGROUND_ROUTE_CHANGED';
        changed = true; continue;
      }
      resident.position = { ...next }; task.pathIndex += 1; task.progressTicks = task.pathIndex;
      if (task.pathIndex >= task.path.length) {
        task.phase = 'working';
        resident.visualState = job.kind === 'mine' ? 'mining_underground' : 'excavating';
      }
      changed = true; continue;
    }
    job.progressTicks += 1; task.progressTicks = job.progressTicks;
    if (job.kind === 'excavate') {
      const cell = undergroundCell(world, job.target);
      if (!cell || cell.geology === 'bedrock') {
        job.status = 'cancelled'; job.blockedReason = 'GEOLOGY_BLOCKED';
        job.assignedResidentId = null;
        resident.task = null; resident.state = 'idle'; resident.visualState = 'idle'; resident.blockedReason = null;
        } else if (job.progressTicks >= job.requiredTicks) {
          cell.state = 'tunnel'; cell.revealed = true;
          revealAdjacentGeology(world, cell.position);
          job.status = 'completed'; job.assignedResidentId = null; job.blockedReason = null;
        resident.task = null; resident.state = 'idle'; resident.visualState = 'idle'; resident.blockedReason = null;
        world.revision.geometryVersion += 1;
      }
    } else {
      const deposit = world.undergroundDeposits.find((item) => item.id === job.depositId);
      if (!deposit || deposit.remaining <= 0 || deposit.bufferQuantity >= deposit.bufferCapacity) {
        job.status = 'waiting_path'; job.blockedReason = !deposit || deposit.remaining <= 0 ? 'DEPOSIT_DEPLETED' : 'LOCAL_BUFFER_FULL';
        job.assignedResidentId = null;
        resident.task = null; resident.state = 'idle'; resident.visualState = 'idle'; resident.blockedReason = null;
      } else if (job.progressTicks >= job.requiredTicks) {
        deposit.remaining = Math.max(0, deposit.remaining - job.outputQuantity);
        deposit.bufferQuantity = Math.min(deposit.bufferCapacity, deposit.bufferQuantity + job.outputQuantity);
        if (deposit.remaining === 0) deposit.state = 'depleted';
        job.status = 'completed'; job.assignedResidentId = null; job.blockedReason = null;
        resident.task = null; resident.state = 'idle'; resident.visualState = 'idle'; resident.blockedReason = null;
      }
    }
    changed = true;
  }
  changed = advanceUndergroundPlans(world) || changed;
  return dispatchUndergroundJobs(world) || changed;
}

export function createLadder(world: PeaceWorldSnapshot, x: number, depth: number, residentId?: string, topDepth = depth - 1, planId: string | null = null): UndergroundResult<PeaceLadder> {
  ensureUndergroundWorld(world);
  const top = { x, y: topDepth }, bottom = { x, y: depth };
  if (depth <= topDepth) return { ok: false, reason: 'CELL_NOT_CONNECTED' };
  const cell = undergroundCell(world, bottom);
  const sector = cell && sectorForCoordinate(world, bottom);
  if (!cell || !sector?.ownerId) return { ok: false, reason: 'SECTOR_NOT_OWNED' };
  if (cell.state !== 'tunnel' || !cell.floorSupported) return { ok: false, reason: 'DEPOSIT_NOT_ACCESSED' };
  if (!isWalkable(world, top)) {
    return { ok: false, reason: 'CELL_NOT_CONNECTED' };
  }
  if (world.ladders.some((ladder) => ladder.state !== 'demolished' && ladder.top.x === x && ladder.bottom.x === x &&
      Math.max(ladder.top.y, topDepth) < Math.min(ladder.bottom.y, depth))) {
    return { ok: false, reason: 'DUPLICATE_JOB' };
  }
  if (!world.storages?.length) {
    world.storages = [{ id: world.storage.id, name: 'Склад', kind: 'warehouse', anchor: world.storage.anchor,
      footprint: world.storage.footprint, capacity: world.storage.capacity, contents: { ...world.resources },
      reservedInbound: { wood: 0, stone: 0 }, reservedOutbound: { wood: 0, stone: 0 }, status: 'available', blockedReason: null }];
  }
  const worker = residentId ? world.residents.find((resident) => resident.id === residentId)
    : world.residents.find((resident) => resident.task === null && resident.cargo === 0 &&
      resident.workRole !== 'woodcutter' && resident.workRole !== 'stone_miner');
  if (!worker || worker.task || worker.cargo > 0) return { ok: false, reason: 'NO_WORKER' };
  const storage = [...world.storages].sort((a, b) => a.id.localeCompare(b.id)).find((candidate) =>
    candidate.contents.wood - candidate.reservedOutbound.wood >= UNDERGROUND_BALANCE.ladderWood);
  if (!storage) return { ok: false, reason: 'INSUFFICIENT_MATERIALS' };
  const storagePoint = storageWorkPoints(storage)[0] ?? {
    x: storage.anchor.x + storage.footprint.width, y: storage.anchor.y + storage.footprint.height
  };
  const toStorage = findSurfacePath(world, worker.position, storagePoint);
  const toSite = findSurfacePath(world, storagePoint, top);
  if (!toStorage || !toSite) return { ok: false, reason: 'NO_PATH_TO_LADDER_SITE' };
  const ladder: PeaceLadder = { id: `ladder-${x}-${topDepth}-${depth}`, top, bottom, state: 'planned',
    assignedResidentId: worker.id, requiredWood: UNDERGROUND_BALANCE.ladderWood,
    deliveredWood: 0, reservedWood: UNDERGROUND_BALANCE.ladderWood,
    progressTicks: 0, progressRequired: UNDERGROUND_BALANCE.ladderBuildTicks, blockedReason: null, planId };
  storage.reservedOutbound.wood += ladder.requiredWood;
  worker.task = { id: `task-${ladder.id}`, kind: 'build-ladder', phase: 'walking_to_storage',
    ladderId: ladder.id, storageId: storage.id, path: toStorage.length ? toStorage : [storagePoint],
    pathIndex: 0, progressTicks: 0, requiredTicks: ladder.progressRequired, blockedReason: null };
  worker.state = 'working';
  worker.visualState = toStorage.length ? 'walking_to_build' : 'carrying_materials_to_build';
  world.ladders.push(ladder);
  world.revision.geometryVersion += 1;
  return { ok: true, value: ladder };
}

export function demolishLadder(world: PeaceWorldSnapshot, ladderId: string): UndergroundResult<PeaceLadder> {
  const ladder = world.ladders.find((candidate) => candidate.id === ladderId && candidate.state !== 'demolished');
  if (!ladder) return { ok: false, reason: 'CELL_NOT_FOUND' };
  if (ladder.state === 'complete' && !canSafelyRelocateLadder(world, ladder.id)) {
    return { ok: false, reason: 'LADDER_IN_USE' };
  }
  const saved = world.ladders;
  world.ladders = saved.filter((candidate) => candidate.id !== ladderId);
  const strandsResident = world.residents.some((resident) => resident.position.y > 0 &&
    findSurfacePath(world, resident.position, { x: resident.position.x, y: 0 }) === null);
  world.ladders = saved;
  if (strandsResident) return { ok: false, reason: 'LADDER_IN_USE' };
  const owner = world.residents.find((resident) => resident.task?.kind === 'build-ladder' && resident.task.ladderId === ladder.id);
  if (owner?.task?.kind === 'build-ladder' && owner.task.storageId) {
    const storageId = owner.task.storageId;
    const storage = world.storages?.find((candidate) => candidate.id === storageId);
    if (storage) storage.reservedOutbound.wood = Math.max(0, storage.reservedOutbound.wood - ladder.reservedWood);
    if (owner.cargoItemId === 'wood') {
      const quantity = owner.cargo;
      if (storage) storage.contents.wood += quantity;
      owner.cargo = 0; owner.cargoItemId = null;
    }
    owner.task = null; owner.state = 'idle'; owner.visualState = 'idle'; owner.blockedReason = null;
  }
  ladder.state = 'demolished'; ladder.assignedResidentId = null;
  ladder.reservedWood = 0; ladder.blockedReason = 'DEMOLISHED';
  world.revision.geometryVersion += 1;
  return { ok: true, value: ladder };
}

export function advanceLadderConstruction(world: PeaceWorldSnapshot): boolean {
  let changed = false;
  for (const resident of world.residents) {
    const task = resident.task;
    if (task?.kind === 'relocate-ladder') {
      const ladder = world.ladders.find((candidate) => candidate.id === task.ladderId);
      if (!ladder || ladder.state !== 'relocating') {
        resident.task = null; resident.state = 'idle'; resident.visualState = 'idle'; resident.blockedReason = null;
        changed = true; continue;
      }
      if (task.phase === 'waiting_path') {
        const resume = task.waitingPhase ?? 'walking_to_ladder';
        const destination = resume === 'walking_to_ladder' ? ladder.top : task.destinationTop;
        const path = findSurfacePath(world, resident.position, destination);
        if (!path) continue;
        task.path = path.length ? path : [destination];
        task.pathIndex = 0;
        task.phase = resume;
        task.waitingPhase = null;
        task.blockedReason = null;
        resident.state = 'working'; resident.blockedReason = null;
        resident.visualState = resume === 'walking_to_ladder' ? 'walking_to_build' : 'carrying_ladder';
        changed = true;
        continue;
      }
      if (task.phase === 'walking_to_ladder' || task.phase === 'carrying_to_site') {
        if (task.pathIndex < task.path.length) {
          const next = task.path[task.pathIndex]!;
          if (!findSurfacePath(world, resident.position, next)) {
            task.waitingPhase = task.phase;
            task.phase = 'waiting_path'; task.blockedReason = 'NO_PATH_TO_LADDER_SITE';
            resident.state = 'waiting'; resident.visualState = 'waiting_path'; resident.blockedReason = task.blockedReason;
            ladder.blockedReason = task.blockedReason;
            changed = true; continue;
          }
          resident.position = { ...next }; task.pathIndex += 1; changed = true;
          if (task.pathIndex < task.path.length) continue;
        }
        task.progressTicks = 0;
        task.phase = task.phase === 'walking_to_ladder' ? 'dismantling' : 'installing';
        resident.visualState = task.phase === 'dismantling' ? 'dismantling_ladder' : 'installing_ladder';
        continue;
      }
      if (task.phase === 'dismantling') {
        task.progressTicks = Math.min(task.requiredTicks, task.progressTicks + 1);
        ladder.progressTicks = task.progressTicks;
        if (task.progressTicks >= task.requiredTicks) {
          const path = findSurfacePath(world, resident.position, task.destinationTop);
          if (!path) {
            task.waitingPhase = 'carrying_to_site'; task.phase = 'waiting_path';
            task.blockedReason = 'NO_PATH_TO_LADDER_SITE';
            resident.state = 'waiting'; resident.visualState = 'waiting_path'; resident.blockedReason = task.blockedReason;
            ladder.blockedReason = task.blockedReason;
          } else {
            task.path = path.length ? path : [task.destinationTop];
            task.pathIndex = 0; task.progressTicks = 0; task.phase = 'carrying_to_site';
            resident.visualState = 'carrying_ladder';
            ladder.blockedReason = null;
          }
        }
        changed = true; continue;
      }
      if (task.phase === 'installing') {
        task.progressTicks = Math.min(task.requiredTicks, task.progressTicks + 1);
        ladder.progressTicks = task.progressTicks;
        if (task.progressTicks >= task.requiredTicks) {
          ladder.top = { ...task.destinationTop };
          ladder.bottom = { x: task.destinationTop.x, y: task.destinationDepth };
          ladder.state = 'complete'; ladder.assignedResidentId = null; ladder.blockedReason = null;
          resident.task = null; resident.state = 'idle'; resident.visualState = 'idle'; resident.blockedReason = null;
          world.revision.geometryVersion += 1;
        }
        changed = true;
      }
      continue;
    }
    if (task?.kind !== 'build-ladder') continue;
    const ladder = world.ladders.find((candidate) => candidate.id === task.ladderId);
    if (!ladder || ladder.state === 'demolished') {
      resident.task = null; resident.state = 'idle'; resident.visualState = 'idle'; changed = true; continue;
    }
    if (task.pathIndex < task.path.length) {
      const next = task.path[task.pathIndex]!;
      if (!findSurfacePath(world, resident.position, next)) {
        task.phase = 'waiting_path'; task.blockedReason = 'NO_PATH_TO_LADDER_SITE';
        resident.state = 'waiting'; resident.visualState = 'waiting_path'; resident.blockedReason = task.blockedReason;
        ladder.state = 'blocked'; ladder.blockedReason = task.blockedReason; changed = true; continue;
      }
      resident.position = { ...next }; task.pathIndex += 1; changed = true;
      if (task.pathIndex >= task.path.length && task.phase === 'walking_to_storage') {
        const storage = world.storages?.find((candidate) => candidate.id === task.storageId);
        if (!storage || storage.reservedOutbound.wood < ladder.requiredWood || storage.contents.wood < ladder.requiredWood) {
          task.phase = 'waiting_materials'; task.blockedReason = 'RESERVED_LADDER_WOOD_MISSING';
          ladder.state = 'blocked'; ladder.blockedReason = task.blockedReason; continue;
        }
        storage.reservedOutbound.wood -= ladder.requiredWood;
        storage.contents.wood -= ladder.requiredWood;
        ladder.reservedWood = 0;
        resident.cargo = ladder.requiredWood; resident.cargoItemId = 'wood';
        const sitePath = findSurfacePath(world, resident.position, ladder.top);
        if (!sitePath) {
          task.phase = 'waiting_path'; task.blockedReason = 'NO_PATH_TO_LADDER_SITE';
          ladder.state = 'blocked'; ladder.blockedReason = task.blockedReason; continue;
        }
        task.path = sitePath.length ? sitePath : [ladder.top]; task.pathIndex = 0; task.phase = 'carrying_to_site'; task.blockedReason = null;
        resident.visualState = 'carrying_materials_to_build';
      } else if (task.pathIndex >= task.path.length && task.phase === 'carrying_to_site') {
        ladder.deliveredWood += resident.cargo;
        resident.cargo = 0; resident.cargoItemId = null;
        ladder.state = 'building'; ladder.blockedReason = null;
        task.phase = 'building'; task.progressTicks = 0; task.requiredTicks = ladder.progressRequired;
        resident.visualState = 'building_ladder';
      }
      continue;
    }
    if (task.phase !== 'building' || ladder.deliveredWood < ladder.requiredWood) continue;
    ladder.progressTicks = Math.min(ladder.progressRequired, ladder.progressTicks + 1);
    task.progressTicks = ladder.progressTicks;
    if (ladder.progressTicks >= ladder.progressRequired) {
      ladder.state = 'complete'; ladder.assignedResidentId = null; ladder.blockedReason = null;
      resident.task = null; resident.state = 'idle'; resident.visualState = 'idle'; resident.blockedReason = null;
      world.revision.geometryVersion += 1;
    }
    changed = true;
  }
  if (world.storages?.length) world.resources = world.storages.reduce((sum, storage) => ({
    wood: sum.wood + storage.contents.wood, stone: sum.stone + storage.contents.stone
  }), { wood: 0, stone: 0 });
  return changed;
}

export function connectedLadderEdge(world: PeaceWorldSnapshot, a: GlobalCoordinate, b: GlobalCoordinate): boolean {
  return ladderConnects(world, a, b) && (a.y <= 0 || isSupportedUndergroundPosition(world, a)) &&
    (b.y <= 0 || isSupportedUndergroundPosition(world, b));
}

export function isUndergroundTunnel(world: PeaceWorldSnapshot, point: GlobalCoordinate): boolean {
  return undergroundCell(world, point)?.state === 'tunnel';
}
