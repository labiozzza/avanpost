import { execFileSync, spawnSync } from 'node:child_process';
import { cp, mkdir, open, rename, rm, stat, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';

const appRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
const repositoryRoot = resolve(appRoot, '../..');
const distRoot = resolve(appRoot, 'dist');
const releasesRoot = resolve(appRoot, 'production-releases');
const pointerPath = resolve(appRoot, 'current-production.json');
const lockPath = resolve(appRoot, '.production-build.lock');

let lock;
let temporaryRelease;
let temporaryPointer;
let pendingRelease;

async function renameWithRetry(source, destination) {
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      await rename(source, destination);
      return;
    } catch (error) {
      if (!['EPERM', 'EACCES', 'EBUSY'].includes(error?.code) || attempt === 4) throw error;
      await new Promise((resolveWait) => setTimeout(resolveWait, 100 * 2 ** attempt));
    }
  }
}

try {
  lock = await open(lockPath, 'wx');
} catch (error) {
  if (error?.code === 'EEXIST') throw new Error('A production build is already running. Wait for it to finish.');
  throw error;
}

try {
  let commit = 'local';
  try {
    commit = execFileSync('git', ['rev-parse', '--short=12', 'HEAD'], {
      cwd: repositoryRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore']
    }).trim() || commit;
  } catch { /* A source archive can still publish a uniquely named local build. */ }

  const timestamp = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);
  const releaseId = `${commit}-${timestamp}`;
  process.env.GAMEPLAY_BUILD_ID = releaseId;

  console.log(`[gameplay-production] building immutable release ${releaseId}`);
  await build({ configFile: resolve(appRoot, 'vite.config.ts'), root: appRoot });

  const check = spawnSync(process.execPath, [resolve(appRoot, 'scripts/check-pwa.mjs')], {
    cwd: repositoryRoot,
    stdio: 'inherit'
  });
  if (check.error) throw check.error;
  if (check.status !== 0) throw new Error(`Production PWA check failed with exit code ${check.status}.`);

  await mkdir(releasesRoot, { recursive: true });
  const releaseRoot = resolve(releasesRoot, releaseId);
  try {
    await stat(releaseRoot);
    throw new Error(`Production release ${releaseId} already exists.`);
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
  pendingRelease = releaseRoot;
  temporaryRelease = resolve(releasesRoot, `.${releaseId}.tmp-${process.pid}`);
  await cp(distRoot, temporaryRelease, { recursive: true, errorOnExist: true, force: false });
  try {
    await renameWithRetry(temporaryRelease, releaseRoot);
  } catch (error) {
    if (process.platform !== 'win32' || !['EPERM', 'EBUSY'].includes(error?.code)) throw error;
    console.warn('[gameplay-production] Windows blocked the directory rename; copying the inactive release before switching it live.');
    await cp(temporaryRelease, releaseRoot, { recursive: true, errorOnExist: true, force: false });
    await rm(temporaryRelease, { recursive: true, force: true });
  }
  temporaryRelease = undefined;

  const pointer = JSON.stringify({ releaseId, commit, publishedAt: new Date().toISOString() }, null, 2) + '\n';
  temporaryPointer = `${pointerPath}.next-${process.pid}`;
  await writeFile(temporaryPointer, pointer, { flag: 'wx' });
  await renameWithRetry(temporaryPointer, pointerPath);
  temporaryPointer = undefined;
  pendingRelease = undefined;

  console.log(`[gameplay-production] published ${releaseId}; origin and storage path stay at /`);
} catch (error) {
  if (temporaryRelease) await rm(temporaryRelease, { recursive: true, force: true }).catch(() => {});
  if (temporaryPointer) await rm(temporaryPointer, { force: true }).catch(() => {});
  if (pendingRelease) await rm(pendingRelease, { recursive: true, force: true }).catch(() => {});
  throw error;
} finally {
  await lock?.close().catch(() => {});
  await rm(lockPath, { force: true }).catch(() => {});
}
