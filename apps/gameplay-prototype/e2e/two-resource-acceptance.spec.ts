import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { LAND_GRID_CELLS, LAND_GRID_CONFIG, LAND_SURFACE_CELLS, footprintCenterX } from '../src/land-grid.js';
import {
  createNewWorld, mineStockpileSourceId, PROTOTYPE_CONFIG, STORAGE_KEY, WORLD, type PrototypeWorld, type WorkRole
} from '../src/simulation.js';

const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://127.0.0.1:4176';
const evidence = resolve(process.env.PLAYWRIGHT_EVIDENCE_DIR ??
  'docs/gameplay-prototype-v0.1/evidence-two-resource-economy');
const HOUSE_X = footprintCenterX({ column: 2, row: LAND_GRID_CONFIG.surfaceCellRow }, { widthCells: 1, heightCells: 1 });
const WAREHOUSE_X = footprintCenterX({ column: 4, row: LAND_GRID_CONFIG.surfaceCellRow }, { widthCells: 1, heightCells: 1 });
const SAWMILL_X = footprintCenterX({ column: 0, row: LAND_GRID_CONFIG.surfaceCellRow }, { widthCells: 2, heightCells: 1 });
const ORE_X = LAND_SURFACE_CELLS.find((cell) => cell.resource === 'ore-main')!.centerX;
const MINE_X = LAND_SURFACE_CELLS.find((cell) => cell.column === 5)!.centerX;
const MOBILE_MINE_X = LAND_SURFACE_CELLS.find((cell) => cell.column === 7)!.centerX;

async function readWorld(page: Page): Promise<PrototypeWorld> {
  return page.evaluate((key) => JSON.parse(localStorage.getItem(key)!) as PrototypeWorld, STORAGE_KEY);
}

async function capture(page: Page, folder: string, name: string): Promise<void> {
  const directory = resolve(evidence, folder);
  mkdirSync(directory, { recursive: true });
  await page.screenshot({ path: resolve(directory, `${name}.png`), animations: 'disabled' });
}

async function assignRole(page: Page, index: number, role: WorkRole): Promise<void> {
  await page.locator('#dock-residents').click();
  const resident = page.locator('.resident-row').nth(index);
  await expect(resident).toBeVisible();
  await resident.evaluate((element) => (element as HTMLButtonElement).click());
  await page.locator('#toggle-roles').click();
  await page.locator(`[data-role="${role}"]`).click();
  await expect(page.locator(`.role-button[data-role="${role}"]`)).toHaveClass(/active/);
  await page.locator('#close-panel').click();
}

async function swipe(page: Page, from: { x: number; y: number }, to: { x: number; y: number }): Promise<void> {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ id: 1, ...from }] });
  for (let step = 1; step <= 8; step += 1) {
    const progress = step / 8;
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{
      id: 1, x: from.x + (to.x - from.x) * progress, y: from.y + (to.y - from.y) * progress
    }] });
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await cdp.detach();
}

async function panTo(page: Page, worldX: number): Promise<void> {
  const canvas = page.locator('#world-scene canvas');
  for (let attempt = 0; attempt < 14; attempt += 1) {
    const view = JSON.parse((await canvas.getAttribute('data-world-view'))!) as { x: number; width: number };
    if (worldX > view.x + 170 && worldX < view.x + view.width - 170) return;
    const bounds = (await canvas.boundingBox())!;
    const delta = (worldX - view.x - view.width / 2) * bounds.width / view.width;
    const distance = Math.max(-bounds.width * 0.55, Math.min(bounds.width * 0.55, delta));
    const startX = bounds.x + (distance > 0 ? bounds.width * 0.8 : bounds.width * 0.2);
    await swipe(page, { x: startX, y: bounds.y + bounds.height * 0.48 }, {
      x: startX - distance, y: bounds.y + bounds.height * 0.48
    });
  }
  const view = JSON.parse((await canvas.getAttribute('data-world-view'))!) as { x: number; width: number };
  expect(worldX).toBeGreaterThan(view.x - 170);
  expect(worldX).toBeLessThan(view.x + view.width + 170);
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
  for (let elapsed = 0; elapsed < maxSeconds; elapsed += stepSeconds) {
    const world = await readWorld(page);
    if (predicate(world)) return world;
    await advanceSettlement(page, Math.min(stepSeconds, maxSeconds - elapsed));
  }
  const world = await readWorld(page);
  if (predicate(world)) return world;
  throw new Error(`${description} did not complete. State: ${JSON.stringify({
    oreSource: world.oreSource,
    residents: world.residents.map(({ id, role, mode, cargo, cargoAmount, blockedReason }) =>
      ({ id, role, mode, cargo, cargoAmount, blockedReason })),
    stores: world.stores,
    sites: world.sites,
    buildings: world.buildings.map(({ kind }) => kind)
  })}`);
}

async function placeBuilding(page: Page, kind: 'warehouse' | 'mine' | 'sawmill', x: number): Promise<void> {
  await page.locator('#dock-build').click();
  await page.locator(kind === 'warehouse' ? '#build-warehouse' : kind === 'mine' ? '#build-mine' : '#build-sawmill').click();
  await tapWorld(page, x);
  const label = kind === 'warehouse' ? 'склад' : kind === 'mine' ? 'шахта' : 'лесопилка';
  await expect(page.locator('#selection-title')).toHaveText(`Предпросмотр: ${label}`);
  await expect(page.locator('#confirm-placement')).toBeEnabled();
  await page.locator('#confirm-placement').click();
  await expect(page.locator('#placement-banner')).toBeHidden();
}

function mobileFixture(): PrototypeWorld {
  const world = createNewWorld();
  world.stores[0]!.wood = 60;
  world.stores[0]!.ore = 60;
  world.stores.push({ id: 'store-2', buildingId: 'mobile-warehouse', x: WAREHOUSE_X,
    wood: 60, ore: 0, capacity: PROTOTYPE_CONFIG.warehouseCapacity });
  world.buildings.push(
    { id: 'mobile-house', kind: 'house', x: HOUSE_X, y: WORLD.groundY,
      gridColumn: 2, gridRow: LAND_GRID_CONFIG.surfaceCellRow,
      footprint: { widthCells: 1, heightCells: 1 }, level: 1 },
    { id: 'mobile-warehouse', kind: 'warehouse', x: WAREHOUSE_X, y: WORLD.groundY,
      gridColumn: 4, gridRow: LAND_GRID_CONFIG.surfaceCellRow,
      footprint: { widthCells: 1, heightCells: 1 } }
  );
  world.occupiedPlots.push(1, 2);
  return world;
}

test('the mobile HUD shows the same combined 120-unit capacity for both approved resource mixes', async ({ browser }) => {
  const examples = [
    { wood: 60, ore: 60, name: '60-wood-60-ore' },
    { wood: 100, ore: 20, name: '100-wood-20-ore' }
  ] as const;
  for (const example of examples) {
    const context = await browser.newContext({ baseURL, viewport: { width: 390, height: 844 }, hasTouch: true });
    const page = await context.newPage();
    const world = createNewWorld();
    world.stores[0]!.wood = example.wood;
    world.stores[0]!.ore = example.ore;
    await page.addInitScript(({ key, saved }) => localStorage.setItem(key, JSON.stringify(saved)),
      { key: STORAGE_KEY, saved: world });
    await page.goto('/');
    await expect(page.locator('#world-scene canvas')).toBeVisible();
    await expect(page.locator('#capacity-total')).toHaveText('120 / 120');
    await capture(page, 'mobile', `warehouse-${example.name}-390x844`);
    await context.close();
  }
});

test('390x844 touch UI supports roles, planting, resource cards, sawmill, mine and visible upgrade reasons', async ({ browser }) => {
  test.setTimeout(8 * 60_000);
  const context = await browser.newContext({ baseURL, viewport: { width: 390, height: 844 }, hasTouch: true });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const world = mobileFixture();
  await page.addInitScript(({ key, saved }) => localStorage.setItem(key, JSON.stringify(saved)),
    { key: STORAGE_KEY, saved: world });
  try {
    await page.goto('/');
    await expect(page.locator('#world-scene canvas')).toBeVisible();
    await expect(page.locator('#capacity-total')).toHaveText('180 / 240');
    await capture(page, 'mobile', 'mobile-two-resource-start-390x844');

    const canvas = page.locator('#world-scene canvas');
    const beforeView = JSON.parse((await canvas.getAttribute('data-world-view'))!) as { x: number };
    const bounds = (await canvas.boundingBox())!;
    await swipe(page, { x: bounds.x + bounds.width * 0.78, y: bounds.y + bounds.height * 0.58 },
      { x: bounds.x + bounds.width * 0.3, y: bounds.y + bounds.height * 0.58 });
    await expect.poll(async () => Number(JSON.parse((await canvas.getAttribute('data-world-view'))!).x))
      .not.toBe(beforeView.x);

    await assignRole(page, 0, 'woodcutter');
    expect((await readWorld(page)).residents[0]!.role).toBe('woodcutter');

    const orePile = (await readWorld(page)).stockpiles.find((pile) => pile.sourceId === 'ore')!;
    expect(orePile.capacity).toBe(10);
    await tapWorld(page, ORE_X, WORLD.groundY - 80);
    await expect(page.locator('#selection-detail')).toContainText('Конечная природная залежь 180');
    await expect(page.locator('#selection-detail')).toContainText('её куча 0/10');
    await capture(page, 'mobile', 'mobile-finite-ore-card-and-pile-10-390x844');

    const plantingCell = LAND_GRID_CELLS.find((cell) => cell.environment === 'surface' &&
      cell.role === 'building' && cell.column === 5)!;
    await page.locator('#grid-button').click();
    await tapWorld(page, plantingCell.centerX, plantingCell.centerY);
    const plantButton = page.locator('[data-testid="plant-tree"]');
    await expect(plantButton).toBeVisible();
    await expect(plantButton).toBeEnabled();
    await plantButton.click();
    await expect.poll(async () => (await readWorld(page)).trees.some((tree) =>
      tree.planted && tree.cellId === plantingCell.id)).toBe(true);
    await capture(page, 'mobile', 'mobile-tree-planted-390x844');

    await placeBuilding(page, 'sawmill', SAWMILL_X);
    await expect.poll(async () => (await readWorld(page)).sites.some((site) => site.kind === 'sawmill')).toBe(true);
    await placeBuilding(page, 'mine', MOBILE_MINE_X);
    await expect.poll(async () => (await readWorld(page)).sites.some((site) => site.kind === 'mine')).toBe(true);

    await assignRole(page, 0, 'idle');
    await assignRole(page, 2, 'builder');
    const completed = await advanceUntil(page, (state) =>
      state.buildings.some((building) => building.kind === 'sawmill') &&
      state.buildings.some((building) => building.kind === 'mine'), 1200, 'completing both mobile building placements', 20);
    expect(completed.stockpiles.find((pile) => pile.treeId === 'tree-home')?.capacity).toBe(50);
    const mobileMine = completed.buildings.find((building) => building.kind === 'mine')!;
    expect(completed.stockpiles.find((pile) => pile.sourceId === 'ore')?.capacity).toBe(10);
    expect(completed.stockpiles.find((pile) => pile.sourceId === mineStockpileSourceId(mobileMine.id))?.capacity).toBe(50);

    await tapWorld(page, HOUSE_X, WORLD.groundY - 150);
    await expect(page.locator('#selection-title')).toHaveText('Дом');
    const cardUpgrade = page.locator('[data-testid="upgrade-house"]');
    await expect(cardUpgrade).toBeVisible();
    await expect(cardUpgrade).toBeDisabled();
    await expect(page.locator('#world-actions')).toContainText('Не хватает на складах:');
    await capture(page, 'mobile', 'mobile-house-upgrade-card-blocked-390x844');

    await page.locator('#close-panel').click();
    await page.locator('#dock-build').click();
    const listUpgrade = page.locator('[data-testid="upgrade-house-list-mobile-house"]');
    await expect(listUpgrade).toBeVisible();
    await expect(listUpgrade).toBeDisabled();
    const listReason = page.locator('#building-list .house-upgrade-status');
    await expect(listReason).toContainText('Не хватает на складах:');
    await listUpgrade.scrollIntoViewIfNeeded();
    await expect(listUpgrade).toBeInViewport();
    await expect(listReason).toBeInViewport();
    await capture(page, 'mobile', 'mobile-house-upgrade-list-blocked-390x844');
    await page.locator('#close-panel').click();

    await tapWorld(page, MOBILE_MINE_X, WORLD.groundY - 80);
    await expect(page.locator('#selection-detail')).toContainText('Независимый бесконечный источник породы');
    await expect(page.locator('#selection-detail')).toContainText('своя местная куча 0/50');
    await capture(page, 'mobile', 'mobile-mine-infinite-pile-50-390x844');
    expect(errors).toEqual([]);
  } finally {
    await context.close();
  }
});

test('fresh UI exhausts finite ore, shows the vanished outcrop, then mines indefinitely', async ({ page }) => {
  test.setTimeout(8 * 60_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  const canvas = page.locator('#world-scene canvas');
  await expect(canvas).toBeVisible();
  await expect(page.locator('#people-total')).toHaveText('3 / 3');
  const initial = await readWorld(page);
  expect(initial.oreSource).toBe(PROTOTYPE_CONFIG.ore.initialDeposit);
  expect(initial.stockpiles.find((pile) => pile.sourceId === 'ore')?.capacity).toBe(10);
  expect(JSON.parse((await canvas.getAttribute('data-ore-source'))!)).toMatchObject({
    mode: 'finite', remaining: PROTOTYPE_CONFIG.ore.initialDeposit, outcropVisible: true
  });
  await panTo(page, ORE_X);
  await capture(page, 'ore-lifecycle', '01-fresh-finite-ore-source-and-pile-10');

  await assignRole(page, 0, 'woodcutter');
  await assignRole(page, 1, 'miner');
  await assignRole(page, 2, 'hauler');
  let carryingScreenshot = false;
  for (let elapsed = 0; elapsed < 90; elapsed += 1) {
    const state = await readWorld(page);
    const carrier = state.residents.find((resident) => resident.cargo === 'ore' && resident.mode === 'carrying');
    if (carrier) {
      await panTo(page, carrier.x);
      await capture(page, 'ore-lifecycle', '02-resident-physically-carries-ore');
      carryingScreenshot = true;
      break;
    }
    await advanceSettlement(page, 1);
  }
  expect(carryingScreenshot, 'a resident should visibly carry mined ore before delivery').toBe(true);
  const harvested = await advanceUntil(page, (state) => state.oreSource < initial.oreSource &&
    state.stores.reduce((sum, store) => sum + store.ore, 0) > initial.stores[0]!.ore,
  120, 'mining and delivering finite ore', 5);
  expect(harvested.oreSource).toBeLessThan(initial.oreSource);

  await advanceUntil(page, (state) => state.stores.some((store) => store.wood >= 50 && store.ore >= 40),
    600, 'gathering the cost for a second warehouse', 10);
  await assignRole(page, 2, 'builder');
  await placeBuilding(page, 'warehouse', WAREHOUSE_X);
  await assignRole(page, 0, 'idle');
  const warehouse = await advanceUntil(page, (state) => state.stores.length === 2 &&
    state.buildings.filter((building) => building.kind === 'warehouse').length === 2,
  600, 'building additional storage before depleting the finite deposit', 10);
  expect(warehouse.stores.reduce((sum, store) => sum + store.capacity, 0)).toBe(240);

  const depleted = await advanceUntil(page, (state) => state.oreSource === 0, 600,
    'depleting all remaining finite ore', 5);
  expect(depleted.oreSource).toBe(0);
  await expect.poll(async () => JSON.parse((await canvas.getAttribute('data-ore-source'))!))
    .toMatchObject({ mode: 'depleted', remaining: 0, outcropVisible: false, label: 'Залежь истощена' });
  await panTo(page, ORE_X);
  await capture(page, 'ore-lifecycle', '03-finite-ore-depleted-outcrop-vanished');

  await assignRole(page, 0, 'woodcutter');
  await advanceUntil(page, (state) => state.stores.reduce((sum, store) => sum + store.wood, 0) >= 60,
    900, 'gathering wood for the mine', 10);
  await placeBuilding(page, 'mine', MINE_X);
  const mineSite = await advanceUntil(page, (state) => state.sites.some((site) => site.kind === 'mine'),
    3, 'placing the mine at the exhausted deposit', 1);
  expect(mineSite.sites.find((site) => site.kind === 'mine')).toBeDefined();
  await assignRole(page, 0, 'idle');
  const mineComplete = await advanceUntil(page, (state) => state.buildings.some((building) => building.kind === 'mine'),
    600, 'completing the mine', 10);
  const mine = mineComplete.buildings.find((building) => building.kind === 'mine')!;
  expect(mineComplete.stockpiles.find((pile) => pile.sourceId === 'ore')?.capacity).toBe(10);
  expect(mineComplete.stockpiles.find((pile) => pile.sourceId === mineStockpileSourceId(mine.id))?.capacity).toBe(50);
  await expect.poll(async () => JSON.parse((await canvas.getAttribute('data-ore-source'))!))
    .toMatchObject({ mode: 'depleted', remaining: 0, outcropVisible: false });

  await assignRole(page, 1, 'idle');
  await assignRole(page, 2, 'hauler');
  // Keep any final finite-deposit ore in the baseline. Once its miner is idle,
  // its source-bound pickup request can be cancelled by the existing routing
  // rules, so requiring a generic hauler to clear that pile would be unrelated
  // to proving that the completed mine produces additional ore.
  const beforeInfiniteOutput = await readWorld(page);
  const beforeOre = beforeInfiniteOutput.stores.reduce((sum, store) => sum + store.ore, 0) +
    beforeInfiniteOutput.stockpiles.filter((pile) => pile.resource === 'ore').reduce((sum, pile) => sum + pile.amount, 0) +
    beforeInfiniteOutput.residents.filter((resident) => resident.cargo === 'ore').reduce((sum, resident) => sum + resident.cargoAmount, 0);
  await assignRole(page, 1, 'miner');
  const afterInfiniteOutput = await advanceUntil(page, (state) => {
    const carried = state.residents.filter((resident) => resident.cargo === 'ore')
      .reduce((sum, resident) => sum + resident.cargoAmount, 0);
    const visible = state.stores.reduce((sum, store) => sum + store.ore, 0) +
      state.stockpiles.filter((pile) => pile.resource === 'ore').reduce((sum, pile) => sum + pile.amount, 0) + carried;
    return state.oreSource === 0 && visible > beforeOre;
  }, 120, 'producing ore indefinitely from the completed mine', 5);
  expect(afterInfiniteOutput.oreSource).toBe(0);
  expect(afterInfiniteOutput.stockpiles.find((pile) => pile.sourceId === 'ore')?.capacity).toBe(10);
  expect(afterInfiniteOutput.stockpiles.find((pile) => pile.sourceId === mineStockpileSourceId(mine.id))?.capacity).toBe(50);
  await panTo(page, mine.x);
  await capture(page, 'ore-lifecycle', '04-mine-infinite-ore-and-pile-50');
  expect(errors).toEqual([]);
});
