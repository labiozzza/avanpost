import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { test, expect, type Page } from '@playwright/test';
import { createNewWorld, PROTOTYPE_CONFIG, STORAGE_KEY, ECONOMY_VERSION, type PrototypeWorld } from '../src/simulation.js';
import { LAND_GRID_CELLS, LAND_GRID_CONFIG } from '../src/land-grid.js';

async function readWorld(page: Page): Promise<PrototypeWorld> {
  return page.evaluate((key) => JSON.parse(localStorage.getItem(key)!), STORAGE_KEY);
}
async function role(page: Page, index: number, value: string) {
  await page.locator('#dock-residents').click();
  const residentRow = page.locator('.resident-row').nth(index);
  await expect(residentRow).toBeVisible();
  await residentRow.evaluate((element) => (element as HTMLButtonElement).click());
  await page.locator('#toggle-roles').click();
  await page.locator(`[data-role="${value}"]`).click();
  await page.locator('#close-panel').click();
}
async function screenshot(page: Page, name: string) {
  const dir = resolve(process.env.PLAYWRIGHT_EVIDENCE_DIR ?? 'docs/gameplay-prototype-v0.1/evidence-economy', 'economy-deadlock');
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
  const roleSetupStartedAt = Date.now();
  await role(page, 0, 'woodcutter'); await role(page, 1, 'miner'); await role(page, 2, 'hauler');
  const roleSetupMs = Date.now() - roleSetupStartedAt;
  const gatheringStartedAt = Date.now();
  let resourcesReadyAt: number | null = null;
  let lastSampleAt = gatheringStartedAt;
  let missingProfessionMs = 0;
  let firstDeliveryAt: number | null = null;
  let allMaterialsDeliveredAt: number | null = null;
  let builderStartedAt: number | null = null;
  let builderActiveMs = 0;
  const sampleWorld = async (): Promise<PrototypeWorld> => {
    const current = await readWorld(page);
    const now = Date.now();
    const elapsed = now - lastSampleAt;
    const hasWoodcutter = current.residents.some((person) => person.role === 'woodcutter');
    const hasMiner = current.residents.some((person) => person.role === 'miner');
    const hasBuilder = current.residents.some((person) => person.role === 'builder');
    const needsWood = current.trees.some((tree) => tree.state === 'mature');
    const needsOre = current.oreSource > 0;
    const needsBuilder = current.sites.some((site) => !site.paused);
    if (needsWood && !hasWoodcutter || needsOre && !hasMiner || needsBuilder && !hasBuilder) {
      missingProfessionMs += elapsed;
    }
    const site = current.sites.find((candidate) => candidate.kind === 'house');
    if (site && site.deliveredWood + site.deliveredOre > 0 && firstDeliveryAt === null) firstDeliveryAt = now;
    if (site && site.deliveredWood >= 60 && site.deliveredOre >= 50 && allMaterialsDeliveredAt === null) {
      allMaterialsDeliveredAt = now;
    }
    if (site && current.residents[2]?.mode === 'building') {
      builderStartedAt ??= now;
      builderActiveMs += elapsed;
    }
    lastSampleAt = now;
    return current;
  };
  await expect.poll(async () => {
    const current = await sampleWorld();
    const store = current.stores[0]!;
    if (resourcesReadyAt === null && store.wood >= 60 && store.ore >= 50) resourcesReadyAt = Date.now();
    return store.wood + store.ore;
  }, { timeout: 300_000, intervals: [200, 500, 1000] }).toBe(120);
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
  await expect(page.locator('#selection-title')).toHaveText('Предпросмотр: дом');
  await expect(page.locator('#confirm-placement')).toBeEnabled();
  await page.locator('#confirm-placement').click();
  const sitePlacedAt = Date.now();
  await expect.poll(async () => (await sampleWorld()).sites.length).toBe(1);
  await expect.poll(async () => (await sampleWorld()).residents[2]!.mode,
    { timeout: 300_000, intervals: [200, 500, 1000] }).toBe('building');
  const delivered = await sampleWorld();
  expect(delivered.sites[0]!.deliveredWood + delivered.sites[0]!.deliveredOre).toBeGreaterThan(0);
  expect(delivered.sites[0]!.progress).toBeGreaterThan(0);
  await screenshot(page, 'economy-builder-started');
  for (const index of [0, 1]) {
    await page.locator('#dock-residents').click();
    const residentRow = page.locator('.resident-row').nth(index);
    await expect(residentRow).toBeVisible();
    await residentRow.evaluate((element) => (element as HTMLButtonElement).click());
    await page.locator('#logistics-independent').click();
    await page.locator('#close-panel').click();
  }
  await expect.poll(async () => (await sampleWorld()).residents.slice(0, 2).some((person) =>
    person.mode === 'carrying' && person.cargo !== null &&
      (person.targetStoreId !== null || person.targetSiteId !== null)), { timeout: 40_000 }).toBe(true);
  await expect.poll(async () => (await sampleWorld()).residents.length,
    { timeout: 300_000 }).toBe(4);
  const completedAt = Date.now();
  const completed = await readWorld(page);
  expect(completed.sites).toHaveLength(0);
  expect(completed.stores.every((store) => store.wood + store.ore <= store.capacity)).toBe(true);
  expect(completed.logisticsRequests.every((request) => ['completed', 'cancelled'].includes(request.status))).toBe(true);
  await screenshot(page, 'economy-owner-house-complete');
  const timings = {
    resourceAccumulationSeconds: resourcesReadyAt === null ? null : (resourcesReadyAt - gatheringStartedAt) / 1000,
    warehouseFillSeconds: (fullAt - gatheringStartedAt) / 1000,
    roleSetupSeconds: roleSetupMs / 1000,
    interfaceClicksToPlaceHouse: 27,
    interfaceSecondsFromFullWarehouseToHouseSite: (sitePlacedAt - fullAt) / 1000,
    deliveryFirstCargoSeconds: firstDeliveryAt === null ? null : (firstDeliveryAt - sitePlacedAt) / 1000,
    deliveryRemainingMaterialsSeconds: firstDeliveryAt === null || allMaterialsDeliveredAt === null
      ? null : (allMaterialsDeliveredAt - firstDeliveryAt) / 1000,
    builderFirstWorkSeconds: builderStartedAt === null ? null : (builderStartedAt - sitePlacedAt) / 1000,
    builderActiveWallSeconds: builderActiveMs / 1000,
    builderWorkAfterFirstStartSeconds: builderStartedAt === null ? null : (completedAt - builderStartedAt) / 1000,
    fullWarehouseWaitUntilDeliverySeconds: firstDeliveryAt === null ? null : (firstDeliveryAt - fullAt) / 1000,
    missingProfessionSecondsDuringSampledRun: missingProfessionMs / 1000,
    totalFirstHouseSeconds: (completedAt - started) / 1000,
    simulationSeconds: completed.elapsedSeconds
  };
  await info.attach('owner-timings-breakdown', { body: JSON.stringify(timings, null, 2), contentType: 'application/json' });
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
  const legacy = old as unknown as PrototypeWorld & {
    stores: Array<PrototypeWorld['stores'][number] & { stone?: number }>;
    woodSource: number; stoneSource: number;
    easternSector: PrototypeWorld['easternSector'] & { woodStock?: number };
  };
  legacy.stores[0]!.capacity = 12; legacy.stores[0]!.wood = 3; legacy.stores[0]!.stone = 2;
  legacy.woodSource = 32; legacy.stoneSource = 30; legacy.easternSector.woodStock = 12;
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
  expect(await page.evaluate(({ key, version }) => localStorage.getItem(`${key}:before-economy-v${version}`),
    { key: STORAGE_KEY, version: ECONOMY_VERSION })).toBe(raw);
  await page.evaluate(async () => { await navigator.serviceWorker.ready; });
  await page.reload(); await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller));
  expect(totalWood(await readWorld(page))).toBe(150);
  await context.setOffline(true); await page.reload(); await expect(page.locator('canvas')).toBeVisible();
  const saved = await readWorld(page);
  expect(saved.economyVersion).toBe(ECONOMY_VERSION); expect(totalWood(saved)).toBe(150);
  expect(saved.stores[0]!.capacity).toBe(120);
  await screenshot(page, 'economy-migrated-offline');
  await context.setOffline(false);
});

test('shows the complete tree fall, stump, regrowth and planted sapling cycle in Phaser', async ({ browser }) => {
  test.setTimeout(2 * 60_000);
  const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://127.0.0.1:4176';
  const viewport = { width: 1366, height: 768 };
  const beforeContext = await browser.newContext({
    baseURL,
    viewport,
    deviceScaleFactor: 1
  });
  const beforePage = await beforeContext.newPage();
  await beforePage.goto('/');
  await expect(beforePage.locator('#world-scene canvas')).toBeVisible();
  await screenshot(beforePage, 'tree-cycle-01-adult-before-cut');
  await beforeContext.close();

  const context = await browser.newContext({
    baseURL,
    viewport,
    deviceScaleFactor: 1
  });
  const page = await context.newPage();
  const treeFrame = async (id = 'tree-home') => page.locator('#world-scene canvas').evaluate((element, treeId) => {
    const trees = JSON.parse((element as HTMLCanvasElement).dataset.trees ?? '[]') as Array<{
      id: string; state: string; stage: string
    }>;
    return trees.find((tree) => tree.id === treeId) ?? null;
  }, id);

  try {
    const prepared = createNewWorld();
    const tree = prepared.trees.find((candidate) => candidate.id === 'tree-home')!;
    const worker = prepared.residents[0]!;
    tree.cutProgress = PROTOTYPE_CONFIG.trees.cuttingSeconds - 0.15;
    tree.workerId = worker.id;
    worker.role = 'woodcutter';
    worker.mode = 'working';
    worker.x = tree.x;
    worker.targetX = tree.x;
    worker.targetY = 600;
    worker.progress = tree.cutProgress;
    worker.task = 'Рубит дерево';
    const frozenTime = new Date('2026-11-24T00:00:00.000Z');
    await page.clock.install({ time: frozenTime });
    await page.clock.pauseAt(frozenTime);
    await page.addInitScript(({ key, world }) => localStorage.setItem(key, JSON.stringify(world)),
      { key: STORAGE_KEY, world: prepared });
    await page.goto('/');
    await expect(page.locator('#world-scene canvas')).toBeVisible();

    await page.clock.runFor(250);
    await expect.poll(async () => (await treeFrame())?.state).toBe('falling');
    await screenshot(page, 'tree-cycle-02-falling-mid-animation');
    await page.clock.runFor(400);
    await expect.poll(async () => (await treeFrame())?.state).toBe('falling');
    await screenshot(page, 'tree-cycle-03-falling-late-animation');
    await page.clock.runFor(250);
    await expect.poll(async () => (await treeFrame())?.state).toBe('stump');
    await screenshot(page, 'tree-cycle-04-stump');
    await page.clock.runFor(100);
    await expect.poll(async () => (await treeFrame())?.state).toBe('stump');
    await page.clock.runFor(200);
    await expect.poll(async () => (await treeFrame())?.stage).toBe('Саженец');
    await screenshot(page, 'tree-cycle-05-regrowth-sapling');
    await page.clock.runFor(400);
    await expect.poll(async () => (await treeFrame())?.stage).toBe('Молодое дерево');
    await screenshot(page, 'tree-cycle-06-regrowth-young');
    await page.clock.runFor(500);
    await expect.poll(async () => (await treeFrame())?.stage).toBe('Подрастающее дерево');
    await screenshot(page, 'tree-cycle-07-regrowth-growing');
    await page.clock.runFor(800);
    await expect.poll(() => treeFrame()).toMatchObject({ state: 'mature', stage: 'Взрослое дерево' });
    await screenshot(page, 'tree-cycle-08-adult-after-regrowth');

    const plantingCell = LAND_GRID_CELLS.find((cell) => cell.environment === 'surface' &&
      cell.column === 1 && cell.row === LAND_GRID_CONFIG.surfaceCellRow)!;
    await page.locator('#grid-button').click();
    const canvas = page.locator('#world-scene canvas');
    const point = await canvas.evaluate((element, cell) => {
      const target = element as HTMLCanvasElement;
      const bounds = target.getBoundingClientRect();
      const view = JSON.parse(target.dataset.worldView ?? '{}') as { x: number; y: number; width: number; height: number };
      return {
        x: (cell.centerX - view.x) * bounds.width / view.width,
        y: (cell.centerY - view.y) * bounds.height / view.height
      };
    }, plantingCell);
    await canvas.click({ position: point });
    await expect(page.locator('[data-testid="plant-tree"]')).toBeEnabled();
    await page.locator('[data-testid="plant-tree"]').click();
    await page.clock.runFor(50);
    const planted = await page.evaluate(({ key }) => JSON.parse(localStorage.getItem(key)!), { key: STORAGE_KEY }) as PrototypeWorld;
    const plantedTree = planted.trees.find((candidate) => candidate.planted && candidate.cellId === plantingCell.id);
    expect(plantedTree).toMatchObject({ state: 'growing', growthSeconds: expect.any(Number), planted: true });
    await expect.poll(() => treeFrame(plantedTree!.id)).toMatchObject({ state: 'growing', stage: 'Саженец' });
    await screenshot(page, 'tree-cycle-09-player-planted-sapling');
  } finally {
    await context.close();
  }
});
