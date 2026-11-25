import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test, type Page } from '@playwright/test';
import { LAND_GRID_CELLS, landCellAt } from '../src/land-grid.js';
import {
  createNewWorld, PROTOTYPE_CONFIG, STORAGE_KEY, WORLD, type PrototypeWorld
} from '../src/simulation.js';

const evidence = resolve(process.env.PLAYWRIGHT_EVIDENCE_DIR ??
  fileURLToPath(new URL('../../../docs/gameplay-prototype-v0.1/evidence-roads-grid-2026-11-21/', import.meta.url)), 'territory-input');

async function capture(page: Page, name: string): Promise<void> {
  mkdirSync(evidence, { recursive: true });
  await page.screenshot({ path: resolve(evidence, `${name}.png`), animations: 'disabled' });
}

async function savedWorld(page: Page): Promise<PrototypeWorld> {
  return page.evaluate((key) => JSON.parse(localStorage.getItem(key)!), STORAGE_KEY);
}

async function worldView(page: Page): Promise<{ x: number; y: number; width: number; height: number }> {
  return page.locator('#world-scene canvas').evaluate((canvas) =>
    JSON.parse((canvas as HTMLCanvasElement).dataset.worldView ?? '{}'));
}

async function cameraZoom(page: Page): Promise<number> {
  return page.locator('#world-scene canvas').evaluate((canvas) =>
    Number((canvas as HTMLCanvasElement).dataset.cameraZoom));
}

async function panWithMouse(page: Page, direction: -1 | 1 = 1): Promise<void> {
  const canvas = page.locator('#world-scene canvas');
  const bounds = await canvas.boundingBox();
  if (!bounds) throw new Error('Game canvas has no visible bounds.');
  const y = bounds.y + bounds.height * 0.52;
  const fromX = bounds.x + bounds.width * (direction > 0 ? 0.74 : 0.26);
  const toX = bounds.x + bounds.width * (direction > 0 ? 0.26 : 0.74);
  await page.mouse.move(fromX, y);
  await page.mouse.down();
  await page.mouse.move(toX, y, { steps: 12 });
  await page.mouse.up();
  await page.waitForTimeout(100);
}

async function panToWorldX(page: Page, worldX: number, touch = false): Promise<void> {
  const canvas = page.locator('#world-scene canvas');
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const view = await worldView(page);
    if (worldX >= view.x + view.width * 0.2 && worldX <= view.x + view.width * 0.8) return;
    const bounds = await canvas.boundingBox();
    if (!bounds) throw new Error('Game canvas has no visible bounds.');
    const delta = worldX - (view.x + view.width / 2);
    const distance = Math.min(Math.abs(delta) * bounds.width / view.width, bounds.width * 0.56);
    const sign = Math.sign(delta);
    const start = {
      x: bounds.x + bounds.width / 2 + sign * distance / 2,
      y: bounds.y + bounds.height * 0.48
    };
    const end = {
      x: bounds.x + bounds.width / 2 - sign * distance / 2,
      y: start.y
    };
    if (touch) await touchSwipe(page, start, end);
    else {
      await page.mouse.move(start.x, start.y);
      await page.mouse.down();
      await page.mouse.move(end.x, end.y, { steps: 10 });
      await page.mouse.up();
    }
    await page.waitForTimeout(100);
  }
}

async function screenPointForWorld(page: Page, worldX: number, worldY: number) {
  return page.locator('#world-scene canvas').evaluate((element, point) => {
    const canvas = element as HTMLCanvasElement;
    const bounds = canvas.getBoundingClientRect();
    const view = JSON.parse(canvas.dataset.worldView ?? '{}') as { x: number; y: number; width: number; height: number };
    return {
      x: bounds.left + (point.x - view.x) * bounds.width / view.width,
      y: bounds.top + (point.y - view.y) * bounds.height / view.height
    };
  }, { x: worldX, y: worldY });
}

async function tapWorld(page: Page, worldX: number, touch = false): Promise<void> {
  await panToWorldX(page, worldX, touch);
  const point = await screenPointForWorld(page, worldX, WORLD.groundY - 140);
  if (touch) await page.touchscreen.tap(point.x, point.y);
  else {
    const bounds = await page.locator('#world-scene canvas').boundingBox();
    if (!bounds) throw new Error('Game canvas has no visible bounds.');
    await page.locator('#world-scene canvas').click({
      position: { x: point.x - bounds.x, y: point.y - bounds.y }
    });
  }
}

async function touchSwipe(page: Page, from: { x: number; y: number }, to: { x: number; y: number }): Promise<void> {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchStart', touchPoints: [{ id: 1, x: from.x, y: from.y }]
  });
  for (let step = 1; step <= 10; step += 1) {
    const progress = step / 10;
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchMove', touchPoints: [{
        id: 1, x: from.x + (to.x - from.x) * progress, y: from.y + (to.y - from.y) * progress
      }]
    });
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await cdp.detach();
}

async function touchCancel(page: Page): Promise<void> {
  const canvas = await page.locator('#world-scene canvas').boundingBox();
  if (!canvas) throw new Error('Game canvas has no visible bounds.');
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchStart', touchPoints: [{ id: 9, x: canvas.x + canvas.width / 2, y: canvas.y + canvas.height / 2 }]
  });
  // Emit a cancellable PointerEvent on the canvas after a real touch down.
  // CDP's touchCancel is reported by Chromium as a console error in headless mode.
  await page.locator('#world-scene canvas').evaluate((element) => element.dispatchEvent(
    new PointerEvent('pointercancel', { bubbles: true, cancelable: true, pointerId: 9 })
  ));
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await cdp.detach();
}

async function pinch(page: Page, center: { x: number; y: number }, scale: number): Promise<void> {
  const cdp = await page.context().newCDPSession(page);
  const half = 45;
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchStart', touchPoints: [
      { id: 1, x: center.x - half, y: center.y },
      { id: 2, x: center.x + half, y: center.y }
    ]
  });
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchMove', touchPoints: [
      { id: 1, x: center.x - half * scale, y: center.y },
      { id: 2, x: center.x + half * scale, y: center.y }
    ]
  });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await cdp.detach();
}

function worldWithHouse(wood: number, ore: number): PrototypeWorld {
  const world = createNewWorld();
  world.buildings.push({ id: 'test-house', kind: 'house', x: 690, y: WORLD.groundY });
  world.occupiedPlots.push(1);
  world.stores[0]!.wood = wood;
  world.stores[0]!.ore = ore;
  world.stores[0]!.capacity = Math.max(world.stores[0]!.capacity, wood + ore + 10);
  return world;
}

test('BUG-01 selecting an affordable-to-open land cell never strands desktop camera input', async ({ page }) => {
  test.setTimeout(90_000);
  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error' && !message.text().includes('favicon')) consoleErrors.push(message.text());
  });
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.addInitScript(({ key, world }) => {
    if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify(world));
  }, {
    key: STORAGE_KEY, world: worldWithHouse(30, 20)
  });
  await page.goto('/');
  const canvas = page.locator('#world-scene canvas');
  await expect(canvas).toBeVisible();
  await page.locator('#grid-button').click();

  const expandable = LAND_GRID_CELLS.find((cell) => cell.id === 4)!;
  await tapWorld(page, expandable.centerX);
  await expect(page.locator('#selection-title')).toHaveText(`Земельная клетка ${expandable.number}`);
  await expect(page.locator('#selection-detail')).toContainText('Можно открыть');
  await expect(page.locator('#selection-detail')).toContainText('Не хватает');
  await expect(page.getByTestId('unlock-land-cell')).toBeDisabled();
  await capture(page, 'territory-desktop-insufficient-resources');
  await page.locator('#close-panel').click();
  await expect(page.locator('#control-panel')).toBeHidden();

  const beforePan = await worldView(page);
  await panWithMouse(page, 1);
  await expect.poll(async () => (await worldView(page)).x).not.toBe(beforePan.x);

  for (let attempt = 0; attempt < 3; attempt += 1) {
    await tapWorld(page, expandable.centerX);
    await expect(page.locator('#selection-title')).toHaveText(`Земельная клетка ${expandable.number}`);
    expect(await page.locator('#control-panel').count()).toBe(1);
    await page.locator('#close-panel').click();
    await expect(page.locator('#control-panel')).toBeHidden();
  }
  const cameraBeforeSecondPan = await worldView(page);
  await panWithMouse(page, -1);
  await expect.poll(async () => (await worldView(page)).x).not.toBe(cameraBeforeSecondPan.x);
  expect((await savedWorld(page)).landCells.find((cell) => cell.id === 4)?.state).toBe('closed');
  expect(pageErrors).toEqual([]);
  expect(consoleErrors).toEqual([]);
});

test('BUG-01 touch gestures recover through unlock, clearing, prepared-cell selection and reload', async ({ browser }) => {
  test.setTimeout(120_000);
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true
  });
  const page = await context.newPage();
  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error' && !message.text().includes('favicon')) consoleErrors.push(message.text());
  });
  const unlockCost = PROTOTYPE_CONFIG.expansion.unlockCost;
  const world = worldWithHouse(unlockCost.wood + 10, unlockCost.ore + 10);
  await page.addInitScript(({ key, world }) => {
    if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify(world));
  }, {
    key: STORAGE_KEY, world
  });
  await page.goto('/');
  const canvas = page.locator('#world-scene canvas');
  await expect(canvas).toBeVisible();
  await page.locator('#grid-button').click();

  const expandable = LAND_GRID_CELLS.find((cell) => cell.id === 4)!;
  await tapWorld(page, expandable.centerX, true);
  await expect(page.locator('#selection-title')).toHaveText(`Земельная клетка ${expandable.number}`);
  await expect(page.getByTestId('unlock-land-cell')).toBeEnabled();
  await page.getByTestId('unlock-land-cell').click();
  await expect.poll(async () => (await savedWorld(page)).landCells.find((cell) => cell.id === 4)?.state)
    .toBe('unlocked');
  await expect(page.locator('#selection-detail')).toContainText('Открыта');
  await capture(page, 'territory-mobile-unlocked-cell');

  await page.getByTestId('clear-land-cell').click();
  await expect.poll(async () => (await savedWorld(page)).landCells.find((cell) => cell.id === 4)?.state)
    .toBe('clearing');
  await expect(page.locator('#selection-detail')).toContainText(/расчищ/i);
  await page.locator('#close-panel').click();
  await touchCancel(page);
  const beforePan = await worldView(page);
  await touchSwipe(page, { x: 300, y: 480 }, { x: 90, y: 480 });
  await expect.poll(async () => (await worldView(page)).x).not.toBe(beforePan.x);

  const prepared = LAND_GRID_CELLS.find((cell) => cell.id === 0)!;
  await tapWorld(page, prepared.centerX, true);
  await expect(page.locator('#selection-title')).toHaveText(`Земельная клетка ${prepared.number}`);
  await expect(page.locator('#selection-detail')).toContainText('Подготовлена');
  await capture(page, 'territory-mobile-prepared-cell');
  await page.locator('#close-panel').click();
  const zoomBefore = await cameraZoom(page);
  await pinch(page, { x: 195, y: 480 }, 1.2);
  await expect.poll(async () => cameraZoom(page)).toBeGreaterThan(zoomBefore);
  const beforePinchPan = await worldView(page);
  await touchSwipe(page, { x: 300, y: 480 }, { x: 90, y: 480 });
  await expect.poll(async () => (await worldView(page)).x).not.toBe(beforePinchPan.x);

  const saved = await savedWorld(page);
  await page.reload();
  await expect(canvas).toBeVisible();
  expect((await savedWorld(page)).landCells.find((cell) => cell.id === 4)?.state).toBe('clearing');
  expect((await savedWorld(page)).buildings.find((building) => building.id === 'test-house')?.x)
    .toBe(landCellAt(690, WORLD.groundY - 80)!.centerX);
  expect(saved.landCells.find((cell) => cell.id === 4)?.state).toBe('clearing');
  expect(pageErrors).toEqual([]);
  expect(consoleErrors).toEqual([]);
  await context.close();
});
