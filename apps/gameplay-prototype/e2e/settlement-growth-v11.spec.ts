import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { LAND_GRID_CONFIG, footprintCenterX } from '../src/land-grid.js';
import { STORAGE_KEY, WORLD, type PrototypeWorld, type WorkRole } from '../src/simulation.js';

const evidence = resolve(process.env.PLAYWRIGHT_EVIDENCE_DIR ??
  'docs/gameplay-prototype-v0.1/evidence-v11-current', 'settlement-growth');
const FIRST_HOUSE_X = footprintCenterX({ column: 2, row: LAND_GRID_CONFIG.surfaceCellRow },
  { widthCells: 1, heightCells: 1 });
const SECOND_HOUSE_X = footprintCenterX({ column: 1, row: LAND_GRID_CONFIG.surfaceCellRow },
  { widthCells: 1, heightCells: 1 });
const SECOND_WAREHOUSE_X = footprintCenterX({ column: 4, row: LAND_GRID_CONFIG.surfaceCellRow },
  { widthCells: 1, heightCells: 1 });

async function readWorld(page: Page): Promise<PrototypeWorld> {
  return page.evaluate((key) => JSON.parse(localStorage.getItem(key)!) as PrototypeWorld, STORAGE_KEY);
}

async function capture(page: Page, name: string): Promise<void> {
  mkdirSync(evidence, { recursive: true });
  await page.screenshot({ path: resolve(evidence, `${name}.png`), animations: 'disabled' });
}

async function assignRole(page: Page, index: number, role: WorkRole): Promise<void> {
  await page.locator('#dock-residents').click();
  const residentRow = page.locator('.resident-row').nth(index);
  await expect(residentRow).toBeVisible();
  await residentRow.evaluate((element) => (element as HTMLButtonElement).click());
  await page.locator('#toggle-roles').click();
  await page.locator(`[data-role="${role}"]`).click();
  await expect(page.locator(`.role-button[data-role="${role}"]`)).toHaveClass(/active/);
  await page.locator('#close-panel').click();
}

async function advanceSettlement(page: Page, seconds: number): Promise<PrototypeWorld> {
  const before = (await readWorld(page)).elapsedSeconds;
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await page.clock.setSystemTime((await page.evaluate(() => Date.now())) + seconds * 1000);
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await expect(page.locator('#catchup-status')).toBeHidden({ timeout: 30_000 });
  const after = await readWorld(page);
  expect(after.elapsedSeconds - before).toBeGreaterThanOrEqual(seconds - 0.2);
  return after;
}

async function advanceUntil(
  page: Page,
  predicate: (world: PrototypeWorld) => boolean,
  maxSeconds: number,
  description: string,
  stepSeconds = 10
): Promise<PrototypeWorld> {
  const chunks = Math.ceil(maxSeconds / stepSeconds);
  for (let chunk = 0; chunk <= chunks; chunk += 1) {
    const current = await readWorld(page);
    if (predicate(current)) return current;
    if (chunk === chunks) break;
    await advanceSettlement(page, Math.min(stepSeconds, maxSeconds - chunk * stepSeconds));
  }
  throw new Error(`${description} did not complete within ${maxSeconds} virtual seconds.`);
}

async function tapWorld(page: Page, worldX: number, worldY = WORLD.groundY): Promise<void> {
  const canvas = page.locator('#world-scene canvas');
  for (let attempt = 0; attempt < 14; attempt += 1) {
    const view = JSON.parse((await canvas.getAttribute('data-world-view'))!) as { x: number; width: number };
    if (worldX > view.x + 170 && worldX < view.x + view.width - 170) break;
    const box = (await canvas.boundingBox())!;
    const delta = (worldX - view.x - view.width / 2) * box.width / view.width;
    const distance = Math.max(-box.width * 0.55, Math.min(box.width * 0.55, delta));
    const startX = box.x + (distance > 0 ? box.width * 0.8 : box.width * 0.2);
    const endX = startX - distance;
    const y = box.y + box.height * 0.35;
    await page.mouse.move(startX, y);
    await page.mouse.down();
    await page.mouse.move(endX, y, { steps: 12 });
    await page.mouse.up();
  }
  const point = await canvas.evaluate((element, position) => {
    const target = element as HTMLCanvasElement;
    const bounds = target.getBoundingClientRect();
    const view = JSON.parse(target.dataset.worldView ?? '{}') as { x: number; y: number; width: number; height: number };
    return {
      x: (position.x - view.x) * bounds.width / view.width,
      y: (position.y - view.y) * bounds.height / view.height
    };
  }, { x: worldX, y: worldY });
  await canvas.click({ position: point });
}

async function placeBuilding(page: Page, kind: 'house' | 'warehouse', x: number): Promise<void> {
  await page.locator('#dock-build').click();
  await page.locator(kind === 'house' ? '#build-house' : '#build-warehouse').click();
  await tapWorld(page, x);
  await expect(page.locator('#selection-title')).toHaveText(`Предпросмотр: ${kind === 'house' ? 'дом' : 'склад'}`);
  await expect(page.locator('#confirm-placement')).toBeEnabled();
  await page.locator('#confirm-placement').click();
  await expect(page.locator('#placement-banner')).toBeHidden();
}

test('first house, second warehouse, second house and fifth resident', async ({ page }) => {
  test.setTimeout(8 * 60_000);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.goto('/');
  await expect(page.locator('#world-scene canvas')).toBeVisible();
  await expect(page.locator('#people-total')).toHaveText('3 / 3');
  await capture(page, '01-fresh-three-residents');

  await assignRole(page, 0, 'woodcutter');
  await assignRole(page, 1, 'miner');
  await assignRole(page, 2, 'hauler');
  await advanceUntil(page, (world) => world.stores.some((store) => store.wood >= 60 && store.ore >= 50),
    600, 'gathering first-house materials');
  await assignRole(page, 2, 'builder');
  await placeBuilding(page, 'house', FIRST_HOUSE_X);
  const firstHouse = await advanceUntil(page, (world) =>
    world.buildings.some((building) => building.kind === 'house') && world.residents.length === 4,
  600, 'completing the first house');
  expect(firstHouse.stores.reduce((sum, store) => sum + store.capacity, 0)).toBe(120);
  await expect(page.locator('#people-total')).toHaveText('4 / 4');
  await capture(page, '02-first-house-four-residents');

  await assignRole(page, 3, 'hauler');
  await advanceUntil(page, (world) => world.stores.reduce((sum, store) => sum + store.wood, 0) >= 50 &&
    world.stores.reduce((sum, store) => sum + store.ore, 0) >= 40,
  600, 'gathering second-warehouse materials');
  await placeBuilding(page, 'warehouse', SECOND_WAREHOUSE_X);
  const secondWarehouse = await advanceUntil(page, (world) => world.stores.length === 2 &&
    world.buildings.filter((building) => building.kind === 'warehouse').length === 2,
  600, 'completing the second warehouse');
  expect(secondWarehouse.stores.reduce((sum, store) => sum + store.capacity, 0)).toBe(240);
  await expect(page.locator('#capacity-total')).toContainText('/ 240');
  await capture(page, '03-second-warehouse-capacity-240');

  await advanceUntil(page, (world) => world.stores.reduce((sum, store) => sum + store.wood, 0) >= 60 &&
    world.stores.reduce((sum, store) => sum + store.ore, 0) >= 50,
  600, 'gathering second-house materials');
  await placeBuilding(page, 'house', SECOND_HOUSE_X);
  const secondHouse = await advanceUntil(page, (world) =>
    world.buildings.filter((building) => building.kind === 'house').length === 2 && world.residents.length === 5,
  600, 'completing the second house');
  expect(secondHouse.stores).toHaveLength(2);
  expect(secondHouse.residents).toHaveLength(5);
  await expect(page.locator('#people-total')).toHaveText('5 / 5');
  await capture(page, '04-second-house-five-residents');

  await page.reload();
  await expect(page.locator('#people-total')).toHaveText('5 / 5');
  const restored = await readWorld(page);
  expect(restored.buildings.filter((building) => building.kind === 'house')).toHaveLength(2);
  expect(restored.stores).toHaveLength(2);
  expect(restored.stores.reduce((sum, store) => sum + store.capacity, 0)).toBe(240);
  expect(restored.residents).toHaveLength(5);
  await capture(page, '05-second-house-restored-after-reload');
  expect(errors).toEqual([]);
});
