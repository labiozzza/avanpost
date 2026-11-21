import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test, type Browser, type Locator, type Page } from '@playwright/test';
import { createNewWorld, PROTOTYPE_CONFIG } from '../src/simulation.js';

const SAVE_KEY = 'avanpost:gameplay-prototype:v01';
const VIEWPORTS = [
  { width: 375, height: 667, name: 'iphone-se' },
  { width: 667, height: 375, name: 'iphone-se-landscape' },
  { width: 390, height: 844, name: 'modern-iphone' },
  { width: 844, height: 390, name: 'smartphone-landscape' },
  { width: 1440, height: 900, name: 'desktop' }
] as const;

type Camera = { x: number; y: number; zoom: number };
type SceneLabel = { kind: string; id: string; text: string; x: number; y: number; width: number; height: number };
type CdpSession = Awaited<ReturnType<ReturnType<Page['context']>['newCDPSession']>>;
type ScreenRect = { x: number; y: number; width: number; height: number; right: number; bottom: number };

function expectNoRectOverlap(first: ScreenRect, second: ScreenRect, message: string): void {
  const overlaps = first.x < second.right && first.right > second.x &&
    first.y < second.bottom && first.bottom > second.y;
  expect(overlaps, message).toBe(false);
}

async function expectNoLabelOverlaps(canvas: Locator): Promise<void> {
  const labels = await canvas.evaluate((element) => {
    const raw = (element as HTMLCanvasElement).dataset.labelBounds;
    return raw ? JSON.parse(raw) as SceneLabel[] : [];
  });
  for (let first = 0; first < labels.length; first += 1) {
    for (let second = first + 1; second < labels.length; second += 1) {
      const a = labels[first]!;
      const b = labels[second]!;
      const overlapX = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
      const overlapY = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
      expect(overlapX > 0 && overlapY > 0, `${a.kind}:${a.id} overlaps ${b.kind}:${b.id}`).toBe(false);
    }
  }
}

async function expectLabelsWithinSafeArea(canvas: Locator): Promise<void> {
  const layout = await canvas.evaluate((element) => {
    const canvasElement = element as HTMLCanvasElement;
    const canvasBounds = canvasElement.getBoundingClientRect();
    const zoom = Number(canvasElement.dataset.cameraZoom);
    const worldView = JSON.parse(canvasElement.dataset.worldView ?? '{}') as {
      width: number; height: number;
    };
    const scaleX = worldView.width * zoom / Math.max(1, canvasBounds.width);
    const scaleY = worldView.height * zoom / Math.max(1, canvasBounds.height);
    const labels = JSON.parse(canvasElement.dataset.labelScreenBounds ?? '[]') as SceneLabel[];
    const obstructions = [
      '.hud-top',
      '.action-dock',
      '#control-panel',
      '.toast.visible',
      '.toast-inline.visible',
      '.pwa-banner:not([hidden])',
      '#forest-wayfinder:not([hidden])'
    ].flatMap((selector) => {
      const node = document.querySelector<HTMLElement>(selector);
      if (!node || getComputedStyle(node).display === 'none') return [];
      const bounds = node.getBoundingClientRect();
      if (bounds.width <= 0 || bounds.height <= 0) return [];
      return [{
        x: (bounds.left - canvasBounds.left) * scaleX,
        y: (bounds.top - canvasBounds.top) * scaleY,
        width: bounds.width * scaleX,
        height: bounds.height * scaleY
      }];
    });
    return {
      width: worldView.width * zoom,
      height: worldView.height * zoom,
      labels,
      obstructions
    };
  });

  for (const label of layout.labels) {
    expect(label.x, `${label.text} left edge`).toBeGreaterThanOrEqual(7);
    expect(label.y, `${label.text} top edge`).toBeGreaterThanOrEqual(7);
    expect(label.x + label.width, `${label.text} right edge`).toBeLessThanOrEqual(layout.width - 7);
    expect(label.y + label.height, `${label.text} bottom edge`).toBeLessThanOrEqual(layout.height - 7);
    for (const obstruction of layout.obstructions) {
      const intersects = label.x < obstruction.x + obstruction.width &&
        label.x + label.width > obstruction.x &&
        label.y < obstruction.y + obstruction.height &&
        label.y + label.height > obstruction.y;
      expect(intersects, `${label.text} must not cover a HUD control`).toBe(false);
    }
  }
}

async function expectForestHudLayout(
  page: Page,
  options: { expectPanel?: boolean; landscape?: boolean } = {}
): Promise<void> {
  const layout = await page.evaluate(() => {
    const rect = (selector: string): ScreenRect | null => {
      const element = document.querySelector<HTMLElement>(selector);
      if (!element || element.getClientRects().length === 0) return null;
      const style = getComputedStyle(element);
      if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) return null;
      const bounds = element.getBoundingClientRect();
      if (bounds.width <= 0 || bounds.height <= 0) return null;
      return {
        x: bounds.left, y: bounds.top, width: bounds.width, height: bounds.height,
        right: bounds.right, bottom: bounds.bottom
      };
    };
    const actionRects = [...document.querySelectorAll<HTMLElement>('#control-panel button')].flatMap((element) => {
      if (element.getClientRects().length === 0) return [];
      const style = getComputedStyle(element);
      if (style.display === 'none' || style.visibility === 'hidden') return [];
      const bounds = element.getBoundingClientRect();
      if (bounds.width <= 0 || bounds.height <= 0) return [];
      return [{
        x: bounds.left, y: bounds.top, width: bounds.width, height: bounds.height,
        right: bounds.right, bottom: bounds.bottom
      }];
    });
    const goal = document.querySelector<HTMLElement>('#goal-chip');
    return {
      viewport: { width: window.innerWidth, height: window.innerHeight },
      hud: rect('.hud-top'),
      resources: rect('.vitals'),
      menu: rect('#menu-button'),
      goal: rect('.goal-chip'),
      wayfinder: rect('#forest-wayfinder'),
      showButton: rect('#show-eastern-forest'),
      placement: rect('#placement-banner'),
      actionDock: rect('.action-dock'),
      panel: rect('#control-panel'),
      panelActions: actionRects,
      goalFits: Boolean(goal && goal.scrollWidth <= goal.clientWidth + 1 &&
        goal.scrollHeight <= goal.clientHeight + 1),
      goalText: goal?.textContent?.trim() ?? ''
    };
  });

  expect(layout.hud, 'top HUD should be visible').not.toBeNull();
  expect(layout.resources, 'resource indicators should be visible').not.toBeNull();
  expect(layout.goal, 'current goal should be visible').not.toBeNull();
  expect(layout.goalFits, 'current goal text should not be clipped').toBe(true);
  expectNoRectOverlap(layout.resources!, layout.goal!, 'resource indicators must not cover the current goal');
  if (layout.menu) {
    expectNoRectOverlap(layout.resources!, layout.menu, 'resource indicators must not cover the menu');
    expectNoRectOverlap(layout.goal!, layout.menu, 'current goal must not cover the menu');
  }
  for (const [name, rect] of Object.entries({
    resources: layout.resources,
    menu: layout.menu,
    goal: layout.goal,
    wayfinder: layout.wayfinder,
    showButton: layout.showButton,
    placement: layout.placement,
    actionDock: layout.actionDock
  })) {
    if (!rect) continue;
    expect(rect.x, `${name} left edge`).toBeGreaterThanOrEqual(0);
    expect(rect.y, `${name} top edge`).toBeGreaterThanOrEqual(0);
    expect(rect.right, `${name} right edge`).toBeLessThanOrEqual(layout.viewport.width);
    expect(rect.bottom, `${name} bottom edge`).toBeLessThanOrEqual(layout.viewport.height);
  }

  if (layout.wayfinder) {
    expect(layout.showButton, 'visible wayfinder has a visible action').not.toBeNull();
    expect(layout.showButton!.width).toBeGreaterThanOrEqual(44);
    expect(layout.showButton!.height).toBeGreaterThanOrEqual(44);
    expectNoRectOverlap(layout.wayfinder, layout.resources!, 'wayfinder must not overlap resource indicators');
    expectNoRectOverlap(layout.wayfinder, layout.goal!, 'wayfinder must not overlap the current goal');
    if (layout.menu) expectNoRectOverlap(layout.wayfinder, layout.menu, 'wayfinder must not cover the menu');
    if (layout.placement) {
      expectNoRectOverlap(layout.wayfinder, layout.placement, 'wayfinder must not overlap placement controls');
    }
    if (layout.actionDock) {
      expectNoRectOverlap(layout.wayfinder, layout.actionDock, 'wayfinder must not overlap the action dock');
    }
    for (const action of layout.panelActions) {
      expectNoRectOverlap(layout.wayfinder, action, 'wayfinder must not cover a context-card action');
    }
  }

  if (options.expectPanel) {
    expect(layout.panel, 'context card should remain visible').not.toBeNull();
    expect(layout.panelActions.length).toBeGreaterThan(0);
  }
  if (options.landscape) {
    expect(layout.viewport.width).toBeGreaterThan(layout.viewport.height);
    expect(layout.wayfinder?.width ?? 0).toBeLessThanOrEqual(330);
    expect(layout.wayfinder?.height ?? 0).toBeLessThanOrEqual(60);
  }
}

async function expectResidentsInFrame(canvas: Locator, expectedCount: number): Promise<void> {
  const geometry = await canvas.evaluate((element) => {
    const canvasElement = element as HTMLCanvasElement;
    return {
      worldView: JSON.parse(canvasElement.dataset.worldView ?? '{}') as {
        x: number; y: number; width: number; height: number;
      },
      residents: (JSON.parse(canvasElement.dataset.objectBounds ?? '{}') as {
        residents: Array<{ id: string; left: number; right: number; top: number; bottom: number }>;
      }).residents
    };
  });
  expect(geometry.residents).toHaveLength(expectedCount);
  for (const resident of geometry.residents) {
    expect(resident.left).toBeGreaterThanOrEqual(geometry.worldView.x);
    expect(resident.right).toBeLessThanOrEqual(geometry.worldView.x + geometry.worldView.width);
    expect(resident.top).toBeGreaterThanOrEqual(geometry.worldView.y);
    expect(resident.bottom).toBeLessThanOrEqual(geometry.worldView.y + geometry.worldView.height);
  }
}

async function openGame(browser: Browser, viewport: { width: number; height: number }) {
  const context = await browser.newContext({
    viewport,
    deviceScaleFactor: 1,
    hasTouch: true
  });
  const page = await context.newPage();
  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  await page.addInitScript((key) => {
    if (sessionStorage.getItem('playtest-fresh-world') !== '1') {
      localStorage.removeItem(key);
      sessionStorage.setItem('playtest-fresh-world', '1');
    }
  }, SAVE_KEY);
  const assetResponses: string[] = [];
  page.on('response', (response) => {
    if (response.url().includes('/assets/peace-v2/') || response.url().includes('/assets/gameplay-prototype/')) {
      if (response.status() !== 200) assetResponses.push(`${response.status()} ${response.url()}`);
    }
  });
  await page.goto('/');
  const canvas = page.locator('#world-scene canvas');
  await expect(canvas).toBeVisible();
  await page.waitForFunction(() => {
    const element = document.querySelector<HTMLCanvasElement>('#world-scene canvas');
    return Boolean(element?.width && element?.height && element.dataset.cameraX &&
      element.dataset.cameraZoom && element.dataset.groundScreenRatio &&
      element.dataset.cameraScaleX && element.dataset.cameraScaleY &&
      element.dataset.canvasCssAspect && element.dataset.canvasBufferAspect && element.dataset.spriteAspectScale &&
      element.dataset.worldView && element.dataset.objectBounds && element.dataset.labelBounds &&
      element.dataset.panoramaGeometry);
  });
  await expect(page).toHaveTitle('Аванпост');
  return { context, page, canvas, pageErrors, consoleErrors, assetResponses };
}

async function cameraState(page: Page): Promise<Camera> {
  return page.locator('#world-scene canvas').evaluate((canvas) => ({
    x: Number(canvas.dataset.cameraX),
    y: Number(canvas.dataset.cameraY),
    zoom: Number(canvas.dataset.cameraZoom)
  }));
}

async function expectUniformRenderScale(canvas: Locator): Promise<Record<string, number>> {
  const metrics = await canvas.evaluate((element) => {
    const canvasElement = element as HTMLCanvasElement;
    return {
      cameraX: Number(canvasElement.dataset.cameraScaleX),
      cameraY: Number(canvasElement.dataset.cameraScaleY),
      cssAspect: Number(canvasElement.dataset.canvasCssAspect),
      bufferAspect: Number(canvasElement.dataset.canvasBufferAspect),
      spriteAspectScale: JSON.parse(canvasElement.dataset.spriteAspectScale ?? '{}') as Record<string, number>
    };
  });
  expect(metrics.cameraX).toBeCloseTo(metrics.cameraY, 4);
  expect(metrics.cssAspect).toBeCloseTo(metrics.bufferAspect, 4);
  expect(Object.keys(metrics.spriteAspectScale).sort()).toEqual([
    'house', 'resident', 'stone', 'store', 'tree', 'woodStockpile'
  ]);
  for (const [asset, scale] of Object.entries(metrics.spriteAspectScale)) {
    expect(scale, `${asset} source-to-display aspect ratio`).toBeCloseTo(1, 4);
  }
  return metrics.spriteAspectScale;
}

async function screenPointForWorld(page: Page, x: number, y: number): Promise<{ x: number; y: number }> {
  const canvas = page.locator('#world-scene canvas');
  return canvas.evaluate((element, point) => {
    const bounds = element.getBoundingClientRect();
    const worldView = JSON.parse((element as HTMLCanvasElement).dataset.worldView ?? '{}') as {
      x: number; y: number;
    };
    const zoom = Number((element as HTMLCanvasElement).dataset.cameraZoom);
    return {
      x: bounds.left + (point.x - worldView.x) * zoom,
      y: bounds.top + (point.y - worldView.y) * zoom
    };
  }, { x, y });
}

async function saveScreenshot(page: Page, name: string): Promise<void> {
  const directory = resolve(process.env.PLAYWRIGHT_SCREENSHOT_DIR ?? 'apps/gameplay-prototype/test-results/screenshots');
  mkdirSync(directory, { recursive: true });
  await page.screenshot({
    path: resolve(directory, `${name}.png`),
    fullPage: false,
    animations: 'disabled'
  });
}

async function touchSwipe(
  cdp: CdpSession,
  from: { x: number; y: number },
  to: { x: number; y: number },
  id = 1,
  steps = 10
): Promise<void> {
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchStart', touchPoints: [{ id, x: from.x, y: from.y }]
  });
  for (let step = 1; step <= steps; step += 1) {
    const progress = step / steps;
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [{
        id,
        x: from.x + (to.x - from.x) * progress,
        y: from.y + (to.y - from.y) * progress
      }]
    });
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}

async function pinchByScale(
  cdp: CdpSession,
  center: { x: number; y: number },
  scale: number
): Promise<void> {
  const halfDistance = 45;
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [
      { id: 1, x: center.x - halfDistance, y: center.y },
      { id: 2, x: center.x + halfDistance, y: center.y }
    ]
  });
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchMove',
    touchPoints: [
      { id: 1, x: center.x - halfDistance * scale, y: center.y },
      { id: 2, x: center.x + halfDistance * scale, y: center.y }
    ]
  });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}

async function expectCameraInsideWorld(page: Page): Promise<void> {
  const geometry = await page.locator('#world-scene canvas').evaluate((element) => {
    const canvas = element as HTMLCanvasElement;
    return {
      view: JSON.parse(canvas.dataset.worldView ?? '{}') as {
        x: number; y: number; width: number; height: number;
      },
      bounds: JSON.parse(canvas.dataset.worldBounds ?? '{}') as {
        left: number; top: number; right: number; bottom: number;
      }
    };
  });
  expect(geometry.view.x).toBeGreaterThanOrEqual(geometry.bounds.left - 1);
  expect(geometry.view.x + geometry.view.width).toBeLessThanOrEqual(geometry.bounds.right + 1);
  expect(geometry.view.y).toBeGreaterThanOrEqual(geometry.bounds.top - 1);
  expect(geometry.view.y + geometry.view.height).toBeLessThanOrEqual(geometry.bounds.bottom + 1);
}

async function expectPanoramaCoversWorld(page: Page): Promise<void> {
  const geometry = await page.locator('#world-scene canvas').evaluate((element) => {
    const canvas = element as HTMLCanvasElement;
    return {
      panorama: JSON.parse(canvas.dataset.panoramaGeometry ?? '{}') as {
        sourceWidth: number; sourceHeight: number; displayWidth: number; displayHeight: number;
        centerX: number; visibleLeft: number; visibleRight: number; visibleTop: number;
        visibleBottom: number; instanceCount: number; worldWidth: number; worldTop: number;
        groundY: number;
      },
      view: JSON.parse(canvas.dataset.worldView ?? '{}') as {
        x: number; y: number; width: number; height: number;
      }
    };
  });
  const { panorama, view } = geometry;
  expect(panorama.instanceCount, 'one un-tiled panorama instance should be rendered').toBe(1);
  expect(panorama.centerX).toBeCloseTo(panorama.worldWidth / 2, 5);
  expect(panorama.visibleLeft).toBeLessThan(0);
  expect(panorama.visibleRight).toBeGreaterThan(panorama.worldWidth);
  expect(panorama.visibleTop).toBeLessThanOrEqual(panorama.worldTop);
  expect(panorama.visibleBottom).toBeCloseTo(panorama.groundY, 5);
  expect(panorama.displayWidth / panorama.displayHeight)
    .toBeCloseTo(panorama.sourceWidth / panorama.sourceHeight, 8);
  expect(view.x).toBeGreaterThanOrEqual(panorama.visibleLeft - 1);
  expect(view.x + view.width).toBeLessThanOrEqual(panorama.visibleRight + 1);
  expect(view.y).toBeGreaterThanOrEqual(panorama.visibleTop - 1);
}

async function panToWorldX(page: Page, cdp: CdpSession, targetX: number): Promise<void> {
  const canvas = page.locator('#world-scene canvas');
  const box = await canvas.boundingBox();
  expect(box).not.toBeNull();
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const view = await canvas.evaluate((element) => JSON.parse(
      (element as HTMLCanvasElement).dataset.worldView ?? '{}'
    ) as { x: number; width: number });
    if (targetX >= view.x + view.width * 0.28 && targetX <= view.x + view.width * 0.72) return;
    const y = box!.y + box!.height * 0.4;
    const movingRight = targetX > view.x + view.width * 0.72;
    await touchSwipe(cdp,
      { x: box!.x + box!.width * (movingRight ? 0.78 : 0.22), y },
      { x: box!.x + box!.width * (movingRight ? 0.22 : 0.78), y }
    );
    await expectCameraInsideWorld(page);
  }
  const finalView = await canvas.evaluate((element) => JSON.parse(
    (element as HTMLCanvasElement).dataset.worldView ?? '{}'
  ) as { x: number; width: number });
  expect(targetX).toBeGreaterThanOrEqual(finalView.x);
  expect(targetX).toBeLessThanOrEqual(finalView.x + finalView.width);
}

async function tapWorld(page: Page, x: number, y: number): Promise<void> {
  const point = await screenPointForWorld(page, x, y);
  await page.touchscreen.tap(point.x, point.y);
}

async function expectEasternForestBlocked(
  page: Page,
  cdp: CdpSession,
  screenshot: string
): Promise<void> {
  if (await page.locator('#control-panel').isVisible()) {
    await page.locator('#close-panel').click();
  }
  const closedForestCellX = 3200;
  await panToWorldX(page, cdp, closedForestCellX);
  await tapWorld(page, closedForestCellX, 560);
  await expect(page.locator('#selection-title')).toHaveText('Земельная клетка 10');
  await expect(page.locator('#selection-detail')).toContainText('закрыта густым лесом');
  await expect(page.locator('[data-testid="unlock-land-cell"]')).toBeDisabled();
  await expect(page.locator('[data-testid^="eastern-woodcutter-"]')).toHaveCount(0);
  await saveScreenshot(page, screenshot);
}

test('responsive scenes, camera gestures, pinch zoom, and contextual UI', async ({ browser }) => {
  for (const viewport of VIEWPORTS) {
    const { context, page, canvas, pageErrors, consoleErrors, assetResponses } = await openGame(browser, viewport);
    await expect(page.locator('#people-total')).toHaveText('3 / 3');
    const metrics = await canvas.evaluate((element) => {
      const canvasElement = element as HTMLCanvasElement;
      return {
        width: canvasElement.width,
        height: canvasElement.height,
        groundRatio: Number(canvasElement.dataset.groundScreenRatio),
        worldView: JSON.parse(canvasElement.dataset.worldView ?? '{}') as {
          x: number; y: number; width: number; height: number;
        },
        objectBounds: JSON.parse(canvasElement.dataset.objectBounds ?? '{}') as {
          warehouse: { left: number; right: number; top: number; bottom: number } | null;
          residents: Array<{ id: string; left: number; right: number; top: number; bottom: number }>;
        },
        labels: JSON.parse(canvasElement.dataset.labelBounds ?? '[]') as SceneLabel[],
        resident: Number(canvasElement.dataset.residentVisibleHeight),
        house: Number(canvasElement.dataset.houseVisibleHeight),
        store: Number(canvasElement.dataset.storeVisibleHeight),
        tree: Number(canvasElement.dataset.treeVisibleHeight)
      };
    });
    await expect(canvas).toHaveAttribute('data-projection', 'side-view');
    await expect(canvas).toHaveAttribute('data-terrain', 'layered-cross-section');
    const sceneAssets = await page.evaluate(() => performance.getEntriesByType('resource')
      .map((entry) => entry.name)
      .filter((name) => name.includes('/assets/peace-v2/')));
    expect(sceneAssets.some((name) => name.endsWith('/background-panorama.png'))).toBe(true);
    expect(sceneAssets.some((name) => name.endsWith('/sideview-geology-atlas.png'))).toBe(true);
    expect(sceneAssets.some((name) => name.endsWith('/sideview-turf-tile.png'))).toBe(true);
    const spritesLoaded = await page.evaluate(async () => {
      const load = (path: string) => new Promise<HTMLImageElement>((resolve, reject) => {
        const image = new Image();
        image.onload = () => resolve(image);
        image.onerror = () => reject(new Error(`Failed to load ${path}`));
        image.src = path;
      });
      const [worker, house, store, tree] = await Promise.all([
        load('/assets/peace-v2/worker-atlas.png'),
        load('/assets/peace-v2/house.png'),
        load('/assets/peace-v2/storehouse.png'),
        load('/assets/peace-v2/tree_full.png')
      ]);
      return [worker, house, store, tree].every((image) => image.naturalWidth > 0 && image.naturalHeight > 0);
    });
    expect(metrics.width).toBeGreaterThan(0);
    expect(metrics.height).toBeGreaterThan(0);
    expect(metrics.house / metrics.resident).toBeGreaterThanOrEqual(1.8);
    expect(metrics.house / metrics.resident).toBeLessThanOrEqual(2.3);
    expect(metrics.store / metrics.resident).toBeGreaterThan(1.5);
    expect(metrics.tree / metrics.resident).toBeGreaterThan(2.2);
    const targetGroundRatio = viewport.width > viewport.height
      ? viewport.width < 900 ? 0.62 : 0.64
      : 0.68;
    expect(metrics.groundRatio).toBeGreaterThan(targetGroundRatio - 0.025);
    expect(metrics.groundRatio).toBeLessThan(targetGroundRatio + 0.025);
    expect(metrics.objectBounds.warehouse).not.toBeNull();
    const visible = (rect: { left: number; right: number; top: number; bottom: number }) =>
      rect.left >= metrics.worldView.x &&
      rect.right <= metrics.worldView.x + metrics.worldView.width &&
      rect.top >= metrics.worldView.y &&
      rect.bottom <= metrics.worldView.y + metrics.worldView.height;
    expect(visible(metrics.objectBounds.warehouse!)).toBe(true);
    for (const resident of metrics.objectBounds.residents) {
      expect(visible(resident), `${resident.id} should fit in the start view`).toBe(true);
    }
    const residentLabels = metrics.labels.filter((label) => label.kind === 'resident');
    expect(residentLabels).toHaveLength(metrics.objectBounds.residents.length);
    for (const label of residentLabels) {
      expect(visible({
        left: label.x,
        right: label.x + label.width,
        top: label.y,
        bottom: label.y + label.height
      }), `${label.text} should be fully readable in the start view`).toBe(true);
    }
    for (const resident of metrics.objectBounds.residents) {
      const warehouse = metrics.objectBounds.warehouse!;
      const intersectsWarehouse =
        resident.left < warehouse.right && resident.right > warehouse.left &&
        resident.top < warehouse.bottom && resident.bottom > warehouse.top;
      expect(intersectsWarehouse, `${resident.id} should leave the warehouse facade visible`).toBe(false);
    }
    await expectNoLabelOverlaps(canvas);
    await expectLabelsWithinSafeArea(canvas);
    await expectPanoramaCoversWorld(page);
    await expectForestHudLayout(page);
    await expectUniformRenderScale(canvas);
    expect(spritesLoaded).toBe(true);
    await expect(page.locator('#dock-focus')).toBeVisible();
    await expect(page.locator('.goal-chip')).toBeVisible();
    await saveScreenshot(page, `start-${viewport.name}`);
    expect(assetResponses, `asset HTTP errors at ${viewport.name}`).toEqual([]);

    const box = await canvas.boundingBox();
    expect(box).not.toBeNull();
    const center = {
      x: box!.x + Math.round(box!.width / 2),
      y: box!.y + Math.round(box!.height * 0.52)
    };
    const cdp = await context.newCDPSession(page);
    await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 2 });
    const initial = await cameraState(page);
    await saveScreenshot(page, `camera-touch-before-${viewport.name}`);
    await touchSwipe(cdp, center, { x: center.x, y: center.y - 100 });
    const afterUp = await cameraState(page);
    expect(afterUp.y).toBeGreaterThan(initial.y);
    await expect.poll(async () => Number(await canvas.getAttribute('data-ground-screen-ratio')))
      .toBeLessThan(metrics.groundRatio);
    await expectCameraInsideWorld(page);
    await expectNoLabelOverlaps(canvas);
    await expectLabelsWithinSafeArea(canvas);
    await saveScreenshot(page, `camera-touch-up-${viewport.name}`);
    await touchSwipe(cdp, center, { x: center.x, y: center.y + 100 });
    const afterDown = await cameraState(page);
    expect(afterDown.y).toBeLessThan(afterUp.y);
    const returnedGroundRatio = Number(await canvas.getAttribute('data-ground-screen-ratio'));
    expect(Math.abs(returnedGroundRatio - metrics.groundRatio)).toBeLessThan(0.025);
    await expectCameraInsideWorld(page);
    await expectNoLabelOverlaps(canvas);
    await expectLabelsWithinSafeArea(canvas);
    await saveScreenshot(page, `camera-touch-down-${viewport.name}`);

    if (viewport.name === 'modern-iphone') {
      await touchSwipe(cdp, center, { x: center.x - 100, y: center.y });
      const afterLeft = await cameraState(page);
      expect(afterLeft.x).toBeGreaterThan(afterDown.x);
      await expectCameraInsideWorld(page);
      await expectNoLabelOverlaps(canvas);
      await expectLabelsWithinSafeArea(canvas);
      await saveScreenshot(page, 'camera-touch-left');
      await touchSwipe(cdp, center, { x: center.x + 100, y: center.y });
      const afterRight = await cameraState(page);
      expect(afterRight.x).toBeLessThan(afterLeft.x);
      await expectCameraInsideWorld(page);
      await expectNoLabelOverlaps(canvas);
      await expectLabelsWithinSafeArea(canvas);
      await saveScreenshot(page, 'camera-touch-right');
      await touchSwipe(cdp, center, { x: center.x - 80, y: center.y - 80 });
      const afterDiagonal = await cameraState(page);
      expect(afterDiagonal.x).toBeGreaterThan(afterRight.x);
      expect(afterDiagonal.y).toBeGreaterThan(afterDown.y);
      await expectCameraInsideWorld(page);
      await saveScreenshot(page, 'camera-touch-diagonal');

      await page.locator('#dock-focus').click();
      await expect.poll(async () => (await cameraState(page)).y).toBeCloseTo(initial.y, 0);
      await expect.poll(async () => Number(await canvas.getAttribute('data-ground-screen-ratio'))).toBeCloseTo(0.68, 2);
      await expect.poll(async () => cameraState(page)).toMatchObject(initial);
      await expectPanoramaCoversWorld(page);
      await saveScreenshot(page, 'camera-touch-return-settlement');

      await cdp.send('Input.dispatchTouchEvent', {
        type: 'touchStart',
        touchPoints: [{ id: 1, x: center.x - 45, y: center.y }, { id: 2, x: center.x + 45, y: center.y }]
      });
      await cdp.send('Input.dispatchTouchEvent', {
        type: 'touchMove',
        touchPoints: [{ id: 1, x: center.x - 85, y: center.y }, { id: 2, x: center.x + 85, y: center.y }]
      });
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      await expect.poll(async () => (await cameraState(page)).zoom).toBeGreaterThan(initial.zoom + 0.1);
      const zoomCenterBefore = await canvas.evaluate((element) => {
        const view = JSON.parse((element as HTMLCanvasElement).dataset.worldView ?? '{}') as {
          x: number; y: number; width: number; height: number;
        };
        return { x: view.x + view.width / 2, y: view.y + view.height / 2 };
      });
      await saveScreenshot(page, 'camera-zoom-in');
      const zoomedIn = await cameraState(page);
      await cdp.send('Input.dispatchTouchEvent', {
        type: 'touchStart',
        touchPoints: [{ id: 1, x: center.x - 85, y: center.y }, { id: 2, x: center.x + 85, y: center.y }]
      });
      await cdp.send('Input.dispatchTouchEvent', {
        type: 'touchMove',
        touchPoints: [{ id: 1, x: center.x - 50, y: center.y }, { id: 2, x: center.x + 50, y: center.y }]
      });
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      await expect.poll(async () => (await cameraState(page)).zoom).toBeLessThan(zoomedIn.zoom - 0.1);
      const zoomCenterAfter = await canvas.evaluate((element) => {
        const view = JSON.parse((element as HTMLCanvasElement).dataset.worldView ?? '{}') as {
          x: number; y: number; width: number; height: number;
        };
        return { x: view.x + view.width / 2, y: view.y + view.height / 2 };
      });
      expect(Math.abs(zoomCenterAfter.x - zoomCenterBefore.x)).toBeLessThan(2);
      expect(Math.abs(zoomCenterAfter.y - zoomCenterBefore.y)).toBeLessThan(2);
      await expectCameraInsideWorld(page);
      await expectPanoramaCoversWorld(page);
      await expectNoLabelOverlaps(canvas);
      await expectLabelsWithinSafeArea(canvas);
      await saveScreenshot(page, 'camera-zoom-out');

      // Repeat a full two-finger pinch with fresh contacts. The CDP
      // dispatchTouchEvent API requires touchEnd to contain no points, so
      // partial-finger release/rebase is covered by CameraGestureController
      // unit tests rather than misrepresented as a native browser gesture.
      const repeatedPinchCenter = {
        x: box!.x + box!.width * 0.5,
        y: box!.y + box!.height * 0.48
      };
      const beforeRepeatedPinch = await cameraState(page);
      await cdp.send('Input.dispatchTouchEvent', {
        type: 'touchStart',
        touchPoints: [
          { id: 31, x: repeatedPinchCenter.x - 45, y: repeatedPinchCenter.y },
          { id: 32, x: repeatedPinchCenter.x + 45, y: repeatedPinchCenter.y }
        ]
      });
      await cdp.send('Input.dispatchTouchEvent', {
        type: 'touchMove',
        touchPoints: [
          { id: 31, x: repeatedPinchCenter.x - 70, y: repeatedPinchCenter.y },
          { id: 32, x: repeatedPinchCenter.x + 70, y: repeatedPinchCenter.y }
        ]
      });
      await expect.poll(async () => (await cameraState(page)).zoom).toBeGreaterThan(beforeRepeatedPinch.zoom + 0.1);
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });

      // A fresh one-finger pan after a complete pinch must not jump or be
      // interpreted as a tap inherited from the previous contacts.
      const beforePostPinchPan = await cameraState(page);
      await touchSwipe(cdp, center, { x: center.x, y: center.y + 25 });
      const afterPostPinchPan = await cameraState(page);
      expect(afterPostPinchPan.y).toBeLessThan(beforePostPinchPan.y);
      expect(afterPostPinchPan.zoom).toBeCloseTo(beforePostPinchPan.zoom, 2);
      expect(beforePostPinchPan.y - afterPostPinchPan.y)
        .toBeLessThan(25 / afterPostPinchPan.zoom + 10);
      await expectCameraInsideWorld(page);
      await expectPanoramaCoversWorld(page);
      await expectNoLabelOverlaps(canvas);
      await expectLabelsWithinSafeArea(canvas);

      await page.locator('#dock-focus').click();
      await page.locator('#dock-residents').click();
      await expect(page.locator('#control-panel')).toBeVisible();
      await expect(page.locator('#resident-list-section')).toBeVisible();
      await page.locator('#close-panel').click();
      await expect(page.locator('#control-panel')).toBeHidden();
      const zoomBeforeSelection = (await cameraState(page)).zoom;
      const canvasBoxBeforePanel = await canvas.boundingBox();
      // The mobile residents sheet can cover the lower part of the scene.
      // Close it before verifying a direct canvas tap; list selection is
      // covered separately below.
      const residentPoint = await screenPointForWorld(page, 640, 550);
      await page.touchscreen.tap(residentPoint.x, residentPoint.y);
      await expect(page.locator('#resident-actions')).toBeVisible();
      expect((await cameraState(page)).zoom).toBeCloseTo(zoomBeforeSelection, 2);
      expect(await canvas.boundingBox()).toEqual(canvasBoxBeforePanel);
      await expectNoLabelOverlaps(canvas);
      await expectLabelsWithinSafeArea(canvas);
      const selectedLabels = await canvas.evaluate((element) =>
        JSON.parse((element as HTMLCanvasElement).dataset.labelBounds ?? '[]') as SceneLabel[]
      );
      expect(selectedLabels.some((label) => label.kind === 'resident' && label.text === 'Илья')).toBe(true);
      await saveScreenshot(page, 'context-selected-resident');
      const panelBox = await page.locator('#control-panel').boundingBox();
      expect(panelBox).not.toBeNull();
      const cameraBeforePanelTouch = await cameraState(page);
      await touchSwipe(cdp,
        { x: panelBox!.x + panelBox!.width / 2, y: panelBox!.y + panelBox!.height / 2 },
        { x: panelBox!.x + panelBox!.width / 2, y: panelBox!.y + panelBox!.height / 2 + 30 });
      expect(await cameraState(page)).toEqual(cameraBeforePanelTouch);
      await expect(page.locator('#control-panel')).toBeVisible();

      await page.locator('#toggle-roles').click();
      await expect(page.locator('#role-options')).toBeVisible();
      const expandedCamera = await cameraState(page);
      expect(expandedCamera.zoom).toBeCloseTo(zoomBeforeSelection, 2);
      expect(await canvas.boundingBox()).toEqual(canvasBoxBeforePanel);
      await saveScreenshot(page, 'context-resident-expanded');
      await page.locator('#close-panel').click();
      await expect(page.locator('#control-panel')).toBeHidden();
      await expect.poll(async () => cameraState(page)).toMatchObject(expandedCamera);
      await page.locator('#dock-residents').click();
      await expect(page.locator('#resident-list-section')).toBeVisible();
      await saveScreenshot(page, 'context-residents');
      const panelScrollHeight = await page.locator('#control-panel').evaluate((element) => element.scrollHeight);
      const panelClientHeight = await page.locator('#control-panel').evaluate((element) => element.clientHeight);
      expect(panelClientHeight).toBeLessThanOrEqual(viewport.height);
      if (panelScrollHeight > panelClientHeight) {
        await page.locator('#control-panel').evaluate((element) => { element.scrollTop = element.scrollHeight; });
        expect(await page.locator('#control-panel').evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
      }
      const panFrom = { x: box!.x + box!.width * 0.82, y: box!.y + box!.height * 0.42 };
      const beforePanelBackgroundPan = await cameraState(page);
      await touchSwipe(cdp, panFrom, { x: panFrom.x, y: panFrom.y - 40 });
      expect(await cameraState(page)).not.toEqual(beforePanelBackgroundPan);
      await expect(page.locator('#control-panel')).toBeVisible();
      await page.locator('#close-panel').click();
      await expect(page.locator('#control-panel')).toBeHidden();
      await page.locator('#dock-focus').click();
      const beforeSceneTap = await cameraState(page);
      const residentTap = await screenPointForWorld(page, 640, 550);
      await page.touchscreen.tap(residentTap.x, residentTap.y);
      await expect(page.locator('#resident-actions')).toBeVisible();
      expect((await cameraState(page)).zoom).toBeCloseTo(beforeSceneTap.zoom, 2);
      await page.locator('#close-panel').click();
      const panFromScene = { x: center.x, y: center.y };
      await touchSwipe(cdp, panFromScene, { x: center.x, y: center.y - 55 });
      await expect(page.locator('#control-panel')).toBeHidden();
      expect((await cameraState(page)).y).toBeGreaterThan(beforeSceneTap.y);
      await expectCameraInsideWorld(page);

      // Exercise the clamps by dragging repeatedly to both ends of the world.
      for (let index = 0; index < 6; index += 1) {
        await touchSwipe(cdp,
          { x: box!.x + box!.width * 0.78, y: box!.y + box!.height * 0.5 },
          { x: box!.x + box!.width * 0.22, y: box!.y + box!.height * 0.5 });
        await expectCameraInsideWorld(page);
      }
      await expectNoLabelOverlaps(canvas);
      await expectLabelsWithinSafeArea(canvas);
      await expectPanoramaCoversWorld(page);
      await saveScreenshot(page, 'background-eastern-world-edge');
      await saveScreenshot(page, 'labels-eastern-world-edge');
      for (let index = 0; index < 6; index += 1) {
        await touchSwipe(cdp,
          { x: box!.x + box!.width * 0.22, y: box!.y + box!.height * 0.5 },
          { x: box!.x + box!.width * 0.78, y: box!.y + box!.height * 0.5 });
        await expectCameraInsideWorld(page);
      }
      await expectNoLabelOverlaps(canvas);
      await expectLabelsWithinSafeArea(canvas);
      await expectPanoramaCoversWorld(page);
      await saveScreenshot(page, 'background-western-world-edge');
      await saveScreenshot(page, 'labels-western-world-edge');

      let zoom = (await cameraState(page)).zoom;
      while (zoom < 1.34) {
        await pinchByScale(cdp, center, 2);
        await expect.poll(async () => (await cameraState(page)).zoom).toBeGreaterThan(zoom);
        zoom = (await cameraState(page)).zoom;
      }
      expect(zoom).toBeCloseTo(1.35, 2);
      await expectCameraInsideWorld(page);
      await expectPanoramaCoversWorld(page);
      await saveScreenshot(page, 'background-maximum-zoom');

      while (zoom > 0.59) {
        await pinchByScale(cdp, center, 0.5);
        await expect.poll(async () => (await cameraState(page)).zoom).toBeLessThan(zoom);
        zoom = (await cameraState(page)).zoom;
      }
      expect(zoom).toBeCloseTo(0.58, 2);
      await expectCameraInsideWorld(page);
      await expectPanoramaCoversWorld(page);
      await saveScreenshot(page, 'background-minimum-zoom');
      await page.locator('#dock-focus').click();
      await page.setViewportSize({ width: 844, height: 390 });
      await expect.poll(async () => ({
        width: await canvas.evaluate((element) => (element as HTMLCanvasElement).width),
        height: await canvas.evaluate((element) => (element as HTMLCanvasElement).height)
      })).toEqual({ width: 844, height: 390 });
      const landscapeSpriteScale = await expectUniformRenderScale(canvas);
      await expectCameraInsideWorld(page);
      await expectPanoramaCoversWorld(page);
      await saveScreenshot(page, 'camera-orientation-after-gestures');
      await page.setViewportSize({ width: 390, height: 844 });
      await expect.poll(async () => ({
        width: await canvas.evaluate((element) => (element as HTMLCanvasElement).width),
        height: await canvas.evaluate((element) => (element as HTMLCanvasElement).height)
      })).toEqual({ width: 390, height: 844 });
      const returnedPortraitSpriteScale = await expectUniformRenderScale(canvas);
      expect(returnedPortraitSpriteScale).toEqual(landscapeSpriteScale);
      await expectCameraInsideWorld(page);
      await expectPanoramaCoversWorld(page);
      await saveScreenshot(page, 'camera-orientation-returned-portrait');
      expect(pageErrors).toEqual([]);
      expect(consoleErrors.filter((message) => !message.includes('favicon'))).toEqual([]);
      await context.close();
    } else {
      expect(pageErrors, `page errors at ${viewport.name}`).toEqual([]);
      expect(consoleErrors.filter((message) => !message.includes('favicon')), `console errors at ${viewport.name}`).toEqual([]);
      await context.close();
    }
  }
});

test('plays through the first house, adjacent land expansion, persistence, and offline reload', async ({ browser }) => {
  test.setTimeout(26 * 60_000);
  const viewport = { width: 390, height: 844 };
  const { context, page, pageErrors, consoleErrors } = await openGame(browser, viewport);
  const readWorld = () => page.evaluate((key) => {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  }, SAVE_KEY);
  const assignRole = async (residentIndex: number, role: string) => {
    await page.locator('#dock-residents').click();
    await expect(page.locator('.resident-row')).toHaveCount((await readWorld())?.residents?.length ?? 3);
    await page.locator('.resident-row').nth(residentIndex).click();
    await page.locator('#toggle-roles').click();
    await page.locator(`[data-role="${role}"]`).click();
  };
  const assertEasternSourceAssignmentBlocked = async (residentIndex = 0) => {
    await assignRole(residentIndex, 'woodcutter');
    const sourceButton = page.locator('#wood-source-eastern');
    await expect(sourceButton).toBeVisible();
    await expect(sourceButton).toBeDisabled();
    const world = await readWorld();
    expect(world.residents[residentIndex].woodSource).toBe('home');
    await assignRole(residentIndex, 'idle');
    expect((await readWorld()).residents[residentIndex].woodSource).toBe('home');
  };

  const expansionCdp = await context.newCDPSession(page);
  await expansionCdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 2 });
  await expectEasternForestBlocked(page, expansionCdp, 'eastern-forest-blocked-before-opening');
  await assertEasternSourceAssignmentBlocked();

  await page.locator('#dock-build').click();
  await page.locator('#build-house').click();
  await expect(page.locator('#placement-banner')).toBeVisible();
  const housePlot = await screenPointForWorld(page, 690, 572);
  await page.touchscreen.tap(housePlot.x, housePlot.y);
  await expect(page.locator('#placement-banner')).toBeHidden();
  await expect.poll(async () => (await readWorld())?.sites?.length).toBe(1);
  await saveScreenshot(page, 'house-site');

  await assignRole(0, 'woodcutter');
  await assignRole(1, 'miner');
  await assignRole(2, 'builder');
  await expect.poll(async () => {
    const world = await readWorld();
    return world?.residents?.map((resident: { role: string }) => resident.role) ?? [];
  }, { timeout: 10_000 }).toEqual(['woodcutter', 'miner', 'builder']);
  await expect.poll(async () => (await readWorld())?.woodSource ?? 320, { timeout: 90_000 }).toBeLessThan(320);
  await expect.poll(async () => (await readWorld())?.stoneSource ?? 300, { timeout: 120_000 }).toBeLessThan(300);
  await expect.poll(async () => {
    const world = await readWorld();
    const site = world?.sites?.[0];
    return Boolean(site && (site.deliveredWood > 0 || site.deliveredStone > 0));
  }, { timeout: 150_000 }).toBe(true);

  await expect.poll(async () => {
    const world = await readWorld();
    return world?.buildings?.some((building: { kind: string }) => building.kind === 'house') ?? false;
  }, { timeout: 7 * 60_000 }).toBe(true);
  await expect(page.locator('#people-total')).toHaveText('4 / 4');
  await expect.poll(async () => (await readWorld())?.residents?.length).toBe(4);
  await expect.poll(async () => {
    const world = await readWorld();
    return Boolean(world?.buildings?.some((building: { kind: string }) => building.kind === 'house') &&
      world?.residents?.length === 4);
  }, { timeout: 10_000 }).toBe(true);
  await saveScreenshot(page, 'house-complete-four-residents');
  const completedWorld = await readWorld();
  expect(completedWorld).not.toBeNull();
  const fourResidentWorld = JSON.parse(JSON.stringify(completedWorld)) as typeof completedWorld;
  const fourResidentPositions = [450, 570, 1120, 1450];
  fourResidentWorld.residents.forEach((resident: (typeof fourResidentWorld.residents)[number], index: number) => {
    resident.x = fourResidentPositions[index]!;
    resident.y = 600;
    resident.role = 'idle';
    resident.mode = 'idle';
    resident.task = 'Ждёт назначения';
    resident.blockedReason = null;
    resident.cargo = null;
    resident.targetX = null;
    resident.targetY = null;
    resident.targetSiteId = null;
    resident.progress = 0;
  });
  const desktopContext = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 1,
    hasTouch: true
  });
  const desktopPage = await desktopContext.newPage();
  await desktopPage.addInitScript(({ key, world }) => {
    localStorage.setItem(key, JSON.stringify(world));
  }, { key: SAVE_KEY, world: fourResidentWorld });
  await desktopPage.goto('/');
  const desktopCanvas = desktopPage.locator('#world-scene canvas');
  await expect(desktopCanvas).toBeVisible();
  await expect(desktopPage.locator('#people-total')).toHaveText('4 / 4');
  await expect.poll(async () => Number(await desktopCanvas.getAttribute('data-camera-zoom'))).toBeGreaterThan(1);
  await expectResidentsInFrame(desktopCanvas, 4);
  await expectNoLabelOverlaps(desktopCanvas);
  await saveScreenshot(desktopPage, 'resident-house-proportions');
  await saveScreenshot(desktopPage, 'settlement-four-residents');
  await desktopContext.close();

  // A visual-only five-resident state derived from the actual completed
  // playthrough; the second house models the game's next housing reward.
  const fiveResidentWorld = JSON.parse(JSON.stringify(fourResidentWorld)) as typeof fourResidentWorld;
  fiveResidentWorld.buildings.push({ id: 'house-visual-2', kind: 'house', x: 1240, y: 600 });
  fiveResidentWorld.occupiedPlots.push(2);
  fiveResidentWorld.residents.push({
    ...fiveResidentWorld.residents[0]!,
    id: 'r5',
    name: 'Мирон',
    x: 1272,
    role: 'idle',
    mode: 'idle',
    task: 'Ждёт назначения',
    blockedReason: null,
    cargo: null,
    targetX: null,
    targetY: null,
    targetSiteId: null,
    progress: 0
  });
  const fiveContext = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 1,
    hasTouch: true
  });
  const fivePage = await fiveContext.newPage();
  await fivePage.addInitScript(({ key, world }) => {
    localStorage.setItem(key, JSON.stringify(world));
  }, { key: SAVE_KEY, world: fiveResidentWorld });
  await fivePage.goto('/');
  const fiveCanvas = fivePage.locator('#world-scene canvas');
  await expect(fiveCanvas).toBeVisible();
  await expect(fivePage.locator('#people-total')).toHaveText('5 / 5');
  await expectResidentsInFrame(fiveCanvas, 5);
  await expectNoLabelOverlaps(fiveCanvas);
  await saveScreenshot(fivePage, 'settlement-five-residents');
  await fiveContext.close();

  // Continue the same live settlement through the next territory loop using
  // only the existing in-game controls and touch interactions.
  await page.locator('#close-panel').click();
  await page.locator('#dock-focus').click();
  await panToWorldX(page, expansionCdp, 1240);
  await page.locator('#dock-build').click();
  await page.locator('#build-warehouse').click();
  await expect(page.locator('#placement-banner')).toBeVisible();
  await tapWorld(page, 1240, 572);
  await expect(page.locator('#placement-banner')).toBeHidden();
  await expect.poll(async () => {
    const world = await readWorld();
    return world?.sites?.some((site: { x: number; kind: string }) =>
      site.x === 1240 && site.kind === 'warehouse') ?? false;
  }).toBe(true);
  await assignRole(0, 'woodcutter');
  await assignRole(1, 'miner');
  await assignRole(2, 'builder');
  await expect.poll(async () => {
    const world = await readWorld();
    return world?.buildings?.some((building: { kind: string; x: number }) =>
      building.kind === 'warehouse' && building.x === 1240) ?? false;
  }, { timeout: 7 * 60_000 }).toBe(true);
  await expect(page.locator('#goal-chip')).toContainText('открой соседнюю клетку');
  await expect(page.locator('#capacity-total')).toContainText('/ 240');
  await saveScreenshot(page, 'second-warehouse-capacity-increased');

  // Continue the fresh settlement into the v0.8 cell-by-cell expansion.
  await page.locator('#close-panel').click();
  await panToWorldX(page, expansionCdp, 2380);
  await expectPanoramaCoversWorld(page);
  await saveScreenshot(page, 'v08-first-cell-closed');
  await tapWorld(page, 2380, 450);
  await expect(page.locator('#selection-title')).toHaveText('Земельная клетка 8');

  // The second warehouse used most stored resources. Keep harvesting and hauling
  // until the next cell's real unlock cost is in storage before checking it.
  await assignRole(2, 'hauler');
  await assignRole(3, 'hauler');
  await expect.poll(async () => {
    const world = await readWorld();
    return world?.stores?.reduce((sum: number, store: { wood: number }) => sum + store.wood, 0) >=
        PROTOTYPE_CONFIG.expansion.unlockCost.wood &&
      world?.stores?.reduce((sum: number, store: { stone: number }) => sum + store.stone, 0) >=
        PROTOTYPE_CONFIG.expansion.unlockCost.stone;
  }, { timeout: 6 * 60_000 }).toBe(true);

  // Stop new gathering only after the cost is available; let in-flight cargo land.
  for (const index of [0, 1, 2, 3]) await assignRole(index, 'idle');
  await expect.poll(async () => {
    const world = await readWorld();
    return world?.residents?.every((resident: { role: string; mode: string; cargo: string | null }) =>
      resident.role === 'idle' && resident.mode === 'idle' && resident.cargo === null) ?? false;
  }, { timeout: 120_000 }).toBe(true);
  if (await page.locator('#control-panel').isVisible()) await page.locator('#close-panel').click();
  await panToWorldX(page, expansionCdp, 2380);
  await expectPanoramaCoversWorld(page);
  await tapWorld(page, 2250, 350);
  await expect(page.locator('#selection-title')).toHaveText('Земельная клетка 8');

  const unlockCellButton = page.getByTestId('unlock-land-cell');
  await expect(unlockCellButton).toBeVisible();
  await expect(unlockCellButton).toBeEnabled({ timeout: 180_000 });
  await saveScreenshot(page, 'v08-first-cell-ready-to-open');
  const beforeUnlock = await readWorld();
  const storedBeforeUnlock = {
    wood: beforeUnlock.stores.reduce((sum: number, store: { wood: number }) => sum + store.wood, 0),
    stone: beforeUnlock.stores.reduce((sum: number, store: { stone: number }) => sum + store.stone, 0)
  };
  await unlockCellButton.click();
  await expect.poll(async () => {
    const world = await readWorld();
    return world?.landCells?.filter((cell: { id: number }) => cell.id >= 4)
      .map((cell: { state: string }) => cell.state) ?? [];
  }).toEqual(['unlocked', 'closed', 'closed', 'closed']);
  const afterUnlock = await readWorld();
  expect(afterUnlock.stores.reduce((sum: number, store: { wood: number }) => sum + store.wood, 0))
    .toBe(storedBeforeUnlock.wood - PROTOTYPE_CONFIG.expansion.unlockCost.wood);
  expect(afterUnlock.stores.reduce((sum: number, store: { stone: number }) => sum + store.stone, 0))
    .toBe(storedBeforeUnlock.stone - PROTOTYPE_CONFIG.expansion.unlockCost.stone);
  await saveScreenshot(page, 'v08-first-cell-open');

  const clearCellButton = page.getByTestId('clear-land-cell');
  await expect(clearCellButton).toBeVisible();
  await expect(clearCellButton).toBeEnabled();
  await clearCellButton.click();
  await expect.poll(async () => {
    const world = await readWorld();
    return world?.landCells?.find((cell: { id: number }) => cell.id === 4)?.state;
  }).toBe('clearing');
  await expect.poll(async () => {
    const world = await readWorld();
    return world?.landCells?.find((cell: { id: number }) => cell.id === 4)?.state;
  }, { timeout: 150_000 }).toBe('prepared');
  const preparedCellWorld = await readWorld();
  expect(preparedCellWorld.landCells.filter((cell: { id: number }) => cell.id >= 4)
    .map((cell: { state: string }) => cell.state)).toEqual(['prepared', 'closed', 'closed', 'closed']);
  expect(preparedCellWorld.currentGoal).toBe('unlock-eastern-sector');
  expect(preparedCellWorld.residents).toHaveLength(4);
  await expect(page.locator('#goal-chip')).toContainText('открой соседнюю клетку');
  await saveScreenshot(page, 'v08-first-cell-prepared');

  // A normal reload and an offline PWA reload must keep this exact settlement.
  const savedBeforeReload = await readWorld();
  await page.reload();
  await expect(page.locator('#world-scene canvas')).toBeVisible();
  await expect(page.locator('#people-total')).toHaveText('4 / 4');
  const restored = await readWorld();
  expect(restored.buildings.some((building: { kind: string }) => building.kind === 'house')).toBe(true);
  expect(restored.buildings.some((building: { kind: string; x: number }) =>
    building.kind === 'warehouse' && building.x === 1240)).toBe(true);
  expect(restored.landCells.filter((cell: { id: number }) => cell.id >= 4)
    .map((cell: { state: string }) => cell.state)).toEqual(['prepared', 'closed', 'closed', 'closed']);
  expect(restored.currentGoal).toBe('unlock-eastern-sector');
  expect(restored.residents).toHaveLength(4);
  expect(restored.elapsedSeconds).toBeGreaterThanOrEqual(savedBeforeReload.elapsedSeconds);
  await saveScreenshot(page, 'v08-first-cell-save-restored');

  const registration = await page.evaluate(async () => {
    const ready = await navigator.serviceWorker.ready;
    return { active: ready.active?.state ?? null, scope: ready.scope };
  });
  expect(registration.active).toBe('activated');
  await page.reload();
  await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller));
  await context.setOffline(true);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.locator('#world-scene canvas')).toBeVisible();
  await expect(page.locator('#people-total')).toHaveText('4 / 4');
  await expect(page.locator('#goal-chip')).toContainText('открой соседнюю клетку');
  const offlineRestored = await readWorld();
  expect(offlineRestored.landCells.filter((cell: { id: number }) => cell.id >= 4)
    .map((cell: { state: string }) => cell.state)).toEqual(['prepared', 'closed', 'closed', 'closed']);
  expect(offlineRestored.buildings.some((building: { kind: string; x: number }) =>
    building.kind === 'warehouse' && building.x === 1240)).toBe(true);
  await saveScreenshot(page, 'v08-first-cell-offline-reload');
  await context.setOffline(false);
  expect(pageErrors).toEqual([]);
  expect(consoleErrors.filter((message) => !message.includes('favicon'))).toEqual([]);
  await context.close();
});

test('migrates a pre-expansion browser save and reports a full warehouse through resident controls', async ({ browser }) => {
  test.setTimeout(90_000);
  const legacyWorld = createNewWorld();
  legacyWorld.buildings.push({ id: 'legacy-house', kind: 'house', x: 690, y: 600 });
  legacyWorld.occupiedPlots.push(1);
  legacyWorld.stores[0]!.wood = 8;
  legacyWorld.stores[0]!.stone = 4;
  legacyWorld.woodSource = 1;
  legacyWorld.stores[0]!.capacity = 12;
  delete legacyWorld.economyVersion;
  legacyWorld.stoneSource = 0;

  // Model a genuine pre-expansion v1 side-view save. This is fixture setup;
  // all gameplay actions below still go through the visible interface.
  const legacySave = JSON.parse(JSON.stringify(legacyWorld)) as Record<string, unknown>;
  delete legacySave.easternSector;
  delete legacySave.currentGoal;
  delete legacySave.woodSourceRecoverySeconds;
  delete legacySave.stoneSourceRecoverySeconds;
  for (const person of legacySave.residents as Array<Record<string, unknown>>) delete person.woodSource;

  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 1,
    isMobile: true,
    hasTouch: true
  });
  const page = await context.newPage();
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await page.addInitScript(({ key, save }) => {
    if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify(save));
  }, { key: SAVE_KEY, save: legacySave });
  await page.goto('/');
  await expect(page.locator('#world-scene canvas')).toBeVisible();
  const readWorld = () => page.evaluate((key) => {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  }, SAVE_KEY);
  await expect(page.locator('#people-total')).toHaveText('3 / 4');
  await expect(page.locator('#capacity-total')).toHaveText('120 / 120');
  await expect(page.locator('#goal-chip')).toContainText('увеличь вместимость');
  await expect.poll(async () => {
    const world = await readWorld();
    return world?.easternSector?.state === 'closed' &&
      world.currentGoal === 'increase-storage' &&
      world.residents?.[0]?.woodSource === 'home' &&
      Number.isFinite(world.woodSourceRecoverySeconds) &&
      Number.isFinite(world.stoneSourceRecoverySeconds);
  }).toBe(true);
  await saveScreenshot(page, 'legacy-save-migrated');

  await page.reload();
  await expect(page.locator('#people-total')).toHaveText('3 / 4');
  await expect(page.locator('#goal-chip')).toContainText('увеличь вместимость');
  const restored = await readWorld();
  expect(restored.buildings).toHaveLength(2);
  expect(restored.buildings).toEqual(expect.arrayContaining([
    { id: 'legacy-house', kind: 'house', x: 690, y: 600 },
    { id: 'warehouse:store-1', kind: 'warehouse', x: 963, y: 600 }
  ]));
  expect(restored.stores).toHaveLength(1);
  expect(restored.stores[0]).toMatchObject({ wood: 80, stone: 40, capacity: 120 });
  await saveScreenshot(page, 'legacy-save-reloaded');

  await page.locator('#dock-residents').click();
  await page.locator('.resident-row').first().click();
  await page.locator('#toggle-roles').click();
  await page.locator('[data-role="woodcutter"]').click();
  await expect.poll(async () => {
    const world = await readWorld();
    const worker = world?.residents?.[0];
    return worker?.cargo === 'wood' && worker.mode === 'blocked' &&
      worker.blockedReason?.includes('Все склады заполнены');
  }, { timeout: 45_000 }).toBe(true);
  await expect(page.locator('#resident-task')).toContainText('Ожидает свободное место на складе');
  await expect(page.locator('#capacity-total')).toHaveText('120 / 120');
  const blockedWorld = await readWorld();
  expect(blockedWorld.woodSource).toBe(0);
  expect(blockedWorld.stores[0].wood + blockedWorld.stores[0].stone).toBe(120);
  expect(blockedWorld.residents[0]).toMatchObject({ cargo: 'wood', mode: 'blocked' });
  await saveScreenshot(page, 'full-warehouse-blocked-through-ui');
  expect(pageErrors).toEqual([]);
  await context.close();
});

test('a resident standing on a plot cannot intercept building placement', async ({ browser }) => {
  const world = createNewWorld();
  world.residents[0]!.x = 1240;
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 1,
    isMobile: true,
    hasTouch: true
  });
  const page = await context.newPage();
  await page.addInitScript(({ key, save }) => {
    localStorage.setItem(key, JSON.stringify(save));
  }, { key: SAVE_KEY, save: world });
  await page.goto('/');
  const canvas = page.locator('#world-scene canvas');
  await expect(canvas).toBeVisible();
  const cdp = await context.newCDPSession(page);
  await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 2 });
  await panToWorldX(page, cdp, 1240);

  await page.locator('#dock-build').click();
  await page.locator('#build-warehouse').click();
  await expect(page.locator('#placement-banner')).toBeVisible();
  await tapWorld(page, 1240, 572);
  await expect(page.locator('#placement-banner')).toBeHidden();
  await expect.poll(async () => {
    const raw = await page.evaluate((key) => localStorage.getItem(key), SAVE_KEY);
    const saved = raw ? JSON.parse(raw) : null;
    return saved?.sites?.some((site: { x: number; kind: string }) =>
      site.x === 1240 && site.kind === 'warehouse') ?? false;
  }).toBe(true);
  await expect(page.locator('#resident-actions')).toBeHidden();
  await context.close();
});
