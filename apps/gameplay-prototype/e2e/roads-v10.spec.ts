import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test, type Page } from '@playwright/test';
import { STORAGE_KEY, type PrototypeWorld } from '../src/simulation.js';

const evidence = resolve(process.env.PLAYWRIGHT_EVIDENCE_DIR ??
  fileURLToPath(new URL('../../../docs/gameplay-prototype-v0.1/evidence-v1.0/', import.meta.url)));

async function capture(page: Page, name: string): Promise<void> {
  mkdirSync(evidence, { recursive: true });
  await page.screenshot({ path: resolve(evidence, `${name}.png`), animations: 'disabled' });
}

async function panTo(page: Page, worldX: number): Promise<void> {
  const canvas = page.locator('#world-scene canvas');
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const view = await canvas.evaluate((element) => JSON.parse(
      (element as HTMLCanvasElement).dataset.worldView ?? '{}'
    ) as { x: number; width: number });
    if (worldX >= view.x + view.width * 0.2 && worldX <= view.x + view.width * 0.8) return;
    const box = await canvas.boundingBox();
    if (!box) throw new Error('Game canvas has no visible bounds.');
    const delta = worldX - (view.x + view.width / 2);
    const screenDistance = Math.min(Math.abs(delta) * box.width / view.width, box.width * 0.56);
    const direction = Math.sign(delta);
    await page.mouse.move(box.width / 2 + direction * screenDistance / 2, box.height * 0.4);
    await page.mouse.down();
    await page.mouse.move(box.width / 2 - direction * screenDistance / 2, box.height * 0.4, { steps: 10 });
    await page.mouse.up();
    await page.waitForTimeout(100);
  }
}

async function tapWorld(page: Page, worldX: number, worldY: number): Promise<void> {
  await panTo(page, worldX);
  const canvas = page.locator('#world-scene canvas');
  const point = await canvas.evaluate((element, coordinates) => {
    const canvasElement = element as HTMLCanvasElement;
    const rect = canvasElement.getBoundingClientRect();
    const view = JSON.parse(canvasElement.dataset.worldView ?? '{}') as {
      x: number; y: number; width: number; height: number;
    };
    return {
      x: (coordinates.x - view.x) * rect.width / view.width,
      y: (coordinates.y - view.y) * rect.height / view.height
    };
  }, { x: worldX, y: worldY });
  await canvas.click({ position: point });
}

async function savedWorld(page: Page): Promise<PrototypeWorld> {
  return page.evaluate((key) => JSON.parse(localStorage.getItem(key)!), STORAGE_KEY);
}

test('v1.0 roads are delivered, built, saved, selectable and removable through the UI', async ({ page }) => {
  test.setTimeout(150_000);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  const canvas = page.locator('#world-scene canvas');
  await expect(canvas).toBeVisible();

  await page.locator('#dock-build').click();
  await page.locator('#build-road').click();
  await expect(page.locator('#placement-banner')).toBeVisible();
  await expect.poll(() => canvas.getAttribute('data-grid-mode')).toBe('planning');
  await tapWorld(page, 3200, 592);
  await expect(page.locator('#selection-title')).toHaveText('Предпросмотр: дорога');
  await expect(page.locator('#selection-detail')).toContainText('закрытом лесу');
  await expect(page.locator('#confirm-placement')).toBeDisabled();
  await capture(page, 'v10-road-blocked-closed-land');

  await page.locator('#cancel-placement').click();
  await page.locator('#dock-build').click();
  await page.locator('#build-road').click();
  await tapWorld(page, 400, 592);
  await expect(page.locator('#selection-title')).toHaveText('Предпросмотр: дорога');
  await expect(page.locator('#selection-detail')).toContainText('10 дерева · 5 камня');
  await expect(page.locator('#confirm-placement')).toBeEnabled();
  expect((await savedWorld(page)).roads).toHaveLength(0);
  await page.locator('#confirm-placement').click();
  await expect.poll(async () => (await savedWorld(page)).sites.some((site) => site.kind === 'road')).toBe(true);
  await capture(page, 'v10-road-construction-order');

  await page.locator('#dock-residents').click();
  await page.getByRole('button', { name: /Саша/ }).click();
  await page.locator('#toggle-roles').click();
  await page.locator('[data-role="builder"]').click();
  await expect.poll(async () => (await savedWorld(page)).sites.find((site) => site.kind === 'road')?.deliveredWood ?? 0)
    .toBeGreaterThan(0);
  await capture(page, 'v10-road-materials-delivered');
  await expect.poll(async () => (await savedWorld(page)).roads.length, { timeout: 90_000 }).toBe(1);
  const firstRoadWorld = await savedWorld(page);
  expect(firstRoadWorld.sites.filter((site) => site.kind === 'road')).toHaveLength(0);
  expect(firstRoadWorld.stores.reduce((sum, store) => sum + store.wood, 0)).toBe(20);
  expect(firstRoadWorld.stores.reduce((sum, store) => sum + store.stone, 0)).toBe(15);
  await page.locator('#close-panel').click();
  await panTo(page, 400);
  await capture(page, 'v10-road-complete');

  await page.locator('#dock-build').click();
  await page.locator('#build-road').click();
  await tapWorld(page, 480, 592);
  await expect(page.locator('#selection-title')).toHaveText('Предпросмотр: дорога');
  await page.locator('#confirm-placement').click();
  await expect.poll(async () => (await savedWorld(page)).sites.some((site) => site.kind === 'road')).toBe(true);
  await expect.poll(async () => (await savedWorld(page)).roads.length, { timeout: 90_000 }).toBe(2);
  const network = await savedWorld(page);
  expect(network.roads.map((road) => road.x)).toEqual([400, 480]);
  await capture(page, 'v10-road-network');

  await page.locator('#cancel-placement').click();
  await tapWorld(page, 400, 592);
  await expect(page.locator('#selection-title')).toHaveText('Дорожный сегмент');
  await page.getByTestId('remove-road').click();
  await expect(page.locator('#road-removal-dialog')).toBeVisible();
  await page.locator('#confirm-road-removal').click();
  await expect.poll(async () => (await savedWorld(page)).roads.length).toBe(1);
  expect((await savedWorld(page)).stockpiles.some((pile) => pile.sourceId === 'road-demolition')).toBe(true);
  await capture(page, 'v10-road-removal-salvage');
  expect(errors).toEqual([]);
});
