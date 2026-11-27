import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { LAND_GRID_CELLS, LAND_GRID_CONFIG, footprintCenterX } from '../src/land-grid.js';
import {
  createNewWorld, mineStockpileSourceId, PROTOTYPE_CONFIG, STORAGE_KEY, WORLD,
  type PrototypeWorld
} from '../src/simulation.js';

const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://127.0.0.1:4176';
const evidenceRoot = resolve(process.env.PLAYWRIGHT_EVIDENCE_DIR ??
  'docs/gameplay-prototype-v0.1/evidence-drag-demolition-mine');

type Point = { x: number; y: number };
type WorldView = { x: number; y: number; width: number; height: number };
type CdpSession = Awaited<ReturnType<ReturnType<Page['context']>['newCDPSession']>>;

async function readWorld(page: Page): Promise<PrototypeWorld> {
  return page.evaluate((key) => JSON.parse(localStorage.getItem(key)!) as PrototypeWorld, STORAGE_KEY);
}

async function saveEvidence(page: Page, name: string): Promise<void> {
  mkdirSync(evidenceRoot, { recursive: true });
  await page.screenshot({ path: resolve(evidenceRoot, `${name}.png`), animations: 'disabled' });
}

async function worldToScreen(page: Page, point: Point): Promise<Point> {
  return page.locator('#world-scene canvas').evaluate((element, target) => {
    const canvas = element as HTMLCanvasElement;
    const bounds = canvas.getBoundingClientRect();
    const view = JSON.parse(canvas.dataset.worldView ?? '{}') as WorldView;
    return {
      x: bounds.left + (target.x - view.x) * bounds.width / view.width,
      y: bounds.top + (target.y - view.y) * bounds.height / view.height
    };
  }, point);
}

async function canvasView(page: Page): Promise<WorldView> {
  return page.locator('#world-scene canvas').evaluate((element) =>
    JSON.parse((element as HTMLCanvasElement).dataset.worldView ?? '{}') as WorldView);
}

async function touchSwipe(page: Page, from: Point, to: Point, steps = 10): Promise<void> {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ id: 1, ...from }] });
  for (let step = 1; step <= steps; step += 1) {
    const progress = step / steps;
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{
      id: 1, x: from.x + (to.x - from.x) * progress, y: from.y + (to.y - from.y) * progress
    }] });
    await page.waitForTimeout(16);
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await cdp.detach();
}

async function panTo(page: Page, worldX: number): Promise<void> {
  const canvas = page.locator('#world-scene canvas');
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const view = await canvasView(page);
    if (worldX > view.x + 170 && worldX < view.x + view.width - 170) return;
    const bounds = (await canvas.boundingBox())!;
    const delta = (worldX - view.x - view.width / 2) * bounds.width / view.width;
    const distance = Math.max(-bounds.width * 0.55, Math.min(bounds.width * 0.55, delta));
    const startX = bounds.x + (distance > 0 ? bounds.width * 0.8 : bounds.width * 0.2);
    const y = bounds.y + bounds.height * 0.43;
    await touchSwipe(page, { x: startX, y }, { x: startX - distance, y });
  }
  const view = await canvasView(page);
  expect(worldX).toBeGreaterThan(view.x - 170);
  expect(worldX).toBeLessThan(view.x + view.width + 170);
}

async function tapWorld(page: Page, worldX: number, worldY = WORLD.groundY): Promise<void> {
  await panTo(page, worldX);
  const point = await worldToScreen(page, { x: worldX, y: worldY });
  const canvas = page.locator('#world-scene canvas');
  const bounds = await canvas.boundingBox();
  await canvas.click({ position: { x: point.x - bounds!.x, y: point.y - bounds!.y } });
}

async function placeMine(page: Page, column: number): Promise<void> {
  const cell = LAND_GRID_CELLS.find((candidate) => candidate.environment === 'surface' && candidate.column === column)!;
  await page.locator('#dock-build').click();
  await page.locator('#build-mine').click();
  await tapWorld(page, footprintCenterX({ column, row: LAND_GRID_CONFIG.surfaceCellRow },
    { widthCells: 1, heightCells: 1 }));
  await expect(page.locator('#selection-title')).toHaveText('Предпросмотр: шахта');
  await expect(page.locator('#confirm-placement')).toBeEnabled();
  await page.locator('#confirm-placement').click();
  await expect.poll(async () => (await readWorld(page)).sites.some((site) => site.gridColumn === column)).toBe(true);
  expect((await readWorld(page)).sites.find((site) => site.gridColumn === column)?.gridColumn).toBe(cell.column);
}

async function startTouchDrag(page: Page, fromWorld: Point, toWorld: Point): Promise<CdpSession> {
  const canvas = page.locator('#world-scene canvas');
  const from = await worldToScreen(page, fromWorld);
  const to = await worldToScreen(page, toWorld);
  const bounds = await canvas.boundingBox();
  const geometry = JSON.stringify({ fromWorld, toWorld, from, to, bounds, view: await canvasView(page) });
  expect(from.x, geometry).toBeGreaterThanOrEqual(bounds!.x);
  expect(from.x, geometry).toBeLessThanOrEqual(bounds!.x + bounds!.width);
  expect(to.x, geometry).toBeGreaterThanOrEqual(bounds!.x);
  expect(to.x, geometry).toBeLessThanOrEqual(bounds!.x + bounds!.width);
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ id: 2, ...from }] });
  for (let step = 1; step <= 12; step += 1) {
    const progress = step / 12;
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{
      id: 2, x: from.x + (to.x - from.x) * progress, y: from.y + (to.y - from.y) * progress
    }] });
    await page.waitForTimeout(16);
  }
  return cdp;
}

async function endTouchDrag(cdp: CdpSession): Promise<void> {
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await cdp.detach();
}

async function pinchByScale(page: Page, scale: number): Promise<void> {
  const canvas = page.locator('#world-scene canvas');
  const bounds = (await canvas.boundingBox())!;
  const center = { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height * 0.48 };
  const halfDistance = 40;
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [
    { id: 3, x: center.x - halfDistance, y: center.y },
    { id: 4, x: center.x + halfDistance, y: center.y }
  ] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [
    { id: 3, x: center.x - halfDistance * scale, y: center.y },
    { id: 4, x: center.x + halfDistance * scale, y: center.y }
  ] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await cdp.detach();
}

async function seedSave(page: Page, world: PrototypeWorld): Promise<void> {
  await page.addInitScript(({ key, saved }) => {
    if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify(saved));
  },
    { key: STORAGE_KEY, saved: world });
}

test('touch drag assigns builders to the exact new construction sites at portrait and landscape zooms, and survives reload', async ({ browser }) => {
  test.setTimeout(4 * 60_000);
  const context = await browser.newContext({ baseURL, viewport: { width: 390, height: 844 }, hasTouch: true });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const world = createNewWorld();
  world.stores[0]!.wood = PROTOTYPE_CONFIG.warehouseCapacity;
  world.stores[0]!.ore = 0;
  await seedSave(page, world);
  try {
    await page.goto('/');
    const canvas = page.locator('#world-scene canvas');
    await expect(canvas).toBeVisible();
    await placeMine(page, 2);
    await placeMine(page, 4);

    let state = await readWorld(page);
    const firstSite = state.sites.find((site) => site.gridColumn === 2)!;
    const secondSite = state.sites.find((site) => site.gridColumn === 4)!;
    const firstResident = state.residents.find((person) => person.id === 'r1')!;
    let midpoint = (firstResident.x + firstSite.x) / 2;
    await panTo(page, midpoint);
    let cdp = await startTouchDrag(page, { x: firstResident.x, y: firstResident.y - 56 },
      { x: firstSite.x, y: WORLD.groundY - 145 });
    await expect(canvas).toHaveAttribute('data-resident-drag-id', 'r1');
    await expect(canvas).toHaveAttribute('data-drag-role', 'builder');
    await expect(canvas).toHaveAttribute('data-drag-feedback', 'Строитель');
    await saveEvidence(page, '01-touch-drag-builder-portrait-target-highlight');
    await endTouchDrag(cdp);
    await expect(canvas).toHaveAttribute('data-last-notice', /назначен: Строитель/);
    state = await readWorld(page);
    expect(state.residents.find((person) => person.id === 'r1')).toMatchObject({
      role: 'builder', workplaceId: firstSite.id, targetSiteId: firstSite.id
    });

    await page.setViewportSize({ width: 844, height: 390 });
    await expect.poll(async () => (await page.locator('#world-scene canvas').boundingBox())?.width).toBeGreaterThan(800);
    await pinchByScale(page, 0.65);
    await expect.poll(async () => Number(await canvas.getAttribute('data-camera-zoom'))).toBeLessThan(0.8);
    state = await readWorld(page);
    const secondResident = state.residents.find((person) => person.id === 'r2')!;
    midpoint = (secondResident.x + secondSite.x) / 2;
    await panTo(page, midpoint);
    cdp = await startTouchDrag(page, { x: secondResident.x, y: secondResident.y - 56 },
      { x: secondSite.x, y: WORLD.groundY - 145 });
    await expect(canvas).toHaveAttribute('data-drag-role', 'builder');
    await expect(canvas).toHaveAttribute('data-drag-feedback', 'Строитель');
    await saveEvidence(page, '02-touch-drag-builder-landscape-zoomed-target-highlight');
    await endTouchDrag(cdp);

    state = await readWorld(page);
    expect(state.residents.find((person) => person.id === 'r2')).toMatchObject({
      role: 'builder', workplaceId: secondSite.id, targetSiteId: secondSite.id
    });
    expect(state.residents.find((person) => person.id === 'r1')?.workplaceId)
      .not.toBe(state.residents.find((person) => person.id === 'r2')?.workplaceId);
    expect(state.residents.find((person) => person.id === 'r2')!.x).not.toBe(secondSite.x);
    await page.reload();
    await expect.poll(async () => (await readWorld(page)).residents.find((person) => person.id === 'r1')?.workplaceId)
      .toBe(firstSite.id);
    state = await readWorld(page);
    expect(state.residents.find((person) => person.id === 'r2')).toMatchObject({
      role: 'builder', workplaceId: secondSite.id, targetSiteId: secondSite.id
    });
    expect(errors).toEqual([]);

    const thirdResident = state.residents.find((person) => person.id === 'r3')!;
    await panTo(page, (thirdResident.x + firstSite.x) / 2);
    cdp = await startTouchDrag(page, { x: thirdResident.x, y: thirdResident.y - 56 },
      { x: firstSite.x, y: WORLD.groundY - 145 });
    await expect(canvas).toHaveAttribute('data-resident-drag-id', 'r3');
    await expect(canvas).toHaveAttribute('data-drag-role', 'builder');
    await canvas.evaluate((element) => element.dispatchEvent(new PointerEvent('pointercancel', {
      bubbles: true, pointerId: 2, pointerType: 'touch'
    })));
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await cdp.detach();
    await expect(canvas).not.toHaveAttribute('data-resident-drag-id', /.+/);
    await expect(canvas).toHaveAttribute('data-last-notice', /отменено браузером/);
    expect((await readWorld(page)).residents.find((person) => person.id === 'r3'))
      .toMatchObject({ role: 'idle', workplaceId: null });

  } finally {
    await context.close();
  }
});

test('touch drag onto a full warehouse shows the capacity block and keeps the job unchanged', async ({ browser }) => {
  const context = await browser.newContext({ baseURL, viewport: { width: 390, height: 844 }, hasTouch: true });
  const page = await context.newPage();
  const world = createNewWorld();
  world.stores[0]!.wood = world.stores[0]!.capacity;
  world.stores[0]!.ore = 0;
  await seedSave(page, world);
  try {
    await page.goto('/');
    const canvas = page.locator('#world-scene canvas');
    await expect(canvas).toBeVisible();
    const state = await readWorld(page);
    const resident = state.residents.find((person) => person.id === 'r3')!;
    const store = state.stores[0]!;
    await panTo(page, (resident.x + store.x) / 2);
    const cdp = await startTouchDrag(page, { x: resident.x, y: resident.y - 56 },
      { x: store.x, y: WORLD.groundY - 145 });
    await expect(canvas).toHaveAttribute('data-resident-drag-id', 'r3');
    await expect(canvas).toHaveAttribute('data-drag-feedback', 'В складе нет свободного места для новых грузов.');
    await saveEvidence(page, '06-touch-full-warehouse-capacity-feedback');
    await endTouchDrag(cdp);
    await expect(canvas).toHaveAttribute('data-last-notice', /В складе нет свободного места/);
    expect((await readWorld(page)).residents.find((person) => person.id === 'r3'))
      .toMatchObject({ role: 'idle', workplaceId: null });
  } finally {
    await context.close();
  }
});

test('warehouse loss confirmation reports the exact stock, cancellation keeps it, and completion destroys only that stock', async ({ page }) => {
  test.setTimeout(3 * 60_000);
  await page.setViewportSize({ width: 1280, height: 800 });
  const world = createNewWorld();
  world.stores[0]!.wood = 80;
  world.stores[0]!.ore = 40;
  world.residents[0]!.role = 'builder';
  await seedSave(page, world);
  await page.goto('/');
  const canvas = page.locator('#world-scene canvas');
  await expect(canvas).toBeVisible();
  await tapWorld(page, world.stores[0]!.x, WORLD.groundY - 140);
  await expect(page.locator('[data-testid="start-demolition"]')).toBeVisible();
  await page.locator('[data-testid="start-demolition"]').click();
  await expect(page.locator('#demolition-dialog')).toBeVisible();
  await expect(page.locator('#demolition-confirm-details'))
    .toContainText('При сносе будет потеряно: 80 древесины и 40 породы. Восстановить эти ресурсы нельзя.');
  await expect(page.locator('#demolition-confirm-details')).toContainText('Отдельно за разборку вернётся');
  await saveEvidence(page, '03-confirm-warehouse-stock-loss-80-40');
  await page.locator('#cancel-demolition-confirm').click();
  await expect(page.locator('#demolition-dialog')).toBeHidden();
  expect((await readWorld(page)).stores[0]).toMatchObject({ wood: 80, ore: 40 });

  await tapWorld(page, world.stores[0]!.x, WORLD.groundY - 140);
  await page.locator('[data-testid="start-demolition"]').click();
  await page.locator('#confirm-demolition').click();
  await expect.poll(async () => (await readWorld(page)).stores[0]?.closedForDemolition).toBe(true);
  expect((await readWorld(page)).stores[0]).toMatchObject({ wood: 80, ore: 40 });
  await saveEvidence(page, '04-confirmed-demolition-keeps-stock-until-completion');
  await expect.poll(async () => (await readWorld(page)).stores.length, { timeout: 45_000 }).toBe(0);
  const finished = await readWorld(page);
  expect(finished.buildings.some((building) => building.kind === 'warehouse')).toBe(false);
  const demolitionPiles = finished.stockpiles.filter((pile) => pile.sourceId === 'demolition' && pile.amount > 0);
  expect(demolitionPiles.filter((pile) => pile.resource === 'wood').reduce((sum, pile) => sum + pile.amount, 0)).toBe(25);
  expect(demolitionPiles.filter((pile) => pile.resource === 'ore').reduce((sum, pile) => sum + pile.amount, 0)).toBe(20);
  expect(demolitionPiles.reduce((sum, pile) => sum + pile.amount, 0)).toBe(45);
  await saveEvidence(page, '05-last-warehouse-demolished-loss-separated-from-refund');
});

test('mines occupy free prepared cells independently while the natural ore pile stays finite', async ({ page }) => {
  const world = createNewWorld();
  world.mineLayoutVersion = 1;
  world.buildings.push(
    { id: 'mine-west', kind: 'mine', x: LAND_GRID_CELLS.find((cell) => cell.column === 2 && cell.environment === 'surface')!.centerX,
      y: WORLD.groundY, gridColumn: 2, gridRow: LAND_GRID_CONFIG.surfaceCellRow,
      footprint: { widthCells: 1, heightCells: 1 } },
    { id: 'mine-east', kind: 'mine', x: LAND_GRID_CELLS.find((cell) => cell.column === 4 && cell.environment === 'surface')!.centerX,
      y: WORLD.groundY, gridColumn: 4, gridRow: LAND_GRID_CONFIG.surfaceCellRow,
      footprint: { widthCells: 1, heightCells: 1 } }
  );
  world.occupiedPlots.push(
    LAND_GRID_CELLS.find((cell) => cell.column === 2 && cell.environment === 'surface')!.id,
    LAND_GRID_CELLS.find((cell) => cell.column === 4 && cell.environment === 'surface')!.id
  );
  world.stockpiles.push(
    { id: 'pile-mine-west', sourceId: mineStockpileSourceId('mine-west'), resource: 'ore', x: world.buildings[1]!.x,
      amount: 0, capacity: PROTOTYPE_CONFIG.stockpile.upgradedCapacity },
    { id: 'pile-mine-east', sourceId: mineStockpileSourceId('mine-east'), resource: 'ore', x: world.buildings[2]!.x,
      amount: 0, capacity: PROTOTYPE_CONFIG.stockpile.upgradedCapacity }
  );
  world.residents[0]!.role = 'miner';
  world.residents[0]!.workplaceId = 'mine-west';
  world.residents[0]!.x = world.buildings[1]!.x;
  world.residents[1]!.role = 'miner';
  world.residents[1]!.workplaceId = 'mine-east';
  world.residents[1]!.x = world.buildings[2]!.x;
  await seedSave(page, world);
  await page.goto('/');
  const saved = await readWorld(page);
  expect(saved.stockpiles.find((pile) => pile.sourceId === 'ore')?.capacity).toBe(10);
  expect(saved.stockpiles.find((pile) => pile.sourceId === mineStockpileSourceId('mine-west'))?.capacity).toBe(50);
  expect(saved.stockpiles.find((pile) => pile.sourceId === mineStockpileSourceId('mine-east'))?.capacity).toBe(50);
  expect(saved.residents[0]).toMatchObject({ role: 'miner', workplaceId: 'mine-west' });
  expect(saved.residents[1]).toMatchObject({ role: 'miner', workplaceId: 'mine-east' });
  await page.waitForTimeout(3200);
  const after = await readWorld(page);
  expect(after.stockpiles.find((pile) => pile.sourceId === mineStockpileSourceId('mine-west'))!.amount).toBeGreaterThan(0);
  expect(after.stockpiles.find((pile) => pile.sourceId === mineStockpileSourceId('mine-east'))!.amount).toBeGreaterThan(0);
  expect(after.oreSource).toBe(PROTOTYPE_CONFIG.ore.initialDeposit);
});

test('a depleted natural outcrop stays hidden when a structure change rebuilds static art', async ({ page }) => {
  const world = createNewWorld();
  world.oreSource = 0;
  world.residents[0]!.role = 'builder';
  await seedSave(page, world);
  await page.goto('/');

  const canvas = page.locator('#world-scene canvas');
  await expect(canvas).toBeVisible();
  const depletedSource = async () => JSON.parse((await canvas.getAttribute('data-ore-source'))!) as {
    mode: string; remaining: number; outcropVisible: boolean; label: string;
  };
  await expect.poll(depletedSource).toMatchObject({
    mode: 'depleted', remaining: 0, outcropVisible: false, label: 'Залежь истощена'
  });
  await panTo(page, PROTOTYPE_CONFIG.sources.oreX);
  await saveEvidence(page, '07-depleted-outcrop-before-structure-redraw');

  await tapWorld(page, world.stores[0]!.x, WORLD.groundY - 140);
  await expect(page.locator('[data-testid="start-demolition"]')).toBeVisible();
  await page.locator('[data-testid="start-demolition"]').click();
  await page.locator('#confirm-demolition').click();
  await expect.poll(async () => (await readWorld(page)).stores[0]?.closedForDemolition).toBe(true);
  await expect.poll(depletedSource).toMatchObject({
    mode: 'depleted', remaining: 0, outcropVisible: false, label: 'Залежь истощена'
  });
  await panTo(page, PROTOTYPE_CONFIG.sources.oreX);
  await saveEvidence(page, '08-depleted-outcrop-after-structure-redraw');
});
