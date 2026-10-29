import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { expect, test } from '@playwright/test';

const projectRoot = process.cwd();
const tsxCli = path.join(projectRoot, 'node_modules/tsx/dist/cli.mjs');
const scenarios = [
  'empty', 'basic', 'resources-full', 'lumberjack', 'stone-mining', 'construction',
  'construction-role-transition', 'construction-blocked', 'logistics-deadlock', 'multi-worker', 'late-settlement'
];

function manualTestClientUrl(): string {
  const port = Number(process.env.AVANPOST_V2_TEST_LOOPBACK_CLIENT_PORT ?? '14175');
  return process.env.AVANPOST_V2_ENABLE_LAN === 'true'
    ? `http://localhost:${port}/`
    : `http://${process.env.AVANPOST_V2_BIND_HOST ?? '127.0.0.1'}:${Number(process.env.AVANPOST_V2_TEST_CLIENT_PORT ?? '14174')}/`;
}

function resetScenario(scenario: string): void {
  execFileSync(process.execPath, [tsxCli, 'src/cli/reset-isolated-world.ts', scenario], {
    cwd: path.join(projectRoot, 'apps/server-v2'),
    env: { ...process.env, AVANPOST_V2_DATABASE_OPERATION: 'test' },
    stdio: 'pipe'
  });
}

test('G3.6 every named scenario resets deterministically and loads in the client', async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  test.skip(testInfo.project.name !== 'peace-v2-desktop', 'Each scenario is smoke-tested once in desktop Chromium.');

  for (const scenario of scenarios) {
    resetScenario(scenario);
    await page.goto(manualTestClientUrl());
    await expect(page.locator('#world-scene canvas')).toBeVisible();
    const preview = await page.evaluate(async () => {
      const response = await fetch('/api/world/preview', { cache: 'no-store' });
      const world = await response.json() as {
        revision?: { worldVersion: number };
        actors?: unknown[];
        buildings?: unknown[];
        resourceTotals?: unknown[];
      };
      return { status: response.status, world };
    });
    expect(preview.status, `scenario ${scenario} preview`).toBe(200);
    expect(preview.world.revision?.worldVersion, `scenario ${scenario} revision`).toBeGreaterThan(0);
    expect(preview.world.actors?.length, `scenario ${scenario} actors`).toBeGreaterThanOrEqual(2);
    expect(preview.world.buildings, `scenario ${scenario} buildings`).toBeDefined();
    expect(preview.world.resourceTotals, `scenario ${scenario} resources`).toBeDefined();
    await expect(page.locator('#world-scene')).toHaveAttribute('data-camera-zoom', /\d/);
  }
});
