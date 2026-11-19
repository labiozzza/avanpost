import assert from 'node:assert/strict';
import { readFile, readdir, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const dist = new URL('../dist/', import.meta.url);
const files = await readdir(dist);
const manifestName = files.find((file) => file.endsWith('.webmanifest'));
assert.ok(manifestName, 'production build must emit a web app manifest');
const manifest = JSON.parse(await readFile(new URL(manifestName, dist), 'utf8'));
assert.equal(manifest.name, 'Аванпост');
assert.equal(manifest.short_name, 'Аванпост');
assert.equal(manifest.lang, 'ru');
assert.equal(manifest.display, 'standalone');
assert.equal(manifest.orientation, 'any', 'PWA must allow both device orientations');
assert.equal(manifest.theme_color, '#1e2a25');
assert.equal(manifest.background_color, '#e9e8df');
assert.ok(manifest.start_url && manifest.scope);
assert.ok(manifest.id);
for (const icon of manifest.icons) {
  const iconPath = fileURLToPath(new URL(icon.src.replace(/^\//, ''), dist));
  const info = await stat(iconPath);
  assert.ok(info.size > 100, `${icon.src} must be a real icon`);
}
assert.ok(manifest.icons.some((icon) => icon.purpose?.includes('maskable')), 'manifest includes maskable icon');
assert.ok(files.some((file) => /^sw\.js$/.test(file)), 'production build must emit service worker');
assert.ok(files.some((file) => /^workbox-.*\.js$/.test(file)), 'production build must emit Workbox runtime');
const serviceWorker = await readFile(new URL('sw.js', dist), 'utf8');
const html = await readFile(new URL('index.html', dist), 'utf8');
assert.match(html, /manifest\.webmanifest/);
assert.match(html, /apple-mobile-web-app-capable/);
for (const asset of [
  'background-panorama.png', 'sideview-geology-atlas.png', 'sideview-turf-tile.png', 'tree_full.png', 'tree_stump.png',
  'stone-outcrop.png', 'storehouse.png', 'house.png', 'worker-atlas.png', 'worker_idle.png'
]) {
  const filePath = new URL(`assets/peace-v2/${asset}`, dist);
  assert.ok((await stat(filePath)).size > 100, `${asset} must be available in production output`);
  assert.ok(serviceWorker.includes(asset), `${asset} must be included in the offline precache`);
}
for (const asset of [
  'eastern-marsh-trees.svg', 'eastern-marsh-understory.svg', 'eastern-marsh-ground.svg', 'stockpile_logs.png'
]) {
  const filePath = new URL(`assets/gameplay-prototype/${asset}`, dist);
  assert.ok((await stat(filePath)).size > 100, `${asset} must be available in production output`);
  assert.ok(serviceWorker.includes(asset), `${asset} must be included in the offline precache`);
}
console.log(`PWA artifact checks passed: ${manifestName}, ${manifest.icons.length} icons, Service Worker and 14 game assets.`);
