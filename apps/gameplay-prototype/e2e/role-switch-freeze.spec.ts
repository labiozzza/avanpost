import { expect, test } from '@playwright/test';
import { STORAGE_KEY, type WorkRole } from '../src/simulation.js';

test('iPhone-sized installed-PWA emulation survives 120 role changes and an offline cold start', async ({ browser }) => {
  test.setTimeout(180_000);
  const origin = process.env.PLAYWRIGHT_BASE_URL ?? 'http://127.0.0.1:4176';
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true,
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1'
  });
  const page = await context.newPage();
  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.name));
  page.on('console', (message) => { if (message.type() === 'error') consoleErrors.push(message.text()); });
  try {
    await page.goto(`${origin}/`);
    await expect(page.locator('#world-scene canvas')).toBeVisible();
    await expect(page.locator('#catchup-status')).toBeHidden();
    await page.evaluate(async () => { await navigator.serviceWorker.ready; });
    await page.reload();
    await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller));
    await expect(page.locator('#world-scene canvas')).toBeVisible();
    await expect(page.locator('#catchup-status')).toBeHidden();

    await page.locator('#dock-residents').click();
    await page.locator('.resident-row').first().click();
    const roles: WorkRole[] = ['idle', 'woodcutter', 'miner', 'builder', 'hauler', 'sawmiller'];
    for (let index = 0; index < 120; index++) {
      const next = roles[index % roles.length]!;
      await page.locator('#toggle-roles').click();
      await page.locator(`[data-role="${next}"]`).click();
      const persisted = await page.evaluate((key) => {
        const raw = localStorage.getItem(key);
        return raw ? JSON.parse(raw).residents[0].role : null;
      }, STORAGE_KEY);
      expect(persisted).toBe(next);
    }
    const diagnostics = await page.evaluate(() => JSON.parse(localStorage.getItem('avanpost:runtime-diagnostics:v1') ?? '[]'));
    expect(diagnostics.length).toBeLessThanOrEqual(32);
    expect(diagnostics.filter((event: { type: string }) => event.type === 'role-switch').length).toBeGreaterThan(0);
    expect(JSON.stringify(diagnostics)).not.toMatch(/residentId|name|saveContents|stack/i);
    await expect(page.locator('[data-role="sawmiller"]')).toHaveClass(/active/);
    await page.locator('#close-panel').click();

    const canvas = page.locator('#world-scene canvas');
    const before = await canvas.evaluate((element) => ({
      simulation: document.documentElement.dataset.simulationHeartbeat,
      scene: (element as HTMLCanvasElement).dataset.sceneHeartbeat
    }));
    await page.waitForFunction((previous) =>
      document.documentElement.dataset.simulationHeartbeat !== previous.simulation &&
      document.querySelector<HTMLCanvasElement>('#world-scene canvas')?.dataset.sceneHeartbeat !== previous.scene,
    before, { timeout: 10_000 });
    const box = await canvas.boundingBox();
    expect(box).not.toBeNull();
    const worldBefore = await canvas.evaluate((element) => JSON.parse((element as HTMLCanvasElement).dataset.worldView!));
    await page.mouse.move(box!.x + box!.width * 0.75, box!.y + box!.height * 0.72);
    await page.mouse.down();
    await page.mouse.move(box!.x + box!.width * 0.6, box!.y + box!.height * 0.72, { steps: 5 });
    await page.mouse.up();
    await expect.poll(() => canvas.evaluate((element) => JSON.parse((element as HTMLCanvasElement).dataset.worldView!).x))
      .not.toBe(worldBefore.x);
    await page.setViewportSize({ width: 844, height: 390 });
    await expect(canvas).toBeVisible();
    await page.setViewportSize({ width: 390, height: 844 });

    await page.evaluate(() => window.dispatchEvent(new CustomEvent('avanpost:phaser-error',
      { detail: { errorType: 'TypeError' } })));
    const recovery = page.getByRole('dialog');
    await expect(recovery).toBeVisible();
    await expect(recovery).toContainText('Сохранение осталось нетронутым');
    await recovery.getByRole('button', { name: 'Повторить запуск из последнего сохранения' }).click();
    await expect(recovery).toBeHidden();
    expect(await page.evaluate((key) => JSON.parse(localStorage.getItem(key)!).residents[0].role, STORAGE_KEY))
      .toBe('sawmiller');
    await expect(canvas).toBeVisible();

    const onlineSave = await page.evaluate((key) => localStorage.getItem(key), STORAGE_KEY);
    expect(onlineSave).not.toBeNull();
    await context.setOffline(true);
    await page.close();
    await new Promise((resolve) => setTimeout(resolve, 1200));
    const coldPage = await context.newPage();
    coldPage.on('pageerror', (error) => pageErrors.push(error.name));
    coldPage.on('console', (message) => { if (message.type() === 'error') consoleErrors.push(message.text()); });
    await coldPage.goto(`${origin}/`);
    await expect(coldPage.locator('#world-scene canvas')).toBeVisible();
    await expect(coldPage.locator('#catchup-status')).toBeHidden({ timeout: 30_000 });
    await coldPage.waitForFunction(() => Boolean(navigator.serviceWorker.controller));
    expect(await coldPage.evaluate((key) => JSON.parse(localStorage.getItem(key)!).residents[0].role, STORAGE_KEY))
      .toBe('sawmiller');
    expect(await coldPage.evaluate(() => navigator.onLine)).toBe(false);
    await expect.poll(() => coldPage.locator('#world-scene canvas').evaluate((element) =>
      Boolean((element as HTMLCanvasElement).dataset.sceneHeartbeat))).toBe(true);

    await coldPage.locator('#dock-residents').click();
    await coldPage.locator('.resident-row').first().click();
    await coldPage.locator('#toggle-roles').click();
    await coldPage.locator('[data-role="woodcutter"]').click();
    expect(await coldPage.evaluate((key) => JSON.parse(localStorage.getItem(key)!).residents[0].role, STORAGE_KEY))
      .toBe('woodcutter');
    expect(pageErrors).toEqual([]);
    expect(consoleErrors).toEqual([]);
  } finally {
    await context.close();
  }
});
