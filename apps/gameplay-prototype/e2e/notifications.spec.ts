import { mkdirSync } from 'node:fs';
import { expect, test, type Browser, type Page } from '@playwright/test';
import { createNewWorld, STORAGE_KEY, type PrototypeWorld } from '../src/simulation.js';

const VIEWPORTS = [
  { width: 375, height: 667, name: 'iphone-se' },
  { width: 390, height: 844, name: 'modern-iphone' },
  { width: 667, height: 375, name: 'iphone-se-landscape' },
  { width: 844, height: 390, name: 'smartphone-landscape' },
  { width: 1440, height: 900, name: 'desktop' }
] as const;

type Rect = { x: number; y: number; width: number; height: number; right: number; bottom: number };

function overlaps(a: Rect, b: Rect): boolean {
  return a.x < b.right && a.right > b.x && a.y < b.bottom && a.bottom > b.y;
}

async function openGame(
  browser: Browser,
  viewport: { width: number; height: number },
  world?: PrototypeWorld
) {
  const context = await browser.newContext({ viewport, deviceScaleFactor: 1, hasTouch: true });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.addInitScript(({ key, save }) => {
    if (save) localStorage.setItem(key, JSON.stringify(save));
    else localStorage.removeItem(key);
  }, { key: STORAGE_KEY, save: world ?? null });
  await page.goto('/');
  await expect(page.locator('#world-scene canvas')).toBeVisible();
  return { context, page, errors };
}

async function takeScreenshot(page: Page, name: string): Promise<void> {
  mkdirSync('apps/gameplay-prototype/test-results/screenshots', { recursive: true });
  await page.screenshot({
    path: `apps/gameplay-prototype/test-results/screenshots/${name}.png`,
    animations: 'disabled'
  });
}

async function visibleRectangles(page: Page, selectors: string[]): Promise<Array<{ selector: string; rect: Rect }>> {
  return page.evaluate((items) => items.flatMap((selector) => {
    const element = document.querySelector<HTMLElement>(selector);
    if (!element || element.getClientRects().length === 0) return [];
    const style = getComputedStyle(element);
    if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) return [];
    const bounds = element.getBoundingClientRect();
    if (bounds.width <= 0 || bounds.height <= 0) return [];
    return [{
      selector,
      rect: {
        x: bounds.left, y: bounds.top, width: bounds.width, height: bounds.height,
        right: bounds.right, bottom: bounds.bottom
      }
    }];
  }), selectors);
}

async function expectFloatingToastSafe(page: Page): Promise<void> {
  const layout = await page.evaluate(() => {
    const element = document.querySelector<HTMLElement>('#toast.visible');
    if (!element) return null;
    const bounds = element.getBoundingClientRect();
    return {
      viewport: { width: document.documentElement.clientWidth, height: document.documentElement.clientHeight },
      toast: {
        x: bounds.left, y: bounds.top, width: bounds.width, height: bounds.height,
        right: bounds.right, bottom: bounds.bottom
      }
    };
  });
  expect(layout, 'floating notification should be visible').not.toBeNull();
  expect(layout!.toast.x).toBeGreaterThanOrEqual(0);
  expect(layout!.toast.y).toBeGreaterThanOrEqual(0);
  expect(layout!.toast.right).toBeLessThanOrEqual(layout!.viewport.width);
  expect(layout!.toast.bottom).toBeLessThanOrEqual(layout!.viewport.height);
  expect(layout!.toast.width).toBeLessThanOrEqual(Math.min(520, layout!.viewport.width - 16) + 1);

  const obstructions = await visibleRectangles(page, [
    '.hud-top', '.goal-chip', '.action-dock', '#placement-banner',
    '#forest-wayfinder', '.pwa-banner:not([hidden])'
  ]);
  for (const obstruction of obstructions) {
    expect(
      overlaps(layout!.toast, obstruction.rect),
      `floating toast must not visually cover ${obstruction.selector}`
    ).toBe(false);
  }
}

async function expectInlineToastSafe(page: Page): Promise<void> {
  const layout = await page.evaluate(() => {
    const panel = document.querySelector<HTMLElement>('#control-panel');
    const notice = document.querySelector<HTMLElement>('#panel-notice.visible');
    if (!panel || !notice || panel.hidden) return null;
    const rect = (element: Element): Rect => {
      const bounds = element.getBoundingClientRect();
      return {
        x: bounds.left, y: bounds.top, width: bounds.width, height: bounds.height,
        right: bounds.right, bottom: bounds.bottom
      };
    };
    const actions = [...panel.querySelectorAll<HTMLButtonElement>('button')]
      .filter((button) => button.getClientRects().length > 0 && !button.hidden)
      .map(rect);
    const detail = panel.querySelector<HTMLElement>('#selection-detail');
    return {
      panel: rect(panel),
      notice: rect(notice),
      detail: detail && detail.getClientRects().length > 0 ? rect(detail) : null,
      actions
    };
  });
  expect(layout, 'inline notice should be visible in the open context card').not.toBeNull();
  expect(layout!.notice.x).toBeGreaterThanOrEqual(layout!.panel.x);
  expect(layout!.notice.right).toBeLessThanOrEqual(layout!.panel.right);
  expect(layout!.notice.y).toBeGreaterThanOrEqual(layout!.panel.y);
  expect(layout!.notice.bottom).toBeLessThanOrEqual(layout!.panel.bottom);
  if (layout!.detail) expect(overlaps(layout!.notice, layout!.detail)).toBe(false);
  for (const action of layout!.actions) {
    expect(overlaps(layout!.notice, action), 'inline notice must not cover a card action').toBe(false);
  }
}

async function pointForWorld(page: Page, x: number, y: number): Promise<{ x: number; y: number }> {
  return page.locator('#world-scene canvas').evaluate((element, point) => {
    const canvas = element as HTMLCanvasElement;
    const rect = canvas.getBoundingClientRect();
    const view = JSON.parse(canvas.dataset.worldView ?? '{}') as { x: number; y: number };
    const zoom = Number(canvas.dataset.cameraZoom);
    return { x: rect.left + (point.x - view.x) * zoom, y: rect.top + (point.y - view.y) * zoom };
  }, { x, y });
}

async function panToWorldX(page: Page, targetX: number): Promise<void> {
  const canvas = page.locator('#world-scene canvas');
  const box = await canvas.boundingBox();
  expect(box).not.toBeNull();
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const view = await canvas.evaluate((element) => JSON.parse(
      (element as HTMLCanvasElement).dataset.worldView ?? '{}'
    ) as { x: number; width: number });
    if (targetX >= view.x + view.width * 0.28 && targetX <= view.x + view.width * 0.72) return;
    const rightward = targetX > view.x + view.width * 0.72;
    const from = { x: box!.x + box!.width * (rightward ? 0.78 : 0.22), y: box!.y + box!.height * 0.42 };
    const to = { x: box!.x + box!.width * (rightward ? 0.22 : 0.78), y: from.y };
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(to.x, to.y, { steps: 8 });
    await page.mouse.up();
  }
  const finalView = await canvas.evaluate((element) => JSON.parse(
    (element as HTMLCanvasElement).dataset.worldView ?? '{}'
  ) as { x: number; width: number });
  expect(targetX).toBeGreaterThanOrEqual(finalView.x);
  expect(targetX).toBeLessThanOrEqual(finalView.x + finalView.width);
}

test('floating notices remain inside safe space at the five required viewport sizes', async ({ browser }) => {
  for (const viewport of VIEWPORTS) {
    const { context, page, errors } = await openGame(browser, viewport);
    await page.locator('#dock-build').click();
    await page.locator('#build-house').click();
    await expect(page.locator('#toast.visible')).toContainText('Выбери свободную');
    await expectFloatingToastSafe(page);
    await takeScreenshot(page, `notification-floating-${viewport.name}`);

    if (viewport.name === 'iphone-se') {
      const noticeRect = await page.locator('#toast.visible').boundingBox();
      expect(noticeRect).not.toBeNull();
      const cameraBefore = await page.locator('#world-scene canvas').evaluate((element) => ({
        x: Number((element as HTMLCanvasElement).dataset.cameraX),
        y: Number((element as HTMLCanvasElement).dataset.cameraY)
      }));
      await page.mouse.move(noticeRect!.x + noticeRect!.width / 2, noticeRect!.y + noticeRect!.height / 2);
      await page.mouse.down();
      await page.mouse.move(
        noticeRect!.x + noticeRect!.width / 2 - 32,
        noticeRect!.y + noticeRect!.height / 2,
        { steps: 4 }
      );
      await page.mouse.up();
      const cameraAfter = await page.locator('#world-scene canvas').evaluate((element) => ({
        x: Number((element as HTMLCanvasElement).dataset.cameraX),
        y: Number((element as HTMLCanvasElement).dataset.cameraY)
      }));
      expect(cameraAfter.x !== cameraBefore.x || cameraAfter.y !== cameraBefore.y,
        'drag beginning on a floating notice must still reach the game canvas').toBe(true);

      await page.locator('#dock-residents').click();
      await expect(page.locator('#resident-list-section')).toBeVisible();
      await expect(page.locator('#panel-notice.visible')).toBeVisible();
      await expectInlineToastSafe(page);
      await page.locator('.resident-row').first().click();
      await expect(page.locator('#resident-actions')).toBeVisible();
      await expectInlineToastSafe(page);
      await page.locator('#toggle-roles').click();
      await page.locator('[data-role="miner"]').click();
      await expect(page.locator('#panel-notice.visible')).toContainText('Каменщик');
      await takeScreenshot(page, 'notification-resident-inline-390x844');
      await page.locator('#close-panel').click();
      await expect(page.locator('#toast.visible')).toBeVisible();
      await expectFloatingToastSafe(page);
    }

    expect(errors, `page errors at ${viewport.name}`).toEqual([]);
    await context.close();
  }
});

test('inline notices, action-error priority, replacement, and expiry work through the UI', async ({ browser }) => {
  const world = createNewWorld();
  world.buildings.push({ id: 'building-1', kind: 'house', x: 350, y: 600 });
  world.occupiedPlots.push(0);
  world.stores[0]!.wood = 1;
  world.stores[0]!.stone = 0;
  world.currentGoal = 'unlock-eastern-sector';

  const { context, page, errors } = await openGame(browser, { width: 390, height: 844 }, world);

  // The disabled action is deliberately re-enabled only in this test to
  // exercise the simulation's stale-click guard for insufficient resources.
  await panToWorldX(page, 2100);
  const sectorPoint = await pointForWorld(page, 2100, 450);
  await page.mouse.click(sectorPoint.x, sectorPoint.y);
  await expect(page.locator('#selection-title')).toHaveText('Восточная опушка');
  const unlock = page.locator('[data-testid="unlock-eastern-sector"]');
  await expect(unlock).toBeDisabled();
  await unlock.evaluate((button) => {
    (button as HTMLButtonElement).disabled = false;
    (button as HTMLButtonElement).click();
  });
  await expect(page.locator('#panel-notice.visible')).toContainText('Не хватает на открытие');
  await expectInlineToastSafe(page);
  await takeScreenshot(page, 'notification-insufficient-resources-390x844');

  await expect(page.locator('#panel-notice.visible')).toBeHidden({ timeout: 5000 });
  await page.locator('#close-panel').click();
  await page.locator('#dock-residents').click();
  await page.locator('.resident-row').first().click();
  await page.locator('#toggle-roles').click();
  await page.locator('[data-role="woodcutter"]').click();
  await expect(page.locator('#panel-notice.visible')).toContainText('Лесоруб');
  await expectInlineToastSafe(page);
  await takeScreenshot(page, 'notification-resident-inline-390x844');

  await page.locator('#dock-build').click();
  await expect(page.locator('#build-actions')).toBeVisible();
  await expect(page.locator('#panel-notice.visible')).toBeVisible();
  await expectInlineToastSafe(page);
  await takeScreenshot(page, 'notification-build-inline-390x844');

  await page.locator('#close-panel').click();
  await page.locator('#dock-build').click();
  await page.locator('#build-house').click();
  await expect(page.locator('#toast.visible')).toContainText('Выбери свободную');
  await expectFloatingToastSafe(page);
  await takeScreenshot(page, 'notification-floating-action-390x844');
  await page.locator('#cancel-placement').click();
  await page.locator('#dock-residents').click();
  await page.locator('.resident-row').nth(1).click();
  await page.locator('#toggle-roles').click();
  await page.locator('[data-role="miner"]').click();
  await expect(page.locator('#panel-notice.visible')).toContainText('Каменщик');
  await expect(page.locator('.toast.visible, .toast-inline.visible')).toHaveCount(1);
  await expectInlineToastSafe(page);
  await takeScreenshot(page, 'notification-replaced-sequential-390x844');

  await expect(page.locator('#panel-notice.visible')).toBeHidden({ timeout: 4000 });
  await takeScreenshot(page, 'notification-cleared-390x844');
  expect(errors).toEqual([]);
  await context.close();
});

test('an active notice moves into the eastern-sector card without covering its content', async ({ browser }) => {
  const world = createNewWorld();
  world.easternSector.state = 'prepared';
  world.easternSector.clearingProgress = 30;
  world.currentGoal = 'settlement-growth';
  const { context, page, errors } = await openGame(browser, { width: 390, height: 844 }, world);

  await panToWorldX(page, 2100);
  await page.locator('#dock-build').click();
  await page.locator('#build-house').click();
  await expect(page.locator('#toast.visible')).toBeVisible();
  await page.locator('#cancel-placement').click();
  const sectorPoint = await pointForWorld(page, 2100, 450);
  await page.mouse.click(sectorPoint.x, sectorPoint.y);
  await expect(page.locator('#selection-title')).toHaveText('Восточная опушка');
  await expect(page.locator('#panel-notice.visible')).toBeVisible();
  await expectInlineToastSafe(page);
  await takeScreenshot(page, 'notification-eastern-sector-inline-390x844');
  expect(errors).toEqual([]);
  await context.close();
});

test('orientation changes reflow the floating notice without viewport overflow', async ({ browser }) => {
  const { context, page } = await openGame(browser, { width: 390, height: 844 });
  await page.evaluate(() => {
    const banner = document.querySelector<HTMLElement>('#pwa-update');
    if (banner) banner.hidden = false;
  });
  await page.locator('#dock-build').click();
  await page.locator('#build-house').click();
  await expect(page.locator('#toast.visible')).toBeVisible();
  await expectFloatingToastSafe(page);
  await page.setViewportSize({ width: 667, height: 375 });
  await expectFloatingToastSafe(page);
  await takeScreenshot(page, 'notification-landscape-667x375');
  await page.setViewportSize({ width: 844, height: 390 });
  await expectFloatingToastSafe(page);
  await takeScreenshot(page, 'notification-landscape-844x390');
  await context.close();
});
