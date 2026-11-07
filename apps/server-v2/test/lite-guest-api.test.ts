import { describe, expect, it } from 'vitest';
import { loadV2Config } from '../src/config.js';
import { createV2Server, type V2HealthDatabase } from '../src/server.js';
import { createInitialPeaceWorld } from '@avanpost/peace-v2-sim';
import type { PeaceWorldSnapshot } from '@avanpost/peace-v2-shared';

const config = loadV2Config({
  DATABASE_URL: 'postgres://peace_v2@127.0.0.1:5434/avanpost_v2_dev',
  TEST_DATABASE_URL: 'postgres://peace_v2@127.0.0.1:5434/avanpost_v2_test'
});

function database(): V2HealthDatabase {
  const accounts = new Map<string, { worldId: string; tokenHash: string }>();
  const worlds = new Map<string, PeaceWorldSnapshot>();
  return {
    async query<T>(sql: string, values: any[] = []) {
      if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return { rows: [] as T[], rowCount: 1 };
      if (sql.includes('INSERT INTO peace_v2_lite_accounts')) return { rows: [] as T[], rowCount: 1 };
      if (sql.includes('INSERT INTO peace_v2_lite_worlds')) {
        accounts.set(values[1], { worldId: values[0], tokenHash: '' });
        return { rows: [] as T[], rowCount: 1 };
      }
      if (sql.includes('INSERT INTO peace_v2_lite_world_memberships')) return { rows: [] as T[], rowCount: 1 };
      if (sql.includes('INSERT INTO peace_v2_world_state')) {
        const world = createInitialPeaceWorld(values[0]);
        worlds.set(values[0], world);
        return { rows: [] as T[], rowCount: 1 };
      }
      if (sql.includes('INSERT INTO peace_v2_lite_sessions')) {
        const account = accounts.get(values[1])!;
        account.tokenHash = values[0];
        return { rows: [] as T[], rowCount: 1 };
      }
      if (sql.includes('WITH active_session AS')) {
        const account = [...accounts.entries()].find(([, value]) => value.tokenHash === values[0]);
        return {
          rows: (account ? [{ accountId: account[0], worldId: account[1].worldId, role: 'owner' }] : []) as T[],
          rowCount: account ? 1 : 0
        };
      }
      if (sql.includes('FROM peace_v2_world_state')) {
        const world = worlds.get(values[0]);
        return {
          rows: (world ? [{ world_version: world.revision.worldVersion, geometry_version: world.revision.geometryVersion,
            server_tick: world.revision.serverTick, last_simulated_at: new Date(Date.now() + 60_000), state: world }] : []) as T[],
          rowCount: world ? 1 : 0
        };
      }
      if (sql.startsWith('UPDATE peace_v2_world_state')) return { rows: [] as T[], rowCount: 1 };
      if (sql.includes('SELECT EXISTS (SELECT 1 FROM peace_v2_sessions')) return { rows: [{ valid: false }] as T[], rowCount: 1 };
      if (sql === 'SELECT 1') return { rows: [{ '?column?': 1 }] as T[], rowCount: 1 };
      throw new Error(`Unexpected query in Lite guest API test: ${sql}`);
    }
  };
}

describe('Peace Lite guest API', () => {
  it('creates independent persistent guest worlds and serves each account only its own snapshot', async () => {
    const app = createV2Server(config, database());
    const first = await app.inject({ method: 'POST', url: '/api/auth/guest' });
    const second = await app.inject({ method: 'POST', url: '/api/auth/guest' });

    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);
    expect(first.json().accountId).not.toBe(second.json().accountId);
    expect(first.json().worldId).not.toBe(second.json().worldId);
    const cookieHeader = (response: typeof first) => {
      const value = response.headers['set-cookie'];
      const cookie = Array.isArray(value) ? value[0] : value;
      if (!cookie) throw new Error('Guest response did not set a session cookie.');
      return cookie.split(';')[0]!;
    };
    const firstCookie = cookieHeader(first);
    const secondCookie = cookieHeader(second);
    expect(first.body).not.toContain(firstCookie.split('=')[1]!);

    const firstWorld = await app.inject({ method: 'GET', url: '/api/world', headers: { cookie: firstCookie } });
    const secondWorld = await app.inject({ method: 'GET', url: '/api/world', headers: { cookie: secondCookie } });
    expect(firstWorld.statusCode).toBe(200);
    expect(secondWorld.statusCode).toBe(200);
    expect(firstWorld.json().worldSeed).toBe(first.json().worldId);
    expect(secondWorld.json().worldSeed).toBe(second.json().worldId);
    expect(firstWorld.json().worldSeed).not.toBe(secondWorld.json().worldSeed);

    const account = await app.inject({ method: 'GET', url: '/api/me', headers: { cookie: firstCookie } });
    expect(account.json()).toEqual({ accountId: first.json().accountId, worldId: first.json().worldId, role: 'owner' });
    await app.close();
  });
});
