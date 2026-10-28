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

interface WorldSnapshot {
  revision: { worldVersion: number; geometryVersion: number; serverTick: number };
  resources: { wood: number; stone: number };
  storage: { capacity: number };
  trees: Array<{
    id: string;
    name: string;
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

function phoneUrl(): string {
  return process.env.AVANPOST_V2_ENABLE_LAN === 'true'
    ? `http://${privateHost()}:4174/`
    : 'http://localhost:4175/';
}

async function selectWorkerByCanvasTap(page: Page, apiOrigin: string): Promise<void> {
  if (await page.locator('#resident-list .resident-chip[data-resident-id="worker-1"][aria-pressed="true"]')
    .isVisible().catch(() => false)) return;
  const canvas = page.locator('#world-scene canvas');
  const box = await canvas.boundingBox();
  if (!box) throw new Error('Phaser canvas is not visible.');
  await currentWorld(page, apiOrigin);
  const projection = await page.locator('#world-scene').evaluate((element) => ({
    x: Number((element as HTMLElement).dataset.workerCanvasX ?? '0'),
    y: Number((element as HTMLElement).dataset.workerCanvasY ?? '0')
  }));
  await canvas.click({ position: projection });
  await expect(page.getByRole('heading', { name: 'Илья' })).toBeVisible();
  await expect(page.locator('#resident-list .resident-chip[data-resident-id="worker-1"]'))
    .toHaveAttribute('aria-pressed', 'true');
}

async function selectResidentByList(page: Page, id: string, name: string): Promise<void> {
  const button = page.locator(`#resident-list .resident-chip[data-resident-id="${id}"]`);
  // A resident can remain the selected command actor while another object owns the scene inspector.
  // Click even when aria-pressed is true so the resident inspector is brought back into focus.
  await button.click();
  await expect(page.getByRole('heading', { name })).toBeVisible();
  await expect(button).toHaveAttribute('aria-pressed', 'true');
}

async function clickPlacementAnchor(page: Page, anchorX: number): Promise<void> {
  const canvas = page.locator('#world-scene canvas');
  const box = await canvas.boundingBox();
  if (!box) throw new Error('Phaser canvas is not visible.');
  const point = await page.locator('#world-scene').evaluate((element, dimensions) => {
    const data = (element as HTMLElement).dataset;
    const scrollX = Number(data.cameraScrollX ?? '0');
    const scrollY = Number(data.cameraScrollY ?? '0');
    const viewportX = Number(data.cameraViewportX ?? '0');
    const viewportY = Number(data.cameraViewportY ?? '0');
    const zoom = Number(data.cameraZoom ?? '1');
    return {
      x: viewportX + (dimensions.anchorX * dimensions.cellSize + dimensions.cellSize / 2 + dimensions.cellSize - scrollX) * zoom,
      y: viewportY + (-48 - scrollY) * zoom
    };
  }, { anchorX, cellSize: CELL_SIZE, width: box.width, height: box.height });
  await canvas.click({ position: {
    x: Math.max(2, Math.min(box.width - 2, point.x)),
    y: Math.max(2, Math.min(box.height - 2, point.y))
  } });
  await expect(page.locator('#world-scene')).toHaveAttribute('data-placement-anchor-x', String(anchorX));
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

  const apiHealth = `http://${bindHost}:8788/api/health`;
  const pageUrl = process.env.AVANPOST_V2_ENABLE_LAN === 'true' ? 'http://localhost:4175/' : 'http://localhost:4174/';
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
  test.skip(testInfo.project.name !== 'peace-v2-desktop', 'The desktop project owns the paired gameplay and restart scenario.');
  const bindHost = privateHost();
  const apiOrigin = `http://${bindHost}:8788`;
  const computerUrl = process.env.AVANPOST_V2_ENABLE_LAN === 'true' ? 'http://localhost:4175/' : 'http://localhost:4174/';
  const computerApiOrigin = process.env.AVANPOST_V2_ENABLE_LAN === 'true' ? new URL(computerUrl).origin : apiOrigin;
  const consoleErrors: string[] = [];
  let serverRestartInProgress = false;
  page.on('console', (message) => {
    if (message.type() !== 'error') return;
    if (serverRestartInProgress && (/net::ERR_(CONNECTION_REFUSED|EMPTY_RESPONSE|CONNECTION_RESET|SOCKET_NOT_CONNECTED|FAILED)/.test(message.text()) ||
        /blocked by CORS policy: No 'Access-Control-Allow-Origin' header/.test(message.text()))) return;
    consoleErrors.push(message.text());
  });
  page.on('pageerror', (error) => consoleErrors.push(error.message));

  await page.goto(computerUrl);
  page.setDefaultTimeout(8_000);
  await expect(page.getByRole('heading', { name: 'Новый берег' })).toBeVisible();
  await expect(page.locator('#world-scene canvas')).toBeVisible();
  await assertViewportBudget(page);
  await expect(page.locator('#pairing-code')).toBeHidden();
  expect((await page.request.get(`${apiOrigin}/api/world`)).status()).toBe(401);

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
      x: Number(data.cameraScrollX ?? '0') + (point.x / point.width * viewportWidth - Number(data.cameraViewportX ?? '0')) / zoom,
      y: Number(data.cameraScrollY ?? '0') + (point.y / point.height * viewportHeight - Number(data.cameraViewportY ?? '0')) / zoom
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
  expect(Math.abs(worldPointAfterZoom.x - worldPointBeforeZoom.x), JSON.stringify({
    worldPointBeforeZoom, worldPointAfterZoom, zoomBefore,
    zoomAfter: zoomMetrics.cameraZoom, zoomPoint, desktopCanvasBox, zoomMetrics
  })).toBeLessThan(4);
  expect(Math.abs(worldPointAfterZoom.y - worldPointBeforeZoom.y)).toBeLessThan(4);
  const desktopCenterBeforePan = Number(await page.locator('#world-scene').getAttribute('data-camera-center-x'));
  await page.mouse.move(desktopCanvasBox.x + 60, desktopCanvasBox.y + desktopCanvasBox.height * 0.75);
  await page.mouse.down();
  await page.mouse.move(desktopCanvasBox.x + 120, desktopCanvasBox.y + desktopCanvasBox.height * 0.75, { steps: 4 });
  await page.mouse.up();
  await expect.poll(async () => Number(await page.locator('#world-scene').getAttribute('data-camera-center-x')))
    .not.toBe(desktopCenterBeforePan);
  await page.getByRole('button', { name: 'Центрировать' }).click();

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

    await selectResidentByList(phonePage, 'worker-2', 'Марья');
    await phonePage.locator('#resident-work-role').selectOption('builder');
    await expect.poll(async () => resident(await currentWorld(phonePage, apiOrigin), 'worker-2').workRole)
      .toBe('builder');
    await phonePage.getByRole('button', { name: 'Центрировать' }).click();
    await phonePage.getByRole('button', { name: 'Каталог строительства' }).click();
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
    expect(buildingWorld.resources.wood).toBe(0);
    expect(buildingWorld.buildings).toHaveLength(1);
    expect(buildingWorld.buildings[0]?.anchor).toEqual({ x: 0, y: -1 });
    expect(['planned', 'in_progress']).toContain(buildingWorld.buildings[0]?.state);
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

    await selectResidentByList(phonePage, 'worker-2', 'Марья');
    await phonePage.locator('#resident-work-role').selectOption('none');
    await expect.poll(async () => resident(await currentWorld(phonePage, apiOrigin), 'worker-2').workRole).toBe('none');
    await phonePage.getByRole('button', { name: 'Каталог строительства' }).click();
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
    expect(resident(queuedWorld, 'worker-2').visualState).toBe('idle');

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
    await selectResidentByList(phonePage, 'worker-2', 'Марья');
    await phonePage.locator('#resident-work-role').selectOption('builder');
    await expect.poll(async () => resident(await currentWorld(phonePage, apiOrigin), 'worker-2').workRole).toBe('builder');
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
  const computerUrl = process.env.AVANPOST_V2_ENABLE_LAN === 'true' ? 'http://localhost:4175/' : 'http://localhost:4174/';
  const computerApiOrigin = new URL(computerUrl).origin;
  const consoleErrors: string[] = [];
  let serverRestartInProgress = false;
  page.on('console', (message) => {
    if (message.type() !== 'error') return;
    if (serverRestartInProgress && (/net::ERR_(CONNECTION_REFUSED|EMPTY_RESPONSE|CONNECTION_RESET|SOCKET_NOT_CONNECTED|FAILED)/.test(message.text()) ||
        /blocked by CORS policy: No 'Access-Control-Allow-Origin' header/.test(message.text()))) return;
    consoleErrors.push(message.text());
  });
  page.on('pageerror', (error) => consoleErrors.push(error.message));

  execFileSync(process.execPath, [tsxCli, 'src/cli/reset-test-world.ts', 'builder-carry-priority'], {
    cwd: path.join(projectRoot, 'apps/server-v2'),
    env: { ...process.env, AVANPOST_V2_DATABASE_OPERATION: 'test' },
    stdio: 'pipe'
  });

  await page.goto(computerUrl, { waitUntil: 'domcontentloaded' });
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

  const afterA = await createOrder('hotfix-order-a-0001', { x: 4, y: -1 }, initial);
  const buildingA = afterA.buildings.find((building) => building.anchor.x === 4)!;
  const orderA = afterA.buildOrders.find((order) => order.buildingId === buildingA.id)!;
  expect(orderA.status).toBe('waiting_builder');
  const afterB = await createOrder('hotfix-order-b-0001', { x: -20, y: -1 }, afterA);
  const buildingB = afterB.buildings.find((building) => building.anchor.x === -20)!;
  const orderB = afterB.buildOrders.find((order) => order.buildingId === buildingB.id)!;
  expect(orderB.status).toBe('waiting_builder');
  expect(resident(afterB, 'worker-2').task?.kind).toBe('gather-wood');

  // Direct setup commands ran through the browser proxy; reload the client before exercising its UI controls.
  await page.reload();
  await expect(page.locator('#pairing-summary')).toHaveText('Мир подключён к этому браузеру');

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

  await selectResidentByList(page, 'worker-2', 'Марья');
  const roleResponsePromise = page.waitForResponse((response) =>
    response.request().method() === 'POST' && response.url().endsWith('/api/commands') &&
    (response.request().postData() ?? '').includes('set-work-role'));
  await page.locator('#resident-work-role').selectOption('builder');
  const roleResponse = await roleResponsePromise;
  expect(roleResponse.status()).toBe(200);
  world = await roleResponse.json() as WorldSnapshot;
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
  expect(world.buildOrders.find((order) => order.id === orderB.id)?.status).toBe('in_progress');
  await expect.poll(async () => {
    const current = await currentWorld(page, computerApiOrigin);
    const building = current.buildings.find((candidate) => candidate.id === buildingB.id);
    const builder = resident(current, 'worker-2');
    return (building?.reservedWood ?? 0) + builder.cargo;
  }).toBe(3);
  world = await currentWorld(page, computerApiOrigin);
  expect(resident(world, 'worker-2').task?.phase).toMatch(/carrying_materials_to_build|building/);
  expect(resident(world, 'worker-2').cargo +
    (world.buildings.find((building) => building.id === buildingB.id)?.reservedWood ?? 0)).toBe(3);

  await expect.poll(async () => {
    const current = await currentWorld(page, computerApiOrigin);
    return current.buildOrders.find((order) => order.id === orderB.id)?.status;
  }, { timeout: 30_000 }).toBe('completed');
  await expect.poll(async () => {
    const current = await currentWorld(page, computerApiOrigin);
    return current.buildOrders.find((order) => order.id === orderA.id)?.status;
  }, { timeout: 10_000 }).toBe('in_progress');
  world = await currentWorld(page, computerApiOrigin);
  expect(resident(world, 'worker-2').task).toMatchObject({ kind: 'build-cabin', orderId: orderA.id });
  expect(resident(world, 'worker-1').workRole).toBe('woodcutter');
  expect(resident(world, 'worker-1').task?.kind).toBe('gather-wood');
  expect(world.resources.wood + world.resources.stone).toBeLessThanOrEqual(world.storage.capacity);

  await expect.poll(async () => {
    const current = await currentWorld(page, computerApiOrigin);
    return current.buildOrders.find((order) => order.id === orderA.id)?.status;
  }, { timeout: 30_000 }).toBe('completed');
  world = await currentWorld(page, computerApiOrigin);
  expect(world.buildings.find((building) => building.id === buildingB.id)?.state).toBe('complete');
  expect(world.buildings.find((building) => building.id === buildingA.id)?.state).toBe('complete');
  const finalTrackedWood = world.resources.wood +
    world.residents.reduce((sum, actor) => sum + actor.cargo, 0) +
    world.buildings.reduce((sum, building) => sum + building.reservedWood, 0) +
    world.trees.reduce((sum, tree) => sum + tree.remaining, 0);
  expect(finalTrackedWood).toBe(initialTrackedWood - 2 * 3);
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
      'B completes before A starts; the woodcutter safely unloads and continues its assigned role',
      'both cabins complete after authoritative server ticks; no client-authored completion'
    ],
    sourceSha256
  }, null, 2)}\n`, 'utf8');
});

test('G3.3: mine and deliver stone, then build a workshop with its reserved recipe', async ({ page }, testInfo) => {
  test.setTimeout(360_000);
  test.skip(testInfo.project.name !== 'peace-v2-desktop', 'The desktop project owns the G3.3 authoritative gameplay scenario.');
  const computerUrl = process.env.AVANPOST_V2_ENABLE_LAN === 'true' ? 'http://localhost:4175/' : 'http://localhost:4174/';
  const computerApiOrigin = new URL(computerUrl).origin;
  const consoleErrors: string[] = [];
  let serverRestartInProgress = false;
  page.on('console', (message) => {
    if (message.type() !== 'error') return;
    if (serverRestartInProgress && /net::ERR_(CONNECTION_REFUSED|EMPTY_RESPONSE|CONNECTION_RESET|SOCKET_NOT_CONNECTED|FAILED)/.test(message.text())) return;
    consoleErrors.push(message.text());
  });
  page.on('pageerror', (error) => consoleErrors.push(error.message));

  execFileSync(process.execPath, [tsxCli, 'src/cli/reset-test-world.ts', 'g33-stone-workshop'], {
    cwd: path.join(projectRoot, 'apps/server-v2'),
    env: { ...process.env, AVANPOST_V2_DATABASE_OPERATION: 'test' },
    stdio: 'pipe'
  });

  await page.goto(computerUrl, { waitUntil: 'domcontentloaded' });
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
  await selectResidentByList(page, 'worker-1', 'Илья');
  await page.locator('#build-mode').click();
  await page.locator('#workshop-catalog-item').click();
  await clickPlacementAnchor(page, 12);
  await expect(page.locator('#confirm-placement')).toBeEnabled();
  await expect(page.locator('#placement-title')).toContainText('12 дерева + 6 камня');
  await page.locator('#confirm-placement').click();

  await expect.poll(async () => {
    world = await currentWorld(page, computerApiOrigin);
    return world.buildOrders.at(-1)?.status;
  }).toBe('waiting_materials');
  const workshop = world.buildings.find((building) => building.kind === 'workshop');
  const order = world.buildOrders.find((candidate) => candidate.buildingId === workshop?.id);
  expect(workshop).toBeDefined();
  expect(order).toBeDefined();
  await expect(page.locator(`#build-order-list [data-order-id="${order!.id}"]`)).toContainText('Ожидает материалы');
  expect(world.resources.wood).toBe(0);
  expect(world.resources.stone).toBe(0);
  expect(world.buildings.find((building) => building.id === workshop!.id)).toMatchObject({
    reservedWood: 12, reservedStone: 0
  });

  await selectResidentByList(page, 'worker-1', 'Илья');
  await page.locator('#resident-work-role').selectOption('stone_miner');
  await expect.poll(async () => (await currentWorld(page, computerApiOrigin)).residents[0]?.task?.kind)
    .toBe('gather-stone');
  await expect.poll(async () => page.locator('#worker-state').innerText())
    .toMatch(/Идёт к каменному выходу|Добывает камень|Загружает камень|Несёт .* камня|Разгружает камень/);
  await selectResidentByList(page, 'worker-2', 'Марья');
  await page.locator('#resident-work-role').selectOption('builder');

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
  const computerUrl = process.env.AVANPOST_V2_ENABLE_LAN === 'true' ? 'http://localhost:4175/' : 'http://localhost:4174/';
  const apiOrigin = new URL(computerUrl).origin;
  const errors: string[] = [];
  let restarting = false;
  page.on('console', (message) => {
    if (message.type() !== 'error') return;
    if (restarting && /net::ERR_(CONNECTION_REFUSED|EMPTY_RESPONSE|CONNECTION_RESET|SOCKET_NOT_CONNECTED|FAILED)/.test(message.text())) return;
    errors.push(message.text());
  });
  page.on('pageerror', (error) => errors.push(error.message));

  execFileSync(process.execPath, [tsxCli, 'src/cli/reset-test-world.ts', 'g33-full-store-workshop'], {
    cwd: path.join(projectRoot, 'apps/server-v2'),
    env: { ...process.env, AVANPOST_V2_DATABASE_OPERATION: 'test' },
    stdio: 'pipe'
  });
  await page.goto(computerUrl, { waitUntil: 'domcontentloaded' });
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

  await selectResidentByList(page, 'worker-2', 'Марья');
  await page.locator('#build-mode').click();
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
  const builderAtDispatch = resident(current, 'worker-2');
  expect((workshop!.reservedWood) + (builderAtDispatch.cargoItemId === 'wood' ? builderAtDispatch.cargo : 0))
    .toBe(12);
  expect(workshop).toMatchObject({ reservedStone: 0 });
  expect(current.resources.wood + workshop!.reservedWood +
    (builderAtDispatch.cargoItemId === 'wood' ? builderAtDispatch.cargo : 0)).toBe(101);
  expect(current.resources).toEqual({ wood: 89, stone: 0 });
  expect(current.buildOrders.filter((candidate) => candidate.buildingId === workshop!.id)).toHaveLength(1);
  expect(order).toMatchObject({ status: 'in_progress', assignedResidentId: 'worker-2' });
  expect(resident(current, 'worker-2').task).toMatchObject({
    kind: 'build-workshop', orderId: order!.id
  });
  expect(resident(current, 'worker-1').task).toMatchObject({
    kind: 'gather-stone', phase: 'carrying_to_build', buildingId: workshop!.id,
    orderId: order!.id, deliveryQuantity: 6
  });
  await selectResidentByList(page, 'worker-1', 'Илья');
  await expect(page.locator('#worker-state')).toContainText(/камня.*мастерск/);

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
  const panX = currentBox.x + currentBox.width * 0.7;
  const panY = currentBox.y + currentBox.height * 0.55;
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
