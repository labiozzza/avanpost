import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { createProductionServer } from './production-server.mjs';

test('production server serves only a published static release and retains old hashed bundles', async (t) => {
  const tempRoot = await mkdtemp(join(tmpdir(), 'avanpost-pwa-server-'));
  const releasesRoot = join(tempRoot, 'releases');
  const currentReleaseFile = join(tempRoot, 'current.json');
  const releaseOne = join(releasesRoot, 'release-one');
  const releaseTwo = join(releasesRoot, 'release-two');
  await mkdir(join(releaseOne, 'assets'), { recursive: true });
  await mkdir(join(releaseTwo, 'assets'), { recursive: true });
  await writeFile(join(releaseOne, 'index.html'), '<main>Release one</main>');
  await writeFile(join(releaseOne, 'assets', 'app-12345678.js'), 'window.release = 1;');
  await writeFile(join(releaseOne, 'assets', 'mine-entrance.svg'), '<svg xmlns="http://www.w3.org/2000/svg"></svg>');
  await writeFile(join(releaseTwo, 'index.html'), '<main>Release two</main>');
  await writeFile(join(releaseTwo, 'assets', 'app-87654321.js'), 'window.release = 2;');
  await writeFile(currentReleaseFile, JSON.stringify({ releaseId: 'release-one' }));

  const server = createProductionServer({ releasesRoot, currentReleaseFile });
  t.after(async () => {
    await new Promise((resolveClose, reject) => server.close((error) => error ? reject(error) : resolveClose()));
    await rm(tempRoot, { recursive: true, force: true });
  });
  await new Promise((resolveListen, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolveListen);
  });
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  const origin = `http://127.0.0.1:${address.port}`;

  const page = await fetch(`${origin}/`);
  assert.equal(page.status, 200);
  assert.equal(page.headers.get('x-avanpost-build'), 'release-one');
  assert.match(page.headers.get('cache-control'), /no-store/);
  assert.equal(await page.text(), '<main>Release one</main>');

  const appBundle = await fetch(`${origin}/assets/app-12345678.js`);
  assert.equal(appBundle.status, 200);
  assert.match(appBundle.headers.get('content-type'), /javascript/);
  assert.match(appBundle.headers.get('cache-control'), /immutable/);
  assert.equal(await appBundle.text(), 'window.release = 1;');

  const mineSprite = await fetch(`${origin}/assets/mine-entrance.svg`);
  assert.equal(mineSprite.status, 200);
  assert.match(mineSprite.headers.get('content-type'), /image\/svg\+xml/);
  assert.equal(await mineSprite.text(), '<svg xmlns="http://www.w3.org/2000/svg"></svg>');

  const viteClient = await fetch(`${origin}/@vite/client`);
  assert.equal(viteClient.status, 404);
  const sourceModule = await fetch(`${origin}/src/main.ts`);
  assert.equal(sourceModule.status, 404);
  const routeFallback = await fetch(`${origin}/settings`, { headers: { Accept: 'text/html' } });
  assert.equal(routeFallback.status, 200);
  assert.equal(await routeFallback.text(), '<main>Release one</main>');

  await writeFile(currentReleaseFile, JSON.stringify({ releaseId: 'release-two' }));
  const currentPage = await fetch(`${origin}/`);
  assert.equal(currentPage.headers.get('x-avanpost-build'), 'release-two');
  assert.equal(await currentPage.text(), '<main>Release two</main>');
  const oldBundle = await fetch(`${origin}/assets/app-12345678.js`);
  assert.equal(oldBundle.status, 200);
  assert.equal(oldBundle.headers.get('x-avanpost-build'), 'release-two');
  assert.equal(await oldBundle.text(), 'window.release = 1;');

  await rm(currentReleaseFile);
  const unpublished = await fetch(`${origin}/`);
  assert.equal(unpublished.status, 503);
});
