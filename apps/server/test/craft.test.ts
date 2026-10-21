import type { FastifyInstance } from 'fastify';
import type { Kysely } from 'kysely';
import type pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { WorldSnapshot } from '@avanpost/shared';
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

async function openSession(): Promise<{ cookie: string; snapshot: WorldSnapshot }> {
  const response = await app.inject({ method: 'POST', url: '/api/session' });
  expect(response.statusCode).toBe(200);
  const rawHeader = response.headers['set-cookie'];
  const rawCookie = Array.isArray(rawHeader) ? rawHeader[0] : rawHeader;
  if (!rawCookie) throw new Error('session cookie was not set');
  const cookie = rawCookie.split(';')[0];
  if (!cookie) throw new Error('session cookie is empty');
  return { cookie, snapshot: response.json<WorldSnapshot>() };
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
    payload: {
      request_id: crypto.randomUUID(),
      expected_version: snapshot.version,
      ticks
    }
  });
  expect(response.statusCode).toBe(200);
  return response.json<{ snapshot: WorldSnapshot }>().snapshot;
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
  await pool.query(
    'TRUNCATE players, sessions, world_sector, world_state, terrain_cell, clearing_job, command_log, outbox_event RESTART IDENTITY CASCADE'
  );
});

afterAll(async () => {
  await app?.close();
  await db?.destroy();
});

async function placeBuilding(
  cookie: string,
  snapshot: WorldSnapshot,
  buildingType: 'workshop' | 'academy'
): Promise<WorldSnapshot> {
  const occupied = new Set([
    ...snapshot.nodes.map((node) => `${node.sectorId}:${node.x}:${node.y}`),
    ...snapshot.storages.map(
      (storage) => `${storage.sectorId}:${storage.x}:${storage.y}`
    ),
    ...snapshot.buildings.map(
      (building) => `${building.sectorId}:${building.x}:${building.y}`
    )
  ]);
  const sector = snapshot.sectors[0]!;
  const storage = snapshot.storages[0]!;
  const cell = sector.terrain
    .filter(
      (terrain) =>
        terrain.reachable &&
        terrain.passable &&
        !occupied.has(`${sector.id}:${terrain.x}:${terrain.y}`) &&
        Math.max(Math.abs(terrain.x - storage.x), Math.abs(terrain.y - storage.y)) <= 5
    )
    .sort(
      (left, right) =>
        Math.max(Math.abs(left.x - storage.x), Math.abs(left.y - storage.y)) -
        Math.max(Math.abs(right.x - storage.x), Math.abs(right.y - storage.y))
    )[0];
  expect(cell).toBeDefined();
  const response = await app.inject({
    method: 'POST',
    url: '/api/commands/build',
    headers: { cookie },
    payload: {
      request_id: crypto.randomUUID(),
      expected_version: snapshot.version,
      building_type: buildingType,
      sector_id: sector.id,
      x: cell!.x,
      y: cell!.y
    }
  });
  expect(response.statusCode).toBe(200);
  return response.json<{ snapshot: WorldSnapshot }>().snapshot;
}

async function placeWorkshop(
  cookie: string,
  snapshot: WorldSnapshot
): Promise<WorldSnapshot> {
  return placeBuilding(cookie, snapshot, 'workshop');
}

describe('craft and research (stage I.5)', () => {
  it('exposes recipes, an empty tech tree and a disabled research slot by default', async () => {
    const { snapshot } = await openSession();
    expect(snapshot.catalog.recipes.map((recipe) => recipe.id)).toContain('planks');
    expect(snapshot.techTree.map((node) => node.id)).toEqual(['carpentry', 'masonry']);
    expect(snapshot.techTree[0]?.available).toBe(true);
    expect(snapshot.techTree[1]?.available).toBe(false);
    expect(snapshot.research.active).toBeNull();
    expect(snapshot.research.researched).toEqual([]);
    expect(snapshot.craftOrders).toEqual([]);
  });

  it('refuses to craft before the recipe technology is researched', async () => {
    const { cookie, snapshot } = await openSession();
    let current = await placeWorkshop(cookie, snapshot);
    for (let i = 0; i < 3; i += 1) current = await advance(cookie, current, 60);

    const workshop = current.buildings.find((building) => building.type === 'workshop')!;
    expect(workshop.status).toBe('complete');

    const locked = await app.inject({
      method: 'POST',
      url: '/api/commands/start-craft',
      headers: { cookie },
      payload: {
        request_id: crypto.randomUUID(),
        expected_version: current.version,
        building_id: workshop.id,
        recipe_id: 'planks',
        worker_id: current.residents[0]!.id
      }
    });
    expect(locked.statusCode).toBe(409);
    expect(locked.json<{ error: { code: string } }>().error.code).toBe('RECIPE_LOCKED');
  });

  it('does not accrue research points without a scholar', async () => {
    const { cookie, snapshot } = await openSession();
    const started = await app.inject({
      method: 'POST',
      url: '/api/commands/start-research',
      headers: { cookie },
      payload: {
        request_id: crypto.randomUUID(),
        expected_version: snapshot.version,
        technology_id: 'carpentry'
      }
    });
    expect(started.statusCode).toBe(200);
    let current = started.json<{ snapshot: WorldSnapshot }>().snapshot;
    expect(current.research.active?.status).toBe('paused');

    current = await advance(cookie, current, 30);
    expect(current.research.points).toBe(0);
    expect(current.research.active?.progress).toBe(0);
    expect(current.research.researched).toEqual([]);
  });

  it('researches carpentry then crafts planks on the workshop', async () => {
    const { cookie, snapshot } = await openSession();

    // Seed plenty of logs so buffer delivery can run.
    await db
      .updateTable('storage_item')
      .set({ qty: 30 })
      .where('item', '=', 'logs')
      .execute();

    // Bring the workshop to completion.
    let current = await placeWorkshop(cookie, snapshot);
    for (let i = 0; i < 3; i += 1) current = await advance(cookie, current, 60);
    const workshop = current.buildings.find((building) => building.type === 'workshop')!;
    expect(workshop.status).toBe('complete');

    current = await placeBuilding(cookie, current, 'academy');
    for (let i = 0; i < 6; i += 1) current = await advance(cookie, current, 60);
    expect(current.buildings.find((building) => building.type === 'academy')?.status).toBe(
      'complete'
    );

    // Train a resident into a Ремесленник at the craft school.
    const trainee = current.residents[0]!;
    const school = await app.inject({
      method: 'POST',
      url: '/api/commands/send-school',
      headers: { cookie },
      payload: {
        request_id: crypto.randomUUID(),
        expected_version: current.version,
        resident_id: trainee.id,
        school: 'craft'
      }
    });
    expect(school.statusCode).toBe(200);
    current = school.json<{ snapshot: WorldSnapshot }>().snapshot;
    current = await advance(cookie, current, 40);
    const craftsman = current.residents.find((resident) => resident.id === trainee.id)!;
    expect(craftsman.profession).toBe('Ремесленник');

    // Research carpentry with that resident as the scholar.
    const research = await app.inject({
      method: 'POST',
      url: '/api/commands/start-research',
      headers: { cookie },
      payload: {
        request_id: crypto.randomUUID(),
        expected_version: current.version,
        technology_id: 'carpentry',
        scholar_id: craftsman.id
      }
    });
    expect(research.statusCode).toBe(200);
    current = research.json<{ snapshot: WorldSnapshot }>().snapshot;
    expect(current.research.active?.status).toBe('active');

    current = await advance(cookie, current, 25);
    expect(current.research.researched).toContain('carpentry');
    expect(current.research.points).toBe(20);
    const masonry = current.techTree.find((node) => node.id === 'masonry')!;
    expect(masonry.available).toBe(true);

    // Start crafting planks and let carriers deliver logs and haul planks.
    const start = await app.inject({
      method: 'POST',
      url: '/api/commands/start-craft',
      headers: { cookie },
      payload: {
        request_id: crypto.randomUUID(),
        expected_version: current.version,
        building_id: workshop.id,
        recipe_id: 'planks',
        worker_id: craftsman.id
      }
    });
    expect(start.statusCode).toBe(200);
    current = start.json<{ snapshot: WorldSnapshot }>().snapshot;

    const planksBefore = current.storages
      .flatMap((storage) => storage.contents)
      .filter((item) => item.item === 'planks')
      .reduce((sum, item) => sum + item.qty, 0);
    const logsBefore = current.storages
      .flatMap((storage) => storage.contents)
      .filter((item) => item.item === 'logs')
      .reduce((sum, item) => sum + item.qty, 0);

    for (let i = 0; i < 60; i += 1) current = await advance(cookie, current, 1);

    const planks = current.storages
      .flatMap((storage) => storage.contents)
      .filter((item) => item.item === 'planks')
      .reduce((sum, item) => sum + item.qty, 0);
    expect(planks).toBe(planksBefore + 1);
    const logs = current.storages
      .flatMap((storage) => storage.contents)
      .filter((item) => item.item === 'logs')
      .reduce((sum, item) => sum + item.qty, 0);
    expect(logs).toBe(logsBefore - 2);
    expect(current.techTree.find((node) => node.id === 'carpentry')?.researched).toBe(
      true
    );

    const masonryStart = await app.inject({
      method: 'POST',
      url: '/api/commands/start-research',
      headers: { cookie },
      payload: {
        request_id: crypto.randomUUID(),
        expected_version: current.version,
        technology_id: 'masonry',
        scholar_id: craftsman.id
      }
    });
    expect(masonryStart.statusCode).toBe(200);
    current = masonryStart.json<{ snapshot: WorldSnapshot }>().snapshot;
    current = await advance(cookie, current, 1);
    expect(current.research.points).toBe(21);
  });

  it('requires an assigned worker to start crafting', async () => {
    const { cookie, snapshot } = await openSession();
    const response = await app.inject({
      method: 'POST',
      url: '/api/commands/start-craft',
      headers: { cookie },
      payload: {
        request_id: crypto.randomUUID(),
        expected_version: snapshot.version,
        building_id: crypto.randomUUID(),
        recipe_id: 'planks'
      }
    });
    expect(response.statusCode).toBe(400);
  });

  it('rejects a worker whose profession does not match the recipe', async () => {
    const { cookie, snapshot } = await openSession();
    await db
      .updateTable('storage_item')
      .set({ qty: 30 })
      .where('item', '=', 'logs')
      .execute();

    let current = await placeWorkshop(cookie, snapshot);
    for (let i = 0; i < 3; i += 1) current = await advance(cookie, current, 60);
    const workshop = current.buildings.find((building) => building.type === 'workshop')!;

    // Research carpentry without a scholar (no RP) — craft stays locked, so we
    // first mark the technology directly to isolate the profession check.
    await db
      .insertInto('researched_technology')
      .values({
        owner_id: snapshot.player.id,
        technology_id: 'carpentry',
        researched_at: new Date()
      })
      .execute();

    const laborer = current.residents.find(
      (resident) => resident.profession !== 'Ремесленник'
    )!;
    const response = await app.inject({
      method: 'POST',
      url: '/api/commands/start-craft',
      headers: { cookie },
      payload: {
        request_id: crypto.randomUUID(),
        expected_version: current.version,
        building_id: workshop.id,
        recipe_id: 'planks',
        worker_id: laborer.id
      }
    });
    expect(response.statusCode).toBe(409);
    expect(response.json<{ error: { code: string } }>().error.code).toBe(
      'WRONG_PROFESSION'
    );
  });

  it('validates the tech tree as an acyclic graph with resolvable references', async () => {
    const { snapshot } = await openSession();
    const ids = new Set(snapshot.techTree.map((node) => node.id));
    const roots = snapshot.techTree.filter((node) => node.root);
    expect(roots.length).toBe(1);
    expect(roots[0]?.requires).toEqual([]);
    const adjacency = new Map<string, string[]>();
    for (const node of snapshot.techTree) {
      for (const requirement of node.requires) {
        expect(ids.has(requirement)).toBe(true);
        adjacency.set(requirement, [...(adjacency.get(requirement) ?? []), node.id]);
      }
    }
    // Depth-first cycle check.
    const visiting = new Set<string>();
    const visited = new Set<string>();
    const walk = (id: string): void => {
      if (visiting.has(id)) throw new Error(`cycle at ${id}`);
      if (visited.has(id)) return;
      visiting.add(id);
      for (const next of adjacency.get(id) ?? []) walk(next);
      visiting.delete(id);
      visited.add(id);
    };
    for (const node of snapshot.techTree) walk(node.id);
  });
});
