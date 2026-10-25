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
  resources: { wood: number };
  trees: Array<{
    id: string;
    name: string;
    position: { x: number; y: number };
    remaining: number;
    maxRemaining: number;
    state: string;
  }>;
  worker: {
    position: { x: number; y: number };
    visualState: string;
    cargo: number;
    task: null | { phase: string; progressTicks: number; requiredTicks: number };
  };
  buildings: Array<{
    id: string;
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
  const response = await browserRequest(page, `${apiOrigin}/api/world`);
  expect(response.status).toBe(200);
  return response.body as WorldSnapshot;
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
  if (await page.getByRole('button', { name: 'Снять выбор' }).isVisible().catch(() => false)) return;
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
  await expect(page.getByRole('button', { name: 'Снять выбор' })).toBeEnabled();
}

async function selectWorkerByInspector(page: Page): Promise<void> {
  if (await page.getByRole('button', { name: 'Снять выбор' }).isVisible().catch(() => false)) return;
  await page.getByRole('button', { name: 'Выбрать Илью' }).click();
  await expect(page.getByRole('heading', { name: 'Илья' })).toBeVisible();
}

async function clickPlacementAnchor(page: Page, anchorX: number): Promise<void> {
  const canvas = page.locator('#world-scene canvas');
  const box = await canvas.boundingBox();
  if (!box) throw new Error('Phaser canvas is not visible.');
  const point = await page.locator('#world-scene').evaluate((element, dimensions) => {
    const data = (element as HTMLElement).dataset;
    const viewX = Number(data.cameraWorldViewX ?? '0');
    const viewY = Number(data.cameraWorldViewY ?? '0');
    const viewWidth = Number(data.cameraWorldViewWidth ?? '1');
    const viewHeight = Number(data.cameraWorldViewHeight ?? '1');
    return {
      x: ((dimensions.anchorX * dimensions.cellSize + dimensions.cellSize * 0.75 - viewX) / viewWidth) * dimensions.width,
      y: ((-48 - viewY) / viewHeight) * dimensions.height
    };
  }, { anchorX, cellSize: CELL_SIZE, width: box.width, height: box.height });
  await canvas.click({ position: {
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

async function selectTreeByCanvasTap(page: Page, apiOrigin: string, treeId: string): Promise<void> {
  const world = await currentWorld(page, apiOrigin);
  const tree = world.trees.find((item) => item.id === treeId);
  if (!tree) throw new Error(`Forest source ${treeId} is missing.`);
  const canvas = page.locator('#world-scene canvas');
  const box = await canvas.boundingBox();
  if (!box) throw new Error('Phaser canvas is not visible.');
  const selectionY = tree.state === 'stump' ? -28 : -80;
  const projection = await page.locator('#world-scene').evaluate((element, position) => {
    const data = (element as HTMLElement).dataset;
    const viewX = Number(data.cameraWorldViewX ?? '0');
    const viewY = Number(data.cameraWorldViewY ?? '0');
    const viewWidth = Number(data.cameraWorldViewWidth ?? '1');
    const viewHeight = Number(data.cameraWorldViewHeight ?? '1');
    return {
      x: ((position.x * 48 + 24 - viewX) / viewWidth) * position.width,
      y: ((position.selectionY - viewY) / viewHeight) * position.height
    };
  }, { x: tree.position.x, selectionY, width: box.width, height: box.height });
  const clampedProjection = {
    x: Math.max(2, Math.min(box.width - 2, projection.x)),
    y: Math.max(2, Math.min(box.height - 2, projection.y))
  };
  await canvas.click({ position: clampedProjection });
  await expect(page.getByRole('heading', { name: tree.name })).toBeVisible();
}

async function clickWoodOrder(page: Page, apiOrigin: string): Promise<WorldSnapshot> {
  await selectWorkerByCanvasTap(page, apiOrigin);
  await page.getByRole('button', { name: /Поручить добычу дерева/ }).click();
  await expect.poll(async () => (await currentWorld(page, apiOrigin)).worker.task?.phase, { timeout: 5_000 })
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

test('server ticks drive the full wood-to-cabin cycle through reload and API restart', async ({ page, browser }, testInfo) => {
  test.setTimeout(360_000);
  test.skip(testInfo.project.name !== 'peace-v2-desktop', 'The desktop project owns the paired gameplay and restart scenario.');
  const bindHost = privateHost();
  const apiOrigin = `http://${bindHost}:8788`;
  const computerUrl = process.env.AVANPOST_V2_ENABLE_LAN === 'true' ? 'http://localhost:4175/' : 'http://localhost:4174/';
  const computerApiOrigin = process.env.AVANPOST_V2_ENABLE_LAN === 'true' ? new URL(computerUrl).origin : apiOrigin;
  const consoleErrors: string[] = [];
  let serverRestartInProgress = false;
  let expectedResourceRejection = false;
  page.on('console', (message) => {
    if (message.type() !== 'error') return;
    if (serverRestartInProgress && /net::ERR_(CONNECTION_REFUSED|EMPTY_RESPONSE)/.test(message.text())) return;
    if (expectedResourceRejection && /status of 422/.test(message.text())) return;
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
      if (serverRestartInProgress && /net::ERR_(CONNECTION_REFUSED|EMPTY_RESPONSE)/.test(message.text())) return;
      if (expectedResourceRejection && /status of 422/.test(message.text())) return;
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
    await expect(phonePage.getByRole('button', { name: 'Подключить' })).toBeInViewport();
    await phonePage.setViewportSize({ width: 390, height: 844 });
    await phonePage.getByLabel('Одноразовый код').fill(phoneCode);
    await phonePage.getByRole('button', { name: 'Подключить' }).click();
    await expect(phonePage.locator('#pairing-summary')).toHaveText('Мир подключён к этому браузеру');
    await assertViewportBudget(phonePage);

    const initial = await currentWorld(phonePage, apiOrigin);
    expect(initial.resources.wood).toBe(1);
    expect(initial.trees.find((tree) => tree.id === 'tree-1')?.remaining).toBe(3);
    const started = await clickWoodOrder(phonePage, apiOrigin);
    const firstSourceWorkPoint = initial.trees.find((tree) => tree.id === 'tree-1')!.position.x - 1;
    expect(started.worker.position.x).toBeGreaterThanOrEqual(initial.worker.position.x);
    expect(started.worker.position.x).toBeLessThanOrEqual(firstSourceWorkPoint);
    expect(started.worker.task?.phase).toBe('walking_to_source');
    expect(started.worker.cargo).toBe(0);
    expect(started.trees.find((tree) => tree.id === 'tree-1')?.remaining).toBe(3);
    expect(lastCommandPayload).toMatchObject({ sourceId: 'tree-1' });
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
    expect(saved.worker.task).not.toBeNull();
    expect(saved.worker.task?.phase).toMatch(/walking_to_source|gathering|loading|carrying_to_storage|unloading/);
    await expect.poll(async () => (await currentWorld(phonePage, apiOrigin)).resources.wood, { timeout: 15_000 })
      .toBe(2);
    saved = await currentWorld(phonePage, apiOrigin);
    expect(saved.worker.cargo).toBe(0);
    expect(saved.trees.find((tree) => tree.id === 'tree-1')?.remaining).toBe(2);
    expect(saved.worker.task).toBeNull();

    for (const expectedWood of [3, 4]) {
      await selectWorkerByCanvasTap(phonePage, apiOrigin);
      const before = await currentWorld(phonePage, apiOrigin);
      await phonePage.getByRole('button', { name: /Поручить добычу дерева/ }).click();
      await expect.poll(async () => (await currentWorld(phonePage, apiOrigin)).resources.wood, { timeout: 15_000 })
        .toBe(expectedWood);
      const after = await currentWorld(phonePage, apiOrigin);
      expect(after.trees.find((tree) => tree.id === 'tree-1')?.remaining)
        .toBe((before.trees.find((tree) => tree.id === 'tree-1')?.remaining ?? 0) - 1);
      expect(after.worker.cargo).toBe(0);
    expect(after.worker.task).toBeNull();
    }

    await selectTreeByCanvasTap(phonePage, apiOrigin, 'tree-1');
    await expect(phonePage.locator('#inspector-detail')).toContainText('Пень');
    await expect(phonePage.getByRole('button', { name: /Поручить добычу дерева/ })).toBeDisabled();
    await phonePage.getByRole('button', { name: 'Выбрать Восточная роща' }).click();
    await expect(phonePage.locator('#inspector-detail')).toContainText('3 из 3 брёвен');
    expect(Math.abs(Number(await phonePage.locator('#world-scene').getAttribute('data-camera-center-x')) - 408))
      .toBeLessThan(2);
    await expect(phonePage.getByRole('button', { name: /Поручить добычу дерева/ })).toBeEnabled();
    await phonePage.getByRole('button', { name: /Поручить добычу дерева/ }).click();
    await expect.poll(async () => (await currentWorld(phonePage, apiOrigin)).resources.wood, { timeout: 18_000 })
      .toBe(5);
    expect(lastCommandPayload).toMatchObject({ sourceId: 'tree-2' });
    const afterSecondSource = await currentWorld(phonePage, apiOrigin);
    expect(afterSecondSource.trees.find((tree) => tree.id === 'tree-1')?.remaining).toBe(0);
    expect(afterSecondSource.trees.find((tree) => tree.id === 'tree-2')?.remaining).toBe(2);

    await selectWorkerByCanvasTap(phonePage, apiOrigin);
    await phonePage.getByRole('button', { name: 'Снять выбор' }).click();
    await phonePage.getByRole('button', { name: 'Центрировать' }).click();
    await selectWorkerByCanvasTap(phonePage, apiOrigin);
    await phonePage.getByRole('button', { name: 'Каталог строительства' }).click();
    await expect(phonePage.getByText('Жилые здания')).toBeVisible();
    await phonePage.getByRole('button', { name: /Домик.*2×1 клетка/ }).click();
    await expect(phonePage.locator('#placement-panel')).toBeVisible();
    const deniedPlacement = await browserRequest(phonePage, `${apiOrigin}/api/placement/validate`, 'POST', {
      anchor: { x: -6, y: -1 }
    });
    expect(deniedPlacement.status).toBe(200);
    expect((deniedPlacement.body as { valid?: boolean; reason?: string }).valid).toBe(false);
    expect((deniedPlacement.body as { reason?: string }).reason).toBe('OCCUPIED');
    await clickPlacementAnchor(phonePage, 2);
    await expect(phonePage.locator('#placement-reason')).toContainText(/занят/);
    await expect(phonePage.locator('#placement-reason')).toHaveAttribute('data-valid', 'false');
    await clickPlacementAnchor(phonePage, 1);
    await expect(phonePage.locator('#placement-reason')).toHaveText(/Место подходит/, { timeout: 5_000 });
    await expect(phonePage.getByRole('button', { name: 'Построить здесь' })).toBeEnabled();
    await phonePage.getByRole('button', { name: 'Построить здесь' }).click();
    await expect.poll(async () => (await currentWorld(phonePage, apiOrigin)).buildings.length, { timeout: 5_000 })
      .toBe(1);
    let buildingWorld = await currentWorld(phonePage, apiOrigin);
    expect(buildingWorld.resources.wood).toBe(2);
    expect(buildingWorld.buildings).toHaveLength(1);
    expect(buildingWorld.buildings[0]?.anchor).toEqual({ x: 1, y: -1 });
    expect(buildingWorld.buildings[0]?.state).toBe('planned');
    await expect.poll(async () => (await currentWorld(phonePage, apiOrigin)).worker.task?.phase, { timeout: 8_000 })
      .toBe('building');
    await expect.poll(async () => (await currentWorld(phonePage, apiOrigin)).buildings[0]?.progressTicks, { timeout: 5_000 })
      .toBeGreaterThan(0);
    await phonePage.reload();
    buildingWorld = await currentWorld(phonePage, apiOrigin);
    const progressBeforeRestart = buildingWorld.buildings[0]?.progressTicks ?? 0;
    expect(buildingWorld.worker.task?.phase).toBe('building');
    expect(progressBeforeRestart).toBeGreaterThan(0);

    serverRestartInProgress = true;
    await restartV2TestServer(phonePage);
    if (phonePage.isClosed()) {
      phonePage = await phoneContext.newPage();
      watchPhonePage(phonePage);
    }
    await phonePage.goto(phoneUrl(), { waitUntil: 'domcontentloaded' });
    await expect(phonePage.getByRole('heading', { name: 'Новый берег' })).toBeVisible();
    serverRestartInProgress = false;
    buildingWorld = await currentWorld(phonePage, apiOrigin);
    expect(buildingWorld.buildings[0]?.anchor).toEqual({ x: 1, y: -1 });
    expect(buildingWorld.buildings[0]?.progressTicks).toBeGreaterThanOrEqual(progressBeforeRestart);
    expect(buildingWorld.resources.wood).toBe(2);
    await expect.poll(async () => (await currentWorld(phonePage, apiOrigin)).buildings[0]?.state, { timeout: 12_000 })
      .toBe('complete');
    buildingWorld = await currentWorld(phonePage, apiOrigin);
    expect(buildingWorld.buildings[0]?.reservedWood).toBe(0);
    expect(buildingWorld.worker.task).toBeNull();
    expect(buildingWorld.resources.wood).toBe(2);

    const insufficientBefore = await currentWorld(phonePage, apiOrigin);
    expectedResourceRejection = true;
    const insufficientBuild = await browserRequest(phonePage, `${apiOrigin}/api/commands`, 'POST', {
      requestId: 'second-cabin-without-wood-0001',
      expectedWorldVersion: insufficientBefore.revision.worldVersion,
      expectedGeometryVersion: insufficientBefore.revision.geometryVersion,
      kind: 'build-cabin', anchor: { x: 4, y: -1 }
    });
    expectedResourceRejection = false;
    expect(insufficientBuild.status).toBe(422);
    expect((insufficientBuild.body as { code?: string }).code).toBe('RESOURCE_MISSING');
    let afterInsufficientBuild = await currentWorld(phonePage, apiOrigin);
    expect(afterInsufficientBuild.resources.wood).toBe(2);
    expect(afterInsufficientBuild.buildings).toHaveLength(1);

    await phonePage.getByRole('button', { name: 'Выбрать Западный склон' }).click();
    await selectWorkerByInspector(phonePage);
    await phonePage.getByRole('button', { name: 'Центрировать' }).click();
    await expect(phonePage.getByRole('button', { name: /Поручить добычу дерева/ })).toBeEnabled();
    await phonePage.getByRole('button', { name: /Поручить добычу дерева/ }).click();
    await expect.poll(async () => (await currentWorld(phonePage, apiOrigin)).resources.wood, { timeout: 18_000 })
      .toBe(3);
    expect(lastCommandPayload).toMatchObject({ sourceId: 'tree-3' });
    const overlap = await browserRequest(phonePage, `${apiOrigin}/api/placement/validate`, 'POST', {
      anchor: { x: 2, y: -1 }
    });
    expect((overlap.body as { valid?: boolean; reason?: string }).valid).toBe(false);
    expect((overlap.body as { reason?: string }).reason).toBe('OCCUPIED');

    await selectWorkerByInspector(phonePage);
    await phonePage.getByRole('button', { name: 'Каталог строительства' }).click();
    await phonePage.getByRole('button', { name: /Домик.*2×1 клетка/ }).click();
    await clickPlacementAnchor(phonePage, 4);
    await expect(phonePage.locator('#placement-reason')).toHaveText(/Место подходит/);
    await expect(phonePage.getByRole('button', { name: 'Построить здесь' })).toBeEnabled();
    await phonePage.getByRole('button', { name: 'Построить здесь' }).click();
    await expect.poll(async () => (await currentWorld(phonePage, apiOrigin)).buildings.length, { timeout: 5_000 })
      .toBe(2);
    let secondBuildingWorld = await currentWorld(phonePage, apiOrigin);
    expect(secondBuildingWorld.buildings.map((building) => building.anchor)).toEqual([
      { x: 1, y: -1 }, { x: 4, y: -1 }
    ]);
    expect(secondBuildingWorld.resources.wood).toBe(0);
    expect(secondBuildingWorld.buildings[1]?.reservedWood).toBe(3);
    await expect.poll(async () => (await currentWorld(phonePage, apiOrigin)).worker.task?.phase, { timeout: 10_000 })
      .toBe('building');
    await phonePage.reload();
    secondBuildingWorld = await currentWorld(phonePage, apiOrigin);
    expect(secondBuildingWorld.buildings[1]?.anchor).toEqual({ x: 4, y: -1 });
    expect(secondBuildingWorld.buildings[1]?.progressTicks).toBeGreaterThan(0);
    await expect.poll(async () => (await currentWorld(phonePage, apiOrigin)).buildings[1]?.state, { timeout: 12_000 })
      .toBe('complete');
    secondBuildingWorld = await currentWorld(phonePage, apiOrigin);
    expect(secondBuildingWorld.buildings).toHaveLength(2);
    expect(secondBuildingWorld.buildings[1]?.reservedWood).toBe(0);
    expect(secondBuildingWorld.resources.wood).toBe(0);
    expectedResourceRejection = true;
    const thirdCabinAttempt = await browserRequest(phonePage, `${apiOrigin}/api/commands`, 'POST', {
      requestId: 'third-cabin-without-wood-0001',
      expectedWorldVersion: secondBuildingWorld.revision.worldVersion,
      expectedGeometryVersion: secondBuildingWorld.revision.geometryVersion,
      kind: 'build-cabin', anchor: { x: 7, y: -1 }
    });
    expectedResourceRejection = false;
    expect(thirdCabinAttempt.status).toBe(422);
    expect((thirdCabinAttempt.body as { code?: string }).code).toBe('RESOURCE_MISSING');
    const afterThirdAttempt = await currentWorld(phonePage, apiOrigin);
    expect(afterThirdAttempt.buildings).toHaveLength(2);
    expect(afterThirdAttempt.resources.wood).toBe(0);
    expect(consoleErrors).toEqual([]);

    const evidencePath = path.join(projectRoot, 'docs/v2/evidence/G2/G2.2-LIVING-WORLD');
    await mkdir(evidencePath, { recursive: true });
    await page.screenshot({ path: path.join(evidencePath, 'computer.png'), fullPage: true });
    await phonePage.screenshot({ path: path.join(evidencePath, 'phone-emulated.png'), fullPage: true });
    const sourceFiles = [
      'apps/client-v2/src/main.ts',
      'apps/client-v2/src/settlement-scene.ts',
      'apps/client-v2/src/style.css',
      'apps/client-v2/public/assets/peace-v2/manifest.json',
      'apps/client-v2/public/assets/peace-v2/background-panorama.png',
      'apps/server-v2/src/server.ts',
      'packages/peace-v2-shared/src/index.ts',
      'packages/peace-v2-sim/src/settlement.ts',
      'db/peace-v2/migrations/0003_live_settlement.sql',
      'db/peace-v2/migrations/0004_forest_sources.sql',
      'apps/client-v2/e2e/peaceful-slice.spec.ts'
    ];
    const sourceSha256 = Object.fromEntries(await Promise.all(sourceFiles.map(async (file) => [
      file, createHash('sha256').update(await readFile(path.join(projectRoot, file))).digest('hex')
    ])));
    await writeFile(path.join(evidencePath, 'playwright.json'), `${JSON.stringify({
      testId: 'V2-G22-WORLD-01', gate: 'G2.2', project: testInfo.project.name, result: 'PASS',
      databaseName: 'avanpost_v2_test', restartedApi: true,
      selectedBuildingAnchors: [{ x: 1, y: -1 }, { x: 4, y: -1 }],
      networkMode: process.env.AVANPOST_V2_ENABLE_LAN === 'true' ? 'explicit-private-lan' : 'loopback',
      sourceSha256,
      assertions: [
        'exhausting the original tree leaves a selectable stump; two other source IDs deliver wood',
        'gather starts as a persisted walking task; tree and storage counts stay unchanged until their server phases',
        'reload during an active gathering task preserves its phase; server delivery updates the source and storage once',
        'wood enters storage only after server-side unloading',
        'building ghost reports an occupied cell, confirms two distinct anchors, and a third build with insufficient wood changes nothing',
        'both cabins remain at their selected anchors; second-cabin progress survives reload and first-cabin task survived API restart',
        'desktop wheel zoom and mobile touch-camera behavior are covered by browser projects',
        'physical phone and G2.2 owner acceptance remain manual'
      ]
    }, null, 2)}\n`, 'utf8');
  } finally {
    await phoneContext.close();
  }
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
