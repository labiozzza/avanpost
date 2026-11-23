import { createReadStream } from 'node:fs';
import { readdir, readFile, stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const appRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
const contentTypes = new Map([
  ['.css', 'text/css; charset=utf-8'],
  ['.html', 'text/html; charset=utf-8'],
  ['.ico', 'image/x-icon'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.mjs', 'text/javascript; charset=utf-8'],
  ['.png', 'image/png'],
  ['.svg', 'image/svg+xml'],
  ['.wasm', 'application/wasm'],
  ['.webmanifest', 'application/manifest+json; charset=utf-8'],
  ['.woff2', 'font/woff2']
]);

function resolveInside(root, relativePath) {
  const absolutePath = resolve(root, relativePath);
  const pathFromRoot = relative(root, absolutePath);
  if (pathFromRoot === '..' || pathFromRoot.startsWith(`..${sep}`) || isAbsolute(pathFromRoot)) return null;
  return absolutePath;
}

function isFingerprintAsset(relativePath) {
  return relativePath.startsWith(`assets${sep}`) &&
    /-[A-Za-z0-9_-]{8,}\.[A-Za-z0-9]+$/.test(relativePath);
}

function cacheControl(relativePath) {
  if (relativePath === 'index.html' || relativePath === 'sw.js' ||
      relativePath === 'manifest.webmanifest' || /^workbox-[^/]+\.js$/.test(relativePath)) {
    return 'no-cache, no-store, must-revalidate';
  }
  if (isFingerprintAsset(relativePath)) return 'public, max-age=31536000, immutable';
  return 'no-cache';
}

async function readCurrentRelease(releasesRoot, currentReleaseFile) {
  const pointer = JSON.parse(await readFile(currentReleaseFile, 'utf8'));
  if (typeof pointer.releaseId !== 'string' || !/^[A-Za-z0-9_-]+$/.test(pointer.releaseId)) {
    throw new Error('The active production release pointer is invalid.');
  }
  const releaseRoot = resolveInside(releasesRoot, pointer.releaseId);
  if (!releaseRoot) throw new Error('The active production release escapes its directory.');
  const releaseStat = await stat(releaseRoot);
  if (!releaseStat.isDirectory()) throw new Error('The active production release is not a directory.');
  return { releaseId: pointer.releaseId, releaseRoot };
}

export function createProductionServer(options = {}) {
  const releasesRoot = resolve(options.releasesRoot ?? resolve(appRoot, 'production-releases'));
  const currentReleaseFile = resolve(options.currentReleaseFile ?? resolve(appRoot, 'current-production.json'));
  const retainFingerprintAssets = options.retainFingerprintAssets !== false;

  return createServer((request, response) => {
    void (async () => {
      response.setHeader('X-Content-Type-Options', 'nosniff');
      response.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');

      if (request.method !== 'GET' && request.method !== 'HEAD') {
        response.writeHead(405, { Allow: 'GET, HEAD', 'Cache-Control': 'no-store' }).end();
        return;
      }

      let pathname;
      try {
        pathname = decodeURIComponent(new URL(request.url ?? '/', 'http://localhost').pathname);
      } catch {
        response.writeHead(400, { 'Cache-Control': 'no-store' }).end('Bad request');
        return;
      }
      if (pathname.includes('\0') || pathname.includes('\\')) {
        response.writeHead(400, { 'Cache-Control': 'no-store' }).end('Bad request');
        return;
      }

      let release;
      try {
        release = await readCurrentRelease(releasesRoot, currentReleaseFile);
      } catch {
        response.writeHead(503, { 'Cache-Control': 'no-store', 'Content-Type': 'text/plain; charset=utf-8' })
          .end('The AVANPOST production build is not published yet. Run npm run build:gameplay-prototype:production.');
        return;
      }

      response.setHeader('X-AVANPOST-Build', release.releaseId);
      if (pathname === '/_healthz') {
        response.writeHead(200, { 'Cache-Control': 'no-store', 'Content-Type': 'application/json; charset=utf-8' })
          .end(JSON.stringify({ status: 'ok', buildId: release.releaseId }));
        return;
      }

      const accept = String(request.headers.accept ?? '');
      let relativePath = pathname === '/' ? 'index.html' : pathname.slice(1).replaceAll('/', sep);
      let filePath = resolveInside(release.releaseRoot, relativePath);
      if (!filePath) {
        response.writeHead(400, { 'Cache-Control': 'no-store' }).end('Bad request');
        return;
      }

      let fileStat;
      try {
        fileStat = await stat(filePath);
        if (fileStat.isDirectory()) {
          relativePath = `${relativePath}${relativePath ? sep : ''}index.html`;
          filePath = resolveInside(release.releaseRoot, relativePath);
          if (!filePath) throw new Error('Invalid path.');
          fileStat = await stat(filePath);
        }
      } catch {
        const isNavigation = request.method === 'GET' && accept.includes('text/html') && !extname(relativePath);
        if (isNavigation) {
          relativePath = 'index.html';
          filePath = resolveInside(release.releaseRoot, relativePath);
          try { fileStat = await stat(filePath); }
          catch {
            response.writeHead(404, { 'Cache-Control': 'no-store' }).end('Not found');
            return;
          }
        } else if (retainFingerprintAssets && isFingerprintAsset(relativePath)) {
          const oldReleases = (await readdir(releasesRoot, { withFileTypes: true }))
            .filter((entry) => entry.isDirectory() && entry.name !== release.releaseId)
            .map((entry) => entry.name)
            .sort()
            .reverse();
          let previousAsset;
          for (const releaseId of oldReleases) {
            const oldRoot = resolveInside(releasesRoot, releaseId);
            const candidate = oldRoot && resolveInside(oldRoot, relativePath);
            if (!candidate) continue;
            try {
              const candidateStat = await stat(candidate);
              if (candidateStat.isFile()) {
                previousAsset = { filePath: candidate, fileStat: candidateStat };
                break;
              }
            } catch { /* Try the next immutable release. */ }
          }
          if (previousAsset) {
            filePath = previousAsset.filePath;
            fileStat = previousAsset.fileStat;
          } else {
            response.writeHead(404, { 'Cache-Control': 'no-store' }).end('Not found');
            return;
          }
        } else {
          response.writeHead(404, { 'Cache-Control': 'no-store' }).end('Not found');
          return;
        }
      }

      if (!fileStat.isFile()) {
        response.writeHead(404, { 'Cache-Control': 'no-store' }).end('Not found');
        return;
      }

      const etag = `"${fileStat.size.toString(16)}-${Math.trunc(fileStat.mtimeMs).toString(16)}"`;
      response.setHeader('ETag', etag);
      response.setHeader('Last-Modified', fileStat.mtime.toUTCString());
      response.setHeader('Cache-Control', cacheControl(relativePath));
      response.setHeader('Content-Type', contentTypes.get(extname(relativePath).toLowerCase()) ?? 'application/octet-stream');
      if (request.headers['if-none-match'] === etag) {
        response.writeHead(304).end();
        return;
      }

      response.writeHead(200, { 'Content-Length': fileStat.size });
      if (request.method === 'HEAD') {
        response.end();
        return;
      }
      const stream = createReadStream(filePath);
      stream.on('error', (error) => {
        console.error('[gameplay-production] failed to read static asset:', error.message);
        if (!response.headersSent) response.writeHead(500);
        response.end();
      });
      stream.pipe(response);
    })().catch((error) => {
      console.error('[gameplay-production] request failed:', error instanceof Error ? error.message : error);
      if (!response.headersSent) response.writeHead(500, { 'Cache-Control': 'no-store' });
      response.end('Internal server error');
    });
  });
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const host = process.env.GAMEPLAY_PRODUCTION_HOST || '127.0.0.1';
  const port = Number(process.env.GAMEPLAY_PRODUCTION_PORT || process.env.PORT || 7070);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) throw new Error('GAMEPLAY_PRODUCTION_PORT must be 1–65535.');
  const server = createProductionServer();
  server.once('error', (error) => {
    console.error(`[gameplay-production] could not listen on ${host}:${port}:`, error.message);
    process.exitCode = 1;
  });
  server.listen(port, host, () => {
    console.log(`[gameplay-production] ${host}:${port} serving release ${resolve(appRoot, 'current-production.json')}`);
  });
  const stop = () => server.close(() => process.exit(0));
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
}
