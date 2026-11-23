import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { test, expect, type Page } from '@playwright/test';
import { LAND_GRID_CELLS } from '../src/land-grid.js';
import { createNewWorld, STORAGE_KEY, WORLD, type PrototypeWorld } from '../src/simulation.js';

const evidence = resolve(process.env.PLAYWRIGHT_EVIDENCE_DIR ?? 'docs/gameplay-prototype-v0.1/evidence-production', 'production-fixes');
const SECOND_WAREHOUSE_X = LAND_GRID_CELLS.find((cell) => cell.id === 2)!.centerX;
const FIRST_EASTERN_CELL = LAND_GRID_CELLS.find((cell) => cell.id === 4)!;
async function capture(page: Page, name: string) {
  mkdirSync(evidence, { recursive: true }); await page.screenshot({ path: resolve(evidence, `${name}.png`) });
}
async function setEvidenceZoom(page: Page, zoom: number): Promise<void> {
  const canvas = page.locator('canvas');
  const bounds = await canvas.boundingBox();
  if (!bounds) throw new Error('Game canvas has no visible bounds.');
  const current = Number(await canvas.getAttribute('data-camera-zoom'));
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 2 });
  const center = { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
  const halfDistance = 90;
  const factor = zoom / current;
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchStart', touchPoints: [
      { id: 1, x: center.x - halfDistance, y: center.y },
      { id: 2, x: center.x + halfDistance, y: center.y }
    ]
  });
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchMove', touchPoints: [
      { id: 1, x: center.x - halfDistance * factor, y: center.y },
      { id: 2, x: center.x + halfDistance * factor, y: center.y }
    ]
  });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await cdp.detach();
  await expect.poll(async () => Number(await canvas.getAttribute('data-camera-zoom'))).toBeCloseTo(zoom, 2);
}
async function world(page: Page): Promise<PrototypeWorld> {
  return page.evaluate((key) => JSON.parse(localStorage.getItem(key)!), STORAGE_KEY);
}
async function role(page: Page, index: number, value: string) {
  await page.locator('#dock-residents').click(); await page.locator('.resident-row').nth(index).click();
  await page.locator('#toggle-roles').click(); await page.locator(`[data-role="${value}"]`).click();
  await page.locator('#close-panel').click();
}
async function pan(page: Page, target: number) {
  const canvas = page.locator('canvas');
  for (let attempt = 0; attempt < 12; attempt++) {
    const view = JSON.parse((await canvas.getAttribute('data-world-view'))!) as { x: number; width: number };
    if (target > view.x + 170 && target < view.x + view.width - 170) return;
    const box = (await canvas.boundingBox())!;
    const distance = Math.max(-box.width * 0.55, Math.min(box.width * 0.55,
      (target - view.x - view.width / 2) * box.width / view.width));
    const start = distance > 0 ? box.width * 0.8 : box.width * 0.2;
    await page.mouse.move(start, box.height * 0.35); await page.mouse.down();
    await page.mouse.move(start - distance, box.height * 0.35, { steps: 12 }); await page.mouse.up();
  }
}
async function tap(page: Page, x: number, y = 570) {
  await pan(page, x);
  const canvas = page.locator('canvas');
  const point = await canvas.evaluate((element, p) => {
    const c = element as HTMLCanvasElement, b = c.getBoundingClientRect(), v = JSON.parse(c.dataset.worldView!);
    return { x: (p.x - v.x) * b.width / v.width, y: (p.y - v.y) * b.height / v.height };
  }, { x, y });
  await canvas.click({ position: point });
}
async function background(page: Page, seconds: number) {
  const before = (await world(page)).elapsedSeconds;
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
  expect((await world(page)).elapsedSeconds - before).toBeGreaterThanOrEqual(seconds - 0.2);
}

test('owner playtest: full store, partial construction, ten-minute return, new warehouse, clearing and cell grid', async ({ page, browser }, info) => {
  test.setTimeout(8 * 60_000);
  const errors: string[] = []; page.on('pageerror', (e) => errors.push(e.message));
  await page.setViewportSize({ width: 1440, height: 900 }); await page.goto('/');
  await expect(page.locator('canvas')).toBeVisible();
  await role(page, 0, 'woodcutter'); await role(page, 1, 'miner'); await role(page, 2, 'hauler');
  await expect.poll(async () => (await world(page)).stores[0]!.wood + (await world(page)).stores[0]!.stone,
    { timeout: 240_000 }).toBe(120);
  await expect.poll(async () => (await world(page)).stockpiles.slice(0, 2).map((p) => p.amount),
    { timeout: 35_000 }).toEqual([10, 10]);
  expect((await world(page)).residents.every((p) => p.cargo === null)).toBe(true);
  await capture(page, 'production-full-store-local-piles');
  await role(page, 0, 'builder');
  await page.locator('#dock-build').click(); await page.locator('#build-house').click(); await tap(page, 690);
  await expect(page.locator('#selection-title')).toHaveText('Предпросмотр: дом');
  await expect(page.locator('#confirm-placement')).toBeEnabled();
  await page.locator('#confirm-placement').click();
  await expect.poll(async () => {
    const w = await world(page), s = w.sites[0];
    return Boolean(s && s.progress > 0 && s.deliveredWood + s.deliveredStone < 110 &&
      w.residents.some((p) => p.role === 'hauler' && p.targetSiteId === s.id));
  }, { timeout: 45_000, intervals: [100, 200, 500] }).toBe(true);
  await page.locator('#dock-build').click();
  await expect(page.locator('#building-list')).toBeVisible();
  await expect(page.locator('#building-list')).toContainText('Материалы:');
  await expect(page.locator('#building-list')).toContainText('Строительство:');
  await capture(page, 'production-partial-materials-building');
  await page.locator('#close-panel').click();
  await background(page, 600);
  await expect(page.locator('#people-total')).toHaveText('4 / 4');
  await expect(page.locator('#absence-report')).toContainText('дом');
  await capture(page, 'production-return-after-ten-minutes');

  await role(page, 3, 'woodcutter'); await role(page, 1, 'idle');
  await pan(page, SECOND_WAREHOUSE_X); await page.locator('#dock-build').click();
  await page.locator('#build-warehouse').click(); await tap(page, SECOND_WAREHOUSE_X);
  await expect(page.locator('#selection-title')).toHaveText('Предпросмотр: склад');
  await expect(page.locator('#confirm-placement')).toBeEnabled();
  await page.locator('#confirm-placement').click();
  await expect.poll(async () => (await world(page)).sites.some((site) => site.kind === 'warehouse'))
    .toBe(true);
  await background(page, 600);
  expect((await world(page)).stores).toHaveLength(2);
  expect((await world(page)).stores.reduce((s, p) => s + p.wood, 0)).toBeGreaterThanOrEqual(80);
  expect((await world(page)).stores.reduce((s, p) => s + p.stone, 0)).toBeGreaterThanOrEqual(50);

  await page.locator('#grid-button').click(); await tap(page, FIRST_EASTERN_CELL.centerX, 450);
  await expect(page.locator('#selection-title')).toHaveText(`Земельная клетка ${FIRST_EASTERN_CELL.number}`);
  await page.locator('[data-testid="unlock-land-cell"]').click();
  await page.locator('[data-testid="clear-land-cell"]').click();
  await page.locator('#close-panel').click(); await background(page, 60);
  expect((await world(page)).landCells.find((cell) => cell.id === FIRST_EASTERN_CELL.id)!.state).toBe('prepared');
  const layers = JSON.parse((await page.locator('canvas').getAttribute('data-eastern-art-layers'))!);
  expect(layers.find((layer: { cellId: number }) => layer.cellId === 4))
    .toEqual({ cellId: 4, trees: false, understory: false, ground: false });
  expect(layers.find((layer: { cellId: number }) => layer.cellId === 5))
    .toEqual({ cellId: 5, trees: true, understory: true, ground: true });
  await capture(page, 'production-prepared-cell-grid');
  await tap(page, FIRST_EASTERN_CELL.centerX, 450); await expect(page.locator('#selection-detail')).toContainText(/подготов|расчищ/i);
  await page.locator('[data-testid="build-on-land-cell"]').click();
  await page.locator('#build-house').click(); await tap(page, FIRST_EASTERN_CELL.centerX);
  await expect(page.locator('#selection-title')).toHaveText('Предпросмотр: дом');
  await expect(page.locator('#confirm-placement')).toBeEnabled();
  await page.locator('#confirm-placement').click();
  await expect.poll(async () => (await world(page)).sites.some((site) => site.x === FIRST_EASTERN_CELL.centerX)).toBe(true);
  const preserved = (await world(page)).sites[0]!.id;
  await page.reload(); await expect(page.locator('#grid-button')).toHaveAttribute('aria-pressed', 'true');
  expect((await world(page)).sites[0]!.id).toBe(preserved);
  await role(page, 1, 'miner'); await background(page, 600);
  expect((await world(page)).residents).toHaveLength(5);
  const result = await world(page);
  await info.attach('owner-settlement', { body: JSON.stringify(result, null, 2), contentType: 'application/json' });
  const gridGeometry = async (targetPage: Page) => targetPage.locator('canvas').evaluate((element) => JSON.parse(
    (element as HTMLCanvasElement).dataset.gridCells ?? '[]'
  ).map((cell: { id: number; left: number; right: number; centerX: number; width: number }) => ({
    id: cell.id, left: cell.left, right: cell.right, centerX: cell.centerX, width: cell.width
  })));
  const desktopGridGeometry = await gridGeometry(page);
  const gridViewports = [
    { width: 1366, height: 768, name: 'desktop-1366x768' },
    { width: 390, height: 844, name: 'portrait-390x844' },
    { width: 844, height: 390, name: 'landscape-844x390' }
  ] as const;
  for (const viewport of gridViewports) {
    const gridContext = await browser.newContext({ viewport, deviceScaleFactor: 1, hasTouch: true });
    const gridPage = await gridContext.newPage();
    await gridPage.addInitScript(({ key, saved }) => localStorage.setItem(key, JSON.stringify(saved)),
      { key: STORAGE_KEY, saved: result });
    await gridPage.goto('/');
    const canvas = gridPage.locator('canvas');
    await expect(canvas).toBeVisible();
    await gridPage.locator('#grid-button').click();
    await setEvidenceZoom(gridPage, 0.65);
    await expect.poll(() => gridGeometry(gridPage)).toEqual(desktopGridGeometry);
    await expect.poll(async () => Number(await canvas.getAttribute('data-camera-zoom'))).toBeCloseTo(0.65, 2);
    await pan(gridPage, FIRST_EASTERN_CELL.centerX);
    await capture(gridPage, `road-grid-${viewport.name}`);
    expect(await gridPage.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await gridContext.close();
  }
  expect(errors).toEqual([]);
});

test('PWA close and reopen: the funded warehouse at 47% completes offline and reload is idempotent', async ({ page, context }) => {
  const sim = createNewWorld();
  sim.sites.push({ id: 'warehouse-47', kind: 'warehouse', x: 690, y: WORLD.groundY,
    deliveredWood: 50, deliveredStone: 40, progress: 0.47, stage: 1 });
  sim.occupiedPlots.push(1); sim.residents[2]!.role = 'builder';
  await page.addInitScript(({ key, sim }) => { if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify(sim)); },
    { key: STORAGE_KEY, sim });
  await page.goto('/'); await expect(page.locator('canvas')).toBeVisible();
  await page.evaluate(async () => { await navigator.serviceWorker.ready; }); await page.reload();
  await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller));
  expect((await world(page)).sites[0]!.progress).toBeGreaterThanOrEqual(0.47);
  const before = await page.evaluate(() => Date.now());
  await page.close(); await context.setOffline(true);
  const reopened = await context.newPage(); await reopened.clock.setSystemTime(before + 600_000);
  await reopened.goto('/'); await expect(reopened.locator('canvas')).toBeVisible();
  await expect(reopened.locator('#catchup-status')).toBeHidden();
  expect((await world(reopened)).stores).toHaveLength(2);
  const elapsed = (await world(reopened)).elapsedSeconds;
  await capture(reopened, 'production-pwa-warehouse-47-offline');
  await reopened.reload(); await expect(reopened.locator('canvas')).toBeVisible();
  expect((await world(reopened)).elapsedSeconds - elapsed).toBeLessThan(10);
  expect((await world(reopened)).stores).toHaveLength(2);
  await context.setOffline(false);
});

test('stone uses clean frames and rock artwork, with selectable piles in their source areas', async ({ page }) => {
  const w = createNewWorld();
  Object.assign(w.residents[0]!, { role: 'hauler', x: 350, cargo: 'stone', cargoAmount: 10,
    mode: 'carrying', targetStoreId: 'store-1', targetX: 963, targetY: WORLD.groundY });
  Object.assign(w.residents[1]!, { role: 'hauler', x: 1450, cargo: 'wood', cargoAmount: 10,
    mode: 'carrying', targetStoreId: 'store-1', targetX: 963, targetY: WORLD.groundY });
  w.stockpiles[1]!.amount = 10;
  await page.addInitScript(({ key, w }) => localStorage.setItem(key, JSON.stringify(w)), { key: STORAGE_KEY, w });
  await page.setViewportSize({ width: 1440, height: 900 }); await page.goto('/');
  await expect(page.locator('canvas')).toBeVisible();
  await page.clock.install();
  // Leave room for the browser round trip between reading and pausing; 50 ms
  // could already be in the past on a busy run.
  await page.clock.pauseAt((await page.evaluate(() => Date.now())) + 1_000);
  const seen = new Set<number>();
  for (let sample = 0; sample < 12; sample++) {
    const art = JSON.parse((await page.locator('canvas').getAttribute('data-cargo-art'))!);
    const stone = art.find((p: { id: string }) => p.id === 'r1');
    expect(stone).toMatchObject({ animation: 'walking', stoneVisible: true, texture: 'stone-outcrop' });
    expect([3, 4, 5, 6]).toContain(stone.frame); seen.add(stone.frame);
    if (sample === 3) await capture(page, 'production-stone-and-wood-carried');
    await page.clock.runFor(100);
  }
  expect(seen.size).toBeGreaterThanOrEqual(3);
  await page.clock.resume();
  await pan(page, 1810); await tap(page, 1810, 585);
  await expect(page.locator('#selection-detail')).toContainText('камень');
  await expect(page.locator('#selection-detail')).toContainText('10');
  await capture(page, 'production-stone-pile-by-outcrop');
});
