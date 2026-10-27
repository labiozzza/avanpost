import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import Fastify, { type FastifyRequest } from 'fastify';
import {
  CabinPlacementRequestSchema,
  GlobalCoordinateSchema,
  PairingRequestSchema,
  PeaceCommandSchema,
  PeaceResidentIdSchema,
  PeaceWorldSnapshotSchema,
  ReadOnlyWorldPreviewSchema,
  type PeaceResident,
  type PeaceWorldSnapshot,
  type ReadOnlyWorldPreview
} from '@avanpost/peace-v2-shared';
import {
  advanceSettlement,
  createBuildCabinTask,
  createDeliveryTask,
  createGatherWoodTask,
  validateCabinPlacement,
  PEACE_V2_TICK_INTERVAL_MS,
  CABIN_FOOTPRINT,
  CABIN_BUILD_TICKS,
  WOOD_CABIN_COST
} from '@avanpost/peace-v2-sim';
import type { V2Config } from './config.js';

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
  const origins = new Set([`http://${config.bindHost}:4174`]);
  if (['127.0.0.1', 'localhost', '::1'].includes(config.bindHost)) {
    origins.add('http://127.0.0.1:4174');
    origins.add('http://localhost:4174');
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
  resident.visualState = task?.phase ?? 'idle';
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
    return parseWorld(row);
  } catch {
    throw new V2WorldStateError('V2_WORLD_STATE_INVALID');
  }
}

function toPreview(world: PeaceWorldSnapshot): ReadOnlyWorldPreview {
  return ReadOnlyWorldPreviewSchema.parse({
    revision: world.revision,
    cells: Array.from({ length: 9 }, (_, index) => ({
      coordinate: { x: index - 4, y: 0 },
      fillType: 'solid' as const,
      materialId: 'earth'
    })),
    buildings: [
      {
        visualKey: world.storage.id,
        buildingId: 'storehouse',
        anchor: world.storage.anchor,
        state: 'complete' as const
      },
      ...world.buildings.map((building) => ({
        visualKey: building.id,
        buildingId: building.kind,
        anchor: building.anchor,
        state: building.state
      }))
    ],
    resourceNodes: world.trees.map((tree, index) => ({
      visualKey: `resource-tree-${index + 1}`,
      name: tree.name,
      position: tree.position,
      sourceKind: tree.sourceKind,
      remaining: tree.remaining,
      maxRemaining: tree.maxRemaining,
      state: tree.state,
      regrowthProgressTicks: tree.regrowthProgressTicks,
      regrowthEveryTicks: tree.regrowthEveryTicks
    })),
    actors: world.residents.map((resident, index) => ({
      visualKey: `resident-scene-${index + 1}`,
      appearanceKey: resident.appearanceKey,
      position: resident.position,
      visualState: resident.visualState,
      cargo: resident.cargo
    })),
    resourceTotals: [{ itemId: 'wood', quantity: world.resources.wood }]
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
      resources: world.resources,
      storage: world.storage,
      trees: world.trees,
      residents: world.residents,
      buildings: world.buildings
    });
  }

  function recoverCarriedWood(world: PeaceWorldSnapshot): boolean {
    let recovered = false;
    for (const resident of world.residents) {
      if (resident.cargo < 1 || resident.task) continue;
      const task = createDeliveryTask(world, resident.id,
        `recovery-${resident.id}-${world.revision.serverTick}`, 'recovered-cargo');
      setResidentTask(resident, task ?? {
        id: `recovery-${resident.id}-${world.revision.serverTick}`,
        kind: 'gather-wood',
        phase: 'waiting_path',
        sourceId: 'recovered-cargo',
        destinationId: world.storage.id,
        path: [],
        pathIndex: 0,
        progressTicks: 0,
        requiredTicks: 1,
        blockedReason: 'NO_PATH_TO_STORAGE',
        continuous: false,
        cancelAfterDelivery: false
      });
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
        const recovered = recoverCarriedWood(current);
        const ticks = elapsedTicks(row.last_simulated_at, nowMs);
        if (ticks === 0 && !recovered) {
          await database.query('ROLLBACK');
          return;
        }
        const next = advanceSettlement(current, ticks);
        await database.query(
          `UPDATE peace_v2_world_state
           SET world_version = $2, geometry_version = $3, server_tick = $4, state = $5::jsonb,
                 last_simulated_at = $6, state_schema_version = 5, updated_at = now()
           WHERE world_id = $1`,
          [WORLD_ID, next.revision.worldVersion, next.revision.geometryVersion, next.revision.serverTick,
            stateJson(next), simulatedThrough(row.last_simulated_at, ticks, nowMs)]
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
      recoverCarriedWood(world);
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
    if (activeAttempt.count >= PAIRING_ATTEMPT_LIMIT) {
      attempts.set(peer, activeAttempt);
      return reply.code(429).send(safeProblem(429, 'PAIR_RATE_LIMITED', 'Try later', 'Подождите немного и попробуйте снова.'));
    }
    activeAttempt.count += 1;
    attempts.set(peer, activeAttempt);
    const parsed = PairingRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send(safeProblem(400, 'PAIR_INVALID', 'Pairing failed', 'Проверьте код и попробуйте ещё раз.'));
    }
    const suppliedHash = Buffer.from(sha256(parsed.data.code), 'hex');
    const expectedHash = Buffer.from(sha256(pairing.code), 'hex');
    if (Date.now() >= pairing.expiresAt) {
      return reply.code(410).send(safeProblem(410, 'PAIR_EXPIRED', 'Pairing expired', 'Получите новый код на локальной странице запуска.'));
    }
    if (!timingSafeEqual(suppliedHash, expectedHash)) {
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

  app.get('/api/world', async (request, reply) => {
    if (!(await ownerSession(request))) {
      return reply.code(401).send(safeProblem(401, 'SESSION_REQUIRED', 'Pair first', 'Подключите игру одноразовым кодом.'));
    }
    try {
      return await readWorld();
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
      const placement = validateCabinPlacement(world, body.data.anchor, body.data.residentId);
      const messages: Record<string, string> = {
        READY: 'Место подходит. После подтверждения житель начнёт строительство.',
        WAITING_MATERIALS: 'Участок сохранится в очереди; житель дождётся трёх брёвен.',
        WAITING_WORK_POINT: 'Участок подходит; житель дождётся освобождения точки строительства.',
        RESIDENT_MISSING: 'Выбранный житель больше не найден.',
        WORKER_BUSY: 'Рабочий сначала должен закончить текущее поручение.',
        CARGO_NOT_EMPTY: 'Сначала дождитесь разгрузки бревна.',
        OUT_OF_WORLD: 'Клетка находится за границей доступного мира.',
        INVALID_SURFACE: 'Дом можно ставить только на поверхности.',
        OCCUPIED: 'Этот участок уже занят или мешает дереву.',
        NO_PATH: 'К выбранному участку нет доступного маршрута для строителя.'
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
    } catch {
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
      const resident = next.residents.find((candidate) => candidate.id === command.residentId);
      if (!resident) {
        await database.query('ROLLBACK');
        return reply.code(404).send(safeProblem(404, 'RESIDENT_NOT_FOUND', 'Resident unavailable',
          'Этот житель больше не найден в поселении.', command.requestId));
      }
      if (command.kind === 'collect-wood') {
        if (resident.task) {
          await database.query('ROLLBACK');
          return reply.code(409).send(safeProblem(409, 'WORKER_BUSY', 'Resident busy', `${resident.name} уже выполняет поручение.`, command.requestId));
        }
        if (resident.cargo > 0) {
          await database.query('ROLLBACK');
          return reply.code(409).send(safeProblem(409, 'CARGO_NOT_EMPTY', 'Resident carrying wood', `${resident.name} доставит уже поднятое бревно на склад.`, command.requestId));
        }
        const task = createGatherWoodTask(next, resident.id, `task-${command.requestId}`, command.sourceId);
        if (!task) {
          await database.query('ROLLBACK');
          return reply.code(409).send(safeProblem(409, 'WORKER_BUSY', 'Resident unavailable', `${resident.name} не может принять это поручение.`, command.requestId));
        }
        setResidentTask(resident, task);
      } else if (command.kind === 'cancel-woodcutting') {
        if (resident.task && resident.task.kind !== 'gather-wood') {
          await database.query('ROLLBACK');
          return reply.code(409).send(safeProblem(409, 'WORKER_BUSY', 'Resident busy', `${resident.name} занят другой работой.`, command.requestId));
        }
        const task = resident.task;
        if (task?.kind === 'gather-wood') {
          if (resident.cargo > 0) {
            task.continuous = false;
            task.cancelAfterDelivery = true;
          } else {
            setResidentTask(resident, null);
          }
        }
      } else if (command.kind === 'uproot-stump') {
        if (resident.task) {
          await database.query('ROLLBACK');
          return reply.code(409).send(safeProblem(409, 'WORKER_BUSY', 'Resident busy', `${resident.name} сначала должен закончить текущее поручение.`, command.requestId));
        }
        if (resident.cargo > 0) {
          await database.query('ROLLBACK');
          return reply.code(409).send(safeProblem(409, 'CARGO_NOT_EMPTY', 'Resident carrying wood', `${resident.name} сначала должен разгрузить бревно.`, command.requestId));
        }
        const stump = next.trees.find((tree) => tree.id === command.treeId);
        if (!stump || stump.state !== 'stump' || stump.remaining > 0) {
          await database.query('ROLLBACK');
          return reply.code(422).send(safeProblem(422, 'RESOURCE_MISSING', 'Stump unavailable', 'Выкорчевать можно только существующий пень.', command.requestId));
        }
        stump.state = 'uprooted';
        stump.regrowthProgressTicks = 0;
        next.revision.geometryVersion += 1;
      } else {
        const placement = validateCabinPlacement(current, command.anchor, resident.id);
        if (!placement.valid) {
          await database.query('ROLLBACK');
          const status = placement.reason === 'RESOURCE_MISSING' ? 422 : 409;
          const detailByReason: Record<string, string> = {
            RESIDENT_MISSING: 'Выбранный житель больше не найден.',
            WORKER_BUSY: 'Дождитесь, пока рабочий закончит текущее поручение.',
            CARGO_NOT_EMPTY: 'Дождитесь разгрузки бревна перед строительством.',
            RESOURCE_MISSING: `Для дома нужно ${WOOD_CABIN_COST} брёвна.`,
            OUT_OF_WORLD: 'Выбранный участок находится за границей доступного мира.',
            INVALID_SURFACE: 'Дом можно ставить только на поверхности.',
            OCCUPIED: 'Выбранный участок уже занят или мешает дереву.',
            NO_PATH: 'К участку нет маршрута для строителя.'
          };
          return reply.code(status).send(safeProblem(status, placement.reason, 'Строительство недоступно',
            detailByReason[placement.reason] ?? 'Выберите другое место.', command.requestId));
        }
        const buildingId = `cabin-${command.requestId}`;
        const task = createBuildCabinTask(next, resident.id, `task-${command.requestId}`, buildingId, command.anchor);
        if (!task) {
          await database.query('ROLLBACK');
          return reply.code(409).send(safeProblem(409, 'NO_PATH', 'No reachable build site', 'К участку нет маршрута для строителя.', command.requestId));
        }
        const waitingForMaterials = task.phase === 'waiting_materials';
        if (!waitingForMaterials) next.resources.wood -= WOOD_CABIN_COST;
        next.buildings.push({
          id: buildingId,
          kind: 'cabin',
          anchor: command.anchor,
          footprint: { ...CABIN_FOOTPRINT },
          state: waitingForMaterials ? 'waiting_materials' : 'planned',
          progressTicks: 0,
          progressRequired: CABIN_BUILD_TICKS,
          reservedWood: waitingForMaterials ? 0 : WOOD_CABIN_COST
        });
        setResidentTask(resident, task);
        next.revision.geometryVersion += 1;
      }
      next.revision.worldVersion += 1;
      next = PeaceWorldSnapshotSchema.parse(next);
      await database.query(
        `UPDATE peace_v2_world_state
         SET world_version = $2, geometry_version = $3, state = $4::jsonb, state_schema_version = 5, updated_at = now()
         WHERE world_id = $1`,
        [WORLD_ID, next.revision.worldVersion, next.revision.geometryVersion, stateJson(next)]
      );
      await database.query(
        'INSERT INTO peace_v2_command_log (request_id, payload_hash, response) VALUES ($1, $2, $3::jsonb)',
        [command.requestId, hash, JSON.stringify(next)]
      );
      await database.query('COMMIT');
      return next;
      } catch (error) {
        await database.query('ROLLBACK').catch(() => undefined);
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
