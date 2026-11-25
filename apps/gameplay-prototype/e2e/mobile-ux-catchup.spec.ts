import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import { test, expect, type Page } from '@playwright/test';
import { createNewWorld, STORAGE_KEY, WORLD, type PrototypeWorld } from '../src/simulation.js';

const evidence = resolve(dirname(fileURLToPath(import.meta.url)), '../docs/mobile-ux-catchup-fix');
const viewports = [
  { name: 'portrait-390x844', width: 390, height: 844 },
  { name: 'landscape-844x390', width: 844, height: 390 },
  { name: 'portrait-375x667', width: 375, height: 667 },
  { name: 'desktop-1366x768', width: 1366, height: 768 },
  { name: 'desktop-1792x828', width: 1792, height: 828 }
] as const;

function freshWorld(): PrototypeWorld {
  const world = createNewWorld();
  // Keep seeded fixtures within the actual 120-unit warehouse capacity. An
  // invalid fixture intentionally opens the user's save-recovery dialog and
  // blocks all pointer-driven UI coverage.
  world.stores[0]!.wood = 30;
  world.stores[0]!.ore = 20;
  world.lastSimulatedAtMs = Date.now();
  return world;
}

function sixResidentWorld(): PrototypeWorld {
  const world = freshWorld();
  const template = structuredClone(world.residents[0]!);
  for (const [index, x] of [900, 1120, 1760].entries()) {
    world.residents.push({ ...structuredClone(template), id: `r${index + 4}`, name: `Житель ${index + 4}`, x,
      role: 'idle', mode: 'idle', task: 'Ждёт назначения', blockedReason: null, cargo: null, cargoAmount: 0,
      targetX: null, targetY: null, targetSiteId: null, targetStoreId: null, pickupStoreId: null,
      pickupResource: null, pickupStockpileId: null, pickupAmount: 0, progress: 0, logisticsRequestId: null });
  }
  return world;
}

async function seed(page: Page, world: PrototypeWorld): Promise<void> {
  await page.addInitScript(({ key, state }) => {
    const marker = `${key}:mobile-ux-test-seeded`;
    if (sessionStorage.getItem(marker) === '1') return;
    localStorage.setItem(key, JSON.stringify(state));
    sessionStorage.setItem(marker, '1');
  },
    { key: STORAGE_KEY, state: world });
}

async function readWorld(page: Page): Promise<PrototypeWorld> {
  return page.evaluate((key) => JSON.parse(localStorage.getItem(key)!) as PrototypeWorld, STORAGE_KEY);
}

async function openGame(page: Page, viewport = { width: 1366, height: 768 }): Promise<void> {
  await page.setViewportSize(viewport);
  await page.goto('/');
  await expect(page.locator('#world-scene canvas')).toBeVisible();
  await expect(page.locator('#catchup-status')).toBeHidden();
}

async function pagePointForWorld(page: Page, x: number, y: number): Promise<{ x: number; y: number }> {
  return page.locator('canvas').evaluate((element, target) => {
    const canvas = element as HTMLCanvasElement;
    const bounds = canvas.getBoundingClientRect();
    const view = JSON.parse(canvas.dataset.worldView!) as { x: number; y: number; width: number; height: number };
    return {
      x: bounds.x + (target.x - view.x) * bounds.width / view.width,
      y: bounds.y + (target.y - view.y) * bounds.height / view.height
    };
  }, { x, y });
}

async function tapWorld(page: Page, x: number, y: number): Promise<void> {
  const point = await page.locator('canvas').evaluate((element, target) => {
    const canvas = element as HTMLCanvasElement;
    const bounds = canvas.getBoundingClientRect();
    const view = JSON.parse(canvas.dataset.worldView!) as { x: number; y: number; width: number; height: number };
    return {
      x: (target.x - view.x) * bounds.width / view.width,
      y: (target.y - view.y) * bounds.height / view.height
    };
  }, { x, y });
  await page.locator('canvas').click({ position: point });
}

async function dragResident(page: Page, residentId: string, target: { x: number; y: number }, role: string,
  screenshotName?: string, assertNoTeleport = true): Promise<PrototypeWorld['residents'][number]> {
  const roleCodes: Record<string, string> = {
    'Лесоруб': 'woodcutter', 'Каменщик': 'miner', 'Строитель': 'builder', 'Грузчик': 'hauler'
  };
  const roleCode = roleCodes[role];
  expect(roleCode, `known drag role label: ${role}`).toBeTruthy();
  const { start, end, startX } = await page.locator('canvas').evaluate((element, input) => {
    const canvas = element as HTMLCanvasElement;
    const bounds = canvas.getBoundingClientRect();
    const view = JSON.parse(canvas.dataset.worldView!) as { x: number; y: number; width: number; height: number };
    const person = (JSON.parse(localStorage.getItem(input.key)!) as PrototypeWorld).residents
      .find((resident) => resident.id === input.residentId)!;
    const point = (x: number, y: number) => ({
      x: bounds.x + (x - view.x) * bounds.width / view.width,
      y: bounds.y + (y - view.y) * bounds.height / view.height
    });
    return { start: point(person.x, person.y - 50), end: point(input.target.x, input.target.y), startX: person.x };
  }, { key: STORAGE_KEY, residentId, target });
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 2 });
  await expect(page.locator('canvas')).toHaveAttribute('data-drag-role', roleCode!);
  if (screenshotName) await capture(page, screenshotName);
  await page.mouse.up();
  const savedWorld = await readWorld(page);
  const assigned = savedWorld.residents.find((candidate) => candidate.id === residentId)!;
  expect(assigned.role, 'the role is persisted by the drag action').toBe(roleCode);
  if (assertNoTeleport) {
    const distanceToDrop = Math.abs(target.x - startX);
    expect(Math.abs(assigned.x - startX), `${residentId} walks to the target instead of teleporting`)
      .toBeLessThan(distanceToDrop * 0.8);
  }
  return assigned;
}

async function capture(page: Page, name: string): Promise<void> {
  mkdirSync(evidence, { recursive: true });
  await page.screenshot({ path: resolve(evidence, `${name}.png`) });
}

test('closing sawmill and placement panels leaves navigation, residents, menu and camera responsive', async ({ page }) => {
  const world = freshWorld();
  world.buildings.push({ id: 'ready-sawmill-card', kind: 'sawmill', x: 1450, y: WORLD.groundY,
    gridColumn: 5, gridRow: 2, footprint: { widthCells: 2, heightCells: 1 }, sourceTreeId: 'tree-home' });
  await seed(page, world);
  await openGame(page);

  const readySawmill = (await readWorld(page)).buildings.find((building) => building.id === 'ready-sawmill-card')!;
  await tapWorld(page, readySawmill.x, WORLD.groundY - 80);
  await expect(page.locator('#selection-title')).toHaveText('Лесопилка');
  await page.locator('#close-panel').click();
  await expect(page.locator('#control-panel')).toBeHidden();
  const cameraBefore = JSON.parse((await page.locator('canvas').getAttribute('data-world-view'))!).x as number;
  const bounds = (await page.locator('canvas').boundingBox())!;
  await page.mouse.move(bounds.x + bounds.width * 0.72, bounds.y + bounds.height * 0.3);
  await page.mouse.down();
  await page.mouse.move(bounds.x + bounds.width * 0.55, bounds.y + bounds.height * 0.3, { steps: 5 });
  await page.mouse.up();
  await expect.poll(async () => Number(JSON.parse((await page.locator('canvas').getAttribute('data-world-view'))!).x))
    .not.toBe(cameraBefore);

  const warehouse = (await readWorld(page)).stores[0]!;
  await tapWorld(page, warehouse.x, WORLD.groundY - 80);
  await expect(page.locator('#selection-title')).toHaveText('Склад');
  await page.locator('#close-panel').click();

  await page.locator('#dock-build').click();
  await page.locator('#build-sawmill').click();
  await expect(page.locator('#placement-banner')).toBeVisible();
  await expect(page.locator('#grid-button')).toHaveText('Режим размещения');
  await tapWorld(page, 750, 450);
  await expect(page.locator('#confirm-placement')).toBeVisible();
  await page.locator('#close-panel').click();
  await expect(page.locator('#placement-banner')).toBeVisible();
  await expect(page.locator('#grid-button')).toHaveText('Режим размещения');
  await page.locator('#cancel-placement').click();
  await expect(page.locator('#placement-banner')).toBeHidden();
  await expect(page.locator('#grid-button')).toHaveText('Сетка: выкл.');

  await page.locator('#dock-build').click();
  await page.locator('#build-sawmill').click();
  await page.locator('#dock-residents').click();
  await expect(page.locator('#placement-banner')).toBeHidden();
  await expect(page.locator('.resident-row')).toHaveCount(3);
  await page.locator('.resident-row').first().click();
  await expect(page.locator('#selection-title')).toContainText('Илья');

  await page.locator('#dock-build').click();
  await page.locator('#build-sawmill').click();
  await page.locator('#menu-button').click();
  await expect(page.locator('#control-panel')).toHaveAttribute('data-mode', 'menu');
  await expect(page.locator('#placement-banner')).toBeHidden();
  await page.locator('#dock-focus').click();
  await expect(page.locator('#control-panel')).toBeHidden();
  await expect(page.locator('#placement-banner')).toBeHidden();
  await expect(page.locator('canvas')).toHaveAttribute('data-scene-heartbeat', /\d+/);
  await capture(page, 'placement-cancel-and-navigation-1366x768');
});

test('resident drag assigns tree, sawmill, ore, active construction and warehouse targets with clear invalid feedback', async ({ page }) => {
  const world = sixResidentWorld();
  world.residents[0]!.x = 650;
  world.residents[1]!.x = 1420;
  world.residents[2]!.x = 1580;
  world.residents[3]!.x = 870;
  world.residents[4]!.x = 1730;
  world.residents[5]!.x = 1000;
  world.trees[0]!.x = 234;
  world.stockpiles.find((pile) => pile.treeId === 'tree-home')!.x = 234;
  world.trees.push({ id: 'tree-home-secondary', cellId: 0, sourceId: 'home', x: 750,
    state: 'mature', growthSeconds: 120, cutProgress: 0, stateSeconds: 0, workerId: null, planted: true });
  world.trees.push({ id: 'tree-still-growing', cellId: 1, sourceId: 'home', x: 1400,
    state: 'growing', growthSeconds: 12, cutProgress: 0, stateSeconds: 0, workerId: null, planted: true });
  world.buildings.push({ id: 'drag-sawmill', kind: 'sawmill', x: 1200, y: WORLD.groundY,
    gridColumn: 4, gridRow: 2, footprint: { widthCells: 2, heightCells: 1 }, sourceTreeId: 'tree-home' });
  world.sites.push({ id: 'drag-active-site', kind: 'house', x: 1650, y: WORLD.groundY, deliveredWood: 0,
    deliveredOre: 0, progress: 0, stage: 0, priority: 2, paused: false });
  await seed(page, world);
  await openGame(page, { width: 1792, height: 828 });

  const dragWorld = await readWorld(page);
  const dragSawmill = dragWorld.buildings.find((building) => building.id === 'drag-sawmill')!;
  const secondaryTree = dragWorld.trees.find((tree) => tree.id === 'tree-home-secondary')!;
  const dragSite = dragWorld.sites.find((site) => site.id === 'drag-active-site')!;
  const dragWarehouse = dragWorld.stores[0]!;
  await dragResident(page, 'r5', { x: dragSawmill.x, y: WORLD.groundY - 90 }, 'Лесоруб', 'drag-01-sawmill-target');
  await dragResident(page, 'r1', { x: secondaryTree.x, y: WORLD.groundY - 90 }, 'Лесоруб', 'drag-02-adult-tree-target');
  await dragResident(page, 'r2', { x: 1950, y: 510 }, 'Каменщик', 'drag-03-ore-target');
  await dragResident(page, 'r3', { x: dragSite.x, y: WORLD.groundY - 100 }, 'Строитель', 'drag-04-construction-target');
  await dragResident(page, 'r4', { x: dragWarehouse.x, y: WORLD.groundY - 80 }, 'Грузчик', 'drag-05-warehouse-target');

  const invalidBefore = (await readWorld(page)).residents.find((resident) => resident.id === 'r6')!;
  const start = await pagePointForWorld(page, invalidBefore.x, invalidBefore.y - 50);
  const end = await pagePointForWorld(page, 1400, 510);
  await page.mouse.move(start.x, start.y); await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 8 });
  await expect(page.locator('canvas')).toHaveAttribute('data-drag-feedback', 'Дерево ещё не выросло.');
  await capture(page, 'drag-06-invalid-growing-tree');
  await page.mouse.up();
  expect((await readWorld(page)).residents.find((resident) => resident.id === 'r6')?.role).toBe('idle');

  expect((await readWorld(page)).residents).toHaveLength(6);
  await capture(page, 'drag-assignments-six-residents');
  const savedRoles = (await readWorld(page)).residents.map(({ id, role }) => ({ id, role }));
  await page.reload();
  await expect(page.locator('#world-scene canvas')).toBeVisible();
  await expect(page.locator('#catchup-status')).toBeHidden();
  const restored = await readWorld(page);
  expect(restored.residents).toHaveLength(6);
  expect(restored.residents.map(({ id, role }) => ({ id, role }))).toEqual(savedRoles);
});

test('a depleted deposit accepts a miner only at a completed mine; pointercancel leaves the previous job unchanged', async ({ page }) => {
  const world = sixResidentWorld();
  world.oreSource = 0;
  world.buildings.push({ id: 'drag-complete-mine', kind: 'mine', x: 1950, y: WORLD.groundY,
    gridColumn: 6, gridRow: 2, footprint: { widthCells: 1, heightCells: 1 } });
  await seed(page, world);
  await openGame(page, { width: 1792, height: 828 });

  await dragResident(page, 'r1', { x: 1950, y: 510 }, 'Каменщик', 'drag-07-completed-mine-target');
  const resident = (await readWorld(page)).residents.find((candidate) => candidate.id === 'r2')!;
  const start = await pagePointForWorld(page, resident.x, resident.y - 50);
  const end = await pagePointForWorld(page, (await readWorld(page)).stores[0]!.x, WORLD.groundY - 80);
  await page.mouse.move(start.x, start.y); await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 8 });
  await expect(page.locator('canvas')).toHaveAttribute('data-drag-role', 'hauler');
  await page.locator('canvas').evaluate((canvas) => canvas.dispatchEvent(new PointerEvent('pointercancel', {
    bubbles: true, cancelable: true, pointerId: 1, pointerType: 'mouse'
  })));
  await page.mouse.up();
  expect((await readWorld(page)).residents.find((candidate) => candidate.id === 'r2')?.role).toBe('idle');
});

test('120 consecutive profession changes use resident drag gestures and persist after each assignment', async ({ page }) => {
  test.setTimeout(8 * 60_000);
  const world = freshWorld();
  world.residents[0]!.x = 650;
  await seed(page, world);
  await openGame(page, { width: 1366, height: 768 });
  // Stress only the UI assignment path; hide the page to suspend normal ticks
  // so long test loops do not move residents into overlapping hit areas.
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
    document.dispatchEvent(new Event('visibilitychange'));
  });

  for (let index = 0; index < 120; index++) {
    const role = index % 2 === 0 ? 'woodcutter' : 'hauler';
    const current = await readWorld(page);
    const target = role === 'woodcutter'
      ? { x: current.trees.find((tree) => tree.id === 'tree-home')!.x, y: WORLD.groundY - 90 }
      : { x: current.stores[0]!.x, y: WORLD.groundY - 80 };
    const saved = await dragResident(page, 'r1', target,
      role === 'woodcutter' ? 'Лесоруб' : 'Грузчик', undefined, false);
    expect(saved.role).toBe(role);
  }
  await page.reload();
  await openGame(page, { width: 1366, height: 768 });
  expect((await readWorld(page)).residents[0]!.role).toBe('hauler');
});

test('one-hour catch-up stays in the scene, reports real progress and ignores duplicate resume events', async ({ page }) => {
  const world = sixResidentWorld();
  const now = Date.now();
  world.lastSimulatedAtMs = now - 60 * 60 * 1000;
  const elapsedBefore = world.elapsedSeconds;
  await seed(page, world);
  const startedAt = performance.now();
  await page.goto('/');
  const canvas = page.locator('#world-scene canvas');
  await expect(canvas).toBeVisible();
  await expect(page.locator('#catchup-status')).toBeVisible();
  await page.evaluate(() => {
    document.dispatchEvent(new Event('visibilitychange'));
    window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }));
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await expect(page.locator('#catchup-status')).toBeHidden({ timeout: 30_000 });
  const durationMs = performance.now() - startedAt;
  const restored = await readWorld(page);
  expect(restored.elapsedSeconds - elapsedBefore).toBeCloseTo(3600, 0);
  expect(restored.lastSimulatedAtMs).toBeGreaterThanOrEqual(now);
  await capture(page, 'catchup-one-hour-complete');
  await test.info().attach('catchup-measurement.json', { body: JSON.stringify({
    absenceSeconds: 3600, durationMs: Number(durationMs.toFixed(2)), residents: restored.residents.length,
    elapsedSeconds: restored.elapsedSeconds
  }, null, 2), contentType: 'application/json' });
});

test('placement, catch-up and grid controls do not overlap at five supported viewport sizes', async ({ page }) => {
  for (const viewport of viewports) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    if (page.url() === 'about:blank') {
      await seed(page, freshWorld());
      await page.goto('/');
    } else await page.reload();
    await expect(page.locator('canvas')).toBeVisible();
    await page.locator('#dock-build').click();
    await page.locator('#build-sawmill').click();
    await expect(page.locator('#placement-banner')).toBeVisible();
    await page.locator('#catchup-status').evaluate((element) => {
      element.textContent = 'Поселение догоняет время отсутствия: 37%';
      element.removeAttribute('hidden');
    });

    const geometry = await page.evaluate(() => {
      const ids = ['#grid-button', '#menu-button', '.goal-chip', '#placement-banner', '#catchup-status', '.action-dock'];
      const rectangles = ids.map((selector) => {
        const element = document.querySelector<HTMLElement>(selector)!;
        const rect = element.getBoundingClientRect();
        return { selector, hidden: element.hidden || rect.width === 0 || rect.height === 0,
          left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom };
      }).filter((rect) => !rect.hidden);
      const overlaps: string[] = [];
      for (let i = 0; i < rectangles.length; i++) for (let j = i + 1; j < rectangles.length; j++) {
        const a = rectangles[i]!, b = rectangles[j]!;
        if (a.left < b.right - 2 && a.right > b.left + 2 && a.top < b.bottom - 2 && a.bottom > b.top + 2) {
          overlaps.push(`${a.selector}:${b.selector}`);
        }
      }
      return { rectangles, overlaps, scrollWidth: document.documentElement.scrollWidth, innerWidth };
    });
    expect(geometry.overlaps, viewport.name).toEqual([]);
    expect(geometry.scrollWidth, viewport.name).toBeLessThanOrEqual(geometry.innerWidth);
    expect(await page.locator('#grid-button').innerText()).toBe('Режим размещения');
    await capture(page, `hud-${viewport.name}`);
    await page.locator('#cancel-placement').click();
  }
});
