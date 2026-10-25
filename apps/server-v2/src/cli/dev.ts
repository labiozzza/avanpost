import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, open, unlink } from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import type { FastifyInstance } from 'fastify';
import type { Client } from 'pg';
import { getV2ProjectRoot, loadV2Env, loadV2Config } from '../config.js';
import { connectVerifiedV2Database } from '../database/connect.js';
import { createV2HandoffServer, createV2PairingCredentials, createV2Server } from '../server.js';
import { V2DatabaseError } from '../database/identity.js';
import { V2_CLIENT_SHUTDOWN_GRACE_MS } from '../process/stop-wait.js';

loadV2Env();

const pidPath = path.join(getV2ProjectRoot(), '.gstack/run/peace-v2-api.pid');
let pidHandle: Awaited<ReturnType<typeof open>> | undefined;
let shutdownStarted = false;
let ownsPidFile = false;
let clientProcess: ChildProcess | undefined;
let clientSpawnFailed = false;
let loopbackClientProcess: ChildProcess | undefined;
let loopbackClientSpawnFailed = false;
let handoffApp: FastifyInstance | undefined;

async function stopClient(processToStop: ChildProcess | undefined): Promise<void> {
  if (processToStop?.pid !== undefined && processToStop.exitCode === null && processToStop.signalCode === null) {
    processToStop.kill('SIGTERM');
    const exited = await Promise.race([
      new Promise<boolean>((resolve) => processToStop.once('exit', () => resolve(true))),
      delay(V2_CLIENT_SHUTDOWN_GRACE_MS).then(() => false)
    ]);
    if (!exited && processToStop.exitCode === null && processToStop.signalCode === null) {
      processToStop.kill('SIGKILL');
      await new Promise<void>((resolve) => processToStop.once('exit', () => resolve()));
    }
  }
}

async function shutdown(): Promise<void> {
  if (shutdownStarted) return;
  shutdownStarted = true;
  await Promise.all([stopClient(clientProcess), stopClient(loopbackClientProcess)]);
  await app?.close().catch(() => undefined);
  await handoffApp?.close().catch(() => undefined);
  await database?.end().catch(() => undefined);
  await pidHandle?.close().catch(() => undefined);
  if (ownsPidFile) await unlink(pidPath).catch(() => undefined);
}

async function waitForClient(
  url: string,
  timeoutMs: number,
  processToCheck: ChildProcess | undefined,
  hasSpawnFailed: () => boolean
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (hasSpawnFailed() || processToCheck?.exitCode !== null && processToCheck?.exitCode !== undefined) {
      throw new Error('V2_CLIENT_START_FAILED: the isolated V2 client process exited before becoming ready.');
    }
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // Vite has not bound its loopback port yet.
    }
    await delay(200);
  }
  throw new Error('V2_CLIENT_START_TIMEOUT: the isolated V2 client did not become HTTP-ready in time.');
}

let database: Client | undefined;
let app: FastifyInstance | undefined;

try {
  const config = loadV2Config();
  process.title = 'avanpost-peace-v2-api';
  const operation = process.env.AVANPOST_V2_DATABASE_OPERATION === 'test' ? 'test' : 'development';
  const databaseTarget = operation === 'test' ? config.database.test : config.database.development;
  const verifiedDatabase = await connectVerifiedV2Database(config, operation);
  database = verifiedDatabase;
  const pairing = createV2PairingCredentials();
  const api = createV2Server(config, verifiedDatabase, databaseTarget.databaseName, pairing);
  app = api;
  handoffApp = createV2HandoffServer(config, pairing);

  await mkdir(path.dirname(pidPath), { recursive: true });
  pidHandle = await open(pidPath, 'wx');
  ownsPidFile = true;
  await pidHandle.writeFile(`${process.pid}\n`, 'utf8');
  await pidHandle.sync();
  process.once('SIGINT', () => void shutdown());
  process.once('SIGTERM', () => void shutdown());

  await api.listen({ host: config.bindHost, port: config.port });
  await handoffApp.listen({ host: '127.0.0.1', port: config.handoffPort });
  api.startSimulation();
  console.log(
    JSON.stringify({
      status: 'api-ready',
      api: `http://${config.bindHost}:${config.port}/api/health`,
      database: databaseTarget.databaseName,
      networkMode: config.lanEnabled ? 'explicit-private-lan' : 'loopback'
    })
  );

  const projectRoot = getV2ProjectRoot();
  const clientRoot = path.join(projectRoot, 'apps/client-v2');
  const viteCli = path.join(projectRoot, 'node_modules/vite/bin/vite.js');
  if (!existsSync(viteCli)) {
    throw new Error('V2_CLIENT_START_FAILED: the Vite CLI is missing from the installed workspace dependencies.');
  }
  const clientEnv: NodeJS.ProcessEnv = {
    PATH: process.env.PATH,
    HOME: process.env.HOME,
    NODE_ENV: 'development',
    AVANPOST_V2_PORT: String(config.port),
    AVANPOST_V2_HANDOFF_PORT: String(config.handoffPort),
    AVANPOST_V2_BIND_HOST: config.bindHost,
    AVANPOST_V2_ENABLE_LAN: config.lanEnabled ? 'true' : 'false',
    AVANPOST_V2_CLIENT_PORT: '4174',
    AVANPOST_V2_LOOPBACK_CLIENT_PORT: String(config.loopbackClientPort),
    VITE_AVANPOST_V2_API_HOST: config.bindHost,
    VITE_AVANPOST_V2_CLIENT_PORT: '4174',
    VITE_AVANPOST_V2_PORT: String(config.port),
    VITE_AVANPOST_V2_HANDOFF_PORT: String(config.handoffPort)
  };

  clientProcess = spawn(
    process.execPath,
    [viteCli, '--host', config.bindHost, '--port', '4174', '--strictPort'],
    { cwd: clientRoot, env: clientEnv, stdio: ['ignore', 'inherit', 'inherit'] }
  );
  clientProcess.once('error', () => {
    clientSpawnFailed = true;
  });
  const clientUrl = `http://${config.bindHost}:4174/`;
  await waitForClient(clientUrl, 30_000, clientProcess, () => clientSpawnFailed);
  let computerUrl = config.lanEnabled ? clientUrl : 'http://localhost:4174/';
  if (config.lanEnabled && !['127.0.0.1', 'localhost', '::1'].includes(config.bindHost)) {
    const loopbackEnv: NodeJS.ProcessEnv = {
      ...clientEnv,
      AVANPOST_V2_BIND_HOST: '127.0.0.1',
      AVANPOST_V2_CLIENT_PORT: String(config.loopbackClientPort),
      AVANPOST_V2_API_PROXY: 'true',
      AVANPOST_V2_API_PROXY_HOST: config.bindHost,
      VITE_AVANPOST_V2_API_HOST: 'same-origin',
      VITE_AVANPOST_V2_CLIENT_PORT: String(config.loopbackClientPort)
    };
    loopbackClientProcess = spawn(
      process.execPath,
      [viteCli, '--host', '127.0.0.1', '--port', String(config.loopbackClientPort), '--strictPort'],
      { cwd: clientRoot, env: loopbackEnv, stdio: ['ignore', 'inherit', 'inherit'] }
    );
    loopbackClientProcess.once('error', () => {
      loopbackClientSpawnFailed = true;
    });
    await waitForClient(`http://127.0.0.1:${config.loopbackClientPort}/`, 30_000,
      loopbackClientProcess, () => loopbackClientSpawnFailed);
    computerUrl = `http://localhost:${config.loopbackClientPort}/`;
  }
  console.log(
    JSON.stringify({
      status: 'ready',
      apiUrl: `http://${config.bindHost}:${config.port}/api/health`,
      clientUrl,
      computerUrl,
      pairingHandoff: `http://127.0.0.1:${config.handoffPort}`,
      networkMode: config.lanEnabled ? 'explicit-private-lan' : 'loopback',
      database: databaseTarget.databaseName
    })
  );

} catch (error) {
  await shutdown();
  const code =
    error instanceof V2DatabaseError
      ? error.code
      : error instanceof Error && error.message.startsWith('V2_CLIENT_')
        ? error.message.split(':', 1)[0]
        : 'V2_API_START_BLOCKED';
  const message = error instanceof Error ? error.message : 'V2 API start blocked safely.';
  console.error(JSON.stringify({ status: 'blocked', code, message }));
  process.exitCode = 1;
}
