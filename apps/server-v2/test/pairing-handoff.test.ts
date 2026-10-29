import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { loadV2Config } from '../src/config.js';
import {
  createV2HandoffServer,
  createV2PairingCredentials,
  createV2Server,
  type V2HealthDatabase
} from '../src/server.js';

const config = loadV2Config({
  DATABASE_URL: 'postgres://peace_v2@127.0.0.1:5434/avanpost_v2_dev',
  TEST_DATABASE_URL: 'postgres://peace_v2@127.0.0.1:5434/avanpost_v2_test'
});
const apps: Array<{ close(): Promise<void> }> = [];

function digest(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function handoffHeaders() {
  return {
    host: `127.0.0.1:${config.handoffPort}`,
    origin: 'http://127.0.0.1:4174',
    referer: 'http://127.0.0.1:4174/'
  };
}

function sessionHeaders() {
  return {
    host: `127.0.0.1:${config.port}`,
    origin: 'http://127.0.0.1:4174',
    referer: 'http://127.0.0.1:4174/',
    'content-type': 'application/json'
  };
}

function pairingPayload(code: string) {
  return {
    method: 'POST' as const,
    url: '/api/session',
    headers: sessionHeaders(),
    payload: { code }
  };
}

describe('loopback pairing handoff', () => {
  afterEach(async () => {
    await Promise.all(apps.splice(0).map((app) => app.close()));
  });

  it('renews an expired code when the computer requests it', async () => {
    const pairing = createV2PairingCredentials();
    const previousDigest = digest(pairing.code);
    pairing.expiresAt = 0;
    const app = createV2HandoffServer(config, pairing);
    apps.push(app);

    const response = await app.inject({ method: 'GET', url: '/api/launcher/pairing-code', headers: handoffHeaders() });
    const payload = response.json() as { code?: string };
    expect(response.statusCode).toBe(200);
    expect(typeof payload.code === 'string' && payload.code.length === 32).toBe(true);
    expect(typeof payload.code === 'string' && digest(payload.code) !== previousDigest).toBe(true);
    expect(pairing.expiresAt > 0).toBe(true);
    expect(pairing.consumed).toBe(false);
    expect(response.headers['cache-control']).toContain('no-store');
  });

  it('issues a fresh code for a second device after the previous code was consumed', async () => {
    const pairing = createV2PairingCredentials();
    const previousDigest = digest(pairing.code);
    pairing.consumed = true;
    const app = createV2HandoffServer(config, pairing);
    apps.push(app);

    const response = await app.inject({ method: 'GET', url: '/api/launcher/pairing-code', headers: handoffHeaders() });
    const payload = response.json() as { code?: string };
    expect(response.statusCode).toBe(200);
    expect(typeof payload.code === 'string' && payload.code.length === 32).toBe(true);
    expect(typeof payload.code === 'string' && digest(payload.code) !== previousDigest).toBe(true);
    expect(pairing.consumed).toBe(false);
  });

  it('accepts the renewed code once and does not expose it in the session response', async () => {
    const pairing = createV2PairingCredentials();
    pairing.expiresAt = 0;
    const database: V2HealthDatabase = {
      async query<T>(sql: string) {
        return { rows: [] as T[], rowCount: sql.startsWith('INSERT INTO peace_v2_sessions') ? 1 : 0 };
      }
    };
    const handoff = createV2HandoffServer(config, pairing);
    const api = createV2Server(config, database, 'avanpost_v2_dev', pairing);
    apps.push(handoff, api);

    const codeResponse = await handoff.inject({ method: 'GET', url: '/api/launcher/pairing-code', headers: handoffHeaders() });
    const code = (codeResponse.json() as { code: string }).code;
    const session = await api.inject({ method: 'POST', url: '/api/session', headers: sessionHeaders(), payload: { code } });
    expect(session.statusCode).toBe(200);
    expect(session.json()).toEqual({ status: 'paired' });
    expect(session.headers['set-cookie']).toContain('HttpOnly');

    const replay = await api.inject({ method: 'POST', url: '/api/session', headers: sessionHeaders(), payload: { code } });
    expect(replay.statusCode).toBe(409);
    expect(replay.json().code).toBe('PAIR_REUSED');
    expect(replay.body.includes(code)).toBe(false);

    pairing.code = `${code[0] === '0' ? '1' : '0'}${code.slice(1)}`;
    pairing.expiresAt = Number.MAX_SAFE_INTEGER;
    pairing.consumed = false;
    const incorrectCode = `${pairing.code[0] === '0' ? '1' : '0'}${pairing.code.slice(1)}`;
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const invalid = await api.inject({ method: 'POST', url: '/api/session', headers: sessionHeaders(), payload: { code: incorrectCode } });
      expect(invalid.statusCode).toBe(401);
    }
  });

  it('rate-limits invalid pairing attempts without echoing their input', async () => {
    const pairing = createV2PairingCredentials();
    pairing.expiresAt = Number.MAX_SAFE_INTEGER;
    const database: V2HealthDatabase = {
      async query<T>() { return { rows: [] as T[], rowCount: 0 }; }
    };
    const app = createV2Server(config, database, 'avanpost_v2_dev', pairing);
    apps.push(app);
    const incorrectCode = `${pairing.code[0] === '0' ? '1' : '0'}${pairing.code.slice(1)}`;

    for (let attempt = 0; attempt < 5; attempt += 1) {
      const response = await app.inject(pairingPayload(incorrectCode));
      expect(response.statusCode).toBe(401);
      expect(response.json().code).toBe('PAIR_INVALID');
      expect(response.body.includes(incorrectCode)).toBe(false);
    }
    const limited = await app.inject(pairingPayload(incorrectCode));
    expect(limited.statusCode).toBe(429);
    expect(limited.json().code).toBe('PAIR_RATE_LIMITED');
    expect(limited.body.includes(incorrectCode)).toBe(false);
  });
});
