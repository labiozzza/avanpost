import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { loadV2Config } from '../src/config.js';

const environment: NodeJS.ProcessEnv = {
  AVANPOST_V2_POSTGRES_USER: 'peace_v2',
  AVANPOST_V2_POSTGRES_PASSWORD: 'test',
  DATABASE_URL: 'postgres://peace_v2@127.0.0.1:5434/avanpost_v2_dev',
  TEST_DATABASE_URL: 'postgres://peace_v2@127.0.0.1:5434/avanpost_v2_test',
  MANUAL_DATABASE_URL: 'postgres://peace_v2@127.0.0.1:5434/avanpost_v2_manual'
};

describe('V2 network binding', () => {
  it('defaults API and handoff to separate loopback ports', () => {
    const config = loadV2Config(environment);
    expect(config).toMatchObject({
      bindHost: '127.0.0.1', port: 8788, handoffPort: 8789, clientPort: 4174,
      loopbackClientPort: 4175, lanEnabled: false
    });
    const parsed = new URL(config.database.developmentUrl);
    expect(parsed.password === environment.AVANPOST_V2_POSTGRES_PASSWORD).toBe(true);
  });

  it('keeps the checked-in V2 env template free of embedded database passwords', () => {
    const template = readFileSync(path.join(process.cwd(), '.env.v2.example'), 'utf8');
    expect(template.includes('AVANPOST_V2_POSTGRES_PASSWORD=change-me')).toBe(true);
    expect(template.includes('DATABASE_URL=postgres://peace_v2@127.0.0.1:5434/avanpost_v2_dev')).toBe(true);
    expect(template.includes('TEST_DATABASE_URL=postgres://peace_v2@127.0.0.1:5434/avanpost_v2_test')).toBe(true);
    expect(template.includes('MANUAL_DATABASE_URL=postgres://peace_v2@127.0.0.1:5434/avanpost_v2_manual')).toBe(true);
  });

  it('isolates test and manual ports from the ordinary dev server', () => {
    expect(loadV2Config({ ...environment, AVANPOST_V2_DATABASE_OPERATION: 'test' }))
      .toMatchObject({ port: 18888, handoffPort: 18889, clientPort: 14174, loopbackClientPort: 14175 });
    expect(loadV2Config({ ...environment, AVANPOST_V2_DATABASE_OPERATION: 'manual' }))
      .toMatchObject({ port: 19888, handoffPort: 19889, clientPort: 15174, loopbackClientPort: 15175 });
  });

  it('ignores ordinary dev port values when loading test or manual profiles', () => {
    expect(loadV2Config({ ...environment, AVANPOST_V2_DATABASE_OPERATION: 'test', AVANPOST_V2_PORT: '8788' }).port)
      .toBe(18888);
    expect(loadV2Config({ ...environment, AVANPOST_V2_DATABASE_OPERATION: 'manual', AVANPOST_V2_PORT: '8788' }).port)
      .toBe(19888);
  });

  it('requires explicit opt-in and rejects wildcard or public binding addresses', () => {
    expect(() => loadV2Config({ ...environment, AVANPOST_V2_BIND_HOST: '192.168.1.20' }))
      .toThrow('V2_LAN_BIND_BLOCKED');
    expect(() => loadV2Config({
      ...environment,
      AVANPOST_V2_ENABLE_LAN: 'true',
      AVANPOST_V2_BIND_HOST: '0.0.0.0'
    })).toThrow('V2_LAN_BIND_BLOCKED');
    expect(() => loadV2Config({
      ...environment,
      AVANPOST_V2_ENABLE_LAN: 'true',
      AVANPOST_V2_BIND_HOST: '203.0.113.10'
    })).toThrow('V2_LAN_BIND_BLOCKED');
  });

  it('rejects overlapping API and loopback handoff ports', () => {
    expect(() => loadV2Config({ ...environment, AVANPOST_V2_HANDOFF_PORT: '8788' }))
      .toThrow('V2_HANDOFF_PORT_INVALID');
    expect(() => loadV2Config({ ...environment, AVANPOST_V2_LOOPBACK_CLIENT_PORT: '4174' }))
      .toThrow('V2_LOOPBACK_CLIENT_PORT_INVALID');
    expect(() => loadV2Config({ ...environment, AVANPOST_V2_CLIENT_PORT: '8788' }))
      .toThrow('V2_CLIENT_PORT_INVALID');
    expect(() => loadV2Config({
      ...environment, AVANPOST_V2_CLIENT_PORT: '14174', AVANPOST_V2_LOOPBACK_CLIENT_PORT: '14174'
    })).toThrow('V2_LOOPBACK_CLIENT_PORT_INVALID');
  });
});
