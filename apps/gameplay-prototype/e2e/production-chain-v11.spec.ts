import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { LAND_GRID_CONFIG, footprintCenterX } from '../src/land-grid.js';
import { STORAGE_KEY, WORLD, type PrototypeWorld, type WorkRole } from '../src/simulation.js';

const evidence = resolve(process.env.PLAYWRIGHT_EVIDENCE_DIR ??
  'docs/gameplay-prototype-v0.1/evidence-production-2026-11-22', 'production-chain');
const HOUSE_X = footprintCenterX({ column: 1, row: LAND_GRID_CONFIG.surfaceCellRow },
  { widthCells: 1, heightCells: 1 });
const SAWMILL_X = footprintCenterX({ column: 4, row: LAND_GRID_CONFIG.surfaceCellRow },
  { widthCells: 2, heightCells: 1 });

async function readWorld(page: Page): Promise<PrototypeWorld> {
  return page.evaluate((key) => JSON.parse(localStorage.getItem(key)!) as PrototypeWorld, STORAGE_KEY);
}

async function capture(page: Page, name: string): Promise<void> {
  mkdirSync(evidence, { recursive: true });
  await page.screenshot({ path: resolve(evidence, `${name}.png`), animations: 'disabled' });
}

async function assignRole(page: Page, index: number, role: WorkRole): Promise<void> {
  await page.locator('#dock-residents').click();
  await expect.poll(async () => page.locator('.resident-row').count()).toBeGreaterThan(index);
  await page.locator('.resident-row').nth(index).click();
  await page.locator('#toggle-roles').click();
  await page.locator(`[data-role="${role}"]`).click();
  await expect(page.locator(`.role-button[data-role="${role}"]`)).toHaveClass(/active/);
  await page.locator('#close-panel').click();
}

async function panTo(page: Page, targetX: number): Promise<void> {
  const canvas = page.locator('#world-scene canvas');
  for (let attempt = 0; attempt < 14; attempt += 1) {
    const view = JSON.parse((await canvas.getAttribute('data-world-view'))!) as { x: number; width: number };
    if (targetX > view.x + 170 && targetX < view.x + view.width - 170) return;
    const box = (await canvas.boundingBox())!;
    const delta = (targetX - view.x - view.width / 2) * box.width / view.width;
    const distance = Math.max(-box.width * 0.55, Math.min(box.width * 0.55, delta));
    const startX = box.x + (distance > 0 ? box.width * 0.8 : box.width * 0.2);
    const endX = startX - distance;
    const y = box.y + box.height * 0.35;
    await page.mouse.move(startX, y);
    await page.mouse.down();
    await page.mouse.move(endX, y, { steps: 12 });
    await page.mouse.up();
  }
  const view = JSON.parse((await canvas.getAttribute('data-world-view'))!) as { x: number; width: number };
  expect(targetX, 'target should be reachable by the scene camera').toBeGreaterThan(view.x - 170);
  expect(targetX).toBeLessThan(view.x + view.width + 170);
}

async function tapWorld(page: Page, worldX: number, worldY = WORLD.groundY): Promise<void> {
  await panTo(page, worldX);
  const canvas = page.locator('#world-scene canvas');
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

async function placeBuilding(page: Page, kind: 'house' | 'sawmill', x: number): Promise<void> {
  await page.locator('#dock-build').click();
  await page.locator(kind === 'house' ? '#build-house' : '#build-sawmill').click();
  await tapWorld(page, x);
  await expect(page.locator('#selection-title')).toHaveText(`Предпросмотр: ${kind === 'house' ? 'дом' : 'лесопилка'}`);
  await expect(page.locator('#confirm-placement')).toBeEnabled();
  await page.locator('#confirm-placement').click();
  await expect(page.locator('#placement-banner')).toBeHidden();
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
  const finalWorld = await readWorld(page);
  throw new Error(`${description} did not complete in ${maxSeconds} virtual seconds. State: ${JSON.stringify({
    residents: finalWorld.residents.map(({ id, role, mode, task, cargo, cargoAmount }) =>
      ({ id, role, mode, task, cargo, cargoAmount })),
    stores: finalWorld.stores,
    sites: finalWorld.sites,
    buildings: finalWorld.buildings
  }, null, 2)}`);
}

test('fresh settlement UI builds a house, constructs a 2x1 sawmill, delivers boards, and upgrades the house', async ({ page }) => {
  test.setTimeout(8 * 60_000);
  const errors: string[] = [];
  const failedAssets: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('response', (response) => {
    if (response.url().includes('/assets/') && response.status() !== 200 && response.status() !== 304) {
      failedAssets.push(`${response.status()} ${response.url()}`);
    }
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  await expect(page.locator('#world-scene canvas')).toBeVisible();
  await page.waitForTimeout(250);
  await expect(page.locator('#catchup-status')).toBeHidden();
  await expect(page.locator('#people-total')).toHaveText('3 / 3');
  await capture(page, '01-fresh-settlement');

  await assignRole(page, 0, 'woodcutter');
  await assignRole(page, 1, 'miner');
  await assignRole(page, 2, 'hauler');
  const houseResources = await advanceUntil(page, (world) => {
    const store = world.stores[0];
    return Boolean(store && store.wood >= 60 && store.stone >= 50);
  }, 600, 'gathering house materials', 10);
  expect(houseResources.stores[0]).toMatchObject({ wood: expect.any(Number), stone: expect.any(Number) });

  await assignRole(page, 2, 'builder');
  await placeBuilding(page, 'house', HOUSE_X);
  const houseSite = await advanceUntil(page, (world) => world.sites.some((site) => site.kind === 'house'),
    2, 'placing the first house');
  expect(houseSite.sites[0]).toMatchObject({ kind: 'house', gridColumn: 1, footprint: { widthCells: 1, heightCells: 1 } });
  await advanceSettlement(page, 5);
  await capture(page, '02-house-site-and-delivery');
  const firstHouseWorld = await advanceUntil(page, (world) =>
    world.buildings.some((building) => building.kind === 'house' && (building.level ?? 1) === 1) &&
    world.residents.length >= 4, 600, 'completing the first house', 10);
  const firstHouse = firstHouseWorld.buildings.find((building) => building.kind === 'house')!;
  await tapWorld(page, firstHouse.x, WORLD.groundY - 150);
  await expect(page.locator('#selection-title')).toHaveText('Дом');
  await expect(page.locator('#selection-detail')).toContainText('первого уровня');
  await capture(page, '03-first-house-level-one');
  await expect(page.locator('#people-total')).toHaveText('4 / 4');

  await assignRole(page, 3, 'hauler');
  const sawmillResources = await advanceUntil(page, (world) => {
    const store = world.stores[0];
    return Boolean(store && store.wood >= 50 && store.stone >= 50);
  }, 600, 'gathering sawmill materials', 10);
  expect(sawmillResources.stores[0]!.wood).toBeGreaterThanOrEqual(50);
  expect(sawmillResources.stores[0]!.stone).toBeGreaterThanOrEqual(50);
  await assignRole(page, 0, 'idle');
  await assignRole(page, 1, 'idle');
  await advanceUntil(page, (world) => world.residents.slice(0, 2).every((person) => !person.cargo),
    30, 'settling gatherer loads', 2);

  await placeBuilding(page, 'sawmill', SAWMILL_X);
  const sawmillSite = await advanceUntil(page, (world) => world.sites.some((site) => site.kind === 'sawmill'),
    2, 'placing the sawmill');
  const sawmillFootprint = sawmillSite.sites.find((site) => site.kind === 'sawmill')!;
  expect(sawmillFootprint).toMatchObject({
    gridColumn: 4,
    footprint: { widthCells: 2, heightCells: 1 }
  });
  await advanceSettlement(page, 5);
  await capture(page, '04-sawmill-construction-and-hauling');
  const completedMillWorld = await advanceUntil(page, (world) =>
    world.buildings.some((building) => building.kind === 'sawmill'), 600, 'completing the sawmill', 10);
  const mill = completedMillWorld.buildings.find((building) => building.kind === 'sawmill')!;
  await assignRole(page, 3, 'sawmiller');
  await assignRole(page, 2, 'hauler');
  await assignRole(page, 0, 'woodcutter');
  await assignRole(page, 1, 'idle');

  const millInputWorld = await advanceUntil(page, (world) => {
    const currentMill = world.buildings.find((building) => building.id === mill.id);
    return Boolean(currentMill && (currentMill.inputWood ?? 0) > 0);
  }, 120, 'physically delivering logs to the sawmill', 2);
  const inputMill = millInputWorld.buildings.find((building) => building.id === mill.id)!;
  expect(inputMill.inputWood).toBeGreaterThan(0);
  await tapWorld(page, mill.x, WORLD.groundY - 150);
  await expect(page.locator('#selection-detail')).toContainText('брёвен');
  await capture(page, '05-logs-delivered-to-sawmill');

  const boardWorld = await advanceUntil(page, (world) =>
    world.stores.reduce((sum, store) => sum + (store.boards ?? 0), 0) >= 12, 900,
    'producing and delivering 12 boards', 2);
  expect(boardWorld.stores.reduce((sum, store) => sum + (store.boards ?? 0), 0)).toBeGreaterThanOrEqual(12);
  expect(boardWorld.stores.reduce((sum, store) => sum + store.stone, 0)).toBeGreaterThanOrEqual(10);
  await tapWorld(page, mill.x, WORLD.groundY - 150);
  await expect(page.locator('#selection-detail')).toContainText('досок');
  await capture(page, '06-boards-delivered-to-warehouse');

  await tapWorld(page, firstHouse.x, WORLD.groundY - 150);
  await assignRole(page, 2, 'builder');
  await tapWorld(page, firstHouse.x, WORLD.groundY - 150);
  await expect(page.locator('[data-testid="upgrade-house"]')).toBeEnabled();
  await page.locator('[data-testid="upgrade-house"]').click();
  const upgradeSite = await advanceUntil(page, (world) =>
    world.sites.some((site) => site.kind === 'house-upgrade'), 2, 'starting the house upgrade');
  expect(upgradeSite.sites.find((site) => site.kind === 'house-upgrade')).toMatchObject({
    kind: 'house-upgrade', upgradeBuildingId: firstHouse.id,
    footprint: { widthCells: 1, heightCells: 1 }
  });
  await advanceSettlement(page, 5);
  await capture(page, '07-house-upgrade-in-progress');
  const upgradedWorld = await advanceUntil(page, (world) =>
    world.buildings.some((building) => building.id === firstHouse.id && building.level === 2) &&
    world.residents.length >= 5, 300, 'completing the house upgrade', 5);
  expect(upgradedWorld.buildings.find((building) => building.id === firstHouse.id)?.level).toBe(2);
  expect(upgradedWorld.residents.length).toBe(5);
  await tapWorld(page, firstHouse.x, WORLD.groundY - 150);
  await expect(page.locator('#selection-detail')).toContainText('второго уровня');
  await expect(page.locator('#people-total')).toHaveText('5 / 5');
  await capture(page, '08-house-level-two-five-residents');
  expect(errors).toEqual([]);
  expect(failedAssets).toEqual([]);
});
