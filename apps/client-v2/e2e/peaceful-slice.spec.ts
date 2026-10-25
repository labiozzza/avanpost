import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';

async function browserRequest(page: Page, url: string, method = 'GET', body?: unknown) {
  return page.evaluate(async ({ requestUrl, requestMethod, requestBody }) => {
    const response = await fetch(requestUrl, {
      method: requestMethod,
      credentials: 'include',
      headers: requestBody === undefined ? { accept: 'application/json' } : {
        accept: 'application/json', 'content-type': 'application/json'
      },
      ...(requestBody === undefined ? {} : { body: JSON.stringify(requestBody) })
    });
    return { status: response.status, body: await response.json() as unknown };
  }, { requestUrl: url, requestMethod: method, requestBody: body });
}

test('localhost session persists; refreshed handoff pairs a mobile browser that plays the world', async ({ page, browser }, testInfo) => {
  test.skip(testInfo.project.name !== 'peace-v2-desktop', 'The desktop project checks localhost pairing; the mobile project checks the LAN read-only view.');
  const consoleErrors: string[] = [];
  page.on('console', (message) => { if (message.type() === 'error') consoleErrors.push(message.text()); });
  page.on('pageerror', (error) => consoleErrors.push(error.message));

  const privateHost = process.env.AVANPOST_V2_ENABLE_LAN === 'true'
    ? process.env.AVANPOST_V2_BIND_HOST ?? '127.0.0.1'
    : '127.0.0.1';
  const apiOrigin = `http://${privateHost}:8788`;
  const computerUrl = process.env.AVANPOST_V2_ENABLE_LAN === 'true'
    ? 'http://localhost:4175/'
    : 'http://localhost:4174/';
  const phoneUrl = process.env.AVANPOST_V2_ENABLE_LAN === 'true'
    ? `http://${privateHost}:4174/`
    : computerUrl;
  const computerApiOrigin = process.env.AVANPOST_V2_ENABLE_LAN === 'true'
    ? new URL(computerUrl).origin
    : apiOrigin;
  await page.goto(computerUrl);
  await expect(page.getByRole('heading', { name: 'Новый берег' })).toBeVisible();
  await expect(page.locator('#world-scene canvas')).toBeVisible();
  await expect(page.locator('#pairing-code')).toBeHidden();
  await expect(page.getByRole('button', { name: /Сходить за деревом/ })).toBeDisabled();
  const unauthenticated = await page.request.get(`${apiOrigin}/api/world`);
  expect(unauthenticated.status()).toBe(401);
  const remoteOrigin = await page.request.get('http://127.0.0.1:8789/api/launcher/pairing-code', {
    headers: { origin: 'http://attacker.invalid:4174', referer: 'http://attacker.invalid:4174/' }
  });
  expect(remoteOrigin.status()).toBe(403);

  await page.getByRole('button', { name: 'Показать код на этом компьютере' }).click();
  const code = (await page.locator('#pairing-code').textContent())?.trim() ?? '';
  expect(code.length).toBe(32);
  await page.locator('#pairing-code').evaluate((element) => {
    element.textContent = '';
    (element as HTMLOutputElement).hidden = true;
  });
  await page.getByLabel('Одноразовый код').fill(code);
  await page.getByRole('button', { name: 'Подключить' }).click();
  await expect(page.locator('#pairing-summary')).toHaveText('Мир подключён к этому браузеру', { timeout: 5_000 });
  const computerWorld = await browserRequest(page, `${computerApiOrigin}/api/world`);
  expect(computerWorld.status).toBe(200);
  await expect(page.getByRole('button', { name: /Илья.*выбрать рабочего/ })).toBeEnabled();
  await page.reload();
  await expect(page.locator('#pairing-summary')).toHaveText('Мир подключён к этому браузеру');
  expect((await browserRequest(page, `${computerApiOrigin}/api/world`)).status).toBe(200);

  await page.locator('#pairing-panel summary').click();
  await page.getByRole('button', { name: 'Показать код на этом компьютере' }).click();
  await expect(page.locator('#pairing-code')).toHaveText(/^[a-f0-9]{32}$/);
  const phoneCode = (await page.locator('#pairing-code').textContent())?.trim() ?? '';
  expect(phoneCode.length).toBe(32);
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
  const phoneErrors: string[] = [];
  const expectedConflictErrors: string[] = [];
  phonePage.on('console', (message) => {
    if (message.type() !== 'error') return;
    if (message.text().includes('409 (Conflict)')) expectedConflictErrors.push(message.text());
    else phoneErrors.push(message.text());
  });
  phonePage.on('pageerror', (error) => phoneErrors.push(error.message));
  try {
  await phonePage.goto(phoneUrl);
  await expect(phonePage.getByRole('heading', { name: 'Новый берег' })).toBeVisible();
  await expect(phonePage.getByRole('button', { name: /Сходить за деревом/ })).toBeDisabled();
  const phoneUnauthenticated = await phonePage.request.get(`${apiOrigin}/api/world`);
  expect(phoneUnauthenticated.status()).toBe(401);
  await phonePage.getByLabel('Одноразовый код').fill(phoneCode);
  await phonePage.getByRole('button', { name: 'Подключить' }).click();
  await expect(phonePage.locator('#action-status')).not.toHaveText('Проверяем одноразовый код…', { timeout: 10_000 });
  await expect(phonePage.locator('#pairing-summary')).toHaveText('Мир подключён к этому браузеру', { timeout: 5_000 });
  await expect(phonePage.getByRole('button', { name: /Илья.*выбрать рабочего/ })).toBeEnabled();
  await phonePage.getByRole('button', { name: /Илья.*выбрать рабочего/ }).click();
  await expect(phonePage.getByRole('button', { name: /Илья.*выбран/ })).toHaveAttribute('aria-pressed', 'true');

  let worldResponse = await browserRequest(phonePage, `${apiOrigin}/api/world`);
  expect(worldResponse.status).toBe(200);
  let world = worldResponse.body as {
    revision: { worldVersion: number; geometryVersion: number };
    resources: { wood: number };
    tree: { remaining: number };
    worker: { cargo: number };
    buildings: Array<{ kind: string }>;
  };
  const staleResponse = await browserRequest(phonePage, `${apiOrigin}/api/commands`, 'POST', {
    requestId: `stale-${crypto.randomUUID()}`,
    expectedWorldVersion: world.revision.worldVersion - 1,
    expectedGeometryVersion: world.revision.geometryVersion,
    kind: 'collect-wood'
  });
  expect(staleResponse.status).toBe(409);
  expect((staleResponse.body as { code?: string }).code).toBe('STALE_WORLD');
  const beforeDeliveryWood = world.resources.wood;
  if (world.tree.remaining > 0 && world.worker.cargo === 0) {
    const [collectResponse] = await Promise.all([
      phonePage.waitForResponse((response) => response.url().endsWith('/api/commands') && response.request().method() === 'POST'),
      phonePage.getByRole('button', { name: /Сходить за деревом/ }).click()
    ]);
    expect(collectResponse.status()).toBe(200);
    await expect(phonePage.getByText('Илья срубил бревно и несёт его со стороны леса.')).toBeVisible();
    const collectedState = await collectResponse.json();
    const replay = await browserRequest(phonePage, `${apiOrigin}/api/commands`, 'POST', collectResponse.request().postDataJSON());
    expect(replay.status).toBe(200);
    expect(replay.body).toEqual(collectedState);
    await phonePage.getByRole('button', { name: /Доставить на склад/ }).click();
    await expect(phonePage.getByText('Бревно доставлено. Запас поселения сохранён.')).toBeVisible();
    worldResponse = await browserRequest(phonePage, `${apiOrigin}/api/world`);
    world = worldResponse.body as typeof world;
    expect(world.resources.wood).toBe(beforeDeliveryWood + 1);
  }
  if (!world.buildings.some((building) => building.kind === 'cabin')) {
    while (world.resources.wood < 3 && world.tree.remaining > 0) {
      if (world.worker.cargo === 0) {
        await phonePage.getByRole('button', { name: /Сходить за деревом/ }).click();
        await expect(phonePage.getByText('Илья срубил бревно и несёт его со стороны леса.')).toBeVisible();
      }
      await phonePage.getByRole('button', { name: /Доставить на склад/ }).click();
      await expect(phonePage.getByText('Бревно доставлено. Запас поселения сохранён.')).toBeVisible();
      worldResponse = await browserRequest(phonePage, `${apiOrigin}/api/world`);
      world = worldResponse.body as typeof world;
    }
    expect(world.resources.wood).toBeGreaterThanOrEqual(3);
    await phonePage.getByRole('button', { name: /Построить домик/ }).click();
    await expect(phonePage.getByText('Домик построен. Прогресс сохранён в мире.')).toBeVisible();
  }

  await phonePage.reload();
  await expect(phonePage.getByText('Мир подключён к этому браузеру')).toBeVisible();
  worldResponse = await browserRequest(phonePage, `${apiOrigin}/api/world`);
  expect(worldResponse.status).toBe(200);
  world = worldResponse.body as typeof world;
  expect(world.buildings.some((building) => building.kind === 'cabin')).toBe(true);
  expect(world.worker.cargo).toBe(0);
  expect(consoleErrors).toEqual([]);
  expect(phoneErrors).toEqual([]);
  expect(expectedConflictErrors).toHaveLength(1);
  const pairedOwnerComputer = await browserRequest(page, `${computerApiOrigin}/api/world`);
  expect(pairedOwnerComputer.status).toBe(200);

  const projectRoot = process.cwd();
  const evidencePath = path.join(projectRoot, 'docs/v2/evidence/G2/V2-G2-SLICE-01');
  await mkdir(evidencePath, { recursive: true });
  const screenshotPath = path.join(evidencePath, 'peace-v2-desktop.png');
  await page.screenshot({ path: screenshotPath, fullPage: true });
  await phonePage.screenshot({ path: path.join(evidencePath, 'peace-v2-mobile-paired.png'), fullPage: true });
  const sourceFiles = [
    'apps/client-v2/src/main.ts',
    'apps/client-v2/src/settlement-scene.ts',
    'apps/client-v2/src/style.css',
    'apps/client-v2/vite.config.ts',
    'apps/server-v2/src/server.ts',
    'apps/server-v2/src/config.ts',
    'apps/server-v2/src/cli/dev.ts',
    'apps/server-v2/src/cli/doctor.ts',
    'apps/server-v2/test/pairing-handoff.test.ts',
    'db/peace-v2/migrations/0002_persistent_world.sql',
    'packages/peace-v2-shared/src/index.ts',
    'playwright.peace-v2.config.ts',
    'apps/client-v2/e2e/peaceful-slice.spec.ts'
  ];
  const sourceSha256 = Object.fromEntries(await Promise.all(sourceFiles.map(async (file) => [
    file, createHash('sha256').update(await readFile(path.join(projectRoot, file))).digest('hex')
  ])));
  const commit = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: projectRoot, encoding: 'utf8' }).trim();
  await writeFile(path.join(evidencePath, 'playwright.json'), `${JSON.stringify({
    testId: 'V2-G2-SLICE-01', gate: 'G2', project: testInfo.project.name, result: 'PASS',
    clientUrl: page.url(), databaseName: 'avanpost_v2_test', commit, sourceSha256,
    screenshot: path.relative(projectRoot, screenshotPath),
    networkMode: process.env.AVANPOST_V2_ENABLE_LAN === 'true' ? 'explicit-private-lan' : 'loopback',
    assertions: ['localhost session cookie survives reload through the private-bound API proxy', 'consumed code refresh pairs a separate mobile browser over the LAN bind', 'stale command rejected and duplicate replay is idempotent', 'worker selected; carry/delivery and cabin persist after reload', 'physical phone still requires manual verification']
  }, null, 2)}\n`, 'utf8');
  } finally {
    await page.locator('#pairing-input').evaluate((element) => { (element as HTMLInputElement).value = ''; }).catch(() => undefined);
    await phonePage.locator('#pairing-input').evaluate((element) => { (element as HTMLInputElement).value = ''; }).catch(() => undefined);
    await phoneContext.close();
  }
});

test('mobile read-only settlement fits the viewport before pairing', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'peace-v2-mobile', 'This is the mobile project coverage.');
  await page.goto('/');
  const apiOrigin = `http://${new URL(page.url()).hostname}:8788`;
  await expect(page.getByRole('heading', { name: 'Новый берег' })).toBeVisible();
  await expect(page.locator('#world-scene canvas')).toBeVisible();
  await expect(page.getByRole('button', { name: /Сходить за деревом/ })).toBeDisabled();
  const dimensions = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    document: document.documentElement.scrollWidth,
    scene: document.querySelector('#world-scene')?.getBoundingClientRect().width ?? 0
  }));
  expect(dimensions.document).toBeLessThanOrEqual(dimensions.viewport);
  expect(dimensions.scene).toBeGreaterThan(250);
  const previewResponse = await page.request.get(`${apiOrigin}/api/world/preview`);
  expect(previewResponse.status()).toBe(200);
  const preview = await previewResponse.json() as Record<string, unknown>;
  expect(preview).not.toHaveProperty('workerId');
  const evidencePath = path.join(process.cwd(), 'docs/v2/evidence/G2/V2-G2-SLICE-01');
  await mkdir(evidencePath, { recursive: true });
  await page.screenshot({ path: path.join(evidencePath, 'peace-v2-mobile.png'), fullPage: true });
});
