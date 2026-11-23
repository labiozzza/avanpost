import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test, type Page } from '@playwright/test';
import { createNewWorld, STORAGE_KEY, WORLD, type PrototypeWorld } from '../src/simulation.js';

const evidence = resolve(process.env.PLAYWRIGHT_EVIDENCE_DIR ??
  fileURLToPath(new URL('../../../docs/gameplay-prototype-v0.1/evidence-v1.0/', import.meta.url)), 'roads-v10');

async function capture(page: Page, name: string): Promise<void> {
  mkdirSync(evidence, { recursive: true });
  await page.screenshot({ path: resolve(evidence, `${name}.png`), animations: 'disabled' });
}

async function panTo(page: Page, worldX: number): Promise<void> {
  const canvas = page.locator('#world-scene canvas');
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const view = await canvas.evaluate((element) => JSON.parse(
      (element as HTMLCanvasElement).dataset.worldView ?? '{}'
    ) as { x: number; width: number });
    if (worldX >= view.x + view.width * 0.2 && worldX <= view.x + view.width * 0.8) return;
    const box = await canvas.boundingBox();
    if (!box) throw new Error('Game canvas has no visible bounds.');
    const delta = worldX - (view.x + view.width / 2);
    const screenDistance = Math.min(Math.abs(delta) * box.width / view.width, box.width * 0.56);
    const direction = Math.sign(delta);
    await page.mouse.move(box.width / 2 + direction * screenDistance / 2, box.height * 0.4);
    await page.mouse.down();
    await page.mouse.move(box.width / 2 - direction * screenDistance / 2, box.height * 0.4, { steps: 10 });
    await page.mouse.up();
    await page.waitForTimeout(100);
  }
}

async function tapWorld(page: Page, worldX: number, worldY: number): Promise<void> {
  await panTo(page, worldX);
  const canvas = page.locator('#world-scene canvas');
  const point = await canvas.evaluate((element, coordinates) => {
    const canvasElement = element as HTMLCanvasElement;
    const rect = canvasElement.getBoundingClientRect();
    const view = JSON.parse(canvasElement.dataset.worldView ?? '{}') as {
      x: number; y: number; width: number; height: number;
    };
    return {
      x: (coordinates.x - view.x) * rect.width / view.width,
      y: (coordinates.y - view.y) * rect.height / view.height
    };
  }, { x: worldX, y: worldY });
  await canvas.click({ position: point });
}

async function savedWorld(page: Page): Promise<PrototypeWorld> {
  return page.evaluate((key) => JSON.parse(localStorage.getItem(key)!), STORAGE_KEY);
}

test('roads stay hidden in the default prototype build', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  const canvas = page.locator('#world-scene canvas');
  await expect(canvas).toBeVisible();
  await expect(canvas).toHaveAttribute('data-roads-enabled', 'false');
  await expect(page.locator('#build-road')).toBeHidden();
  await expect(page.locator('#road-removal-dialog')).toBeHidden();
  await expect(canvas).toHaveAttribute('data-roads', '[]');
  await page.locator('#dock-build').click();
  await expect(page.locator('#build-road')).toBeHidden();
  await capture(page, 'grid-disabled-road-controls');
  expect(errors).toEqual([]);
});

test('legacy road records remain saved and paused while the road layer is hidden', async ({ page }) => {
  const world = createNewWorld();
  world.roads = [{ id: 'saved-road', x: 560, builtAt: 21 }];
  world.sites.push({ id: 'saved-road-site', kind: 'road', x: 640, y: WORLD.groundY,
    deliveredWood: 12, deliveredStone: 6, progress: 0.3, stage: 1, paused: false });
  await page.addInitScript(({ key, saved }) => localStorage.setItem(key, JSON.stringify(saved)), {
    key: STORAGE_KEY, saved: world
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  const canvas = page.locator('#world-scene canvas');
  await expect(canvas).toBeVisible();
  await expect(canvas).toHaveAttribute('data-roads-enabled', 'false');
  await expect(canvas).toHaveAttribute('data-roads', '[]');
  const restored = await savedWorld(page);
  expect(restored.roads).toEqual([{ id: 'saved-road', x: 560, builtAt: 21 }]);
  expect(restored.sites.find((site) => site.id === 'saved-road-site')).toMatchObject({
    deliveredWood: 12, deliveredStone: 6, progress: 0.3, stage: 1, paused: true
  });
  await capture(page, 'grid-disabled-saved-road-not-rendered');
});

test('v1.0 roads are delivered, built, saved, selectable and removable through the UI', async ({ page }) => {
  test.setTimeout(150_000);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  const canvas = page.locator('#world-scene canvas');
  await expect(canvas).toBeVisible();
  test.skip(await canvas.getAttribute('data-roads-enabled') !== 'true',
    'Road construction is exercised only in the developer feature-flag run.');

  await page.locator('#dock-build').click();
  await page.locator('#build-road').click();
  await expect(page.locator('#placement-banner')).toBeVisible();
  await expect.poll(() => canvas.getAttribute('data-grid-mode')).toBe('planning');
  await tapWorld(page, 3200, 592);
  await expect(page.locator('#selection-title')).toHaveText('Предпросмотр: дорога');
  await expect(page.locator('#selection-detail')).toContainText('закрытом лесу');
  await expect(page.locator('#confirm-placement')).toBeDisabled();
  await capture(page, 'v10-road-blocked-closed-land');

  await page.locator('#cancel-placement').click();
  await page.locator('#dock-build').click();
  await page.locator('#build-road').click();
  // The starting warehouse occupies this lot. Roads remain a separate
  // surface layer, so the segment may run across its lower foundation.
  await tapWorld(page, 960, 592);
  await expect(page.locator('#selection-title')).toHaveText('Предпросмотр: дорога');
  await expect(page.locator('#selection-detail')).toContainText('10 дерева · 5 камня');
  await expect(page.locator('#confirm-placement')).toBeEnabled();
  expect((await savedWorld(page)).roads).toHaveLength(0);
  await page.locator('#confirm-placement').click();
  await expect.poll(async () => (await savedWorld(page)).sites.some((site) => site.kind === 'road')).toBe(true);
  await capture(page, 'v10-road-construction-order');

  await page.locator('#dock-residents').click();
  await page.getByRole('button', { name: /Саша/ }).click();
  await page.locator('#toggle-roles').click();
  await page.locator('[data-role="builder"]').click();
  await expect.poll(async () => (await savedWorld(page)).sites.find((site) => site.kind === 'road')?.deliveredWood ?? 0)
    .toBeGreaterThan(0);
  await capture(page, 'v10-road-materials-delivered');
  await expect.poll(async () => (await savedWorld(page)).roads.length, { timeout: 90_000 }).toBe(1);
  const firstRoadWorld = await savedWorld(page);
  expect(firstRoadWorld.sites.filter((site) => site.kind === 'road')).toHaveLength(0);
  expect(firstRoadWorld.stores.reduce((sum, store) => sum + store.wood, 0)).toBe(20);
  expect(firstRoadWorld.stores.reduce((sum, store) => sum + store.stone, 0)).toBe(15);
  await page.locator('#close-panel').click();
  await panTo(page, 960);
  await capture(page, 'road-front-of-warehouse');
  await page.reload();
  await expect(canvas).toBeVisible();
  expect((await savedWorld(page)).roads.map((road) => road.x)).toEqual([960]);
  await panTo(page, 960);
  await capture(page, 'road-front-of-warehouse-after-reload');

  await page.locator('#dock-build').click();
  await page.locator('#build-road').click();
  await tapWorld(page, 1040, 592);
  await expect(page.locator('#selection-title')).toHaveText('Предпросмотр: дорога');
  await page.locator('#confirm-placement').click();
  await expect.poll(async () => (await savedWorld(page)).sites.some((site) => site.kind === 'road')).toBe(true);
  await expect.poll(async () => (await savedWorld(page)).roads.length, { timeout: 90_000 }).toBe(2);
  const network = await savedWorld(page);
  expect(network.roads.map((road) => road.x)).toEqual([960, 1040]);
  await capture(page, 'v10-road-network');

  await page.locator('#cancel-placement').click();
  await tapWorld(page, 960, 592);
  await expect(page.locator('#selection-title')).toHaveText('Дорожный сегмент');
  await page.getByTestId('remove-road').click();
  await expect(page.locator('#road-removal-dialog')).toBeVisible();
  await page.locator('#confirm-road-removal').click();
  await expect.poll(async () => (await savedWorld(page)).roads.length).toBe(1);
  expect((await savedWorld(page)).stockpiles.some((pile) => pile.sourceId === 'road-demolition')).toBe(true);
  await capture(page, 'v10-road-removal-salvage');
  expect(errors).toEqual([]);
});

test('a hauler crosses a built road 30% faster in the live settlement scene', async ({ browser }) => {
  test.setTimeout(180_000);
  const featureProbe = await browser.newPage();
  await featureProbe.goto('/');
  const roadsEnabled = await featureProbe.locator('#world-scene canvas').getAttribute('data-roads-enabled');
  await featureProbe.close();
  test.skip(roadsEnabled !== 'true', 'Road speed is exercised only in the developer feature-flag run.');

  const runTrips = async (withRoad: boolean): Promise<number[]> => {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
    const page = await context.newPage();
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));

    const initial = createNewWorld();
    initial.stockpiles = [1, 2, 3].map((batch) => ({
      id: `road-speed-pile-${batch}`,
      sourceId: `road-speed-evidence-${batch}`,
      resource: 'wood' as const,
      x: 145,
      amount: 10,
      capacity: 10
    }));
    initial.roads = withRoad ? [{ id: 'road-speed-evidence', x: 560, builtAt: 0 }] : [];
    await page.addInitScript(({ key, world }) => localStorage.setItem(key, JSON.stringify(world)), {
      key: STORAGE_KEY,
      world: initial
    });
    await page.goto('/');
    const canvas = page.locator('#world-scene canvas');
    await expect(canvas).toBeVisible();

    // Phaser publishes resident bounds each frame. Compare the same 80-unit
    // interval on the paved route and on an otherwise identical bare route.
    await page.evaluate((key) => {
      const capture = {
        done: false,
        error: null as string | null,
        startedAt: performance.now(),
        previous: null as { time: number; x: number } | null,
        entryTime: null as number | null,
        crossings: [] as number[]
      };
      (window as Window & { __roadSpeedCapture?: typeof capture }).__roadSpeedCapture = capture;
      const sample = () => {
        if (capture.done) return;
        const time = performance.now();
        const canvasElement = document.querySelector<HTMLCanvasElement>('#world-scene canvas');
        const bounds = JSON.parse(canvasElement?.dataset.objectBounds ?? '{}') as {
          residents?: Array<{ id: string; left: number; right: number }>;
        };
        const resident = bounds.residents?.find((candidate) => candidate.id === 'r1');
        const x = resident ? (resident.left + resident.right) / 2 : null;
        if (x !== null && capture.previous && Math.abs(x - capture.previous.x) > 1e-6) {
          const previous = capture.previous;
          const at = (boundary: number) => previous.time +
            (boundary - previous.x) / (x - previous.x) * (time - previous.time);
          if (x < previous.x) {
            if (previous.x > 600 && x <= 600) capture.entryTime = at(600);
            if (capture.entryTime !== null && previous.x > 520 && x <= 520) {
              capture.crossings.push((at(520) - capture.entryTime) / 1000);
              capture.entryTime = null;
            }
          } else {
            if (previous.x < 520 && x >= 520) capture.entryTime = at(520);
            if (capture.entryTime !== null && previous.x < 600 && x >= 600) {
              capture.crossings.push((at(600) - capture.entryTime) / 1000);
              capture.entryTime = null;
            }
          }
        }
        if (x !== null) capture.previous = { time, x };

        const saved = JSON.parse(localStorage.getItem(key) ?? 'null') as PrototypeWorld | null;
        const deliveredWood = saved?.stores.reduce((sum, store) => sum + store.wood, 0) ?? 0;
        const hauler = saved?.residents.find((person) => person.id === 'r1');
        if (deliveredWood >= 60 && hauler?.mode === 'idle' && capture.crossings.length >= 6) {
          capture.done = true;
        } else if (time - capture.startedAt > 90_000) {
          capture.error = 'Hauler did not complete three observable wood deliveries in 90 seconds.';
          capture.done = true;
        }
        requestAnimationFrame(sample);
      };
      requestAnimationFrame(sample);
    }, STORAGE_KEY);

    await page.locator('#dock-residents').click();
    await page.locator('.resident-row').first().click();
    await page.locator('#toggle-roles').click();
    await page.locator('[data-role="hauler"]').click();
    await page.locator('#close-panel').click();
    await expect.poll(async () => (await savedWorld(page)).residents[0]?.mode).toBe('moving');
    if (withRoad) await capture(page, 'road-speed-live-hauler');

    await page.waitForFunction(() =>
      Boolean((window as Window & { __roadSpeedCapture?: { done: boolean } }).__roadSpeedCapture?.done),
      undefined,
      { timeout: 100_000 }
    );
    const captureResult = await page.evaluate(() =>
      (window as Window & { __roadSpeedCapture?: {
        crossings: number[]; error: string | null;
      } }).__roadSpeedCapture
    );
    expect(captureResult?.error ?? null).toBeNull();
    expect(captureResult?.crossings).toHaveLength(6);
    expect(errors).toEqual([]);
    await context.close();
    return captureResult!.crossings;
  };

  const pavedCrossings = await runTrips(true);
  const groundCrossings = await runTrips(false);
  const pavedMean = pavedCrossings.reduce((sum, seconds) => sum + seconds, 0) / pavedCrossings.length;
  const groundMean = groundCrossings.reduce((sum, seconds) => sum + seconds, 0) / groundCrossings.length;
  const speedRatio = groundMean / pavedMean;
  const measurements = { pavedCrossings, groundCrossings, pavedMean, groundMean, speedRatio };
  console.log('ROAD_SPEED_MEASUREMENTS', JSON.stringify(measurements));
  await test.info().attach('road-speed-measurements', {
    body: JSON.stringify(measurements, null, 2),
    contentType: 'application/json'
  });
  expect(speedRatio).toBeGreaterThan(1.25);
  expect(speedRatio).toBeLessThan(1.35);
});
