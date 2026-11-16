import { expect, test, type Browser, type Page } from '@playwright/test';

const SAVE_KEY = 'avanpost:gameplay-prototype:v01';
const VIEWPORTS = [
  { width: 375, height: 667, name: 'iphone-se' },
  { width: 667, height: 375, name: 'iphone-se-landscape' },
  { width: 390, height: 844, name: 'modern-iphone' },
  { width: 844, height: 390, name: 'smartphone-landscape' },
  { width: 1440, height: 900, name: 'desktop' }
] as const;

type Camera = { x: number; y: number; zoom: number };

async function openGame(browser: Browser, viewport: { width: number; height: number }) {
  const context = await browser.newContext({
    viewport,
    deviceScaleFactor: 1,
    isMobile: viewport.width < 900,
    hasTouch: true
  });
  const page = await context.newPage();
  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  await page.addInitScript((key) => localStorage.removeItem(key), SAVE_KEY);
  const assetResponses: string[] = [];
  page.on('response', (response) => {
    if (response.url().includes('/assets/peace-v2/')) {
      if (response.status() !== 200) assetResponses.push(`${response.status()} ${response.url()}`);
    }
  });
  await page.goto('/');
  const canvas = page.locator('#world-scene canvas');
  await expect(canvas).toBeVisible();
  await page.waitForFunction(() => {
    const element = document.querySelector<HTMLCanvasElement>('#world-scene canvas');
    return Boolean(element?.width && element?.height && element.dataset.cameraX && element.dataset.cameraY);
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

async function saveScreenshot(page: Page, name: string): Promise<void> {
  await page.screenshot({
    path: `apps/gameplay-prototype/test-results/screenshots/${name}.png`,
    fullPage: false,
    animations: 'disabled'
  });
}

async function drag(page: Page, from: { x: number; y: number }, to: { x: number; y: number }): Promise<void> {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 10 });
  await page.mouse.up();
}

async function mapPoint(page: Page, worldX: number, worldY: number): Promise<{ x: number; y: number }> {
  return page.locator('#world-scene canvas').evaluate((canvas, worldPoint) => {
    const rect = canvas.getBoundingClientRect();
    const zoom = Number(canvas.dataset.cameraZoom);
    return {
      x: rect.left + (worldPoint.x - Number(canvas.dataset.cameraX)) * zoom,
      y: rect.top + (worldPoint.y - Number(canvas.dataset.cameraY)) * zoom
    };
  }, { x: worldX, y: worldY });
}

test('responsive scenes, camera gestures, pinch zoom, and contextual UI', async ({ browser }) => {
  for (const viewport of VIEWPORTS) {
    const { context, page, canvas, pageErrors, consoleErrors, assetResponses } = await openGame(browser, viewport);
    await expect(page.locator('#people-total')).toHaveText('3 / 3');
    await expect.poll(() => canvas.getAttribute('data-resident-display-height')).toBe('57');
    await expect.poll(() => canvas.getAttribute('data-house-display-height')).toBe('184');
    await expect.poll(() => canvas.getAttribute('data-store-display-height')).toBe('172');
    await expect.poll(() => canvas.getAttribute('data-tree-display-height')).toBe('246');
    const metrics = await canvas.evaluate((element) => {
      const canvasElement = element as HTMLCanvasElement;
      return {
        resident: Number(canvasElement.dataset.residentDisplayHeight),
        house: Number(canvasElement.dataset.houseDisplayHeight),
        store: Number(canvasElement.dataset.storeDisplayHeight),
        tree: Number(canvasElement.dataset.treeDisplayHeight),
        width: canvasElement.width,
        height: canvasElement.height
      };
    });
    const visibleRatios = await page.evaluate(async (display) => {
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
      const alphaHeight = (image: HTMLImageElement, sx: number, sy: number, sw: number, sh: number) => {
        const scratch = document.createElement('canvas');
        scratch.width = sw;
        scratch.height = sh;
        const context = scratch.getContext('2d');
        if (!context) throw new Error('Canvas 2D context unavailable for sprite measurement');
        context.drawImage(image, sx, sy, sw, sh, 0, 0, sw, sh);
        const pixels = context.getImageData(0, 0, sw, sh).data;
        let top = sh;
        let bottom = -1;
        for (let y = 0; y < sh; y++) {
          for (let x = 0; x < sw; x++) {
            if (pixels[(y * sw + x) * 4 + 3]! > 0) {
              top = Math.min(top, y);
              bottom = Math.max(bottom, y);
            }
          }
        }
        return bottom >= top ? bottom - top + 1 : 0;
      };
      const workerHeight = alphaHeight(worker, 0, 0, 192, 224) / 224 * display.resident;
      const houseHeight = alphaHeight(house, 0, 0, 256, 256) / 256 * display.house;
      const storeHeight = alphaHeight(store, 0, 0, 256, 256) / 256 * display.store;
      const treeHeight = alphaHeight(tree, 0, 0, 256, 256) / 256 * display.tree;
      return {
        residentToHouse: workerHeight / houseHeight,
        residentToStore: workerHeight / storeHeight,
        treeTallerThanResident: treeHeight > workerHeight
      };
    }, metrics);
    expect(metrics.width).toBeGreaterThan(0);
    expect(metrics.height).toBeGreaterThan(0);
    expect(visibleRatios.residentToHouse).toBeGreaterThanOrEqual(0.45);
    expect(visibleRatios.residentToHouse).toBeLessThanOrEqual(0.6);
    expect(visibleRatios.residentToStore).toBeGreaterThan(0.5);
    expect(visibleRatios.treeTallerThanResident).toBe(true);
    expect(metrics.resident).toBeLessThan(metrics.store);
    expect(metrics.tree).toBeGreaterThan(metrics.resident);
    await expect(page.locator('#dock-focus')).toBeVisible();
    await expect(page.locator('.goal-chip')).toBeVisible();
    await saveScreenshot(page, `start-${viewport.name}`);
    expect(assetResponses, `asset HTTP errors at ${viewport.name}`).toEqual([]);

    if (viewport.name === 'modern-iphone') {
      const box = await canvas.boundingBox();
      expect(box).not.toBeNull();
      const center = { x: Math.round(box!.width / 2), y: Math.round(box!.height * 0.52) };
      const initial = await cameraState(page);
      await saveScreenshot(page, 'camera-before-pan');

      const pans = [
        { name: 'up', to: { x: center.x, y: center.y - 100 }, axis: 'y', sign: 1 },
        { name: 'down', to: { x: center.x, y: center.y + 100 }, axis: 'y', sign: -1 },
        { name: 'left', to: { x: center.x - 100, y: center.y }, axis: 'x', sign: 1 },
        { name: 'right', to: { x: center.x + 100, y: center.y }, axis: 'x', sign: -1 },
        { name: 'diagonal', to: { x: center.x - 80, y: center.y - 80 }, axis: 'both', sign: 1 }
      ] as const;
      let before = initial;
      for (const pan of pans) {
        const from = pan.name === 'diagonal'
          ? { x: center.x, y: center.y }
          : { x: center.x, y: center.y };
        await drag(page, from, pan.to);
        const after = await cameraState(page);
        if (pan.axis === 'x' || pan.axis === 'both') {
          expect(after.x * pan.sign).toBeGreaterThan(before.x * pan.sign);
        } else {
          expect(after.y * pan.sign).toBeGreaterThan(before.y * pan.sign);
        }
        if (pan.axis === 'both') {
          expect(after.x).not.toBe(before.x);
          expect(after.y).not.toBe(before.y);
        }
        await saveScreenshot(page, `camera-${pan.name}`);
        before = after;
      }

      const cdp = await context.newCDPSession(page);
      await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 2 });
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
      await saveScreenshot(page, 'camera-zoom-out');

      await page.locator('#dock-residents').click();
      await expect(page.locator('#control-panel')).toBeVisible();
      const zoomBeforeSelection = (await cameraState(page)).zoom;
      await page.locator('.resident-row').first().click();
      await expect(page.locator('#resident-actions')).toBeVisible();
      expect((await cameraState(page)).zoom).toBeCloseTo(zoomBeforeSelection, 2);
      await saveScreenshot(page, 'context-selected-resident');
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
      const panFrom = { x: Math.round(box!.width * 0.82), y: Math.round(box!.height * 0.42) };
      await drag(page, panFrom, { x: panFrom.x, y: panFrom.y - 40 });
      await expect(page.locator('#control-panel')).toBeVisible();
      await page.locator('#close-panel').click();
      await expect(page.locator('#control-panel')).toBeHidden();
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

test('plays through resource collection, house construction, persistence, and offline reload', async ({ browser }) => {
  test.setTimeout(14 * 60_000);
  const viewport = { width: 390, height: 844 };
  const { context, page, pageErrors, consoleErrors } = await openGame(browser, viewport);
  const readWorld = () => page.evaluate((key) => {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  }, SAVE_KEY);
  const assignRole = async (residentIndex: number, role: string) => {
    await page.locator('#dock-residents').click();
    await expect(page.locator('.resident-row')).toHaveCount(3);
    await page.locator('.resident-row').nth(residentIndex).click();
    await page.locator('#toggle-roles').click();
    await page.locator(`[data-role="${role}"]`).click();
  };

  await page.locator('#dock-build').click();
  await page.locator('#build-house').click();
  await expect(page.locator('#placement-banner')).toBeVisible();
  const housePlot = await mapPoint(page, 638, 1050);
  await page.mouse.click(housePlot.x, housePlot.y);
  await expect(page.locator('#placement-banner')).toBeHidden();
  await expect.poll(async () => (await readWorld())?.sites?.length).toBe(1);
  await saveScreenshot(page, 'house-site');

  await assignRole(0, 'woodcutter');
  await assignRole(1, 'miner');
  await assignRole(2, 'builder');
  const initialWorld = await readWorld();
  expect(initialWorld.residents.map((resident: { role: string }) => resident.role)).toEqual([
    'woodcutter', 'miner', 'builder'
  ]);
  await expect.poll(async () => (await readWorld())?.woodSource ?? 32, { timeout: 90_000 }).toBeLessThan(32);
  await expect.poll(async () => (await readWorld())?.stoneSource ?? 30, { timeout: 120_000 }).toBeLessThan(30);
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
  await saveScreenshot(page, 'house-complete-four-residents');

  await page.reload();
  await expect(page.locator('#world-scene canvas')).toBeVisible();
  await expect(page.locator('#people-total')).toHaveText('4 / 4');
  const restored = await readWorld();
  expect(restored.buildings.some((building: { kind: string }) => building.kind === 'house')).toBe(true);
  expect(restored.residents).toHaveLength(4);
  await saveScreenshot(page, 'save-restored');

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
  await expect(page.locator('#goal-chip')).toBeVisible();
  await saveScreenshot(page, 'offline-reload');
  await context.setOffline(false);

  expect(pageErrors).toEqual([]);
  expect(consoleErrors.filter((message) => !message.includes('favicon'))).toEqual([]);
  await context.close();
});
