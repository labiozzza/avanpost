import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import Fastify, { type FastifyRequest } from 'fastify';
import {
  PairingRequestSchema,
  PeaceCommandSchema,
  PeaceWorldSnapshotSchema,
  ReadOnlyWorldPreviewSchema,
  type PeaceCommand,
  type PeaceWorldSnapshot,
  type ReadOnlyWorldPreview
} from '@avanpost/peace-v2-shared';
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
const STARTING_WORLD: PeaceWorldSnapshot = {
  revision: { worldVersion: 1, geometryVersion: 1, serverTick: 0 },
  resources: { wood: 1 },
  tree: { position: { x: 3, y: 0 }, remaining: 3 },
  worker: {
    id: 'worker-1',
    name: 'Илья',
    position: { x: -3, y: 0 },
    visualState: 'idle',
    cargo: 0
  },
  buildings: []
};

interface PersistedWorld {
  world_version: number;
  geometry_version: number;
  server_tick: number;
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

function toPreview(world: PeaceWorldSnapshot): ReadOnlyWorldPreview {
  return ReadOnlyWorldPreviewSchema.parse({
    revision: world.revision,
    cells: Array.from({ length: 9 }, (_, index) => ({
      coordinate: { x: index - 4, y: 0 },
      fillType: 'solid' as const,
      materialId: 'earth'
    })),
    buildings: [
      { visualKey: 'storehouse-scene', buildingId: 'storehouse', anchor: { x: -4, y: -1 }, state: 'complete' as const },
      ...world.buildings.map((building, index) => ({
        visualKey: `building-scene-${index + 1}`,
        buildingId: building.kind,
        anchor: building.anchor,
        state: 'complete' as const
      }))
    ],
    actors: [{
      visualKey: 'worker-scene',
      position: world.worker.position,
      visualState: world.worker.visualState
    }],
    resourceTotals: [{ itemId: 'wood', quantity: world.resources.wood }]
  });
}

function applyCommand(world: PeaceWorldSnapshot, command: PeaceCommand): PeaceWorldSnapshot | { code: string; detail: string; status: number } {
  const next = structuredClone(world);
  if (command.kind === 'collect-wood') {
    if (next.worker.cargo > 0) return { code: 'CARGO_NOT_EMPTY', detail: 'Сначала доставьте древесину на склад.', status: 409 };
    if (next.tree.remaining < 1) return { code: 'RESOURCE_MISSING', detail: 'Дерево уже вырублено. Выберите другое действие.', status: 422 };
    next.tree.remaining -= 1;
    next.worker.position = { ...next.tree.position };
    next.worker.visualState = 'carry';
    next.worker.cargo = 1;
  } else if (command.kind === 'deliver-wood') {
    if (next.worker.cargo < 1 || next.worker.position.x !== next.tree.position.x) {
      return { code: 'NO_CARGO', detail: 'Рабочий пока не несёт древесину со стороны леса.', status: 409 };
    }
    next.worker.position = { x: -3, y: 0 };
    next.worker.visualState = 'idle';
    next.resources.wood += next.worker.cargo;
    next.worker.cargo = 0;
  } else {
    if (next.worker.cargo > 0) {
      return { code: 'CARGO_NOT_EMPTY', detail: 'Сначала доставьте древесину на склад.', status: 409 };
    }
    if (next.resources.wood < 3) {
      return { code: 'RESOURCE_MISSING', detail: 'Для домика нужно ещё 2 бревна. Отправьте рабочего в лес.', status: 422 };
    }
    next.resources.wood -= 3;
    next.worker.position = { x: 1, y: 0 };
    next.worker.visualState = 'idle';
    next.buildings.push({
      id: `cabin-${next.buildings.length + 1}`,
      kind: 'cabin',
      anchor: { x: 0, y: -1 },
      state: 'complete'
    });
  }
  next.revision.worldVersion += 1;
  if (command.kind === 'build-cabin') next.revision.geometryVersion += 1;
  next.revision.serverTick += 1;
  return PeaceWorldSnapshotSchema.parse(next);
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
    const result = await queryDatabase<PersistedWorld>(
      'SELECT world_version, geometry_version, server_tick, state FROM peace_v2_world_state WHERE world_id = $1',
      [WORLD_ID]
    );
    const row = result.rows[0];
    if (!row) throw new V2WorldStateError('V2_WORLD_NOT_INITIALIZED');
    try {
      return parseWorld(row);
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

  app.post('/api/commands', async (request, reply) => {
    if (!(await ownerSession(request))) {
      return reply.code(401).send(safeProblem(401, 'SESSION_REQUIRED', 'Pair first', 'Подключите игру одноразовым кодом.'));
    }
    const parsed = PeaceCommandSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send(safeProblem(400, 'INVALID_COMMAND', 'Action unavailable', 'Действие не распознано. Обновите мир и попробуйте снова.'));
    }
    const command = parsed.data;
    const hash = sha256(JSON.stringify(command));
    return withDatabaseLock(async () => {
      try {
        await database.query('BEGIN');
        const result = await database.query<PersistedWorld>(
        'SELECT world_version, geometry_version, server_tick, state FROM peace_v2_world_state WHERE world_id = $1 FOR UPDATE',
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
      const current = parseWorld(row);
      if (command.expectedWorldVersion !== current.revision.worldVersion ||
          command.expectedGeometryVersion !== current.revision.geometryVersion) {
        await database.query('ROLLBACK');
        return reply.code(409).send(safeProblem(409, 'STALE_WORLD', 'World changed', 'Мир обновился. Загрузите его заново перед действием.', command.requestId));
      }
      const next = applyCommand(current, command);
      if ('code' in next) {
        await database.query('ROLLBACK');
        return reply.code(next.status).send(safeProblem(next.status, next.code, 'Action not possible', next.detail, command.requestId));
      }
      await database.query(
        `UPDATE peace_v2_world_state
         SET world_version = $2, geometry_version = $3, server_tick = $4, state = $5::jsonb, updated_at = now()
         WHERE world_id = $1`,
        [WORLD_ID, next.revision.worldVersion, next.revision.geometryVersion, next.revision.serverTick,
          JSON.stringify({ resources: next.resources, tree: next.tree, worker: next.worker, buildings: next.buildings })]
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

  return app;
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
