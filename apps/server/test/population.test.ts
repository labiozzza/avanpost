import type { FastifyInstance } from 'fastify';
import type { Kysely } from 'kysely';
import type pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { SchoolId, WorldSnapshot } from '@avanpost/shared';
import { TRAINING_TICKS } from '@avanpost/sim';
import { buildApp } from '../src/app';
import { loadConfig } from '../src/config';
import { createDatabase } from '../src/db';
import { findMigrationsDir, runMigrations } from '../src/db/migrate';
import type { DB } from '../src/db/schema';

const databaseUrl =
  process.env.TEST_DATABASE_URL ??
  'postgres://avanpost:avanpost@localhost:5433/avanpost_test';

let app: FastifyInstance;
let db: Kysely<DB>;
let pool: pg.Pool;

function cookieOf(response: { headers: Record<string, unknown> }): string {
  const raw = response.headers['set-cookie'];
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (typeof value !== 'string') throw new Error('session cookie was not set');
  return value.split(';')[0] as string;
}

async function openSession(): Promise<{ cookie: string; snapshot: WorldSnapshot }> {
  const response = await app.inject({ method: 'POST', url: '/api/session' });
  expect(response.statusCode).toBe(200);
  return { cookie: cookieOf(response), snapshot: response.json<WorldSnapshot>() };
}

beforeAll(async () => {
  const handle = createDatabase(databaseUrl);
  db = handle.db;
  pool = handle.pool;
  await runMigrations(pool, findMigrationsDir());
  app = await buildApp({ db, config: loadConfig() });
  await app.ready();
});

beforeEach(async () => {
  await pool.query('TRUNCATE players RESTART IDENTITY CASCADE');
});

afterAll(async () => {
  await app?.close();
  await db?.destroy();
});

async function sendSchool(
  cookie: string,
  snapshot: WorldSnapshot,
  residentId: string,
  school: SchoolId
): Promise<WorldSnapshot> {
  const response = await app.inject({
    method: 'POST',
    url: '/api/commands/send-school',
    headers: { cookie },
    payload: {
      request_id: crypto.randomUUID(),
      expected_version: snapshot.version,
      resident_id: residentId,
      school
    }
  });
  expect(response.statusCode).toBe(200);
  return response.json<{ snapshot: WorldSnapshot }>().snapshot;
}

async function advance(
  cookie: string,
  snapshot: WorldSnapshot,
  ticks: number
): Promise<WorldSnapshot> {
  const response = await app.inject({
    method: 'POST',
    url: '/api/commands/advance',
    headers: { cookie },
    payload: { request_id: crypto.randomUUID(), expected_version: snapshot.version, ticks }
  });
  expect(response.statusCode).toBe(200);
  return response.json<{ snapshot: WorldSnapshot }>().snapshot;
}

describe('population and schools (stage I.4)', () => {
  it('seeds starting residents with distinct names and no profession', async () => {
    const { snapshot } = await openSession();
    expect(snapshot.residents).toHaveLength(3);
    for (const resident of snapshot.residents) {
      expect(resident.profession).toBe('Разнорабочий');
      expect(resident.schools).toEqual([]);
      expect(resident.state).toBe('idle');
      expect(resident.traits).toHaveLength(2);
    }
    const names = snapshot.residents.map((resident) => resident.name);
    expect(new Set(names).size).toBe(3);
  });

  it('resident swings to a new profession across both school permutations', async () => {
    const { cookie, snapshot: start } = await openSession();
    const [a, b] = start.residents;
    if (!a || !b) throw new Error('expected two residents');

    let state = await sendSchool(cookie, start, a.id, 'gather');
    expect(state.residents.find((r) => r.id === a.id)?.state).toBe('school');
    state = await advance(cookie, state, TRAINING_TICKS);
    let resident = state.residents.find((r) => r.id === a.id);
    expect(resident?.profession).toBe('Добытчик');
    expect(resident?.state).toBe('idle');
    expect(resident?.xp).toBe(1);

    state = await sendSchool(cookie, state, a.id, 'craft');
    state = await advance(cookie, state, TRAINING_TICKS);
    resident = state.residents.find((r) => r.id === a.id);
    expect(resident?.profession).toBe('Каменотёс');
    expect(resident?.schools?.slice().sort()).toEqual(['craft', 'gather']);
    expect(resident?.xp).toBe(2);

    let state2 = await sendSchool(cookie, state, b.id, 'craft');
    state2 = await advance(cookie, state2, TRAINING_TICKS);
    let resident2 = state2.residents.find((r) => r.id === b.id);
    expect(resident2?.profession).toBe('Ремесленник');

    state2 = await sendSchool(cookie, state2, b.id, 'gather');
    state2 = await advance(cookie, state2, TRAINING_TICKS);
    resident2 = state2.residents.find((r) => r.id === b.id);
    expect(resident2?.profession).toBe('Каменотёс');
  });

  it('rejects repeating a school the resident already learned (GDD 5.4)', async () => {
    const { cookie, snapshot: start } = await openSession();
    const a = start.residents[0];
    if (!a) throw new Error('expected a resident');

    let state = await sendSchool(cookie, start, a.id, 'gather');
    state = await advance(cookie, state, TRAINING_TICKS);

    const response = await app.inject({
      method: 'POST',
      url: '/api/commands/send-school',
      headers: { cookie },
      payload: {
        request_id: crypto.randomUUID(),
        expected_version: state.version,
        resident_id: a.id,
        school: 'gather'
      }
    });
    expect(response.statusCode).toBe(409);
    expect(response.json<{ error: { code: string } }>().error.code).toBe(
      'SCHOOL_ALREADY_LEARNED'
    );
  });

  it('counts down training on the server tick and persists state', async () => {
    const { cookie, snapshot: start } = await openSession();
    const a = start.residents[0];
    if (!a) throw new Error('expected a resident');

    let state = await sendSchool(cookie, start, a.id, 'gather');
    expect(state.residents[0]?.training?.totalTicks).toBe(TRAINING_TICKS);

    state = await advance(cookie, state, Math.floor(TRAINING_TICKS / 2));
    const mid = state.residents.find((r) => r.id === a.id);
    expect(mid?.state).toBe('school');
    expect(mid?.training?.leftTicks).toBe(TRAINING_TICKS - Math.floor(TRAINING_TICKS / 2));

    state = await advance(cookie, state, TRAINING_TICKS);
    const done = state.residents.find((r) => r.id === a.id);
    expect(done?.state).toBe('idle');
    expect(done?.profession).toBe('Добытчик');

    const persisted = await db
      .selectFrom('resident')
      .selectAll()
      .where('id', '=', a.id)
      .executeTakeFirstOrThrow();
    expect(persisted.profession).toBe('Добытчик');
    expect(persisted.status).toBe('idle');
    expect(persisted.xp).toBe(1);
  });

  it('ignores a replayed send-school command', async () => {
    const { cookie, snapshot: start } = await openSession();
    const a = start.residents[0];
    if (!a) throw new Error('expected a resident');
    const requestId = crypto.randomUUID();

    const payload = {
      request_id: requestId,
      expected_version: start.version,
      resident_id: a.id,
      school: 'craft' as SchoolId
    };
    const first = await app.inject({
      method: 'POST',
      url: '/api/commands/send-school',
      headers: { cookie },
      payload
    });
    const second = await app.inject({
      method: 'POST',
      url: '/api/commands/send-school',
      headers: { cookie },
      payload
    });
    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);
    expect(second.json<{ replayed: boolean }>().replayed).toBe(true);
  });
});
