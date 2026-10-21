import type { FastifyInstance } from 'fastify';
import type { Kysely } from 'kysely';
import type pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { WorldSnapshot } from '@avanpost/shared';
import { buildApp } from '../src/app';
import { loadConfig, type Config } from '../src/config';
import { createDatabase } from '../src/db';
import { findMigrationsDir, runMigrations } from '../src/db/migrate';
import type { DB } from '../src/db/schema';
import { advanceServerTime, TestClock } from './helpers';

const databaseUrl =
  process.env.TEST_DATABASE_URL ??
  'postgres://avanpost:avanpost@localhost:5433/avanpost_test';

let app: FastifyInstance;
let db: Kysely<DB>;
let pool: pg.Pool;
let config: Config;
const clock = new TestClock();

async function advanceWorld(
  cookie: string,
  snapshot: WorldSnapshot,
  ticks: number
): Promise<WorldSnapshot> {
  return advanceServerTime(app, cookie, clock, snapshot, ticks);
}

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

beforeAll(async () => {
  const handle = createDatabase(databaseUrl);
  db = handle.db;
  pool = handle.pool;
  await runMigrations(pool, findMigrationsDir());
  config = loadConfig();
  clock.setTickDuration(config.tickMs);
  app = await buildApp({ db, config, now: clock.now });
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

describe('identity and snapshot', () => {
  it('rejects state without a session', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/state' });
    expect(response.statusCode).toBe(401);
    expect(response.json<{ error: { code: string } }>().error.code).toBe('NO_SESSION');
  });

  it('creates a player, a sector and terrain on first session', async () => {
    const { snapshot } = await openSession();
    expect(snapshot.player.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(snapshot.tick).toBe(0);
    expect(snapshot.version).toBe(0);
    expect(snapshot.sectors).toHaveLength(1);
    expect(snapshot.sectors[0]?.terrain).toHaveLength(64 * 24);

    const count = await db
      .selectFrom('players')
      .select((expression) => expression.fn.countAll<string>().as('count'))
      .executeTakeFirstOrThrow();
    expect(count.count).toBe('1');
  });

  it('returns the same player for the same session cookie', async () => {
    const { cookie, snapshot } = await openSession();
    const response = await app.inject({
      method: 'POST',
      url: '/api/session',
      headers: { cookie }
    });
    expect(response.statusCode).toBe(200);
    expect(response.json<WorldSnapshot>().player.id).toBe(snapshot.player.id);

    const count = await db
      .selectFrom('players')
      .select((expression) => expression.fn.countAll<string>().as('count'))
      .executeTakeFirstOrThrow();
    expect(count.count).toBe('1');
  });
});

describe('advance command', () => {
  it('advances the world from server time (client cannot set ticks)', async () => {
    const { cookie, snapshot } = await openSession();
    clock.advanceTicks(2);
    const response = await app.inject({
      method: 'POST',
      url: '/api/commands/advance',
      headers: { cookie },
      payload: { request_id: crypto.randomUUID(), expected_version: snapshot.version }
    });

    expect(response.statusCode).toBe(200);
    const body = response.json<{ snapshot: WorldSnapshot }>();
    expect(body.snapshot.tick).toBe(2);
    expect(body.snapshot.version).toBe(snapshot.version);

    const state = await db.selectFrom('world_state').selectAll().executeTakeFirstOrThrow();
    expect(state.tick).toBe(2);
  });

  it('ignores client-supplied ticks payloads', async () => {
    const { cookie } = await openSession();
    const base = { request_id: crypto.randomUUID(), expected_version: 0, ticks: 60 };
    const response = await app.inject({
      method: 'POST',
      url: '/api/commands/advance',
      headers: { cookie },
      payload: base
    });

    expect(response.statusCode).toBe(200);
    const body = response.json<{ snapshot: WorldSnapshot }>();
    expect(body.snapshot.tick).toBe(0);
  });

  it('does not award extra progress for repeated advance requests', async () => {
    const { cookie, snapshot } = await openSession();
    const payload = { request_id: crypto.randomUUID(), expected_version: snapshot.version };

    clock.advanceTicks(1);
    const first = await app.inject({
      method: 'POST',
      url: '/api/commands/advance',
      headers: { cookie },
      payload
    });
    expect(first.json<{ snapshot: WorldSnapshot }>().snapshot.tick).toBe(1);

    const second = await app.inject({
      method: 'POST',
      url: '/api/commands/advance',
      headers: { cookie },
      payload
    });
    expect(second.json<{ snapshot: WorldSnapshot }>().snapshot.tick).toBe(1);

    clock.advanceTicks(5);
    const third = await app.inject({
      method: 'POST',
      url: '/api/commands/advance',
      headers: { cookie },
      payload
    });
    expect(third.json<{ snapshot: WorldSnapshot }>().snapshot.tick).toBe(6);
  });

  it('rejects a stale expected_version on mutating commands', async () => {
    const { cookie, snapshot } = await openSession();
    const first = await app.inject({
      method: 'POST',
      url: '/api/commands/unlock',
      headers: { cookie },
      payload: {
        request_id: crypto.randomUUID(),
        expected_version: snapshot.version,
        sector_x: 1,
        sector_y: 0
      }
    });
    expect(first.statusCode).toBe(200);

    const second = await app.inject({
      method: 'POST',
      url: '/api/commands/unlock',
      headers: { cookie },
      payload: {
        request_id: crypto.randomUUID(),
        expected_version: snapshot.version,
        sector_x: 0,
        sector_y: 1
      }
    });
    expect(second.statusCode).toBe(409);
    expect(second.json<{ error: { code: string } }>().error.code).toBe('STALE_VERSION');
  });

  it('rejects an invalid command payload', async () => {
    const { cookie } = await openSession();
    const response = await app.inject({
      method: 'POST',
      url: '/api/commands/advance',
      headers: { cookie },
      payload: { request_id: 'not-a-uuid' }
    });

    expect(response.statusCode).toBe(400);
    expect(response.json<{ error: { code: string } }>().error.code).toBe('VALIDATION_ERROR');
  });
});


function findReachableClearable(snapshot: WorldSnapshot) {
  const sector = snapshot.sectors[0]!;
  const reachable = new Map(
    sector.terrain.map((cell) => [`${cell.x}:${cell.y}`, cell.reachable])
  );
  return sector.terrain.find(
    (cell) =>
      cell.clearable &&
      !cell.passable &&
      (
        [
          [1, 0],
          [-1, 0],
          [0, 1],
          [0, -1]
        ] as const
      ).some(([dx, dy]) => reachable.get(`${cell.x + dx}:${cell.y + dy}`))
  );
}

describe('offline catch-up (ADR-0005)', () => {
  it('cups long absences at maxCatchupTicks and picks the rest up later', async () => {
    const { cookie, snapshot } = await openSession();
    // 10000 ticks requested, default cap is 5000: the world widens the gap but
    // never processes more than the budget in one go.
    clock.advanceTicks(10000);
    const response = await app.inject({
      method: 'POST',
      url: '/api/commands/advance',
      headers: { cookie },
      payload: { request_id: crypto.randomUUID(), expected_version: snapshot.version }
    });
    expect(response.statusCode).toBe(200);
    expect(response.json<{ snapshot: WorldSnapshot }>().snapshot.tick).toBe(5000);

    const second = await app.inject({
      method: 'POST',
      url: '/api/commands/advance',
      headers: { cookie },
      payload: { request_id: crypto.randomUUID(), expected_version: snapshot.version }
    });
    expect(second.json<{ snapshot: WorldSnapshot }>().snapshot.tick).toBe(10000);
  });

  it('processes the same 100 ticks in one visit as in a hundred visits', async () => {
    const advanceOnce = async (cookie: string): Promise<number> => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/commands/advance',
        headers: { cookie },
        payload: { request_id: crypto.randomUUID(), expected_version: 0 }
      });
      expect(response.statusCode).toBe(200);
      return response.json<{ snapshot: WorldSnapshot }>().snapshot.tick;
    };

    const batchedSession = await openSession();
    clock.advanceTicks(50);
    const batched = await advanceOnce(batchedSession.cookie);
    clock.advanceTicks(50);
    const afterBatched = await advanceOnce(batchedSession.cookie);

    const gradualSession = await openSession();
    let gradual = 0;
    for (let i = 0; i < 100; i += 1) {
      clock.advanceTicks(1);
      gradual = await advanceOnce(gradualSession.cookie);
    }

    expect(batched).toBe(50);
    expect(afterBatched).toBe(100);
    expect(gradual).toBe(100);
    // Same observable structure regardless of visit pattern.
    expect(gradualSession.snapshot.residents).toHaveLength(
      batchedSession.snapshot.residents.length
    );
  });
});

describe('region (stage I.1)', () => {
  it('snapshot exposes the catalog, frontier, stats and terrain flags', async () => {
    const { snapshot } = await openSession();
    expect(snapshot.catalog.balanceVersion).toBe('1');
    expect(snapshot.catalog.provenance).toBe('proposed');
    expect(snapshot.catalog.terrains.map((terrain) => terrain.id)).toEqual([
      'grass',
      'soil',
      'forest',
      'scree',
      'rock',
      'water'
    ]);
    expect(snapshot.catalog.biomes.length).toBeGreaterThanOrEqual(4);
    expect(snapshot.frontier.length).toBeGreaterThanOrEqual(2);
    expect(snapshot.stats.sectors).toBe(1);
    expect(snapshot.stats.cells).toBe(64 * 24);
    expect(snapshot.stats.reachable).toBeGreaterThan(0);
    expect(snapshot.stats.cartReachable).toBeGreaterThan(0);
    expect(snapshot.stats.cartReachable).toBeLessThan(snapshot.stats.reachable);
    expect(snapshot.sectors[0]?.status).toBe('prepared');

    const blocked = snapshot.sectors[0]?.terrain.filter((cell) => !cell.passable) ?? [];
    expect(blocked.length).toBeGreaterThan(0);
    const rock = blocked.find((cell) => cell.type === 'rock');
    expect(rock?.clearable).toBe(true);
  });

  it('unlocks a reachable adjacent sector and keeps the frontier consistent', async () => {
    const { cookie, snapshot } = await openSession();
    const expectedVersion = snapshot.version;

    let unlocked = false;
    for (const candidate of snapshot.frontier.slice(0, 12)) {
      const response = await app.inject({
        method: 'POST',
        url: '/api/commands/unlock',
        headers: { cookie },
        payload: {
          request_id: crypto.randomUUID(),
          expected_version: expectedVersion,
          sector_x: candidate.x,
          sector_y: candidate.y
        }
      });
      if (response.statusCode === 200) {
        const body = response.json<{ snapshot: WorldSnapshot; replayed: boolean }>();
        expect(body.replayed).toBe(false);
        expect(body.snapshot.sectors).toHaveLength(2);
        expect(body.snapshot.version).toBe(expectedVersion + 1);
        const added = body.snapshot.sectors.find(
          (sector) => sector.x === candidate.x && sector.y === candidate.y
        );
        expect(added?.terrain).toHaveLength(64 * 24);
        expect(added?.biome).toBe(candidate.biome);
        expect(
          body.snapshot.frontier.some(
            (sector) => sector.x === candidate.x && sector.y === candidate.y
          )
        ).toBe(false);
        unlocked = true;
        break;
      }
      const error = response.json<{ error: { code: string } }>().error.code;
      expect(error).toBe('PATH_BLOCKED');
    }

    expect(unlocked).toBe(true);
  });

  it('rejects an unlock that is not adjacent', async () => {
    const { cookie, snapshot } = await openSession();
    const response = await app.inject({
      method: 'POST',
      url: '/api/commands/unlock',
      headers: { cookie },
      payload: {
        request_id: crypto.randomUUID(),
        expected_version: snapshot.version,
        sector_x: 2,
        sector_y: 0
      }
    });
    expect(response.statusCode).toBe(409);
    expect(response.json<{ error: { code: string } }>().error.code).toBe('NOT_ADJACENT');
  });

  it('starts and completes a clearing job through advance ticks', async () => {
    const { cookie, snapshot } = await openSession();
    const sector = snapshot.sectors[0]!;
    const target = findReachableClearable(snapshot);
    expect(target).toBeDefined();

    const start = await app.inject({
      method: 'POST',
      url: '/api/commands/clear',
      headers: { cookie },
      payload: {
        request_id: crypto.randomUUID(),
        expected_version: snapshot.version,
        sector_id: sector.id,
        x: target!.x,
        y: target!.y
      }
    });
    expect(start.statusCode).toBe(200);
    const started = start.json<{ snapshot: WorldSnapshot }>().snapshot;
    expect(started.version).toBe(snapshot.version + 1);
    const task = started.clearingTasks.find(
      (item) => item.x === target!.x && item.y === target!.y
    );
    expect(task?.active).toBe(true);
    expect(task?.workRequired).toBeGreaterThan(0);

    const ticks = Math.ceil((task!.workRequired + 3) / 4);
    const done = await advanceWorld(cookie, started, ticks);
    const cleared = done.sectors[0]?.terrain.find(
      (cell) => cell.x === target!.x && cell.y === target!.y
    );
    expect(cleared?.type).toBe('soil');
    expect(cleared?.passable).toBe(true);
    expect(cleared?.clearing).toBeNull();
    expect(done.clearingTasks.some((item) => item.x === target!.x && item.y === target!.y)).toBe(false);
    expect(done.stats.clearedCells).toBe(1);

    const jobs = await db.selectFrom('clearing_job').selectAll().execute();
    expect(jobs).toHaveLength(1);
    expect(jobs[0]?.status).toBe('done');
  });

  it('rejects clearing a cell with no reachable neighbor', async () => {
    const { cookie, snapshot } = await openSession();
    const sector = snapshot.sectors[0]!;
    const x = 5;
    const y = 5;
    const wall = [
      [x, y],
      [x + 1, y],
      [x - 1, y],
      [x, y + 1],
      [x, y - 1]
    ];
    for (const [cx, cy] of wall) {
      await pool.query(
        "UPDATE terrain_cell SET terrain_type = 'rock', obstacle = true, passable = false WHERE sector_id = $1 AND x = $2 AND y = $3",
        [sector.id, cx, cy]
      );
    }

    const response = await app.inject({
      method: 'POST',
      url: '/api/commands/clear',
      headers: { cookie },
      payload: {
        request_id: crypto.randomUUID(),
        expected_version: snapshot.version,
        sector_id: sector.id,
        x,
        y
      }
    });
    expect(response.statusCode).toBe(409);
    expect(response.json<{ error: { code: string } }>().error.code).toBe('PATH_BLOCKED');
  });

  it('rejects an uncleareable terrain and a duplicate clearing job', async () => {
    const { cookie, snapshot } = await openSession();
    const sector = snapshot.sectors[0]!;
    const grass = sector.terrain.find((cell) => cell.type === 'grass');
    expect(grass).toBeDefined();

    const notClearable = await app.inject({
      method: 'POST',
      url: '/api/commands/clear',
      headers: { cookie },
      payload: {
        request_id: crypto.randomUUID(),
        expected_version: snapshot.version,
        sector_id: sector.id,
        x: grass!.x,
        y: grass!.y
      }
    });
    expect(notClearable.statusCode).toBe(409);
    expect(notClearable.json<{ error: { code: string } }>().error.code).toBe('NOT_CLEARABLE');

    const rock = findReachableClearable(snapshot)!;
    const first = await app.inject({
      method: 'POST',
      url: '/api/commands/clear',
      headers: { cookie },
      payload: {
        request_id: crypto.randomUUID(),
        expected_version: snapshot.version,
        sector_id: sector.id,
        x: rock.x,
        y: rock.y
      }
    });
    expect(first.statusCode).toBe(200);
    const version = first.json<{ snapshot: WorldSnapshot }>().snapshot.version;

    const duplicate = await app.inject({
      method: 'POST',
      url: '/api/commands/clear',
      headers: { cookie },
      payload: {
        request_id: crypto.randomUUID(),
        expected_version: version,
        sector_id: sector.id,
        x: rock.x,
        y: rock.y
      }
    });
    expect(duplicate.statusCode).toBe(409);
    expect(duplicate.json<{ error: { code: string } }>().error.code).toBe(
      'CLEARING_ALREADY_STARTED'
    );
  });
});

describe('economy (stage I.2)', () => {
  it('creates warehouses, starting stock, nodes and laborers', async () => {
    const { snapshot } = await openSession();
    expect(snapshot.economyEnabled).toBe(true);
    expect(snapshot.storages).toHaveLength(3);
    expect(snapshot.storages.map((storage) => storage.type).sort()).toEqual([
      'granary',
      'stockpile',
      'warehouse'
    ]);
    expect(snapshot.storages.reduce((total, storage) => total + storage.volume, 0)).toBe(116);
    expect(snapshot.nodes.map((node) => node.kind).sort()).toEqual([
      'clay',
      'field',
      'forest',
      'stone',
      'well'
    ]);
    expect(snapshot.nodes.every((node) => node.amount === node.maxAmount)).toBe(true);
    expect(snapshot.laborers.filter((laborer) => laborer.role === 'carrier')).toHaveLength(2);
    expect(
      snapshot.laborers.filter(
        (laborer) => laborer.role === 'carrier' && laborer.transport === 'cart'
      )
    ).toHaveLength(1);
    expect(
      snapshot.laborers.filter(
        (laborer) => laborer.role === 'carrier' && laborer.transport === 'person'
      )
    ).toHaveLength(1);
    expect(snapshot.laborers.filter((laborer) => laborer.role === 'gatherer')).toHaveLength(1);
    expect(snapshot.laborers.filter((laborer) => laborer.role === 'builder')).toHaveLength(1);
    expect(snapshot.stats.storageCapacity).toBe(1300);
    expect(snapshot.stats.idleCarriers).toBe(2);
    expect(snapshot.stats.idleBuilders).toBe(1);
    expect(snapshot.catalog.buildings.map((building) => building.id)).toEqual([
      'academy',
      'house',
      'road',
      'stairs',
      'storehouse',
      'workshop'
    ]);
    expect(snapshot.stats.activeNodes).toBe(0);
  });

  it('gathers into the node buffer and hauls logs into the warehouse', async () => {
    const { cookie, snapshot } = await openSession();
    const forest = snapshot.nodes.find((node) => node.kind === 'forest')!;
    const warehouse = snapshot.storages.find((storage) => storage.type === 'warehouse')!;

    const gather = await app.inject({
      method: 'POST',
      url: '/api/commands/gather',
      headers: { cookie },
      payload: {
        request_id: crypto.randomUUID(),
        expected_version: 0,
        node_id: forest.id
      }
    });
    expect(gather.statusCode).toBe(200);
    const gathered = gather.json<{ snapshot: WorldSnapshot }>().snapshot;
    expect(gathered.nodes.find((node) => node.id === forest.id)?.active).toBe(true);
    expect(gathered.stats.activeNodes).toBe(1);

    const hauling = await advanceWorld(cookie, gathered, 1);
    expect(hauling.haulTasks.length).toBeGreaterThan(0);
    expect(hauling.storages.find((storage) => storage.id === warehouse.id)?.reserved).toBeGreaterThan(0);

    const delivered = await advanceWorld(cookie, hauling, 60);
    const logs = delivered.storages
      .find((storage) => storage.id === warehouse.id)
      ?.contents.find((item) => item.item === 'logs')?.qty;
    expect(logs).toBeGreaterThanOrEqual(10);

    // Under continuous per-tick simulation the node keeps producing, so the
    // planner may keep a haul in flight. Stop gathering and let the world
    // settle before asserting a drained pipeline.
    const stop = await app.inject({
      method: 'POST',
      url: '/api/commands/stop-gather',
      headers: { cookie },
      payload: {
        request_id: crypto.randomUUID(),
        expected_version: delivered.version,
        node_id: forest.id
      }
    });
    expect(stop.statusCode).toBe(200);
    const settled = await advanceWorld(
      cookie,
      stop.json<{ snapshot: WorldSnapshot }>().snapshot,
      60
    );
    expect(settled.storages.find((storage) => storage.id === warehouse.id)?.reserved).toBe(0);
    expect(settled.stats.activeHauls).toBe(0);
    expect(settled.laborers.every((laborer) => laborer.status !== 'hauling')).toBe(true);
  });

  it('hauls a larger batch with the cart transport', async () => {
    const { cookie, snapshot } = await openSession();
    const forest = snapshot.nodes.find((node) => node.kind === 'forest')!;
    const cart = snapshot.laborers.find(
      (laborer) => laborer.role === 'carrier' && laborer.transport === 'cart'
    )!;

    await db
      .updateTable('resource_node')
      .set({ buffer: 20 })
      .where('id', '=', forest.id)
      .execute();

    const current = await advanceWorld(cookie, snapshot, 1);

    const task = current.haulTasks.find((haul) => haul.carrierId === cart.id);
    expect(task?.qty).toBe(20);
    expect(task?.path.length).toBeGreaterThan(1);
    expect(current.laborers.find((laborer) => laborer.id === cart.id)?.status).toBe(
      'hauling'
    );
  });

  it('builds from delivered materials, opens the road and salvages on demolition', async () => {
    const { cookie, snapshot } = await openSession();
    const occupied = new Set([
      ...snapshot.nodes.map((node) => `${node.sectorId}:${node.x}:${node.y}`),
      ...snapshot.storages.map((storage) => `${storage.sectorId}:${storage.x}:${storage.y}`)
    ]);
    const sector = snapshot.sectors[0]!;
    const cell = sector.terrain.find(
      (terrain) =>
        terrain.reachable &&
        terrain.passable &&
        !occupied.has(`${sector.id}:${terrain.x}:${terrain.y}`)
    );
    expect(cell).toBeDefined();

    const placedResponse = await app.inject({
      method: 'POST',
      url: '/api/commands/build',
      headers: { cookie },
      payload: {
        request_id: crypto.randomUUID(),
        expected_version: snapshot.version,
        building_type: 'road',
        sector_id: sector.id,
        x: cell!.x,
        y: cell!.y
      }
    });
    expect(placedResponse.statusCode).toBe(200);
    const placed = placedResponse.json<{ snapshot: WorldSnapshot }>().snapshot;
    const site = placed.buildings.find(
      (building) => building.x === cell!.x && building.y === cell!.y
    )!;
    expect(site.status).toBe('awaiting_materials');
    expect(site.materials[0]?.delivered).toBe(0);
    expect(placed.transferTasks).toHaveLength(0);

    const stoneBefore = placed.storages
      .flatMap((storage) => storage.contents)
      .filter((item) => item.item === 'stone')
      .reduce((sum, item) => sum + item.qty, 0);

    const queued = await advanceWorld(cookie, placed, 1);
    expect(queued.transferTasks.length).toBeGreaterThan(0);
    expect(queued.transferTasks[0]?.direction).toBe('to_building');

    const built = await advanceWorld(cookie, queued, 60);
    const road = built.buildings.find((building) => building.id === site.id)!;
    expect(road.status).toBe('complete');
    expect(road.materials[0]?.delivered).toBe(2);
    const stoneAfterBuild = built.storages
      .flatMap((storage) => storage.contents)
      .filter((item) => item.item === 'stone')
      .reduce((sum, item) => sum + item.qty, 0);
    expect(stoneAfterBuild).toBe(stoneBefore - 2);

    const demolishResponse = await app.inject({
      method: 'POST',
      url: '/api/commands/demolish',
      headers: { cookie },
      payload: {
        request_id: crypto.randomUUID(),
        expected_version: built.version,
        building_id: road.id
      }
    });
    expect(demolishResponse.statusCode).toBe(200);
    const demolition = demolishResponse.json<{ snapshot: WorldSnapshot }>().snapshot;
    expect(
      demolition.buildings.find((building) => building.id === road.id)?.status
    ).toBe('demolition');

    let current = demolition;
    for (let i = 0; i < 3; i += 1) {
      current = await advanceWorld(cookie, current, 60);
    }
    const stoneAfterSalvage = current.storages
      .flatMap((storage) => storage.contents)
      .filter((item) => item.item === 'stone')
      .reduce((sum, item) => sum + item.qty, 0);
    expect(stoneAfterSalvage).toBe(stoneBefore - 1);
    expect(current.buildings.find((building) => building.id === road.id)).toBeUndefined();
  });

  it('queues two sites for the single builder', async () => {
    const { cookie, snapshot } = await openSession();
    const occupied = new Set([
      ...snapshot.nodes.map((node) => `${node.sectorId}:${node.x}:${node.y}`),
      ...snapshot.storages.map((storage) => `${storage.sectorId}:${storage.x}:${storage.y}`)
    ]);
    const sector = snapshot.sectors[0]!;
    const cells = sector.terrain
      .filter(
        (terrain) =>
          terrain.reachable &&
          terrain.cartReachable &&
          terrain.passable &&
          !occupied.has(`${sector.id}:${terrain.x}:${terrain.y}`)
      )
      .slice(0, 2);
    expect(cells.length).toBe(2);

    let current = snapshot;
    for (const cell of cells) {
      const response = await app.inject({
        method: 'POST',
        url: '/api/commands/build',
        headers: { cookie },
        payload: {
          request_id: crypto.randomUUID(),
          expected_version: current.version,
          building_type: 'road',
          sector_id: sector.id,
          x: cell.x,
          y: cell.y
        }
      });
      expect(response.statusCode).toBe(200);
      current = response.json<{ snapshot: WorldSnapshot }>().snapshot;
    }

    for (let i = 0; i < 3; i += 1) {
      current = await advanceWorld(cookie, current, 60);
    }
    const after = current;
    const roads = after.buildings.filter((building) => building.type === 'road');
    expect(roads).toHaveLength(2);
    expect(roads.map((building) => building.status)).toEqual(['complete', 'complete']);
    expect(after.stats.idleBuilders).toBe(1);
    expect(after.laborers.filter((laborer) => laborer.role === 'builder')).toHaveLength(1);
  });

  it('stops gathering and leaves the buffer untouched', async () => {
    const { cookie, snapshot } = await openSession();
    const forest = snapshot.nodes.find((node) => node.kind === 'forest')!;
    const gathered = await app.inject({
      method: 'POST',
      url: '/api/commands/gather',
      headers: { cookie },
      payload: { request_id: crypto.randomUUID(), expected_version: 0, node_id: forest.id }
    });
    const version = gathered.json<{ snapshot: WorldSnapshot }>().snapshot.version;
    const stopped = await app.inject({
      method: 'POST',
      url: '/api/commands/stop-gather',
      headers: { cookie },
      payload: { request_id: crypto.randomUUID(), expected_version: version, node_id: forest.id }
    });
    expect(stopped.statusCode).toBe(200);
    const snapshotAfter = stopped.json<{ snapshot: WorldSnapshot }>().snapshot;
    expect(snapshotAfter.nodes.find((node) => node.id === forest.id)?.active).toBe(false);
    expect(snapshotAfter.laborers.find((laborer) => laborer.role === 'gatherer')?.status).toBe('idle');

    const after = await advanceWorld(cookie, snapshotAfter, 10);
    expect(after.nodes.find((node) => node.id === forest.id)?.buffer).toBe(0);
    expect(after.haulTasks).toHaveLength(0);
  });

  it('charges logs and stone for a new sector', async () => {
    const { cookie, snapshot } = await openSession();
    let unlocked: WorldSnapshot | null = null;
    for (const candidate of snapshot.frontier.slice(0, 12)) {
      const response = await app.inject({
        method: 'POST',
        url: '/api/commands/unlock',
        headers: { cookie },
        payload: {
          request_id: crypto.randomUUID(),
          expected_version: 0,
          sector_x: candidate.x,
          sector_y: candidate.y
        }
      });
      if (response.statusCode === 200) {
        unlocked = response.json<{ snapshot: WorldSnapshot }>().snapshot;
        break;
      }
      expect(response.json<{ error: { code: string } }>().error.code).toBe('PATH_BLOCKED');
    }
    expect(unlocked).not.toBeNull();
    const stockpile = unlocked!.storages.find((storage) => storage.type === 'stockpile')!;
    expect(stockpile.contents.find((item) => item.item === 'logs')?.qty).toBe(5);
    expect(stockpile.contents.find((item) => item.item === 'stone')?.qty).toBe(5);
    expect(unlocked!.storages.find((storage) => storage.type === 'warehouse')?.contents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ item: 'planks', qty: 4 }),
        expect.objectContaining({ item: 'tools', qty: 2 })
      ])
    );
  });

  it('rejects an unlock when the settlement lacks logs or stone', async () => {
    const { cookie, snapshot } = await openSession();
    await db.deleteFrom('storage_item').where('item', 'in', ['logs', 'stone']).execute();

    let insufficient = false;
    for (const candidate of snapshot.frontier.slice(0, 12)) {
      const response = await app.inject({
        method: 'POST',
        url: '/api/commands/unlock',
        headers: { cookie },
        payload: {
          request_id: crypto.randomUUID(),
          expected_version: 0,
          sector_x: candidate.x,
          sector_y: candidate.y
        }
      });
      const code = response.json<{ error: { code: string } }>().error.code;
      if (response.statusCode === 409 && code === 'INSUFFICIENT_RESOURCE') {
        insufficient = true;
        break;
      }
      expect(code).toBe('PATH_BLOCKED');
    }
    expect(insufficient).toBe(true);
  });
});

describe('determinism (A-H5)', () => {
  it('same 100 ticks in one block and ten blocks yield identical canonical state', async () => {
    const a = await openSession();
    const b = await openSession();

    // Advance B in ten blocks.
    let snapB = b.snapshot;
    for (let i = 0; i < 10; i += 1) {
      clock.advanceTicks(10);
      const response = await app.inject({
        method: 'POST',
        url: '/api/commands/advance',
        headers: { cookie: b.cookie },
        payload: { request_id: crypto.randomUUID(), expected_version: snapB.version }
      });
      snapB = response.json<{ snapshot: WorldSnapshot }>().snapshot;
    }

    // Advance A in one block (its world has been waiting the same 100 ticks).
    const respA = await app.inject({
      method: 'POST',
      url: '/api/commands/advance',
      headers: { cookie: a.cookie },
      payload: { request_id: crypto.randomUUID(), expected_version: a.snapshot.version }
    });
    const snapA = respA.json<{ snapshot: WorldSnapshot }>().snapshot;

    const canonical = (snapshot: WorldSnapshot) => ({
      tick: snapshot.tick,
      storageContents: Object.fromEntries(
        [...new Set(snapshot.storages.flatMap((s) => s.contents.map((c) => c.item)))]
          .map((item) => [item, snapshot.storages.flatMap((s) => s.contents).filter((c) => c.item === item).reduce((n, c) => n + c.qty, 0)])
      ),
      storageReserved: snapshot.storages.reduce((n, s) => n + s.reserved, 0),
      storageVolume: snapshot.storages.reduce((n, s) => n + s.volume, 0),
      nodeAmount: snapshot.nodes.reduce((n, node) => n + node.amount, 0),
      nodeBuffer: snapshot.nodes.reduce((n, node) => n + node.buffer, 0),
      activeNodes: snapshot.nodes.filter((node) => node.active).length,
      buildingStatuses: snapshot.buildings.reduce<Record<string, number>>((acc, b) => {
        acc[b.status] = (acc[b.status] ?? 0) + 1;
        return acc;
      }, {}),
      laborerStatuses: snapshot.laborers.reduce<Record<string, number>>((acc, l) => {
        acc[l.status] = (acc[l.status] ?? 0) + 1;
        return acc;
      }, {}),
      residentProfessions: snapshot.residents.reduce<Record<string, number>>((acc, r) => {
        acc[r.profession] = (acc[r.profession] ?? 0) + 1;
        return acc;
      }, {}),
      residentXp: snapshot.residents.reduce((n, r) => n + r.xp, 0),
      haulStatuses: snapshot.haulTasks.reduce<Record<string, number>>((acc, t) => {
        acc[t.status] = (acc[t.status] ?? 0) + 1;
        return acc;
      }, {}),
      transferStatuses: snapshot.transferTasks.reduce<Record<string, number>>((acc, t) => {
        acc[t.status] = (acc[t.status] ?? 0) + 1;
        return acc;
      }, {}),
      craftStatuses: snapshot.craftOrders.reduce<Record<string, number>>((acc, o) => {
        acc[o.status] = (acc[o.status] ?? 0) + 1;
        return acc;
      }, {}),
      research: snapshot.research,
      techTree: snapshot.techTree.map((node) => ({ id: node.id, researched: node.researched, available: node.available })),
      population: snapshot.population,
      stats: {
        activeClearings: snapshot.stats.activeClearings,
        activeHauls: snapshot.stats.activeHauls,
        activeNodes: snapshot.stats.activeNodes,
        activeTransfers: snapshot.stats.activeTransfers
      }
    });

    expect(canonical(snapA)).toEqual(canonical(snapB));
  });
});
