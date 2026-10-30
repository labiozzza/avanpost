import { createHash } from 'node:crypto';
import { execFileSync, spawn } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { expect, test, type Page } from '@playwright/test';

const projectRoot = process.cwd();
const tsxCli = path.join(projectRoot, 'node_modules/tsx/dist/cli.mjs');
const CELL_SIZE = 48;
const MOBILE_ZOOM = 0.72;
const g34EvidencePath = path.join(projectRoot, 'docs/v2/evidence/G3/G3.4');

interface WorldSnapshot {
  revision: { worldVersion: number; geometryVersion: number; serverTick: number };
  resources: { wood: number; stone: number };
  storage: { capacity: number; anchor: { x: number; y: number }; footprint: { width: number; height: number } };
  trees: Array<{
    id: string;
    name: string;
    sourceKind?: string;
    position: { x: number; y: number };
    remaining: number;
    maxRemaining: number;
    state: 'standing' | 'stump' | 'uprooted';
  }>;
  residents: Array<{
    id: string;
    name: string;
    workRole: 'none' | 'woodcutter' | 'builder' | 'stone_miner';
    position: { x: number; y: number };
    state: string;
    visualState: string;
    cargo: number;
    cargoItemId: 'wood' | 'stone' | null;
    task: null | { kind: 'gather-wood' | 'gather-stone' | 'build-cabin' | 'build-workshop'; phase: string; sourceId?: string | null; buildingId?: string;
      orderId?: string; deliveryQuantity?: number;
      assignmentSource?: 'manual' | 'profession' | 'workRole' | 'recovery';
      continuous?: boolean; cancelAfterDelivery?: boolean; progressTicks: number; requiredTicks: number };
  }>;
  buildOrders: Array<{
    id: string; buildingId: string; queuePosition: number;
    status: 'waiting_materials' | 'waiting_builder' | 'waiting_path' | 'in_progress' | 'completed' | 'cancelled' | 'blocked';
    assignedResidentId: string | null; blockedReason: string | null;
    requiresExplicitBuilder?: boolean;
  }>;
  nextBuildOrderSequence: number;
  stoneDeposits: Array<{
    id: string; name: string; position: { x: number; y: number }; remaining: number; maxRemaining: number;
    bufferQuantity: number; bufferCapacity: number; yieldPerTick: number; state: 'available' | 'depleted';
  }>;
  buildings: Array<{
    id: string; kind: 'cabin' | 'workshop'; reservedStone: number;
    orderId: string;
    anchor: { x: number; y: number };
    footprint: { width: number; height: number };
    state: string;
    progressTicks: number;
    progressRequired: number;
    reservedWood: number;
  }>;
}

async function browserRequest(page: Page, url: string, method = 'GET', body?: unknown) {
  return page.evaluate(async ({ requestUrl, requestMethod, requestBody }) => {
    const response = await fetch(requestUrl, {
      method: requestMethod,
      credentials: 'include',
      cache: 'no-store',
      signal: AbortSignal.timeout(5_000),
      headers: requestBody === undefined ? { accept: 'application/json' } : {
        accept: 'application/json', 'content-type': 'application/json'
      },
      ...(requestBody === undefined ? {} : { body: JSON.stringify(requestBody) })
    });
    return { status: response.status, body: await response.json() as unknown };
  }, { requestUrl: url, requestMethod: method, requestBody: body });
}

async function currentWorld(page: Page, apiOrigin: string): Promise<WorldSnapshot> {
  const response = await page.request.get(`${apiOrigin}/api/world`, { headers: { accept: 'application/json' } });
  expect(response.status()).toBe(200);
  return await response.json() as WorldSnapshot;
}

function resident(world: WorldSnapshot, id = 'worker-1'): WorldSnapshot['residents'][number] {
  const found = world.residents.find((candidate) => candidate.id === id);
  if (!found) throw new Error(`Resident ${id} is missing from snapshot.`);
  return found;
}

function privateHost(): string {
  return process.env.AVANPOST_V2_ENABLE_LAN === 'true'
    ? process.env.AVANPOST_V2_BIND_HOST ?? '127.0.0.1'
    : '127.0.0.1';
}

function apiPort(): number {
  return Number(process.env.AVANPOST_V2_TEST_PORT ?? '18888');
}

function clientPort(): number {
  return Number(process.env.AVANPOST_V2_TEST_CLIENT_PORT ?? '14174');
}

function loopbackClientPort(): number {
  return Number(process.env.AVANPOST_V2_TEST_LOOPBACK_CLIENT_PORT ?? '14175');
}

function computerUrl(): string {
  return process.env.AVANPOST_V2_ENABLE_LAN === 'true'
    ? `http://localhost:${loopbackClientPort()}/`
    : `http://${privateHost()}:${clientPort()}/`;
}

function browserApiOrigin(fromLanClient = false): string {
  return process.env.AVANPOST_V2_ENABLE_LAN === 'true'
    ? fromLanClient ? `http://${privateHost()}:${apiPort()}` : new URL(computerUrl()).origin
    : `http://${privateHost()}:${apiPort()}`;
}

function phoneUrl(): string {
  return process.env.AVANPOST_V2_ENABLE_LAN === 'true'
    ? `http://${privateHost()}:${clientPort()}/`
    : computerUrl();
}

async function selectWorkerByCanvasTap(page: Page, apiOrigin: string): Promise<void> {
  const canvas = page.locator('#world-scene canvas');
  await currentWorld(page, apiOrigin);
  await expect.poll(async () => page.locator('#world-scene').evaluate((element) => Boolean(
    (element as HTMLElement).dataset.workerCanvasX && (element as HTMLElement).dataset.workerCanvasY
  ))).toBe(true);
  const projection = await page.locator('#world-scene').evaluate((element) => ({
    x: Number((element as HTMLElement).dataset.workerCanvasX ?? '0'),
    y: Number((element as HTMLElement).dataset.workerCanvasY ?? '0')
  }));
  if (!projection.x || !projection.y) throw new Error('First resident pointer projection is missing.');
  await canvas.click({ position: projection });
  await expect(page.getByRole('heading', { name: 'Илья' })).toBeVisible();
}

async function selectResidentByCanvasTap(page: Page, apiOrigin: string, id: string, name: string): Promise<void> {
  const world = await currentWorld(page, apiOrigin);
  const index = world.residents.findIndex((candidate) => candidate.id === id);
  if (index < 0) throw new Error(`Resident ${id} is missing from the server snapshot.`);
  await expect.poll(async () => page.locator('#world-scene').evaluate((element, residentIndex) => {
    const data = (element as HTMLElement).dataset;
    return Boolean(data[`resident${residentIndex}CanvasX`] && data[`resident${residentIndex}CanvasY`]);
  }, index)).toBe(true);
  const projection = await page.locator('#world-scene').evaluate((element, residentIndex) => {
    const data = (element as HTMLElement).dataset;
    return {
      x: Number(data[`resident${residentIndex}CanvasX`] ?? '0'),
      y: Number(data[`resident${residentIndex}CanvasY`] ?? '0')
    };
  }, index);
  if (!projection.x || !projection.y) throw new Error(`Canvas projection for ${id} is missing.`);
  const canvas = page.locator('#world-scene canvas');
  const bounds = await canvas.boundingBox();
  if (!bounds) throw new Error('Phaser canvas is not visible.');
  if (projection.x < 8 || projection.x > bounds.width - 8) {
    const cdp = await page.context().newCDPSession(page);
    const startX = bounds.x + bounds.width * 0.99;
    const startY = bounds.y + bounds.height * 0.13;
    const delta = Math.min(bounds.width * 0.95, Math.abs(projection.x - bounds.width / 2));
    const endX = startX + (projection.x > bounds.width ? -delta : delta);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ id: 44, x: startX, y: startY }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ id: 44, x: endX, y: startY }] });
    await delay(120);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await cdp.detach();
    await delay(100);
    const afterPan = await page.locator('#world-scene').evaluate((element, residentIndex) => {
      const data = (element as HTMLElement).dataset;
      const x = Number(data[`resident${residentIndex}CanvasX`] ?? '0');
      const width = document.querySelector('#world-scene canvas')?.clientWidth ?? 0;
      return { x, width, centerX: data.cameraCenterX, scrollX: data.cameraScrollX, down: data.lastPointerDownSelection };
    }, index);
    if (afterPan.x < 8 || afterPan.x > afterPan.width - 8) {
      throw new Error(`Touch pan did not expose resident ${id}: ${JSON.stringify({ before: projection, after: afterPan })}`);
    }
  }
  const visibleProjection = await page.locator('#world-scene').evaluate((element, residentIndex) => {
    const data = (element as HTMLElement).dataset;
    return { x: Number(data[`resident${residentIndex}CanvasX`]), y: Number(data[`resident${residentIndex}CanvasY`]) };
  }, index);
  if (await page.evaluate(() => matchMedia('(pointer: coarse)').matches)) {
    await canvas.tap({ position: visibleProjection });
  } else {
    await canvas.click({ position: visibleProjection });
  }
  await expect(page.getByRole('heading', { name })).toBeVisible();
}

async function dragResidentToTarget(
  page: Page, apiOrigin: string, residentId: string, target: 'tree' | 'stone' | 'building', targetIndex = 0,
  onHover?: () => Promise<void>
): Promise<void> {
  const world = await currentWorld(page, apiOrigin);
  const index = world.residents.findIndex((candidate) => candidate.id === residentId);
  if (index < 0) throw new Error(`Resident ${residentId} is missing from the server snapshot.`);
  await expect.poll(async () => page.locator('#world-scene').evaluate((element, values) => {
    const data = (element as HTMLElement).dataset;
    const suffix = values.target === 'tree' ? 'firstTree' : values.target === 'stone' ? 'firstStone' : `building${values.targetIndex}`;
    return Boolean(data[`resident${values.index}CanvasX`] && data[`resident${values.index}CanvasY`] &&
      data[`${suffix}CanvasX`] && data[`${suffix}CanvasY`]);
  }, { index, target, targetIndex })).toBe(true);
  const projection = await page.locator('#world-scene').evaluate((element, values) => {
    const data = (element as HTMLElement).dataset;
    const suffix = values.target === 'tree' ? 'firstTree' : values.target === 'stone' ? 'firstStone' : `building${values.targetIndex}`;
    return {
      from: {
        x: Number(data[`resident${values.index}CanvasX`] ?? '0'),
        y: Number(data[`resident${values.index}CanvasY`] ?? '0')
      },
      to: { x: Number(data[`${suffix}CanvasX`] ?? '0'), y: Number(data[`${suffix}CanvasY`] ?? '0') }
    };
  }, { index, target, targetIndex });
  if (!projection.from.x || !projection.from.y || !projection.to.x || !projection.to.y) {
    throw new Error(`Canvas pointer projection missing for resident=${residentId}, target=${target}.`);
  }
  const canvas = page.locator('#world-scene canvas');
  const bounds = await canvas.boundingBox();
  if (!bounds) throw new Error('Phaser canvas is not visible.');
  await page.mouse.move(bounds.x + projection.from.x, bounds.y + projection.from.y);
  await page.mouse.down();
  await page.mouse.move(bounds.x + projection.to.x, bounds.y + projection.to.y, { steps: 12 });
  if (onHover) await onHover();
  await page.mouse.up();
}

async function touchDragResidentToTarget(
  page: Page, apiOrigin: string, residentId: string, target: 'tree' | 'stone' | 'building', targetIndex = 0,
  expectedHint?: string, onHover?: () => Promise<void>
): Promise<void> {
  const world = await currentWorld(page, apiOrigin);
  const index = world.residents.findIndex((candidate) => candidate.id === residentId);
  if (index < 0) throw new Error(`Resident ${residentId} is missing from the server snapshot.`);
  const suffix = target === 'tree' ? 'firstTree' : target === 'stone' ? 'firstStone' : `building${targetIndex}`;
  await expect.poll(async () => page.locator('#world-scene').evaluate((element, details) => {
    const data = (element as HTMLElement).dataset;
    return Boolean(data[`resident${details.index}CanvasX`] && data[`resident${details.index}CanvasY`] &&
      data[`${details.suffix}CanvasX`] && data[`${details.suffix}CanvasY`]);
  }, { index, suffix })).toBe(true);
  const projection = await page.locator('#world-scene').evaluate((element, details) => {
    const data = (element as HTMLElement).dataset;
    return {
      from: { x: Number(data[`resident${details.index}CanvasX`]), y: Number(data[`resident${details.index}CanvasY`]) },
      to: { x: Number(data[`${details.suffix}CanvasX`]), y: Number(data[`${details.suffix}CanvasY`]) }
    };
  }, { index, suffix });
  if (!projection.from.x || !projection.from.y || !projection.to.x || !projection.to.y) {
    throw new Error(`Touch projection missing for resident=${residentId}, target=${target}.`);
  }
  const canvas = page.locator('#world-scene canvas');
  const bounds = await canvas.boundingBox();
  if (!bounds) throw new Error('Phaser canvas is not visible.');
  const cdp = await page.context().newCDPSession(page);
  const from = { x: bounds.x + projection.from.x, y: bounds.y + projection.from.y };
  const to = { x: bounds.x + projection.to.x, y: bounds.y + projection.to.y };
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ id: 71, ...from }] });
  for (let step = 1; step <= 10; step += 1) {
    const progress = step / 10;
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{
      id: 71, x: from.x + (to.x - from.x) * progress, y: from.y + (to.y - from.y) * progress
    }] });
    await delay(16);
  }
  await expect(page.locator('#drag-hint')).toBeVisible();
  if (expectedHint) await expect(page.locator('#drag-hint')).toContainText(expectedHint);
  await expect(page.locator('#drag-hint')).toHaveAttribute('data-state', 'valid');
  await expect(page.locator('#world-scene')).toHaveAttribute('data-resident-drag-active', 'true');
  await expect.poll(async () => Number(await page.locator('#world-scene').getAttribute('data-assignable-drop-target-count')))
    .toBeGreaterThan(0);
  if (onHover) await onHover();
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await cdp.detach();
}

async function selectBuildingByCanvasTap(page: Page, apiOrigin: string, buildingId: string): Promise<number> {
  const world = await currentWorld(page, apiOrigin);
  const index = world.buildings.findIndex((candidate) => candidate.id === buildingId);
  if (index < 0) throw new Error(`Building ${buildingId} is missing from the server snapshot.`);
  const building = world.buildings[index]!;
  const projection = await page.locator('#world-scene').evaluate((element, details) => {
    const data = (element as HTMLElement).dataset;
    const zoom = Number(data.cameraZoom ?? '1');
    const viewX = Number(data.cameraWorldViewX ?? '0');
    const viewY = Number(data.cameraWorldViewY ?? '0');
    const viewportX = Number(data.cameraViewportX ?? '0');
    const viewportY = Number(data.cameraViewportY ?? '0');
    const viewportWidth = Number(data.cameraViewportWidth ?? '1');
    const viewportHeight = Number(data.cameraViewportHeight ?? '1');
    const canvas = document.querySelector<HTMLCanvasElement>('#world-scene canvas');
    if (!canvas) return null;
    const candidates = [details.anchor.x * details.cellSize + 12,
      details.anchor.x * details.cellSize + details.footprint.width * details.cellSize - 12];
    const pointX = candidates.find((worldX) => details.residents.every((resident) => {
      const residentX = resident.position.x * details.cellSize + details.cellSize / 2;
      return Math.abs(residentX - worldX) >= 36;
    }));
    if (pointX === undefined) return null;
    return {
      x: (viewportX + (pointX - viewX) * zoom) * canvas.clientWidth / viewportWidth,
      y: (viewportY + (-24 - viewY) * zoom) * canvas.clientHeight / viewportHeight
    };
  }, { anchor: building.anchor, footprint: building.footprint, residents: world.residents, cellSize: CELL_SIZE });
  if (!projection) throw new Error(`No unobstructed pointer position on building ${buildingId}.`);
  if (!projection.x || !projection.y) throw new Error(`Canvas projection for building ${buildingId} is missing.`);
  const canvas = page.locator('#world-scene canvas');
  if (await page.evaluate(() => matchMedia('(pointer: coarse)').matches)) await canvas.tap({ position: projection });
  else await canvas.click({ position: projection });
  await expect(page.locator('#context-order-section')).toBeVisible();
  return index;
}

async function clickWorldCell(page: Page, anchorX: number): Promise<void> {
  const canvas = page.locator('#world-scene canvas');
  const box = await canvas.boundingBox();
  if (!box) throw new Error('Phaser canvas is not visible.');
  const point = await page.locator('#world-scene').evaluate((element, dimensions) => {
    const data = (element as HTMLElement).dataset;
    const viewX = Number(data.cameraWorldViewX ?? '0');
    const viewY = Number(data.cameraWorldViewY ?? '0');
    const viewportX = Number(data.cameraViewportX ?? '0');
    const viewportY = Number(data.cameraViewportY ?? '0');
    const viewportWidth = Number(data.cameraViewportWidth ?? '1');
    const viewportHeight = Number(data.cameraViewportHeight ?? '1');
    const zoom = Number(data.cameraZoom ?? '1');
    return {
      x: (viewportX + (dimensions.anchorX * dimensions.cellSize + dimensions.cellSize / 2 - viewX) * zoom) * dimensions.width / viewportWidth,
      y: (viewportY + (-24 - viewY) * zoom) * dimensions.height / viewportHeight
    };
  }, { anchorX, cellSize: CELL_SIZE, width: box.width, height: box.height });
  await canvas.click({ position: {
    x: Math.max(2, Math.min(box.width - 2, point.x)),
    y: Math.max(2, Math.min(box.height - 2, point.y))
  } });
}

async function openCatalogAtGround(page: Page, anchorX: number): Promise<void> {
  await clickWorldCell(page, anchorX);
  await expect(page.locator('#building-catalog')).toBeVisible();
}

async function clickPlacementAnchor(page: Page, anchorX: number): Promise<void> {
  await clickWorldCell(page, anchorX);
  await expect(page.locator('#world-scene')).toHaveAttribute('data-placement-anchor-x', String(anchorX));
}

async function tapWorldCell(page: Page, anchorX: number): Promise<void> {
  const canvas = page.locator('#world-scene canvas');
  const box = await canvas.boundingBox();
  if (!box) throw new Error('Phaser canvas is not visible.');
  const point = await page.locator('#world-scene').evaluate((element, dimensions) => {
    const data = (element as HTMLElement).dataset;
    const viewX = Number(data.cameraWorldViewX ?? '0');
    const viewY = Number(data.cameraWorldViewY ?? '0');
    const viewportX = Number(data.cameraViewportX ?? '0');
    const viewportY = Number(data.cameraViewportY ?? '0');
    const viewportWidth = Number(data.cameraViewportWidth ?? '1');
    const viewportHeight = Number(data.cameraViewportHeight ?? '1');
    const zoom = Number(data.cameraZoom ?? '1');
    return {
      x: (viewportX + (dimensions.anchorX * dimensions.cellSize + dimensions.cellSize / 2 - viewX) * zoom) * dimensions.width / viewportWidth,
      y: (viewportY + (-24 - viewY) * zoom) * dimensions.height / viewportHeight
    };
  }, { anchorX, cellSize: CELL_SIZE, width: box.width, height: box.height });
  await canvas.tap({ position: {
    x: Math.max(2, Math.min(box.width - 2, point.x)),
    y: Math.max(2, Math.min(box.height - 2, point.y))
  } });
}

async function assertViewportBudget(page: Page): Promise<void> {
  const dimensions = await page.evaluate(() => {
    const viewport = document.documentElement.clientHeight;
    const topbar = document.querySelector('.topbar')?.getBoundingClientRect().height ?? 0;
    const world = document.querySelector('.world')?.getBoundingClientRect().height ?? 0;
    return { viewport, topbar, world };
  });
  expect(dimensions.topbar / dimensions.viewport).toBeLessThanOrEqual(0.08);
  expect(dimensions.world / dimensions.viewport).toBeGreaterThanOrEqual(0.6);
}

async function clickWoodOrder(page: Page, apiOrigin: string): Promise<WorldSnapshot> {
  await selectWorkerByCanvasTap(page, apiOrigin);
  await page.getByRole('button', { name: /Добывать древесину/ }).click();
  await expect.poll(async () => resident(await currentWorld(page, apiOrigin)).task?.phase, { timeout: 5_000 })
    .toBe('walking_to_source');
  return currentWorld(page, apiOrigin);
}

async function resetTestWorld(scenario: string): Promise<void> {
  execFileSync(process.execPath, [tsxCli, 'src/cli/reset-test-world.ts', scenario], {
    cwd: path.join(projectRoot, 'apps/server-v2'),
    env: { ...process.env, AVANPOST_V2_DATABASE_OPERATION: 'test' },
    stdio: 'pipe'
  });
}

async function findEmptySurfaceAnchor(page: Page, apiOrigin: string): Promise<number> {
  const world = await currentWorld(page, apiOrigin);
  const scene = await page.locator('#world-scene').evaluate((element) => {
    const data = (element as HTMLElement).dataset;
    const canvas = document.querySelector<HTMLCanvasElement>('#world-scene canvas');
    return {
      viewX: Number(data.cameraWorldViewX ?? '0'),
      viewY: Number(data.cameraWorldViewY ?? '0'),
      viewWidth: Number(data.cameraWorldViewWidth ?? '1'),
      viewHeight: Number(data.cameraWorldViewHeight ?? '1'),
      zoom: Number(data.cameraZoom ?? '1'),
      viewportX: Number(data.cameraViewportX ?? '0'),
      viewportY: Number(data.cameraViewportY ?? '0'),
      viewportWidth: Number(data.cameraViewportWidth ?? '1'),
      viewportHeight: Number(data.cameraViewportHeight ?? '1'),
      canvasWidth: canvas?.clientWidth ?? 0,
      canvasHeight: canvas?.clientHeight ?? 0
    };
  });
  const first = Math.floor(scene.viewX / CELL_SIZE);
  const last = Math.floor((scene.viewX + scene.viewWidth) / CELL_SIZE);
  const candidates = Array.from({ length: Math.max(0, last - first + 1) }, (_, offset) => first + offset)
    .sort((a, b) => Math.abs(a + 0.5 - (scene.viewX + scene.viewWidth / 2) / CELL_SIZE) -
      Math.abs(b + 0.5 - (scene.viewX + scene.viewWidth / 2) / CELL_SIZE));
  for (const anchorX of candidates) {
    const worldX = anchorX * CELL_SIZE + CELL_SIZE / 2;
    if (worldX < scene.viewX || worldX > scene.viewX + scene.viewWidth) continue;
    if (worldX >= world.storage.anchor.x * CELL_SIZE - 76 &&
        worldX <= (world.storage.anchor.x + world.storage.footprint.width) * CELL_SIZE + 28) continue;
    if (world.residents.some((actor) => Math.abs(worldX - (actor.position.x * CELL_SIZE + CELL_SIZE / 2)) < 38)) continue;
    if (world.trees.some((tree) => Math.abs(worldX - (tree.position.x * CELL_SIZE + CELL_SIZE / 2)) < 88)) continue;
    if (world.stoneDeposits.some((deposit) => Math.abs(worldX - (deposit.position.x * CELL_SIZE + CELL_SIZE / 2)) < 62)) continue;
    if (world.buildings.some((building) => worldX >= building.anchor.x * CELL_SIZE &&
        worldX <= (building.anchor.x + building.footprint.width) * CELL_SIZE)) continue;
    const screenX = scene.viewportX + (worldX - scene.viewX) * scene.zoom;
    const screenY = scene.viewportY + (-24 - scene.viewY) * scene.zoom;
    if (screenX < 8 || screenX > scene.canvasWidth - 8 || screenY < 8 || screenY > scene.canvasHeight - 8) continue;
    return anchorX;
  }
  throw new Error('No unobstructed visible ground cell is available for the catalog tap.');
}

async function pairCurrentPage(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Показать код на этом компьютере' }).click();
  await expect(page.locator('#pairing-code')).toHaveText(/^[a-f0-9]{32}$/);
  await page.getByLabel('Одноразовый код').fill((await page.locator('#pairing-code').textContent())!.trim());
  await page.getByRole('button', { name: 'Подключить' }).click();
  await expect(page.locator('#pairing-summary')).toHaveText('Мир подключён к этому браузеру');
}

test('localhost client keeps its paired session in loopback mode', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'peace-v2-desktop', 'Loopback session pairing is checked once in desktop Chromium.');
  await resetTestWorld('starter');
  await page.goto('http://localhost:14174/');
  await expect(page.getByRole('heading', { name: 'Новый берег' })).toBeVisible();
  await pairCurrentPage(page);
  await expect.poll(() => page.evaluate(async () => {
    const response = await fetch('/api/session/status', { credentials: 'include', cache: 'no-store' });
    return response.ok && (await response.json() as { paired?: unknown }).paired === true;
  })).toBe(true);
  await expect(page.locator('#pairing-summary')).toHaveText('Мир подключён к этому браузеру');
});

async function tapCanvasDataset(page: Page, xKey: string, yKey: string): Promise<void> {
  const point = await page.locator('#world-scene').evaluate((element, keys) => {
    const data = (element as HTMLElement).dataset;
    return { x: Number(data[keys.x] ?? '0'), y: Number(data[keys.y] ?? '0') };
  }, { x: xKey, y: yKey });
  if (!point.x || !point.y) throw new Error(`Missing scene touch projection ${xKey}/${yKey}.`);
  await page.locator('#world-scene canvas').tap({ position: point });
}

async function clickCanvasDataset(page: Page, xKey: string, yKey: string): Promise<void> {
  const point = await page.locator('#world-scene').evaluate((element, keys) => {
    const data = (element as HTMLElement).dataset;
    return { x: Number(data[keys.x] ?? '0'), y: Number(data[keys.y] ?? '0') };
  }, { x: xKey, y: yKey });
  if (!point.x || !point.y) throw new Error(`Missing scene click projection ${xKey}/${yKey}.`);
  await page.locator('#world-scene canvas').click({ position: point });
}

async function touchTapLocator(page: Page, locator: import('@playwright/test').Locator): Promise<void> {
  const box = await locator.boundingBox();
  if (!box) throw new Error('Touch target is not visible.');
  await locator.tap();
}

async function restartV2TestServer(page: Page): Promise<void> {
  const bindHost = privateHost();
  const env = {
    ...process.env,
    AVANPOST_V2_DATABASE_OPERATION: 'test',
    AVANPOST_V2_ENABLE_LAN: process.env.AVANPOST_V2_ENABLE_LAN ?? 'false',
    AVANPOST_V2_BIND_HOST: bindHost
  };
  execFileSync(process.execPath, [tsxCli, 'apps/server-v2/src/cli/stop.ts'], {
    cwd: projectRoot,
    env,
    stdio: 'pipe'
  });
  const child = spawn(process.execPath, [tsxCli, 'src/cli/dev.ts'], {
    cwd: path.join(projectRoot, 'apps/server-v2'),
    env,
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let childExitCode: number | null | undefined;
  let childOutput = '';
  child.stdout?.on('data', (data: Buffer) => { childOutput = `${childOutput}${data.toString()}`.slice(-5000); });
  child.stderr?.on('data', (data: Buffer) => { childOutput = `${childOutput}${data.toString()}`.slice(-5000); });
  child.unref();
  child.once('exit', (code) => { childExitCode = code; });

  const apiHealth = `http://${bindHost}:${apiPort()}/api/health`;
  const pageUrl = computerUrl();
  const phonePageUrl = phoneUrl();
  const deadline = Date.now() + 45_000;
  while (Date.now() < deadline) {
    const [health, client, phoneClient] = await Promise.all([
      fetch(apiHealth).then((response) => response.ok).catch(() => false),
      fetch(pageUrl).then((response) => response.ok).catch(() => false),
      fetch(phonePageUrl).then((response) => response.ok).catch(() => false)
    ]);
    if (health && client && phoneClient) return;
    if (childExitCode !== null && childExitCode !== undefined) {
      throw new Error(`V2 test API restart exited before ready (code ${childExitCode}): ${childOutput}`);
    }
    await delay(300);
  }
  throw new Error('V2 test server did not recover after API restart.');
}

test('persistent work roles and ordered cabin queue survive reload and API restart', async ({ page, browser }, testInfo) => {
  test.setTimeout(360_000);
  test.skip(true, 'Superseded by the G3.4 world-first desktop/mobile E2E flows; this legacy scenario depends on the removed resident list and build-mode sidebar.');
  test.skip(testInfo.project.name !== 'peace-v2-desktop', 'The desktop project owns the paired gameplay and restart scenario.');
  const bindHost = privateHost();
  const apiOrigin = `http://${bindHost}:${apiPort()}`;
  const desktopUrl = computerUrl();
  const computerApiOrigin = browserApiOrigin();
  const consoleErrors: string[] = [];
  let serverRestartInProgress = false;
  page.on('console', (message) => {
    if (message.type() !== 'error') return;
    if (serverRestartInProgress && (/net::ERR_(CONNECTION_REFUSED|EMPTY_RESPONSE|CONNECTION_RESET|SOCKET_NOT_CONNECTED|FAILED)/.test(message.text()) ||
        /blocked by CORS policy: No 'Access-Control-Allow-Origin' header/.test(message.text()))) return;
    consoleErrors.push(message.text());
  });
  page.on('pageerror', (error) => consoleErrors.push(error.message));

  await page.goto(desktopUrl);
  page.setDefaultTimeout(8_000);
  await expect(page.getByRole('heading', { name: 'Новый берег' })).toBeVisible();
  await expect(page.locator('#world-scene canvas')).toBeVisible();
  await assertViewportBudget(page);
  await expect(page.locator('#pairing-code')).toBeHidden();
  expect((await page.request.get(`${apiOrigin}/api/world`)).status()).toBe(401);
  await page.locator('#pairing-panel').evaluate((element) => { (element as HTMLDetailsElement).open = false; });

  const canvas = page.locator('#world-scene canvas');
  const desktopCanvasBox = await canvas.boundingBox();
  if (!desktopCanvasBox) throw new Error('Desktop Phaser canvas is missing.');
  const zoomPoint = { x: desktopCanvasBox.width * 0.72, y: desktopCanvasBox.height * 0.38 };
  const worldPointUnderCursor = () => page.locator('#world-scene').evaluate((element, point) => {
    const data = (element as HTMLElement).dataset;
    const zoom = Number(data.cameraZoom ?? '1');
    const viewportWidth = Number(data.cameraViewportWidth ?? '1');
    const viewportHeight = Number(data.cameraViewportHeight ?? '1');
    return {
      x: Number(data.cameraWorldViewX ?? '0') + (point.x / point.width * viewportWidth - Number(data.cameraViewportX ?? '0')) / zoom,
      y: Number(data.cameraWorldViewY ?? '0') + (point.y / point.height * viewportHeight - Number(data.cameraViewportY ?? '0')) / zoom
    };
  }, { ...zoomPoint, width: desktopCanvasBox.width, height: desktopCanvasBox.height });
  const worldPointBeforeZoom = await worldPointUnderCursor();
  await page.mouse.move(desktopCanvasBox.x + zoomPoint.x, desktopCanvasBox.y + zoomPoint.y);
  const zoomBefore = Number(await page.locator('#world-scene').getAttribute('data-camera-zoom'));
  await page.mouse.wheel(0, -180);
  await expect.poll(async () => Number(await page.locator('#world-scene').getAttribute('data-camera-zoom')))
    .toBeGreaterThan(zoomBefore);
  await delay(100);
  const worldPointAfterZoom = await worldPointUnderCursor();
  const zoomMetrics = await page.locator('#world-scene').evaluate((element) => ({ ...(element as HTMLElement).dataset }));
  if (Math.abs(worldPointAfterZoom.x - worldPointBeforeZoom.x) >= 4) {
    throw new Error(`Zoom anchor drift: ${JSON.stringify({ worldPointBeforeZoom, worldPointAfterZoom, zoomBefore, zoomAfter: zoomMetrics.cameraZoom, zoomPoint, desktopCanvasBox, zoomMetrics })}`);
  }
  expect(Math.abs(worldPointAfterZoom.x - worldPointBeforeZoom.x), JSON.stringify({
    worldPointBeforeZoom, worldPointAfterZoom, zoomBefore,
    zoomAfter: zoomMetrics.cameraZoom, zoomPoint, desktopCanvasBox, zoomMetrics
  })).toBeLessThan(4);
  expect(Math.abs(worldPointAfterZoom.y - worldPointBeforeZoom.y)).toBeLessThan(4);
  const desktopCenterBeforePan = Number(await page.locator('#world-scene').getAttribute('data-camera-center-x'));
  const desktopPanStart = {
    x: desktopCanvasBox.x + desktopCanvasBox.width * 0.9,
    y: desktopCanvasBox.y + desktopCanvasBox.height * 0.5
  };
  await page.mouse.move(desktopPanStart.x, desktopPanStart.y);
  await page.mouse.down();
  await page.mouse.move(desktopPanStart.x - 55, desktopPanStart.y + 24, { steps: 4 });
  await page.mouse.up();
  await expect.poll(async () => Number(await page.locator('#world-scene').getAttribute('data-camera-center-x')))
    .not.toBe(desktopCenterBeforePan);
  await page.getByRole('button', { name: 'Центрировать' }).click();

  await page.locator('#pairing-panel').evaluate((element) => { (element as HTMLDetailsElement).open = true; });
  await page.getByRole('button', { name: 'Показать код на этом компьютере' }).click();
  await expect(page.locator('#pairing-code')).toHaveText(/^[a-f0-9]{32}$/);
  const desktopCode = (await page.locator('#pairing-code').textContent())?.trim() ?? '';
  expect(desktopCode).toMatch(/^[a-f0-9]{32}$/);
  await page.locator('#pairing-code').evaluate((element) => {
    element.textContent = '';
    (element as HTMLOutputElement).hidden = true;
  });
  await page.getByLabel('Одноразовый код').fill(desktopCode);
  await page.getByRole('button', { name: 'Подключить' }).click();
  await expect(page.locator('#pairing-summary')).toHaveText('Мир подключён к этому браузеру');
  await page.reload();
  await expect(page.locator('#pairing-summary')).toHaveText('Мир подключён к этому браузеру');
  expect((await browserRequest(page, `${computerApiOrigin}/api/world`)).status).toBe(200);

  await page.locator('#pairing-panel').evaluate((element) => { (element as HTMLDetailsElement).open = true; });
  await expect(page.getByRole('button', { name: 'Показать код на этом компьютере' })).toBeVisible();
  await page.getByRole('button', { name: 'Показать код на этом компьютере' }).click();
  await expect(page.locator('#pairing-code')).toHaveText(/^[a-f0-9]{32}$/);
  const phoneCode = (await page.locator('#pairing-code').textContent())?.trim() ?? '';
  await page.locator('#pairing-code').evaluate((element) => {
    element.textContent = '';
    (element as HTMLOutputElement).hidden = true;
  });

  const phoneContext = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true
  });
  let phonePage = await phoneContext.newPage();
  phonePage.setDefaultTimeout(8_000);
  phonePage.setDefaultNavigationTimeout(30_000);
  let lastCommandPayload: unknown;
  const watchPhonePage = (targetPage: Page): void => {
    targetPage.on('console', (message) => {
      if (message.type() !== 'error') return;
      if (serverRestartInProgress && (/net::ERR_(CONNECTION_REFUSED|EMPTY_RESPONSE|CONNECTION_RESET|SOCKET_NOT_CONNECTED|FAILED)/.test(message.text()) ||
          /blocked by CORS policy: No 'Access-Control-Allow-Origin' header/.test(message.text()))) return;
      consoleErrors.push(message.text());
    });
    targetPage.on('pageerror', (error) => consoleErrors.push(error.message));
    targetPage.on('request', (request) => {
      if (request.method() === 'POST' && request.url().endsWith('/api/commands')) {
        lastCommandPayload = request.postDataJSON();
      }
    });
  };
  watchPhonePage(phonePage);
  try {
    await phonePage.goto(phoneUrl());
    await expect(phonePage.getByRole('heading', { name: 'Новый берег' })).toBeVisible();
    expect((await phonePage.request.get(`${apiOrigin}/api/world`)).status()).toBe(401);
    const pairingViewportProbe = await phonePage.locator('#pairing-panel').evaluate((element) => {
      const panel = element as HTMLDetailsElement;
      const button = document.querySelector('#pair-button');
      const bounds = button?.getBoundingClientRect();
      return {
        open: panel.open,
        buttonPresent: Boolean(button),
        buttonDisplay: button ? getComputedStyle(button).display : null,
        buttonBounds: bounds ? { top: bounds.top, bottom: bounds.bottom, height: bounds.height } : null,
        viewportHeight: innerHeight,
        panelBounds: (() => { const rect = panel.getBoundingClientRect(); return { top: rect.top, bottom: rect.bottom, height: rect.height }; })()
      };
    });
    expect(pairingViewportProbe.open, JSON.stringify(pairingViewportProbe)).toBe(true);
    expect(pairingViewportProbe.buttonPresent, JSON.stringify(pairingViewportProbe)).toBe(true);
    expect(pairingViewportProbe.buttonDisplay, JSON.stringify(pairingViewportProbe)).not.toBe('none');
    expect(pairingViewportProbe.buttonBounds?.top, JSON.stringify(pairingViewportProbe)).toBeGreaterThanOrEqual(0);
    expect(pairingViewportProbe.buttonBounds?.bottom, JSON.stringify(pairingViewportProbe))
      .toBeLessThanOrEqual(pairingViewportProbe.viewportHeight);
    await phonePage.setViewportSize({ width: 375, height: 667 });
    await assertViewportBudget(phonePage);
    const narrowPairingProbe = await phonePage.locator('#pairing-panel').evaluate((element) => {
      const panel = element as HTMLDetailsElement;
      const button = document.querySelector<HTMLButtonElement>('#pair-button');
      const bounds = button?.getBoundingClientRect();
      return {
        open: panel.open,
        buttonDisplay: button ? getComputedStyle(button).display : null,
        buttonBounds: bounds ? { top: bounds.top, bottom: bounds.bottom, height: bounds.height } : null,
        panelBounds: (() => { const rect = panel.getBoundingClientRect(); return { top: rect.top, bottom: rect.bottom, height: rect.height }; })(),
        viewport: { width: innerWidth, height: innerHeight }
      };
    });
    expect(narrowPairingProbe.open, JSON.stringify(narrowPairingProbe)).toBe(true);
    expect(narrowPairingProbe.buttonDisplay, JSON.stringify(narrowPairingProbe)).not.toBe('none');
    expect(narrowPairingProbe.buttonBounds?.bottom, JSON.stringify(narrowPairingProbe))
      .toBeLessThanOrEqual(narrowPairingProbe.viewport.height);
    await phonePage.setViewportSize({ width: 390, height: 844 });
    await phonePage.getByLabel('Одноразовый код').fill(phoneCode);
    await phonePage.getByRole('button', { name: 'Подключить' }).click();
    await expect(phonePage.locator('#pairing-summary')).toHaveText('Мир подключён к этому браузеру');
    await assertViewportBudget(phonePage);

    const initial = await currentWorld(phonePage, apiOrigin);
    expect(initial.resources.wood).toBe(1);
    expect(initial.storage.capacity).toBe(100);
    expect(initial.trees.find((tree) => tree.id === 'tree-1')?.remaining).toBe(3);
    const started = await clickWoodOrder(phonePage, apiOrigin);
    const firstSourceWorkPoint = initial.trees.find((tree) => tree.id === 'tree-1')!.position.x - 1;
    expect(resident(started).position.x).toBeGreaterThanOrEqual(resident(initial).position.x);
    expect(resident(started).position.x).toBeLessThanOrEqual(firstSourceWorkPoint);
    expect(resident(started).task?.phase).toBe('walking_to_source');
    expect(resident(started).cargo).toBe(0);
    expect(started.trees.find((tree) => tree.id === 'tree-1')?.remaining).toBe(3);
    expect(lastCommandPayload).toMatchObject({ kind: 'collect-wood', residentId: 'worker-1' });
    expect(lastCommandPayload).not.toHaveProperty('sourceId');
    expect(started.resources.wood).toBe(1);
    expect(lastCommandPayload).toBeDefined();
    const duplicateResponses = await Promise.all([
      browserRequest(phonePage, `${apiOrigin}/api/commands`, 'POST', lastCommandPayload),
      browserRequest(phonePage, `${apiOrigin}/api/commands`, 'POST', lastCommandPayload)
    ]);
    expect(duplicateResponses.map((response) => response.status)).toEqual([200, 200]);
    expect(duplicateResponses[0]?.body).toEqual(duplicateResponses[1]?.body);
    const afterDuplicate = await currentWorld(phonePage, apiOrigin);
    expect(afterDuplicate.trees.find((tree) => tree.id === 'tree-1')?.remaining).toBe(3);
    expect(afterDuplicate.resources.wood).toBe(1);

    await phonePage.reload();
    let saved = await currentWorld(phonePage, apiOrigin);
    expect(resident(saved).task).not.toBeNull();
    expect(resident(saved).task?.phase).toMatch(/walking_to_source|gathering|loading|carrying_to_storage|unloading/);
    await expect.poll(async () => (await currentWorld(phonePage, apiOrigin)).resources.wood, { timeout: 30_000 })
      .toBe(3);
    saved = await currentWorld(phonePage, apiOrigin);
    expect(resident(saved).cargo).toBe(0);
    expect(saved.trees.find((tree) => tree.id === 'tree-1')?.remaining).toBe(1);
    expect(resident(saved).task).toMatchObject({ kind: 'gather-wood', continuous: true, sourceId: 'tree-1' });

    await selectResidentByCanvasTap(phonePage, apiOrigin, 'worker-2', 'Марья');
    await phonePage.locator('#resident-work-role').selectOption('builder');
    await expect.poll(async () => resident(await currentWorld(phonePage, apiOrigin), 'worker-2').workRole)
      .toBe('builder');
    await openCatalogAtGround(phonePage, 0);
    await expect(phonePage.getByText('Здания')).toBeVisible();
    await phonePage.getByRole('button', { name: /Домик.*2×1 клетка/ }).click();
    await expect(phonePage.locator('#placement-panel')).toBeVisible();
    const deniedPlacement = await browserRequest(phonePage, `${apiOrigin}/api/placement/validate`, 'POST', {
      residentId: 'worker-2',
      anchor: { x: -6, y: -1 }
    });
    expect(deniedPlacement.status).toBe(200);
    expect((deniedPlacement.body as { valid?: boolean; reason?: string }).valid).toBe(false);
    expect((deniedPlacement.body as { reason?: string }).reason).toBe('OCCUPIED');
    await expect(phonePage.locator('#placement-reason')).toHaveText(/Место подходит/, { timeout: 5_000 });
    await expect(phonePage.getByRole('button', { name: 'Заказать дом' })).toBeEnabled();
    await phonePage.getByRole('button', { name: 'Заказать дом' }).click();
    await expect.poll(async () => (await currentWorld(phonePage, apiOrigin)).buildings.length, { timeout: 5_000 })
      .toBe(1);
    let buildingWorld = await currentWorld(phonePage, apiOrigin);
    expect(buildingWorld.resources.wood).toBe(3);
    expect(buildingWorld.buildings).toHaveLength(1);
    expect(buildingWorld.buildings[0]?.anchor).toEqual({ x: 0, y: -1 });
    expect(buildingWorld.buildings[0]?.state).toBe('waiting_builder');
    expect(buildingWorld.buildOrders[0]).toMatchObject({ status: 'waiting_builder', assignedResidentId: null });
    expect(buildingWorld.buildOrders[0]?.requiresExplicitBuilder ?? false).toBe(false);
    await dragResidentToTarget(phonePage, apiOrigin, 'worker-2', 'building', 0);
    await expect.poll(async () => resident(await currentWorld(phonePage, apiOrigin), 'worker-2').task?.kind)
      .toBe('build-cabin');
    await expect.poll(async () => {
      const current = await currentWorld(phonePage, apiOrigin);
      return current.buildings[0]?.state === 'complete' || resident(current, 'worker-2').task?.phase === 'building';
    }, { timeout: 15_000 }).toBe(true);
    await phonePage.reload();
    buildingWorld = await currentWorld(phonePage, apiOrigin);
    const progressBeforeRestart = buildingWorld.buildings[0]?.progressTicks ?? 0;
    expect(resident(buildingWorld, 'worker-2').task?.phase === 'building' || buildingWorld.buildings[0]?.state === 'complete').toBe(true);

    serverRestartInProgress = true;
    await restartV2TestServer(phonePage);
    if (phonePage.isClosed()) {
      phonePage = await phoneContext.newPage();
      watchPhonePage(phonePage);
    }
    await phonePage.goto(phoneUrl(), { waitUntil: 'domcontentloaded' });
    await expect(phonePage.getByRole('heading', { name: 'Новый берег' })).toBeVisible();
    buildingWorld = await currentWorld(phonePage, apiOrigin);
    serverRestartInProgress = false;
    expect(buildingWorld.buildings[0]?.anchor).toEqual({ x: 0, y: -1 });
    expect(buildingWorld.buildings[0]?.progressTicks).toBeGreaterThanOrEqual(progressBeforeRestart);
    await expect.poll(async () => (await currentWorld(phonePage, apiOrigin)).buildings[0]?.state, { timeout: 12_000 })
      .toBe('complete');
    buildingWorld = await currentWorld(phonePage, apiOrigin);
    expect(buildingWorld.buildings[0]?.reservedWood).toBe(0);
    expect(resident(buildingWorld, 'worker-2').task).toBeNull();
    expect(resident(buildingWorld, 'worker-1').task).toMatchObject({ kind: 'gather-wood', continuous: true });

    const afterFirstCabin = await currentWorld(phonePage, apiOrigin);
    expect(afterFirstCabin.resources.wood).toBeLessThan(3);
    expect(afterFirstCabin.buildings).toHaveLength(1);
    const overlap = await browserRequest(phonePage, `${apiOrigin}/api/placement/validate`, 'POST', {
      residentId: 'worker-2', anchor: { x: 0, y: -1 }
    });
    expect((overlap.body as { valid?: boolean; reason?: string }).valid).toBe(false);
    expect((overlap.body as { reason?: string }).reason).toBe('OCCUPIED');
    await expect.poll(async () => (await currentWorld(phonePage, apiOrigin)).trees.find((tree) => tree.id === 'tree-1')?.state,
      { timeout: 20_000 }).toBe('stump');

    await selectResidentByCanvasTap(phonePage, apiOrigin, 'worker-2', 'Марья');
    await phonePage.locator('#resident-work-role').selectOption('none');
    await expect.poll(async () => resident(await currentWorld(phonePage, apiOrigin), 'worker-2').workRole).toBe('none');
    await openCatalogAtGround(phonePage, 4);
    await phonePage.getByRole('button', { name: /Домик.*2×1 клетка/ }).click();
    await expect(phonePage.locator('#placement-reason')).toContainText(/занят/);
    await clickPlacementAnchor(phonePage, 4);
    await expect(phonePage.locator('#placement-reason')).toContainText(/дождётся 3 древесины/);
    await expect(phonePage.getByRole('button', { name: 'Заказать дом' })).toBeEnabled();
    const queuedBuildResponse = phonePage.waitForResponse((response) =>
      response.request().method() === 'POST' && response.url().endsWith('/api/commands'));
    await phonePage.getByRole('button', { name: 'Заказать дом' }).click();
    const queuedBuildResult = await queuedBuildResponse;
    const queuedBuildBody = await queuedBuildResult.json() as { code?: string; detail?: string };
    expect(queuedBuildResult.status(), JSON.stringify(queuedBuildBody)).toBe(200);
    await expect.poll(async () => (await currentWorld(phonePage, apiOrigin)).buildings.length, { timeout: 5_000 })
      .toBe(2);
    let queuedWorld = await currentWorld(phonePage, apiOrigin);
    expect(queuedWorld.resources.wood).toBeLessThan(3);
    expect(queuedWorld.buildings[1]?.state).toBe('waiting_materials');
    expect(queuedWorld.buildings[1]?.reservedWood).toBe(0);
    expect(resident(queuedWorld, 'worker-2').task).toBeNull();
    expect(queuedWorld.buildOrders.find((order) => order.buildingId === queuedWorld.buildings[1]?.id))
      .toMatchObject({ assignedResidentId: null });
    await dragResidentToTarget(phonePage, apiOrigin, 'worker-2', 'building', 1);
    queuedWorld = await currentWorld(phonePage, apiOrigin);
    expect(queuedWorld.buildOrders.find((order) => order.buildingId === queuedWorld.buildings[1]?.id))
      .toMatchObject({ assignedResidentId: 'worker-2', requiresExplicitBuilder: false });

    const thirdOrderCommandState = await currentWorld(phonePage, apiOrigin);
    const thirdOrderResponse = await browserRequest(phonePage, `${apiOrigin}/api/commands`, 'POST', {
      requestId: 'e2e-third-order-0001',
      expectedWorldVersion: thirdOrderCommandState.revision.worldVersion,
      expectedGeometryVersion: thirdOrderCommandState.revision.geometryVersion,
      kind: 'build-cabin', anchor: { x: 12, y: -1 }
    });
    expect(thirdOrderResponse.status).toBe(200);
    let queuedOrdersWorld = await currentWorld(phonePage, apiOrigin);
    const thirdOrder = queuedOrdersWorld.buildOrders.find((order) => order.buildingId === 'cabin-e2e-third-order-0001');
    expect(thirdOrder).toBeDefined();
    await phonePage.reload();
    await expect(phonePage.getByRole('heading', { name: 'Новый берег' })).toBeVisible();
    const thirdOrderRow = phonePage.locator(`#build-order-list [data-order-id="${thirdOrder!.id}"]`);
    await expect(thirdOrderRow.getByRole('button', { name: 'Повысить приоритет заказа' })).toBeEnabled();
    await thirdOrderRow.getByRole('button', { name: 'Повысить приоритет заказа' }).click();
    await expect.poll(async () => {
      const current = await currentWorld(phonePage, apiOrigin);
      return current.buildOrders.find((order) => order.id === thirdOrder!.id)?.queuePosition;
    }).toBe(thirdOrder!.queuePosition - 1);
    const cancelOrderState = await currentWorld(phonePage, apiOrigin);
    const cancelOrderResponse = await browserRequest(phonePage, `${apiOrigin}/api/commands`, 'POST', {
      requestId: 'e2e-cancel-third-order-0001',
      expectedWorldVersion: cancelOrderState.revision.worldVersion,
      expectedGeometryVersion: cancelOrderState.revision.geometryVersion,
      kind: 'cancel-build-order', orderId: thirdOrder!.id
    });
    expect(cancelOrderResponse.status).toBe(200);
    await expect.poll(async () => {
      const current = await currentWorld(phonePage, apiOrigin);
      return current.buildOrders.find((order) => order.id === thirdOrder!.id)?.status;
    }).toBe('cancelled');
    queuedOrdersWorld = await currentWorld(phonePage, apiOrigin);
    expect(queuedOrdersWorld.buildings.find((building) => building.id === 'cabin-e2e-third-order-0001')?.state)
      .toBe('cancelled');
    const queuedWood = queuedOrdersWorld.resources.wood;
    expect(queuedWood).toBeGreaterThan(0);
    queuedWorld = await currentWorld(phonePage, apiOrigin);
    expect(resident(queuedWorld, 'worker-1').task).toMatchObject({ kind: 'gather-wood', continuous: true });
    await expect.poll(async () => (await currentWorld(phonePage, apiOrigin)).buildings[1]?.reservedWood, { timeout: 60_000 })
      .toBe(3);
    queuedWorld = await currentWorld(phonePage, apiOrigin);
    expect(queuedWorld.resources.wood).toBe(0);
    expect(queuedWorld.buildings[1]?.state).toBe('in_progress');
    expect(resident(queuedWorld, 'worker-2').task?.phase).toMatch(/walking_to_build|building/);
    expect(resident(queuedWorld, 'worker-1').task).not.toBeNull();
    const parallelStarted = await currentWorld(phonePage, apiOrigin);
    expect(resident(parallelStarted, 'worker-1').task).toMatchObject({ kind: 'gather-wood', continuous: true });
    expect(resident(parallelStarted, 'worker-2').task?.kind).toBe('build-cabin');
    expect(resident(parallelStarted, 'worker-2').task?.phase).toMatch(/walking_to_build|building/);

    expect(parallelStarted.residents.map(({ id, name }) => [id, name])).toEqual([
      ['worker-1', 'Илья'], ['worker-2', 'Марья']
    ]);
    expect(parallelStarted.buildings.filter((building) => building.state !== 'cancelled').map((building) => building.anchor)).toEqual([
      { x: 0, y: -1 }, { x: 4, y: -1 }
    ]);
    await phonePage.screenshot({ path: path.join(projectRoot,
      'docs/v2/evidence/G3/G3.2-WORK-ORDERS/parallel-work.png') });

    serverRestartInProgress = true;
    await restartV2TestServer(phonePage);
    const parallelAfterRestart = await currentWorld(phonePage, apiOrigin);
    serverRestartInProgress = false;
    expect(resident(parallelAfterRestart, 'worker-1').task?.kind).toBe('gather-wood');
    expect(parallelAfterRestart.buildings[1]?.anchor).toEqual({ x: 4, y: -1 });
    if (parallelAfterRestart.buildings[1]?.state === 'complete') {
      expect(parallelAfterRestart.buildings[1]?.reservedWood).toBe(0);
      expect(resident(parallelAfterRestart, 'worker-2').task).toBeNull();
    } else {
      expect(parallelAfterRestart.buildings[1]?.reservedWood).toBe(3);
      expect(resident(parallelAfterRestart, 'worker-2').task?.kind).toBe('build-cabin');
    }
    await expect.poll(async () => {
      const current = await currentWorld(phonePage, apiOrigin);
      return `${resident(current, 'worker-1').task?.phase}/${resident(current, 'worker-2').task?.phase ?? current.buildings[1]?.state}`;
    }, { timeout: 15_000 }).toMatch(/^(walking_to_source|gathering|loading|carrying_to_storage)\/(walking_to_build|building|complete)$/);
    const activeParallel = await currentWorld(phonePage, apiOrigin);
    expect(resident(activeParallel, 'worker-1').task).not.toBeNull();
    expect(resident(activeParallel, 'worker-2').task?.phase === 'building' ||
      activeParallel.buildings[1]?.state === 'complete').toBe(true);

    await expect.poll(async () => {
      const current = await currentWorld(phonePage, apiOrigin);
      return current.buildings[1]?.state === 'complete' && resident(current, 'worker-2').task === null &&
        resident(current, 'worker-1').task?.kind === 'gather-wood' && resident(current, 'worker-1').task?.continuous;
    }, { timeout: 20_000 }).toBe(true);
    const finalWorld = await currentWorld(phonePage, apiOrigin);
    expect(finalWorld.buildings.filter((building) => building.state !== 'cancelled')).toHaveLength(2);
    expect(finalWorld.buildings.filter((building) => building.state !== 'cancelled').map((building) => building.anchor)).toEqual([
      { x: 0, y: -1 }, { x: 4, y: -1 }
    ]);
    expect(resident(finalWorld, 'worker-1').task).toMatchObject({ kind: 'gather-wood', continuous: true });
    expect(finalWorld.resources.wood + finalWorld.resources.stone).toBeLessThan(finalWorld.storage.capacity);

    expect(consoleErrors).toEqual([]);

    const evidencePath = path.join(projectRoot, 'docs/v2/evidence/G3/G3.2-WORK-ORDERS');
    await mkdir(evidencePath, { recursive: true });
    await page.screenshot({ path: path.join(evidencePath, 'computer.png'), fullPage: true, timeout: 30_000 });
    await phonePage.screenshot({ path: path.join(evidencePath, 'phone-emulated.png'), fullPage: true, timeout: 30_000 });
    const sourceFiles = [
      'apps/client-v2/src/main.ts',
      'apps/client-v2/src/settlement-scene.ts',
      'apps/client-v2/src/style.css',
      'apps/client-v2/public/assets/peace-v2/manifest.json',
      'apps/client-v2/public/assets/peace-v2/background-panorama.png',
      'apps/server-v2/src/server.ts',
      'packages/peace-v2-shared/src/index.ts',
      'packages/peace-v2-sim/src/settlement.ts',
      'db/peace-v2/migrations/0007_work_roles_build_queue.sql',
      'db/peace-v2/migrations/0008_preserve_legacy_work_intents.sql',
      'db/peace-v2/migrations/0006_continuous_woodcutting.sql',
      'db/peace-v2/migrations/0003_live_settlement.sql',
      'db/peace-v2/migrations/0004_forest_sources.sql',
      'apps/client-v2/e2e/peaceful-slice.spec.ts'
    ];
    const sourceSha256 = Object.fromEntries(await Promise.all(sourceFiles.map(async (file) => [
      file, createHash('sha256').update(await readFile(path.join(projectRoot, file))).digest('hex')
    ])));
    await writeFile(path.join(evidencePath, 'playwright.json'), `${JSON.stringify({
      testId: 'V2-G32-WORK-01', gate: 'G3.2', project: testInfo.project.name, result: 'PASS',
      databaseName: 'avanpost_v2_test', restartedApi: true,
      selectedBuildingAnchors: [{ x: 0, y: -1 }, { x: 4, y: -1 }],
      networkMode: process.env.AVANPOST_V2_ENABLE_LAN === 'true' ? 'explicit-private-lan' : 'loopback',
      sourceSha256,
      assertions: [
        'one source command persists a continuous woodcutting order; the resident delivers multiple logs without another command',
        'a second resident receives a distinct nearest reachable tree and both server-side harvests are conserved',
        'full-store handling preserves the cargo and resumes after capacity is freed by a real build command (unit/API evidence)',
        'workers receive persistent roles; a manual task can coexist with a queued build order',
        'waiting build orders can be reprioritized and safely cancelled before work begins',
        'queued construction resumes while continuous woodcutting persists across reload and API restart',
        'desktop wheel zoom and mobile touch-camera behavior are covered by browser projects',
        'physical phone acceptance remains manual'
      ]
    }, null, 2)}\n`, 'utf8');
  } finally {
    await phoneContext.close();
  }
});

test('G3.2 hotfix D1/D2: carried wood feeds the prioritized site and the next order follows', async ({ page }, testInfo) => {
  test.setTimeout(240_000);
  test.skip(testInfo.project.name !== 'peace-v2-desktop', 'The desktop project owns the authoritative hotfix scenario.');
  const bindHost = privateHost();
  const desktopUrl = computerUrl();
  const computerApiOrigin = browserApiOrigin();
  const consoleErrors: string[] = [];
  let serverRestartInProgress = false;
  page.on('console', (message) => {
    if (message.type() !== 'error') return;
    if (serverRestartInProgress && (/net::ERR_(CONNECTION_REFUSED|EMPTY_RESPONSE|CONNECTION_RESET|SOCKET_NOT_CONNECTED|FAILED)/.test(message.text()) ||
        /blocked by CORS policy: No 'Access-Control-Allow-Origin' header/.test(message.text()))) return;
    consoleErrors.push(message.text());
  });
  page.on('pageerror', (error) => consoleErrors.push(error.message));

  await resetTestWorld('builder-carry-priority');

  await page.goto(desktopUrl, { waitUntil: 'domcontentloaded' });
  page.setDefaultTimeout(10_000);
  await expect(page.getByRole('heading', { name: 'Новый берег' })).toBeVisible();
  await expect(page.locator('#world-scene canvas')).toBeVisible();
  await page.getByRole('button', { name: 'Показать код на этом компьютере' }).click();
  await expect(page.locator('#pairing-code')).toHaveText(/^[a-f0-9]{32}$/);
  const pairingCode = (await page.locator('#pairing-code').textContent())?.trim() ?? '';
  await page.getByLabel('Одноразовый код').fill(pairingCode);
  await page.getByRole('button', { name: 'Подключить' }).click();
  await expect(page.locator('#pairing-summary')).toHaveText('Мир подключён к этому браузеру');

  const initial = await currentWorld(page, computerApiOrigin);
  expect(initial.resources.wood).toBe(100);
  expect(initial.storage.capacity).toBe(100);
  expect(resident(initial, 'worker-1')).toMatchObject({ workRole: 'woodcutter', cargo: 1 });
  expect(resident(initial, 'worker-2')).toMatchObject({ workRole: 'none', cargo: 1 });
  expect(initial.buildings).toHaveLength(0);
  const initialTrackedWood = initial.resources.wood +
    initial.residents.reduce((sum, actor) => sum + actor.cargo, 0) +
    initial.buildings.reduce((sum, building) => sum + building.reservedWood, 0) +
    initial.trees.reduce((sum, tree) => sum + tree.remaining, 0);

  const createOrder = async (requestId: string, anchor: { x: number; y: number }, current: WorldSnapshot) => {
    const response = await browserRequest(page, `${computerApiOrigin}/api/commands`, 'POST', {
      requestId,
      expectedWorldVersion: current.revision.worldVersion,
      expectedGeometryVersion: current.revision.geometryVersion,
      kind: 'build-cabin', anchor
    });
    expect(response.status).toBe(200);
    return response.body as WorldSnapshot;
  };

  const afterA = await createOrder('hotfix-order-a-0001', { x: 0, y: -1 }, initial);
  const buildingA = afterA.buildings.find((building) => building.anchor.x === 0)!;
  const orderA = afterA.buildOrders.find((order) => order.buildingId === buildingA.id)!;
  expect(orderA.status).toBe('waiting_builder');
  const afterB = await createOrder('hotfix-order-b-0001', { x: 12, y: -1 }, afterA);
  const buildingB = afterB.buildings.find((building) => building.anchor.x === 12)!;
  const orderB = afterB.buildOrders.find((order) => order.buildingId === buildingB.id)!;
  expect(orderB.status).toBe('waiting_builder');
  expect(resident(afterB, 'worker-2').task?.kind).toBe('gather-wood');

  // Direct setup commands ran through the browser proxy; reload the client before exercising its UI controls.
  await page.reload();
  await expect(page.locator('#pairing-summary')).toHaveText('Мир подключён к этому браузеру');

  const buildingBIndex = await selectBuildingByCanvasTap(page, computerApiOrigin, buildingB.id);
  const orderBRow = page.locator(`#build-order-list [data-order-id="${orderB.id}"]`);
  await expect(orderBRow.getByRole('button', { name: 'Повысить приоритет заказа' })).toBeEnabled();
  const moveResponsePromise = page.waitForResponse((response) =>
    response.request().method() === 'POST' && response.url().endsWith('/api/commands') &&
    (response.request().postData() ?? '').includes('move-build-order'));
  await orderBRow.getByRole('button', { name: 'Повысить приоритет заказа' }).click();
  const moveResponse = await moveResponsePromise;
  expect(moveResponse.status()).toBe(200);
  await expect.poll(async () => {
    const current = await currentWorld(page, computerApiOrigin);
    return current.buildOrders.find((order) => order.id === orderB.id)!.queuePosition <
      current.buildOrders.find((order) => order.id === orderA.id)!.queuePosition;
  }).toBe(true);
  const orderARow = page.locator(`#build-order-list [data-order-id="${orderA.id}"]`);
  await expect(orderARow.getByRole('button', { name: 'Повысить приоритет заказа' })).toBeEnabled();

  await page.reload();
  await expect(page.locator('#pairing-summary')).toHaveText('Мир подключён к этому браузеру');
  let world = await currentWorld(page, computerApiOrigin);
  expect(world.buildOrders.find((order) => order.id === orderB.id)!.queuePosition)
    .toBeLessThan(world.buildOrders.find((order) => order.id === orderA.id)!.queuePosition);

  const assignmentResponsePromise = page.waitForResponse((response) =>
    response.request().method() === 'POST' && response.url().endsWith('/api/commands') &&
    (response.request().postData() ?? '').includes('assign-resident'));
  await dragResidentToTarget(page, computerApiOrigin, 'worker-2', 'building', buildingBIndex);
  const assignmentResponse = await assignmentResponsePromise;
  expect(assignmentResponse.status()).toBe(200);
  world = await assignmentResponse.json() as WorldSnapshot;
  expect(world.buildOrders.find((order) => order.id === orderB.id))
    .toMatchObject({ status: 'in_progress', assignedResidentId: 'worker-2' });
  expect(world.resources.wood).toBe(98);
  expect(world.buildings.find((building) => building.id === buildingB.id)?.reservedWood).toBe(2);
  expect(resident(world, 'worker-2')).toMatchObject({
    workRole: 'builder', cargo: 1,
    task: { kind: 'build-cabin', orderId: orderB.id, phase: 'carrying_materials_to_build' }
  });
  const afterDispatchWood = world.resources.wood +
    world.residents.reduce((sum, actor) => sum + actor.cargo, 0) +
    world.buildings.reduce((sum, building) => sum + building.reservedWood, 0) +
    world.trees.reduce((sum, tree) => sum + tree.remaining, 0);
  expect(afterDispatchWood).toBe(initialTrackedWood);

  await page.reload();
  world = await currentWorld(page, computerApiOrigin);
  expect(resident(world, 'worker-2').task).toMatchObject({ kind: 'build-cabin', orderId: orderB.id });
  serverRestartInProgress = true;
  await restartV2TestServer(page);
  world = await currentWorld(page, computerApiOrigin);
  serverRestartInProgress = false;
  expect(world.buildOrders.find((order) => order.id === orderB.id)!.queuePosition)
    .toBeLessThan(world.buildOrders.find((order) => order.id === orderA.id)!.queuePosition);
  const orderBStatusAfterRestart = world.buildOrders.find((order) => order.id === orderB.id)?.status;
  expect(['in_progress', 'completed']).toContain(orderBStatusAfterRestart);
  if (orderBStatusAfterRestart !== 'completed') {
    await expect.poll(async () => (await currentWorld(page, computerApiOrigin)).buildOrders
      .find((order) => order.id === orderB.id)?.status, { timeout: 30_000 }).toBe('completed');
  }
  await expect.poll(async () => {
    const current = await currentWorld(page, computerApiOrigin);
    return current.buildOrders.find((order) => order.id === orderA.id)?.assignedResidentId;
  }, { timeout: 10_000 }).toBe('worker-2');
  world = await currentWorld(page, computerApiOrigin);
  expect(world.buildOrders.find((order) => order.id === orderA.id))
    .toMatchObject({ status: 'in_progress', assignedResidentId: 'worker-2', requiresExplicitBuilder: false });
  expect(resident(world, 'worker-1').workRole).toBe('woodcutter');
  expect(resident(world, 'worker-1').task?.kind).toBe('gather-wood');
  expect(world.resources.wood + world.resources.stone).toBeLessThanOrEqual(world.storage.capacity);

  world = await currentWorld(page, computerApiOrigin);
  expect(world.buildings.find((building) => building.id === buildingB.id)?.state).toBe('complete');
  expect(world.buildOrders.find((order) => order.id === orderA.id))
    .toMatchObject({ status: 'in_progress', assignedResidentId: 'worker-2', requiresExplicitBuilder: false });
  expect(world.buildings.find((building) => building.id === buildingA.id)?.reservedWood).toBe(3);
  const finalTrackedWood = world.resources.wood +
    world.residents.reduce((sum, actor) => sum + actor.cargo, 0) +
    world.buildings.reduce((sum, building) => sum + building.reservedWood, 0) +
    world.trees.reduce((sum, tree) => sum + tree.remaining, 0);
  expect(finalTrackedWood).toBe(initialTrackedWood - 3);
  expect(consoleErrors).toEqual([]);

  const evidencePath = path.join(projectRoot, 'docs/v2/evidence/G3/G3.2-HOTFIX');
  await mkdir(evidencePath, { recursive: true });
  await page.screenshot({ path: path.join(evidencePath, 'builder-carry-priority.png'), fullPage: true });
  const sourceFiles = [
    'apps/client-v2/src/main.ts',
    'apps/client-v2/src/settlement-scene.ts',
    'apps/client-v2/e2e/peaceful-slice.spec.ts',
    'apps/server-v2/src/server.ts',
    'apps/server-v2/src/cli/reset-test-world.ts',
    'apps/server-v2/test/server-state.test.ts',
    'packages/peace-v2-shared/src/index.ts',
    'packages/peace-v2-sim/src/settlement.ts',
    'packages/peace-v2-sim/test/settlement.test.ts'
  ];
  const sourceSha256 = Object.fromEntries(await Promise.all(sourceFiles.map(async (file) => [
    file, createHash('sha256').update(await readFile(path.join(projectRoot, file))).digest('hex')
  ])));
  await writeFile(path.join(evidencePath, 'playwright.json'), `${JSON.stringify({
    testId: 'V2-G32-HOTFIX-D1D2-01', gate: 'G3.2-HOTFIX', project: testInfo.project.name,
    result: 'PASS', databaseName: 'avanpost_v2_test', restartedApi: true,
    scenario: 'full store; woodcutter carries 1; builder carries 1; order B reprioritized ahead of A',
    assertions: [
      'the queued builder task transfers one carried log to the selected site and reserves only the remaining two from stock',
      'wood is conserved across resident cargo, storage, tree nodes and reserved construction materials',
      'priority change persists across page reload and API restart and selects B before A',
      'B completes, then the role-builder automatically starts the next queued order A',
      'the woodcutter safely unloads and continues its assigned role; resource accounting remains exact'
    ],
    sourceSha256
  }, null, 2)}\n`, 'utf8');
});

test('G3.3: mine and deliver stone, then build a workshop with its reserved recipe', async ({ page }, testInfo) => {
  test.setTimeout(360_000);
  test.skip(testInfo.project.name !== 'peace-v2-desktop', 'The desktop project owns the G3.3 authoritative gameplay scenario.');
  const desktopUrl = computerUrl();
  const computerApiOrigin = browserApiOrigin();
  const consoleErrors: string[] = [];
  let serverRestartInProgress = false;
  page.on('console', (message) => {
    if (message.type() !== 'error') return;
    if (serverRestartInProgress && /net::ERR_(CONNECTION_REFUSED|EMPTY_RESPONSE|CONNECTION_RESET|SOCKET_NOT_CONNECTED|FAILED)/.test(message.text())) return;
    consoleErrors.push(message.text());
  });
  page.on('pageerror', (error) => consoleErrors.push(error.message));

  await resetTestWorld('g33-stone-workshop');

  await page.goto(desktopUrl, { waitUntil: 'domcontentloaded' });
  page.setDefaultTimeout(10_000);
  await expect(page.getByRole('heading', { name: 'Новый берег' })).toBeVisible();
  await page.getByRole('button', { name: 'Показать код на этом компьютере' }).click();
  await expect(page.locator('#pairing-code')).toHaveText(/^[a-f0-9]{32}$/);
  await page.getByLabel('Одноразовый код').fill((await page.locator('#pairing-code').textContent())!.trim());
  await page.getByRole('button', { name: 'Подключить' }).click();
  await expect(page.locator('#pairing-summary')).toHaveText('Мир подключён к этому браузеру');

  let world = await currentWorld(page, computerApiOrigin);
  expect(world.resources).toEqual({ wood: 12, stone: 0 });
  expect(world.storage.capacity).toBe(100);
  await openCatalogAtGround(page, 12);
  await page.locator('#workshop-catalog-item').click();
  await clickPlacementAnchor(page, 12);
  await expect(page.locator('#confirm-placement')).toBeEnabled();
  await expect(page.locator('#placement-title')).toContainText('12 дерева + 6 камня');
  await page.locator('#confirm-placement').click();

  await expect.poll(async () => (await currentWorld(page, computerApiOrigin)).buildOrders.at(-1)?.status)
    .toBe('waiting_materials');
  world = await currentWorld(page, computerApiOrigin);
  const workshop = world.buildings.find((building) => building.kind === 'workshop');
  const order = world.buildOrders.find((candidate) => candidate.buildingId === workshop?.id);
  expect(workshop).toBeDefined();
  expect(order).toBeDefined();
  expect(order).toMatchObject({ status: 'waiting_materials', assignedResidentId: null });
  expect(world.resources.wood).toBe(0);
  expect(world.resources.stone).toBe(0);
  expect(world.buildings.find((building) => building.id === workshop!.id)).toMatchObject({
    reservedWood: 12, reservedStone: 0
  });

  await dragResidentToTarget(page, computerApiOrigin, 'worker-2', 'building', 0);
  await expect.poll(async () => (await currentWorld(page, computerApiOrigin)).buildOrders
    .find((candidate) => candidate.id === order!.id)?.assignedResidentId).toBe('worker-2');
  world = await currentWorld(page, computerApiOrigin);
  expect(world.buildings.find((building) => building.id === workshop!.id)).toMatchObject({ reservedWood: 12, reservedStone: 0 });
  expect(world.resources.wood).toBe(0);

  await dragResidentToTarget(page, computerApiOrigin, 'worker-1', 'stone');
  await expect.poll(async () => (await currentWorld(page, computerApiOrigin)).residents[0]?.task?.kind)
    .toBe('gather-stone');
  await expect.poll(async () => page.locator('#worker-state').innerText())
    .toMatch(/Идёт к каменному выходу|Добывает камень|Загружает камень|Несёт .* камня|Разгружает камень/);
  await expect.poll(async () => (await currentWorld(page, computerApiOrigin)).buildings
    .find((building) => building.id === workshop!.id)?.reservedStone, { timeout: 90_000 }).toBe(6);
  await expect.poll(async () => (await currentWorld(page, computerApiOrigin)).buildOrders
    .find((candidate) => candidate.id === order!.id)?.status, { timeout: 15_000 }).toBe('in_progress');
  world = await currentWorld(page, computerApiOrigin);
  expect(world.resources.wood).toBe(0);
  expect(world.buildings.find((building) => building.id === workshop!.id))
    .toMatchObject({ reservedWood: 12, reservedStone: 6 });
  expect(world.resources.wood + world.resources.stone).toBeLessThanOrEqual(world.storage.capacity);

  await page.reload();
  await expect(page.locator('#pairing-summary')).toHaveText('Мир подключён к этому браузеру');
  world = await currentWorld(page, computerApiOrigin);
  expect(world.buildings.find((building) => building.id === workshop!.id))
    .toMatchObject({ reservedWood: 12, reservedStone: 6 });
  serverRestartInProgress = true;
  await restartV2TestServer(page);
  serverRestartInProgress = false;
  await page.reload();
  world = await currentWorld(page, computerApiOrigin);
  const restartedOrderStatus = world.buildOrders.find((candidate) => candidate.id === order!.id)?.status;
  expect(['in_progress', 'completed']).toContain(restartedOrderStatus);
  if (restartedOrderStatus === 'in_progress') {
    expect(world.buildings.find((building) => building.id === workshop!.id))
      .toMatchObject({ reservedWood: 12, reservedStone: 6 });
  }

  await expect.poll(async () => (await currentWorld(page, computerApiOrigin)).buildOrders
    .find((candidate) => candidate.id === order!.id)?.status, { timeout: 30_000 }).toBe('completed');
  world = await currentWorld(page, computerApiOrigin);
  expect(world.buildings.find((building) => building.id === workshop!.id))
    .toMatchObject({ kind: 'workshop', state: 'complete', reservedWood: 0, reservedStone: 0 });
  expect(world.stoneDeposits[0]!.remaining).toBeLessThan(600);
  expect(consoleErrors).toEqual([]);

  const evidencePath = path.join(projectRoot, 'docs/v2/evidence/G3/G3.3-STONE-WORKSHOP');
  await mkdir(evidencePath, { recursive: true });
  await page.screenshot({ path: path.join(evidencePath, 'workshop-complete.png'), fullPage: true });
  const sourceFiles = [
    'apps/client-v2/index.html', 'apps/client-v2/src/main.ts', 'apps/client-v2/src/settlement-scene.ts', 'apps/client-v2/src/style.css',
    'apps/client-v2/e2e/peaceful-slice.spec.ts', 'apps/server-v2/src/server.ts',
    'apps/server-v2/src/cli/reset-test-world.ts', 'apps/server-v2/test/server-state.test.ts',
    'packages/peace-v2-shared/src/index.ts', 'packages/peace-v2-shared/src/catalog.ts',
    'packages/peace-v2-sim/src/settlement.ts', 'packages/peace-v2-sim/src/g33-stone-config.ts',
    'packages/peace-v2-sim/test/settlement.test.ts', 'db/peace-v2/migrations/0009_g33_stone_mining.sql',
    'content/peace-v2/g3.3-stone.json'
  ];
  const sourceSha256 = Object.fromEntries(await Promise.all(sourceFiles.map(async (file) => [
    file, createHash('sha256').update(await readFile(path.join(projectRoot, file))).digest('hex')
  ])));
  await writeFile(path.join(evidencePath, 'playwright.json'), `${JSON.stringify({
    testId: 'V2-G33-STONE-WORKSHOP-01', gate: 'G3.3', project: testInfo.project.name,
    result: 'PASS', databaseName: 'avanpost_v2_test', restartedApi: true,
    scenario: 'stone miner assigned in UI; builder queues workshop; typed stone is extracted/delivered; 12 wood + 6 stone are reserved and consumed once',
    assertions: [
      'stone source and role are selectable and worker visual state changes to mining/hauling',
      'workshop placement creates a server-owned waiting_materials order until stone arrives',
      'finite source stock decreases; typed stone reaches shared storage and total stored resources remain within capacity',
      'workshop reserves exactly 12 wood and 6 stone; reservations survive reload and API restart',
      'workshop completes and consumes its materials exactly once with no browser console errors'
    ],
    sourceSha256
  }, null, 2)}\n`, 'utf8');
});

test('G3.3 P1: full storage routes carried wood and stone to the workshop without loss', async ({ page }, testInfo) => {
  test.setTimeout(360_000);
  test.skip(testInfo.project.name !== 'peace-v2-desktop', 'The desktop project owns the full-store courier regression.');
  const desktopUrl = computerUrl();
  const apiOrigin = browserApiOrigin();
  const errors: string[] = [];
  let restarting = false;
  page.on('console', (message) => {
    if (message.type() !== 'error') return;
    if (restarting && /net::ERR_(CONNECTION_REFUSED|EMPTY_RESPONSE|CONNECTION_RESET|SOCKET_NOT_CONNECTED|FAILED)/.test(message.text())) return;
    errors.push(message.text());
  });
  page.on('pageerror', (error) => errors.push(error.message));

  await resetTestWorld('g33-full-store-workshop');
  await page.goto(desktopUrl, { waitUntil: 'domcontentloaded' });
  page.setDefaultTimeout(10_000);
  await expect(page.getByRole('heading', { name: 'Новый берег' })).toBeVisible();
  await page.getByRole('button', { name: 'Показать код на этом компьютере' }).click();
  await expect(page.locator('#pairing-code')).toHaveText(/^[a-f0-9]{32}$/);
  await page.getByLabel('Одноразовый код').fill((await page.locator('#pairing-code').textContent())!.trim());
  await page.getByRole('button', { name: 'Подключить' }).click();
  await expect(page.locator('#pairing-summary')).toHaveText('Мир подключён к этому браузеру');

  let current = await currentWorld(page, apiOrigin);
  expect(current.resources).toEqual({ wood: 100, stone: 0 });
  expect(current.storage.capacity).toBe(100);
  expect(current.resources.wood + current.resources.stone).toBe(current.storage.capacity);
  expect(resident(current, 'worker-1')).toMatchObject({
    workRole: 'stone_miner', cargo: 18, cargoItemId: 'stone', task: { kind: 'gather-stone', phase: 'waiting_storage' }
  });
  expect(resident(current, 'worker-2')).toMatchObject({
    workRole: 'builder', cargo: 1, cargoItemId: 'wood', task: { kind: 'gather-wood', phase: 'waiting_storage' }
  });
  expect(current.buildings.filter((building) => building.kind === 'workshop')).toHaveLength(0);

  await openCatalogAtGround(page, 12);
  await page.locator('#workshop-catalog-item').click();
  await clickPlacementAnchor(page, 12);
  await expect(page.locator('#confirm-placement')).toBeEnabled();
  const createRequest = page.waitForRequest((request) =>
    request.method() === 'POST' && request.url().endsWith('/api/commands'));
  const createResponse = page.waitForResponse((response) =>
    response.request().method() === 'POST' && response.url().endsWith('/api/commands'));
  await page.locator('#confirm-placement').click();
  const [request, response] = await Promise.all([createRequest, createResponse]);
  expect(response.status()).toBe(200);
  const commandPayload = request.postDataJSON() as Record<string, unknown>;
  const originalResponse = await response.json() as unknown;
  const duplicateResponse = await browserRequest(page, `${apiOrigin}/api/commands`, 'POST', commandPayload);
  expect(duplicateResponse.status).toBe(200);
  expect(duplicateResponse.body).toEqual(originalResponse);

  current = await currentWorld(page, apiOrigin);
  const workshop = current.buildings.find((building) => building.kind === 'workshop');
  const order = current.buildOrders.find((candidate) => candidate.buildingId === workshop?.id);
  expect(workshop).toBeDefined();
  expect(order).toBeDefined();
  expect(order).toMatchObject({ status: 'in_progress', assignedResidentId: 'worker-2' });
  expect(workshop!.reservedWood + (resident(current, 'worker-2').cargoItemId === 'wood'
    ? resident(current, 'worker-2').cargo : 0)).toBe(12);
  expect(current.resources.wood).toBe(89);

  current = await currentWorld(page, apiOrigin);
  expect(current.buildOrders.find((candidate) => candidate.id === order!.id))
    .toMatchObject({ status: 'in_progress', assignedResidentId: 'worker-2', requiresExplicitBuilder: false });
  const assignedWorkshop = current.buildings.find((building) => building.id === workshop!.id)!;
  const builderAtDispatch = resident(current, 'worker-2');
  expect(assignedWorkshop.reservedWood + (builderAtDispatch.cargoItemId === 'wood' ? builderAtDispatch.cargo : 0))
    .toBe(12);
  expect(assignedWorkshop).toMatchObject({ reservedStone: 0 });
  expect(current.resources.wood + assignedWorkshop.reservedWood +
    (builderAtDispatch.cargoItemId === 'wood' ? builderAtDispatch.cargo : 0)).toBe(101);
  expect(current.resources).toEqual({ wood: 89, stone: 0 });
  expect(current.buildOrders.filter((candidate) => candidate.buildingId === workshop!.id)).toHaveLength(1);
  expect(current.buildOrders.find((candidate) => candidate.id === order!.id))
    .toMatchObject({ status: 'in_progress', assignedResidentId: 'worker-2' });
  expect(resident(current, 'worker-2').task).toMatchObject({
    kind: 'build-workshop', orderId: order!.id
  });
  expect(resident(current, 'worker-1').task).toMatchObject({
    kind: 'gather-stone', phase: 'carrying_to_build', buildingId: workshop!.id,
    orderId: order!.id, deliveryQuantity: 6
  });
  await page.reload();
  await expect(page.locator('#pairing-summary')).toHaveText('Мир подключён к этому браузеру');
  current = await currentWorld(page, apiOrigin);
  expect(resident(current, 'worker-1').task).toMatchObject({
    kind: 'gather-stone', buildingId: workshop!.id, orderId: order!.id, deliveryQuantity: 6
  });
  restarting = true;
  await restartV2TestServer(page);
  restarting = false;
  await page.reload();
  current = await currentWorld(page, apiOrigin);
  expect(current.buildings.find((building) => building.id === workshop!.id)).toBeDefined();
  expect(current.buildOrders.find((candidate) => candidate.id === order!.id)).toBeDefined();

  await expect.poll(async () => (await currentWorld(page, apiOrigin)).buildOrders
    .find((candidate) => candidate.id === order!.id)?.status, { timeout: 90_000 }).toBe('completed');
  current = await currentWorld(page, apiOrigin);
  expect(current.buildings.find((building) => building.id === workshop!.id))
    .toMatchObject({ kind: 'workshop', state: 'complete', reservedWood: 0, reservedStone: 0 });
  expect(current.resources.wood).toBe(89);
  expect(current.resources.wood + current.resources.stone).toBeLessThanOrEqual(current.storage.capacity);
  expect(current.stoneDeposits[0]).toMatchObject({ remaining: 582, bufferQuantity: 0 });
  const leftoverStone = current.resources.stone + current.residents.reduce((sum, actor) =>
    sum + (actor.cargoItemId === 'stone' ? actor.cargo : 0), 0);
  expect(leftoverStone).toBe(12);
  expect(resident(current, 'worker-1')).toMatchObject({
    workRole: 'stone_miner', cargoItemId: 'stone', task: { kind: 'gather-stone' }
  });
  expect(resident(current, 'worker-1').cargo).toBeGreaterThan(0);
  expect(resident(current, 'worker-2')).toMatchObject({ workRole: 'builder', cargo: 0, task: null });
  expect(current.resources.stone + current.residents.reduce((sum, actor) =>
    sum + (actor.cargoItemId === 'stone' ? actor.cargo : 0), 0) + current.stoneDeposits[0]!.remaining)
    .toBe(600 - 6);
  expect(errors).toEqual([]);

  const evidencePath = path.join(projectRoot, 'docs/v2/evidence/G3/G3.3-P1-FULL-STORE');
  await mkdir(evidencePath, { recursive: true });
  await page.screenshot({ path: path.join(evidencePath, 'full-store-workshop-complete.png'), fullPage: true });
  const sourceFiles = [
    'apps/client-v2/src/main.ts', 'apps/client-v2/src/settlement-scene.ts', 'apps/client-v2/e2e/peaceful-slice.spec.ts',
    'apps/server-v2/src/server.ts', 'apps/server-v2/src/cli/reset-test-world.ts',
    'packages/peace-v2-shared/src/index.ts', 'packages/peace-v2-sim/src/settlement.ts',
    'packages/peace-v2-sim/test/settlement.test.ts'
  ];
  const sourceSha256 = Object.fromEntries(await Promise.all(sourceFiles.map(async (file) => [
    file, createHash('sha256').update(await readFile(path.join(projectRoot, file))).digest('hex')
  ])));
  await writeFile(path.join(evidencePath, 'playwright.json'), `${JSON.stringify({
    testId: 'V2-G33-P1-FULL-STORE-01', gate: 'G3.3', project: testInfo.project.name,
    result: 'PASS', databaseName: 'avanpost_v2_test', restartedApi: true,
    scenario: 'warehouse full with 100 wood; builder carries 1 wood; stone miner carries 18 stone; workshop consumes exactly 12 wood + 6 stone',
    assertions: [
      'one idempotent build-workshop request creates one order and one building',
      'builder cargo is reserved toward the recipe and miner cargo routes directly to the workshop for the 6-stone deficit',
      'reload and API restart preserve both deliveries, the builder assignment, reservations, and cargo quantities',
      'the workshop completes; 11 leftover stone enters the newly freed shared storage space and 1 remains in real resident cargo',
      'the remaining deposit and all material quantities reconcile exactly; permanent work roles remain saved; no console errors'
    ],
    sourceSha256
  }, null, 2)}\n`, 'utf8');
});

test('G3.4 desktop: world-first resident assignment and safe camera gestures', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'peace-v2-desktop', 'Desktop pointer interactions run in the desktop project.');
  await mkdir(g34EvidencePath, { recursive: true });
  await resetTestWorld('g34-source-assignment');
  const desktopUrl = computerUrl();
  const apiOrigin = browserApiOrigin();
  const errors: string[] = [];
  let assignmentRequests = 0;
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('request', (request) => {
    if (request.method() === 'POST' && request.url().endsWith('/api/commands') &&
        (request.postData() ?? '').includes('assign-resident')) assignmentRequests += 1;
  });

  await page.goto(desktopUrl);
  page.setDefaultTimeout(10_000);
  await expect(page.locator('#world-scene canvas')).toBeVisible();
  await pairCurrentPage(page);
  await assertViewportBudget(page);
  const layout = await page.evaluate(() => ({
    viewport: innerWidth,
    scene: document.querySelector('#world-scene')?.getBoundingClientRect().width ?? 0,
    legacyList: Boolean(document.querySelector('#resident-list')),
    sidePanel: Boolean(document.querySelector('.right-panel, .game-sidebar, .inspector-panel'))
  }));
  expect(layout.scene).toBeGreaterThan(layout.viewport * 0.85);
  expect(layout.legacyList).toBe(false);
  expect(layout.sidePanel).toBe(false);

  const canvas = page.locator('#world-scene canvas');
  const canvasBounds = await canvas.boundingBox();
  if (!canvasBounds) throw new Error('Phaser canvas is missing in the desktop viewport.');
  const zoomPoint = { x: canvasBounds.width * 0.72, y: canvasBounds.height * 0.38 };
  const worldUnderZoomPoint = () => page.locator('#world-scene').evaluate((element, point) => {
    const data = (element as HTMLElement).dataset;
    const zoom = Number(data.cameraZoom ?? '1');
    return {
      x: Number(data.cameraWorldViewX ?? '0') + (point.x / point.width * Number(data.cameraViewportWidth ?? '1') - Number(data.cameraViewportX ?? '0')) / zoom,
      y: Number(data.cameraWorldViewY ?? '0') + (point.y / point.height * Number(data.cameraViewportHeight ?? '1') - Number(data.cameraViewportY ?? '0')) / zoom
    };
  }, { ...zoomPoint, width: canvasBounds.width, height: canvasBounds.height });
  const beforeDesktopZoom = await worldUnderZoomPoint();
  const desktopZoom = Number(await page.locator('#world-scene').getAttribute('data-camera-zoom'));
  await page.mouse.move(canvasBounds.x + zoomPoint.x, canvasBounds.y + zoomPoint.y);
  await page.mouse.wheel(0, -180);
  await expect.poll(async () => Number(await page.locator('#world-scene').getAttribute('data-camera-zoom')))
    .toBeGreaterThan(desktopZoom);
  const afterDesktopZoom = await worldUnderZoomPoint();
  expect(Math.abs(afterDesktopZoom.x - beforeDesktopZoom.x)).toBeLessThan(4);
  expect(Math.abs(afterDesktopZoom.y - beforeDesktopZoom.y)).toBeLessThan(4);

  await selectResidentByCanvasTap(page, apiOrigin, 'worker-1', 'Илья');
  await expect(page.locator('#world-context')).toBeVisible();
  await expect(page.locator('#resident-work-role')).toBeVisible();
  const treeAssignmentResponse = page.waitForResponse((response) => response.request().method() === 'POST' &&
    response.url().endsWith('/api/commands') && (response.request().postData() ?? '').includes('assign-resident'));
  await dragResidentToTarget(page, apiOrigin, 'worker-1', 'tree', 0, async () => {
    await expect(page.locator('#drag-hint')).toHaveText('Добывать древесину');
    await expect(page.locator('#drag-hint')).toHaveAttribute('data-state', 'valid');
    await expect(page.locator('#world-scene')).toHaveAttribute('data-resident-drag-active', 'true');
    await expect.poll(async () => Number(await page.locator('#world-scene').getAttribute('data-assignable-drop-target-count')))
      .toBeGreaterThan(0);
    await page.screenshot({ path: testInfo.outputPath('g35-desktop-drag-preview.png') });
  });
  const treeAssignment = await treeAssignmentResponse;
  expect(treeAssignment.status()).toBe(200);
  const immediateTreeWorld = await treeAssignment.json() as WorldSnapshot;
  expect(resident(immediateTreeWorld, 'worker-1')).toMatchObject({
    workRole: 'woodcutter', task: { kind: 'gather-wood', sourceId: 'tree-1' }
  });
  await expect.poll(async () => resident(await currentWorld(page, apiOrigin), 'worker-1').workRole).toBe('woodcutter');
  expect(assignmentRequests).toBe(1);

  await dragResidentToTarget(page, apiOrigin, 'worker-2', 'stone');
  await expect.poll(async () => {
    const current = await currentWorld(page, apiOrigin);
    return [resident(current, 'worker-2').workRole, resident(current, 'worker-2').task?.kind,
      resident(current, 'worker-2').task?.sourceId].join('|');
  }).toBe('stone_miner|gather-stone|stone-vein-1');
  expect(assignmentRequests).toBe(2);
  await clickCanvasDataset(page, 'firstStoneCanvasX', 'firstStoneCanvasY');
  await expect(page.getByRole('heading', { name: 'Каменная жила' })).toBeVisible();
  const objectMenu = await page.locator('#world-context').boundingBox();
  expect(objectMenu).not.toBeNull();
  expect(objectMenu!.x).toBeGreaterThanOrEqual(0);
  expect(objectMenu!.y).toBeGreaterThanOrEqual(0);
  expect(objectMenu!.x + objectMenu!.width).toBeLessThanOrEqual(layout.viewport);
  await page.screenshot({ path: path.join(g34EvidencePath, 'desktop-context-menu.png') });
  await page.getByRole('button', { name: 'Центрировать' }).click();
  await expect(page.locator('#world-context')).toBeHidden();

  expect(assignmentRequests).toBe(2);

  const scene = page.locator('#world-scene');
  const bounds = await canvas.boundingBox();
  if (!bounds) throw new Error('Phaser canvas disappeared before camera gesture verification.');
  const centerBeforePan = Number(await scene.getAttribute('data-camera-center-x'));
  const panStart = { x: bounds.x + bounds.width * 0.9, y: bounds.y + bounds.height * 0.5 };
  await page.mouse.move(panStart.x, panStart.y);
  await page.mouse.down();
  await page.mouse.move(panStart.x + 66, panStart.y + 28, { steps: 8 });
  await page.mouse.up();
  await delay(100);
  const cameraAfterPan = await scene.evaluate((element) => ({ ...(element as HTMLElement).dataset }));
  expect(Number(cameraAfterPan.cameraCenterX), JSON.stringify(cameraAfterPan)).not.toBe(centerBeforePan);
  expect(assignmentRequests).toBe(2);
  const afterPan = await currentWorld(page, apiOrigin);
  expect(resident(afterPan, 'worker-1').task?.kind).toBe('gather-wood');
  expect(resident(afterPan, 'worker-2').task?.kind).toBe('gather-stone');

  await page.reload();
  const reloaded = await currentWorld(page, apiOrigin);
  expect(resident(reloaded, 'worker-1')).toMatchObject({ workRole: 'woodcutter', task: { kind: 'gather-wood', sourceId: 'tree-1' } });
  expect(resident(reloaded, 'worker-2')).toMatchObject({ workRole: 'stone_miner', task: { kind: 'gather-stone', sourceId: 'stone-vein-1' } });
  expect(errors).toEqual([]);
  await page.screenshot({ path: path.join(g34EvidencePath, 'desktop-world-context.png') });
});

test('G3.5.1 construction: role builder autonomously takes the next order and legacy state survives reload', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'peace-v2-desktop', 'Construction workflow runs in the desktop project.');
  await mkdir(g34EvidencePath, { recursive: true });
  await resetTestWorld('g34-legacy-order');
  const apiOrigin = browserApiOrigin();
  const errors: string[] = [];
  let assignmentRequests = 0;
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('request', (request) => {
    if (request.method() === 'POST' && request.url().endsWith('/api/commands') &&
        (request.postData() ?? '').includes('assign-resident')) assignmentRequests += 1;
  });
  await page.goto(computerUrl());
  page.setDefaultTimeout(10_000);
  await pairCurrentPage(page);

  await expect.poll(async () => {
    const world = await currentWorld(page, apiOrigin);
    const order = world.buildOrders.find((candidate) => candidate.id === 'legacy-cabin-order-1');
    return order?.assignedResidentId === 'worker-2' && ['in_progress', 'completed'].includes(order.status);
  }, { timeout: 10_000 }).toBe(true);
  let world = await currentWorld(page, apiOrigin);
  const legacyOrder = world.buildOrders.find((candidate) => candidate.id === 'legacy-cabin-order-1')!;
  expect(legacyOrder.requiresExplicitBuilder ?? false).toBe(false);
  expect(legacyOrder.assignedResidentId).toBe('worker-2');

  await openCatalogAtGround(page, 0);
  await page.getByRole('button', { name: /Домик/ }).click();
  await expect(page.locator('#placement-panel')).toBeVisible();
  await expect.poll(async () => page.locator('#world-scene').getAttribute('data-placement-ghost-kind'))
    .toBe('cabin');
  const ghostSize = await page.locator('#world-scene').evaluate((element) => {
    const data = (element as HTMLElement).dataset;
    return {
      ghost: [Number(data.placementGhostDisplayWidth), Number(data.placementGhostDisplayHeight)],
      building: [Number(data.cabinDisplayWidth), Number(data.cabinDisplayHeight)]
    };
  });
  expect(ghostSize.ghost).toEqual(ghostSize.building);

  await clickPlacementAnchor(page, 3);
  await expect(page.locator('#placement-reason')).toContainText(/занят/);
  await expect(page.getByRole('button', { name: 'Заказать дом' })).toBeDisabled();
  await page.screenshot({ path: path.join(g34EvidencePath, 'invalid-placement-ghost.png') });
  const buildingsBeforeCancel = (await currentWorld(page, apiOrigin)).buildings.length;
  await page.locator('#cancel-placement').click();
  await expect(page.locator('#placement-panel')).toBeHidden();
  expect((await currentWorld(page, apiOrigin)).buildings).toHaveLength(buildingsBeforeCancel);

  await openCatalogAtGround(page, 0);
  await page.getByRole('button', { name: /Домик/ }).click();
  await expect(page.locator('#placement-panel')).toBeVisible();
  await clickPlacementAnchor(page, 0);
  await expect(page.locator('#placement-reason')).toContainText(/подходит/);
  await expect(page.getByRole('button', { name: 'Заказать дом' })).toBeEnabled();
  await page.getByRole('button', { name: 'Заказать дом' }).click();
  await expect.poll(async () => (await currentWorld(page, apiOrigin)).buildings.length).toBe(2);
  world = await currentWorld(page, apiOrigin);
  const newBuilding = world.buildings.find((building) => building.id !== 'legacy-cabin-1')!;
  const newOrder = world.buildOrders.find((order) => order.buildingId === newBuilding.id)!;
  await expect.poll(async () => {
    const current = await currentWorld(page, apiOrigin);
    return current.buildOrders.find((order) => order.id === legacyOrder.id)?.status;
  }, { timeout: 40_000 }).toBe('completed');
  await expect.poll(async () => {
    const current = await currentWorld(page, apiOrigin);
    return current.buildOrders.find((order) => order.id === newOrder.id)?.assignedResidentId;
  }, { timeout: 15_000 }).toBe('worker-2');
  expect(assignmentRequests).toBe(0);
  world = await currentWorld(page, apiOrigin);
  expect(world.buildOrders.find((order) => order.id === newOrder.id))
    .toMatchObject({ status: 'in_progress', assignedResidentId: 'worker-2', queuePosition: 2 });
  expect(world.buildOrders.find((order) => order.id === newOrder.id)?.requiresExplicitBuilder).toBe(false);
  expect(resident(world, 'worker-2')).toMatchObject({ workRole: 'builder', task: { kind: 'build-cabin', orderId: newOrder.id } });

  const savedVersion = world.revision.worldVersion;
  await page.reload();
  world = await currentWorld(page, apiOrigin);
  expect(world.revision.worldVersion).toBeGreaterThanOrEqual(savedVersion);
  expect(world.buildings.find((building) => building.id === newBuilding.id)?.anchor).toEqual({ x: 0, y: -1 });
  expect(world.buildOrders.find((order) => order.id === newOrder.id))
    .toMatchObject({ assignedResidentId: 'worker-2', requiresExplicitBuilder: false });
  expect(resident(world, 'worker-2')).toMatchObject({ workRole: 'builder', task: { kind: 'build-cabin', orderId: newOrder.id } });
  expect(world.resources.wood).toBeGreaterThanOrEqual(0);
  expect(errors).toEqual([]);
  await page.screenshot({ path: path.join(g34EvidencePath, 'construction-context.png') });
});

test('G3.5.1 builder role autonomously completes two queued orders through reload and API restart', async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  test.skip(testInfo.project.name !== 'peace-v2-desktop', 'The desktop project owns authoritative construction assertions.');
  await resetTestWorld('g34-source-assignment');
  const apiOrigin = browserApiOrigin();
  await page.goto(computerUrl());
  page.setDefaultTimeout(10_000);
  await pairCurrentPage(page);

  let world = await currentWorld(page, apiOrigin);
  expect(world.buildOrders).toHaveLength(0);
  const firstOrder = await browserRequest(page, `${apiOrigin}/api/commands`, 'POST', {
    requestId: 'g351-builder-first-order', expectedWorldVersion: world.revision.worldVersion,
    expectedGeometryVersion: world.revision.geometryVersion, kind: 'build-cabin', anchor: { x: 5, y: -1 }
  });
  expect(firstOrder.status).toBe(200);
  world = firstOrder.body as WorldSnapshot;
  const secondOrder = await browserRequest(page, `${apiOrigin}/api/commands`, 'POST', {
    requestId: 'g351-builder-second-order', expectedWorldVersion: world.revision.worldVersion,
    expectedGeometryVersion: world.revision.geometryVersion, kind: 'build-cabin', anchor: { x: 12, y: -1 }
  });
  expect(secondOrder.status).toBe(200);
  world = secondOrder.body as WorldSnapshot;
  expect(world.buildOrders.map((order) => order.status)).toEqual(['waiting_builder', 'waiting_builder']);
  expect(world.buildOrders.map((order) => order.queuePosition)).toEqual([1, 2]);
  expect(world.buildOrders.map((order) => order.assignedResidentId)).toEqual([null, null]);
  await selectWorkerByCanvasTap(page, apiOrigin);
  await page.locator('#resident-work-role').selectOption('builder');

  await expect.poll(async () => (await currentWorld(page, apiOrigin)).buildOrders[0]?.assignedResidentId)
    .toBe('worker-1');
  await expect.poll(async () => {
    const current = await currentWorld(page, apiOrigin);
    return current.buildOrders[0]?.status === 'completed' && current.buildOrders[1]?.assignedResidentId === 'worker-1';
  }, { timeout: 60_000 }).toBe(true);
  await expect.poll(async () => {
    const current = await currentWorld(page, apiOrigin);
    return current.buildOrders.every((order) => order.status === 'completed');
  }, { timeout: 60_000 }).toBe(true);
  world = await currentWorld(page, apiOrigin);
  expect(world.buildOrders.map((order) => order.status)).toEqual(['completed', 'completed']);
  expect(world.buildOrders.map((order) => order.queuePosition)).toEqual([1, 2]);
  expect(world.buildings.map((building) => building.state)).toEqual(['complete', 'complete']);
  expect(world.buildings.every((building) => building.reservedWood === 0 && building.reservedStone === 0)).toBe(true);
  expect(world.resources).toEqual({ wood: 34, stone: 0 });

  const savedRevision = world.revision.worldVersion;
  await page.reload();
  world = await currentWorld(page, apiOrigin);
  expect(world.revision.worldVersion).toBeGreaterThanOrEqual(savedRevision);
  const context = page.context();
  await restartV2TestServer(page);
  const restartedPage = page.isClosed() ? await context.newPage() : page;
  await restartedPage.goto(computerUrl(), { waitUntil: 'domcontentloaded' });
  await expect(restartedPage.getByRole('heading', { name: 'Новый берег' })).toBeVisible();
  world = await currentWorld(restartedPage, apiOrigin);
  expect(world.buildOrders.map((order) => order.status)).toEqual(['completed', 'completed']);
  expect(world.buildings.map((building) => building.state)).toEqual(['complete', 'complete']);
  expect(resident(world, 'worker-1')).toMatchObject({ workRole: 'builder', task: null, cargo: 0 });
});

test('G3.4 full-store stone cargo: real builder drag starts a workshop and preserves the cargo', async ({ page }, testInfo) => {
  test.setTimeout(90_000);
  test.skip(testInfo.project.name !== 'peace-v2-desktop', 'Construction workflow runs in the desktop project.');
  await mkdir(g34EvidencePath, { recursive: true });
  await resetTestWorld('g34-full-store-stone-cargo');
  const apiOrigin = browserApiOrigin();
  await page.goto(computerUrl());
  page.setDefaultTimeout(10_000);
  await pairCurrentPage(page);

  let world = await currentWorld(page, apiOrigin);
  expect(world.resources).toEqual({ wood: 77, stone: 23 });
  expect(resident(world, 'worker-1')).toMatchObject({
    workRole: 'none', cargo: 1, cargoItemId: 'stone', task: { kind: 'gather-stone', phase: 'waiting_storage' }
  });
  await openCatalogAtGround(page, 0);
  await page.getByRole('button', { name: /Мастерская/ }).click();
  await expect(page.locator('#placement-panel')).toBeVisible();
  await clickPlacementAnchor(page, 5);
  await page.getByRole('button', { name: 'Заказать мастерскую' }).click();
  await expect.poll(async () => (await currentWorld(page, apiOrigin)).buildings.length).toBe(1);
  world = await currentWorld(page, apiOrigin);
  const building = world.buildings[0]!;
  const order = world.buildOrders.find((candidate) => candidate.buildingId === building.id)!;
  expect(building.kind).toBe('workshop');
  expect(order).toMatchObject({ status: 'waiting_builder', assignedResidentId: null });
  await page.screenshot({ path: path.join(g34EvidencePath, 'full-store-stone-cargo-before-assignment.png') });
  const dragHitTest = await page.locator('#world-scene').evaluate((element) => {
    const data = (element as HTMLElement).dataset;
    const canvas = document.querySelector<HTMLCanvasElement>('#world-scene canvas')!;
    const bounds = canvas.getBoundingClientRect();
    const hit = (key: string) => document.elementFromPoint(
      bounds.left + Number(data[`${key}CanvasX`]), bounds.top + Number(data[`${key}CanvasY`])
    );
    return {
      resident: [data.resident0CanvasX, data.resident0CanvasY], building: [data.building0CanvasX, data.building0CanvasY],
      sourceTag: hit('resident0')?.tagName, sourceClass: (hit('resident0') as HTMLElement | null)?.className,
      targetTag: hit('building0')?.tagName, targetClass: (hit('building0') as HTMLElement | null)?.className
    };
  });

  const assignmentResponse = page.waitForResponse((response) => response.request().method() === 'POST' &&
    response.url().endsWith('/api/commands') && (response.request().postData() ?? '').includes('assign-resident'),
  { timeout: 30_000 });
  await dragResidentToTarget(page, apiOrigin, 'worker-1', 'building', 0);
  const response = await assignmentResponse;
  expect(response.status(), JSON.stringify(dragHitTest)).toBe(200);
  let started = await currentWorld(page, apiOrigin);
  expect(started.resources).toEqual({ wood: 65, stone: 18 });
  expect(started.buildings.find((candidate) => candidate.id === building.id))
    .toMatchObject({ state: 'in_progress', reservedWood: 12 });
  expect(started.buildings.find((candidate) => candidate.id === building.id)!.reservedStone +
    resident(started, 'worker-1').cargo).toBe(6);
  expect(started.buildOrders.find((candidate) => candidate.id === order.id))
    .toMatchObject({ status: 'in_progress', assignedResidentId: 'worker-1', requiresExplicitBuilder: false });
  expect(resident(started, 'worker-1')).toMatchObject({ workRole: 'builder',
    task: { kind: 'build-workshop', orderId: order.id } });
  const competingBuilder = await browserRequest(page, `${apiOrigin}/api/commands`, 'POST', {
    requestId: 'g34-second-builder-same-order', expectedWorldVersion: started.revision.worldVersion,
    expectedGeometryVersion: started.revision.geometryVersion, kind: 'assign-resident', residentId: 'worker-2',
    target: { kind: 'build-order', orderId: order.id }
  });
  expect(competingBuilder.status).toBe(409);
  expect(competingBuilder.body).toMatchObject({ code: 'WORKER_BUSY' });
  const afterConflict = await currentWorld(page, apiOrigin);
  expect(afterConflict.buildOrders.find((candidate) => candidate.id === order.id)?.assignedResidentId).toBe('worker-1');
  const workshopAfterConflict = afterConflict.buildings.find((candidate) => candidate.id === building.id)!;
  expect(workshopAfterConflict.reservedWood).toBe(12);
  expect(workshopAfterConflict.reservedStone + resident(afterConflict, 'worker-1').cargo).toBe(6);
  expect(resident(afterConflict, 'worker-2')).toMatchObject({ workRole: 'none', cargo: 0, task: null });

  await expect.poll(async () => (await currentWorld(page, apiOrigin)).buildOrders
    .find((candidate) => candidate.id === order.id)?.status, { timeout: 45_000 }).toBe('completed');
  await expect.poll(async () => {
    const current = await currentWorld(page, apiOrigin);
    return [resident(current, 'worker-1').cargo, current.resources.wood, current.resources.stone].join('|');
  }, { timeout: 20_000 }).toBe('0|65|18');
  started = await currentWorld(page, apiOrigin);
  expect(started.buildings.find((candidate) => candidate.id === building.id))
    .toMatchObject({ state: 'complete', reservedWood: 0, reservedStone: 0, progressTicks: 10 });
  expect(started.buildOrders.find((candidate) => candidate.id === order.id)?.status).toBe('completed');

  const savedVersion = started.revision.worldVersion;
  await page.reload();
  started = await currentWorld(page, apiOrigin);
  expect(started.revision.worldVersion).toBeGreaterThanOrEqual(savedVersion);
  expect(started.buildOrders.find((candidate) => candidate.id === order.id)?.status).toBe('completed');
  expect(started.resources).toEqual({ wood: 65, stone: 18 });
  await restartV2TestServer(page);
  await page.reload();
  const afterRestart = await currentWorld(page, apiOrigin);
  expect(afterRestart.buildings.find((candidate) => candidate.id === building.id))
    .toMatchObject({ kind: 'workshop', state: 'complete', reservedWood: 0, reservedStone: 0 });
  expect(afterRestart.buildOrders.find((candidate) => candidate.id === order.id)?.status).toBe('completed');
  expect(afterRestart.resources).toEqual({ wood: 65, stone: 18 });
});

test('G3.4 P1: drag stone-carrying builder to a house and finish without losing cargo', async ({ page }, testInfo) => {
  test.setTimeout(90_000);
  test.skip(testInfo.project.name !== 'peace-v2-desktop', 'Construction workflow runs in the desktop project.');
  await mkdir(g34EvidencePath, { recursive: true });
  await resetTestWorld('g34-full-store-stone-cargo');
  const apiOrigin = browserApiOrigin();
  await page.goto(computerUrl());
  page.setDefaultTimeout(10_000);
  await pairCurrentPage(page);

  let world = await currentWorld(page, apiOrigin);
  expect(world.resources).toEqual({ wood: 77, stone: 23 });
  expect(resident(world, 'worker-1')).toMatchObject({
    workRole: 'none', cargo: 1, cargoItemId: 'stone', task: { kind: 'gather-stone', phase: 'waiting_storage' }
  });
  await openCatalogAtGround(page, 0);
  await page.locator('#cabin-catalog-item').click();
  await expect(page.locator('#placement-panel')).toBeVisible();
  await clickPlacementAnchor(page, 5);
  await page.getByRole('button', { name: 'Заказать дом' }).click();
  await expect.poll(async () => (await currentWorld(page, apiOrigin)).buildings.length).toBe(1);
  world = await currentWorld(page, apiOrigin);
  const house = world.buildings[0]!;
  const order = world.buildOrders.find((candidate) => candidate.buildingId === house.id)!;
  expect(house.kind).toBe('cabin');
  expect(order).toMatchObject({ status: 'waiting_builder', assignedResidentId: null });
  await page.screenshot({ path: path.join(g34EvidencePath, 'stone-carrying-cabin-waiting-builder.png') });

  const assignmentResponse = page.waitForResponse((response) => response.request().method() === 'POST' &&
    response.url().endsWith('/api/commands') && (response.request().postData() ?? '').includes('assign-resident'),
  { timeout: 30_000 });
  await dragResidentToTarget(page, apiOrigin, 'worker-1', 'building', 0);
  expect((await assignmentResponse).status()).toBe(200);
  let assigned = await currentWorld(page, apiOrigin);
  expect(assigned.resources).toEqual({ wood: 74, stone: 23 });
  expect(assigned.buildings.find((candidate) => candidate.id === house.id))
    .toMatchObject({ state: 'in_progress', reservedWood: 3, reservedStone: 0 });
  expect(assigned.buildOrders.find((candidate) => candidate.id === order.id))
    .toMatchObject({ status: 'in_progress', assignedResidentId: 'worker-1', requiresExplicitBuilder: false });
  expect(resident(assigned, 'worker-1')).toMatchObject({ cargo: 1, cargoItemId: 'stone',
    task: { kind: 'build-cabin', orderId: order.id } });

  await expect.poll(async () => (await currentWorld(page, apiOrigin)).buildOrders
    .find((candidate) => candidate.id === order.id)?.status, { timeout: 45_000 }).toBe('completed');
  await expect.poll(async () => {
    const current = await currentWorld(page, apiOrigin);
    return [resident(current, 'worker-1').cargo, current.resources.wood, current.resources.stone].join('|');
  }, { timeout: 20_000 }).toBe('0|74|24');
  await page.reload();
  assigned = await currentWorld(page, apiOrigin);
  expect(assigned.buildings.find((candidate) => candidate.id === house.id))
    .toMatchObject({ kind: 'cabin', state: 'complete', reservedWood: 0, reservedStone: 0, progressTicks: 10 });
  expect(assigned.buildOrders.find((candidate) => candidate.id === order.id)?.status).toBe('completed');
  expect(resident(assigned, 'worker-1').cargo).toBe(0);
  expect(assigned.resources).toEqual({ wood: 74, stone: 24 });
  await page.screenshot({ path: path.join(g34EvidencePath, 'stone-carrying-cabin-complete.png') });
});

test('G3.4 material wait separates free stone from stone reserved by another order', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'peace-v2-desktop', 'Order material details run in the desktop project.');
  await resetTestWorld('g34-reserved-stone');
  const apiOrigin = browserApiOrigin();
  await page.goto(computerUrl());
  page.setDefaultTimeout(10_000);
  await pairCurrentPage(page);

  const world = await currentWorld(page, apiOrigin);
  expect(world.resources).toEqual({ wood: 41, stone: 0 });
  expect(world.buildings.find((candidate) => candidate.id === 'workshop-reserved-1'))
    .toMatchObject({ reservedWood: 12, reservedStone: 6 });
  const waitingOrder = world.buildOrders.find((candidate) => candidate.id === 'workshop-waiting-order-2')!;
  expect(waitingOrder).toMatchObject({
    status: 'waiting_materials', assignedResidentId: 'worker-2', blockedReason: 'INSUFFICIENT_STONE'
  });
  expect(world.buildings.find((candidate) => candidate.id === 'workshop-waiting-2'))
    .toMatchObject({ reservedWood: 12, reservedStone: 0 });

  await selectBuildingByCanvasTap(page, apiOrigin, 'workshop-waiting-2');
  await expect(page.locator('#build-order-list')).toContainText('Ждёт камень');
  await expect(page.locator('#build-order-list')).toContainText(
    'Камень: нужно 6, свободно 0, всего 6 · резерв 6 (этот заказ 0, другие 6) · не хватает 6'
  );
  await expect(page.locator('#inspector-detail')).toContainText('Камень: нужно 6, свободно 0, всего 6');

  const unchanged = await currentWorld(page, apiOrigin);
  expect(unchanged.resources).toEqual({ wood: 41, stone: 0 });
  expect(unchanged.buildOrders.find((candidate) => candidate.id === 'workshop-reserved-order-1')?.status).toBe('in_progress');
  expect(unchanged.buildings.find((candidate) => candidate.id === 'workshop-reserved-1'))
    .toMatchObject({ reservedWood: 12, reservedStone: 6 });
  expect(unchanged.buildOrders.find((candidate) => candidate.id === waitingOrder.id))
    .toMatchObject({ status: 'waiting_materials', assignedResidentId: 'worker-2', blockedReason: 'INSUFFICIENT_STONE' });
});

test('G3.5 retry after a lost response replays the same assignment without duplicate effects', async ({ page }, testInfo) => {
  test.setTimeout(90_000);
  test.skip(testInfo.project.name !== 'peace-v2-desktop', 'The command retry flow runs in the desktop project.');
  await resetTestWorld('g34-source-assignment');
  const apiOrigin = browserApiOrigin();
  await page.goto(computerUrl());
  page.setDefaultTimeout(10_000);
  await pairCurrentPage(page);
  await openCatalogAtGround(page, -2);
  await page.locator('#cabin-catalog-item').click();
  await clickPlacementAnchor(page, 5);
  await page.getByRole('button', { name: 'Заказать дом' }).click();
  await expect.poll(async () => (await currentWorld(page, apiOrigin)).buildings.length).toBe(1);
  const building = (await currentWorld(page, apiOrigin)).buildings[0]!;
  const order = (await currentWorld(page, apiOrigin)).buildOrders.find((candidate) => candidate.buildingId === building.id)!;

  let lostFirstResponse = false;
  const assignmentPayloads: string[] = [];
  await page.route('**/api/commands', async (route) => {
    const request = route.request();
    const isAssignment = request.method() === 'POST' && (request.postData() ?? '').includes('assign-resident');
    if (!isAssignment) return route.continue();
    assignmentPayloads.push(request.postData() ?? '');
    if (lostFirstResponse) return route.continue();
    lostFirstResponse = true;
    const committed = await route.fetch();
    expect(committed.status()).toBe(200);
    await route.abort('failed');
  });

  await dragResidentToTarget(page, apiOrigin, 'worker-1', 'building', 0, async () => {
    await expect(page.locator('#drag-hint')).toContainText('Строить дом');
  });
  await expect(page.locator('#retry-command')).toBeVisible();
  await expect(page.locator('#action-status')).toContainText('Повторите действие');
  let world = await currentWorld(page, apiOrigin);
  expect(world.buildOrders.find((candidate) => candidate.id === order.id))
    .toMatchObject({ status: 'in_progress', assignedResidentId: 'worker-1' });
  expect(world.resources.wood).toBe(37);
  expect(world.buildings.find((candidate) => candidate.id === building.id)?.reservedWood).toBe(3);

  const replayResponse = page.waitForResponse((response) => response.request().method() === 'POST' &&
    response.url().endsWith('/api/commands') && (response.request().postData() ?? '').includes('assign-resident'));
  await page.getByRole('button', { name: 'Повторить' }).click();
  expect((await replayResponse).status()).toBe(200);
  expect(assignmentPayloads).toHaveLength(2);
  expect(assignmentPayloads[1]).toBe(assignmentPayloads[0]);
  await page.unroute('**/api/commands');
  await expect.poll(async () => (await currentWorld(page, apiOrigin)).buildOrders
    .find((candidate) => candidate.id === order.id)?.assignedResidentId).toBe('worker-1');
  world = await currentWorld(page, apiOrigin);
  expect(world.buildings).toHaveLength(1);
  expect(world.buildOrders).toHaveLength(1);
  expect(world.resources.wood).toBe(37);
  expect(world.buildings[0]?.reservedWood).toBe(3);
  await page.reload();
  world = await currentWorld(page, apiOrigin);
  expect(world.buildOrders[0]).toMatchObject({ id: order.id, assignedResidentId: 'worker-1', status: 'in_progress' });
  expect(world.resources.wood).toBe(37);
});

test('G3.5 uprooted tree shows an invalid drop state and issues no command', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'peace-v2-desktop', 'The desktop pointer feedback flow runs in the desktop project.');
  await resetTestWorld('g35-uprooted-target');
  const apiOrigin = browserApiOrigin();
  let assignmentRequests = 0;
  page.on('request', (request) => {
    if (request.method() === 'POST' && request.url().endsWith('/api/commands') &&
        (request.postData() ?? '').includes('assign-resident')) assignmentRequests += 1;
  });
  await page.goto(computerUrl());
  await page.setDefaultTimeout(10_000);
  await pairCurrentPage(page);
  const before = await currentWorld(page, apiOrigin);
  expect(before.trees.every((tree) => tree.state === 'uprooted')).toBe(true);

  await dragResidentToTarget(page, apiOrigin, 'worker-1', 'tree', 0, async () => {
    await expect(page.locator('#drag-hint')).toContainText('Недопустимая цель');
    await expect(page.locator('#drag-hint')).toHaveAttribute('data-state', 'invalid');
    await expect(page.locator('#world-scene')).not.toHaveAttribute('data-assignable-drop-target-kinds', /tree/);
  });
  expect(assignmentRequests).toBe(0);
  const after = await currentWorld(page, apiOrigin);
  expect(after.residents.find((resident) => resident.id === 'worker-1'))
    .toMatchObject({ workRole: 'none', task: null, cargo: 0 });
  expect(after.buildOrders).toHaveLength(0);
});

test('G3.5 server refusal is shown when another builder wins the site first', async ({ page }, testInfo) => {
  test.setTimeout(90_000);
  test.skip(testInfo.project.name !== 'peace-v2-desktop', 'The server-conflict feedback flow runs in the desktop project.');
  await resetTestWorld('g34-source-assignment');
  const apiOrigin = browserApiOrigin();
  await page.goto(computerUrl());
  page.setDefaultTimeout(10_000);
  await pairCurrentPage(page);
  await openCatalogAtGround(page, -2);
  await page.locator('#cabin-catalog-item').click();
  await clickPlacementAnchor(page, 5);
  await page.getByRole('button', { name: 'Заказать дом' }).click();
  await expect.poll(async () => (await currentWorld(page, apiOrigin)).buildings.length).toBe(1);
  const staleWorld = await currentWorld(page, apiOrigin);
  const building = staleWorld.buildings[0]!;
  const order = staleWorld.buildOrders.find((candidate) => candidate.buildingId === building.id)!;
  let freezePageWorld = false;
  await page.route('**/api/world', async (route) => {
    if (freezePageWorld) {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(staleWorld) });
    } else {
      await route.continue();
    }
  });
  freezePageWorld = true;
  const winner = await browserRequest(page, `${apiOrigin}/api/commands`, 'POST', {
    requestId: 'g35-worker-2-wins-house-site', expectedWorldVersion: staleWorld.revision.worldVersion,
    expectedGeometryVersion: staleWorld.revision.geometryVersion, kind: 'assign-resident', residentId: 'worker-2',
    target: { kind: 'build-order', orderId: order.id }
  });
  expect(winner.status).toBe(200);
  const refusedResponse = page.waitForResponse((response) => response.request().method() === 'POST' &&
    response.url().endsWith('/api/commands') && (response.request().postData() ?? '').includes('assign-resident'));
  await dragResidentToTarget(page, apiOrigin, 'worker-1', 'building', 0);
  const refusal = await refusedResponse;
  expect(refusal.status()).toBe(409);
  expect((await refusal.json() as { code: string; detail: string })).toMatchObject({
    code: 'WORKER_BUSY', detail: 'У этой площадки уже есть назначенный строитель.'
  });
  await expect(page.locator('#action-status')).toHaveText('У этой площадки уже есть назначенный строитель.');
  const authoritative = await currentWorld(page, apiOrigin);
  expect(authoritative.buildOrders.find((candidate) => candidate.id === order.id))
    .toMatchObject({ status: 'in_progress', assignedResidentId: 'worker-2' });
  expect(authoritative.buildOrders).toHaveLength(1);
  freezePageWorld = false;
  await page.unroute('**/api/world');
  await page.reload();
  expect((await currentWorld(page, apiOrigin)).buildOrders.find((candidate) => candidate.id === order.id)?.assignedResidentId)
    .toBe('worker-2');
});

test('G3.4 mobile: touch selects residents then targets without accidental camera assignment', async ({ page }, testInfo) => {
  test.setTimeout(60_000);
  test.skip(testInfo.project.name !== 'peace-v2-mobile', 'Touch interactions run in the mobile project.');
  await mkdir(g34EvidencePath, { recursive: true });
  await resetTestWorld('g34-source-assignment');
  const apiOrigin = browserApiOrigin(true);
  let assignmentRequests = 0;
  const browserErrors: string[] = [];
  page.on('console', (message) => { if (message.type() === 'error') browserErrors.push(message.text()); });
  page.on('pageerror', (error) => browserErrors.push(error.message));
  page.on('requestfailed', (request) => browserErrors.push(`${request.url()} ${request.failure()?.errorText ?? 'request failed'}`));
  page.on('request', (request) => {
    if (request.method() === 'POST' && request.url().endsWith('/api/commands') &&
        (request.postData() ?? '').includes('assign-resident')) assignmentRequests += 1;
  });
  await page.goto(phoneUrl());
  await page.setViewportSize({ width: 390, height: 844 });
  const mobilePairingCode = await page.evaluate(async (port) => {
    const response = await fetch(`http://127.0.0.1:${port}/api/launcher/pairing-code`, { mode: 'cors' });
    if (!response.ok) throw new Error(`Handoff request failed (${response.status}).`);
    return (await response.json() as { code: string }).code;
  }, Number(process.env.AVANPOST_V2_TEST_HANDOFF_PORT ?? '18889'));
  await page.getByLabel('Одноразовый код').fill(mobilePairingCode);
  await page.getByRole('button', { name: 'Подключить' }).click();
  await expect(page.locator('#pairing-summary')).toHaveText('Мир подключён к этому браузеру');
  await expect.poll(async () => page.locator('#health-status').innerText()).toBe('Мир сохранён');
  await expect.poll(async () => page.locator('#world-scene').getAttribute('data-stone-texture-size'))
    .toBe('1536x1024');
  await expect.poll(async () => page.locator('#world-scene').getAttribute('data-stone-sprite-texture-key'))
    .toBe('stone-outcrop');
  await expect.poll(async () => page.locator('#world-scene').getAttribute('data-stone-texture-loaded')).toBe('true');
  await assertViewportBudget(page);
  expect(await documentWidth(page)).toBeLessThanOrEqual(390);

  const mobileCatalogAnchor = await findEmptySurfaceAnchor(page, apiOrigin);
  await tapWorldCell(page, mobileCatalogAnchor);
  await delay(120);
  if (!await page.locator('#building-catalog').isVisible()) {
    const clickDebug = await page.locator('#world-scene').evaluate((element) => ({
      data: { ...((element as HTMLElement).dataset) },
      heading: document.querySelector('#inspector-title')?.textContent,
      kind: document.querySelector('#context-kind')?.textContent
    }));
    throw new Error(`Mobile ground tap did not open the catalog at anchor=${mobileCatalogAnchor}: ${JSON.stringify(clickDebug)}`);
   }
   await expect(page.locator('#building-catalog')).toBeVisible();
  await expect(page.locator('#cabin-availability')).toContainText('Материалы доступны');
  await expect(page.locator('#workshop-availability')).toContainText(/Заказ будет ждать: не хватает камня 6/);
  await touchTapLocator(page, page.locator('#cabin-catalog-item'));
  await expect(page.locator('#placement-panel')).toBeVisible();
  await expect.poll(async () => page.locator('#world-scene').getAttribute('data-placement-ghost-kind'))
    .toBe('cabin');
  const mobileGhost = await page.locator('#world-scene').evaluate((element) => {
    const data = (element as HTMLElement).dataset;
    return [Number(data.placementGhostDisplayWidth), Number(data.placementGhostDisplayHeight)];
  });
  expect(mobileGhost).toEqual([142, 120]);
  await tapWorldCell(page, 3);
  await expect(page.locator('#placement-reason')).toContainText(/занят/);
  await expect(page.locator('#confirm-placement')).toBeDisabled();
  await tapWorldCell(page, 0);
  await expect(page.locator('#placement-reason')).toContainText(/подходит/);
  await touchTapLocator(page, page.locator('#confirm-placement'));
  await expect.poll(async () => (await currentWorld(page, apiOrigin)).buildings.length).toBe(1);
  let mobileWorld = await currentWorld(page, apiOrigin);
  const mobileBuilding = mobileWorld.buildings[0]!;
  const mobileOrder = mobileWorld.buildOrders.find((order) => order.buildingId === mobileBuilding.id)!;
  expect(mobileOrder).toMatchObject({ status: 'waiting_builder', assignedResidentId: null });

  await tapCanvasDataset(page, 'resident0CanvasX', 'resident0CanvasY');
  await expect(page.getByRole('heading', { name: 'Илья' })).toBeVisible();
  await touchTapLocator(page, page.getByRole('button', { name: 'Закрыть меню' }));
  await selectBuildingByCanvasTap(page, apiOrigin, mobileBuilding.id);
  await expect(page.getByRole('heading', { name: 'Дом' })).toBeVisible();
  const assignTargetBox = await page.locator('#assign-target').boundingBox();
  expect(assignTargetBox).not.toBeNull();
  expect(assignTargetBox!.height).toBeGreaterThanOrEqual(44);
  const constructionMenu = await page.locator('#world-context').boundingBox();
  expect(constructionMenu).not.toBeNull();
  expect(constructionMenu!.x + constructionMenu!.width).toBeLessThanOrEqual(390);
  expect(constructionMenu!.y + constructionMenu!.height).toBeLessThanOrEqual(844);
  await page.screenshot({ path: path.join(g34EvidencePath, 'mobile-building-menu.png') });
  await touchTapLocator(page, page.locator('#assign-target'));
  await expect.poll(async () => (await currentWorld(page, apiOrigin)).buildOrders
    .find((order) => order.id === mobileOrder.id)?.assignedResidentId).toBe('worker-1');
  expect(assignmentRequests).toBe(1);
  mobileWorld = await currentWorld(page, apiOrigin);
  expect(resident(mobileWorld, 'worker-1')).toMatchObject({ workRole: 'builder', task: { kind: 'build-cabin', orderId: mobileOrder.id } });
  await page.screenshot({ path: path.join(g34EvidencePath, 'mobile-context.png') });

  const mobileWoodAssignment = page.waitForResponse((response) => response.request().method() === 'POST' &&
    response.url().endsWith('/api/commands') && (response.request().postData() ?? '').includes('assign-resident'));
  await touchDragResidentToTarget(page, apiOrigin, 'worker-2', 'tree', 0, 'Добывать древесину', async () => {
    await page.screenshot({ path: testInfo.outputPath('g35-mobile-drag-preview.png') });
  });
  expect((await mobileWoodAssignment).status()).toBe(200);
  await expect.poll(async () => {
    const current = await currentWorld(page, apiOrigin);
    return [resident(current, 'worker-2').workRole, resident(current, 'worker-2').task?.kind].join('|');
  }).toBe('woodcutter|gather-wood');

  const scene = page.locator('#world-scene');
  const canvas = page.locator('#world-scene canvas');
  const box = await canvas.boundingBox();
  if (!box) throw new Error('Mobile Phaser canvas is missing.');
  const cdp = await page.context().newCDPSession(page);
  const beforeCamera = await scene.evaluate((element) => ({
    x: Number((element as HTMLElement).dataset.cameraCenterX),
    zoom: Number((element as HTMLElement).dataset.cameraZoom)
  }));
  const worldBeforeCamera = await currentWorld(page, apiOrigin);
  const touchX = box.x + box.width / 2;
  const touchY = box.y + box.height * 0.34;
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchStart', touchPoints: [{ id: 31, x: touchX - 24, y: touchY }, { id: 32, x: touchX + 24, y: touchY }]
  });
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchMove', touchPoints: [{ id: 31, x: touchX - 58, y: touchY }, { id: 32, x: touchX + 58, y: touchY }]
  });
  await delay(100);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await expect.poll(async () => Number(await scene.getAttribute('data-camera-zoom'))).toBeGreaterThan(beforeCamera.zoom);

  const panBox = await canvas.boundingBox();
  if (!panBox) throw new Error('Canvas missing after pinch zoom.');
  const panX = panBox.x + panBox.width * 0.99;
  const panY = panBox.y + panBox.height * 0.13;
  const beforePanX = Number(await scene.getAttribute('data-camera-center-x'));
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ id: 33, x: panX, y: panY }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ id: 33, x: panX - 40, y: panY + 20 }] });
  await delay(100);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await expect.poll(async () => Number(await scene.getAttribute('data-camera-center-x'))).not.toBe(beforePanX);
  await cdp.detach();
  const worldAfterCamera = await currentWorld(page, apiOrigin);
   expect(assignmentRequests).toBe(2);
  expect(worldAfterCamera.residents.map((actor) => [actor.id, actor.workRole, actor.task?.kind]))
    .toEqual(worldBeforeCamera.residents.map((actor) => [actor.id, actor.workRole, actor.task?.kind]));
  expect(await documentWidth(page)).toBeLessThanOrEqual(390);
  await page.reload();
  const reloaded = await currentWorld(page, apiOrigin);
  expect(resident(reloaded, 'worker-1').workRole).toBe('builder');
  expect(resident(reloaded, 'worker-2')).toMatchObject({ workRole: 'woodcutter', task: { kind: 'gather-wood' } });
  expect(reloaded.buildOrders.find((order) => order.id === mobileOrder.id))
    .toMatchObject({ assignedResidentId: 'worker-1', requiresExplicitBuilder: false });
  expect(browserErrors).toEqual([]);
});

test('mobile camera pans and pinches without changing world coordinates or overflowing the viewport', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'peace-v2-mobile', 'The mobile project verifies touch camera and viewport geometry.');
  await page.goto(phoneUrl());
  await expect(page.getByRole('heading', { name: 'Новый берег' })).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await assertViewportBudget(page);
  expect(await documentWidth(page)).toBeLessThanOrEqual(390);
  await page.setViewportSize({ width: 375, height: 667 });
  await assertViewportBudget(page);
  expect(await documentWidth(page)).toBeLessThanOrEqual(375);
  await page.setViewportSize({ width: 390, height: 844 });
  const dimensions = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    document: document.documentElement.scrollWidth,
    canvas: document.querySelector('#world-scene canvas')?.getBoundingClientRect().width ?? 0
  }));
  expect(dimensions.document).toBeLessThanOrEqual(dimensions.viewport);
  expect(dimensions.canvas).toBeGreaterThan(300);

  const scene = page.locator('#world-scene');
  const canvas = page.locator('#world-scene canvas');
  const box = await canvas.boundingBox();
  if (!box) throw new Error('Mobile Phaser canvas is missing.');
  const cdp = await page.context().newCDPSession(page);
  const centerX = box.x + box.width / 2;
  const centerY = box.y + box.height / 2;
  const beforeCenterX = Number(await scene.getAttribute('data-camera-center-x'));
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [{ id: 1, x: centerX - 20, y: centerY }, { id: 2, x: centerX + 20, y: centerY }]
  });
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchMove',
    touchPoints: [{ id: 1, x: centerX - 65, y: centerY }, { id: 2, x: centerX + 65, y: centerY }]
  });
  await delay(120);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await expect.poll(async () => Number(await scene.getAttribute('data-camera-zoom')))
    .toBeGreaterThan(MOBILE_ZOOM);
  expect(Math.abs(Number(await scene.getAttribute('data-camera-center-x')) - beforeCenterX)).toBeLessThan(2);

  const beforePan = Number(await scene.getAttribute('data-camera-center-x'));
  const currentBox = await canvas.boundingBox();
  if (!currentBox) throw new Error('Mobile Phaser canvas disappeared after pinch.');
   const panX = currentBox.x + currentBox.width * 0.99;
   const panY = currentBox.y + currentBox.height * 0.25;
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ id: 3, x: panX, y: panY }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ id: 3, x: panX - 45, y: panY + 12 }] });
  await delay(100);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await expect.poll(async () => Number(await scene.getAttribute('data-camera-center-x')))
    .not.toBe(beforePan);

  await page.setViewportSize({ width: 844, height: 390 });
  await expect.poll(async () => documentWidth(page)).toBeLessThanOrEqual(844);
  const afterResizeCenterX = Number(await scene.getAttribute('data-camera-center-x'));
  expect(Number.isFinite(afterResizeCenterX)).toBe(true);
  await cdp.detach();
});

async function documentWidth(page: Page): Promise<number> {
  return page.evaluate(() => document.documentElement.scrollWidth);
}
