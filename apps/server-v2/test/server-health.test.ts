import { afterEach, describe, expect, it } from 'vitest';
import { loadV2Config } from '../src/config.js';
import { createV2Server } from '../src/server.js';

const config = loadV2Config({
  DATABASE_URL: 'postgres://peace_v2@127.0.0.1:5434/avanpost_v2_dev',
  TEST_DATABASE_URL: 'postgres://peace_v2@127.0.0.1:5434/avanpost_v2_test',
  AVANPOST_V2_PORT: '8788'
});

describe('V2 API health', () => {
  const apps: Array<ReturnType<typeof createV2Server>> = [];

  afterEach(async () => {
    await Promise.all(apps.splice(0).map((app) => app.close()));
  });

  it('reports the exact V2 development database only after a DB health query', async () => {
    let queryCount = 0;
    const app = createV2Server(config, {
      query: async (sql) => {
        expect(sql).toBe('SELECT 1');
        queryCount += 1;
        return { rows: [], rowCount: 0 };
      }
    });
    apps.push(app);

    const response = await app.inject({ method: 'GET', url: '/api/health' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      status: 'ok',
      api: 'peace-v2',
      database: 'avanpost_v2_dev'
    });
    expect(queryCount).toBe(1);
  });

  it('returns a safe 503 code when the database check fails', async () => {
    const app = createV2Server(config, {
      query: async () => Promise.reject(new Error('private driver detail'))
    });
    apps.push(app);

    const response = await app.inject({ method: 'GET', url: '/api/health' });
    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({ status: 'blocked', code: 'V2_DB_UNAVAILABLE' });
    expect(response.body).not.toContain('private driver detail');
  });
});
