import type { FastifyInstance } from 'fastify';
import type { Kysely } from 'kysely';
import type pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { SchoolId, WorldSnapshot } from '@avanpost/shared';
import { TRAINING_TICKS } from '@avanpost/sim';
import { loadWorldBalance } from '../src/balance';
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
const XP_PER_SCHOOL = loadWorldBalance().xp.xpPerSchool;

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
    expect(resident?.xp).toBe(XP_PER_SCHOOL);

    state = await sendSchool(cookie, state, a.id, 'craft');
    state = await advance(cookie, state, TRAINING_TICKS);
    resident = state.residents.find((r) => r.id === a.id);
    expect(resident?.profession).toBe('Каменотёс');
    expect(resident?.schools?.slice().sort()).toEqual(['craft', 'gather']);
    expect(resident?.xp).toBe(XP_PER_SCHOOL * 2);

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
    expect(persisted.xp).toBe(XP_PER_SCHOOL);
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

describe('housing capacity and migration (stage I.4)', () => {
  async function insertHouse(playerId: string, sectorId: string, x: number, y: number) {
    await db
      .insertInto('building')
      .values({
        id: crypto.randomUUID(),
        owner_id: playerId,
        sector_id: sectorId,
        type: 'house',
        x,
        y,
        status: 'complete',
        work_done: 24,
        work_required: 24,
        workers_limit: 2,
        builder_id: null,
        created_at: new Date(),
        updated_at: new Date(),
        completed_at: new Date()
      })
      .execute();
  }

  it('reports capacity and free slots in the snapshot', async () => {
    const { snapshot } = await openSession();
    expect(snapshot.population.residents).toBe(3);
    expect(snapshot.population.capacity).toBe(3);
    expect(snapshot.population.freeSlots).toBe(0);
    expect(snapshot.population.migrationEnabled).toBe(true);
  });

  it('does not grow population while there is no free living space (test 15)', async () => {
    const { cookie, snapshot } = await openSession();
    let state = await advance(cookie, snapshot, 60);
    expect(state.residents).toHaveLength(3);
    expect(state.population.freeSlots).toBe(0);
  });

  it('arrives a new resident when a house frees a slot, and binds a laborer', async () => {
    const { cookie, snapshot } = await openSession();
    const sectorId = snapshot.sectors[0]?.id;
    if (!sectorId) throw new Error('expected a sector');
    await insertHouse(snapshot.player.id, sectorId, 4, 4);

    const afterBuilt = await advance(cookie, snapshot, 1);
    expect(afterBuilt.population.capacity).toBe(5);
    expect(afterBuilt.population.freeSlots).toBe(2);

    const state = await advance(cookie, afterBuilt, 40);
    expect(state.residents).toHaveLength(4);
    const newcomer = state.residents.find((r) => r.laborerId !== null && r.xp === 0);
    expect(newcomer).toBeDefined();
    const bound = state.laborers.find((l) => l.residentId === newcomer?.id);
    expect(bound).toBeDefined();
  });

  it('stops migrating once capacity is filled again (test 15)', async () => {
    const { cookie, snapshot } = await openSession();
    const sectorId = snapshot.sectors[0]?.id;
    if (!sectorId) throw new Error('expected a sector');
    await insertHouse(snapshot.player.id, sectorId, 6, 6);

    let state = await advance(cookie, snapshot, 1);
    // Capacity 5, residents 3 -> two arrivals max.
    state = await advance(cookie, state, 60);
    state = await advance(cookie, state, 60);
    state = await advance(cookie, state, 60);
    state = await advance(cookie, state, 60);
    expect(state.residents.length).toBeLessThanOrEqual(5);
    expect(state.residents.length).toBeGreaterThan(3);
    expect(state.population.freeSlots).toBe(5 - state.residents.length);
  });
});

describe('XP from real work (stage I.4, D1=A)', () => {
  it('credits the bound resident when their gatherer extracts a resource', async () => {
    const { cookie, snapshot } = await openSession();
    const forest = snapshot.nodes.find((node) => node.kind === 'forest');
    if (!forest) throw new Error('expected a forest node');

    const gather = await app.inject({
      method: 'POST',
      url: '/api/commands/gather',
      headers: { cookie },
      payload: {
        request_id: crypto.randomUUID(),
        expected_version: snapshot.version,
        node_id: forest.id
      }
    });
    if (gather.statusCode !== 200) throw new Error(`gather: ${gather.body}`);
    expect(gather.statusCode).toBe(200);

    let state = gather.json<{ snapshot: WorldSnapshot }>().snapshot;
    for (let step = 0; step < 5; step += 1) {
      state = await advance(cookie, state, 30);
    }

    const worker = state.laborers.find((laborer) => laborer.role === 'gatherer');
    expect(worker?.residentId).toBeTruthy();
    const resident = state.residents.find((r) => r.id === worker?.residentId);
    expect(resident?.xp).toBeGreaterThan(0);
  });
});
