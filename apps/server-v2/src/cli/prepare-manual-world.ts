import { execFileSync } from 'node:child_process';
import { closeSync, existsSync, openSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { getV2ProjectRoot, loadV2Env } from '../config.js';
import { listWorldScenarios, WORLD_SCENARIO_DESCRIPTIONS } from '../testing/world-scenarios.js';

loadV2Env();

const startedAt = performance.now();
const projectRoot = getV2ProjectRoot();
const serverRoot = path.join(projectRoot, 'apps/server-v2');
const tsxCli = path.join(projectRoot, 'node_modules/tsx/dist/cli.mjs');
const manualPidPath = path.join(projectRoot, '.gstack/run/peace-v2-api-manual.pid');
const scenario = process.argv[2] ?? 'basic';
const env = {
  ...process.env,
  AVANPOST_V2_DATABASE_OPERATION: 'manual',
  AVANPOST_V2_ENABLE_LAN: 'false',
  AVANPOST_V2_BIND_HOST: '127.0.0.1'
};

if (scenario === '--list') {
  console.log(JSON.stringify({ scenarios: listWorldScenarios().map((name) => ({
    name, description: WORLD_SCENARIO_DESCRIPTIONS[name]
  })) }));
  process.exit(0);
}

try {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('V2_MANUAL_WORLD_PREPARE_BLOCKED: manual scenario preparation is disabled in production.');
  }
  if (existsSync(manualPidPath)) {
    execFileSync(process.execPath, [tsxCli, 'apps/server-v2/src/cli/stop.ts'], {
      cwd: projectRoot, env, stdio: 'inherit'
    });
  }
  execFileSync(process.execPath, [tsxCli, 'src/cli/create-manual-database.ts'], {
    cwd: serverRoot, env, stdio: 'inherit'
  });
  execFileSync(process.execPath, [tsxCli, 'src/cli/migrate.ts'], {
    cwd: serverRoot, env, stdio: 'inherit'
  });
  execFileSync(process.execPath, [tsxCli, 'src/cli/reset-isolated-world.ts', scenario], {
    cwd: serverRoot, env, stdio: 'inherit'
  });
  const logPath = path.join(projectRoot, '.gstack/run/peace-v2-api-manual.log');
  const logFd = openSync(logPath, 'a');
  const child = spawn(process.execPath, [tsxCli, 'src/cli/dev.ts'], {
    cwd: serverRoot, env, detached: true, stdio: ['ignore', logFd, logFd]
  });
  closeSync(logFd);
  let childExitCode: number | null | undefined;
  child.once('exit', (code) => { childExitCode = code; });
  child.unref();
  const deadline = Date.now() + 45_000;
  let ready = false;
  while (Date.now() < deadline) {
    const [health, client] = await Promise.all([
      fetch('http://127.0.0.1:19888/api/health').then(async (response) => response.ok &&
        (await response.json() as { database?: string }).database === 'avanpost_v2_manual').catch(() => false),
      fetch('http://127.0.0.1:15174/').then((response) => response.ok).catch(() => false)
    ]);
    if (health && client) {
      ready = true;
      break;
    }
    if (childExitCode !== null && childExitCode !== undefined) {
      const childOutput = readFileSync(logPath, 'utf8').slice(-4000);
      throw new Error(`V2_MANUAL_WORLD_PREPARE_BLOCKED: manual launcher exited with code ${childExitCode}: ${childOutput}`);
    }
    await delay(250);
  }
  if (!ready) {
    const childOutput = readFileSync(logPath, 'utf8').slice(-4000);
    throw new Error(`V2_MANUAL_WORLD_PREPARE_BLOCKED: manual launcher did not become ready within 45 seconds: ${childOutput}`);
  }
  console.log(JSON.stringify({
    status: 'prepared', environment: 'manual', database: 'avanpost_v2_manual', worldId: 'peace-home',
    scenario, url: 'http://localhost:15174/', durationMs: Math.round(performance.now() - startedAt),
    launcherPidFile: '.gstack/run/peace-v2-api-manual.pid'
  }));
} catch (error) {
  if (existsSync(manualPidPath)) {
    try {
      execFileSync(process.execPath, [tsxCli, 'apps/server-v2/src/cli/stop.ts'], {
        cwd: projectRoot, env, stdio: 'ignore'
      });
    } catch {
      // Preserve the original setup failure; stop.ts only targets the manual PID.
    }
  }
  const message = error instanceof Error ? error.message : 'Manual world preparation failed safely.';
  const code = (message.startsWith('V2_') ? message.split(':', 1)[0] : undefined) ?? 'V2_MANUAL_WORLD_PREPARE_BLOCKED';
  console.error(JSON.stringify({ status: 'blocked', code, detail: message.slice(code.length + 1).trim() }));
  process.exitCode = 1;
}
