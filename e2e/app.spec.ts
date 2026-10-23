import { expect, test, type Page } from '@playwright/test';

type PlacementPoint = {
  sectorId: string;
  x: number;
  y: number;
  screen: { x: number; y: number };
};

type DebugSnapshot = {
  nodes: Array<{ item: string; active: boolean; amount: number }>;
  buildings: Array<{ type: string; status: string }>;
  laborers: Array<{ residentId: string | null; status: string }>;
  residents: Array<{
    id: string;
    state: string;
    schools: string[];
    profession: string;
    xp: number;
  }>;
};

declare global {
  interface Window {
    __avanpost?: {
      placementPoint: () => PlacementPoint | null;
      snapshot: () => DebugSnapshot | null;
    };
  }
}

async function debugSnapshot(page: Page): Promise<DebugSnapshot> {
  await page.waitForFunction(() => Boolean(window.__avanpost?.snapshot()));
  const snapshot = await page.evaluate(() => window.__avanpost?.snapshot() ?? null);
  if (!snapshot) throw new Error('debug snapshot is unavailable');
  return snapshot;
}

async function waitForBuildings(page: Page, types: string[]) {
  await page.waitForFunction(
    (expected) => {
      const snapshot = window.__avanpost?.snapshot();
      if (!snapshot) return false;
      return expected.every((type) =>
        snapshot.buildings.some(
          (building) => building.type === type && building.status === 'complete',
        ),
      );
    },
    types,
    { timeout: 90_000 },
  );
}

async function waitForIdleLaborers(page: Page) {
  await page.waitForFunction(
    () => {
      const snapshot = window.__avanpost?.snapshot();
      return Boolean(snapshot) && snapshot!.laborers.every((laborer) => laborer.status === 'idle');
    },
    undefined,
    { timeout: 60_000 },
  );
}

async function residentIds(page: Page): Promise<string[]> {
  return page
    .locator('[data-testid="resident-row"]')
    .evaluateAll((rows) => rows.map((row) => (row as HTMLElement).dataset.id ?? ''));
}

function residentRow(page: Page, id: string) {
  return page.locator(`[data-testid="resident-row"][data-id="${id}"]`);
}

async function beginPlacement(page: Page, type: string): Promise<PlacementPoint> {
  await page.getByTestId(`build-${type}`).click();
  await expect(page.getByTestId('placement-bar')).toBeVisible();
  await page.waitForTimeout(150);
  const point = await page.evaluate(() => window.__avanpost?.placementPoint() ?? null);
  if (!point) throw new Error(`no placement point for ${type}`);
  return point;
}

async function confirmPlacement(page: Page, point: PlacementPoint, touch: boolean) {
  if (touch) {
    await page.touchscreen.tap(point.screen.x, point.screen.y);
    await page.waitForTimeout(250);
    if (await page.getByTestId('placement-bar').isVisible()) {
      await page.touchscreen.tap(point.screen.x, point.screen.y);
    }
  } else {
    await page.mouse.click(point.screen.x, point.screen.y);
  }
  await expect(page.getByTestId('placement-bar')).toBeHidden();
}

async function placeBuilding(page: Page, type: string, touch: boolean) {
  const point = await beginPlacement(page, type);
  await confirmPlacement(page, point, touch);
  await expect(page.getByTestId(`build-${type}`)).toBeDisabled({ timeout: 15_000 });
}

test('показывает сцену, серверные ресурсы и доступные постройки', async ({ page }, testInfo) => {
  await page.goto('/');

  await expect(page.getByTestId('wood')).toHaveText('45');
  await expect(page.getByTestId('stone')).toHaveText('35');
  await expect(page.getByTestId('tree')).toBeVisible();
  await expect(page.getByTestId('build-house')).toBeEnabled();
  await expect(page.getByTestId('build-workshop')).toBeEnabled();
  await expect(page.getByTestId('build-academy')).toBeEnabled();
  await expect(page.getByTestId('build-storehouse')).toBeEnabled();
  await expect(page.getByTestId('status')).toContainText('Нажми на дерево');
  await expect(page.getByTestId('server-status')).toContainText('Сервер: тик');
  await expect(page.getByTestId('state-version')).toHaveCount(0);
  await expect(page.locator('canvas#world')).toBeVisible();

  await page.screenshot({
    path: `docs/evidence/phaser-${testInfo.project.name}-initial.png`,
    fullPage: true,
  });
});

test('рубит дерево, приносит бревно и переживает перезагрузку', async ({ page }) => {
  await page.goto('/?fast=1');

  const before = await debugSnapshot(page);
  expect(before.nodes.find((node) => node.item === 'logs')?.active).toBe(false);

  await page.getByTestId('tree').click();
  await expect(page.getByTestId('tree-menu')).toBeVisible();
  await expect(page.getByTestId('chop')).toHaveText('Добывать лес');
  await page.getByTestId('chop').click();
  await expect(page.getByTestId('status')).toContainText(/добытчик/i);

  await expect(page.getByTestId('wood')).not.toHaveText('45', { timeout: 30_000 });
  const woodAfterChop = Number(await page.getByTestId('wood').textContent());

  const chopping = await debugSnapshot(page);
  expect(chopping.nodes.find((node) => node.item === 'logs')?.active).toBe(true);

  await page.reload({ waitUntil: 'domcontentloaded' });
  const reloaded = await debugSnapshot(page);
  expect(reloaded.nodes.find((node) => node.item === 'logs')?.active).toBe(true);
  expect(Number(await page.getByTestId('wood').textContent())).toBeGreaterThanOrEqual(
    woodAfterChop,
  );

  await page.getByTestId('tree').click();
  await expect(page.getByTestId('chop')).toHaveText('Остановить добычу');
  await page.getByTestId('chop').click();
  await expect(page.getByTestId('status')).toContainText('Добыча остановлена');

  const stopped = await debugSnapshot(page);
  expect(stopped.nodes.find((node) => node.item === 'logs')?.active).toBe(false);
});

test('ставит дом призраком на сетке и поднимает ёмкость (I.4)', async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  await page.goto('/?fast=1');

  await expect(page.getByTestId('server-status')).toContainText('Сервер: тик');
  await expect(page.locator('body')).toHaveAttribute('data-house', 'not-built');

  await page.getByTestId('residents-toggle').click();
  await expect(page.getByTestId('population-count')).toHaveText('Жителей 3 / 3');
  await page.getByTestId('residents-close').click();

  const touch = testInfo.project.use.hasTouch === true;
  const point = await beginPlacement(page, 'house');
  await expect(page.getByTestId('placement-title')).toContainText('Жилой дом');
  await confirmPlacement(page, point, touch);

  await expect(page.locator('body')).toHaveAttribute('data-house', 'building', {
    timeout: 15_000,
  });
  await expect(page.getByTestId('status')).toContainText('Заказ на строительство принят');

  await expect(page.locator('body')).toHaveAttribute('data-house', 'built', {
    timeout: 90_000,
  });
  await expect(page.getByTestId('build-house')).toHaveText(/Готово/);

  await page.getByTestId('residents-toggle').click();
  await expect(page.getByTestId('population-count')).toHaveText(/Жителей \d+ \/ 5/, {
    timeout: 30_000,
  });

  await page.screenshot({
    path: `docs/evidence/i4-house-build-phaser-${testInfo.project.name}.png`,
    fullPage: true,
  });
});

test('отменяет размещение по Escape и сохраняет режим после ошибки', async ({ page }) => {
  await page.goto('/?fast=1');
  await expect(page.getByTestId('server-status')).toContainText('Сервер: тик');

  await page.getByTestId('build-house').click();
  await expect(page.getByTestId('placement-bar')).toBeVisible();
  await expect(page.getByTestId('placement-hint')).not.toBeEmpty();

  await page.keyboard.press('Escape');
  await expect(page.getByTestId('placement-bar')).toBeHidden();
  await expect(page.getByTestId('status')).toContainText('Размещение отменено');
  await expect(page.getByTestId('build-house')).toBeEnabled();

  const point = await beginPlacement(page, 'house');
  await page.getByTestId('placement-cancel').click();
  await expect(page.getByTestId('placement-bar')).toBeHidden();
  expect(point.sectorId).toBeTruthy();
});

test('житель учится в школе, переживает перезагрузку и получает опыт (I.4)', async ({
  page,
}, testInfo) => {
  await page.goto('/?fast=1');

  await expect(page.getByTestId('server-status')).toContainText('Сервер: тик');
  await page.getByTestId('residents-toggle').click();
  await expect(page.getByTestId('residents-panel')).toBeVisible();
  await expect(page.getByTestId('resident-row')).toHaveCount(3);

  const [first, second] = await residentIds(page);
  if (!first || !second) throw new Error('expected three residents');

  await residentRow(page, first).click();
  await page.getByTestId('send-school-gather').click();
  await expect(residentRow(page, first).locator('.resident-state')).toHaveText('Учится');
  await expect(page.getByTestId('status')).toContainText('Школа добычи');
  await expect(page.getByTestId('resident-training')).toBeVisible();

  const studying = await debugSnapshot(page);
  expect(studying.residents.find((resident) => resident.id === first)?.state).toBe('school');

  await page.reload({ waitUntil: 'domcontentloaded' });
  const reloaded = await debugSnapshot(page);
  const persisted = reloaded.residents.find((resident) => resident.id === first);
  expect(persisted?.state === 'school' || persisted?.schools.includes('gather')).toBe(true);

  await page.getByTestId('residents-toggle').click();
  await residentRow(page, first).click();
  await expect(residentRow(page, first).locator('.resident-badge')).toHaveText('Добытчик', {
    timeout: 30_000,
  });
  await residentRow(page, first).click();
  await expect(page.getByTestId('resident-level')).toContainText('опыт 60');

  await residentRow(page, second).click();
  await page.getByTestId('send-school-craft').click();
  await expect(residentRow(page, second).locator('.resident-state')).toHaveText('Учится');
  await expect(residentRow(page, second).locator('.resident-badge')).toHaveText('Ремесленник', {
    timeout: 30_000,
  });

  await page.screenshot({
    path: `docs/evidence/i4-residents-phaser-${testInfo.project.name}.png`,
    fullPage: true,
  });
});

test('ставит мастерскую и академию через сетку (I.5)', async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  await page.goto('/?fast=1');
  await expect(page.getByTestId('server-status')).toContainText('Сервер: тик');

  const touch = testInfo.project.use.hasTouch === true;
  await placeBuilding(page, 'workshop', touch);
  await placeBuilding(page, 'academy', touch);

  await page.getByTestId('craft-toggle').click();
  await expect(page.getByTestId('craft-panel')).toBeVisible();
  await expect(page.getByTestId('craft-status')).toContainText('Мастерская');
  await page.getByTestId('craft-close').click();

  await page.getByTestId('research-toggle').click();
  await expect(page.getByTestId('research-panel')).toBeVisible();
  await expect(page.getByTestId('research-status')).toContainText('Очки исследования: 0');
  await expect(page.getByTestId('research-row').first()).toBeVisible();

  await page.screenshot({
    path: `docs/evidence/i5-craft-research-panels-phaser-${testInfo.project.name}.png`,
    fullPage: true,
  });
});

test('без учёного очки исследования не растут (I.5)', async ({ page }) => {
  await page.goto('/?fast=1');

  await expect(page.getByTestId('server-status')).toContainText('Сервер: тик');
  await page.getByTestId('research-toggle').click();
  await expect(page.getByTestId('research-panel')).toBeVisible();

  const firstTech = page.getByTestId('research-row').first();
  const techId = await firstTech.getAttribute('data-tech');
  if (!techId) throw new Error('expected a research node');

  await expect(page.getByTestId('research-status')).toContainText('Очки исследования: 0');
  await expect(firstTech.getByTestId('research-state')).toHaveText('Доступно');

  await firstTech.getByTestId('research-start').click();
  await expect(page.getByTestId('status')).toContainText('Исследование запущено');
  await expect(firstTech.getByTestId('research-state')).toContainText('Ждёт учёного');

  const tickBefore = Number(
    (await page.getByTestId('server-status').textContent())?.match(/тик (\d+)/)?.[1] ?? 0,
  );
  await page.waitForFunction(
    (before) => {
      const text = document.querySelector('[data-testid="server-status"]')?.textContent ?? '';
      return Number(text.match(/тик (\d+)/)?.[1] ?? 0) > before;
    },
    tickBefore,
  );
  await expect(page.getByTestId('research-status')).toContainText('Очки исследования: 0');
  await expect(firstTech.getByTestId('research-state')).toContainText('Ждёт учёного');
});

test('исследует плотницкое дело и производит доску (I.5)', async ({ page }, testInfo) => {
  test.setTimeout(180_000);
  await page.goto('/?fast=1');
  await expect(page.getByTestId('server-status')).toContainText('Сервер: тик');

  const touch = testInfo.project.use.hasTouch === true;
  await placeBuilding(page, 'workshop', touch);
  await placeBuilding(page, 'academy', touch);
  await waitForBuildings(page, ['workshop', 'academy']);
  await waitForIdleLaborers(page);

  await page.getByTestId('residents-toggle').click();
  const [craftsmanId, scholarId] = await residentIds(page);
  if (!craftsmanId || !scholarId) throw new Error('expected residents');
  await residentRow(page, craftsmanId).click();
  await page.getByTestId('send-school-craft').click();
  await expect(residentRow(page, craftsmanId).locator('.resident-state')).toHaveText('Учится');
  await expect(residentRow(page, craftsmanId).locator('.resident-badge')).toHaveText(
    'Ремесленник',
    { timeout: 30_000 },
  );
  await page.getByTestId('residents-close').click();

  await page.getByTestId('research-toggle').click();
  await page.getByTestId('research-scholar').selectOption(scholarId);
  const carpentry = page.locator('[data-testid="research-row"][data-tech="carpentry"]');
  await expect(carpentry.getByTestId('research-start')).toBeEnabled({ timeout: 90_000 });
  await carpentry.getByTestId('research-start').click();
  await expect(carpentry.getByTestId('research-state')).toHaveText('Изучено', {
    timeout: 30_000,
  });
  await page.screenshot({
    path: `docs/evidence/i5-craft-cycle-phaser-${testInfo.project.name}-research.png`,
    fullPage: true,
  });
  await page.getByTestId('research-close').click();

  await page.getByTestId('craft-toggle').click();
  await expect(page.getByTestId('craft-status')).toContainText('Мастерская готова', {
    timeout: 90_000,
  });
  const planksBefore = Number(
    (await page.getByTestId('craft-status').textContent())?.match(/Доски на складе: (\d+)/)?.[1],
  );
  expect(Number.isFinite(planksBefore)).toBe(true);
  await page.getByTestId('craft-start').first().click();
  await expect(page.getByTestId('status')).toContainText('Ремесло запущено');
  await expect(page.getByTestId('craft-status')).toContainText(
    `Доски на складе: ${planksBefore + 1}`,
    { timeout: 45_000 },
  );

  await page.screenshot({
    path: `docs/evidence/i5-craft-cycle-phaser-${testInfo.project.name}-complete.png`,
    fullPage: true,
  });
});

test('отдаёт PWA-манифест', async ({ request }) => {
  const response = await request.get('/manifest.webmanifest');
  expect(response.ok()).toBe(true);
  const manifest = (await response.json()) as { name: string; display: string };
  expect(manifest.name).toBe('Аванпост');
  expect(manifest.display).toBe('standalone');
});
