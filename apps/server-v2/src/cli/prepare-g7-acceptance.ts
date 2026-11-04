import { closeSync, existsSync, openSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { execFileSync } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { getV2ProjectRoot, loadV2Config, loadV2Env } from '../config.js';

loadV2Env();
if (process.env.NODE_ENV === 'production') throw new Error('G7 acceptance launch is disabled in production.');
if (process.env.AVANPOST_V2_DATABASE_OPERATION !== 'manual') throw new Error('G7 acceptance requires manual DB operation.');

const projectRoot = getV2ProjectRoot();
const serverRoot = path.join(projectRoot, 'apps/server-v2');
const tsxCli = path.join(projectRoot, 'node_modules/tsx/dist/cli.mjs');
const pidPath = path.join(projectRoot, '.gstack/run/peace-v2-api-g7-acceptance.pid');
const logPath = path.join(projectRoot, '.gstack/run/peace-v2-api-g7-acceptance.log');

const initial = loadV2Config();
const dbUrl = new URL(initial.database.manualUrl);
dbUrl.pathname = '/avanpost_v2_g7_1_acceptance';
process.env.AVANPOST_V2_MANUAL_DATABASE_URL ||= dbUrl.toString();
process.env.AVANPOST_V2_MANUAL_PORT ||= '18908';
process.env.AVANPOST_V2_MANUAL_HANDOFF_PORT ||= '18909';
process.env.AVANPOST_V2_MANUAL_CLIENT_PORT ||= '14194';
process.env.AVANPOST_V2_MANUAL_LOOPBACK_CLIENT_PORT ||= '14195';
const config = loadV2Config();
const env = { ...process.env, AVANPOST_V2_DATABASE_OPERATION: 'manual', AVANPOST_V2_RUNTIME_LABEL: 'g7-acceptance', AVANPOST_V2_BIND_HOST: '127.0.0.1', AVANPOST_V2_ENABLE_LAN: 'false' };

try {
  if (existsSync(pidPath)) throw new Error('G7 acceptance launcher already has a PID file; inspect it before restarting.');
  execFileSync(process.execPath, [tsxCli, 'src/cli/migrate.ts'], { cwd: serverRoot, env, stdio: 'inherit' });
  execFileSync(process.execPath, [tsxCli, 'src/cli/reset-isolated-world.ts', 'g7-population-housing'], { cwd: serverRoot, env, stdio: 'inherit' });
  const logFd = openSync(logPath, 'a');
  const child = spawn(process.execPath, [tsxCli, 'src/cli/dev.ts'], { cwd: serverRoot, env, detached: true, stdio: ['ignore', logFd, logFd] });
  closeSync(logFd);
  child.unref();
  const deadline = Date.now() + 45_000;
  while (Date.now() < deadline) {
    const [health, client] = await Promise.all([
      fetch(`http://127.0.0.1:${config.port}/api/health`).then(async (response) => response.ok &&
        (await response.json() as { database?: string }).database === 'avanpost_v2_g7_1_acceptance').catch(() => false),
      fetch(`http://127.0.0.1:${config.clientPort}/`).then((response) => response.ok).catch(() => false)
    ]);
    if (health && client) {
      console.log(JSON.stringify({ status: 'ready', database: 'avanpost_v2_g7_1_acceptance',
        client: `http://127.0.0.1:${config.clientPort}/`, api: `http://127.0.0.1:${config.port}`, pidFile: pidPath }));
      process.exit(0);
    }
    await delay(250);
  }
  throw new Error(`G7 acceptance server did not become ready: ${readFileSync(logPath, 'utf8').slice(-4000)}`);
} catch (error) {
  console.error(error instanceof Error ? error.message : 'G7 acceptance launch failed.');
  process.exitCode = 1;
}
