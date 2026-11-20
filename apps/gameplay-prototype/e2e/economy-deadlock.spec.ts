import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { test, expect, type Page } from '@playwright/test';
import { createNewWorld, STORAGE_KEY, ECONOMY_VERSION, type PrototypeWorld } from '../src/simulation.js';

async function readWorld(page: Page): Promise<PrototypeWorld> {
  return page.evaluate((key) => JSON.parse(localStorage.getItem(key)!), STORAGE_KEY);
}
async function role(page: Page, index: number, value: string) {
  await page.locator('#dock-residents').click();
  await page.locator('.resident-row').nth(index).click();
  await page.locator('#toggle-roles').click();
  await page.locator(`[data-role="${value}"]`).click();
  await page.locator('#close-panel').click();
}
async function screenshot(page: Page, name: string) {
  const dir = resolve(process.env.PLAYWRIGHT_EVIDENCE_DIR ?? 'docs/gameplay-prototype-v0.1/evidence-economy');
  mkdirSync(dir, { recursive: true });
  await page.screenshot({ path: resolve(dir, `${name}.png`) });
}

test('owner sequence fills the warehouse, reassigns the hauler and completes a house without stale work', async ({ page }, info) => {
  test.setTimeout(12 * 60_000);
  await page.setViewportSize({ width: 1366, height: 768 });
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const started = Date.now();
  await page.goto('/');
  await expect(page.locator('#world-scene canvas')).toBeVisible();
  await screenshot(page, 'economy-start-desktop');
  await role(page, 0, 'woodcutter'); await role(page, 1, 'miner'); await role(page, 2, 'hauler');
  await expect.poll(async () => (await readWorld(page)).stores[0]!.wood +
    (await readWorld(page)).stores[0]!.stone, { timeout: 300_000 }).toBe(120);
  const fullAt = Date.now();
  await screenshot(page, 'economy-full-warehouse');
  await role(page, 2, 'builder');
  await page.locator('#dock-build').click(); await page.locator('#build-house').click();
  const point = await page.locator('canvas').evaluate((element) => {
    const canvas = element as HTMLCanvasElement, rect = canvas.getBoundingClientRect();
    const view = JSON.parse(canvas.dataset.worldView!);
    return { x: (690 - view.x) * rect.width / view.width, y: (572 - view.y) * rect.height / view.height };
  });
  await page.locator('canvas').click({ position: point });
  await expect.poll(async () => (await readWorld(page)).sites.length).toBe(1);
  await expect.poll(async () => (await readWorld(page)).residents[2]!.mode,
    { timeout: 300_000, intervals: [200, 500, 1000] }).toBe('building');
  const delivered = await readWorld(page);
  expect(delivered.sites[0]!.deliveredWood + delivered.sites[0]!.deliveredStone).toBeGreaterThan(0);
  expect(delivered.sites[0]!.progress).toBeGreaterThan(0);
  await screenshot(page, 'economy-builder-started');
  for (const index of [0, 1]) {
    await page.locator('#dock-residents').click();
    await page.locator('.resident-row').nth(index).click();
    await page.locator('#logistics-independent').click();
    await page.locator('#close-panel').click();
  }
  await expect.poll(async () => (await readWorld(page)).residents.slice(0, 2).some((person) =>
    person.mode === 'carrying' && person.cargo !== null &&
      (person.targetStoreId !== null || person.targetSiteId !== null)), { timeout: 40_000 }).toBe(true);
  await expect.poll(async () => (await readWorld(page)).residents.length,
    { timeout: 300_000 }).toBe(4);
  const completed = await readWorld(page);
  expect(completed.sites).toHaveLength(0);
  expect(completed.stores.every((store) => store.wood + store.stone <= store.capacity)).toBe(true);
  expect(completed.logisticsRequests.every((request) => ['completed', 'cancelled'].includes(request.status))).toBe(true);
  await screenshot(page, 'economy-owner-house-complete');
  const timings = { fillSeconds: (fullAt - started) / 1000, firstHouseWallSeconds: (Date.now() - started) / 1000,
    simulationSeconds: completed.elapsedSeconds };
  console.log('OWNER_TIMINGS', JSON.stringify(timings));
  await info.attach('owner-timings', { body: JSON.stringify(timings, null, 2), contentType: 'application/json' });
  await page.reload();
  await expect(page.locator('#people-total')).toHaveText('4 / 4');
  expect((await readWorld(page)).economyVersion).toBe(ECONOMY_VERSION);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('#dock-residents').click();
  await page.locator('.resident-row').first().click();
  await expect(page.locator('#resident-task')).not.toBeEmpty();
  await screenshot(page, 'economy-owner-mobile-diagnosis');
  expect(errors).toEqual([]);
});

test('migrates an old browser save once and retains the original backup through offline reload', async ({ page, context }) => {
  const old = createNewWorld(); delete old.economyVersion;
  old.stores[0]!.capacity = 12; old.stores[0]!.wood = 3; old.stores[0]!.stone = 2;
  old.woodSource = 32; old.stoneSource = 30; old.easternSector.woodStock = 12;
  old.stockpiles[0]!.amount = 8;
  Object.assign(old.residents[0]!, { cargo: 'wood', cargoAmount: 4, mode: 'blocked' });
  const raw = JSON.stringify(old);
  await page.addInitScript(({ key, raw }) => {
    if (!localStorage.getItem(key)) localStorage.setItem(key, raw);
  }, { key: STORAGE_KEY, raw });
  await page.goto('/'); await expect(page.locator('canvas')).toBeVisible();
  const totalWood = (world: PrototypeWorld) => world.stores.reduce((s, p) => s + p.wood, 0) +
    world.stockpiles.filter((p) => p.resource === 'wood').reduce((s, p) => s + p.amount, 0) +
    world.residents.filter((p) => p.cargo === 'wood').reduce((s, p) => s + p.cargoAmount, 0);
  expect(totalWood(await readWorld(page))).toBe(150);
  expect(await page.evaluate((key) => localStorage.getItem(`${key}:before-economy-v2`), STORAGE_KEY)).toBe(raw);
  await page.evaluate(async () => { await navigator.serviceWorker.ready; });
  await page.reload(); await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller));
  expect(totalWood(await readWorld(page))).toBe(150);
  await context.setOffline(true); await page.reload(); await expect(page.locator('canvas')).toBeVisible();
  const saved = await readWorld(page);
  expect(saved.economyVersion).toBe(2); expect(totalWood(saved)).toBe(150);
  expect(saved.stores[0]!.capacity).toBe(120);
  await screenshot(page, 'economy-migrated-offline');
  await context.setOffline(false);
});
