import { expect, test } from '@playwright/test';

async function collectWood(page: import('@playwright/test').Page, amount: number): Promise<void> {
  for (let index = 1; index <= amount; index += 1) {
    await page.getByTestId('tree').click();
    await page.getByTestId('chop').click();
    await page.waitForFunction(
      (expected) =>
        document.querySelector('[data-testid="wood"]')?.textContent === String(expected),
      index,
      { timeout: 12_000 }
    );
  }
}

test('показывает простую игровую сцену и ресурсы', async ({ page }, testInfo) => {
  await page.goto('/');

  await expect(page.getByTestId('wood')).toHaveText('0');
  await expect(page.getByTestId('stone')).toHaveText('0');
  await expect(page.getByTestId('tree')).toBeVisible();
  await expect(page.getByTestId('build-house')).toBeEnabled();
  await expect(page.getByTestId('build-sawmill')).toBeEnabled();
  await expect(page.getByTestId('build-storehouse')).toBeDisabled();
  await expect(page.getByTestId('status')).toContainText('Нажми на дерево');
  await expect(page.getByTestId('state-version')).toHaveCount(0);

  await page.screenshot({
    path: `docs/evidence/simple-${testInfo.project.name}-initial.png`,
    fullPage: true,
  });
});

test('рубит дерево и приносит бревно на склад', async ({ page }) => {
  await page.goto('/?fast=1');

  await page.getByTestId('tree').click();
  await expect(page.getByTestId('tree-menu')).toBeVisible();
  await expect(page.getByTestId('chop')).toBeVisible();
  await page.getByTestId('chop').click();
  await expect(page.getByTestId('status')).toContainText('идёт к дереву');

  await expect(page.getByTestId('wood')).toHaveText('1', { timeout: 12_000 });
  await expect(page.getByTestId('status')).toContainText('Дерево: 1');
});

test('ставит дом через сервер и поднимает ёмкость (I.4 hotfix)', async ({ page }, testInfo) => {
  await page.goto('/?fast=1');

  await expect(page.getByTestId('server-status')).toContainText('Сервер: тик');
  await expect(page.locator('body')).toHaveAttribute('data-house', 'not-built');

  await page.getByTestId('residents-toggle').click();
  await expect(page.getByTestId('population-count')).toHaveText('Жителей 3 / 3');

  await page.getByTestId('build-house').click();
  await expect(page.locator('body')).toHaveAttribute('data-house', 'building', {
    timeout: 12_000,
  });
  await expect(page.getByTestId('build-house')).toBeDisabled();

  await expect(page.locator('body')).toHaveAttribute('data-house', 'built', {
    timeout: 60_000,
  });
  await expect(page.getByTestId('population-count')).toHaveText(/Жителей \d+ \/ 5/, {
    timeout: 60_000,
  });
  await expect(page.getByTestId('build-house')).toHaveText(/Готово/);

  await page.screenshot({
    path: `docs/evidence/i4-house-build-server-${testInfo.project.name}.png`,
    fullPage: true,
  });
});

test('не отправляет рабочего на вторую рубку во время работы', async ({ page }) => {
  await page.goto('/?fast=1');

  await page.getByTestId('tree').click();
  await page.getByTestId('chop').click();
  await page.getByTestId('tree').click();
  await page.getByTestId('chop').click();

  await expect(page.getByTestId('status')).toContainText('Рабочий занят');
});

function residentRow(page: import('@playwright/test').Page, id: string) {
  return page.locator(`[data-testid="resident-row"][data-id="${id}"]`);
}

async function residentIds(page: import('@playwright/test').Page): Promise<string[]> {
  return page
    .locator('[data-testid="resident-row"]')
    .evaluateAll((rows) => rows.map((row) => (row as HTMLElement).dataset.id ?? ''));
}

test('житель учится в обеих школах по обеим перестановкам (I.4)', async ({ page }, testInfo) => {
  await page.goto('/?fast=1');

  await expect(page.getByTestId('server-status')).toContainText('Сервер: тик');
  await page.getByTestId('residents-toggle').click();
  await expect(page.getByTestId('residents-panel')).toBeVisible();
  await expect(page.getByTestId('resident-row')).toHaveCount(3);

  const [first, second, third] = await residentIds(page);
  if (!first || !second || !third) throw new Error('expected three residents');

  await residentRow(page, second).click();
  await page.getByTestId('assign-worker').click();
  await expect(page.getByTestId('status')).toContainText('назначен рабочим');
  await expect(residentRow(page, second).locator('.resident-state')).toHaveText('Работает');
  await expect(residentRow(page, first).locator('.resident-state')).toHaveText('Свободен');

  await residentRow(page, second).click();
  await page.getByTestId('send-school-gather').click();
  await expect(residentRow(page, second).locator('.resident-state')).toHaveText('Учится');
  await expect(page.getByTestId('status')).toContainText('Школа добычи');

  await residentRow(page, third).click();
  await page.getByTestId('send-school-craft').click();
  await expect(residentRow(page, third).locator('.resident-state')).toHaveText('Учится');

  await expect(residentRow(page, second).locator('.resident-badge')).toHaveText('Добытчик', {
    timeout: 20_000,
  });
  await expect(residentRow(page, third).locator('.resident-badge')).toHaveText('Ремесленник', {
    timeout: 20_000,
  });

  await residentRow(page, second).click();
  await expect(page.getByTestId('send-school-craft')).toBeEnabled();
  await page.getByTestId('send-school-craft').click();
  await expect(residentRow(page, second).locator('.resident-badge')).toHaveText('Каменотёс', {
    timeout: 20_000,
  });

  await residentRow(page, third).click();
  await page.getByTestId('send-school-gather').click();
  await expect(residentRow(page, third).locator('.resident-badge')).toHaveText('Каменотёс', {
    timeout: 20_000,
  });

  await residentRow(page, second).click();
  await expect(page.getByTestId('resident-profession')).toHaveText('Каменотёс');
  await expect(page.getByTestId('resident-detail')).toContainText('Таланты');

  await page.screenshot({
    path: `docs/evidence/i4-residents-${testInfo.project.name}.png`,
    fullPage: true,
  });
});

test('показывает ёмкость поселения и рост опыта жителя (I.4)', async ({ page }, testInfo) => {
  await page.goto('/?fast=1');

  await expect(page.getByTestId('server-status')).toContainText('Сервер: тик');
  await page.getByTestId('residents-toggle').click();
  await expect(page.getByTestId('population-status')).toBeVisible();
  await expect(page.getByTestId('population-count')).toHaveText('Жителей 3 / 3');
  await expect(page.getByTestId('population-slots')).toHaveText('свободных мест нет');

  const [first] = await residentIds(page);
  if (!first) throw new Error('expected a resident');

  await residentRow(page, first).click();
  await expect(page.getByTestId('resident-level')).toContainText('Ур. 1');
  await expect(page.getByTestId('resident-level')).toContainText('опыт 0');

  await page.getByTestId('send-school-gather').click();
  await expect(residentRow(page, first).locator('.resident-badge')).toHaveText('Добытчик', {
    timeout: 20_000,
  });
  await residentRow(page, first).click();
  await expect(page.getByTestId('resident-level')).toContainText('опыт 60');

  await page.screenshot({
    path: `docs/evidence/i4-population-xp-${testInfo.project.name}.png`,
    fullPage: true,
  });
});

test('ставит мастерскую и академию через сервер (I.5)', async ({ page }, testInfo) => {
  await page.goto('/?fast=1');

  await expect(page.getByTestId('server-status')).toContainText('Сервер: тик');

  await page.getByTestId('build-workshop').click();
  await expect(page.getByTestId('placement-picker')).toBeVisible();
  await page.getByTestId('placement-cell').first().click();
  await expect(page.getByTestId('status')).toContainText('план стройки');
  await expect(page.getByTestId('build-workshop')).toBeDisabled({ timeout: 12_000 });

  await page.getByTestId('build-academy').click();
  await expect(page.getByTestId('placement-picker')).toBeVisible();
  await page.getByTestId('placement-cell').first().click();
  await expect(page.getByTestId('build-academy')).toBeDisabled({ timeout: 12_000 });

  await page.getByTestId('craft-toggle').click();
  await expect(page.getByTestId('craft-panel')).toBeVisible();
  await expect(page.getByTestId('craft-status')).toContainText('Мастерская');

  await page.getByTestId('research-toggle').click();
  await expect(page.getByTestId('research-panel')).toBeVisible();
  await expect(page.getByTestId('research-status')).toContainText('Очки исследования: 0');
  await expect(page.getByTestId('research-row').first()).toBeVisible();

  await page.screenshot({
    path: `docs/evidence/i5-craft-research-panels-${testInfo.project.name}.png`,
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
    (await page.getByTestId('server-status').textContent())?.match(/тик (\d+)/)?.[1] ?? 0
  );
  await page.waitForFunction(
    (before) => {
      const text = document.querySelector('[data-testid="server-status"]')?.textContent ?? '';
      return Number(text.match(/тик (\d+)/)?.[1] ?? 0) > before;
    },
    tickBefore
  );
  await expect(page.getByTestId('research-status')).toContainText('Очки исследования: 0');
  await expect(firstTech.getByTestId('research-state')).toContainText('Ждёт учёного');
});

test('исследует плотницкое дело и производит доску (I.5)', async ({ page }, testInfo) => {
  await page.goto('/?fast=1');
  await expect(page.getByTestId('server-status')).toContainText('Сервер: тик');

  await page.getByTestId('build-workshop').click();
  await page.getByTestId('placement-cell').first().click();
  await expect(page.getByTestId('status')).toContainText('план стройки');

  await page.getByTestId('build-academy').click();
  await page.getByTestId('placement-cell').first().click();
  await expect(page.getByTestId('build-academy')).toBeDisabled();

  await page.getByTestId('residents-toggle').click();
  const [residentId] = await residentIds(page);
  if (!residentId) throw new Error('expected a resident');
  await residentRow(page, residentId).click();
  await page.getByTestId('send-school-craft').click();
  await expect(residentRow(page, residentId).locator('.resident-badge')).toHaveText('Ремесленник', {
    timeout: 20_000,
  });
  await page.getByTestId('residents-close').click();

  await page.getByTestId('research-toggle').click();
  await page.getByTestId('research-scholar').selectOption(residentId);
  const carpentry = page.locator('[data-testid="research-row"][data-tech="carpentry"]');
  await expect(carpentry.getByTestId('research-start')).toBeEnabled({ timeout: 60_000 });
  await carpentry.getByTestId('research-start').click();
  await expect(carpentry.getByTestId('research-state')).toHaveText('Изучено', {
    timeout: 20_000,
  });
  await page.screenshot({
    path: `docs/evidence/i5-craft-cycle-${testInfo.project.name}-research.png`,
    fullPage: true,
  });
  await page.getByTestId('research-close').click();

  await page.getByTestId('craft-toggle').click();
  await expect(page.getByTestId('craft-status')).toContainText('Мастерская готова', {
    timeout: 60_000,
  });
  const planksBefore = Number(
    (await page.getByTestId('craft-status').textContent())?.match(/Доски на складе: (\d+)/)?.[1]
  );
  expect(Number.isFinite(planksBefore)).toBe(true);
  await page.getByTestId('craft-start').click();
  await expect(page.getByTestId('status')).toContainText('Ремесло запущено');
  await expect(page.getByTestId('craft-status')).toContainText(
    `Доски на складе: ${planksBefore + 1}`,
    {
    timeout: 30_000,
    }
  );

  await page.screenshot({
    path: `docs/evidence/i5-craft-cycle-${testInfo.project.name}-complete.png`,
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
