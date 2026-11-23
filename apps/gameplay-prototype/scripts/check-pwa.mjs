import assert from 'node:assert/strict';
import { readdir, readFile, stat } from 'node:fs/promises';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const appRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
const dist = resolve(appRoot, 'dist');
const publicRoot = resolve(appRoot, 'public');

async function listFiles(root, current = root) {
  const result = [];
  for (const entry of await readdir(current, { withFileTypes: true })) {
    const path = join(current, entry.name);
    if (entry.isDirectory()) result.push(...await listFiles(root, path));
    else if (entry.isFile()) result.push(relative(root, path).replaceAll('\\', '/'));
  }
  return result;
}

function localAssetPath(value, basePath = '') {
  const url = new URL(value, `https://pwa.invalid/${basePath}`);
  if (url.origin !== 'https://pwa.invalid') return null;
  return decodeURIComponent(url.pathname.replace(/^\/+/, ''));
}

const files = await listFiles(dist);
const fileSet = new Set(files);
const manifestName = files.find((file) => file === 'manifest.webmanifest');
assert.ok(manifestName, 'production build must emit a web app manifest');
const manifest = JSON.parse(await readFile(join(dist, manifestName), 'utf8'));
assert.equal(manifest.name, 'Аванпост');
assert.equal(manifest.short_name, 'Аванпост');
assert.equal(manifest.lang, 'ru');
assert.equal(manifest.display, 'standalone');
assert.equal(manifest.orientation, 'any', 'PWA must allow both device orientations');
assert.equal(manifest.theme_color, '#1e2a25');
assert.equal(manifest.background_color, '#e9e8df');
assert.equal(localAssetPath(manifest.start_url), '');
assert.equal(localAssetPath(manifest.scope), '');
assert.equal(localAssetPath(manifest.id), '');

for (const icon of manifest.icons) {
  const path = localAssetPath(icon.src);
  assert.ok(path && fileSet.has(path), `${icon.src} must exist in the production build`);
  assert.ok((await stat(join(dist, path))).size > 100, `${icon.src} must be a real icon`);
}
assert.ok(manifest.icons.some((icon) => icon.purpose?.includes('maskable')), 'manifest includes a maskable icon');

const html = await readFile(join(dist, 'index.html'), 'utf8');
assert.doesNotMatch(html, /@vite\/client|\/src\/main\.ts/, 'production HTML must not reference Vite development modules');
assert.match(html, /manifest\.webmanifest/);
assert.match(html, /apple-mobile-web-app-capable/);
assert.match(html, /boot-recovery/, 'the HTML shell includes a boot failure action before the game module runs');

const scriptPaths = [...html.matchAll(/<script[^>]+src=["']([^"']+\.js(?:\?[^"']*)?)["']/gi)]
  .map((match) => localAssetPath(match[1]));
const stylesheetPaths = [...html.matchAll(/<link[^>]+rel=["']stylesheet["'][^>]+href=["']([^"']+\.css(?:\?[^"']*)?)["']/gi)]
  .map((match) => localAssetPath(match[1]));
assert.ok(scriptPaths.length > 0, 'production HTML references a compiled JavaScript bundle');
assert.ok(stylesheetPaths.length > 0, 'production HTML references a compiled stylesheet');

const serviceWorker = await readFile(join(dist, 'sw.js'), 'utf8');
assert.match(serviceWorker, /precacheAndRoute/);
assert.match(serviceWorker, /index\.html/, 'offline navigations have an HTML shell to return');
assert.match(serviceWorker, /skipWaiting/, 'the update handshake is included in the worker');
const precacheUrls = new Set([...serviceWorker.matchAll(/url:"([^"]+)",revision:(?:null|"[^"]+")/g)]
  .map((match) => match[1]));
assert.ok(files.some((file) => file === 'sw.js'), 'production build must emit the Service Worker');
assert.ok(files.some((file) => /^workbox-[^/]+\.js$/.test(file)), 'production build must emit the Workbox runtime');
assert.ok(files.some((file) => file.startsWith('assets/workbox-window') && file.endsWith('.js')),
  'the Service Worker registration client is bundled');

for (const path of [...scriptPaths, ...stylesheetPaths]) {
  assert.ok(path && fileSet.has(path), `HTML bundle dependency ${path} exists in the same release`);
  assert.ok(precacheUrls.has(path), `HTML bundle dependency ${path} is precached`);
}

for (const cssPath of stylesheetPaths) {
  const css = await readFile(join(dist, cssPath), 'utf8');
  for (const [, reference] of css.matchAll(/url\(["']?([^"')]+)["']?\)/g)) {
    if (/^(?:data:|https?:|#)/i.test(reference)) continue;
    const path = localAssetPath(reference, cssPath);
    assert.ok(path && fileSet.has(path), `CSS dependency ${reference} exists in the same release`);
    assert.ok(precacheUrls.has(path), `CSS dependency ${reference} is precached`);
  }
}

// Provenance notes may sit beside source artwork, but they are not runtime assets.
const publicAssets = (await listFiles(resolve(publicRoot, 'assets')))
  .filter((asset) => !asset.toLowerCase().endsWith('.md'));
for (const asset of publicAssets) {
  const distPath = `assets/${asset}`;
  assert.ok(fileSet.has(distPath), `${distPath} is copied into the production release`);
  assert.ok(precacheUrls.has(distPath), `${distPath} is included in the offline precache`);
}

const workboxRuntime = files.find((file) => /^workbox-[^/]+\.js$/.test(file));
assert.ok(serviceWorker.includes(`./${basename(workboxRuntime, '.js')}`), 'the worker imports its bundled Workbox runtime');
console.log(`PWA checks passed: ${precacheUrls.size} cached files, ${publicAssets.length} game assets, compiled HTML/JS/CSS and Workbox.`);
