import { expect, test, type Locator, type Page } from '@playwright/test';
import { writeFile } from 'node:fs/promises';

const handoffPort = Number(process.env.AVANPOST_V2_G72_HANDOFF_PORT ?? 18919);

function attachBrowserDiagnostics(page: Page) {
  const diagnostics = { consoleErrors: [] as string[], pageErrors: [] as string[], failedRequests: [] as string[], httpErrors: [] as string[] };
  const safePath = (value: string) => { try { return new URL(value).pathname; } catch { return value; } };
  page.on('console', (message) => { if (message.type() === 'error') diagnostics.consoleErrors.push(message.text()); });
  page.on('pageerror', (error) => diagnostics.pageErrors.push(error.message));
  page.on('requestfailed', (request) => diagnostics.failedRequests.push(`${request.method()} ${safePath(request.url())}: ${request.failure()?.errorText ?? 'failed'}`));
  page.on('response', (response) => {
    if (response.status() >= 400) diagnostics.httpErrors.push(`${response.status()} ${safePath(response.url())}`);
  });
  return { diagnostics, save: (testInfo: { outputPath: (name: string) => string }) =>
    writeFile(testInfo.outputPath('browser-diagnostics.json'), JSON.stringify(diagnostics, null, 2)) };
}

async function apiWorld(page: Page): Promise<any> {
  const response = await page.request.get(new URL('/api/world', page.url()).toString(), { timeout: 15_000 });
  if (!response.ok()) throw new Error(`World API returned ${response.status()}`);
  return response.json();
}

async function tapLocator(page: Page, target: Locator): Promise<void> {
  await target.scrollIntoViewIfNeeded();
  const hitTest = await target.evaluate((targetElement) => {
    const bounds = targetElement.getBoundingClientRect();
    const fractions = [.2, .35, .5, .65, .8];
    for (const fy of fractions) for (const fx of fractions) {
      const x = bounds.x + bounds.width * fx; const y = bounds.y + bounds.height * fy;
      const hit = document.elementFromPoint(x, y);
      const hitButton = hit?.closest('button');
      const sameButton = hitButton === targetElement || hitButton?.textContent?.trim() === targetElement.textContent?.trim();
      if (hit && (hit === targetElement || targetElement.contains(hit) || sameButton)) {
        return { x, y, offsetX: bounds.width * fx, offsetY: bounds.height * fy, matches: true };
      }
    }
    const x = bounds.x + bounds.width / 2; const y = bounds.y + bounds.height / 2;
    const hit = document.elementFromPoint(x, y);
    return {
      x, y, offsetX: bounds.width / 2, offsetY: bounds.height / 2,
      matches: false, viewport: { width: window.innerWidth, height: window.innerHeight },
      rect: { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height },
      target: `${targetElement.tagName.toLowerCase()}#${(targetElement as HTMLElement).id}`,
      hit: hit ? `${hit.tagName.toLowerCase()}#${(hit as HTMLElement).id}.${(hit as HTMLElement).className}` : null,
      hitButton: hit?.closest('button')?.id ?? null
    };
  });
  if (!hitTest.matches) throw new Error(`Touch target is obscured or outside the viewport: ${JSON.stringify(hitTest)}`);
  await target.tap({ position: { x: hitTest.offsetX, y: hitTest.offsetY } });
}

async function tapTarget(page: Page, selector: string): Promise<void> {
  await tapLocator(page, page.locator(selector));
}

async function tapGroundCell(page: Page, anchorX: number, touch = false): Promise<void> {
  const canvas = page.locator('#world-scene canvas');
  const box = await canvas.boundingBox();
  if (!box) throw new Error('Phaser canvas is not visible.');
  const point = await page.locator('#world-scene').evaluate((element, input) => {
    const data = (element as HTMLElement).dataset;
    const viewX = Number(data.cameraWorldViewX ?? 0); const viewY = Number(data.cameraWorldViewY ?? 0);
    const viewportX = Number(data.cameraViewportX ?? 0); const viewportY = Number(data.cameraViewportY ?? 0);
    const viewportWidth = Number(data.cameraViewportWidth ?? 1); const viewportHeight = Number(data.cameraViewportHeight ?? 1);
    const zoom = Number(data.cameraZoom ?? 1);
    for (let distance = 0; distance <= 24; distance++) {
      for (const candidate of distance === 0 ? [input.anchorX] : [input.anchorX - distance, input.anchorX + distance]) {
        const x = (viewportX + (candidate * 48 + 24 - viewX) * zoom) * input.width / viewportWidth;
        const y = (viewportY + (12 - viewY) * zoom) * input.height / viewportHeight;
        const screenX = input.left + x; const screenY = input.top + y;
        const hit = document.elementFromPoint(screenX, screenY);
        if (x >= 8 && x < input.width - 8 && y >= 8 && y < input.height - 8 && hit?.tagName.toLowerCase() === 'canvas') {
          return { x, y, candidate };
        }
      }
    }
    throw new Error(`No unobscured ground cell is visible near anchor ${input.anchorX}.`);
  }, { anchorX, width: box.width, height: box.height, left: box.x, top: box.y });
  if (touch) await page.touchscreen.tap(box.x + point.x, box.y + point.y);
  else await page.mouse.click(box.x + point.x, box.y + point.y);
}

test('G7.2: build a school, train a selected resident and retain the profession after reload', async ({ page }, testInfo) => {
  test.setTimeout(600_000);
  test.skip(testInfo.project.name !== 'g72-desktop', 'The desktop project owns the stateful school acceptance flow.');
  const browser = attachBrowserDiagnostics(page);
  await page.goto('/');
  await expect(page.locator('#world-scene canvas')).toBeVisible();
  if (!(await page.locator('#pairing-panel').evaluate((element) => (element as HTMLDetailsElement).open))) {
    await page.locator('#pairing-panel summary').click();
  }
  const code = await page.evaluate(async (port) => {
    const response = await fetch(`http://127.0.0.1:${port}/api/launcher/pairing-code`);
    if (!response.ok) throw new Error(`Pairing handoff returned ${response.status}`);
    return (await response.json() as { code: string }).code;
  }, handoffPort);
  await page.locator('#pairing-input').fill(code);
  await page.locator('#pair-button').click();
  await expect(page.locator('#pairing-summary')).toHaveText('Мир подключён к этому браузеру');
  await page.locator('#pairing-panel').evaluate((element) => { (element as HTMLDetailsElement).open = false; });

  const initial = await apiWorld(page);
  const resident = initial.residents.find((candidate: any) => candidate.workRole === 'none');
  expect(resident?.civilianProfession).toBe('general_worker');
  await tapGroundCell(page, -1);
  await expect(page.locator('#building-catalog')).toBeVisible();
  await expect(page.locator('#school-sciences-catalog-item')).toBeVisible();
  await page.locator('#school-extraction-catalog-item').click();
  await tapGroundCell(page, -1);
  await expect(page.locator('#confirm-placement')).toBeEnabled({ timeout: 10_000 });
  await page.locator('#confirm-placement').click();
  await expect.poll(async () => (await apiWorld(page)).buildings.find((building: any) => building.kind === 'school-extraction')?.state,
    { timeout: 60_000 }).toBe('complete');
  await expect.poll(async () => (await apiWorld(page)).buildings.find((building: any) => building.kind === 'school-extraction')?.trainingMaterialsWood)
    .toBeGreaterThan(0);

  await page.locator('#population-panel > summary').click();
  await page.locator('#population-registry button').filter({ hasText: resident.name }).click();
  await expect(page.locator('#training-control')).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('resident-before-training.png'), fullPage: true });
  const train = async (
    schoolLabel: string, expectedProfession: string, expectedLabel: string, expectedHistoryLength: number,
    trainee: { id: string; name: string } = resident
  ) => {
    await page.getByRole('button', { name: new RegExp(`${schoolLabel} → ${expectedLabel} · доступно`) }).click();
    await expect.poll(async () => (await apiWorld(page)).residents.find((candidate: any) => candidate.id === trainee.id)?.civilianProfession,
      { timeout: 90_000 }).toBe(expectedProfession);
    await expect.poll(async () => (await apiWorld(page)).residents.find((candidate: any) => candidate.id === trainee.id)?.learningHistory?.length)
      .toBe(expectedHistoryLength);
    await expect(page.locator('#inspector-detail')).toContainText(`профессия: ${expectedLabel}`);
  };
  await train('Школа добычи', 'extractor', 'Добытчик', 1);

  const buildSchool = async (schoolId: 'crafts' | 'logistics' | 'sciences', anchorX: number, label: string) => {
    if (await page.locator('#world-context').isVisible()) await page.locator('#close-context').click();
    await tapGroundCell(page, anchorX);
    await expect(page.locator('#building-catalog')).toBeVisible();
    await page.locator(`#school-${schoolId}-catalog-item`).click();
    await tapGroundCell(page, anchorX);
    await expect(page.locator('#confirm-placement')).toBeEnabled({ timeout: 10_000 });
    await page.locator('#confirm-placement').click();
    await expect.poll(async () => (await apiWorld(page)).buildings.find((building: any) => building.kind === `school-${schoolId}`)?.state,
      { timeout: 60_000 }).toBe('complete');
    await page.locator('#population-panel > summary').click();
    await page.locator('#population-registry button').filter({ hasText: resident.name }).click();
    await expect(page.locator('#inspector-detail')).toContainText(`профессия: ${label}`);
  };
  await buildSchool('crafts', -8, 'Добытчик');
  await train('Школа ремёсел', 'stonemason', 'Каменотёс', 2);
  await buildSchool('logistics', 12, 'Каменотёс');
  await train('Школа логистики', 'master_builder', 'Строительный мастер', 3);
  await buildSchool('sciences', 4, 'Строительный мастер');
  const scienceTrainee = initial.residents.find((candidate: any) => candidate.workRole === 'hauler');
  expect(scienceTrainee).toBeTruthy();
  await page.locator('#population-panel > summary').click();
  await page.locator('#population-registry button').filter({ hasText: scienceTrainee.name }).click();
  await train('Школа наук', 'researcher', 'Исследователь', 1, scienceTrainee);
  expect((await apiWorld(page)).buildings.filter((building: any) => building.kind.startsWith('school-') && building.state === 'complete'))
    .toHaveLength(4);
  expect((await apiWorld(page)).resources).toMatchObject({ wood: 14, stone: 6 });
  await page.screenshot({ path: testInfo.outputPath('resident-after-training.png'), fullPage: true });
  await page.reload();
  const reloaded = await apiWorld(page);
  expect(reloaded.residents.find((candidate: any) => candidate.id === resident.id)).toMatchObject({
    civilianProfession: 'master_builder', learningHistory: [
      { schoolIds: ['extraction'] }, { schoolIds: ['crafts'] }, { schoolIds: ['logistics'] }
    ]
  });
  expect(browser.diagnostics.pageErrors).toEqual([]);
  await browser.save(testInfo);
});

test('G7.2 mobile: inspect the profession catalog and training controls without horizontal overflow', async ({ page }, testInfo) => {
  test.skip(!testInfo.project.name.startsWith('g72-mobile'), 'Mobile projects own the responsive school UI checks.');
  const fullTouchFlow = testInfo.project.name === 'g72-mobile-390';
  test.setTimeout(fullTouchFlow ? 600_000 : 60_000);
  const browser = attachBrowserDiagnostics(page);
  await page.goto('/');
  await expect(page.locator('#world-scene canvas')).toBeVisible();
  if (!(await page.locator('#pairing-panel').evaluate((element) => (element as HTMLDetailsElement).open))) {
    if (fullTouchFlow) await tapTarget(page, '#pairing-panel summary');
    else await page.locator('#pairing-panel summary').click();
  }
  const code = await page.evaluate(async (port) => {
    const response = await fetch(`http://127.0.0.1:${port}/api/launcher/pairing-code`);
    if (!response.ok) throw new Error(`Pairing handoff returned ${response.status}`);
    return (await response.json() as { code: string }).code;
  }, handoffPort);
  await page.locator('#pairing-input').fill(code);
  if (fullTouchFlow) await tapTarget(page, '#pair-button');
  else await page.locator('#pair-button').click();
  await page.locator('#pairing-panel').evaluate((element) => { (element as HTMLDetailsElement).open = false; });
  const world = await apiWorld(page);
  const resident = world.residents.find((candidate: any) => candidate.id === 'worker-3');
  if (fullTouchFlow) {
    await tapGroundCell(page, -1, true);
    await expect(page.locator('#building-catalog')).toBeVisible();
    await expect(page.locator('#school-sciences-catalog-item')).toBeVisible();
    await tapTarget(page, '#school-extraction-catalog-item');
    await tapGroundCell(page, -1, true);
    await expect(page.locator('#confirm-placement')).toBeEnabled({ timeout: 10_000 });
    await tapTarget(page, '#confirm-placement');
    await expect.poll(async () => (await apiWorld(page)).buildings.find((building: any) => building.kind === 'school-extraction')?.state,
      { timeout: 120_000 }).toBe('complete');
    await tapTarget(page, '#zoom-in');
    await tapTarget(page, '#zoom-out');
    await tapTarget(page, '#camera-home');
  }
  await tapTarget(page, '#population-panel > summary');
  if (!(await page.locator('#profession-tree').evaluate((element) => (element as HTMLDetailsElement).open))) {
    if (fullTouchFlow) await tapTarget(page, '#profession-tree > summary');
    else await page.locator('#profession-tree > summary').click();
  }
  await expect(page.locator('.profession-tree__node')).toHaveCount(23);
  const residentButton = page.locator('#population-registry button').filter({ hasText: resident.name });
  if (fullTouchFlow) await tapLocator(page, residentButton);
  else await residentButton.click();
  await expect(page.locator('#training-control')).toBeVisible();
  await expect(page.locator('#training-options .training-option')).toHaveCount(4);
  if (fullTouchFlow) {
    await page.screenshot({ path: testInfo.outputPath('mobile-before-training.png'), fullPage: true });
    await tapLocator(page, page.locator('#training-options .training-option').filter({ hasText: 'Школа добычи' }));
    await expect.poll(async () => (await apiWorld(page)).residents.find((candidate: any) => candidate.id === resident.id)?.civilianProfession,
      { timeout: 180_000 }).toBe('extractor');
    await expect(page.locator('#inspector-detail')).toContainText('профессия: Добытчик');
    if (await page.locator('#world-context').isVisible()) await tapTarget(page, '#close-context');
    await tapGroundCell(page, -8, true);
    await expect(page.locator('#building-catalog')).toBeVisible();
    await tapTarget(page, '#school-crafts-catalog-item');
    await tapGroundCell(page, -8, true);
    await expect(page.locator('#confirm-placement')).toBeEnabled({ timeout: 10_000 });
    await tapTarget(page, '#confirm-placement');
    await expect.poll(async () => (await apiWorld(page)).buildings.find((building: any) => building.kind === 'school-crafts')?.state,
      { timeout: 120_000 }).toBe('complete');
    await tapTarget(page, '#population-panel > summary');
    await tapLocator(page, residentButton);
    await expect(page.locator('#inspector-detail')).toContainText('профессия: Добытчик');
    await tapLocator(page, page.locator('#training-options .training-option').filter({ hasText: 'Школа ремёсел' }));
    await expect.poll(async () => (await apiWorld(page)).residents.find((candidate: any) => candidate.id === resident.id)?.civilianProfession,
      { timeout: 180_000 }).toBe('stonemason');
    await expect(page.locator('#inspector-detail')).toContainText('профессия: Каменотёс');
    await page.screenshot({ path: testInfo.outputPath('mobile-after-training.png'), fullPage: true });
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  expect(browser.diagnostics.pageErrors).toEqual([]);
  await browser.save(testInfo);
});
