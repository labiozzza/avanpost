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

test('строит дом за три бревна', async ({ page }) => {
  await page.goto('/?fast=1');
  await collectWood(page, 3);

  await page.getByTestId('build-house').click();
  await expect(page.getByTestId('wood')).toHaveText('0');
  await expect(page.locator('body')).toHaveAttribute('data-house', 'built', {
    timeout: 12_000,
  });
  await expect(page.getByTestId('build-house')).toBeDisabled();
});

test('не начинает стройку без дерева', async ({ page }) => {
  await page.goto('/');

  await page.getByTestId('build-house').click();
  await expect(page.getByTestId('status')).toContainText('Нужно 3 дерева');
  await expect(page.getByTestId('wood')).toHaveText('0');
  await expect(page.locator('body')).toHaveAttribute('data-house', 'not-built');
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

test('отдаёт PWA-манифест', async ({ request }) => {
  const response = await request.get('/manifest.webmanifest');
  expect(response.ok()).toBe(true);
  const manifest = (await response.json()) as { name: string; display: string };
  expect(manifest.name).toBe('Аванпост');
  expect(manifest.display).toBe('standalone');
});
