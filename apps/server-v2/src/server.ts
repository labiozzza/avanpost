import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import Fastify, { type FastifyRequest } from 'fastify';
import {
  CabinPlacementRequestSchema,
  ensurePhysicalStorageSnapshot,
  GlobalCoordinateSchema,
  PairingRequestSchema,
  PeaceCommandSchema,
  MAX_EXPANSION_CELLS,
  PeaceResidentIdSchema,
  PeaceWorldSnapshotSchema,
  PEACE_WORLD_SCHEMA_VERSION,
  ReadOnlyWorldPreviewSchema,
  type PeaceResident,
  type PeaceWorldSnapshot,
  type ReadOnlyWorldPreview
} from '@avanpost/peace-v2-shared';
import {
  advanceSettlement,
  ensurePopulationState,
  housingSummary,
  cancelUnstartedBuildOrder,
  demolishBuilding,
  demolishStorage,
  createBuildCabinOrder,
  createBuildWorkshopOrder,
  createBuildSchoolOrder,
  startG72Training,
  cancelG72Training,
  createDeliveryTask,
  createGatherWoodTask,
  createStoneDeliveryTask,
  assignClearingJobToResident,
  ensureTerritoryWorld,
  ensureUndergroundWorld,
  queueExcavation,
  queueUndergroundMining,
  previewUndergroundRoute,
  queueUndergroundRoute,
  cancelUndergroundRoute,
  createLadder,
  demolishLadder,
  moveBuildOrder,
  scheduleWorkOrders,
  startCellExpansion,
  validateCabinOrderPlacement,
  validateWorkshopOrderPlacement,
  PEACE_V2_TICK_INTERVAL_MS,
  WOOD_CABIN_COST,
  STONE_MINER_ROLE,
  WORKSHOP_MATERIALS
} from '@avanpost/peace-v2-sim';
import type { V2Config } from './config.js';
import { OccupiedCellsConflictError, replaceWorldOccupiedCells } from './database/occupancy.js';

interface QueryResult<T = Record<string, unknown>> {
  rows: T[];
  rowCount: number | null;
}

export interface V2HealthDatabase {
  query<T = Record<string, unknown>>(sql: string, values?: any[]): Promise<QueryResult<T>>;
}

const WORLD_ID = 'peace-home';
const PAIRING_TTL_MS = 5 * 60_000;
const PAIRING_WINDOW_MS = 5 * 60_000;
const PAIRING_ATTEMPT_LIMIT = 5;
const SESSION_TTL_MS = 30 * 24 * 60 * 60_000;
interface PersistedWorld {
  world_version: number;
  geometry_version: number;
  server_tick: number;
  last_simulated_at?: Date | string;
  state: unknown;
}

class V2WorldStateError extends Error {
  constructor(readonly code: 'V2_WORLD_NOT_INITIALIZED' | 'V2_WORLD_STATE_INVALID') {
    super(code);
    this.name = 'V2WorldStateError';
  }
}

interface PairingAttempt {
  count: number;
  windowStartedAt: number;
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export interface V2PairingCredentials {
  code: string;
  expiresAt: number;
  consumed: boolean;
}

export function createV2PairingCredentials(): V2PairingCredentials {
  // The launch-time value is deliberately not usable; expiry starts when the
  // loopback handoff first reveals a code to the owner.
  return { code: randomBytes(16).toString('hex'), expiresAt: 0, consumed: false };
}

function renewV2PairingCredentials(pairing: V2PairingCredentials): void {
  pairing.code = randomBytes(16).toString('hex');
  pairing.expiresAt = Date.now() + PAIRING_TTL_MS;
  pairing.consumed = false;
}

function isLoopbackAddress(address: string | undefined): boolean {
  return address === '::1' || address === '127.0.0.1' || address?.startsWith('::ffff:127.') === true;
}

function isPrivateIpv4Address(address: string | undefined): boolean {
  const host = address?.startsWith('::ffff:') ? address.slice(7) : address;
  if (!host || !/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return false;
  const octets = host.split('.').map(Number);
  return octets.every((octet) => octet >= 0 && octet <= 255) && (
    octets[0] === 10 || octets[0] === 192 && octets[1] === 168 ||
    octets[0] === 172 && octets[1] !== undefined && octets[1] >= 16 && octets[1] <= 31
  );
}

function uiOrigins(config: V2Config): Set<string> {
  const origins = new Set([`http://${config.bindHost}:${config.clientPort}`]);
  if (['127.0.0.1', 'localhost', '::1'].includes(config.bindHost)) {
    origins.add(`http://127.0.0.1:${config.clientPort}`);
    origins.add(`http://localhost:${config.clientPort}`);
  }
  if (config.lanEnabled && !['127.0.0.1', 'localhost', '::1'].includes(config.bindHost)) {
    origins.add(`http://localhost:${config.loopbackClientPort}`);
    origins.add(`http://127.0.0.1:${config.loopbackClientPort}`);
  }
  return origins;
}

function requestHostMatches(request: FastifyRequest, config: V2Config, port: number, loopbackOnly = false): boolean {
  const host = request.headers.host;
  if (!host) return false;
  try {
    const parsed = new URL(`http://${host}`);
    const expectedHosts = loopbackOnly
      ? ['127.0.0.1', 'localhost', '[::1]', '::1']
      : ['127.0.0.1', 'localhost', '::1'].includes(config.bindHost)
        ? [config.bindHost, 'localhost', '127.0.0.1']
        : [config.bindHost];
    return expectedHosts.includes(parsed.hostname) && parsed.port === String(port);
  } catch {
    return false;
  }
}

function requestOriginMatchesHost(request: FastifyRequest, config: V2Config): boolean {
  const origin = request.headers.origin;
  const referer = request.headers.referer;
  if (!origin || !referer) return false;
  try {
    const parsedOrigin = new URL(origin);
    const parsedReferer = new URL(referer);
    return uiOrigins(config).has(parsedOrigin.origin) &&
      parsedOrigin.origin === parsedReferer.origin;
  } catch {
    return false;
  }
}

function isPairingRequest(request: FastifyRequest, config: V2Config): boolean {
  const peer = request.raw.socket.remoteAddress ?? request.ip;
  const peerAllowed = isLoopbackAddress(peer) || config.lanEnabled && isPrivateIpv4Address(peer);
  return peerAllowed && requestHostMatches(request, config, config.port) &&
    requestOriginMatchesHost(request, config);
}

function safeProblem(status: number, code: string, title: string, detail: string, requestId?: string) {
  return {
    type: `https://avanpost.invalid/problems/${code.toLowerCase().replaceAll('_', '-')}`,
    title,
    status,
    detail,
    code,
    ...(requestId ? { requestId } : {})
  };
}

function setResidentTask(resident: PeaceResident, task: PeaceResident['task']): void {
  resident.task = task;
  resident.visualState = task?.kind === 'arrival' ? task.phase === 'commuting' ? 'walking_to_settlement' : 'waiting_path'
    : task?.kind === 'study' ? task.phase === 'walking_to_school' ? 'walking_to_school'
      : task.phase === 'studying' ? 'studying' : 'waiting_path'
    : task?.kind === 'walk-away-from-worksite' ? 'walking_away_from_worksite'
    : task?.kind === 'underground-work' ? task.phase === 'walking_to_worksite' ? 'walking_to_underground'
      : task.phase === 'carrying_to_surface' ? 'carrying_underground_to_surface'
        : task.phase === 'working' ? 'excavating' : task.phase === 'waiting_path' ? 'waiting_path' : 'blocked'
    : task?.kind === 'relocate-ladder' ? task.phase === 'walking_to_ladder' ? 'walking_to_build'
      : task.phase === 'dismantling' ? 'dismantling_ladder'
        : task.phase === 'carrying_to_site' ? 'carrying_ladder'
          : task.phase === 'installing' ? 'installing_ladder'
            : task.phase === 'waiting_path' ? 'waiting_path' : 'blocked'
    : task?.kind === 'build-ladder' ? task.phase === 'building' ? 'building_ladder'
      : task.phase === 'carrying_to_site' ? 'carrying_materials_to_build'
        : task.phase === 'waiting_path' ? 'waiting_path'
          : task.phase === 'waiting_materials' ? 'waiting_materials' : 'walking_to_build'
    : task?.kind === 'clear-cell'
    ? task.phase === 'walking_to_worksite' ? 'walking_to_clearing'
      : task.phase === 'clearing' ? 'clearing' : task.phase
    : task?.kind === 'haul'
    ? task.phase === 'walking_to_source' ? 'hauling_to_source'
      : task.phase === 'loading' ? 'hauling_loading'
        : task.phase === 'carrying' ? task.destinationKind === 'building' ? 'hauling_to_worksite' : 'hauling_to_storage'
          : task.phase === 'unloading' ? 'hauling_unloading'
            : task.phase === 'waiting_path' || task.phase === 'waiting_storage' || task.phase === 'waiting_source'
              ? 'waiting_haul' : task.phase
    : task?.kind === 'gather-stone'
    ? task.phase === 'walking_to_source' ? 'walking_to_stone'
      : task.phase === 'mining' ? 'mining_stone'
          : task.phase === 'loading' ? 'loading_stone'
            : task.phase === 'carrying_to_build' ? 'carrying_stone_to_build'
              : task.phase === 'unloading_at_building' ? 'unloading_stone_at_build'
                : task.phase === 'carrying_to_storage' ? 'carrying_stone_to_storage'
                  : task.phase === 'unloading' ? 'unloading_stone'
                    : task.phase === 'waiting_resource' ? 'waiting_stone_source'
                      : task.phase === 'waiting_storage' ? 'waiting_stone_storage' : task.phase
    : task?.phase ?? 'idle';
  resident.blockedReason = task?.blockedReason ?? null;
  resident.state = !task ? 'idle'
    : task.phase === 'blocked' ? 'blocked'
       : ['waiting_path', 'waiting_resource', 'waiting_materials', 'waiting_storage'].includes(task.phase) ? 'waiting' : 'working';
}

function parseWorld(row: PersistedWorld): PeaceWorldSnapshot {
  return PeaceWorldSnapshotSchema.parse({
    revision: {
      worldVersion: row.world_version,
      geometryVersion: row.geometry_version,
      serverTick: row.server_tick
    },
    ...(typeof row.state === 'string' ? JSON.parse(row.state) as object : row.state as object)
  });
}

function parsePersistedWorld(row: PersistedWorld): PeaceWorldSnapshot {
  try {
    return ensurePopulationState(ensureUndergroundWorld(ensureTerritoryWorld(parseWorld(row))));
  } catch {
    throw new V2WorldStateError('V2_WORLD_STATE_INVALID');
  }
}

function toPreview(world: PeaceWorldSnapshot): ReadOnlyWorldPreview {
  return ReadOnlyWorldPreviewSchema.parse({
    revision: world.revision,
    undergroundUnlockedDepth: world.undergroundUnlockedDepth,
    populationSummary: housingSummary(world),
    cells: world.surfaceCells.length > 0 ? world.surfaceCells.map((cell) => ({
      coordinate: cell.position,
      fillType: 'solid' as const,
      materialId: cell.terrainType ?? 'earth',
      sectorId: cell.sectorId,
      prepared: cell.prepared,
      terrainType: cell.terrainType,
      obstacleId: cell.obstacleId
    })) : Array.from({ length: 9 }, (_, index) => ({
      coordinate: { x: index - 4, y: 0 }, fillType: 'solid' as const, materialId: 'earth'
    })),
    sectors: world.sectors.map((sector) => ({
      id: sector.id, sectorX: sector.sectorX, sectorY: sector.sectorY, bounds: sector.bounds,
      biome: sector.biome, state: sector.state, ownerId: sector.ownerId, explored: sector.explored,
      unlockCost: sector.unlockCost, obstacles: sector.obstacles, testOverride: sector.testOverride,
      preparationTargets: sector.preparationTargets
    })),
    undergroundCells: world.undergroundCells.map((cell) => ({
      position: cell.position,
      geology: cell.revealed || cell.state === 'tunnel' ? cell.geology : 'unknown',
      state: cell.state,
      revealed: cell.revealed,
      floorSupported: cell.floorSupported
    })),
    undergroundDeposits: world.undergroundDeposits.filter((deposit) => deposit.revealed).map((deposit) => ({ ...deposit })),
    ladders: world.ladders.map((ladder) => ({ ...ladder })),
    undergroundJobs: world.undergroundJobs.map((job) => ({ ...job })),
    undergroundPlans: world.undergroundPlans.map((plan) => ({ ...plan })),
      buildings: [
      ...ensurePhysicalStorageSnapshot(world).storages!.map((storage) => ({
        visualKey: storage.id,
        buildingId: 'storehouse',
        anchor: storage.anchor,
        footprint: storage.footprint,
        entrance: storage.entrance,
        workPoint: storage.workPoint,
        accessibility: 'accessible' as const,
        accessibilityReason: null,
        state: 'complete' as const
      })),
      ...world.buildings.filter((building) => building.state !== 'cancelled' && building.state !== 'demolished').map((building) => ({
        visualKey: building.id,
        buildingId: building.kind,
        anchor: building.anchor,
        footprint: building.footprint,
        entrance: building.entrance,
        workPoint: building.workPoint,
        accessibility: building.accessibility,
        accessibilityReason: building.accessibilityReason,
        progressTicks: building.progressTicks,
        progressRequired: building.progressRequired,
        reservedWood: building.reservedWood,
        reservedStone: building.reservedStone,
        inTransitWood: building.inTransitWood,
        inTransitStone: building.inTransitStone,
        state: building.state
      }))
    ],
    storages: ensurePhysicalStorageSnapshot(world).storages!.map((storage) => ({ ...storage, visualKey: storage.id })),
    buildOrders: world.buildOrders,
    resourceNodes: world.trees.map((tree, index) => ({
      visualKey: `resource-tree-${index + 1}`,
      name: tree.name,
      position: tree.position,
      sourceKind: tree.sourceKind,
      remaining: tree.remaining,
      maxRemaining: tree.maxRemaining,
      bufferQuantity: tree.bufferQuantity,
      bufferCapacity: tree.bufferCapacity,
      reservedBuffer: tree.reservedBuffer,
      state: tree.state,
      regrowthProgressTicks: tree.regrowthProgressTicks,
      regrowthEveryTicks: tree.regrowthEveryTicks
    })),
    stoneDeposits: world.stoneDeposits.map((deposit, index) => ({
      ...deposit,
      visualKey: `resource-stone-${index + 1}`
    })),
    actors: world.residents.map((resident, index) => ({
      visualKey: `resident-scene-${index + 1}`,
      appearanceKey: resident.appearanceKey,
      workRole: resident.workRole,
      position: resident.position,
      visualState: resident.visualState,
      cargo: resident.cargo,
      cargoItemId: resident.cargoItemId
    })),
    resourceTotals: [
      { itemId: 'wood', quantity: world.resources.wood },
      { itemId: 'stone', quantity: world.resources.stone }
    ]
  });
}

export function createV2Server(
  config: V2Config,
  database: V2HealthDatabase,
  databaseName = config.database.development.databaseName,
  pairing = createV2PairingCredentials()
) {
  const app = Fastify({ logger: { level: 'error' }, trustProxy: false, bodyLimit: 16 * 1024 });
  const attempts = new Map<string, PairingAttempt>();
  let databaseQueue: Promise<void> = Promise.resolve();
  const withDatabaseLock = <T>(operation: () => Promise<T>): Promise<T> => {
    const result = databaseQueue.then(operation, operation);
    databaseQueue = result.then(() => undefined, () => undefined);
    return result;
  };
  const queryDatabase = <T = Record<string, unknown>>(sql: string, values?: any[]) =>
    withDatabaseLock(() => database.query<T>(sql, values));
  let simulationTimer: NodeJS.Timeout | undefined;
  let simulationInFlight: Promise<void> | undefined;

function stateJson(world: PeaceWorldSnapshot) {
    return JSON.stringify({
      worldSeed: world.worldSeed,
      territoryGeneratorVersion: world.territoryGeneratorVersion,
      resources: world.resources,
      storage: world.storage,
      storages: world.storages,
      logisticsTasks: world.logisticsTasks,
      logisticsPolicy: world.logisticsPolicy,
      nextLogisticsSequence: world.nextLogisticsSequence,
      sectors: world.sectors,
      clearingJobs: world.clearingJobs,
      nextClearingSequence: world.nextClearingSequence,
      undergroundCells: world.undergroundCells,
      undergroundDeposits: world.undergroundDeposits,
      undergroundJobs: world.undergroundJobs,
      undergroundPlans: world.undergroundPlans,
      nextUndergroundSequence: world.nextUndergroundSequence,
      ladders: world.ladders,
      surfaceCells: world.surfaceCells,
      trees: world.trees,
      stoneDeposits: world.stoneDeposits,
      residents: world.residents,
      buildings: world.buildings,
      populationMigration: world.populationMigration,
      buildOrders: world.buildOrders,
      nextBuildOrderSequence: world.nextBuildOrderSequence
    });
  }

  function recoverCarriedResources(world: PeaceWorldSnapshot): boolean {
    let recovered = false;
    for (const resident of world.residents) {
      if (resident.cargo < 1 || resident.task) continue;
      const taskId = `recovery-${resident.id}-${world.revision.serverTick}`;
      if (resident.cargoItemId === 'stone') {
        const task = createStoneDeliveryTask(world, resident.id, taskId);
        setResidentTask(resident, task ?? {
          id: taskId, kind: 'gather-stone', phase: 'waiting_path', sourceId: null,
          destinationId: world.storage.id, path: [], pathIndex: 0, progressTicks: 0, requiredTicks: 1,
          blockedReason: 'NO_PATH_TO_STORAGE', continuous: false, cancelAfterDelivery: true,
          assignmentSource: 'recovery'
        });
      } else {
        const task = createDeliveryTask(world, resident.id, taskId, 'recovered-cargo');
        setResidentTask(resident, task ?? {
          id: taskId, kind: 'gather-wood', phase: 'waiting_path', sourceId: 'recovered-cargo',
          destinationId: world.storage.id, path: [], pathIndex: 0, progressTicks: 0, requiredTicks: 1,
          blockedReason: 'NO_PATH_TO_STORAGE', continuous: false, cancelAfterDelivery: false,
          assignmentSource: 'manual'
        });
      }
      recovered = true;
    }
    return recovered;
  }

  function elapsedTicks(lastSimulatedAt: Date | string | undefined, nowMs: number): number {
    const lastMs = lastSimulatedAt === undefined ? nowMs : new Date(lastSimulatedAt).getTime();
    if (!Number.isFinite(lastMs) || nowMs <= lastMs) return 0;
    return Math.floor((nowMs - lastMs) / PEACE_V2_TICK_INTERVAL_MS);
  }

  function simulatedThrough(lastSimulatedAt: Date | string | undefined, ticks: number, nowMs: number): Date {
    const start = lastSimulatedAt === undefined ? nowMs : new Date(lastSimulatedAt).getTime();
    return new Date(start + ticks * PEACE_V2_TICK_INTERVAL_MS);
  }

  async function tickSimulation(now: number | Date = Date.now()): Promise<void> {
    const nowMs = now instanceof Date ? now.getTime() : now;
    await withDatabaseLock(async () => {
      await database.query('BEGIN');
      try {
        const result = await database.query<PersistedWorld>(
          'SELECT world_version, geometry_version, server_tick, last_simulated_at, state FROM peace_v2_world_state WHERE world_id = $1 FOR UPDATE',
          [WORLD_ID]
        );
        const row = result.rows[0];
        if (!row) {
          await database.query('ROLLBACK');
          return;
        }
        const current = parsePersistedWorld(row);
        const recovered = recoverCarriedResources(current);
        const ticks = elapsedTicks(row.last_simulated_at, nowMs);
        if (ticks === 0 && !recovered) {
          await database.query('ROLLBACK');
          return;
        }
        const next = advanceSettlement(current, ticks);
        if (next.revision.geometryVersion !== current.revision.geometryVersion) {
          await replaceWorldOccupiedCells(database, WORLD_ID, next);
        }
        await database.query(
          `UPDATE peace_v2_world_state
           SET world_version = $2, geometry_version = $3, server_tick = $4, state = $5::jsonb,
                   last_simulated_at = $6, state_schema_version = $7, updated_at = now()
           WHERE world_id = $1`,
          [WORLD_ID, next.revision.worldVersion, next.revision.geometryVersion, next.revision.serverTick,
             stateJson(next), simulatedThrough(row.last_simulated_at, ticks, nowMs), PEACE_WORLD_SCHEMA_VERSION]
        );
        await database.query('COMMIT');
      } catch (error) {
        await database.query('ROLLBACK').catch(() => undefined);
        throw error;
      }
    });
  }

  function startSimulation(): void {
    if (simulationTimer) return;
    const runScheduledTick = (): void => {
      if (simulationInFlight) return;
      simulationInFlight = (async () => {
        try {
          await tickSimulation();
        } catch {
          console.error(JSON.stringify({ status: 'blocked', code: 'V2_SIMULATION_TICK_FAILED' }));
        } finally {
          simulationInFlight = undefined;
        }
      })();
    };
    runScheduledTick();
    simulationTimer = setInterval(runScheduledTick, PEACE_V2_TICK_INTERVAL_MS);
  }

  app.addHook('onClose', async () => {
    if (simulationTimer) clearInterval(simulationTimer);
    simulationTimer = undefined;
    await simulationInFlight;
  });

  const allowedOrigins = uiOrigins(config);
  app.addHook('onRequest', async (request, reply) => {
    const origin = request.headers.origin;
    if (!origin) return;
    if (!allowedOrigins.has(origin)) {
      return reply.code(403).send(safeProblem(403, 'ORIGIN_REJECTED', 'Request unavailable', 'Этот источник не разрешён для V2 мира.'));
    }
    reply.header('access-control-allow-origin', origin)
      .header('access-control-allow-credentials', 'true')
      .header('access-control-allow-methods', 'GET, POST, OPTIONS')
      .header('access-control-allow-headers', 'content-type, accept')
      .header('access-control-max-age', '300')
      .header('vary', 'Origin');
    if (request.method === 'OPTIONS') return reply.code(204).send();
  });

  async function readWorld(): Promise<PeaceWorldSnapshot> {
    await tickSimulation();
    const result = await queryDatabase<PersistedWorld>(
      'SELECT world_version, geometry_version, server_tick, last_simulated_at, state FROM peace_v2_world_state WHERE world_id = $1',
      [WORLD_ID]
    );
    const row = result.rows[0];
    if (!row) throw new V2WorldStateError('V2_WORLD_NOT_INITIALIZED');
    try {
      const world = parsePersistedWorld(row);
      recoverCarriedResources(world);
      return world;
    } catch {
      throw new V2WorldStateError('V2_WORLD_STATE_INVALID');
    }
  }

  function sendWorldReadFailure(request: FastifyRequest, reply: any, error: unknown) {
    if (error instanceof V2WorldStateError) {
      request.log.error({ code: error.code, worldId: WORLD_ID }, 'Persisted V2 world state is unavailable');
      return reply.code(503).send(safeProblem(
        503,
        error.code,
        'World data unavailable',
        error.code === 'V2_WORLD_NOT_INITIALIZED'
          ? 'Игровой мир ещё не подготовлен.'
          : 'Сохранённое состояние мира повреждено. Обратитесь к владельцу запуска.'
      ));
    }
    return reply.code(503).send(safeProblem(503, 'V2_DB_UNAVAILABLE', 'World unavailable', 'Мир пока недоступен. Повторите после восстановления связи.'));
  }

  async function ownerSession(request: FastifyRequest): Promise<boolean> {
    const sessionCookie = request.headers.cookie?.split(';')
      .map((part) => part.trim())
      .find((part) => part.startsWith('peace_v2_session='));
    const token = sessionCookie?.slice('peace_v2_session='.length);
    if (!token) return false;
    const tokenHash = sha256(token);
    const session = await queryDatabase<{ valid: boolean }>(
      'SELECT EXISTS (SELECT 1 FROM peace_v2_sessions WHERE token_hash = $1 AND expires_at > now()) AS valid',
      [tokenHash]
    );
    return session.rows[0]?.valid === true;
  }

  app.get('/api/health', async (_request, reply) => {
    try {
      await queryDatabase('SELECT 1');
      return { status: 'ok', api: 'peace-v2', database: databaseName };
    } catch {
      return reply.code(503).send({ status: 'blocked', code: 'V2_DB_UNAVAILABLE' });
    }
  });

  app.post('/api/session', async (request, reply) => {
    if (!isPairingRequest(request, config)) {
      return reply.code(404).send(safeProblem(404, 'WORLD_NOT_FOUND', 'Not found', 'Сессия недоступна для этого устройства.'));
    }
    const peer = request.raw.socket.remoteAddress ?? request.ip;
    const attempt = attempts.get(peer);
    const now = Date.now();
    const activeAttempt = !attempt || now - attempt.windowStartedAt >= PAIRING_WINDOW_MS
      ? { count: 0, windowStartedAt: now }
      : attempt;
    const recordFailedAttempt = () => {
      activeAttempt.count += 1;
      attempts.set(peer, activeAttempt);
    };
    if (activeAttempt.count >= PAIRING_ATTEMPT_LIMIT) {
      return reply.code(429).send(safeProblem(429, 'PAIR_RATE_LIMITED', 'Try later', 'Подождите немного и попробуйте снова.'));
    }
    const parsed = PairingRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      recordFailedAttempt();
      return reply.code(400).send(safeProblem(400, 'PAIR_INVALID', 'Pairing failed', 'Проверьте код и попробуйте ещё раз.'));
    }
    const suppliedHash = Buffer.from(sha256(parsed.data.code), 'hex');
    const expectedHash = Buffer.from(sha256(pairing.code), 'hex');
    if (Date.now() >= pairing.expiresAt) {
      recordFailedAttempt();
      return reply.code(410).send(safeProblem(410, 'PAIR_EXPIRED', 'Pairing expired', 'Получите новый код на локальной странице запуска.'));
    }
    if (!timingSafeEqual(suppliedHash, expectedHash)) {
      recordFailedAttempt();
      return reply.code(401).send(safeProblem(401, 'PAIR_INVALID', 'Pairing failed', 'Проверьте код и попробуйте ещё раз.'));
    }
    if (pairing.consumed) {
      return reply.code(409).send(safeProblem(409, 'PAIR_REUSED', 'Pairing unavailable', 'Запустите локальную страницу, чтобы создать новую сессию.'));
    }
    const token = randomBytes(32).toString('hex');
    pairing.consumed = true;
    try {
      await queryDatabase(
        'INSERT INTO peace_v2_sessions (token_hash, expires_at) VALUES ($1, now() + ($2 * interval \'1 millisecond\'))',
        [sha256(token), SESSION_TTL_MS]
      );
    } catch {
      pairing.consumed = false;
      return reply.code(503).send(safeProblem(503, 'V2_DB_UNAVAILABLE', 'Session unavailable', 'Не удалось сохранить сессию. Повторите после восстановления связи.'));
    }
    attempts.delete(peer);
    reply.header('set-cookie', `peace_v2_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_TTL_MS / 1000}`);
    reply.header('cache-control', 'no-store, private');
    return { status: 'paired' };
  });

  app.get('/api/session/status', async (request) => ({ paired: await ownerSession(request) }));

  app.get('/api/world/preview', async (_request, reply) => {
    try {
      return toPreview(await readWorld());
    } catch (error) {
      return sendWorldReadFailure(_request, reply, error);
    }
  });

  app.get<{ Params: { depositId: string } }>('/api/underground/route/:depositId', async (request, reply) => {
    if (!(await ownerSession(request))) return reply.code(401).send(safeProblem(401, 'SESSION_REQUIRED', 'Pair first', 'Подключите игру одноразовым кодом.'));
    try {
      const result = previewUndergroundRoute(await readWorld(), request.params.depositId);
      const details: Record<string, string> = {
        DEPOSIT_NOT_FOUND: 'Месторождение не найдено.', DEPOSIT_NOT_REVEALED: 'Месторождение ещё не разведано.',
        DEPOSIT_DEPLETED: 'Месторождение исчерпано.', DEPOSIT_NOT_ACCESSED: 'Сначала создайте доступный вход в шахту.',
        CELL_NOT_CONNECTED: 'Нет допустимого пути: проверьте владение сектором, породу и вертикальную связь.',
        INSUFFICIENT_MATERIALS: 'Для запланированных лестниц не хватает древесины на доступных складах.',
        DUPLICATE_JOB: 'Для этого месторождения уже выполняется план проходки.'
      };
      return result.ok ? result.value : reply.code(409).send({ code: result.reason, detail: details[result.reason] ?? 'Нельзя проложить этот маршрут.' });
    } catch (error) { return sendWorldReadFailure(request, reply, error); }
  });

  app.get('/api/world', async (request, reply) => {
    if (!(await ownerSession(request))) {
      return reply.code(401).send(safeProblem(401, 'SESSION_REQUIRED', 'Pair first', 'Подключите игру одноразовым кодом.'));
    }
    try {
      const world = await readWorld();
      return {
        ...world,
        undergroundCells: world.undergroundCells.map((cell) => cell.revealed || cell.state === 'tunnel'
          ? cell : { ...cell, geology: 'humus' as const }),
        undergroundDeposits: world.undergroundDeposits.filter((deposit) => deposit.revealed)
      };
    } catch (error) {
      return sendWorldReadFailure(request, reply, error);
    }
  });

  app.post('/api/placement/validate', async (request, reply) => {
    if (!(await ownerSession(request))) {
      return reply.code(401).send(safeProblem(401, 'SESSION_REQUIRED', 'Pair first', 'Подключите игру одноразовым кодом.'));
    }
    const body = CabinPlacementRequestSchema.safeParse(request.body);
    if (!body.success) {
      return reply.code(400).send(safeProblem(400, 'INVALID_COORDINATE', 'Место не распознано', 'Выберите клетку игровой сетки.'));
    }
    try {
      const world = await readWorld();
      const buildingKind = body.data.buildingKind ?? 'cabin';
      const placement = buildingKind === 'workshop'
        ? validateWorkshopOrderPlacement(world, body.data.anchor)
        : validateCabinOrderPlacement(world, body.data.anchor);
      const messages: Record<string, string> = {
        READY: 'Место подходит. После подтверждения заказ попадёт в очередь строительства.',
        WAITING_MATERIALS: buildingKind === 'workshop'
          ? `Недостаточно ресурсов: мастерская дождётся ${WORKSHOP_MATERIALS.wood} древесины и ${WORKSHOP_MATERIALS.stone} камня.`
          : `Недостаточно ресурсов: заказ дождётся ${WOOD_CABIN_COST} древесины.`,
        WAITING_WORK_POINT: 'Заказ будет ждать освобождения рабочей точки.',
        OUT_OF_WORLD: 'Клетка находится за границей доступного мира.',
        INVALID_SURFACE: 'Неподходящая поверхность для строительства.',
        NO_SUPPORT: 'Неподходящая поверхность: участку не хватает опоры.',
        NO_ENTRANCE: 'Нет прохода ко входу здания.',
        OCCUPIED: 'Занято другим зданием, складом или ресурсным объектом.',
        ROUTE_BLOCKED: 'Перекрывает действующий маршрут к складу или источнику.',
        NO_PATH: 'Нет прохода ко входу или рабочей точке здания.'
      };
      return { ...placement, revision: world.revision, detail: messages[placement.reason] ?? 'Это место недоступно.' };
    } catch (error) {
      return sendWorldReadFailure(request, reply, error);
    }
  });

  app.post('/api/commands', async (request, reply) => {
    if (!(await ownerSession(request))) {
      return reply.code(401).send(safeProblem(401, 'SESSION_REQUIRED', 'Pair first', 'Подключите игру одноразовым кодом.'));
    }
    const parsed = PeaceCommandSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send(safeProblem(400, 'INVALID_COMMAND', 'Action unavailable', 'Действие не распознано. Обновите мир и попробуйте снова.'));
    }
    const command = parsed.data;
    try {
      await tickSimulation();
    } catch (error) {
      request.log.error({
        requestId: command.requestId,
        commandKind: command.kind,
        errorName: error instanceof Error ? error.name : 'UnknownError',
        errorCode: typeof error === 'object' && error !== null && 'code' in error ? error.code : undefined,
        errorMessage: error instanceof Error ? error.message : String(error)
      }, 'V2 command simulation tick failed');
      return reply.code(503).send(safeProblem(503, 'V2_DB_UNAVAILABLE', 'World unavailable', 'Мир пока недоступен. Повторите после восстановления связи.', command.requestId));
    }
    const hash = sha256(JSON.stringify(command));
    return withDatabaseLock(async () => {
      try {
        await database.query('BEGIN');
        const result = await database.query<PersistedWorld>(
        'SELECT world_version, geometry_version, server_tick, last_simulated_at, state FROM peace_v2_world_state WHERE world_id = $1 FOR UPDATE',
        [WORLD_ID]
      );
      const row = result.rows[0];
      if (!row) {
        await database.query('ROLLBACK');
        return reply.code(503).send(safeProblem(503, 'WORLD_NOT_FOUND', 'World unavailable', 'Мир ещё не подготовлен.'));
      }
      const previous = await database.query<{ payload_hash: string; response: PeaceWorldSnapshot }>(
        'SELECT payload_hash, response FROM peace_v2_command_log WHERE request_id = $1',
        [command.requestId]
      );
      const saved = previous.rows[0];
      if (saved) {
        await database.query('COMMIT');
        if (saved.payload_hash !== hash) {
          return reply.code(409).send(safeProblem(409, 'REQUEST_ID_PAYLOAD_CONFLICT', 'Request conflict', 'Обновите мир перед повтором действия.', command.requestId));
        }
        return saved.response;
      }
      const current = parsePersistedWorld(row);
      // Simulation ticks advance worldVersion while residents walk/work. Commands
      // revalidate against the locked current world; only geometry must match the
      // client's placement snapshot. A future world version still indicates drift.
      if (command.expectedWorldVersion > current.revision.worldVersion) {
        await database.query('ROLLBACK');
        return reply.code(409).send(safeProblem(409, 'STALE_WORLD', 'World changed', 'Мир обновился. Загрузите его заново перед действием.', command.requestId));
      }
      if (command.expectedGeometryVersion !== current.revision.geometryVersion) {
        await database.query('ROLLBACK');
        return reply.code(409).send(safeProblem(409, 'STALE_GEOMETRY', 'Geometry changed',
          'Геометрия мира изменилась. Проверьте участок заново.', command.requestId));
      }
      let next = structuredClone(current);
      let deferClearingDispatch = false;
      const residentId = 'residentId' in command ? command.residentId : undefined;
      const resident = residentId ? next.residents.find((candidate) => candidate.id === residentId) : undefined;
      const requiresResident = command.kind === 'collect-wood' || command.kind === 'cancel-woodcutting' ||
        command.kind === 'uproot-stump' || command.kind === 'set-work-role' || command.kind === 'assign-resident' ||
        command.kind === 'assign-clear-worker' || command.kind === 'start-training' || command.kind === 'cancel-training';
      if (requiresResident && !resident) {
        await database.query('ROLLBACK');
        return reply.code(404).send(safeProblem(404, 'RESIDENT_NOT_FOUND', 'Resident unavailable',
          'Этот житель больше не найден в поселении.', command.requestId));
      }
      if (command.kind === 'unlock-sector') {
        await database.query('ROLLBACK');
        return reply.code(409).send(safeProblem(409, 'CELL_SELECTION_REQUIRED', 'Выберите клетки',
          'Для освоения необходимо выбрать от 1 до 5 клеток.', command.requestId));
      } else if (command.kind === 'expand-cells') {
        const allowScenarioOverride = process.env.AVANPOST_V2_DATABASE_OPERATION === 'manual' ||
          process.env.AVANPOST_V2_DATABASE_OPERATION === 'test';
        const result = startCellExpansion(next, command.sectorId, command.positions, allowScenarioOverride);
        if (!result.ok) {
          await database.query('ROLLBACK');
          const status = result.reason === 'SECTOR_NOT_FOUND' ? 404 : 409;
          return reply.code(status).send(safeProblem(status, result.reason, 'Расширение недоступно',
            result.reason === 'INSUFFICIENT_RESOURCES' ? 'В поселении недостаточно ресурсов для открытия участка.'
              : result.reason === 'MAX_EXPANSION_CELLS_EXCEEDED' ? `За один раз можно освоить не более ${MAX_EXPANSION_CELLS} клеток.`
                : result.reason === 'EXPANSION_NOT_CONNECTED' ? 'Сначала освойте соседнюю территорию.'
                : result.reason === 'CLEARING_ALREADY_ACTIVE' ? 'Сначала дождитесь завершения текущего цикла освоения.'
                  : result.reason === 'NO_CLEARING_WORKER' ? 'Сейчас нет свободного жителя для освоения выбранных клеток.'
                  : 'Выбранные клетки недоступны или участок не связан с освоенной территорией.', command.requestId));
        }
        deferClearingDispatch = true;
        next.revision.geometryVersion += 1;
      } else if (command.kind === 'clear-cell') {
        const allowScenarioOverride = process.env.AVANPOST_V2_DATABASE_OPERATION === 'manual' ||
          process.env.AVANPOST_V2_DATABASE_OPERATION === 'test';
        const result = startCellExpansion(next, command.sectorId, [command.position], allowScenarioOverride);
        if (!result.ok) {
          await database.query('ROLLBACK');
          const status = result.reason === 'SECTOR_NOT_FOUND' ? 404 : 409;
          return reply.code(status).send(safeProblem(status, result.reason, 'Расчистка недоступна',
            result.reason === 'EXPANSION_NOT_CONNECTED' ? 'Сначала освойте соседнюю территорию.'
              : result.reason === 'NO_CLEARING_WORKER' ? 'Сейчас нет свободного жителя, который может взяться за участок.'
              : result.reason === 'NO_PATH_TO_CLEARING_SITE' ? 'Житель не может пройти к этому участку.'
                : 'Выбранную клетку нельзя расчистить сейчас.', command.requestId));
        }
        deferClearingDispatch = true;
        next.revision.geometryVersion += 1;
      } else if (command.kind === 'assign-clear-worker') {
        const result = assignClearingJobToResident(next, command.jobId, resident!.id);
        if (!result.ok) {
          await database.query('ROLLBACK');
          const status = result.reason === 'CLEARING_JOB_NOT_FOUND' || result.reason === 'RESIDENT_NOT_FOUND' ? 404 : 409;
          const detail = result.reason === 'CLEARING_WORKER_BUSY'
            ? `${resident!.name} должен завершить текущую работу или доставить груз перед расчисткой.`
            : result.reason === 'NO_PATH_TO_CLEARING_SITE' ? 'У этого жителя нет доступного маршрута к препятствию.'
              : 'Эту задачу расчистки больше нельзя назначить.';
          return reply.code(status).send(safeProblem(status, result.reason, 'Назначение расчистки недоступно', detail, command.requestId));
        }
      } else if (command.kind === 'excavate-cells') {
        const result = queueExcavation(next, command.positions);
        if (!result.ok) {
          await database.query('ROLLBACK');
          const detail: Record<string, string> = {
            INVALID_BATCH: 'Выберите от 1 до 5 уникальных клеток за один цикл.',
            CELL_NOT_FOUND: 'Клетка не входит в сгенерированную геологию.',
            SECTOR_NOT_OWNED: 'Сначала откройте сектор над этим участком.',
            INSUFFICIENT_MATERIALS: 'Для открытия следующего уровня не хватает дерева или камня.',
            CELL_ALREADY_TUNNEL: 'Эта клетка уже выработана.',
            CELL_NOT_CONNECTED: 'Выбранный участок не соединён с существующей выработкой или входом.',
            DUPLICATE_JOB: 'На этой клетке уже назначена работа.',
            NO_WORKER: 'Нет свободного жителя для проходки.'
          };
          return reply.code(409).send(safeProblem(409, result.reason, 'Проходка недоступна', detail[result.reason] ?? 'Выберите доступные клетки.', command.requestId));
        }
      } else if (command.kind === 'mine-underground') {
        const result = queueUndergroundMining(next, command.depositId);
        if (!result.ok) {
          await database.query('ROLLBACK');
          const detail: Record<string, string> = {
            DEPOSIT_NOT_FOUND: 'Месторождение не найдено.', DEPOSIT_NOT_REVEALED: 'Месторождение ещё не разведано.',
            DEPOSIT_DEPLETED: 'Месторождение исчерпано.', DEPOSIT_NOT_ACCESSED: 'Нет доступной рабочей позиции рядом с породой. Проложите путь к месторождению.',
            DUPLICATE_JOB: 'На месторождении уже работает житель.', NO_WORKER: 'Нет свободного жителя для добычи.'
          };
          return reply.code(409).send(safeProblem(409, result.reason, 'Добыча недоступна', detail[result.reason] ?? 'Выберите доступное месторождение.', command.requestId));
        }
      } else if (command.kind === 'plan-underground-route') {
        const result = queueUndergroundRoute(next, command.depositId);
        if (!result.ok) {
          await database.query('ROLLBACK');
          return reply.code(409).send(safeProblem(409, result.reason, 'Маршрут недоступен', 'Проверьте доступность месторождения и откройте разведанный путь.', command.requestId));
        }
      } else if (command.kind === 'cancel-underground-plan') {
        const result = cancelUndergroundRoute(next, command.planId);
        if (!result.ok) {
          await database.query('ROLLBACK');
          return reply.code(404).send(safeProblem(404, result.reason, 'План не найден', 'Этот план проходки уже завершён или отменён.', command.requestId));
        }
      } else if (command.kind === 'build-ladder') {
        const result = createLadder(next, command.x, command.depth, command.residentId, command.topDepth);
        if (!result.ok) {
          await database.query('ROLLBACK');
          const detail: Record<string, string> = {
            NO_WORKER: 'Выберите свободного жителя без груза.', INSUFFICIENT_MATERIALS: 'На доступных складах не хватает древесины для лестницы.',
            NO_PATH_TO_LADDER_SITE: 'Строитель не может физически добраться до точки лестницы.',
            DEPOSIT_NOT_ACCESSED: 'Лестница должна соединяться с выработанным тоннелем.',
            CELL_NOT_CONNECTED: 'На поверхности нет доступной клетки входа.'
          };
          return reply.code(409).send(safeProblem(409, result.reason, 'Строительство лестницы недоступно', detail[result.reason] ?? 'Проверьте выбранный вход и участок.', command.requestId));
        }
      } else if (command.kind === 'demolish-ladder') {
        const result = demolishLadder(next, command.ladderId);
        if (!result.ok) {
          await database.query('ROLLBACK');
          const status = result.reason === 'LADDER_IN_USE' ? 409 : 404;
          return reply.code(status).send(safeProblem(status, result.reason, 'Снос лестницы недоступен',
            result.reason === 'LADDER_IN_USE' ? 'Житель окажется отрезан от поверхности; дождитесь его возврата или постройте другой переход.'
              : 'Эта лестница не найдена.', command.requestId));
        }
      } else if (command.kind === 'collect-wood') {
        const actor = resident!;
        if (actor.task) {
          if (actor.task.kind !== 'gather-wood' || actor.task.assignmentSource !== 'profession') {
            await database.query('ROLLBACK');
            return reply.code(409).send(safeProblem(409, 'WORKER_BUSY', 'Resident busy', `${actor.name} уже выполняет ручное поручение или стройку.`, command.requestId));
          }
          if (actor.cargo > 0) {
            actor.task.id = `manual-task-${command.requestId}`;
            actor.task.assignmentSource = 'manual';
            actor.task.continuous = true;
            actor.task.cancelAfterDelivery = false;
            if (command.sourceId) actor.task.sourceId = command.sourceId;
          } else {
            setResidentTask(actor, null);
          }
        }
        if (actor.cargo > 0) {
          if (actor.task?.kind === 'gather-wood' && actor.task.assignmentSource === 'manual') {
            // The carried log stays on its saved storage route; the manual order takes effect after it unloads.
          } else {
            await database.query('ROLLBACK');
            return reply.code(409).send(safeProblem(409, 'CARGO_NOT_EMPTY', 'Resident carrying wood', `${actor.name} доставит уже поднятое бревно на склад.`, command.requestId));
          }
        } else {
          const task = createGatherWoodTask(next, actor.id, `task-${command.requestId}`, command.sourceId, 'manual');
          if (!task) {
            await database.query('ROLLBACK');
            return reply.code(409).send(safeProblem(409, 'WORKER_BUSY', 'Resident unavailable', `${actor.name} не может принять это поручение.`, command.requestId));
          }
          setResidentTask(actor, task);
        }
      } else if (command.kind === 'cancel-woodcutting') {
        const actor = resident!;
        if (actor.task && actor.task.kind !== 'gather-wood') {
          await database.query('ROLLBACK');
          return reply.code(409).send(safeProblem(409, 'WORKER_BUSY', 'Resident busy', `${actor.name} занят другой работой.`, command.requestId));
        }
        const task = actor.task;
        if (task?.kind === 'gather-wood') {
          if (task.assignmentSource === 'profession' && actor.workRole === 'woodcutter') actor.workRole = 'none';
          if (actor.cargo > 0) {
            task.continuous = false;
            task.cancelAfterDelivery = true;
          } else {
            setResidentTask(actor, null);
          }
        }
      } else if (command.kind === 'uproot-stump') {
        const actor = resident!;
        if (actor.task) {
          await database.query('ROLLBACK');
          return reply.code(409).send(safeProblem(409, 'WORKER_BUSY', 'Resident busy', `${actor.name} сначала должен закончить текущее поручение.`, command.requestId));
        }
        if (actor.cargo > 0) {
          await database.query('ROLLBACK');
          return reply.code(409).send(safeProblem(409, 'CARGO_NOT_EMPTY', 'Resident carrying wood', `${actor.name} сначала должен разгрузить бревно.`, command.requestId));
        }
        const stump = next.trees.find((tree) => tree.id === command.treeId);
        if (!stump || stump.state !== 'stump' || stump.remaining > 0) {
          await database.query('ROLLBACK');
          return reply.code(422).send(safeProblem(422, 'RESOURCE_MISSING', 'Stump unavailable', 'Выкорчевать можно только существующий пень.', command.requestId));
        }
        stump.state = 'uprooted';
        stump.regrowthProgressTicks = 0;
        next.revision.geometryVersion += 1;
      } else if (command.kind === 'assign-resident') {
        const actor = resident!;
        const target = command.target;
        if (target.kind === 'tree') {
          const tree = next.trees.find((candidate) => candidate.id === target.sourceId);
          if (!tree || tree.state !== 'standing' || tree.remaining < 1) {
            await database.query('ROLLBACK');
            return reply.code(422).send(safeProblem(422, 'RESOURCE_MISSING', 'Tree unavailable',
              'На выбранном дереве нет доступной древесины.', command.requestId));
          }
          if (actor.task || actor.cargo > 0) {
            await database.query('ROLLBACK');
            return reply.code(409).send(safeProblem(409, actor.cargo > 0 ? 'CARGO_NOT_EMPTY' : 'WORKER_BUSY',
              'Resident unavailable', `${actor.name} должен безопасно завершить текущую работу или доставить груз.`, command.requestId));
          }
          const task = createGatherWoodTask(next, actor.id, `assign-tree-${command.requestId}`, tree.id, 'profession');
          if (!task) {
            await database.query('ROLLBACK');
            return reply.code(409).send(safeProblem(409, 'WORKER_BUSY', 'Tree unavailable',
              'Житель не может добраться до выбранного дерева.', command.requestId));
          }
          actor.workRole = 'woodcutter';
          setResidentTask(actor, task);
        } else if (target.kind === 'stone-deposit') {
          const deposit = next.stoneDeposits.find((candidate) => candidate.id === target.sourceId);
          if (!deposit || deposit.remaining < 1 && deposit.bufferQuantity < 1) {
            await database.query('ROLLBACK');
            return reply.code(422).send(safeProblem(422, 'RESOURCE_MISSING', 'Stone deposit unavailable',
              'В выбранном месторождении больше нет доступного камня.', command.requestId));
          }
          if (actor.task && actor.task.kind !== 'gather-wood' && actor.task.kind !== 'gather-stone') {
            await database.query('ROLLBACK');
            return reply.code(409).send(safeProblem(409, 'WORKER_BUSY', 'Resident unavailable',
              `${actor.name} уже выполняет строительный заказ.`, command.requestId));
          }
          if (actor.task?.kind === 'gather-wood') {
            if (actor.cargo > 0) {
              actor.task.continuous = false;
              actor.task.cancelAfterDelivery = true;
            } else {
              setResidentTask(actor, null);
            }
          }
          actor.workRole = STONE_MINER_ROLE;
        } else if (target.kind === 'storage') {
          const storage = next.storages?.find((candidate) => candidate.id === target.storageId);
          if (!storage || actor.task || actor.cargo > 0) {
            await database.query('ROLLBACK');
            return reply.code(storage ? 409 : 404).send(safeProblem(storage ? 409 : 404,
              storage ? 'WORKER_BUSY' : 'STORAGE_NOT_FOUND', storage ? 'Resident unavailable' : 'Warehouse unavailable',
              storage ? `${actor.name} должен завершить текущую работу перед назначением на склад.` : 'Этот склад больше не существует.', command.requestId));
          }
          actor.workRole = 'hauler';
          actor.preferredStorageId = storage.id;
          actor.preferredHaulSourceId = null;
        } else {
          const order = next.buildOrders.find((candidate) => candidate.id === target.orderId);
          const building = order ? next.buildings.find((candidate) => candidate.id === order.buildingId) : undefined;
          if (!order || !building || ['completed', 'cancelled', 'blocked'].includes(order.status)) {
            await database.query('ROLLBACK');
            return reply.code(404).send(safeProblem(404, 'BUILD_ORDER_NOT_FOUND', 'Order unavailable',
              'Эта строительная площадка больше не принимает строителя.', command.requestId));
          }
          if (order.assignedResidentId && order.assignedResidentId !== actor.id) {
            await database.query('ROLLBACK');
            return reply.code(409).send(safeProblem(409, 'WORKER_BUSY', 'Order already assigned',
              'У этой площадки уже есть назначенный строитель.', command.requestId));
          }
          const carriesStoneToBuild = actor.cargo > 0 && actor.cargoItemId === 'stone' && actor.task?.kind === 'gather-stone';
          if ((actor.cargo > 0 && actor.cargoItemId !== 'wood' && !carriesStoneToBuild) ||
              actor.task && actor.task.kind !== 'gather-wood' &&
                !(actor.task.kind === 'gather-stone' && actor.cargo === 0) && !carriesStoneToBuild) {
            await database.query('ROLLBACK');
            return reply.code(409).send(safeProblem(409, 'WORKER_BUSY', 'Resident unavailable',
              `${actor.name} должен безопасно завершить текущую работу или доставить груз.`, command.requestId));
          }
          if (actor.task?.kind === 'gather-wood' && actor.cargo === 0) setResidentTask(actor, null);
          if (actor.task?.kind === 'gather-stone') setResidentTask(actor, null);
          if (actor.task?.kind === 'gather-wood' && actor.cargo > 0) {
            actor.task.continuous = false;
            actor.task.cancelAfterDelivery = true;
          }
          actor.workRole = 'builder';
          order.requiresExplicitBuilder = false;
          order.assignedResidentId = actor.id;
          if (order.status === 'waiting_builder') order.blockedReason = null;
        }
      } else if (command.kind === 'set-work-role') {
        const actor = resident!;
        if (actor.workRole !== command.workRole) {
          actor.workRole = command.workRole;
          if (actor.task?.kind === 'gather-wood' && actor.task.assignmentSource === 'profession' &&
              command.workRole !== 'woodcutter') {
            if (actor.cargo > 0) {
              actor.task.continuous = false;
              actor.task.cancelAfterDelivery = true;
            } else {
              setResidentTask(actor, null);
            }
          }
          if (actor.task?.kind === 'gather-stone' && command.workRole !== STONE_MINER_ROLE) {
            if (actor.cargo > 0) {
              actor.task.continuous = false;
              actor.task.cancelAfterDelivery = true;
            } else {
              setResidentTask(actor, null);
            }
          }
        }
      } else if (command.kind === 'move-build-order') {
        const order = next.buildOrders.find((candidate) => candidate.id === command.orderId);
        if (!order) {
          await database.query('ROLLBACK');
          return reply.code(404).send(safeProblem(404, 'BUILD_ORDER_NOT_FOUND', 'Order unavailable',
            'Этот заказ больше не найден.', command.requestId));
        }
        if (!moveBuildOrder(next, command.orderId, command.direction)) {
          await database.query('ROLLBACK');
          return reply.code(409).send(safeProblem(409, 'BUILD_ORDER_NOT_EDITABLE', 'Order is not waiting',
            'Приоритет можно менять только у ожидающих заказов.', command.requestId));
        }
      } else if (command.kind === 'cancel-build-order') {
        const order = next.buildOrders.find((candidate) => candidate.id === command.orderId);
        if (!order) {
          await database.query('ROLLBACK');
          return reply.code(404).send(safeProblem(404, 'BUILD_ORDER_NOT_FOUND', 'Order unavailable',
            'Этот заказ больше не найден.', command.requestId));
        }
        if (!cancelUnstartedBuildOrder(next, command.orderId)) {
          await database.query('ROLLBACK');
          return reply.code(409).send(safeProblem(409, 'BUILD_ORDER_NOT_EDITABLE', 'Order already started',
            'Заказ нельзя безопасно отменить в текущем состоянии.', command.requestId));
        }
      } else if (command.kind === 'demolish-building') {
        const result = demolishBuilding(next, command.buildingId);
        if (!result.valid) {
          await database.query('ROLLBACK');
          const status = result.reason === 'BUILDING_NOT_FOUND' ? 404 : 409;
          const detail: Record<string, string> = {
            BUILDING_NOT_FOUND: 'Эта постройка больше не найдена.',
            BUILDING_NOT_COMPLETE: 'Сносить можно только завершённую постройку.',
            BUILDING_HAS_MATERIALS: 'Сначала безопасно верните материалы со стройплощадки.',
            BUILDING_IN_USE: 'Постройка участвует в работе или перевозке и пока не может быть снесена.'
          };
          return reply.code(status).send(safeProblem(status, result.reason, 'Снос недоступен', detail[result.reason] ?? 'Эту постройку пока нельзя снести.', command.requestId));
        }
      } else if (command.kind === 'demolish-storage') {
        const result = demolishStorage(next, command.storageId);
        if (!result.valid) {
          await database.query('ROLLBACK');
          const status = result.reason === 'STORAGE_NOT_FOUND' ? 404 : 409;
          const detail: Record<string, string> = {
            STORAGE_NOT_FOUND: 'Этот склад больше не найден.',
            STORAGE_NOT_EMPTY: 'Сначала вывезите запасы и завершите все резервации.',
            STORAGE_IN_USE: 'Склад сейчас нужен перевозке или рабочей задаче.',
            LAST_STORAGE: 'Нельзя снести последний склад поселения.'
          };
          return reply.code(status).send(safeProblem(status, result.reason, 'Снос склада недоступен', detail[result.reason] ?? 'Этот склад пока нельзя снести.', command.requestId));
        }
      } else if (command.kind === 'build-workshop') {
        const queuePosition = Math.max(next.nextBuildOrderSequence,
          ...next.buildOrders.map((order) => order.queuePosition + 1));
        const placement = createBuildWorkshopOrder(next, `order-${command.requestId}`,
          `workshop-${command.requestId}`, command.anchor, queuePosition);
        if (!placement) {
          await database.query('ROLLBACK');
          const invalidPlacement = validateWorkshopOrderPlacement(current, command.anchor);
          const status = ['OUT_OF_WORLD', 'INVALID_SURFACE', 'NO_SUPPORT', 'NO_ENTRANCE'].includes(invalidPlacement.reason) ? 422 : 409;
          const detailByReason: Record<string, string> = {
            OUT_OF_WORLD: 'Выбранный участок находится за границей доступного мира.',
            INVALID_SURFACE: 'Мастерскую можно ставить только на поверхности.',
            NO_SUPPORT: 'Неподходящая поверхность: мастерской не хватает опоры.',
            NO_ENTRANCE: 'Нет прохода ко входу мастерской.',
            OCCUPIED: 'Выбранный участок уже занят деревом, залежью или другой постройкой.',
            ROUTE_BLOCKED: 'Размещение перекрывает действующий маршрут к ресурсу или складу.',
            NO_PATH: 'К участку нет маршрута для строителя.'
          };
          return reply.code(status).send(safeProblem(status, invalidPlacement.reason, 'Строительство недоступно',
            detailByReason[invalidPlacement.reason] ?? 'Выберите другое место.', command.requestId));
        }
        next.buildOrders.push(placement.order);
        next.buildings.push(placement.building);
        next.nextBuildOrderSequence = queuePosition + 1;
        next.revision.geometryVersion += 1;
      } else if (command.kind === 'build-school') {
        const queuePosition = Math.max(next.nextBuildOrderSequence,
          ...next.buildOrders.map((order) => order.queuePosition + 1));
        const created = createBuildSchoolOrder(next, command.schoolId, `order-${command.requestId}`,
          `school-${command.schoolId}-${command.requestId}`, command.anchor, queuePosition);
        if (!created) {
          await database.query('ROLLBACK');
          return reply.code(409).send(safeProblem(409, 'SCHOOL_PLACEMENT_INVALID', 'Строительство недоступно',
            'На этом участке нельзя построить школу. Проверьте опору, доступ и свободный проход.', command.requestId));
        }
        next.buildOrders.push(created.order);
        next.buildings.push(created.building);
        next.nextBuildOrderSequence = queuePosition + 1;
        next.revision.geometryVersion += 1;
      } else if (command.kind === 'start-training') {
        const started = startG72Training(next, command.residentId, command.schoolId, command.buildingId);
        if (!started.ok) {
          await database.query('ROLLBACK');
          const messages: Record<string, string> = {
            RESIDENT_BUSY: 'Житель должен безопасно завершить текущую работу перед обучением.',
            CARGO_NOT_EMPTY: 'Житель несёт груз. Сначала завершите доставку или верните его на склад.',
            SCHOOL_NOT_COMPLETE: 'Школа ещё не построена.',
            SCHOOL_INACCESSIBLE: 'К школе нет действующего доступа.',
            NO_PATH: 'До школы нет наземного маршрута.',
            SCHOOL_ALREADY_COMPLETED: 'Этот житель уже прошёл эту школу.',
            FOURTH_SCHOOL_NOT_ALLOWED: 'Каталог не содержит четвёртой школьной ступени.',
            PREREQUISITE_NOT_MET: 'Предыдущая профессия не подходит для этого рецепта.',
            INSUFFICIENT_TRAINING_MATERIALS: 'В школе не хватает доставленных учебных материалов.',
            SCHOOL_FULL: 'Очередь школы заполнена.'
          };
          return reply.code(409).send(safeProblem(409, started.reason, 'Обучение недоступно',
            messages[started.reason] ?? 'Проверьте жителя, школу и доступный рецепт.', command.requestId));
        }
      } else if (command.kind === 'cancel-training') {
        if (!cancelG72Training(next, command.residentId)) {
          await database.query('ROLLBACK');
          return reply.code(409).send(safeProblem(409, 'TRAINING_NOT_ACTIVE', 'Нечего отменять',
            'У выбранного жителя нет активного обучения.', command.requestId));
        }
      } else if (command.kind === 'build-cabin') {
        const queuePosition = Math.max(next.nextBuildOrderSequence,
          ...next.buildOrders.map((order) => order.queuePosition + 1));
        const placement = createBuildCabinOrder(next, `order-${command.requestId}`, `cabin-${command.requestId}`,
          command.anchor, queuePosition);
        if (!placement) {
          await database.query('ROLLBACK');
          const invalidPlacement = validateCabinOrderPlacement(current, command.anchor);
          const status = ['OUT_OF_WORLD', 'INVALID_SURFACE', 'NO_SUPPORT', 'NO_ENTRANCE'].includes(invalidPlacement.reason) ? 422 : 409;
          const detailByReason: Record<string, string> = {
            RESOURCE_MISSING: `Для дома нужно ${WOOD_CABIN_COST} брёвна.`,
            OUT_OF_WORLD: 'Выбранный участок находится за границей доступного мира.',
            INVALID_SURFACE: 'Дом можно ставить только на поверхности.',
            NO_SUPPORT: 'Неподходящая поверхность: дому не хватает опоры.',
            NO_ENTRANCE: 'Нет прохода ко входу дома.',
            OCCUPIED: 'Выбранный участок уже занят или мешает дереву.',
            ROUTE_BLOCKED: 'Размещение перекрывает действующий маршрут к ресурсу или складу.',
            NO_PATH: 'К участку нет маршрута для строителя.'
          };
          return reply.code(status).send(safeProblem(status, invalidPlacement.reason, 'Строительство недоступно',
            detailByReason[invalidPlacement.reason] ?? 'Выберите другое место.', command.requestId));
        }
        next.buildOrders.push(placement.order);
        next.buildings.push(placement.building);
        next.nextBuildOrderSequence = queuePosition + 1;
        next.revision.geometryVersion += 1;
      }
      scheduleWorkOrders(next, { scheduleClearing: !deferClearingDispatch });
      next.revision.worldVersion += 1;
      next = PeaceWorldSnapshotSchema.parse(next);
      if (next.revision.geometryVersion !== current.revision.geometryVersion) {
        await replaceWorldOccupiedCells(database, WORLD_ID, next);
      }
      await database.query(
        `UPDATE peace_v2_world_state
         SET world_version = $2, geometry_version = $3, state = $4::jsonb, state_schema_version = $5, updated_at = now()
         WHERE world_id = $1`,
        [WORLD_ID, next.revision.worldVersion, next.revision.geometryVersion, stateJson(next), PEACE_WORLD_SCHEMA_VERSION]
      );
      await database.query(
        'INSERT INTO peace_v2_command_log (request_id, payload_hash, response) VALUES ($1, $2, $3::jsonb)',
        [command.requestId, hash, JSON.stringify(next)]
      );
      await database.query('COMMIT');
      return next;
      } catch (error) {
        await database.query('ROLLBACK').catch(() => undefined);
        if (error instanceof OccupiedCellsConflictError ||
            typeof error === 'object' && error !== null && 'code' in error && error.code === '23505') {
          return reply.code(409).send(safeProblem(409, 'OCCUPIED', 'Участок занят',
            'Эти клетки уже заняты или зарезервированы другой постройкой. Выберите другой участок.', command.requestId));
        }
        if (error instanceof V2WorldStateError) {
          request.log.error({ code: error.code, worldId: WORLD_ID }, 'Persisted V2 world state is unavailable');
          return reply.code(503).send(safeProblem(
            503,
            error.code,
            'World data unavailable',
            'Сохранённое состояние мира недоступно. Обратитесь к владельцу запуска.',
            command.requestId
          ));
        }
        request.log.error({
          requestId: command.requestId,
          commandKind: command.kind,
          errorName: error instanceof Error ? error.name : 'UnknownError',
          errorCode: typeof error === 'object' && error !== null && 'code' in error ? error.code : undefined,
          errorMessage: error instanceof Error ? error.message : String(error)
        }, 'V2 command transaction failed');
        return reply.code(503).send(safeProblem(503, 'V2_DB_UNAVAILABLE', 'Action not saved', 'Действие не сохранено. Обновите мир перед повтором.', command.requestId));
      }
    });
  });

  return Object.assign(app, { tickSimulation, startSimulation });
}

export function createV2HandoffServer(config: V2Config, pairing: V2PairingCredentials) {
  const app = Fastify({ logger: false, trustProxy: false });
  const allowedOrigins = uiOrigins(config);
  app.addHook('onRequest', async (request, reply) => {
    const origin = request.headers.origin;
    if (!origin || !allowedOrigins.has(origin)) {
      return reply.code(403).send(safeProblem(403, 'ORIGIN_REJECTED', 'Request unavailable', 'Этот источник не разрешён для локальной передачи кода.'));
    }
    reply.header('access-control-allow-origin', origin)
      .header('access-control-allow-methods', 'GET, OPTIONS')
      .header('access-control-allow-headers', 'accept')
      .header('access-control-max-age', '300')
      .header('vary', 'Origin');
    if (request.method === 'OPTIONS') return reply.code(204).send();
  });
  app.get('/api/launcher/pairing-code', async (request, reply) => {
    const peer = request.raw.socket.remoteAddress ?? request.ip;
    if (!isLoopbackAddress(peer) || !requestHostMatches(request, config, config.handoffPort, true) ||
        !requestOriginMatchesHost(request, config)) {
      return reply.code(404).send(safeProblem(404, 'WORLD_NOT_FOUND', 'Not found', 'Локальная страница запуска недоступна.'));
    }
    if (Date.now() >= pairing.expiresAt || pairing.consumed) renewV2PairingCredentials(pairing);
    reply.header('cache-control', 'no-store, private');
    return { code: pairing.code };
  });
  return app;
}
