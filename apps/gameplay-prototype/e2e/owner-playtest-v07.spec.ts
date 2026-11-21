import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test, type Browser, type Page } from '@playwright/test';
import { createNewWorld, WORLD, type EasternSectorState, type PrototypeWorld } from '../src/simulation.js';

const SAVE_KEY = 'avanpost:gameplay-prototype:v01';
const SCREENSHOT_DIR = resolve(process.env.PLAYWRIGHT_SCREENSHOT_DIR ?? 'apps/gameplay-prototype/test-results/screenshots');

function sectorWorld(state: EasternSectorState, progress = 0, preparedHouse = false): PrototypeWorld {
  const world = createNewWorld();
  world.buildings.push({ id: 'building-first-house', kind: 'house', x: 690, y: WORLD.groundY });
  world.occupiedPlots.push(1);
  world.nextId = 10;
  const legacyState = state === 'prepared' ? 'closed' : state;
  world.easternSector = {
    ...world.easternSector,
    state: legacyState,
    clearingProgress: state === 'clearing' ? progress : 0,
    clearingPaused: state === 'clearing',
    clearerId: state === 'clearing' ? 'r3' : null,
    woodStock: 120
  };
  for (const cell of world.landCells.filter((candidate) => candidate.id >= 4)) {
    const isFrontier = cell.id === 4;
    cell.state = isFrontier ? state : 'closed';
    cell.clearingProgress = isFrontier
      ? state === 'prepared' ? 1 : state === 'clearing' ? progress : 0
      : 0;
    cell.clearingPaused = isFrontier && state === 'clearing';
    cell.clearerId = isFrontier && state === 'clearing' ? 'r3' : null;
  }
  if (state === 'clearing') {
    world.residents[2] = {
      ...world.residents[2]!, role: 'builder', x: PROTOTYPE_CONFIG_CLEARING_X,
      mode: 'idle', task: 'Расчистка приостановлена', targetX: null, targetY: null
    };
  }
  if (preparedHouse) {
    world.buildings.push({ id: 'building-eastern-house', kind: 'house', x: 2380, y: WORLD.groundY });
    world.occupiedPlots.push(4);
  }
  return world;
}

const PROTOTYPE_CONFIG_CLEARING_X = 2240;

async function openSavedGame(browser: Browser, world: PrototypeWorld, viewport = { width: 1440, height: 900 }) {
  const context = await browser.newContext({ viewport, deviceScaleFactor: 1, hasTouch: true });
  const page = await context.newPage();
  const errors: string[] = [];
  const failedAssets: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('response', (response) => {
    if (response.url().includes('/assets/gameplay-prototype/') && response.status() !== 200) {
      failedAssets.push(`${response.status()} ${response.url()}`);
    }
  });
  await page.addInitScript(({ key, save }) => localStorage.setItem(key, JSON.stringify(save)), {
    key: SAVE_KEY, save: world
  });
  await page.goto('/');
  const canvas = page.locator('#world-scene canvas');
  await expect(canvas).toBeVisible();
  const frontier = world.landCells
    .filter((cell) => cell.id >= 4)
    .sort((a, b) => a.id - b.id)
    .find((cell) => cell.state !== 'prepared');
  const storedFrontierState = frontier?.state ?? 'prepared';
  const frontierState = storedFrontierState === 'closed' &&
      world.buildings.some((building) => building.kind === 'house')
    ? 'unlockable' : storedFrontierState;
  await expect.poll(() => canvas.getAttribute('data-eastern-sector-state')).toBe(frontierState);
  await expect.poll(() => canvas.getAttribute('data-eastern-art-layers')).not.toBeNull();
  return { context, page, canvas, errors, failedAssets };
}

async function saveScreenshot(page: Page, name: string): Promise<void> {
  mkdirSync(SCREENSHOT_DIR, { recursive: true });
  await page.screenshot({ path: resolve(SCREENSHOT_DIR, `${name}.png`), animations: 'disabled' });
}

async function panTo(page: Page, targetX: number): Promise<void> {
  const canvas = page.locator('#world-scene canvas');
  const viewport = page.viewportSize()!;
  const cdp = await page.context().newCDPSession(page);
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const state = await canvas.evaluate((element) => ({
      scrollX: Number((element as HTMLCanvasElement).dataset.cameraX),
      zoom: Number((element as HTMLCanvasElement).dataset.cameraZoom)
    }));
    const desiredScrollX = targetX - viewport.width / (2 * state.zoom);
    const delta = desiredScrollX - state.scrollX;
    if (Math.abs(delta) < viewport.width * 0.3 / state.zoom) break;
    const screenDistance = Math.min(Math.abs(delta) * state.zoom, viewport.width * 0.62);
    const direction = Math.sign(delta);
    const startX = viewport.width / 2 + direction * screenDistance / 2;
    const endX = viewport.width / 2 - direction * screenDistance / 2;
    const y = viewport.height * 0.52;
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchStart', touchPoints: [{ id: 1, x: startX, y }]
    });
    for (let step = 1; step <= 12; step += 1) {
      const ratio = step / 12;
      await cdp.send('Input.dispatchTouchEvent', {
        type: 'touchMove', touchPoints: [{
          id: 1, x: startX + (endX - startX) * ratio, y
        }]
      });
    }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await page.waitForTimeout(120);
  }
  await cdp.detach();
}

async function captureSector(
  browser: Browser,
  state: EasternSectorState,
  progress: number,
  screenshot: string,
  preparedHouse = false
): Promise<void> {
  const result = await openSavedGame(browser, sectorWorld(state, progress, preparedHouse));
  await panTo(result.page, 2500);
  const frontierLayers = state === 'prepared'
    ? { trees: false, understory: false, ground: false }
    : state === 'clearing' && progress >= 0.5
      ? { trees: false, understory: false, ground: true }
      : state === 'clearing' && progress >= 0.25
        ? { trees: true, understory: false, ground: true }
        : { trees: true, understory: true, ground: true };
  const expectedLayers = [4, 5, 6, 7, 10].map((cellId) => ({
    cellId,
    ...(cellId === 4 ? frontierLayers : { trees: true, understory: true, ground: true })
  }));
  await expect(result.canvas).toHaveAttribute('data-eastern-art-layers', JSON.stringify(expectedLayers));
  await saveScreenshot(result.page, screenshot);
  expect(result.errors, `${screenshot}: JavaScript errors`).toEqual([]);
  expect(result.failedAssets, `${screenshot}: gameplay asset responses`).toEqual([]);
  await result.context.close();
}

test('captures the Eastern Edge art stages and checks preserved clearing progress', async ({ browser }) => {
  await captureSector(browser, 'closed', 0, 'v07-01-eastern-closed');
  await captureSector(browser, 'unlocked', 0, 'v07-02-eastern-unlocked');
  await captureSector(browser, 'clearing', 0.04, 'v07-03-eastern-clearing-start');
  await captureSector(browser, 'clearing', 0.25, 'v07-04-eastern-clearing-25');
  await captureSector(browser, 'clearing', 0.5, 'v07-05-eastern-clearing-50');
  await captureSector(browser, 'clearing', 0.75, 'v07-06-eastern-clearing-75');
  await captureSector(browser, 'prepared', 1, 'v07-07-eastern-prepared');
  await captureSector(browser, 'prepared', 1, 'v07-08-eastern-house', true);

  const paused = await openSavedGame(browser, sectorWorld('clearing', 0.25));
  const art = paused.canvas;
  await expect.poll(() => art.getAttribute('data-eastern-clearing-progress')).toBe('0.250');
  await expect.poll(() => art.getAttribute('data-eastern-art-layers')).toBe(
    JSON.stringify([4, 5, 6, 7, 10].map((cellId) => ({
      cellId,
      trees: true,
      understory: cellId !== 4,
      ground: true
    })))
  );
  await panTo(paused.page, 2380);
  const sectorPoint = await paused.page.evaluate(() => {
    const canvas = document.querySelector<HTMLCanvasElement>('#world-scene canvas')!;
    const view = JSON.parse(canvas.dataset.worldView ?? '{}') as { x: number; y: number };
    const zoom = Number(canvas.dataset.cameraZoom);
    const bounds = canvas.getBoundingClientRect();
    return {
      x: bounds.left + (2380 - view.x) * zoom,
      y: bounds.top + (500 - view.y) * zoom
    };
  });
  await paused.page.mouse.click(sectorPoint.x, sectorPoint.y);
  await expect(paused.page.locator('#selection-title')).toHaveText('Земельная клетка 8');
  const progressDetail = paused.page.locator('#selection-detail');
  await expect(progressDetail).toContainText('Прогресс 25%.');
  await paused.page.getByTestId('clear-land-cell').click();
  const readProgress = async () => {
    const match = (await progressDetail.textContent())?.match(/(?:Прогресс|Подготовлено) (\d+)%/);
    return match ? Number(match[1]) / 100 : Number.NaN;
  };
  await expect.poll(readProgress).toBeGreaterThan(0.25);
  const resumedProgress = await readProgress();
  await paused.page.waitForTimeout(650);
  expect(await readProgress()).toBeGreaterThan(resumedProgress);
  expect(paused.errors).toEqual([]);
  expect(paused.failedAssets).toEqual([]);
  await paused.context.close();
});

test('captures multi-warehouse logistics, transit reroute, and responsive orientations', async ({ browser }) => {
  const world = sectorWorld('prepared', 1);
  world.stores = [
    { id: 'store-1', x: 963, wood: 30, stone: 10, capacity: 120 },
    { id: 'store-2', x: 1580, wood: 10, stone: 40, capacity: 120 }
  ];
  world.stoneSource = 19;
  let result = await openSavedGame(browser, world);
  await panTo(result.page, 1600);
  await saveScreenshot(result.page, 'v07-09-two-warehouses-stone-source');
  await result.context.close();

  const inTransit = sectorWorld('prepared', 1);
  inTransit.stores = [
    { id: 'store-1', x: 963, wood: 30, stone: 10, capacity: 120 },
    { id: 'store-2', x: 1580, wood: 10, stone: 40, capacity: 120 }
  ];
  inTransit.residents[0] = {
    ...inTransit.residents[0]!, role: 'miner', x: 1170, mode: 'carrying', cargo: 'stone',
    targetStoreId: 'store-2', targetX: 1580, targetY: WORLD.groundY,
    targetSiteId: null, task: 'Несёт камень на склад'
  };
  result = await openSavedGame(browser, inTransit);
  await panTo(result.page, 1500);
  await saveScreenshot(result.page, 'v07-10-miner-nearest-warehouse');
  await expect(result.canvas).toHaveAttribute('data-eastern-sector-state', 'unlockable');
  await result.context.close();

  const rerouted = sectorWorld('prepared', 1);
  rerouted.stores = [
    { id: 'store-1', x: 963, wood: 0, stone: 20, capacity: 120 },
    { id: 'store-2', x: 1580, wood: 120, stone: 0, capacity: 120 }
  ];
  rerouted.residents[0] = {
    ...rerouted.residents[0]!, role: 'miner', x: 1400, mode: 'carrying', cargo: 'stone',
    targetStoreId: 'store-2', targetX: 1580, targetY: WORLD.groundY,
    targetSiteId: null, task: 'Перенаправляет камень к складу'
  };
  result = await openSavedGame(browser, rerouted);
  await expect.poll(() => result.page.evaluate((key) => {
    const save = JSON.parse(localStorage.getItem(key) ?? '{}') as PrototypeWorld;
    return save.residents[0]?.targetStoreId ?? null;
  }, SAVE_KEY)).toBe('store-1');
  await panTo(result.page, 1450);
  await saveScreenshot(result.page, 'v07-11-full-warehouse-reroute');
  await result.context.close();

  for (const orientation of [
    { width: 390, height: 844, name: 'portrait', file: 'v07-12-portrait' },
    { width: 844, height: 390, name: 'landscape', file: 'v07-13-landscape' }
  ] as const) {
    result = await openSavedGame(browser, sectorWorld('prepared', 1), {
      width: orientation.width, height: orientation.height
    });
    const viewport = await result.page.evaluate(() => ({
      innerWidth: window.innerWidth,
      innerHeight: window.innerHeight,
      visualWidth: window.visualViewport?.width ?? null,
      visualHeight: window.visualViewport?.height ?? null,
      canvasWidth: document.querySelector<HTMLCanvasElement>('#world-scene canvas')!.width,
      canvasHeight: document.querySelector<HTMLCanvasElement>('#world-scene canvas')!.height
    }));
    expect(viewport.innerWidth).toBe(orientation.width);
    expect(viewport.innerHeight).toBe(orientation.height);
    expect(viewport.canvasWidth).toBe(orientation.width);
    expect(viewport.canvasHeight).toBe(orientation.height);
    if (viewport.visualWidth !== null) expect(viewport.visualWidth).toBeGreaterThan(0);
    if (viewport.visualHeight !== null) expect(viewport.visualHeight).toBeGreaterThan(0);
    await saveScreenshot(result.page, orientation.file);
    if (orientation.name === 'landscape') {
      const manifest = await result.page.evaluate(async () => {
        const response = await fetch('/manifest.webmanifest');
        return { ok: response.ok, body: await response.json() as { display?: string; orientation?: string } };
      });
      expect(manifest).toMatchObject({ ok: true, body: { display: 'standalone', orientation: 'any' } });
      expect(await result.page.locator('meta[name="apple-mobile-web-app-capable"]').getAttribute('content')).toBe('yes');
    }
    await result.context.close();
  }
});
