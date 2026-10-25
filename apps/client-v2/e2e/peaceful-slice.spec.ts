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
  tree: { position: { x: number; y: number }; remaining: number };
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
  const deadline = Date.now() + 45_000;
  while (Date.now() < deadline) {
    const [health, client] = await Promise.all([
      fetch(apiHealth).then((response) => response.ok).catch(() => false),
      fetch(pageUrl).then((response) => response.ok).catch(() => false)
    ]);
    if (health && client) return;
    if (childExitCode !== null && childExitCode !== undefined) {
      throw new Error(`V2 test API restart exited before ready (code ${childExitCode}): ${childOutput}`);
    }
    await delay(300);
  }
  throw new Error('V2 test server did not recover after API restart.');
}

test('server ticks drive the full wood-to-cabin cycle through reload and API restart', async ({ page, browser }, testInfo) => {
  test.skip(testInfo.project.name !== 'peace-v2-desktop', 'The desktop project owns the paired gameplay and restart scenario.');
  const bindHost = privateHost();
  const apiOrigin = `http://${bindHost}:8788`;
  const computerUrl = process.env.AVANPOST_V2_ENABLE_LAN === 'true' ? 'http://localhost:4175/' : 'http://localhost:4174/';
  const computerApiOrigin = process.env.AVANPOST_V2_ENABLE_LAN === 'true' ? new URL(computerUrl).origin : apiOrigin;
  const consoleErrors: string[] = [];
  let serverRestartInProgress = false;
  page.on('console', (message) => {
    if (message.type() !== 'error') return;
    if (serverRestartInProgress && /net::ERR_(CONNECTION_REFUSED|EMPTY_RESPONSE)/.test(message.text())) return;
    consoleErrors.push(message.text());
  });
  page.on('pageerror', (error) => consoleErrors.push(error.message));

  await page.goto(computerUrl);
  await expect(page.getByRole('heading', { name: 'Новый берег' })).toBeVisible();
  await expect(page.locator('#world-scene canvas')).toBeVisible();
  await expect(page.locator('#pairing-code')).toBeHidden();
  expect((await page.request.get(`${apiOrigin}/api/world`)).status()).toBe(401);

  const canvas = page.locator('#world-scene canvas');
  await canvas.hover();
  const zoomBefore = Number(await page.locator('#world-scene').getAttribute('data-camera-zoom'));
  await page.mouse.wheel(0, -240);
  await expect.poll(async () => Number(await page.locator('#world-scene').getAttribute('data-camera-zoom')))
    .toBeGreaterThan(zoomBefore);
  const desktopCanvasBox = await canvas.boundingBox();
  if (!desktopCanvasBox) throw new Error('Desktop Phaser canvas is missing.');
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
  const phonePage = await phoneContext.newPage();
  let lastCommandPayload: unknown;
  phonePage.on('console', (message) => {
    if (message.type() !== 'error') return;
    if (serverRestartInProgress && /net::ERR_(CONNECTION_REFUSED|EMPTY_RESPONSE)/.test(message.text())) return;
    consoleErrors.push(message.text());
  });
  phonePage.on('pageerror', (error) => consoleErrors.push(error.message));
  phonePage.on('request', (request) => {
    if (request.method() === 'POST' && request.url().endsWith('/api/commands')) {
      lastCommandPayload = request.postDataJSON();
    }
  });
  try {
    await phonePage.goto(phoneUrl());
    await expect(phonePage.getByRole('heading', { name: 'Новый берег' })).toBeVisible();
    expect((await phonePage.request.get(`${apiOrigin}/api/world`)).status()).toBe(401);
    await phonePage.getByLabel('Одноразовый код').fill(phoneCode);
    await phonePage.getByRole('button', { name: 'Подключить' }).click();
    await expect(phonePage.locator('#pairing-summary')).toHaveText('Мир подключён к этому браузеру');

    const initial = await currentWorld(phonePage, apiOrigin);
    expect(initial.resources.wood).toBe(1);
    expect(initial.tree.remaining).toBe(3);
    const started = await clickWoodOrder(phonePage, apiOrigin);
    expect(Math.abs(started.worker.position.x - (-3))).toBeLessThanOrEqual(1);
    expect(started.worker.task?.phase).toBe('walking_to_source');
    expect(started.worker.cargo).toBe(0);
    expect(started.tree.remaining).toBe(3);
    expect(started.resources.wood).toBe(1);
    expect(lastCommandPayload).toBeDefined();
    const duplicateResponses = await Promise.all([
      browserRequest(phonePage, `${apiOrigin}/api/commands`, 'POST', lastCommandPayload),
      browserRequest(phonePage, `${apiOrigin}/api/commands`, 'POST', lastCommandPayload)
    ]);
    expect(duplicateResponses.map((response) => response.status)).toEqual([200, 200]);
    expect(duplicateResponses[0]?.body).toEqual(duplicateResponses[1]?.body);
    const afterDuplicate = await currentWorld(phonePage, apiOrigin);
    expect(afterDuplicate.tree.remaining).toBe(3);
    expect(afterDuplicate.resources.wood).toBe(1);

    await phonePage.reload();
    let saved = await currentWorld(phonePage, apiOrigin);
    expect(saved.worker.task?.phase).toMatch(/walking_to_source|gathering/);
    await expect.poll(async () => (await currentWorld(phonePage, apiOrigin)).worker.task?.phase, { timeout: 12_000 })
      .toBe('gathering');
    await expect(phonePage.locator('#worker-state')).toHaveText('Рубит дерево');
    await expect.poll(async () => (await currentWorld(phonePage, apiOrigin)).worker.task?.phase, { timeout: 8_000 })
      .toBe('carrying_to_storage');
    saved = await currentWorld(phonePage, apiOrigin);
    expect(saved.worker.cargo).toBe(1);
    expect(saved.tree.remaining).toBe(2);
    expect(saved.resources.wood).toBe(1);
    await expect(phonePage.locator('#worker-state')).toContainText('Несёт 1 бревно');

    await phonePage.reload();
    saved = await currentWorld(phonePage, apiOrigin);
    expect(saved.worker.cargo).toBe(1);
    expect(saved.worker.task?.phase).toMatch(/carrying_to_storage|unloading/);
    await expect.poll(async () => (await currentWorld(phonePage, apiOrigin)).resources.wood, { timeout: 12_000 })
      .toBe(2);
    saved = await currentWorld(phonePage, apiOrigin);
    expect(saved.worker.cargo).toBe(0);
    expect(saved.worker.task).toBeNull();

    for (const expectedWood of [3, 4]) {
      await selectWorkerByCanvasTap(phonePage, apiOrigin);
      const before = await currentWorld(phonePage, apiOrigin);
      await phonePage.getByRole('button', { name: /Поручить добычу дерева/ }).click();
      await expect.poll(async () => (await currentWorld(phonePage, apiOrigin)).resources.wood, { timeout: 15_000 })
        .toBe(expectedWood);
      const after = await currentWorld(phonePage, apiOrigin);
      expect(after.tree.remaining).toBe(before.tree.remaining - 1);
      expect(after.worker.cargo).toBe(0);
    expect(after.worker.task).toBeNull();
    }

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
    const phoneCanvasBox = await phonePage.locator('#world-scene canvas').boundingBox();
    expect(phoneCanvasBox).not.toBeNull();
    if (!phoneCanvasBox) throw new Error('Phone world canvas is missing.');
    const cameraCenter = await phonePage.locator('#world-scene').evaluate((element) => ({
      worldViewX: Number((element as HTMLElement).dataset.cameraWorldViewX ?? '0'),
      zoom: Number((element as HTMLElement).dataset.cameraZoom ?? String(MOBILE_ZOOM))
    }));
    await phonePage.locator('#world-scene canvas').click({
      position: {
        x: (CELL_SIZE + CELL_SIZE * 0.75 - cameraCenter.worldViewX) * cameraCenter.zoom,
        y: phoneCanvasBox.height / 2 + (-48 - 50) * MOBILE_ZOOM
      }
    });
    await expect(phonePage.locator('#placement-reason')).toHaveText(/Место подходит/, { timeout: 5_000 });
    await expect(phonePage.getByRole('button', { name: 'Построить здесь' })).toBeEnabled();
    await phonePage.getByRole('button', { name: 'Построить здесь' }).click();
    await expect.poll(async () => (await currentWorld(phonePage, apiOrigin)).buildings.length, { timeout: 5_000 })
      .toBe(1);
    let buildingWorld = await currentWorld(phonePage, apiOrigin);
    expect(buildingWorld.resources.wood).toBe(1);
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
    await phonePage.reload();
    await expect(phonePage.getByRole('heading', { name: 'Новый берег' })).toBeVisible();
    serverRestartInProgress = false;
    buildingWorld = await currentWorld(phonePage, apiOrigin);
    expect(buildingWorld.buildings[0]?.anchor).toEqual({ x: 1, y: -1 });
    expect(buildingWorld.buildings[0]?.progressTicks).toBeGreaterThanOrEqual(progressBeforeRestart);
    expect(buildingWorld.resources.wood).toBe(1);
    await expect.poll(async () => (await currentWorld(phonePage, apiOrigin)).buildings[0]?.state, { timeout: 12_000 })
      .toBe('complete');
    buildingWorld = await currentWorld(phonePage, apiOrigin);
    expect(buildingWorld.buildings[0]?.reservedWood).toBe(0);
    expect(buildingWorld.worker.task).toBeNull();
    expect(buildingWorld.resources.wood).toBe(1);
    expect(consoleErrors).toEqual([]);

    const evidencePath = path.join(projectRoot, 'docs/v2/evidence/G2/G2.1-LIVE-SETTLEMENT');
    await mkdir(evidencePath, { recursive: true });
    await page.screenshot({ path: path.join(evidencePath, 'computer.png'), fullPage: true });
    await phonePage.screenshot({ path: path.join(evidencePath, 'phone-emulated.png'), fullPage: true });
    const sourceFiles = [
      'apps/client-v2/src/main.ts',
      'apps/client-v2/src/settlement-scene.ts',
      'apps/client-v2/src/style.css',
      'apps/server-v2/src/server.ts',
      'packages/peace-v2-shared/src/index.ts',
      'packages/peace-v2-sim/src/settlement.ts',
      'db/peace-v2/migrations/0003_live_settlement.sql',
      'apps/client-v2/e2e/peaceful-slice.spec.ts'
    ];
    const sourceSha256 = Object.fromEntries(await Promise.all(sourceFiles.map(async (file) => [
      file, createHash('sha256').update(await readFile(path.join(projectRoot, file))).digest('hex')
    ])));
    await writeFile(path.join(evidencePath, 'playwright.json'), `${JSON.stringify({
      testId: 'V2-G21-LIVE-01', gate: 'G2.1', project: testInfo.project.name, result: 'PASS',
      databaseName: 'avanpost_v2_test', restartedApi: true, selectedBuildingAnchor: { x: 1, y: -1 },
      networkMode: process.env.AVANPOST_V2_ENABLE_LAN === 'true' ? 'explicit-private-lan' : 'loopback',
      sourceSha256,
      assertions: [
        'gather starts as a persisted walking task; tree and storage counts stay unchanged until their server phases',
        'reload during movement and carrying preserves route, phase, cargo and source remainder',
        'wood enters storage only after server-side unloading',
        'building ghost confirms the exact selected anchor; materials reserve once and progress survives reload/API restart',
        'desktop wheel zoom and mobile touch-camera behavior are covered by browser projects',
        'physical phone and owner acceptance remain manual'
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
