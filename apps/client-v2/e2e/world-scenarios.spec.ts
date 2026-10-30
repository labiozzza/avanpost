import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { expect, test } from '@playwright/test';

const projectRoot = process.cwd();
const tsxCli = path.join(projectRoot, 'node_modules/tsx/dist/cli.mjs');
const scenarios = [
  'empty', 'basic', 'resources-full', 'lumberjack', 'stone-mining', 'construction',
  'construction-role-transition', 'construction-blocked', 'logistics-deadlock', 'multi-worker', 'g4-multi-storage', 'late-settlement'
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
        actors?: Array<{ workRole?: string; cargo?: number; visualState?: string }>;
        buildings?: unknown[];
        buildOrders?: Array<{ status: string; blockedReason: string | null }>;
        storages?: Array<{ id: string; contents: { wood: number; stone: number } }>;
        resourceNodes?: Array<{ visualKey: string; bufferQuantity: number; bufferCapacity: number }>;
        stoneDeposits?: Array<{ remaining: number; bufferQuantity: number; bufferCapacity: number }>;
        resourceTotals?: unknown[];
      };
      return { status: response.status, world };
    });
    expect(preview.status, `scenario ${scenario} preview`).toBe(200);
    expect(preview.world.revision?.worldVersion, `scenario ${scenario} revision`).toBeGreaterThan(0);
    if (scenario === 'g4-multi-storage') {
      expect(preview.world.actors?.map((actor) => actor.workRole).sort())
        .toEqual(['builder', 'hauler', 'stone_miner', 'woodcutter'].sort());
      const builder = preview.world.actors?.find((actor) => actor.workRole === 'builder');
      expect(builder?.cargo).toBe(1);
      expect(['waiting_storage', 'carrying_to_storage']).toContain(builder?.visualState);
      expect(preview.world.storages).toHaveLength(2);
      expect(preview.world.storages?.map((storage) => storage.contents.wood)).toEqual([16, 0]);
      expect(preview.world.stoneDeposits?.[0]?.bufferQuantity).toBe(6);
      expect(preview.world.resourceNodes?.find((node) => node.visualKey === 'resource-tree-3'))
        .toMatchObject({ bufferQuantity: 3, bufferCapacity: 3 });
      expect(['waiting_materials', 'waiting_builder']).toContain(preview.world.buildOrders?.[0]?.status);
      expect(['INSUFFICIENT_STONE', 'NO_BUILDER']).toContain(preview.world.buildOrders?.[0]?.blockedReason);
    } else {
      expect(preview.world.actors?.length, `scenario ${scenario} actors`).toBeGreaterThanOrEqual(2);
    }
    expect(preview.world.buildings, `scenario ${scenario} buildings`).toBeDefined();
    expect(preview.world.resourceTotals, `scenario ${scenario} resources`).toBeDefined();
    if (scenario === 'g4-multi-storage') {
      await expect(page.locator('#world-scene')).toHaveAttribute('data-storage-visual-count', '2');
      await page.locator('#pairing-panel summary').click();
      const storagePoints = await page.evaluate(async () => {
        const response = await fetch('/api/world/preview', { cache: 'no-store' });
        const preview = await response.json() as {
          storages: Array<{ id: string; anchor: { x: number }; footprint: { width: number } }>;
        };
        const root = document.querySelector<HTMLElement>('#world-scene')!;
        const canvas = document.querySelector<HTMLCanvasElement>('#world-scene canvas')!;
        const rect = canvas.getBoundingClientRect();
        const scaleX = rect.width / canvas.width;
        const scaleY = rect.height / canvas.height;
        const zoom = Number(root.dataset.cameraZoom);
        const viewX = Number(root.dataset.cameraWorldViewX);
        const viewY = Number(root.dataset.cameraWorldViewY);
        return preview.storages.map((storage) => ({
          x: ((storage.anchor.x * 48 + storage.footprint.width * 24 - viewX) * zoom) * scaleX,
          y: ((-110 - viewY) * zoom) * scaleY
        }));
      });
      for (const [index, storage] of storagePoints.entries()) {
        await page.locator('#world-scene canvas').click({ position: { x: storage.x, y: storage.y } });
        await page.waitForTimeout(1_250);
        await expect(page.locator('#world-context')).toBeVisible();
        await expect(page.locator('#context-kind')).toHaveText('СКЛАД');
        await expect(page.locator('#inspector-title')).toHaveText(index === 0 ? 'Главный склад' : 'Склад у рощи');
        await expect(page.locator('#inspector-detail')).toContainText(index === 0 ? '16/16' : '0/16');
      }
    }
    await expect(page.locator('#world-scene')).toHaveAttribute('data-camera-zoom', /\d/);
  }
});
