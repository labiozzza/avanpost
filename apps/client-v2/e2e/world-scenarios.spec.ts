import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { expect, test } from '@playwright/test';

const projectRoot = process.cwd();
const tsxCli = path.join(projectRoot, 'node_modules/tsx/dist/cli.mjs');
const scenarios = [
  'empty', 'basic', 'resources-full', 'lumberjack', 'stone-mining', 'construction',
  'construction-role-transition', 'construction-blocked', 'logistics-deadlock', 'multi-worker',
  'g4-multi-storage', 'g4-logistics-priority', 'g5-construction-layout', 'g5-support-invalid',
  'g5-route-blocked', 'g5-demolition-cleanup', 'g5-logistics-blocked', 'late-settlement'
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
        buildings?: Array<{ buildingId?: string }>;
        buildOrders?: Array<{ status: string; blockedReason: string | null; queuePosition?: number }>;
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
    } else if (scenario === 'g4-logistics-priority') {
      expect(preview.world.actors?.filter((actor) => actor.workRole === 'hauler')).toHaveLength(2);
      expect(preview.world.actors?.some((actor) => actor.workRole === 'woodcutter')).toBe(true);
      expect(preview.world.actors?.some((actor) => actor.workRole === 'stone_miner')).toBe(true);
      expect(preview.world.actors?.some((actor) => actor.workRole === 'builder')).toBe(true);
      expect(preview.world.storages).toHaveLength(2);
      expect(preview.world.stoneDeposits?.[0]?.bufferCapacity).toBeGreaterThan(0);
      expect(preview.world.buildOrders).toHaveLength(2);
      expect(preview.world.buildOrders?.map((order) => order.queuePosition).sort()).toEqual([0, 1]);
    } else if (scenario.startsWith('g5-')) {
      const loadedHauler = preview.world.actors?.find((actor) => actor.workRole === 'hauler');
      if (scenario === 'g5-demolition-cleanup' || scenario === 'g5-logistics-blocked') {
        expect(preview.world.actors).toHaveLength(2);
      } else {
        expect(loadedHauler?.cargo).toBe(1);
        expect(['hauling_to_storage', 'hauling_unloading', 'unloading']).toContain(loadedHauler?.visualState);
      }
      expect(preview.world.storages).toHaveLength(2);
      expect(preview.world.buildings?.filter((building) => building.buildingId === 'cabin' || building.buildingId === 'workshop'))
        .toHaveLength(scenario === 'g5-logistics-blocked' ? 3 : 2);
    } else {
      expect(preview.world.actors?.length, `scenario ${scenario} actors`).toBeGreaterThanOrEqual(2);
    }
    expect(preview.world.buildings, `scenario ${scenario} buildings`).toBeDefined();
    expect(preview.world.resourceTotals, `scenario ${scenario} resources`).toBeDefined();
    if (scenario === 'g4-multi-storage') {
      await expect(page.locator('#world-scene')).toHaveAttribute('data-storage-visual-count', '2');
      await page.locator('#pairing-panel summary').click();
      const storagePoints = await page.locator('#world-scene').evaluate((element) => {
        const root = element as HTMLElement;
        return [0, 1].map((index) => ({
          x: Number(root.dataset[`storage${index}CanvasX`]),
          y: Number(root.dataset[`storage${index}CanvasY`])
        }));
      });
      for (const [index, storage] of storagePoints.entries()) {
        expect(Number.isFinite(storage.x) && Number.isFinite(storage.y)).toBe(true);
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
