import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test, type Browser, type Page } from '@playwright/test';
import { LAND_GRID_CELLS, LAND_GRID_CONFIG, LAND_GRID_EASTERN_CELL_IDS } from '../src/land-grid.js';
import {
  createNewWorld, WORLD, cellBounds, type PrototypeLogisticsRequest, type PrototypeWorld
} from '../src/simulation.js';

const SAVE_KEY = 'avanpost:gameplay-prototype:v01';
const EVIDENCE_DIR = resolve(process.env.PLAYWRIGHT_EVIDENCE_DIR ?? 'apps/gameplay-prototype/test-results/v08-evidence');
const FIRST_EASTERN_CELL = LAND_GRID_CELLS.find((cell) => cell.id === 4)!;
const NEXT_EASTERN_CELL = LAND_GRID_CELLS.find((cell) => cell.id === 5)!;
const CONSTRUCTION_PLOT_X = LAND_GRID_CELLS.find((cell) => cell.id === 2)!.centerX;
const START_WAREHOUSE_X = LAND_GRID_CELLS.find((cell) => cell.id === 8)!.centerX;

function createCellWorld(preparedIds: number[] = []): PrototypeWorld {
  const world = createNewWorld();
  world.buildings.push({ id: 'evidence-home-house', kind: 'house', x: 690, y: WORLD.groundY });
  world.occupiedPlots.push(1);
  for (const id of preparedIds) {
    const cell = world.landCells.find((candidate) => candidate.id === id)!;
    cell.state = 'prepared';
    cell.clearingProgress = 1;
  }
  if (preparedIds.includes(4)) {
    world.buildings.push({ id: 'evidence-east-house', kind: 'house', x: FIRST_EASTERN_CELL.centerX, y: WORLD.groundY });
    world.occupiedPlots.push(4);
  }
  if (preparedIds.includes(5)) {
    world.stores.push({ id: 'store-east-1', x: NEXT_EASTERN_CELL.centerX, wood: 0, stone: 0, capacity: 120 });
    world.occupiedPlots.push(5);
  }
  return world;
}

function setRequest(world: PrototypeWorld, input: Omit<PrototypeLogisticsRequest, 'sequence' | 'createdAt'>): void {
  world.logisticsRequests = [{ ...input, sequence: 1, createdAt: world.elapsedSeconds }];
  world.nextRequestSequence = 2;
}

async function openSavedGame(
  browser: Browser,
  world: PrototypeWorld,
  viewport = { width: 1440, height: 900 }
) {
  const context = await browser.newContext({ viewport, deviceScaleFactor: 1, hasTouch: true });
  const page = await context.newPage();
  const errors: string[] = [];
  const failedAssets: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('response', (response) => {
    if ((response.url().includes('/assets/peace-v2/') || response.url().includes('/assets/gameplay-prototype/')) &&
        response.status() !== 200) failedAssets.push(`${response.status()} ${response.url()}`);
  });
  await page.addInitScript(({ key, save }) => localStorage.setItem(key, JSON.stringify(save)), {
    key: SAVE_KEY, save: world
  });
  await page.goto('/');
  const canvas = page.locator('#world-scene canvas');
  await expect(canvas).toBeVisible();
  await page.waitForFunction(() => {
    const element = document.querySelector<HTMLCanvasElement>('#world-scene canvas');
    return Boolean(element?.dataset.landCells && element.dataset.stockpiles && element.dataset.spriteAspectScale &&
      element.dataset.easternArtGeometry);
  });
  return { context, page, canvas, errors, failedAssets };
}

async function saveScreenshot(page: Page, name: string): Promise<void> {
  mkdirSync(EVIDENCE_DIR, { recursive: true });
  await page.screenshot({ path: resolve(EVIDENCE_DIR, `${name}.png`), animations: 'disabled' });
}

async function panTo(page: Page, targetX: number): Promise<void> {
  const canvas = page.locator('#world-scene canvas');
  const viewport = page.viewportSize()!;
  const cdp = await page.context().newCDPSession(page);
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const state = await canvas.evaluate((element) => ({
      scrollX: Number((element as HTMLCanvasElement).dataset.cameraX),
      zoom: Number((element as HTMLCanvasElement).dataset.cameraZoom)
    }));
    const desiredScrollX = targetX - viewport.width / (2 * state.zoom);
    const delta = desiredScrollX - state.scrollX;
    if (Math.abs(delta) < viewport.width * 0.28 / state.zoom) break;
    const screenDistance = Math.min(Math.abs(delta) * state.zoom, viewport.width * 0.58);
    const direction = Math.sign(delta);
    const startX = viewport.width / 2 + direction * screenDistance / 2;
    const endX = viewport.width / 2 - direction * screenDistance / 2;
    const y = viewport.height * 0.52;
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ id: 1, x: startX, y }] });
    for (let step = 1; step <= 10; step += 1) {
      const ratio = step / 10;
      await cdp.send('Input.dispatchTouchEvent', {
        type: 'touchMove', touchPoints: [{ id: 1, x: startX + (endX - startX) * ratio, y }]
      });
    }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await page.waitForTimeout(80);
  }
  await cdp.detach();
}

async function expectAspectPreserved(page: Page): Promise<Record<string, number>> {
  const state = await page.locator('#world-scene canvas').evaluate((element) => {
    const canvas = element as HTMLCanvasElement;
    return {
      scaleX: Number(canvas.dataset.cameraScaleX),
      scaleY: Number(canvas.dataset.cameraScaleY),
      cssAspect: Number(canvas.dataset.canvasCssAspect),
      bufferAspect: Number(canvas.dataset.canvasBufferAspect),
      spriteScale: JSON.parse(canvas.dataset.spriteAspectScale ?? '{}') as Record<string, number>
    };
  });
  expect(state.scaleX).toBeCloseTo(state.scaleY, 4);
  expect(state.cssAspect).toBeCloseTo(state.bufferAspect, 4);
  expect(Object.keys(state.spriteScale).sort()).toEqual([
    'house', 'resident', 'stone', 'store', 'tree', 'woodStockpile'
  ]);
  for (const [name, ratio] of Object.entries(state.spriteScale)) {
    expect(ratio, `${name} source/display scale`).toBeCloseTo(1, 4);
  }
  return state.spriteScale;
}

async function expectContinuousLandArt(canvas: ReturnType<Page['locator']>): Promise<void> {
  const cells = await canvas.evaluate((element) =>
    JSON.parse((element as HTMLCanvasElement).dataset.easternArtGeometry ?? '[]') as Array<{
      cellId: number;
      left: number;
      right: number;
      treesHeight: number;
      understoryHeight: number;
      groundHeight: number;
    }>
  );
  expect(cells.map((cell) => cell.cellId)).toEqual([...LAND_GRID_EASTERN_CELL_IDS]);
  const buildingCells = cells.filter((cell) => LAND_GRID_EASTERN_CELL_IDS.slice(0, 4).includes(cell.cellId as typeof LAND_GRID_EASTERN_CELL_IDS[number]));
  for (const height of ['treesHeight', 'understoryHeight', 'groundHeight'] as const) {
    const values = buildingCells.map((cell) => cell[height]);
    expect(Math.max(...values) - Math.min(...values), `${height} should share one scale across cells`).toBeLessThan(0.001);
  }
  for (const cell of cells) {
    const bounds = cellBounds(cell.cellId)!;
    expect(cell.left).toBeCloseTo(bounds.left, 4);
    expect(cell.right).toBeCloseTo(bounds.right, 4);
    expect(cell.right - cell.left).toBe(LAND_GRID_CONFIG.cellSize);
    expect(bounds.right - bounds.left).toBe(LAND_GRID_CONFIG.cellSize);
  }
}

test('captures v0.8 land and physical logistics evidence', async ({ browser }) => {
  // This evidence pass opens ten isolated saves and captures each one. Give
  // slower Windows Chromium runs room to finish the final touch-pan capture.
  test.setTimeout(360_000);
  const capture = async (world: PrototypeWorld, targetX: number, name: string, waitForToast = true) => {
    const result = await openSavedGame(browser, world);
    await panTo(result.page, targetX);
    if (waitForToast) await expect(result.page.locator('#toast.visible')).toBeHidden({ timeout: 10_000 });
    if (/^v08-0[1-3]-/.test(name)) await expectContinuousLandArt(result.canvas);
    await saveScreenshot(result.page, name);
    expect(result.errors, `${name}: JavaScript errors`).toEqual([]);
    expect(result.failedAssets, `${name}: asset responses`).toEqual([]);
    await result.context.close();
  };

  const closed = createCellWorld();
  await capture(closed, 3020, 'v08-01-neighboring-closed-cells');

  const onePrepared = createCellWorld([4]);
  await capture(onePrepared, 2600, 'v08-02-one-cleared-cell');

  const sequential = createCellWorld([4, 5]);
  await capture(sequential, 3000, 'v08-03-sequential-cells');

  const workingWood = createNewWorld();
  workingWood.residents[0] = {
    ...workingWood.residents[0]!, role: 'woodcutter', x: 234, mode: 'working',
    task: 'Рубит лес · копит древесину у источника', progress: 0.55
  };
  workingWood.stockpiles[0]!.amount = 5;
  await capture(workingWood, 450, 'v08-04-woodcutter-at-source', false);

  const fullWood = createNewWorld();
  fullWood.residents[0] = { ...fullWood.residents[0]!, role: 'idle', x: 234, task: 'Ожидает' };
  fullWood.residents[1] = {
    ...fullWood.residents[1]!, role: 'idle', x: 800, task: 'Ожидает'
  };
  fullWood.stockpiles[0]!.amount = 10;
  await capture(fullWood, 450, 'v08-05-full-wood-stockpile');

  const stonePile = createNewWorld();
  stonePile.residents[2] = { ...stonePile.residents[2]!, role: 'idle', x: 1500, task: 'Ожидает' };
  stonePile.stockpiles[1]!.amount = 7;
  await capture(stonePile, 1740, 'v08-06-mined-stone-pile');

  const collecting = structuredClone(fullWood);
  collecting.residents[0] = {
    ...collecting.residents[0]!, role: 'woodcutter', x: 234, mode: 'working', task: 'Куча заполнена · ждёт вывоза'
  };
  collecting.residents[1] = {
    ...collecting.residents[1]!, role: 'hauler', x: 650, mode: 'moving', targetX: 420, targetY: WORLD.groundY,
    pickupStockpileId: 'pile-wood-home', pickupResource: 'wood', pickupAmount: 10,
    cargo: null, cargoAmount: 0, task: 'Забирает 10 ед. у леса'
  };
  setRequest(collecting, {
    id: 'evidence-pickup-wood', initiatorId: 'r1', type: 'PICKUP_RESOURCE', resource: 'wood', amount: 10,
    pickupStockpileId: 'pile-wood-home', pickupStoreId: null, destinationStoreId: 'store-1', destinationSiteId: null,
    status: 'assigned', assignedHaulerId: 'r2'
  });
  collecting.residents[1]!.logisticsRequestId = 'evidence-pickup-wood';
  await capture(collecting, 450, 'v08-07-hauler-collecting-resources', false);

  const carryingToStore = createNewWorld();
  carryingToStore.residents[1] = {
    ...carryingToStore.residents[1]!, role: 'hauler', x: 735, mode: 'carrying', cargo: 'wood', cargoAmount: 10,
    targetStoreId: 'store-1', targetX: START_WAREHOUSE_X, targetY: WORLD.groundY, task: 'Несёт 10 ед. древесины на склад'
  };
  setRequest(carryingToStore, {
    id: 'evidence-haul-wood', initiatorId: 'r1', type: 'PICKUP_RESOURCE', resource: 'wood', amount: 10,
    pickupStockpileId: 'pile-wood-home', pickupStoreId: null, destinationStoreId: 'store-1', destinationSiteId: null,
    status: 'in_progress', assignedHaulerId: 'r2'
  });
  carryingToStore.residents[1]!.logisticsRequestId = 'evidence-haul-wood';
  await capture(carryingToStore, 850, 'v08-08-hauler-carries-to-warehouse', false);

  const construction = createNewWorld();
  construction.sites.push({
    id: 'evidence-building-site', kind: 'house', x: CONSTRUCTION_PLOT_X, y: WORLD.groundY,
    deliveredWood: 0, deliveredStone: 1, progress: 0, stage: 0
  });
  construction.residents[1] = {
    ...construction.residents[1]!, role: 'hauler', x: 1010, mode: 'carrying', cargo: 'wood', cargoAmount: 6,
    targetSiteId: 'evidence-building-site', targetStoreId: null, targetX: CONSTRUCTION_PLOT_X, targetY: WORLD.groundY,
    task: 'Несёт 6 ед. дерева на стройку'
  };
  setRequest(construction, {
    id: 'evidence-construction-delivery', initiatorId: 'r1', type: 'DELIVER_TO_CONSTRUCTION', resource: 'wood', amount: 6,
    pickupStockpileId: null, pickupStoreId: 'store-1', destinationStoreId: null,
    destinationSiteId: 'evidence-building-site', status: 'in_progress', assignedHaulerId: 'r2'
  });
  construction.residents[1]!.logisticsRequestId = 'evidence-construction-delivery';
  await capture(construction, CONSTRUCTION_PLOT_X, 'v08-09-hauler-delivers-to-construction', false);

  const returnsToWork = createNewWorld();
  returnsToWork.buildings.push({ id: 'evidence-completed-house', kind: 'house', x: CONSTRUCTION_PLOT_X, y: WORLD.groundY });
  returnsToWork.occupiedPlots.push(2);
  returnsToWork.residents[0] = {
    ...returnsToWork.residents[0]!, role: 'woodcutter', x: 234, mode: 'working', task: 'Продолжает добычу'
  };
  returnsToWork.stockpiles[0]!.amount = 4;
  returnsToWork.residents[1] = {
    ...returnsToWork.residents[1]!, role: 'hauler', x: 950, mode: 'moving', targetX: 420, targetY: WORLD.groundY,
    task: 'После стройки возвращается за ресурсами'
  };
  await capture(returnsToWork, 640, 'v08-10-hauler-returns-to-pickups', false);
});

test('preserves the same house, resident, tree, and sprite proportions across orientation changes', async ({ browser }) => {
  test.setTimeout(90_000);
  const world = createNewWorld();
  world.buildings.push({ id: 'orientation-house', kind: 'house', x: 690, y: WORLD.groundY });
  world.occupiedPlots.push(1);
  world.residents[0] = { ...world.residents[0]!, x: 535 };
  const result = await openSavedGame(browser, world, { width: 390, height: 844 });
  await panTo(result.page, 480);
  await expect(result.page.locator('#toast.visible')).toBeHidden({ timeout: 10_000 });

  const portraitScales = await expectAspectPreserved(result.page);
  await saveScreenshot(result.page, 'v08-11-orientation-portrait');
  const portraitView = await result.canvas.evaluate((element) =>
    JSON.parse((element as HTMLCanvasElement).dataset.worldView ?? '{}') as { x: number; width: number }
  );
  for (const x of [234, 535, 690]) {
    expect(x).toBeGreaterThanOrEqual(portraitView.x);
    expect(x).toBeLessThanOrEqual(portraitView.x + portraitView.width);
  }

  await result.page.setViewportSize({ width: 844, height: 390 });
  await expect.poll(async () => ({
    width: await result.canvas.evaluate((element) => (element as HTMLCanvasElement).width),
    height: await result.canvas.evaluate((element) => (element as HTMLCanvasElement).height)
  })).toEqual({ width: 844, height: 390 });
  await panTo(result.page, 480);
  const landscapeScales = await expectAspectPreserved(result.page);
  expect(landscapeScales).toEqual(portraitScales);
  await saveScreenshot(result.page, 'v08-12-orientation-landscape');

  await result.page.setViewportSize({ width: 390, height: 844 });
  await expect.poll(async () => ({
    width: await result.canvas.evaluate((element) => (element as HTMLCanvasElement).width),
    height: await result.canvas.evaluate((element) => (element as HTMLCanvasElement).height)
  })).toEqual({ width: 390, height: 844 });
  await panTo(result.page, 480);
  const returnedPortraitScales = await expectAspectPreserved(result.page);
  expect(returnedPortraitScales).toEqual(portraitScales);
  await saveScreenshot(result.page, 'v08-13-orientation-portrait-return');
  expect(result.errors).toEqual([]);
  expect(result.failedAssets).toEqual([]);
  await result.context.close();
});

test('lets residents switch logistics modes and shows the assigned hauler request', async ({ browser }) => {
  test.setTimeout(90_000);
  const world = createNewWorld();
  world.woodSource = 0;
  world.stockpiles[0]!.amount = 3;
  world.residents[0] = { ...world.residents[0]!, role: 'woodcutter', x: 234 };
  world.residents[1] = { ...world.residents[1]!, role: 'hauler', x: 3900 };
  const storedWoodBefore = world.stores[0]!.wood;
  const result = await openSavedGame(browser, world, { width: 844, height: 390 });
  const readWorld = () => result.page.evaluate((key) => {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) as PrototypeWorld : null;
  }, SAVE_KEY);
  await expect.poll(async () => {
    const saved = await readWorld();
    return saved?.logisticsRequests.some((request) => request.initiatorId === 'r1' && request.status === 'assigned') ?? false;
  }, { timeout: 15_000 }).toBe(true);

  await result.page.locator('#dock-residents').click();
  await expect(result.page.locator('#resident-list-section')).toBeVisible();
  await result.page.locator('.resident-row').nth(1).click();
  await expect(result.page.locator('#hauler-queue')).toBeVisible();
  await expect(result.page.locator('#hauler-queue')).toContainText('Илья');
  await expect(result.page.locator('#hauler-queue')).toContainText('древесины');
  await result.page.locator('#dock-residents').click();
  await expect(result.page.locator('#resident-list-section')).toBeVisible();
  await result.page.locator('.resident-row').first().click();
  await expect(result.page.locator('#logistics-controls')).toBeVisible();
  await expect(result.page.locator('#logistics-use-hauler')).toHaveClass(/active/);
  await result.page.locator('#logistics-independent').click();
  await expect.poll(async () => {
    const saved = await readWorld();
    return saved?.residents[0]?.logisticsMode === 'independent' &&
      saved.logisticsRequests.some((request) => request.initiatorId === 'r1' && request.status === 'cancelled');
  }).toBe(true);

  await expect.poll(async () => {
    const saved = await readWorld();
    return saved?.residents[0]?.cargo === 'wood' && saved.residents[0].cargoAmount === 3;
  }, { timeout: 20_000 }).toBe(true);
  await result.page.locator('#logistics-use-hauler').click();
  await expect.poll(async () => (await readWorld())?.residents[0]?.logisticsMode).toBe('hauler');
  await expect.poll(async () => {
    const saved = await readWorld();
    return Boolean(saved && saved.residents[0]?.cargo === 'wood' && saved.residents[0].cargoAmount === 3);
  }).toBe(true);

  await expect.poll(async () => {
    const saved = await readWorld();
    return Boolean(saved && saved.residents[0]?.cargo === null && saved.stores[0]!.wood === storedWoodBefore + 3);
  }, { timeout: 20_000 }).toBe(true);
  const settled = await readWorld();
  expect(settled?.logisticsRequests).toHaveLength(1);
  expect(settled?.logisticsRequests[0]).toMatchObject({ status: 'cancelled', assignedHaulerId: null });
  expect(result.errors).toEqual([]);
  expect(result.failedAssets).toEqual([]);
  await result.context.close();
});
