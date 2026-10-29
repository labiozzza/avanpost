import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, unlink } from 'node:fs/promises';
import path from 'node:path';
import { getV2ProjectRoot } from '../config.js';
import { assertOwnedV2ApiProcess } from '../process/ownership.js';
import { waitForProcessExit } from '../process/stop-wait.js';

const execFileAsync = promisify(execFile);
const operation = process.env.AVANPOST_V2_DATABASE_OPERATION;
const pidSuffix = operation === 'test' ? '-test' : operation === 'manual' ? '-manual' : '';
const pidPath = path.join(getV2ProjectRoot(), `.gstack/run/peace-v2-api${pidSuffix}.pid`);

try {
  const rawPid = (await readFile(pidPath, 'utf8')).trim();
  const pid = Number(rawPid);
  if (!Number.isSafeInteger(pid) || pid < 2 || pid === process.pid) {
    throw new Error('V2_API_PID_INVALID: refusing to signal an invalid process ID.');
  }

  try {
    process.kill(pid, 0);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error;
    await unlink(pidPath).catch(() => undefined);
    console.log(JSON.stringify({ status: 'stopped', reason: 'V2 API process is not running.' }));
    process.exit(0);
  }

  let command = '';
  ({ stdout: command } = await execFileAsync('ps', ['-p', String(pid), '-o', 'command=']));

  assertOwnedV2ApiProcess(command);

  process.kill(pid, 'SIGTERM');
  const stopped = await waitForProcessExit(() => {
    try {
      process.kill(pid, 0);
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ESRCH') return false;
      throw error;
    }
  });
  if (stopped) {
    await unlink(pidPath).catch(() => undefined);
    console.log(JSON.stringify({ status: 'stopped', process: 'peace-v2-api' }));
    process.exit(0);
  }

  throw new Error('V2_API_STOP_TIMEOUT: V2 launcher/client did not stop after SIGTERM; inspect the owned process safely.');
} catch (error) {
  console.error(
    JSON.stringify({
      status: 'blocked',
      code: error instanceof Error && error.message.includes(':') ? error.message.split(':', 1)[0] : 'V2_API_STOP_BLOCKED',
      message: error instanceof Error ? error.message : 'V2 API stop blocked safely.'
    })
  );
  process.exitCode = 1;
}
