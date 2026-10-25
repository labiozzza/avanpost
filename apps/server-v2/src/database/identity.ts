import { isIP } from 'node:net';

export type DatabaseOperation = 'development' | 'test' | 'migration';
export type DatabaseMode = 'local' | 'compose';

export interface V2DatabaseTarget {
  operation: DatabaseOperation;
  mode: DatabaseMode;
  databaseName: 'avanpost_v2_dev' | 'avanpost_v2_test';
  hostname: string;
  port: number;
}

export interface V2DatabaseEnvironment {
  DATABASE_URL?: string;
  TEST_DATABASE_URL?: string;
  AVANPOST_V2_COMPOSE?: string;
}

export type V2DatabaseErrorCode =
  | 'V2_DB_URL_REQUIRED'
  | 'V2_DB_URL_INVALID'
  | 'V2_DB_SCHEME_REJECTED'
  | 'V2_DB_URL_OPTIONS_REJECTED'
  | 'V2_DB_NAME_REJECTED'
  | 'V2_DB_HOST_REJECTED'
  | 'V2_DB_PORT_REJECTED'
  | 'V2_DB_URLS_NOT_DISTINCT'
  | 'V2_DB_IDENTITY_QUERY_FAILED'
  | 'V2_DB_IDENTITY_MISMATCH'
  | 'V2_DB_SERVER_ADDRESS_REJECTED'
  | 'V2_DB_CLIENT_PEER_REJECTED';

export class V2DatabaseError extends Error {
  constructor(
    readonly code: V2DatabaseErrorCode,
    message: string
  ) {
    super(message);
    this.name = 'V2DatabaseError';
  }
}

const EXPECTED_DATABASE: Record<DatabaseOperation, V2DatabaseTarget['databaseName']> = {
  development: 'avanpost_v2_dev',
  migration: 'avanpost_v2_dev',
  test: 'avanpost_v2_test'
};

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);
const COMPOSE_HOST = 'peace-v2-postgres';
const LOCAL_PORT = 5434;
const COMPOSE_PORT = 5432;
const COMPOSE_DB_ADDRESS = '172.29.240.2';

function normalizeHostname(hostname: string): string {
  return hostname.startsWith('[') && hostname.endsWith(']')
    ? hostname.slice(1, -1).toLowerCase()
    : hostname.toLowerCase();
}

function expectedUrlVariable(operation: DatabaseOperation): 'DATABASE_URL' | 'TEST_DATABASE_URL' {
  return operation === 'test' ? 'TEST_DATABASE_URL' : 'DATABASE_URL';
}

export function validateDatabaseUrl(
  rawUrl: string | undefined,
  operation: DatabaseOperation,
  env: V2DatabaseEnvironment = {}
): V2DatabaseTarget {
  if (!rawUrl?.trim()) {
    throw new V2DatabaseError(
      'V2_DB_URL_REQUIRED',
      `${expectedUrlVariable(operation)} is required; V2 never falls back to another environment or V1 URL.`
    );
  }

  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new V2DatabaseError('V2_DB_URL_INVALID', 'The configured V2 database URL is invalid.');
  }

  if (url.protocol !== 'postgres:' && url.protocol !== 'postgresql:') {
    throw new V2DatabaseError('V2_DB_SCHEME_REJECTED', 'Only PostgreSQL URLs are allowed for V2.');
  }
  if (url.search || url.hash || rawUrl.includes('#')) {
    throw new V2DatabaseError(
      'V2_DB_URL_OPTIONS_REJECTED',
      'V2 database URLs cannot override host, SSL, or connection options with query parameters.'
    );
  }

  let databaseName: string;
  try {
    databaseName = decodeURIComponent(url.pathname.replace(/^\//, ''));
  } catch {
    throw new V2DatabaseError('V2_DB_URL_INVALID', 'The configured V2 database URL is invalid.');
  }
  const expectedName = EXPECTED_DATABASE[operation];
  if (databaseName !== expectedName) {
    throw new V2DatabaseError(
      'V2_DB_NAME_REJECTED',
      `${operation} must target ${expectedName}; aliases and V1 database names are rejected.`
    );
  }

  const hostname = normalizeHostname(url.hostname);
  const composeMode = env.AVANPOST_V2_COMPOSE === '1';
  const mode: DatabaseMode = composeMode ? 'compose' : 'local';
  const expectedHost = composeMode ? COMPOSE_HOST : null;
  const port = url.port ? Number(url.port) : Number.NaN;

  if (composeMode) {
    if (hostname !== expectedHost) {
      throw new V2DatabaseError(
        'V2_DB_HOST_REJECTED',
        `Compose mode requires the dedicated ${COMPOSE_HOST} service host.`
      );
    }
    if (port !== COMPOSE_PORT) {
      throw new V2DatabaseError('V2_DB_PORT_REJECTED', `Compose mode requires PostgreSQL port ${COMPOSE_PORT}.`);
    }
  } else {
    if (!LOCAL_HOSTS.has(hostname)) {
      throw new V2DatabaseError(
        'V2_DB_HOST_REJECTED',
        'Local mode accepts only localhost or a loopback IP; remote hosts and aliases are rejected.'
      );
    }
    if (port !== LOCAL_PORT) {
      throw new V2DatabaseError('V2_DB_PORT_REJECTED', `Local V2 mode requires PostgreSQL port ${LOCAL_PORT}.`);
    }
  }

  return { operation, mode, databaseName: expectedName, hostname, port };
}

export function validateDatabaseEnvironment(env: V2DatabaseEnvironment): {
  development: V2DatabaseTarget;
  test: V2DatabaseTarget;
} {
  const development = validateDatabaseUrl(env.DATABASE_URL, 'development', env);
  const test = validateDatabaseUrl(env.TEST_DATABASE_URL, 'test', env);

  if (development.databaseName === test.databaseName) {
    throw new V2DatabaseError(
      'V2_DB_URLS_NOT_DISTINCT',
      'Development and test database targets must remain distinct.'
    );
  }

  return { development, test };
}

function isLoopbackAddress(address: string): boolean {
  const normalized = address.toLowerCase();
  if (normalized.startsWith('::ffff:')) return isLoopbackAddress(normalized.slice(7));
  return normalized === '::1' || (isIP(normalized) === 4 && normalized.startsWith('127.'));
}

function isV2ComposeAddress(address: string): boolean {
  if (address.toLowerCase().startsWith('::ffff:')) {
    return isV2ComposeAddress(address.slice(7));
  }
  return isIP(address) === 4 && address === COMPOSE_DB_ADDRESS;
}

export interface DatabaseIdentityQueryResult {
  database_name: string;
  server_address: string | null;
  server_port: number;
}

export interface DatabaseIdentityQueryable {
  query(sql: string): Promise<{ rows: DatabaseIdentityQueryResult[] }>;
}

export async function verifyConnectedDatabaseIdentity(
  connection: DatabaseIdentityQueryable,
  target: V2DatabaseTarget,
  clientPeerAddress: string | undefined
): Promise<DatabaseIdentityQueryResult> {
  let row: DatabaseIdentityQueryResult | undefined;
  try {
    const result = await connection.query(
      'SELECT current_database() AS database_name, host(inet_server_addr()) AS server_address, inet_server_port() AS server_port'
    );
    row = result.rows[0];
  } catch {
    throw new V2DatabaseError(
      'V2_DB_IDENTITY_QUERY_FAILED',
      'Could not verify the connected V2 database identity; no migration or reset is allowed.'
    );
  }

  if (!row || row.database_name !== target.databaseName) {
    throw new V2DatabaseError(
      'V2_DB_IDENTITY_MISMATCH',
      `Connected database identity does not match ${target.databaseName}; no migration or reset is allowed.`
    );
  }

  const serverAddress = row.server_address;
  if (!serverAddress || row.server_port !== COMPOSE_PORT) {
    throw new V2DatabaseError(
      'V2_DB_SERVER_ADDRESS_REJECTED',
      'Connected PostgreSQL server address or port is outside the approved local V2 database boundary.'
    );
  }

  if (target.mode === 'local') {
    if (
      !clientPeerAddress ||
      !isLoopbackAddress(clientPeerAddress) ||
      (!isLoopbackAddress(serverAddress) && !isV2ComposeAddress(serverAddress))
    ) {
      throw new V2DatabaseError(
        'V2_DB_CLIENT_PEER_REJECTED',
        'The local V2 connection did not resolve to the approved loopback peer and V2 database network.'
      );
    }
  } else if (
    !clientPeerAddress ||
    !isV2ComposeAddress(clientPeerAddress) ||
    !isV2ComposeAddress(serverAddress) ||
    clientPeerAddress !== serverAddress
  ) {
    throw new V2DatabaseError(
      'V2_DB_CLIENT_PEER_REJECTED',
      'The compose connection did not resolve to the dedicated V2 PostgreSQL service.'
    );
  }

  return row;
}
