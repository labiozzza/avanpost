import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test, type Browser, type Page } from '@playwright/test';
import { createNewWorld, WORLD, type PrototypeWorld } from '../src/simulation.js';

const SAVE_KEY = 'avanpost:gameplay-prototype:v01';
const DEFAULT_EVIDENCE_DIR = fileURLToPath(new URL('../../../docs/gameplay-prototype-v0.1/evidence-v0.9/', import.meta.url));
const EVIDENCE_DIR = resolve(process.env.PLAYWRIGHT_EVIDENCE_DIR ?? DEFAULT_EVIDENCE_DIR);

function demolitionWorld(): PrototypeWorld {
  const world = createNewWorld();
  world.buildings.push({ id: 'playtest-first-house', kind: 'house', x: 690, y: WORLD.groundY });
  world.occupiedPlots.push(1, 2);
  world.buildings.push({ id: 'warehouse:store-2', kind: 'warehouse', x: 1240, y: WORLD.groundY });
  world.stores[0]!.wood = 4;
  world.stores[0]!.stone = 3;
  world.stores.push({
    id: 'store-2', buildingId: 'warehouse:store-2', x: 1240, wood: 0, stone: 0, capacity: 12
  });
  return world;
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
        response.status() !== 200 && response.status() !== 304) {
      failedAssets.push(`${response.status()} ${response.url()}`);
    }
  });
  await page.addInitScript(({ key, save }) => {
    if (sessionStorage.getItem('__avanpost_v09_fixture_seeded') === '1') return;
    localStorage.setItem(key, JSON.stringify(save));
    sessionStorage.setItem('__avanpost_v09_fixture_seeded', '1');
  }, {
    key: SAVE_KEY, save: world
  });
  await page.goto('/');
  const canvas = page.locator('#world-scene canvas');
  await expect(canvas).toBeVisible();
  await page.waitForFunction(() => Boolean(
    document.querySelector<HTMLCanvasElement>('#world-scene canvas')?.dataset.structureGrounding
  ));
  await expect(page.locator('#toast.visible')).toBeHidden({ timeout: 10_000 });
  const readWorld = () => page.evaluate((key) => {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) as PrototypeWorld : null;
  }, SAVE_KEY);
  return { context, page, canvas, readWorld, errors, failedAssets };
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

async function tapWorld(page: Page, worldX: number, worldY: number): Promise<void> {
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

async function saveScreenshot(page: Page, name: string): Promise<void> {
  mkdirSync(EVIDENCE_DIR, { recursive: true });
  await page.screenshot({ path: resolve(EVIDENCE_DIR, `${name}.png`), animations: 'disabled' });
}

function resourceLedger(world: PrototypeWorld, resource: 'wood' | 'stone'): number {
  return world.stores.reduce((sum, store) => sum + store[resource], 0) +
    world.stockpiles.filter((pile) => pile.resource === resource).reduce((sum, pile) => sum + pile.amount, 0) +
    world.residents.filter((resident) => resident.cargo === resource)
      .reduce((sum, resident) => sum + resident.cargoAmount, 0);
}

async function selectBuilding(page: Page, worldX: number): Promise<void> {
  await panTo(page, worldX);
  await tapWorld(page, worldX, WORLD.groundY - 100);
  await expect(page.locator('#control-panel')).toBeVisible();
  await expect(page.locator('#world-actions')).toBeVisible();
}

async function assignResidentRole(page: Page, residentIndex: number, role: 'builder' | 'hauler'): Promise<void> {
  await page.locator('#dock-residents').click();
  await expect(page.locator('#resident-list-section')).toBeVisible();
  await page.locator('.resident-row').nth(residentIndex).click();
  await expect(page.locator('#resident-actions')).toBeVisible();
  await page.locator('#toggle-roles').click();
  await page.locator(`[data-role="${role}"]`).click();
  await expect(page.locator(`.role-button[data-role="${role}"]`)).toHaveClass(/active/);
  await page.locator('#close-panel').click();
}

test('anchors houses and warehouses to ground at portrait, landscape, and desktop sizes', async ({ browser }) => {
  test.setTimeout(120_000);
  const layouts = [
    { width: 390, height: 844, targetX: 827, name: 'v09-layout-390x844' },
    { width: 844, height: 390, targetX: 827, name: 'v09-layout-844x390' },
    { width: 1440, height: 900, targetX: 827, name: 'v09-layout-1440x900' }
  ] as const;

  for (const layout of layouts) {
    const result = await openSavedGame(browser, demolitionWorld(), {
      width: layout.width, height: layout.height
    });
    await panTo(result.page, layout.targetX);
    const grounding = await result.canvas.evaluate((element) =>
      JSON.parse((element as HTMLCanvasElement).dataset.structureGrounding ?? '[]') as Array<{
        id: string; kind: string; x: number; groundY: number; visibleBottomY: number;
      }>
    );
    expect(grounding).toHaveLength(3);
    expect(grounding.map(({ kind }) => kind).sort()).toEqual(['house', 'warehouse', 'warehouse']);
    for (const structure of grounding) {
      expect(structure.visibleBottomY, `${structure.kind} at x=${structure.x}`).toBeCloseTo(WORLD.groundY, 5);
    }
    await saveScreenshot(result.page, layout.name);

    const beforeReload = await result.readWorld();
    await result.page.reload();
    await expect(result.canvas).toBeVisible();
    const afterReload = await result.readWorld();
    expect(afterReload?.buildings.map(({ id, x }) => [id, x])).toEqual(
      beforeReload?.buildings.map(({ id, x }) => [id, x])
    );
    expect(result.errors, layout.name).toEqual([]);
    expect(result.failedAssets, layout.name).toEqual([]);
    await result.context.close();
  }
});

test('confirms, cancels, completes demolition, physically hauls the refund, and reuses the plot', async ({ browser }) => {
  test.setTimeout(240_000);
  const result = await openSavedGame(browser, demolitionWorld());
  const { page, canvas, context, readWorld } = result;
  const buildingId = 'warehouse:store-2';

  await assignResidentRole(page, 0, 'builder');
  await selectBuilding(page, 1240);
  await expect(page.locator('[data-testid="start-demolition"]')).toBeVisible();
  await saveScreenshot(page, 'v09-building-card-demolition-action');
  await page.locator('[data-testid="start-demolition"]').click();
  const confirmation = page.locator('#demolition-dialog');
  await expect(confirmation).toBeVisible();
  await expect(page.locator('#demolition-confirm-details')).toContainText('Склад');
  await expect(page.locator('#demolition-confirm-details')).toContainText('15 секунд');
  await expect(page.locator('#demolition-confirm-details')).toContainText('2 дерева');
  await expect(page.locator('#demolition-confirm-details')).toContainText('2 камня');
  expect((await readWorld())?.buildings.find(({ id }) => id === buildingId)?.demolition).toBeUndefined();
  await saveScreenshot(page, 'v09-demolition-confirmation');
  await page.locator('#cancel-demolition-confirm').click();
  await expect(confirmation).toBeHidden();
  expect((await readWorld())?.buildings.find(({ id }) => id === buildingId)?.demolition).toBeUndefined();

  if (await page.locator('#control-panel').isVisible()) await page.locator('#close-panel').click();
  await selectBuilding(page, 1240);
  await page.locator('[data-testid="start-demolition"]').click();
  await page.locator('#confirm-demolition').click();
  await expect.poll(async () => (await readWorld())?.buildings.find(({ id }) => id === buildingId)?.demolition?.workerId)
    .toBe('r1');
  await expect.poll(async () => (await readWorld())?.residents.find(({ id }) => id === 'r1')?.x ?? 0)
    .toBeGreaterThan(640);
  const enRoute = await readWorld();
  expect(enRoute?.residents.find(({ id }) => id === 'r1')).toMatchObject({ role: 'builder', mode: 'moving' });
  await saveScreenshot(page, 'v09-demolition-builder-en-route');

  await expect.poll(async () => {
    const saved = await readWorld();
    return saved?.residents.find(({ id }) => id === 'r1')?.mode;
  }, { timeout: 15_000 }).toBe('building');
  await expect.poll(async () =>
    (await readWorld())?.buildings.find(({ id }) => id === buildingId)?.demolition?.progress ?? 0
  ).toBeGreaterThan(0.2);
  await saveScreenshot(page, 'v09-demolition-progress');

  await expect.poll(async () => (await readWorld())?.buildings.some(({ id }) => id === buildingId), {
    timeout: 40_000
  }).toBe(false);
  const dismantled = await readWorld();
  expect(dismantled?.occupiedPlots).not.toContain(2);
  expect(dismantled?.landCells.find(({ id }) => id === 2)?.state).toBe('prepared');
  expect(dismantled?.stockpiles.filter(({ sourceId }) => sourceId === 'demolition')).toMatchObject([
    { resource: 'wood', x: 1240 },
    { resource: 'stone', x: 1240 }
  ]);
  expect(dismantled).not.toBeNull();
  expect(resourceLedger(dismantled!, 'wood')).toBe(6);
  expect(resourceLedger(dismantled!, 'stone')).toBe(5);
  await expect.poll(async () => {
    const saved = await readWorld();
    return saved?.residents.find(({ id }) => id === 'r1')?.cargo ?? null;
  }, { timeout: 5_000 }).not.toBeNull();
  await saveScreenshot(page, 'v09-builder-carries-returned-material');
  await panTo(page, 1240);
  await saveScreenshot(page, 'v09-returned-materials-at-site');

  await page.reload();
  await expect(canvas).toBeVisible();
  const restored = await readWorld();
  expect(restored?.buildings.some(({ id }) => id === buildingId)).toBe(false);
  expect(restored?.stockpiles.filter(({ sourceId }) => sourceId === 'demolition')).toMatchObject([
    { resource: 'wood', x: 1240 },
    { resource: 'stone', x: 1240 }
  ]);
  expect(restored).not.toBeNull();
  expect(resourceLedger(restored!, 'wood')).toBe(6);
  expect(resourceLedger(restored!, 'stone')).toBe(5);
  const activeServiceWorker = await page.evaluate(async () =>
    (await navigator.serviceWorker.getRegistrations()).some((registration) => registration.active?.state === 'activated')
  );
  expect(activeServiceWorker || !process.env.CI, 'production Playwright run must activate the PWA Service Worker')
    .toBe(true);
  if (activeServiceWorker) {
    const registration = await page.evaluate(async () => {
      const ready = await navigator.serviceWorker.ready;
      return { active: ready.active?.state ?? null };
    });
    expect(registration.active).toBe('activated');
    await page.reload();
    await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller));
    await context.setOffline(true);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(canvas).toBeVisible();
    const offlineRestored = await readWorld();
    expect(offlineRestored?.stockpiles.filter(({ sourceId }) => sourceId === 'demolition')).toMatchObject([
      { resource: 'wood', x: 1240 },
      { resource: 'stone', x: 1240 }
    ]);
    expect(offlineRestored).not.toBeNull();
    expect(resourceLedger(offlineRestored!, 'wood')).toBe(6);
    expect(resourceLedger(offlineRestored!, 'stone')).toBe(5);
    await context.setOffline(false);
  }

  await expect.poll(async () => {
    const saved = await readWorld();
    const store = saved?.stores.find(({ id }) => id === 'store-1');
    return store ? [store.wood, store.stone] : [];
  }, { timeout: 40_000 }).toEqual([6, 5]);
  await expect.poll(async () => {
    const saved = await readWorld();
    return saved?.stockpiles.filter(({ sourceId }) => sourceId === 'demolition').map(({ amount }) => amount);
  }, { timeout: 40_000 }).toEqual([0, 0]);
  const delivered = await readWorld();
  expect(delivered?.stockpiles.filter(({ sourceId }) => sourceId === 'demolition').map(({ amount }) => amount))
    .toEqual([0, 0]);
  expect(delivered).not.toBeNull();
  expect(resourceLedger(delivered!, 'wood')).toBe(6);
  expect(resourceLedger(delivered!, 'stone')).toBe(5);
  await saveScreenshot(page, 'v09-refund-delivered-to-warehouse');

  await page.locator('#dock-build').click();
  await page.locator('#build-house').click();
  await expect(page.locator('#placement-banner')).toBeVisible();
  await panTo(page, 1240);
  await tapWorld(page, 1240, WORLD.groundY);
  await expect(page.locator('#placement-banner')).toBeHidden();
  await expect.poll(async () => (await readWorld())?.sites.some((site) => site.kind === 'house' && site.x === 1240))
    .toBe(true);
  await expect.poll(async () => (await readWorld())?.buildings.some((building) =>
    building.kind === 'house' && building.x === 1240
  ), { timeout: 90_000 }).toBe(true);
  const rebuilt = await readWorld();
  expect(rebuilt?.buildings.some(({ kind, x }) => kind === 'warehouse' && x === 1240)).toBe(false);
  expect(rebuilt?.occupiedPlots).toContain(2);
  expect(rebuilt?.stores).toHaveLength(1);
  await saveScreenshot(page, 'v09-new-house-reuses-demolished-plot');
  await page.reload();
  await expect(canvas).toBeVisible();
  expect((await readWorld())?.buildings.some(({ kind, x }) => kind === 'house' && x === 1240)).toBe(true);

  expect(result.errors).toEqual([]);
  expect(result.failedAssets).toEqual([]);
  await context.close();
});
