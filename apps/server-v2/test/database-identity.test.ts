import { describe, expect, it } from 'vitest';
import {
  V2DatabaseError,
  validateDatabaseEnvironment,
  validateDatabaseUrl,
  verifyConnectedDatabaseIdentity,
  type DatabaseIdentityQueryResult
} from '../src/database/identity.js';

const localEnvironment = {
  DATABASE_URL: 'postgres://peace_v2@127.0.0.1:5434/avanpost_v2_dev',
  TEST_DATABASE_URL: 'postgres://peace_v2@127.0.0.1:5434/avanpost_v2_test'
};

function expectCode(operation: () => unknown, code: V2DatabaseError['code']): void {
  try {
    operation();
    throw new Error(`Expected ${code} to be thrown.`);
  } catch (error) {
    expect(error).toBeInstanceOf(V2DatabaseError);
    expect((error as V2DatabaseError).code).toBe(code);
  }
}

describe('V2 database URL allowlist', () => {
  it('accepts only the operation-specific local V2 database', () => {
    expect(validateDatabaseEnvironment(localEnvironment)).toMatchObject({
      development: { databaseName: 'avanpost_v2_dev', port: 5434, mode: 'local' },
      test: { databaseName: 'avanpost_v2_test', port: 5434, mode: 'local' }
    });
  });

  it.each([
    ['missing development URL', undefined, 'development', 'V2_DB_URL_REQUIRED'],
    ['V1 development database', 'postgres://u@127.0.0.1:5434/avanpost', 'development', 'V2_DB_NAME_REJECTED'],
    ['V1 test database', 'postgres://u@127.0.0.1:5434/avanpost_test', 'test', 'V2_DB_NAME_REJECTED'],
    ['development database used for test operation', 'postgres://u@127.0.0.1:5434/avanpost_v2_dev', 'test', 'V2_DB_NAME_REJECTED'],
    ['remote host', 'postgres://u@db.example.test:5434/avanpost_v2_dev', 'development', 'V2_DB_HOST_REJECTED'],
    ['unexpected local port', 'postgres://u@127.0.0.1:5433/avanpost_v2_dev', 'development', 'V2_DB_PORT_REJECTED'],
    ['missing local port', 'postgres://u@127.0.0.1/avanpost_v2_dev', 'development', 'V2_DB_PORT_REJECTED'],
    ['malformed escaped database name', 'postgres://u@127.0.0.1:5434/%ZZ', 'development', 'V2_DB_URL_INVALID'],
    ['host override query', 'postgres://u@127.0.0.1:5434/avanpost_v2_dev?host=db.example.test', 'development', 'V2_DB_URL_OPTIONS_REJECTED']
  ] as const)('rejects %s before connection', (_label, url, operation, code) => {
    expectCode(
      () => validateDatabaseUrl(url, operation, {}),
      code
    );
  });

  it('allows separate databases on the same isolated V2 PostgreSQL server', () => {
    expect(validateDatabaseEnvironment(localEnvironment)).toMatchObject({
      development: { databaseName: 'avanpost_v2_dev' },
      test: { databaseName: 'avanpost_v2_test' }
    });
  });

  it('accepts the exact compose service only in explicit compose mode', () => {
    expect(
      validateDatabaseUrl(
        'postgres://peace_v2@peace-v2-postgres:5432/avanpost_v2_dev',
        'development',
        { AVANPOST_V2_COMPOSE: '1' }
      )
    ).toMatchObject({ hostname: 'peace-v2-postgres', port: 5432, mode: 'compose' });

    expectCode(
      () =>
        validateDatabaseUrl(
          'postgres://peace_v2@peace-v2-postgres:5432/avanpost_v2_dev',
          'development',
          {}
        ),
      'V2_DB_HOST_REJECTED'
    );
  });

  it('verifies the compose socket peer is the pinned V2 database address', async () => {
    const composeTarget = validateDatabaseUrl(
      'postgres://peace_v2@peace-v2-postgres:5432/avanpost_v2_dev',
      'development',
      { AVANPOST_V2_COMPOSE: '1' }
    );
    const composeIdentity = {
      database_name: 'avanpost_v2_dev',
      server_address: '172.29.240.2',
      server_port: 5432
    };
    const connection = { query: async () => ({ rows: [composeIdentity] }) };

    await expect(
      verifyConnectedDatabaseIdentity(connection, composeTarget, '172.29.240.2')
    ).resolves.toEqual(composeIdentity);
    await expect(
      verifyConnectedDatabaseIdentity(connection, composeTarget, '172.20.0.9')
    ).rejects.toMatchObject({ code: 'V2_DB_CLIENT_PEER_REJECTED' });
  });
});

describe('connected database identity guard', () => {
  const target = validateDatabaseUrl(localEnvironment.DATABASE_URL, 'development', {});
  const identity: DatabaseIdentityQueryResult = {
    database_name: 'avanpost_v2_dev',
    server_address: '172.29.240.2',
    server_port: 5432
  };

  it('checks the actual database and server after connect', async () => {
    const connection = {
      query: async (sql: string) => {
        expect(sql).toContain('current_database()');
        expect(sql).toContain('host(inet_server_addr())');
        return { rows: [identity] };
      }
    };

    await expect(verifyConnectedDatabaseIdentity(connection, target, '127.0.0.1')).resolves.toEqual(identity);
  });

  it('recognizes IPv4-mapped loopback and compose socket addresses', async () => {
    const connection = {
      query: async () => ({ rows: [{ ...identity, server_address: '::ffff:172.29.240.2' }] })
    };
    await expect(
      verifyConnectedDatabaseIdentity(connection, target, '::ffff:127.0.0.1')
    ).resolves.toMatchObject({ server_address: '::ffff:172.29.240.2' });
  });

  it('blocks a mismatched database identity', async () => {
    const connection = { query: async () => ({ rows: [{ ...identity, database_name: 'avanpost' }] }) };
    await expect(verifyConnectedDatabaseIdentity(connection, target, '127.0.0.1')).rejects.toMatchObject({
      code: 'V2_DB_IDENTITY_MISMATCH'
    });
  });

  it('blocks public database addresses and non-loopback client peers', async () => {
    const publicServer = { query: async () => ({ rows: [{ ...identity, server_address: '198.51.100.14' }] }) };
    const remotePeer = { query: async () => ({ rows: [identity] }) };

    await expect(verifyConnectedDatabaseIdentity(publicServer, target, '127.0.0.1')).rejects.toMatchObject({
      code: 'V2_DB_CLIENT_PEER_REJECTED'
    });
    await expect(verifyConnectedDatabaseIdentity(remotePeer, target, '10.1.2.3')).rejects.toMatchObject({
      code: 'V2_DB_CLIENT_PEER_REJECTED'
    });
  });

  it('fails closed if the identity query fails or omits required server facts', async () => {
    const queryFailure = { query: async () => Promise.reject(new Error('private connection detail')) };
    const missingServer = { query: async () => ({ rows: [{ ...identity, server_address: null }] }) };

    await expect(verifyConnectedDatabaseIdentity(queryFailure, target, '127.0.0.1')).rejects.toMatchObject({
      code: 'V2_DB_IDENTITY_QUERY_FAILED'
    });
    await expect(verifyConnectedDatabaseIdentity(missingServer, target, '127.0.0.1')).rejects.toMatchObject({
      code: 'V2_DB_SERVER_ADDRESS_REJECTED'
    });
  });
});
