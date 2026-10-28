import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

export default function globalTeardown(): void {
  const tsxCli = path.join(projectRoot, 'node_modules/tsx/dist/cli.mjs');
  try {
    execFileSync(process.execPath, [tsxCli, 'apps/server-v2/src/cli/stop.ts'], {
      cwd: projectRoot,
      env: { ...process.env, AVANPOST_V2_DATABASE_OPERATION: 'test' },
      stdio: 'ignore'
    });
  } catch {
    // The launcher may already have stopped after a failed/startup-blocked test.
  }
}
