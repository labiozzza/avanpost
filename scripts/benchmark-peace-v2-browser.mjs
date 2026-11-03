import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { chromium, devices } from '@playwright/test';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outputDirectory = path.join(projectRoot, '.gstack/benchmark-reports');
const targetUrl = process.env.PEACE_V2_BENCH_URL;
if (!targetUrl) throw new Error('Set PEACE_V2_BENCH_URL to the V2 preview URL before running this benchmark.');
const sampleDurationMs = Number(process.env.PEACE_V2_BROWSER_BENCH_MS ?? 10_000);

function percentile(values, p) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * p))] ?? null;
}

async function benchmarkProfile(browser, name, contextOptions) {
  const context = await browser.newContext(contextOptions);
  const page = await context.newPage();
  await page.goto(targetUrl, { waitUntil: 'domcontentloaded' });
  await page.locator('#world-scene canvas').waitFor({ state: 'visible', timeout: 30_000 });
  await page.waitForFunction(() => /Только чтение|Мир сохранён/.test(document.body.innerText), null, { timeout: 30_000 });
  await page.waitForTimeout(2_000);

  const sample = await page.evaluate(async (durationMs) => {
    const percentile = (values, p) => {
      const sorted = [...values].sort((a, b) => a - b);
      return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * p))] ?? null;
    };
    const root = document.querySelector('#world-scene');
    const canvas = root?.querySelector('canvas');
    const longTasks = [];
    const observer = new PerformanceObserver((list) => {
      longTasks.push(...list.getEntries().map((entry) => entry.duration));
    });
    observer.observe({ type: 'longtask' });

    const start = performance.now();
    let previous;
    const frameTimes = [];
    await new Promise((resolve) => {
      const frame = (timestamp) => {
        if (previous !== undefined) frameTimes.push(timestamp - previous);
        previous = timestamp;
        if (timestamp - start >= durationMs) resolve();
        else requestAnimationFrame(frame);
      };
      requestAnimationFrame(frame);
    });
    const elapsedMs = performance.now() - start;
    longTasks.push(...observer.takeRecords().map((entry) => entry.duration));
    observer.disconnect();

    const worldResponse = await fetch('/api/world/preview', { cache: 'no-store' });
    const world = worldResponse.ok ? await worldResponse.json() : null;
    const resources = performance.getEntriesByType('resource')
      .filter((entry) => new URL(entry.name).pathname === '/api/world/preview');
    const apiDurations = resources.map((entry) => entry.duration);
    const transfers = resources.map((entry) => entry.transferSize);
    const apiIntervals = resources.slice(1).map((entry, index) => entry.startTime - resources[index].startTime);

    let webgl = null;
    if (canvas) {
      const gl = canvas.getContext('webgl2') ?? canvas.getContext('webgl');
      if (gl) {
        const debugInfo = gl.getExtension('WEBGL_debug_renderer_info');
        webgl = {
          version: gl.getParameter(gl.VERSION),
          renderer: debugInfo ? gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL) : null,
          vendor: debugInfo ? gl.getParameter(debugInfo.UNMASKED_VENDOR_WEBGL) : null,
          maxTextureSize: gl.getParameter(gl.MAX_TEXTURE_SIZE),
          maxTextureImageUnits: gl.getParameter(gl.MAX_TEXTURE_IMAGE_UNITS)
        };
      }
    }

    return {
      sampleDurationMs: elapsedMs,
      frameCount: frameTimes.length,
      fps: frameTimes.length / (elapsedMs / 1000),
      frameTimeMs: {
        p50: percentile(frameTimes, 0.50), p95: percentile(frameTimes, 0.95),
        p99: percentile(frameTimes, 0.99), max: Math.max(...frameTimes)
      },
      longTasks: {
        thresholdMs: 50, count: longTasks.filter((duration) => duration >= 50).length,
        totalMs: longTasks.filter((duration) => duration >= 50).reduce((sum, duration) => sum + duration, 0),
        maxMs: Math.max(0, ...longTasks)
      },
      heapUsedBytes: performance.memory?.usedJSHeapSize ?? null,
      undergroundCells: world?.undergroundCells?.length ?? null,
      undergroundTileObjectsLowerBound: world?.undergroundCells?.length ?? null,
      renderer: webgl ? 'WebGL' : 'unknown-or-canvas',
      webgl,
      textureMemoryBytes: null,
      drawCalls: null,
      worldPreviewRequests: {
        count: resources.length,
        durationP50Ms: percentile(apiDurations, 0.50),
        durationP95Ms: percentile(apiDurations, 0.95),
        transferP50Bytes: percentile(transfers, 0.50),
        intervalP50Ms: percentile(apiIntervals, 0.50)
      },
      domDatasetKeys: root ? Object.keys(root.dataset).length : null,
      perCellDomDatasetKeys: root
        ? Object.keys(root.dataset).filter((key) => key.startsWith('undergroundCell')).length : null,
      residentTweens: root
        ? Object.entries(root.dataset)
          .filter(([key]) => /^resident.*TweenCount$/.test(key))
          .map(([key, value]) => ({ resident: key.slice('resident'.length, -'TweenCount'.length), count: Number(value) }))
        : [],
      canvas: canvas ? {
        cssWidth: canvas.getBoundingClientRect().width,
        cssHeight: canvas.getBoundingClientRect().height,
        backingWidth: canvas.width,
        backingHeight: canvas.height,
        devicePixelRatio
      } : null,
      pageStatus: document.body.innerText.match(/Только чтение|Мир сохранён/)?.[0] ?? null
    };
  }, sampleDurationMs);

  await context.close();
  return { profile: name, emulationOnly: name === 'mobile-emulation', ...sample };
}

const browser = await chromium.launch({ headless: true });
try {
  const profiles = [
    await benchmarkProfile(browser, 'desktop', { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 }),
    await benchmarkProfile(browser, 'mobile-emulation', devices['Pixel 7'])
  ];
  const report = {
    schemaVersion: 1,
    timestamp: new Date().toISOString(),
    targetUrl,
    mode: 'read-only browser rendering benchmark; fresh unpaired sessions load /api/world/preview',
    note: 'Mobile numbers are Pixel 7 Chromium emulation, not a physical-device measurement. GPU draw calls and texture memory are not exposed by this harness.',
    environment: { node: process.version, platform: process.platform, arch: process.arch },
    profiles
  };
  mkdirSync(outputDirectory, { recursive: true });
  const timestamp = report.timestamp.replaceAll(':', '-');
  const reportPath = path.join(outputDirectory, `${timestamp}-browser-benchmark.json`);
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  console.error(`Browser benchmark: ${path.relative(projectRoot, reportPath)}`);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
} finally {
  await browser.close();
}
