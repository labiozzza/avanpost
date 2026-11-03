import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import { PeaceWorldSnapshotSchema } from '@avanpost/peace-v2-shared';
import { advanceSettlement, findSurfacePath, previewUndergroundRoute, queueUndergroundRoute } from '@avanpost/peace-v2-sim';
import { createWorldScenario } from '../apps/server-v2/src/testing/world-scenarios.js';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outputDirectory = path.join(projectRoot, '.gstack/benchmark-reports');
const sampleCount = Number(process.env.PEACE_V2_BENCH_SAMPLES ?? 40);
const scenarios = ['basic', 'g4-multi-storage', 'g6-underground-excavation'] as const;
if (!Number.isInteger(sampleCount) || sampleCount < 1) throw new Error('PEACE_V2_BENCH_SAMPLES must be a positive integer.');

function percentile(values: number[], p: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * p))] ?? 0;
}

const reports = scenarios.map((scenario) => {
  let world = createWorldScenario(scenario);
  let pathfinding;
  if (scenario === 'g6-underground-excavation') {
    const surfacePathDurationsMs: number[] = [];
    let surfacePathLength: number | null = null;
    const undergroundRouteDurationsMs: number[] = [];
    let undergroundRouteSteps: number | null = null;
    for (let warmup = 0; warmup < 8; warmup += 1) {
      findSurfacePath(world, { x: -20, y: 0 }, { x: 20, y: 0 });
      previewUndergroundRoute(world, 'g6-stone-seam');
    }
    for (let sample = 0; sample < sampleCount; sample += 1) {
      let started = performance.now();
      const surfacePath = findSurfacePath(world, { x: -20, y: 0 }, { x: 20, y: 0 });
      surfacePathDurationsMs.push(performance.now() - started);
      surfacePathLength = surfacePath?.length ?? null;
      started = performance.now();
      const route = previewUndergroundRoute(world, 'g6-stone-seam');
      undergroundRouteDurationsMs.push(performance.now() - started);
      if (!route.ok) throw new Error(`G6.2 benchmark route preview failed: ${route.reason}`);
      undergroundRouteSteps = route.value.steps.length;
    }
    pathfinding = {
      samples: sampleCount,
      surfacePathLength,
      surfaceFindMs: {
        p50: percentile(surfacePathDurationsMs, 0.50), p95: percentile(surfacePathDurationsMs, 0.95),
        max: Math.max(...surfacePathDurationsMs)
      },
      undergroundRouteSteps,
      undergroundRoutePreviewMs: {
        p50: percentile(undergroundRouteDurationsMs, 0.50), p95: percentile(undergroundRouteDurationsMs, 0.95),
        max: Math.max(...undergroundRouteDurationsMs)
      }
    };
    const route = queueUndergroundRoute(world, 'g6-stone-seam');
    if (!route.ok) throw new Error(`G6.2 benchmark route setup failed: ${route.reason}`);
  }
  for (let tick = 0; tick < 8; tick += 1) world = advanceSettlement(world, 1);

  const tickDurationsMs: number[] = [];
  let peakActiveResidents = world.residents.filter((resident) => resident.task !== null).length;
  for (let tick = 0; tick < sampleCount; tick += 1) {
    const started = performance.now();
    world = advanceSettlement(world, 1);
    tickDurationsMs.push(performance.now() - started);
    peakActiveResidents = Math.max(peakActiveResidents,
      world.residents.filter((resident) => resident.task !== null).length);
  }

  const serializationStarted = performance.now();
  const snapshotJson = JSON.stringify(world);
  const serializationMs = performance.now() - serializationStarted;
  const validationStarted = performance.now();
  PeaceWorldSnapshotSchema.parse(JSON.parse(snapshotJson));
  const validationMs = performance.now() - validationStarted;

  return {
    scenario,
    samples: sampleCount,
    surfaceCells: world.surfaceCells.length,
    undergroundCells: world.undergroundCells.length,
    residents: world.residents.length,
    peakActiveResidents,
    tickMs: {
      p50: percentile(tickDurationsMs, 0.50),
      p95: percentile(tickDurationsMs, 0.95),
      p99: percentile(tickDurationsMs, 0.99),
      max: Math.max(...tickDurationsMs)
    },
    ...(pathfinding ? { pathfinding } : {}),
    snapshotBytes: Buffer.byteLength(snapshotJson),
    serializeSnapshotMs: serializationMs,
    parseAndValidateSnapshotMs: validationMs,
    heapUsedBytes: process.memoryUsage().heapUsed
  };
});

mkdirSync(outputDirectory, { recursive: true });
const timestamp = new Date().toISOString().replaceAll(':', '-');
const reportPath = path.join(outputDirectory, `${timestamp}-simulation-benchmark.json`);
const report = {
  schemaVersion: 1,
  timestamp: new Date().toISOString(),
  branch: process.env.GIT_BRANCH ?? 'local',
  environment: { node: process.version, platform: process.platform, arch: process.arch },
  measurement: 'in-process deterministic simulation; no DB or browser timings',
  reports
};
writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);

console.error('PEACE V2 SIMULATION BENCHMARK (Node, in-process)');
console.error('Scenario                       Tick p50   Tick p95   Snapshot');
for (const row of reports) {
  console.error(`${row.scenario.padEnd(30)} ${row.tickMs.p50.toFixed(2).padStart(7)}ms ${row.tickMs.p95.toFixed(2).padStart(9)}ms ${(row.snapshotBytes / 1024).toFixed(1).padStart(8)} KiB`);
}
console.error(`JSON: ${path.relative(projectRoot, reportPath)}`);
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
