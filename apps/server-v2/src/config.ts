import { existsSync } from 'node:fs';
import { isIPv4 } from 'node:net';
import { networkInterfaces } from 'node:os';
import path from 'node:path';
import {
  validateDatabaseEnvironment,
  type V2DatabaseEnvironment,
  type V2DatabaseTarget
} from './database/identity.js';

export interface V2Config {
  database: {
    development: V2DatabaseTarget;
    test: V2DatabaseTarget;
    manual: V2DatabaseTarget;
    developmentUrl: string;
    testUrl: string;
    manualUrl: string;
  };
  port: number;
  handoffPort: number;
  clientPort: number;
  loopbackClientPort: number;
  bindHost: string;
  lanEnabled: boolean;
  nodeEnv: string;
}

function isLoopbackHost(host: string): boolean {
  return host === '127.0.0.1' || host === '::1' || host === 'localhost';
}

function isPrivateIpv4(host: string): boolean {
  if (!isIPv4(host)) return false;
  const octets = host.split('.').map(Number);
  return octets[0] === 10 ||
    octets[0] === 192 && octets[1] === 168 ||
    octets[0] === 172 && octets[1] !== undefined && octets[1] >= 16 && octets[1] <= 31;
}

export function getV2ProjectRoot(): string {
  return path.resolve(import.meta.dirname, '../../..');
}

export function loadV2Env(): void {
  const envFile = path.join(getV2ProjectRoot(), '.env.v2');
  if (existsSync(envFile)) process.loadEnvFile(envFile);
}

function addLocalPassword(rawUrl: string | undefined, env: NodeJS.ProcessEnv): string | undefined {
  if (!rawUrl || !env.AVANPOST_V2_POSTGRES_PASSWORD) return rawUrl;
  try {
    const url = new URL(rawUrl);
    if (!env.AVANPOST_V2_POSTGRES_USER || url.username !== env.AVANPOST_V2_POSTGRES_USER) return rawUrl;
    const marker = `${url.protocol}//${url.username}@`;
    if (!rawUrl.startsWith(marker)) return rawUrl;
    const credentials = `${url.protocol}//${url.username}:${encodeURIComponent(env.AVANPOST_V2_POSTGRES_PASSWORD)}@`;
    return rawUrl.replace(marker, credentials);
  } catch {
    return rawUrl;
  }
}

function deriveManualDatabaseUrl(env: NodeJS.ProcessEnv): string | undefined {
  if (env.AVANPOST_V2_MANUAL_DATABASE_URL?.trim()) return env.AVANPOST_V2_MANUAL_DATABASE_URL;
  if (!env.DATABASE_URL?.trim()) return undefined;
  try {
    const url = new URL(env.DATABASE_URL);
    url.pathname = '/avanpost_v2_manual';
    url.search = '';
    url.hash = '';
    return url.toString();
  } catch {
    return undefined;
  }
}

export function loadV2Config(env: NodeJS.ProcessEnv = process.env): V2Config {
  const operation = env.AVANPOST_V2_DATABASE_OPERATION;
  const databaseEnv: V2DatabaseEnvironment = {
    DATABASE_URL: addLocalPassword(env.DATABASE_URL, env),
    TEST_DATABASE_URL: addLocalPassword(env.TEST_DATABASE_URL, env),
    MANUAL_DATABASE_URL: addLocalPassword(deriveManualDatabaseUrl(env), env),
    AVANPOST_V2_COMPOSE: env.AVANPOST_V2_COMPOSE
  };
  const database = validateDatabaseEnvironment(databaseEnv);
  const defaultPorts = operation === 'test'
    ? { port: '18888', handoffPort: '18889', clientPort: '14174', loopbackClientPort: '14175' }
    : operation === 'manual'
      ? { port: '19888', handoffPort: '19889', clientPort: '15174', loopbackClientPort: '15175' }
      : { port: '8788', handoffPort: '8789', clientPort: '4174', loopbackClientPort: '4175' };
  const operationPorts = operation === 'test'
    ? {
        port: env.AVANPOST_V2_TEST_PORT, handoffPort: env.AVANPOST_V2_TEST_HANDOFF_PORT,
        clientPort: env.AVANPOST_V2_TEST_CLIENT_PORT, loopbackClientPort: env.AVANPOST_V2_TEST_LOOPBACK_CLIENT_PORT
      }
    : operation === 'manual'
      ? {
          port: env.AVANPOST_V2_MANUAL_PORT, handoffPort: env.AVANPOST_V2_MANUAL_HANDOFF_PORT,
          clientPort: env.AVANPOST_V2_MANUAL_CLIENT_PORT, loopbackClientPort: env.AVANPOST_V2_MANUAL_LOOPBACK_CLIENT_PORT
        }
      : {
          port: env.AVANPOST_V2_PORT, handoffPort: env.AVANPOST_V2_HANDOFF_PORT,
          clientPort: env.AVANPOST_V2_CLIENT_PORT, loopbackClientPort: env.AVANPOST_V2_LOOPBACK_CLIENT_PORT
        };
  const port = Number(operationPorts.port ?? defaultPorts.port);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('V2_API_PORT_INVALID: AVANPOST_V2_PORT must be a valid TCP port.');
  }
  const handoffPort = Number(operationPorts.handoffPort ?? defaultPorts.handoffPort);
  if (!Number.isInteger(handoffPort) || handoffPort < 1 || handoffPort > 65535 || handoffPort === port) {
    throw new Error('V2_HANDOFF_PORT_INVALID: choose a valid handoff port distinct from the API port.');
  }
  const clientPort = Number(operationPorts.clientPort ?? defaultPorts.clientPort);
  if (!Number.isInteger(clientPort) || clientPort < 1 || clientPort > 65535 ||
      [port, handoffPort].includes(clientPort)) {
    throw new Error('V2_CLIENT_PORT_INVALID: choose a valid client port distinct from API and handoff ports.');
  }
  const loopbackClientPort = Number(operationPorts.loopbackClientPort ?? defaultPorts.loopbackClientPort);
  if (!Number.isInteger(loopbackClientPort) || loopbackClientPort < 1 || loopbackClientPort > 65535 ||
      [clientPort, port, handoffPort].includes(loopbackClientPort)) {
    throw new Error('V2_LOOPBACK_CLIENT_PORT_INVALID: choose a valid loopback client port distinct from the LAN client port.');
  }
  const bindHost = env.AVANPOST_V2_BIND_HOST ?? '127.0.0.1';
  const lanEnabled = env.AVANPOST_V2_ENABLE_LAN === 'true';
  if (!isLoopbackHost(bindHost)) {
    if (!lanEnabled || !isPrivateIpv4(bindHost)) {
      throw new Error('V2_LAN_BIND_BLOCKED: LAN bind requires explicit opt-in and a private IPv4 address.');
    }
    const isAssignedAddress = Object.values(networkInterfaces()).flatMap((interfaces) => interfaces ?? [])
      .some((address) => address.family === 'IPv4' && address.address === bindHost);
    if (!isAssignedAddress) throw new Error('V2_LAN_BIND_BLOCKED: bind address is not assigned to this computer.');
  }

  return {
    database: {
      ...database,
      developmentUrl: databaseEnv.DATABASE_URL!,
      testUrl: databaseEnv.TEST_DATABASE_URL!,
      manualUrl: databaseEnv.MANUAL_DATABASE_URL!
    },
    port,
    handoffPort,
    clientPort,
    loopbackClientPort,
    bindHost,
    lanEnabled,
    nodeEnv: env.NODE_ENV ?? 'development'
  };
}
