import { createHash, randomBytes, randomUUID } from 'node:crypto';
import cookie from '@fastify/cookie';
import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';
import type { Kysely } from 'kysely';
import { z } from 'zod';
import {
  BuildCommandSchema,
  CancelCraftCommandSchema,
  CancelResearchCommandSchema,
  ClearCellCommandSchema,
  DemolishCommandSchema,
  ErrorCode,
  GatherNodeCommandSchema,
  SendSchoolCommandSchema,
  StartCraftCommandSchema,
  StartResearchCommandSchema,
  StopGatherCommandSchema,
  UnlockSectorCommandSchema,
  type AdvanceResponse,
  type BuildResponse,
  type CancelCraftResponse,
  type CancelResearchResponse,
  type ClearCellResponse,
  type DemolishResponse,
  type GatherNodeResponse,
  type SendSchoolResponse,
  type StartCraftResponse,
  type StartResearchResponse,
  type StopGatherResponse,
  type UnlockSectorResponse
} from '@avanpost/shared';
import { SIM_VERSION } from '@avanpost/sim';
import { loadWorldBalance, type WorldBalance } from './balance';
import type { Config } from './config';
import type { DB } from './db/schema';
import {
  buildCommand,
  clearCellCommand,
  demolishCommand,
  gatherNodeCommand,
  stopGatherCommand,
  unlockSectorCommand
} from './domain/commands';
import { cancelCraftCommand, startCraftCommand } from './domain/craft';
import { sendSchoolCommand } from './domain/population';
import { cancelResearchCommand, startResearchCommand } from './domain/research';
import { createPlayerWorld } from './domain/region';
import { buildSnapshot } from './domain/snapshot';
import { syncWorldTime, type SimPolicy } from './domain/simulate';
import { AppError } from './errors';

const SESSION_COOKIE = 'avanpost_session';
const DAY_MS = 86_400_000;

interface BuildOptions {
  db: Kysely<DB>;
  config: Config;
  balance?: WorldBalance;
  now?: () => Date;
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

async function requirePlayer(
  db: Kysely<DB>,
  request: FastifyRequest,
  now: Date,
  policy: SimPolicy
): Promise<string> {
  const token = request.cookies[SESSION_COOKIE];
  if (!token) throw new AppError(401, ErrorCode.NO_SESSION, 'session cookie is missing');

  const tokenHash = hashToken(token);
  const session = await db
    .selectFrom('sessions')
    .select(['player_id', 'expires_at'])
    .where('token_hash', '=', tokenHash)
    .executeTakeFirst();

  if (!session || session.expires_at.getTime() <= now.getTime()) {
    throw new AppError(401, ErrorCode.NO_SESSION, 'session is missing or expired');
  }

  await db
    .updateTable('sessions')
    .set({ last_seen_at: now })
    .where('token_hash', '=', tokenHash)
    .execute();

  // ADR-0005: every authenticated request first brings the world up to now so
  // the caller always operates on a world that is current for its session.
  await syncWorldTime(db, session.player_id, policy, now);

  return session.player_id;
}

export async function buildApp(options: BuildOptions): Promise<FastifyInstance> {
  const { db, config } = options;
  const balance = options.balance ?? loadWorldBalance();
  const providedNow = options.now ?? (() => new Date());
  const app = Fastify({ logger: false });

  let clockOffsetMs = 0;
  const now: () => Date =
    config.testTimeControl && options.now === undefined
      ? () => new Date(Date.now() + clockOffsetMs)
      : providedNow;
  const policy: SimPolicy = {
    balance,
    config: { tickMs: config.tickMs, maxCatchupTicks: config.maxCatchupTicks }
  };

  await app.register(cookie);

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof AppError) {
      return reply.status(error.statusCode).send({
        error: { code: error.code, message: error.message }
      });
    }
    if (error instanceof z.ZodError) {
      return reply.status(400).send({
        error: {
          code: ErrorCode.VALIDATION_ERROR,
          message: error.issues[0]?.message ?? 'invalid request'
        }
      });
    }
    request.log.error(error);
    return reply.status(500).send({
      error: { code: ErrorCode.INTERNAL, message: 'internal server error' }
    });
  });

  app.get('/api/health', async () => ({
    ok: true,
    buildVersion: config.appVersion,
    simVersion: SIM_VERSION,
    balanceVersion: balance.meta.version,
    serverTime: now().toISOString()
  }));

  if (config.testTimeControl) {
    // Test-only clock control (ADR-0005). Registered solely when
    // AVANPOST_TEST_TIME_CONTROL=1 on a non-production deployment.
    app.post('/api/test/set-clock', async (request) => {
      const body = z.object({ offsetMs: z.number().int() }).parse(request.body ?? {});
      clockOffsetMs = body.offsetMs;
      return { ok: true, serverTime: now().toISOString() };
    });
  }

  app.post('/api/session', async (request, reply) => {
    const timestamp = now();
    const existingToken = request.cookies[SESSION_COOKIE];

    if (existingToken) {
      const session = await db
        .selectFrom('sessions')
        .select(['player_id', 'expires_at'])
        .where('token_hash', '=', hashToken(existingToken))
        .executeTakeFirst();
      if (session && session.expires_at.getTime() > timestamp.getTime()) {
        await db
          .updateTable('sessions')
          .set({ last_seen_at: timestamp })
          .where('token_hash', '=', hashToken(existingToken))
          .execute();
        await syncWorldTime(db, session.player_id, policy, timestamp);
        return buildSnapshot(db, session.player_id, config, balance, timestamp);
      }
    }

    const playerId = randomUUID();
    await db
      .insertInto('players')
      .values({
        id: playerId,
        created_at: timestamp,
        last_active_at: timestamp,
        current_phase: 'peace',
        display_name: null,
        research_points: 0
      })
      .execute();
    await createPlayerWorld(db, playerId, balance, timestamp);

    const token = randomBytes(32).toString('hex');
    const expiresAt = new Date(timestamp.getTime() + config.sessionDays * DAY_MS);
    await db
      .insertInto('sessions')
      .values({
        token_hash: hashToken(token),
        player_id: playerId,
        created_at: timestamp,
        last_seen_at: timestamp,
        expires_at: expiresAt
      })
      .execute();

    reply.setCookie(SESSION_COOKIE, token, {
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      secure: config.nodeEnv === 'production',
      maxAge: config.sessionDays * 86_400
    });

    return buildSnapshot(db, playerId, config, balance, timestamp);
  });

  app.get('/api/state', async (request) => {
    const timestamp = now();
    const playerId = await requirePlayer(db, request, timestamp, policy);
    return buildSnapshot(db, playerId, config, balance, timestamp);
  });

  app.post('/api/heartbeat', async (request) => {
    const timestamp = now();
    const playerId = await requirePlayer(db, request, timestamp, policy);
    await db
      .updateTable('players')
      .set({ last_active_at: timestamp })
      .where('id', '=', playerId)
      .execute();
    return { ok: true, serverTime: timestamp.toISOString() };
  });

  app.post('/api/commands/advance', async (request) => {
    // ADR-0005: the client sends no ticks. The world was already advanced to
    // server time inside requirePlayer; the endpoint is now a pure sync point.
    z.object({ request_id: z.string().uuid() }).parse(request.body ?? {});
    const timestamp = now();
    const playerId = await requirePlayer(db, request, timestamp, policy);
    const snapshot = await buildSnapshot(db, playerId, config, balance, timestamp);
    return { snapshot, replayed: false } satisfies AdvanceResponse;
  });

  app.post('/api/commands/unlock', async (request) => {
    const command = UnlockSectorCommandSchema.parse(request.body);
    const timestamp = now();
    const playerId = await requirePlayer(db, request, timestamp, policy);

    const outcome = await unlockSectorCommand(
      db,
      playerId,
      command,
      balance,
      timestamp
    );
    const snapshot = await buildSnapshot(db, playerId, config, balance, timestamp);
    return { snapshot, replayed: outcome.replayed } satisfies UnlockSectorResponse;
  });

  app.post('/api/commands/clear', async (request) => {
    const command = ClearCellCommandSchema.parse(request.body);
    const timestamp = now();
    const playerId = await requirePlayer(db, request, timestamp, policy);

    const outcome = await clearCellCommand(
      db,
      playerId,
      command,
      balance,
      timestamp
    );
    const snapshot = await buildSnapshot(db, playerId, config, balance, timestamp);
    return { snapshot, replayed: outcome.replayed } satisfies ClearCellResponse;
  });

  app.post('/api/commands/gather', async (request) => {
    const command = GatherNodeCommandSchema.parse(request.body);
    const timestamp = now();
    const playerId = await requirePlayer(db, request, timestamp, policy);

    const outcome = await gatherNodeCommand(
      db,
      playerId,
      command,
      timestamp
    );
    const snapshot = await buildSnapshot(db, playerId, config, balance, timestamp);
    return { snapshot, replayed: outcome.replayed } satisfies GatherNodeResponse;
  });

  app.post('/api/commands/build', async (request) => {
    const command = BuildCommandSchema.parse(request.body);
    const timestamp = now();
    const playerId = await requirePlayer(db, request, timestamp, policy);

    const outcome = await buildCommand(db, playerId, command, balance, timestamp);
    const snapshot = await buildSnapshot(db, playerId, config, balance, timestamp);
    return { snapshot, replayed: outcome.replayed } satisfies BuildResponse;
  });

  app.post('/api/commands/demolish', async (request) => {
    const command = DemolishCommandSchema.parse(request.body);
    const timestamp = now();
    const playerId = await requirePlayer(db, request, timestamp, policy);

    const outcome = await demolishCommand(db, playerId, command, timestamp);
    const snapshot = await buildSnapshot(db, playerId, config, balance, timestamp);
    return { snapshot, replayed: outcome.replayed } satisfies DemolishResponse;
  });

  app.post('/api/commands/stop-gather', async (request) => {
    const command = StopGatherCommandSchema.parse(request.body);
    const timestamp = now();
    const playerId = await requirePlayer(db, request, timestamp, policy);

    const outcome = await stopGatherCommand(
      db,
      playerId,
      command,
      timestamp
    );
    const snapshot = await buildSnapshot(db, playerId, config, balance, timestamp);
    return { snapshot, replayed: outcome.replayed } satisfies StopGatherResponse;
  });

  app.post('/api/commands/send-school', async (request) => {
    const command = SendSchoolCommandSchema.parse(request.body);
    const timestamp = now();
    const playerId = await requirePlayer(db, request, timestamp, policy);

    const outcome = await sendSchoolCommand(db, playerId, command, timestamp);
    const snapshot = await buildSnapshot(db, playerId, config, balance, timestamp);
    return { snapshot, replayed: outcome.replayed } satisfies SendSchoolResponse;
  });

  app.post('/api/commands/start-craft', async (request) => {
    const command = StartCraftCommandSchema.parse(request.body);
    const timestamp = now();
    const playerId = await requirePlayer(db, request, timestamp, policy);

    const outcome = await startCraftCommand(db, playerId, command, balance, timestamp);
    const snapshot = await buildSnapshot(db, playerId, config, balance, timestamp);
    return { snapshot, replayed: outcome.replayed } satisfies StartCraftResponse;
  });

  app.post('/api/commands/cancel-craft', async (request) => {
    const command = CancelCraftCommandSchema.parse(request.body);
    const timestamp = now();
    const playerId = await requirePlayer(db, request, timestamp, policy);

    const outcome = await cancelCraftCommand(db, playerId, command, timestamp);
    const snapshot = await buildSnapshot(db, playerId, config, balance, timestamp);
    return { snapshot, replayed: outcome.replayed } satisfies CancelCraftResponse;
  });

  app.post('/api/commands/start-research', async (request) => {
    const command = StartResearchCommandSchema.parse(request.body);
    const timestamp = now();
    const playerId = await requirePlayer(db, request, timestamp, policy);

    const outcome = await startResearchCommand(db, playerId, command, balance, timestamp);
    const snapshot = await buildSnapshot(db, playerId, config, balance, timestamp);
    return { snapshot, replayed: outcome.replayed } satisfies StartResearchResponse;
  });

  app.post('/api/commands/cancel-research', async (request) => {
    const command = CancelResearchCommandSchema.parse(request.body);
    const timestamp = now();
    const playerId = await requirePlayer(db, request, timestamp, policy);

    const outcome = await cancelResearchCommand(db, playerId, command, timestamp);
    const snapshot = await buildSnapshot(db, playerId, config, balance, timestamp);
    return { snapshot, replayed: outcome.replayed } satisfies CancelResearchResponse;
  });

  return app;
}
