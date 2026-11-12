import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import Fastify, { type FastifyRequest } from 'fastify';
import {
  CabinPlacementRequestSchema,
  ensurePhysicalStorageSnapshot,
  GlobalCoordinateSchema,
  PairingRequestSchema,
  PeaceCommandSchema,
  MAX_EXPANSION_CELLS,
  normalizeLegacyPeaceWorldSnapshot,
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
  WORKSHOP_MATERIALS,
  PROPOSED_WAREHOUSE_BALANCE
} from '@avanpost/peace-v2-sim';
import type { V2Config } from './config.js';
import { OccupiedCellsConflictError, replaceWorldOccupiedCells } from './database/occupancy.js';
import { createLiteGuest, LITE_SESSION_TTL_MS, resolveLiteSession, type LiteSessionContext } from './lite-identity.js';
import { deliverLiteMagicLink } from './lite-email.js';

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
    const world = ensurePopulationState(ensureUndergroundWorld(ensureTerritoryWorld(parseWorld(row))));
    // Validate physical legacy projections at the load boundary while V2 remains
    // authoritative. This is compatibility validation, not persisted Lite ledger state.
    normalizeLegacyPeaceWorldSnapshot(world);
    return world;
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
  const app = Fastify({
    logger: {
      level: 'error',
      redact: { paths: ['req.url', 'req.headers.cookie', 'res.headers.set-cookie'], censor: '[REDACTED]' }
    },
    trustProxy: false,
    bodyLimit: 16 * 1024
  });
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
    // Reject malformed physical projections before they are committed to JSONB.
    normalizeLegacyPeaceWorldSnapshot(world);
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

  async function tickSimulation(now: number | Date = Date.now(), worldId = WORLD_ID): Promise<void> {
    const nowMs = now instanceof Date ? now.getTime() : now;
    await withDatabaseLock(async () => {
      await database.query('BEGIN');
      try {
        const result = await database.query<PersistedWorld>(
          'SELECT world_version, geometry_version, server_tick, last_simulated_at, state FROM peace_v2_world_state WHERE world_id = $1 FOR UPDATE',
           [worldId]
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
          await replaceWorldOccupiedCells(database, worldId, next);
        }
        await database.query(
          `UPDATE peace_v2_world_state
           SET world_version = $2, geometry_version = $3, server_tick = $4, state = $5::jsonb,
                   last_simulated_at = $6, state_schema_version = $7, updated_at = now()
           WHERE world_id = $1`,
          [worldId, next.revision.worldVersion, next.revision.geometryVersion, next.revision.serverTick,
             stateJson(next), simulatedThrough(row.last_simulated_at, ticks, nowMs), PEACE_WORLD_SCHEMA_VERSION]
        );
        await database.query('COMMIT');
      } catch (error) {
        await database.query('ROLLBACK').catch(() => undefined);
        throw error;
      }
    });
  }

  async function tickAllWorlds(now: number | Date = Date.now()): Promise<void> {
    await tickSimulation(now, WORLD_ID);
    const worlds = await queryDatabase<{ id: string }>(
      `SELECT DISTINCT world.id
         FROM peace_v2_lite_worlds AS world
         JOIN peace_v2_lite_world_memberships AS membership
           ON membership.world_id = world.id AND membership.revoked_at IS NULL
         JOIN peace_v2_lite_sessions AS session
           ON session.account_id = membership.account_id AND session.revoked_at IS NULL
        WHERE world.status = 'active' AND session.expires_at > now()
          AND session.last_seen_at > now() - interval '10 seconds'
        ORDER BY world.id
        LIMIT 100`
    );
    for (const world of worlds.rows) await tickSimulation(now, world.id);
  }

  function startSimulation(): void {
    if (simulationTimer) return;
    const runScheduledTick = (): void => {
      if (simulationInFlight) return;
      simulationInFlight = (async () => {
        try {
          await tickAllWorlds();
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
      .header('access-control-allow-methods', 'GET, POST, DELETE, OPTIONS')
      .header('access-control-allow-headers', 'content-type, accept')
      .header('access-control-max-age', '300')
      .header('vary', 'Origin');
    if (request.method === 'OPTIONS') return reply.code(204).send();
  });

  async function readWorld(worldId = WORLD_ID): Promise<PeaceWorldSnapshot> {
    await tickSimulation(Date.now(), worldId);
    const result = await queryDatabase<PersistedWorld>(
      'SELECT world_version, geometry_version, server_tick, last_simulated_at, state FROM peace_v2_world_state WHERE world_id = $1',
      [worldId]
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

  function sendWorldReadFailure(request: FastifyRequest, reply: any, error: unknown, worldId = WORLD_ID) {
    if (error instanceof V2WorldStateError) {
      request.log.error({ code: error.code, worldId }, 'Persisted V2 world state is unavailable');
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

  function sessionToken(request: FastifyRequest, cookieName: string): string | null {
    const sessionCookie = request.headers.cookie?.split(';')
      .map((part) => part.trim())
      .find((part) => part.startsWith(`${cookieName}=`));
    return sessionCookie?.slice(cookieName.length + 1) ?? null;
  }

  async function liteSession(request: FastifyRequest): Promise<LiteSessionContext | null> {
    const token = sessionToken(request, 'peace_lite_session');
    if (!token) return null;
    return resolveLiteSession({ query: queryDatabase }, token);
  }

  async function requestWorldId(request: FastifyRequest): Promise<string | null> {
    const lite = await liteSession(request);
    if (lite) return lite.worldId;
    const token = sessionToken(request, 'peace_v2_session');
    if (!token) return null;
    const tokenHash = sha256(token);
    const session = await queryDatabase<{ valid: boolean }>(
      'SELECT EXISTS (SELECT 1 FROM peace_v2_sessions WHERE token_hash = $1 AND expires_at > now()) AS valid',
      [tokenHash]
    );
    return session.rows[0]?.valid === true ? WORLD_ID : null;
  }

  async function ownerSession(request: FastifyRequest): Promise<boolean> {
    return (await requestWorldId(request)) !== null;
  }

  app.get('/api/worlds', async (request, reply) => {
    const context = await liteSession(request);
    if (!context) return reply.code(401).send(safeProblem(401, 'SESSION_REQUIRED', 'Sign in required', 'Сессия недоступна.'));
    const worlds = await queryDatabase<{ worldId: string; role: 'owner' | 'editor' | 'viewer' }>(
      `SELECT world.id AS "worldId", membership.role
         FROM peace_v2_lite_world_memberships AS membership
         JOIN peace_v2_lite_worlds AS world ON world.id = membership.world_id
        WHERE membership.account_id = $1 AND membership.revoked_at IS NULL AND world.status = 'active'
        ORDER BY (world.id = $2) DESC, world.created_at`,
      [context.accountId, context.worldId]
    );
    return { currentWorldId: context.worldId, worlds: worlds.rows };
  });

  app.post<{ Params: { worldId: string } }>('/api/worlds/:worldId/select', async (request, reply) => {
    const token = sessionToken(request, 'peace_lite_session');
    const context = await liteSession(request);
    if (!context || !token) return reply.code(401).send(safeProblem(401, 'SESSION_REQUIRED', 'Sign in required', 'Сессия недоступна.'));
    const selected = await queryDatabase<{ role: 'owner' | 'editor' | 'viewer' }>(
      `UPDATE peace_v2_lite_sessions AS session SET current_world_id = $3, last_seen_at = now()
        WHERE session.token_hash = $1 AND session.account_id = $2 AND session.revoked_at IS NULL
          AND session.expires_at > now()
          AND EXISTS (SELECT 1 FROM peace_v2_lite_world_memberships AS membership
                       JOIN peace_v2_lite_worlds AS world ON world.id = membership.world_id
                      WHERE membership.world_id = $3 AND membership.account_id = $2
                        AND membership.revoked_at IS NULL AND world.status = 'active')
      RETURNING (SELECT role FROM peace_v2_lite_world_memberships
                  WHERE world_id = $3 AND account_id = $2 AND revoked_at IS NULL) AS role`,
      [sha256(token), context.accountId, request.params.worldId]
    );
    const role = selected.rows[0]?.role;
    if (!role) return reply.code(403).send(safeProblem(403, 'WORLD_ACCESS_DENIED', 'World unavailable', 'У вас нет доступа к этому поселению.'));
    return { worldId: request.params.worldId, role };
  });

  app.post<{ Params: { worldId: string } }>('/api/worlds/:worldId/invites', async (request, reply) => {
    const context = await liteSession(request);
    if (!context) return reply.code(401).send(safeProblem(401, 'SESSION_REQUIRED', 'Sign in required', 'Сессия недоступна.'));
    if (context.worldId !== request.params.worldId || context.role !== 'owner') {
      return reply.code(403).send(safeProblem(403, 'OWNER_REQUIRED', 'Owner permission required', 'Приглашать участников может только владелец поселения.'));
    }
    const body = request.body as { role?: unknown } | null;
    const invitedRole = body?.role;
    if (invitedRole !== 'editor' && invitedRole !== 'viewer') {
      return reply.code(400).send(safeProblem(400, 'INVITE_ROLE_INVALID', 'Invalid invitation role', 'Выберите роль редактора или зрителя.'));
    }
    const token = randomBytes(32).toString('base64url');
    const tokenHash = sha256(token);
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60_000);
    const created = await queryDatabase(
      `INSERT INTO peace_v2_lite_invites
         (token_hash, world_id, invited_role, created_by_account_id, expires_at, remaining_uses)
       SELECT $1, $2, $3, $4, $5, 1
        WHERE EXISTS (SELECT 1 FROM peace_v2_lite_world_memberships AS owner
                       WHERE owner.world_id = $2 AND owner.account_id = $4
                         AND owner.role = 'owner' AND owner.revoked_at IS NULL)`,
      [tokenHash, context.worldId, invitedRole, context.accountId, expiresAt]
    );
    if (created.rowCount !== 1) {
      return reply.code(403).send(safeProblem(403, 'OWNER_REQUIRED', 'Owner permission required', 'Право владельца изменилось. Обновите страницу.'));
    }
    reply.code(201).header('cache-control', 'no-store, private');
    return { role: invitedRole, expiresAt: expiresAt.toISOString(), invitePath: `/invite/${token}` };
  });

  app.get<{ Params: { worldId: string } }>('/api/worlds/:worldId/members', async (request, reply) => {
    const context = await liteSession(request);
    if (!context) return reply.code(401).send(safeProblem(401, 'SESSION_REQUIRED', 'Sign in required', 'Сессия недоступна.'));
    if (context.worldId !== request.params.worldId) {
      return reply.code(403).send(safeProblem(403, 'WORLD_ACCESS_DENIED', 'World unavailable', 'Сначала выберите это поселение.'));
    }
    const members = await queryDatabase<{ accountId: string; role: 'owner' | 'editor' | 'viewer' }>(
      `SELECT account_id AS "accountId", role
         FROM peace_v2_lite_world_memberships
        WHERE world_id = $1 AND revoked_at IS NULL
        ORDER BY (role = 'owner') DESC, created_at`,
      [context.worldId]
    );
    return { members: members.rows, canManage: context.role === 'owner' };
  });

  app.post<{ Params: { token: string } }>('/api/invites/:token/accept', async (request, reply) => {
    const token = sessionToken(request, 'peace_lite_session');
    const context = await liteSession(request);
    if (!context || !token) return reply.code(401).send(safeProblem(401, 'SESSION_REQUIRED', 'Sign in required', 'Сначала создайте или восстановите аккаунт.'));
    if (!/^[A-Za-z0-9_-]{43}$/.test(request.params.token)) {
      return reply.code(404).send(safeProblem(404, 'INVITE_UNAVAILABLE', 'Invitation unavailable', 'Приглашение недоступно или истекло.'));
    }
    const hash = sha256(request.params.token);
    return withDatabaseLock(async () => {
      await database.query('BEGIN');
      try {
      const invite = await database.query<{ world_id: string; invited_role: 'editor' | 'viewer' }>(
        `UPDATE peace_v2_lite_invites AS invite
            SET remaining_uses = remaining_uses - 1
          WHERE invite.token_hash = $1 AND invite.expires_at > now() AND invite.revoked_at IS NULL
            AND invite.remaining_uses > 0
            AND EXISTS (SELECT 1 FROM peace_v2_lite_worlds AS world
                         WHERE world.id = invite.world_id AND world.status = 'active')
          RETURNING invite.world_id, invite.invited_role`,
        [hash]
      );
      const record = invite.rows[0];
      if (!record) {
        await database.query('ROLLBACK');
        return reply.code(404).send(safeProblem(404, 'INVITE_UNAVAILABLE', 'Invitation unavailable', 'Приглашение недоступно или истекло.'));
      }
      const membership = await database.query<{ role: string }>(
        `INSERT INTO peace_v2_lite_world_memberships (world_id, account_id, role)
         VALUES ($1, $2, $3)
         ON CONFLICT (world_id, account_id) DO UPDATE
           SET role = EXCLUDED.role, revoked_at = NULL
           WHERE peace_v2_lite_world_memberships.role <> 'owner'
         RETURNING role`,
        [record.world_id, context.accountId, record.invited_role]
      );
      if (!membership.rows[0]) {
        await database.query('ROLLBACK');
        return reply.code(409).send(safeProblem(409, 'MEMBERSHIP_CONFLICT', 'Membership conflict', 'Нельзя изменить права владельца через приглашение.'));
      }
      const sessionUpdate = await database.query(
        `UPDATE peace_v2_lite_sessions
            SET current_world_id = $3, last_seen_at = now()
          WHERE token_hash = $1 AND account_id = $2 AND revoked_at IS NULL AND expires_at > now()`,
        [sha256(token), context.accountId, record.world_id]
      );
      if (sessionUpdate.rowCount !== 1) {
        await database.query('ROLLBACK');
        return reply.code(401).send(safeProblem(401, 'SESSION_REQUIRED', 'Sign in required', 'Сессия изменилась. Войдите снова.'));
      }
      await database.query('COMMIT');
      return { worldId: record.world_id, role: record.invited_role };
      } catch {
        await database.query('ROLLBACK').catch(() => undefined);
        return reply.code(503).send(safeProblem(503, 'INVITE_ACCEPT_FAILED', 'Invitation unavailable', 'Не удалось принять приглашение. Повторите попытку.'));
      }
    });
  });

  app.delete<{ Params: { worldId: string; accountId: string } }>(
    '/api/worlds/:worldId/members/:accountId', async (request, reply) => {
      const context = await liteSession(request);
      if (!context) return reply.code(401).send(safeProblem(401, 'SESSION_REQUIRED', 'Sign in required', 'Сессия недоступна.'));
      if (context.worldId !== request.params.worldId || context.role !== 'owner') {
        return reply.code(403).send(safeProblem(403, 'OWNER_REQUIRED', 'Owner permission required', 'Отозвать доступ может только владелец поселения.'));
      }
      return withDatabaseLock(async () => {
        await database.query('BEGIN');
        try {
        const revoked = await database.query(
          `UPDATE peace_v2_lite_world_memberships AS membership SET revoked_at = now()
            WHERE membership.world_id = $1 AND membership.account_id = $2
              AND membership.role <> 'owner' AND membership.revoked_at IS NULL
              AND EXISTS (SELECT 1 FROM peace_v2_lite_world_memberships AS owner
                           WHERE owner.world_id = $1 AND owner.account_id = $3
                             AND owner.role = 'owner' AND owner.revoked_at IS NULL)
          RETURNING membership.account_id`,
          [request.params.worldId, request.params.accountId, context.accountId]
        );
        if (!revoked.rows[0]) {
          await database.query('ROLLBACK');
          return reply.code(404).send(safeProblem(404, 'MEMBERSHIP_NOT_FOUND', 'Member unavailable', 'Участник не найден или доступ уже отозван.'));
        }
        await database.query(
          `UPDATE peace_v2_lite_sessions AS session
              SET current_world_id = (SELECT world.id FROM peace_v2_lite_worlds AS world
                                       WHERE world.owner_account_id = session.account_id AND world.status = 'active'
                                       ORDER BY world.created_at LIMIT 1)
            WHERE session.account_id = $1 AND session.current_world_id = $2 AND session.revoked_at IS NULL`,
          [request.params.accountId, request.params.worldId]
        );
        await database.query('COMMIT');
        return { revoked: true };
        } catch {
          await database.query('ROLLBACK').catch(() => undefined);
          return reply.code(503).send(safeProblem(503, 'MEMBERSHIP_REVOCATION_FAILED', 'Member unavailable', 'Не удалось отозвать доступ. Повторите попытку.'));
        }
      });
    }
  );

  app.post('/api/auth/email/start', async (request, reply) => {
    const body = request.body as { email?: unknown } | null;
    const normalizedEmail = typeof body?.email === 'string'
      ? body.email.trim().normalize('NFC').toLowerCase()
      : '';
    if (normalizedEmail.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
      return reply.code(400).send(safeProblem(400, 'EMAIL_INVALID', 'Email unavailable', 'Укажите корректный адрес электронной почты.'));
    }
    const context = await liteSession(request);
    const cookieToken = sessionToken(request, 'peace_lite_session');
    const subjectHash = sha256(`${normalizedEmail}|${request.ip}`);
    const rawToken = randomBytes(32).toString('base64url');
    const startResult = await withDatabaseLock(async () => {
      await database.query('BEGIN');
      try {
        let queuedMail: { accountId: string; identityId: string; purpose: 'link_email' | 'login' } | null = null;
        const limit = await database.query<{ allowed: boolean }>(
          `INSERT INTO peace_v2_lite_auth_attempts AS attempts
             (subject_hash, window_started_at, request_count, updated_at)
           VALUES ($1, now(), 1, now())
           ON CONFLICT (subject_hash) DO UPDATE
             SET request_count = CASE
                   WHEN attempts.window_started_at < now() - interval '15 minutes' THEN 1
                   ELSE attempts.request_count + 1 END,
                 window_started_at = CASE
                   WHEN attempts.window_started_at < now() - interval '15 minutes' THEN now()
                   ELSE attempts.window_started_at END,
                 updated_at = now()
           RETURNING request_count <= 5 AS allowed`,
          [subjectHash]
        );
        if (limit.rows[0]?.allowed !== true) {
          await database.query('ROLLBACK');
          return { rateLimited: true, mail: null };
        }

        let identity: { id: string; account_id: string; verified_at: Date | null } | undefined;
        let purpose: 'link_email' | 'login' | null = null;
        if (context && cookieToken) {
          const active = await database.query<{ valid: boolean }>(
            `SELECT EXISTS (
               SELECT 1 FROM peace_v2_lite_sessions AS session
               JOIN peace_v2_lite_world_memberships AS membership
                 ON membership.account_id = session.account_id AND membership.revoked_at IS NULL
               WHERE session.token_hash = $1 AND session.account_id = $2
                 AND session.expires_at > now() AND session.revoked_at IS NULL
             ) AS valid`,
            [sha256(cookieToken), context.accountId]
          );
          if (active.rows[0]?.valid) {
            const existing = await database.query<typeof identity>(
              `SELECT id, account_id, verified_at FROM peace_v2_lite_email_identities
                WHERE normalized_email = $1 FOR UPDATE`,
              [normalizedEmail]
            );
            identity = existing.rows[0];
            if (!identity) {
              const id = randomUUID();
              await database.query(
                `INSERT INTO peace_v2_lite_email_identities (id, account_id, normalized_email)
                 VALUES ($1, $2, $3) ON CONFLICT (normalized_email) DO NOTHING`,
                [id, context.accountId, normalizedEmail]
              );
              const created = await database.query<typeof identity>(
                `SELECT id, account_id, verified_at FROM peace_v2_lite_email_identities
                  WHERE normalized_email = $1 FOR UPDATE`,
                [normalizedEmail]
              );
              identity = created.rows[0];
            }
            if (identity?.account_id === context.accountId) {
              purpose = identity.verified_at ? 'login' : 'link_email';
              queuedMail = { accountId: context.accountId, identityId: identity.id, purpose };
            }
          }
        } else {
          const existing = await database.query<typeof identity>(
            `SELECT id, account_id, verified_at FROM peace_v2_lite_email_identities
              WHERE normalized_email = $1 AND verified_at IS NOT NULL`,
            [normalizedEmail]
          );
          identity = existing.rows[0];
          if (identity) {
            purpose = 'login';
            queuedMail = { accountId: identity.account_id, identityId: identity.id, purpose };
          }
        }

        if (queuedMail) {
          await database.query(
            `INSERT INTO peace_v2_lite_auth_links
               (token_hash, account_id, identity_id, purpose, expires_at)
             VALUES ($1, $2, $3, $4, now() + interval '15 minutes')`,
            [sha256(rawToken), queuedMail.accountId, queuedMail.identityId, queuedMail.purpose]
          );
        }
        await database.query('COMMIT');
        return { rateLimited: false, mail: queuedMail };
      } catch (error) {
        await database.query('ROLLBACK').catch(() => undefined);
        throw error;
      }
    });
    if (startResult.rateLimited) {
      return reply.code(429).send(safeProblem(429, 'AUTH_RATE_LIMITED', 'Request unavailable', 'Повторите запрос позже.'));
    }

    if (startResult.mail) {
      const configuredBase = process.env.AVANPOST_V2_PUBLIC_APP_URL;
      let origin = request.headers.origin && allowedOrigins.has(request.headers.origin)
        ? request.headers.origin
        : `http://localhost:${config.clientPort}`;
      if (configuredBase) {
        try {
          const parsed = new URL(configuredBase);
          if ((parsed.protocol === 'https:' || parsed.hostname === 'localhost' && parsed.protocol === 'http:') &&
              parsed.pathname === '/' && !parsed.search && !parsed.hash) origin = parsed.origin;
        } catch {
          // Ignore malformed optional URLs; the deployment monitor reports missing delivery configuration.
        }
      } else if (process.env.NODE_ENV === 'production') {
        origin = '';
      }
      if (origin) {
        const link = new URL('/auth/email/verify', origin);
        link.searchParams.set('token', rawToken);
        try {
          await deliverLiteMagicLink({ to: normalizedEmail, url: link.toString(), purpose: startResult.mail.purpose });
        } catch (error) {
          request.log.warn({
            code: error instanceof Error && error.message.startsWith('LITE_')
              ? error.message
              : 'LITE_EMAIL_DELIVERY_FAILED'
          }, 'Lite magic-link delivery failed');
        }
      }
    }
    reply.header('cache-control', 'no-store, private');
    return reply.code(202).send({ status: 'if_account_exists_link_will_be_sent' });
  });

  app.get<{ Querystring: { token?: string } }>('/auth/email/verify', async (request, reply) => {
    const token = request.query.token;
    if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token)) {
      reply.header('cache-control', 'no-store').header('referrer-policy', 'no-referrer');
      return reply.redirect('/?auth=link-invalid', 303);
    }
    const sessionTokenValue = randomBytes(32).toString('hex');
    const sessionExpiry = new Date(Date.now() + LITE_SESSION_TTL_MS);
    const verified = await withDatabaseLock(async () => {
      await database.query('BEGIN');
      try {
        const linkResult = await database.query<{
          account_id: string; identity_id: string; purpose: 'link_email' | 'login';
          verified_at: Date | null; identity_account_id: string;
        }>(
          `SELECT auth.account_id, auth.identity_id, auth.purpose,
                  identity.verified_at, identity.account_id AS identity_account_id
             FROM peace_v2_lite_auth_links AS auth
             JOIN peace_v2_lite_email_identities AS identity ON identity.id = auth.identity_id
             JOIN peace_v2_lite_accounts AS account
               ON account.id = auth.account_id AND account.status <> 'disabled'
            WHERE auth.token_hash = $1 AND auth.used_at IS NULL AND auth.expires_at > now()
            FOR UPDATE OF auth`,
          [sha256(token)]
        );
        const link = linkResult.rows[0];
        if (!link || link.account_id !== link.identity_account_id ||
            link.purpose === 'login' && !link.verified_at) {
          await database.query('ROLLBACK');
          return false;
        }
        if (link.purpose === 'link_email') {
          const linked = await database.query(
            `UPDATE peace_v2_lite_email_identities
                SET verified_at = COALESCE(verified_at, now())
              WHERE id = $1 AND account_id = $2`,
            [link.identity_id, link.account_id]
          );
          if (linked.rowCount !== 1) {
            await database.query('ROLLBACK');
            return false;
          }
          await database.query(
            `UPDATE peace_v2_lite_accounts SET status = 'linked', updated_at = now()
              WHERE id = $1 AND status = 'guest'`,
            [link.account_id]
          );
        }
        const world = await database.query<{ id: string }>(
          `SELECT world.id FROM peace_v2_lite_worlds AS world
            JOIN peace_v2_lite_world_memberships AS membership
              ON membership.world_id = world.id AND membership.account_id = world.owner_account_id
             AND membership.role = 'owner' AND membership.revoked_at IS NULL
           WHERE world.owner_account_id = $1 AND world.status = 'active'
           ORDER BY world.created_at LIMIT 1`,
          [link.account_id]
        );
        if (!world.rows[0]) {
          await database.query('ROLLBACK');
          return false;
        }
        const consumed = await database.query(
          `UPDATE peace_v2_lite_auth_links SET used_at = now()
            WHERE token_hash = $1 AND used_at IS NULL AND expires_at > now()`,
          [sha256(token)]
        );
        if (consumed.rowCount !== 1) {
          await database.query('ROLLBACK');
          return false;
        }
        await database.query(
          `INSERT INTO peace_v2_lite_sessions (token_hash, account_id, expires_at, current_world_id)
           VALUES ($1, $2, $3, $4)`,
          [sha256(sessionTokenValue), link.account_id, sessionExpiry, world.rows[0].id]
        );
        await database.query('COMMIT');
        return true;
      } catch {
        await database.query('ROLLBACK').catch(() => undefined);
        return false;
      }
    });
    reply.header('cache-control', 'no-store').header('referrer-policy', 'no-referrer');
    if (!verified) return reply.redirect('/?auth=link-invalid', 303);
    const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
    reply.header('set-cookie', `peace_lite_session=${sessionTokenValue}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${LITE_SESSION_TTL_MS / 1000}${secure}`);
    return reply.redirect('/', 303);
  });

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
    const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
    reply.header('set-cookie', [
      `peace_v2_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_TTL_MS / 1000}`,
      `peace_lite_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0${secure}`
    ]);
    reply.header('cache-control', 'no-store, private');
    return { status: 'paired' };
  });

  app.post('/api/auth/guest', async (request, reply) => {
    const existing = await liteSession(request);
    if (existing) {
      reply.header('cache-control', 'no-store, private');
      return { accountId: existing.accountId, worldId: existing.worldId, role: existing.role };
    }
    try {
      const guest = await withDatabaseLock(() => createLiteGuest(database));
      const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
      reply.header('set-cookie', `peace_lite_session=${guest.token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${LITE_SESSION_TTL_MS / 1000}${secure}`);
      reply.header('cache-control', 'no-store, private');
      return { accountId: guest.accountId, worldId: guest.worldId, role: guest.role };
    } catch (error) {
      request.log.error({ errorName: error instanceof Error ? error.name : 'UnknownError' }, 'Lite guest provisioning failed');
      return reply.code(503).send(safeProblem(503, 'LITE_ACCOUNT_UNAVAILABLE', 'Account unavailable', 'Не удалось создать поселение. Повторите попытку.'));
    }
  });

  app.get('/api/me', async (request, reply) => {
    const context = await liteSession(request);
    if (!context) return reply.code(401).send(safeProblem(401, 'SESSION_REQUIRED', 'Sign in required', 'Сессия недоступна. Создайте гостевую сессию или войдите по ссылке.'));
    reply.header('cache-control', 'no-store, private');
    return context;
  });

  app.get('/api/session/status', async (request) => ({ paired: await ownerSession(request) }));

  app.get('/api/world/preview', async (request, reply) => {
    const worldId = (await requestWorldId(request)) ?? WORLD_ID;
    try {
      return toPreview(await readWorld(worldId));
    } catch (error) {
      return sendWorldReadFailure(request, reply, error, worldId);
    }
  });

  app.get<{ Params: { depositId: string } }>('/api/underground/route/:depositId', async (request, reply) => {
    const worldId = await requestWorldId(request);
    if (!worldId) return reply.code(401).send(safeProblem(401, 'SESSION_REQUIRED', 'Sign in required', 'Откройте сессию, чтобы продолжить.'));
    try {
      const result = previewUndergroundRoute(await readWorld(worldId), request.params.depositId);
      const details: Record<string, string> = {
        DEPOSIT_NOT_FOUND: 'Месторождение не найдено.', DEPOSIT_NOT_REVEALED: 'Месторождение ещё не разведано.',
        DEPOSIT_DEPLETED: 'Месторождение исчерпано.', DEPOSIT_NOT_ACCESSED: 'Сначала создайте доступный вход в шахту.',
        CELL_NOT_CONNECTED: 'Нет допустимого пути: проверьте владение сектором, породу и вертикальную связь.',
        INSUFFICIENT_MATERIALS: 'Для запланированных лестниц не хватает древесины на доступных складах.',
        DUPLICATE_JOB: 'Для этого месторождения уже выполняется план проходки.'
      };
      return result.ok ? result.value : reply.code(409).send({ code: result.reason, detail: details[result.reason] ?? 'Нельзя проложить этот маршрут.' });
    } catch (error) { return sendWorldReadFailure(request, reply, error, worldId); }
  });

  app.get('/api/world', async (request, reply) => {
    const worldId = await requestWorldId(request);
    if (!worldId) return reply.code(401).send(safeProblem(401, 'SESSION_REQUIRED', 'Sign in required', 'Откройте сессию, чтобы загрузить поселение.'));
    try {
      const world = await readWorld(worldId);
      return {
        ...world,
        undergroundCells: world.undergroundCells.map((cell) => cell.revealed || cell.state === 'tunnel'
          ? cell : { ...cell, geology: 'humus' as const }),
        undergroundDeposits: world.undergroundDeposits.filter((deposit) => deposit.revealed)
      };
    } catch (error) {
      return sendWorldReadFailure(request, reply, error, worldId);
    }
  });

  app.post('/api/placement/validate', async (request, reply) => {
    const worldId = await requestWorldId(request);
    if (!worldId) return reply.code(401).send(safeProblem(401, 'SESSION_REQUIRED', 'Sign in required', 'Откройте сессию, чтобы изменить поселение.'));
    const body = CabinPlacementRequestSchema.safeParse(request.body);
    if (!body.success) {
      return reply.code(400).send(safeProblem(400, 'INVALID_COORDINATE', 'Место не распознано', 'Выберите клетку игровой сетки.'));
    }
    try {
      const world = await readWorld(worldId);
      const buildingKind = body.data.buildingKind ?? 'cabin';
      const placement = buildingKind !== 'cabin'
        ? validateWorkshopOrderPlacement(world, body.data.anchor, undefined,
          buildingKind === 'warehouse' ? 'warehouse' : buildingKind.startsWith('school-') ? buildingKind as PeaceWorldSnapshot['buildings'][number]['kind'] : 'workshop')
        : validateCabinOrderPlacement(world, body.data.anchor);
      const messages: Record<string, string> = {
        READY: 'Место подходит. После подтверждения заказ попадёт в очередь строительства.',
        WAITING_MATERIALS: buildingKind === 'warehouse'
          ? `Недостаточно ресурсов: склад дождётся ${PROPOSED_WAREHOUSE_BALANCE.constructionMaterials.wood} древесины и ${PROPOSED_WAREHOUSE_BALANCE.constructionMaterials.stone} камня.`
          : buildingKind === 'workshop'
            ? `Недостаточно ресурсов: мастерская дождётся ${WORKSHOP_MATERIALS.wood} древесины и ${WORKSHOP_MATERIALS.stone} камня.`
            : `Недостаточно ресурсов: заказ дождётся ${WOOD_CABIN_COST} древесины.`,
        WAITING_WORK_POINT: 'Заказ будет ждать освобождения рабочей точки.',
        OUT_OF_WORLD: 'Клетка находится за границей доступного мира.',
        INVALID_SURFACE: 'Неподходящая поверхность для строительства.',
        NO_SUPPORT: 'Неподходящая поверхность: участку не хватает опоры.',
        NO_ENTRANCE: 'Нет прохода ко входу здания.',
        OCCUPIED: 'Занято другим зданием, складом или ресурсным объектом.',
        VISUAL_OVERLAP: 'Видимая область пересекается с соседней постройкой. Отодвиньте здание.',
        ROUTE_BLOCKED: 'Перекрывает действующий маршрут к складу или источнику.',
        NO_PATH: 'Нет прохода ко входу или рабочей точке здания.'
      };
      return { ...placement, revision: world.revision, detail: messages[placement.reason] ?? 'Это место недоступно.' };
    } catch (error) {
      return sendWorldReadFailure(request, reply, error, worldId);
    }
  });

  app.post('/api/commands', async (request, reply) => {
    const worldId = await requestWorldId(request);
    if (!worldId) return reply.code(401).send(safeProblem(401, 'SESSION_REQUIRED', 'Sign in required', 'Откройте сессию, чтобы выполнить действие.'));
    const liteContext = await liteSession(request);
    if (liteContext && !['owner', 'editor'].includes(liteContext.role)) {
      return reply.code(403).send(safeProblem(403, 'WORLD_READ_ONLY', 'Read-only membership', 'У этого участника нет права изменять поселение.'));
    }
    const parsed = PeaceCommandSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send(safeProblem(400, 'INVALID_COMMAND', 'Action unavailable', 'Действие не распознано. Обновите мир и попробуйте снова.'));
    }
    const command = parsed.data;
    try {
      await tickSimulation(Date.now(), worldId);
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
          [worldId]
      );
      const row = result.rows[0];
      if (!row) {
        await database.query('ROLLBACK');
        return reply.code(503).send(safeProblem(503, 'WORLD_NOT_FOUND', 'World unavailable', 'Мир ещё не подготовлен.'));
      }
      const previous = await database.query<{ payload_hash: string; response: PeaceWorldSnapshot }>(
        worldId === WORLD_ID
          ? 'SELECT payload_hash, response FROM peace_v2_command_log WHERE request_id = $1'
          : 'SELECT request_hash AS payload_hash, response FROM peace_v2_lite_world_commands WHERE world_id = $1 AND request_id = $2',
        worldId === WORLD_ID ? [command.requestId] : [worldId, command.requestId]
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
            VISUAL_OVERLAP: 'Видимые области зданий пересекутся. Выберите более удалённую клетку.',
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
      } else if (command.kind === 'build-warehouse') {
        const queuePosition = Math.max(next.nextBuildOrderSequence,
          ...next.buildOrders.map((order) => order.queuePosition + 1));
        const created = createBuildWorkshopOrder(next, `order-${command.requestId}`,
          `warehouse-${command.requestId}`, command.anchor, queuePosition, 'warehouse');
        if (!created) {
          await database.query('ROLLBACK');
          const invalid = validateWorkshopOrderPlacement(current, command.anchor, undefined, 'warehouse');
          const status = ['OUT_OF_WORLD', 'INVALID_SURFACE', 'NO_SUPPORT', 'NO_ENTRANCE'].includes(invalid.reason) ? 422 : 409;
          return reply.code(status).send(safeProblem(status, invalid.reason, 'Строительство недоступно',
            invalid.reason === 'WAITING_MATERIALS'
              ? `Для склада требуется ${PROPOSED_WAREHOUSE_BALANCE.constructionMaterials.wood} дерева и ${PROPOSED_WAREHOUSE_BALANCE.constructionMaterials.stone} камня.`
              : 'Выберите свободный участок с проходом для строителя.', command.requestId));
        }
        next.buildOrders.push(created.order);
        next.buildings.push(created.building);
        next.nextBuildOrderSequence = queuePosition + 1;
        next.revision.geometryVersion += 1;
      } else if (command.kind === 'build-school') {
        const queuePosition = Math.max(next.nextBuildOrderSequence,
          ...next.buildOrders.map((order) => order.queuePosition + 1));
        const created = createBuildSchoolOrder(next, command.schoolId, `order-${command.requestId}`,
          `school-${command.schoolId}-${command.requestId}`, command.anchor, queuePosition);
        if (!created) {
          await database.query('ROLLBACK');
          const invalidPlacement = validateWorkshopOrderPlacement(current, command.anchor, undefined, `school-${command.schoolId}`);
          const detailByReason: Record<string, string> = {
            VISUAL_OVERLAP: 'Видимые области зданий пересекутся. Выберите более удалённую клетку.',
            OCCUPIED: 'Выбранный участок уже занят другой постройкой или ресурсом.',
            NO_PATH: 'К участку нет маршрута для строителя.',
            ROUTE_BLOCKED: 'Размещение перекрывает действующий маршрут к ресурсу или складу.'
          };
          return reply.code(409).send(safeProblem(409, invalidPlacement.reason, 'Строительство недоступно',
            detailByReason[invalidPlacement.reason] ?? 'На этом участке нельзя построить школу. Проверьте опору, доступ и свободный проход.', command.requestId));
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
            VISUAL_OVERLAP: 'Видимые области зданий пересекутся. Выберите более удалённую клетку.',
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
        await replaceWorldOccupiedCells(database, worldId, next);
      }
      await database.query(
        `UPDATE peace_v2_world_state
         SET world_version = $2, geometry_version = $3, state = $4::jsonb, state_schema_version = $5, updated_at = now()
         WHERE world_id = $1`,
        [worldId, next.revision.worldVersion, next.revision.geometryVersion, stateJson(next), PEACE_WORLD_SCHEMA_VERSION]
      );
      if (worldId === WORLD_ID) {
        await database.query(
          'INSERT INTO peace_v2_command_log (request_id, payload_hash, response) VALUES ($1, $2, $3::jsonb)',
          [command.requestId, hash, JSON.stringify(next)]
        );
      } else {
        const token = sessionToken(request, 'peace_lite_session');
        const lite = token ? await resolveLiteSession(database, token) : null;
        if (!lite || lite.worldId !== worldId || !['owner', 'editor'].includes(lite.role)) {
          await database.query('ROLLBACK');
          return reply.code(403).send(safeProblem(403, 'WORLD_ACCESS_REVOKED', 'World access changed',
            'Право изменять поселение больше недоступно. Обновите страницу.', command.requestId));
        }
        await database.query(
          `INSERT INTO peace_v2_lite_world_commands
             (world_id, request_id, actor_account_id, request_hash, response, committed_world_version)
           VALUES ($1, $2, $3, $4, $5::jsonb, $6)`,
          [worldId, command.requestId, lite.accountId, hash, JSON.stringify(next), next.revision.worldVersion]
        );
      }
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
          request.log.error({ code: error.code, worldId }, 'Persisted V2 world state is unavailable');
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
