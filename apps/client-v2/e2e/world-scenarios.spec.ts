import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';

const projectRoot = process.cwd();
const tsxCli = path.join(projectRoot, 'node_modules/tsx/dist/cli.mjs');
const scenarios = [
  'empty', 'basic', 'resources-full', 'lumberjack', 'stone-mining', 'construction',
  'construction-role-transition', 'construction-blocked', 'logistics-deadlock', 'multi-worker',
  'g4-multi-storage', 'g4-logistics-priority', 'g5-construction-layout', 'g5-support-invalid',
   'g5-route-blocked', 'g5-demolition-cleanup', 'g5-logistics-blocked', 'g6-sector-expansion',
    'g6-build-workpoint', 'g6-two-houses', 'g6-underground-excavation', 'g6-underground-visual-acceptance', 'late-settlement'
];

function manualTestClientUrl(): string {
  const port = Number(process.env.AVANPOST_V2_TEST_LOOPBACK_CLIENT_PORT ?? '14175');
  return process.env.AVANPOST_V2_ENABLE_LAN === 'true'
    ? `http://localhost:${port}/`
    : `http://${process.env.AVANPOST_V2_BIND_HOST ?? '127.0.0.1'}:${Number(process.env.AVANPOST_V2_TEST_CLIENT_PORT ?? '14174')}/`;
}

function resetScenario(scenario: string): void {
  execFileSync(process.execPath, [tsxCli, 'src/cli/reset-isolated-world.ts', scenario], {
    cwd: path.join(projectRoot, 'apps/server-v2'),
    env: { ...process.env, AVANPOST_V2_DATABASE_OPERATION: 'test' },
    stdio: 'pipe'
  });
}

test('G3.6 every named scenario resets deterministically and loads in the client', async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  test.skip(testInfo.project.name !== 'peace-v2-desktop', 'Each scenario is smoke-tested once in desktop Chromium.');

  for (const scenario of scenarios) {
    resetScenario(scenario);
    await page.goto(manualTestClientUrl());
    await expect(page.locator('#world-scene canvas')).toBeVisible();
    const preview = await page.evaluate(async () => {
      const response = await fetch('/api/world/preview', { cache: 'no-store' });
      const world = await response.json() as {
        revision?: { worldVersion: number };
        actors?: Array<{ workRole?: string; cargo?: number; visualState?: string }>;
        buildings?: Array<{ buildingId?: string }>;
        buildOrders?: Array<{ status: string; blockedReason: string | null; queuePosition?: number }>;
        storages?: Array<{ id: string; contents: { wood: number; stone: number } }>;
        resourceNodes?: Array<{ visualKey: string; bufferQuantity: number; bufferCapacity: number }>;
        stoneDeposits?: Array<{ remaining: number; bufferQuantity: number; bufferCapacity: number }>;
        sectors?: Array<{ id: string; state: string; biome: string | null; testOverride: boolean; obstacles: Array<{ id: string; kind: string }> }>;
        cells?: Array<{ sectorId?: string; obstacleId?: string | null; prepared?: boolean }>;
        resourceTotals?: unknown[];
      };
      return { status: response.status, world };
    });
    expect(preview.status, `scenario ${scenario} preview`).toBe(200);
    expect(preview.world.revision?.worldVersion, `scenario ${scenario} revision`).toBeGreaterThan(0);
    if (scenario === 'g4-multi-storage') {
      expect(preview.world.actors?.map((actor) => actor.workRole).sort())
        .toEqual(['builder', 'hauler', 'stone_miner', 'woodcutter'].sort());
      const builder = preview.world.actors?.find((actor) => actor.workRole === 'builder');
      expect(builder?.cargo).toBe(1);
      expect(['waiting_storage', 'carrying_to_storage']).toContain(builder?.visualState);
      expect(preview.world.storages).toHaveLength(2);
      expect(preview.world.storages?.map((storage) => storage.contents.wood)).toEqual([16, 0]);
      expect(preview.world.stoneDeposits?.[0]?.bufferQuantity).toBe(6);
      expect(preview.world.resourceNodes?.find((node) => node.visualKey === 'resource-tree-3'))
        .toMatchObject({ bufferQuantity: 3, bufferCapacity: 3 });
      expect(['waiting_materials', 'waiting_builder']).toContain(preview.world.buildOrders?.[0]?.status);
      expect(['INSUFFICIENT_STONE', 'NO_BUILDER']).toContain(preview.world.buildOrders?.[0]?.blockedReason);
    } else if (scenario === 'g4-logistics-priority') {
      expect(preview.world.actors?.filter((actor) => actor.workRole === 'hauler')).toHaveLength(2);
      expect(preview.world.actors?.some((actor) => actor.workRole === 'woodcutter')).toBe(true);
      expect(preview.world.actors?.some((actor) => actor.workRole === 'stone_miner')).toBe(true);
      expect(preview.world.actors?.some((actor) => actor.workRole === 'builder')).toBe(true);
      expect(preview.world.storages).toHaveLength(2);
      expect(preview.world.stoneDeposits?.[0]?.bufferCapacity).toBeGreaterThan(0);
      expect(preview.world.buildOrders).toHaveLength(2);
      expect(preview.world.buildOrders?.map((order) => order.queuePosition).sort()).toEqual([0, 1]);
    } else if (scenario === 'g6-sector-expansion') {
      expect(preview.world.sectors?.filter((sector) => sector.state === 'unlockable')).toHaveLength(2);
      expect(preview.world.sectors?.find((sector) => sector.id === 'sector-1-0')).toMatchObject({ testOverride: true });
      expect(preview.world.sectors?.find((sector) => sector.id === 'sector-1-0')?.biome).toBe('woodland');
      expect(preview.world.sectors?.find((sector) => sector.id === 'sector-1-0')?.obstacles).toHaveLength(6);
      expect(preview.world.cells?.filter((cell) => cell.sectorId === 'sector-0-0')).toHaveLength(49);
      expect(preview.world.actors?.map((actor) => actor.workRole).sort()).toEqual(['builder', 'builder', 'hauler', 'hauler', 'hauler']);
      expect(preview.world.actors?.every((actor) => actor.visualState === 'idle')).toBe(true);
      expect(preview.world.actors?.length).toBeGreaterThanOrEqual(2);
    } else if (scenario.startsWith('g5-')) {
      const loadedHauler = preview.world.actors?.find((actor) => actor.workRole === 'hauler');
      if (scenario === 'g5-demolition-cleanup' || scenario === 'g5-logistics-blocked') {
        expect(preview.world.actors).toHaveLength(2);
      } else {
        expect(loadedHauler?.cargo).toBe(1);
        expect(['hauling_to_storage', 'hauling_unloading', 'unloading']).toContain(loadedHauler?.visualState);
      }
      expect(preview.world.storages).toHaveLength(2);
      expect(preview.world.buildings?.filter((building) => building.buildingId === 'cabin' || building.buildingId === 'workshop'))
        .toHaveLength(scenario === 'g5-logistics-blocked' ? 3 : 2);
    } else {
      expect(preview.world.actors?.length, `scenario ${scenario} actors`).toBeGreaterThanOrEqual(2);
    }
    expect(preview.world.buildings, `scenario ${scenario} buildings`).toBeDefined();
    expect(preview.world.resourceTotals, `scenario ${scenario} resources`).toBeDefined();
    if (scenario === 'g4-multi-storage') {
      await expect(page.locator('#world-scene')).toHaveAttribute('data-storage-visual-count', '2');
      await page.locator('#pairing-panel summary').click();
      const storagePoints = await page.locator('#world-scene').evaluate((element) => {
        const root = element as HTMLElement;
        return [0, 1].map((index) => ({
          x: Number(root.dataset[`storage${index}CanvasX`]),
          y: Number(root.dataset[`storage${index}CanvasY`])
        }));
      });
      for (const [index, storage] of storagePoints.entries()) {
        expect(Number.isFinite(storage.x) && Number.isFinite(storage.y)).toBe(true);
        await page.locator('#world-scene canvas').click({ position: { x: storage.x, y: storage.y } });
        await page.waitForTimeout(1_250);
        await expect(page.locator('#world-context')).toBeVisible();
        await expect(page.locator('#context-kind')).toHaveText('СКЛАД');
        await expect(page.locator('#inspector-title')).toHaveText(index === 0 ? 'Главный склад' : 'Склад у рощи');
        await expect(page.locator('#inspector-detail')).toContainText(index === 0 ? '16/16' : '0/16');
      }
    }
    await expect(page.locator('#world-scene')).toHaveAttribute('data-camera-zoom', /\d/);
  }
});

test('G6.2.5 renders a 46 px resident and non-walkable clearance on desktop and mobile', async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  resetScenario('g6-underground-visual-acceptance');
  await page.goto(manualTestClientUrl());
  await expect(page.locator('#world-scene canvas')).toBeVisible();
  if (!(await page.locator('#pairing-panel').evaluate((element) => (element as HTMLDetailsElement).open))) {
    await page.locator('#pairing-panel summary').click();
  }
  if (testInfo.project.name === 'peace-v2-mobile') {
    const code = await page.evaluate(async (port) => {
      const response = await fetch(`http://127.0.0.1:${port}/api/launcher/pairing-code`, { mode: 'cors' });
      if (!response.ok) throw new Error(`Handoff request failed (${response.status})`);
      return (await response.json() as { code: string }).code;
    }, Number(process.env.AVANPOST_V2_TEST_HANDOFF_PORT ?? '18889'));
    await page.getByLabel('Одноразовый код').fill(code);
  } else {
    await page.getByRole('button', { name: 'Показать код на этом компьютере' }).click();
    await expect(page.locator('#pairing-code')).toHaveText(/^[a-f0-9]{32}$/);
    await page.getByLabel('Одноразовый код').fill((await page.locator('#pairing-code').textContent())!.trim());
  }
  await page.getByRole('button', { name: 'Подключить' }).click();
  await expect(page.locator('#pairing-summary')).toHaveText('Мир подключён к этому браузеру');
  await page.locator('#camera-underground').click();
  const initial = await page.evaluate(async () => {
    const response = await fetch('/api/world', { cache: 'no-store' });
    if (!response.ok) throw new Error(`world API ${response.status}`);
    const world = await response.json() as { residents: Array<{ id: string; position: { x: number; y: number } }> };
    const root = document.querySelector('#world-scene') as HTMLElement;
    return {
      residents: world.residents,
      visuals: Object.fromEntries(world.residents.map((resident) => {
        const key = `resident${resident.id.replace(/[^a-zA-Z0-9]/g, '')}`;
        return [resident.id, {
          bodyHeight: root.dataset[`${key}BodyHeight`],
          scaleX: root.dataset[`${key}ScaleX`],
          scaleY: root.dataset[`${key}ScaleY`],
          feetY: root.dataset[`${key}FeetY`],
          worldY: root.dataset[`${key}WorldY`]
        }];
      })),
      tileObjects: root.dataset.undergroundTileObjectCount,
      dirtyTiles: root.dataset.undergroundDirtyTileCount,
      tunnelTileHeight: root.dataset.undergroundTunnelTileHeight,
      floorOffset: root.dataset.undergroundFloorOffset
    };
  });
  expect(initial.residents.some((resident) => resident.position.y > 0)).toBe(true);
  for (const [residentId, raw] of Object.entries(initial.visuals)) {
    const visual = raw as Record<string, string | undefined>;
    expect(Number(visual.bodyHeight), `${residentId} body height`).toBeCloseTo(46);
    expect(Number(visual.scaleX), `${residentId} scaleX`).toBeCloseTo(Number(visual.scaleY));
    expect(Number(visual.feetY), `${residentId} feet anchor`).toBeCloseTo(Number(visual.worldY));
  }
  expect(Number(initial.tileObjects)).toBeGreaterThan(0);
  expect(initial.tunnelTileHeight).toBe('82');
  expect(initial.floorOffset).toBe('47');

  const clearancePoint = await page.locator('#world-scene').evaluate((element) => {
    const root = element as HTMLElement;
    const canvas = root.querySelector('canvas')!;
    const rect = canvas.getBoundingClientRect();
    const zoom = Number(root.dataset.cameraZoom);
    const viewX = Number(root.dataset.cameraWorldViewX);
    const viewY = Number(root.dataset.cameraWorldViewY);
    const viewportX = Number(root.dataset.cameraViewportX);
    const viewportY = Number(root.dataset.cameraViewportY);
    const viewportWidth = Number(root.dataset.cameraViewportWidth);
    const viewportHeight = Number(root.dataset.cameraViewportHeight);
    const worldX = 4 * 48 + 24, worldY = 1 * 48 + 24;
    return {
      x: (viewportX + (worldX - viewX) * zoom) * rect.width / viewportWidth,
      y: (viewportY + (worldY - viewY) * zoom) * rect.height / viewportHeight
    };
  });
  if (testInfo.project.name === 'peace-v2-mobile') await page.touchscreen.tap(clearancePoint.x, clearancePoint.y);
  else await page.locator('#world-scene canvas').click({ position: clearancePoint });
  await expect(page.locator('#inspector-detail')).toContainText('Просвет');
  await expect(page.locator('#build-underground-ladder')).toBeHidden();
  await expect(page.locator('#excavate-cell')).toBeHidden();
  await expect(page.locator('#mine-underground')).toBeHidden();
  await expect(page.locator('#world-scene')).toHaveAttribute('data-underground-dirty-tile-count', '0');
  await testInfo.attach('g6.2.5-underground-visual-acceptance.png', {
    body: await page.screenshot(), contentType: 'image/png'
  });
});

test('G6.2 player excavates, builds a ladder, mines and delivers underground stone', async ({ page }, testInfo) => {
  test.setTimeout(240_000);
  const runDirectory = path.join(projectRoot, '.gstack/run');
  mkdirSync(runDirectory, { recursive: true });
  resetScenario('g6-underground-excavation');
  await page.goto(manualTestClientUrl());
  await expect(page.locator('#world-scene canvas')).toBeVisible();
  await page.locator('#camera-underground').click();
  await expect.poll(() => page.locator('#world-scene').evaluate((element) =>
    Object.keys((element as HTMLElement).dataset).filter((key) => key.startsWith('undergroundCell')).length))
    .toBe(0);

  const clickUndergroundCell = async (x: number, y: number) => {
    const point = await page.locator('#world-scene').evaluate((element, coordinate) => {
      const root = element as HTMLElement;
      const canvas = root.querySelector('canvas');
      if (!canvas) throw new Error('Peace V2 canvas unavailable');
      const canvasRect = canvas.getBoundingClientRect();
      const zoom = Number(root.dataset.cameraZoom);
      const viewX = Number(root.dataset.cameraWorldViewX);
      const viewY = Number(root.dataset.cameraWorldViewY);
      const viewportX = Number(root.dataset.cameraViewportX);
      const viewportY = Number(root.dataset.cameraViewportY);
      const viewportWidth = Number(root.dataset.cameraViewportWidth);
      const viewportHeight = Number(root.dataset.cameraViewportHeight);
      const worldX = coordinate.x * 48 + 24;
      const worldY = coordinate.y * 48 + 24;
      return {
        x: (viewportX + (worldX - viewX) * zoom) * canvasRect.width / viewportWidth,
        y: (viewportY + (worldY - viewY) * zoom) * canvasRect.height / viewportHeight
      };
    }, { x, y });
    expect(Number.isFinite(point.x) && Number.isFinite(point.y), `underground cell ${x},${y} is rendered`).toBe(true);
    if (testInfo.project.name === 'peace-v2-mobile') await page.touchscreen.tap(point.x, point.y);
    else await page.locator('#world-scene canvas').click({ position: point });
    await expect(page.locator('#world-context')).toBeVisible();
    await expect(page.locator('#inspector-title')).toHaveText(`Клетка ${x}, ${y}`);
  };
  const getWorld = () => page.evaluate(async () => {
    const response = await fetch('/api/world', { cache: 'no-store', signal: AbortSignal.timeout(15_000) });
    if (!response.ok) throw new Error(`world API ${response.status}`);
    const world = await response.json() as {
      revision: { serverTick: number };
      residents: Array<{
        id: string;
        name: string;
        appearanceKey: string;
        workRole: 'none' | 'woodcutter' | 'builder' | 'stone_miner' | 'hauler';
        state: string;
        visualState: string;
        position: { x: number; y: number };
        blockedReason: string | null;
        cargo: number;
        task: null | {
          id: string;
          kind: string;
          phase: string;
          path: Array<{ x: number; y: number }>;
          pathIndex: number;
          blockedReason: string | null;
          jobId?: string;
          target?: { x: number; y: number };
        };
      }>;
      undergroundCells: Array<{ position: { x: number; y: number }; state: string; floorSupported: boolean }>;
      undergroundDeposits: Array<{ id: string; remaining: number; revealed: boolean }>;
      ladders: Array<{
        id: string; state: string; blockedReason: string | null; assignedResidentId: string | null;
        top: { x: number; y: number }; bottom: { x: number; y: number };
      }>;
      undergroundJobs: Array<{
        id: string; kind: string; status: string; blockedReason: string | null;
        target: { x: number; y: number }; assignedResidentId: string | null;
      }>;
      undergroundPlans: Array<{
        id: string; state: string; currentStep: number; blockedReason: string | null;
        steps: Array<{ kind: string; ladderId?: string; x?: number; topDepth?: number; depth?: number }>;
      }>;
      storages: Array<{ contents: { wood: number; stone: number } }>;
    };
    const root = document.querySelector('#world-scene') as HTMLElement | null;
    const phaserFields = ['LogicalX', 'LogicalY', 'WorldX', 'WorldY', 'ScreenX', 'ScreenY',
      'TweenTargetY', 'TweenStartY', 'TweenTargetScreenX', 'TweenTargetScreenY', 'TweenKind', 'Animation',
      'TweenCount', 'VisualState', 'TaskId', 'TaskPhase', 'PathIndex', 'NextX', 'NextY', 'WorkTargetX',
      'WorkTargetY', 'LadderId', 'LadderState', 'ScaleX', 'ScaleY', 'FrameWidth', 'FrameHeight',
      'BodyWidth', 'BodyHeight', 'FeetY', 'HitAreaWidth', 'HitAreaHeight', 'BodyTopY', 'Angle'];
    const residentVisuals = Object.fromEntries(world.residents.map((resident) => {
      const key = `resident${resident.id.replace(/[^a-zA-Z0-9]/g, '')}`;
      return [resident.id, Object.fromEntries(phaserFields.map((suffix) =>
        [suffix, root?.dataset[`${key}${suffix}`] ?? 'missing']))];
    }));
    return { ...world, residentVisuals, phaser: residentVisuals['worker-1'] ?? {} };
  });

  if (!(await page.locator('#pairing-panel').evaluate((element) => (element as HTMLDetailsElement).open))) {
    await page.locator('#pairing-panel summary').click();
  }
  if (testInfo.project.name === 'peace-v2-mobile') {
    const code = await page.evaluate(async (port) => {
      const response = await fetch(`http://127.0.0.1:${port}/api/launcher/pairing-code`, { mode: 'cors' });
      if (!response.ok) throw new Error(`Handoff request failed (${response.status})`);
      return (await response.json() as { code: string }).code;
    }, Number(process.env.AVANPOST_V2_TEST_HANDOFF_PORT ?? '18889'));
    await page.getByLabel('Одноразовый код').fill(code);
  } else {
    await page.getByRole('button', { name: 'Показать код на этом компьютере' }).click();
    await expect(page.locator('#pairing-code')).toHaveText(/^[a-f0-9]{32}$/);
    await page.getByLabel('Одноразовый код').fill((await page.locator('#pairing-code').textContent())!.trim());
  }
  await page.getByRole('button', { name: 'Подключить' }).click();
  await expect(page.locator('#pairing-summary')).toHaveText('Мир подключён к этому браузеру');
  await page.locator('#camera-underground').click();
  if (await page.locator('#toggle-world-grid').getAttribute('aria-pressed') !== 'true') {
    await page.locator('#toggle-world-grid').click();
  }
  await expect.poll(async () => page.locator('#world-scene').getAttribute('data-world-grid-visible')).toBe('true');
  const idleWorld = await getWorld();
  const idleWorker = idleWorld.residents.find((resident) => resident.position.y === 1);
  expect(idleWorker, 'the manual test scenario starts with its miner at depth one').toBeDefined();
  const idleDataKey = `resident${idleWorker!.id.replace(/[^a-zA-Z0-9]/g, '')}`;
  await expect.poll(async () => page.locator('#world-scene').evaluate((element, key) =>
    (element as HTMLElement).dataset[`${key}LogicalY`], idleDataKey)).toBe('1');
  const idleMotion = await page.locator('#world-scene').evaluate((element, key) => {
    const root = element as HTMLElement;
    return {
      logicalY: root.dataset[`${key}LogicalY`],
      worldY: root.dataset[`${key}WorldY`],
      animation: root.dataset[`${key}Animation`],
      tweenKind: root.dataset[`${key}TweenKind`],
      tweenCount: root.dataset[`${key}TweenCount`],
      tweenTargetY: root.dataset[`${key}TweenTargetY`],
      scaleX: root.dataset[`${key}ScaleX`],
      scaleY: root.dataset[`${key}ScaleY`],
      bodyWidth: root.dataset[`${key}BodyWidth`],
      bodyHeight: root.dataset[`${key}BodyHeight`],
      feetY: root.dataset[`${key}FeetY`],
      hitAreaWidth: root.dataset[`${key}HitAreaWidth`],
      hitAreaHeight: root.dataset[`${key}HitAreaHeight`]
    };
  }, idleDataKey);
  expect(idleMotion).toMatchObject({ logicalY: '1', worldY: '95', animation: 'idle', tweenKind: 'none', tweenCount: '0', tweenTargetY: 'none',
    feetY: '84', hitAreaWidth: '48' });
  expect(Number(idleMotion.bodyHeight)).toBeCloseTo(46);
  expect(Number(idleMotion.hitAreaHeight)).toBeCloseTo(46);
  expect(Number(idleMotion.scaleX)).toBeCloseTo(Number(idleMotion.scaleY));

  const atlasBounds = await page.evaluate(async () => {
    const image = new Image();
    image.src = '/assets/peace-v2/worker-atlas.png';
    await image.decode();
    const frameWidth = 192;
    const frameHeight = 224;
    const context = document.createElement('canvas').getContext('2d', { willReadFrequently: true })!;
    const bounds: Array<{ left: number; top: number; right: number; bottom: number }> = [];
    for (let frame = 0; frame < image.naturalWidth / frameWidth; frame += 1) {
      const canvas = context.canvas;
      canvas.width = frameWidth;
      canvas.height = frameHeight;
      context.drawImage(image, frame * frameWidth, 0, frameWidth, frameHeight, 0, 0, frameWidth, frameHeight);
      const pixels = context.getImageData(0, 0, frameWidth, frameHeight).data;
      let left = frameWidth;
      let top = frameHeight;
      let right = -1;
      let bottom = -1;
      for (let y = 0; y < frameHeight; y += 1) {
        for (let x = 0; x < frameWidth; x += 1) {
          if (pixels[(y * frameWidth + x) * 4 + 3]! <= 24) continue;
          left = Math.min(left, x);
          top = Math.min(top, y);
          right = Math.max(right, x + 1);
          bottom = Math.max(bottom, y + 1);
        }
      }
      bounds.push({ left, top, right, bottom });
    }
    return bounds;
  });
  expect(atlasBounds).toHaveLength(15);
  expect(new Set(atlasBounds.map(({ top }) => top))).toEqual(new Set([36]));
  expect(new Set(atlasBounds.map(({ bottom }) => bottom))).toEqual(new Set([214]));
  expect(Math.max(...atlasBounds.map(({ right, left }) => right - left)) * (46 / 178)).toBeLessThanOrEqual(48);

  await expect.poll(async () => {
    const world = await getWorld();
    return world.residents.every((resident) =>
      (world.residentVisuals[resident.id] as Record<string, string>).BodyHeight !== 'missing');
  }).toBe(true);
  const initialVisuals = await getWorld();
  await expect.poll(() => page.locator('#world-scene').getAttribute('data-underground-tile-object-count'))
    .not.toBeNull();
  const initialUndergroundRender = await page.locator('#world-scene').evaluate((element) => {
    const root = element as HTMLElement;
    return {
      tileCount: Number(root.dataset.undergroundTileObjectCount),
      tileUpdates: Number(root.dataset.undergroundTileUpdatesTotal),
      geometryUpdates: Number(root.dataset.undergroundGeometryUpdateCount)
    };
  });
  expect(initialVisuals.residents.map((resident) => resident.id)).toEqual(['worker-1', 'worker-2', 'worker-3', 'worker-4']);
  expect(initialVisuals.residents.find((resident) => resident.id === 'worker-2')?.workRole).toBe('hauler');
  expect(initialVisuals.residents.find((resident) => resident.id === 'worker-3')?.workRole).toBe('builder');
  expect(initialVisuals.residents.find((resident) => resident.id === 'worker-4')?.position).toEqual({ x: -2, y: 1 });
  for (const resident of initialVisuals.residents) {
    const visual = initialVisuals.residentVisuals[resident.id] as Record<string, string>;
    expect(Number(visual.BodyHeight), `${resident.id} visible height`).toBeCloseTo(46);
    expect(Number(visual.ScaleX), `${resident.id} uniform x scale`).toBeCloseTo(Number(visual.ScaleY));
    expect(Number(visual.FeetY), `${resident.id} feet share their cell baseline`).toBeCloseTo(Number(visual.WorldY));
    expect(Number(visual.FeetY) - Number(visual.BodyTopY), `${resident.id} body bounds`).toBeCloseTo(46);
    expect(Number(visual.HitAreaWidth)).toBe(48);
    expect(Number(visual.HitAreaHeight)).toBeCloseTo(46);
  }
  const haulerPoint = await page.locator('#world-scene').evaluate((element) => {
    const root = element as HTMLElement;
    return { x: Number(root.dataset.resident1CanvasX), y: Number(root.dataset.resident1CanvasY) };
  });
  expect(Number.isFinite(haulerPoint.x) && Number.isFinite(haulerPoint.y)).toBe(true);
  await page.locator('#world-scene canvas').click({ position: haulerPoint });
  await expect(page.locator('#inspector-title')).toHaveText('Носильщик');
  if (testInfo.project.name === 'peace-v2-mobile') {
    const zoomBefore = await page.locator('#world-scene').getAttribute('data-camera-zoom');
    await page.locator('#zoom-in').click();
    await expect.poll(async () => Number(await page.locator('#world-scene').getAttribute('data-camera-zoom')))
      .toBeGreaterThan(Number(zoomBefore));
    const zoomedWorld = await getWorld();
    for (const resident of zoomedWorld.residents) {
      const visual = zoomedWorld.residentVisuals[resident.id] as Record<string, string>;
      expect(Number(visual.BodyHeight)).toBeCloseTo(46);
      expect(Number(visual.ScaleX)).toBeCloseTo(Number(visual.ScaleY));
    }
    const canvasBox = await page.locator('#world-scene canvas').boundingBox();
    expect(canvasBox).not.toBeNull();
    const scrollBeforePan = await page.locator('#world-scene').evaluate((element) => {
      const root = element as HTMLElement;
      return [root.dataset.cameraScrollX, root.dataset.cameraScrollY];
    });
    const touch = await page.context().newCDPSession(page);
    await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [
      { x: canvasBox!.x + canvasBox!.width * 0.8, y: canvasBox!.y + canvasBox!.height * 0.65 }
    ] });
    await touch.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [
      { x: canvasBox!.x + canvasBox!.width * 0.6, y: canvasBox!.y + canvasBox!.height * 0.52 }
    ] });
    await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await touch.detach();
    await expect.poll(async () => page.locator('#world-scene').evaluate((element, before) => {
      const root = element as HTMLElement;
      return root.dataset.cameraScrollX !== before[0] || root.dataset.cameraScrollY !== before[1];
    }, scrollBeforePan)).toBe(true);
    await page.locator('#camera-underground').click();
  } else {
    const zoomBefore = Number(await page.locator('#world-scene').getAttribute('data-camera-zoom'));
    await page.locator('#zoom-in').click();
    await expect.poll(async () => Number(await page.locator('#world-scene').getAttribute('data-camera-zoom')))
      .toBeGreaterThan(zoomBefore);
    const zoomedWorld = await getWorld();
    for (const resident of zoomedWorld.residents) {
      const visual = zoomedWorld.residentVisuals[resident.id] as Record<string, string>;
      expect(Number(visual.BodyHeight)).toBeCloseTo(46);
      expect(Number(visual.ScaleX)).toBeCloseTo(Number(visual.ScaleY));
    }
    const zoomedIn = Number(await page.locator('#world-scene').getAttribute('data-camera-zoom'));
    await page.locator('#zoom-out').click();
    await expect.poll(async () => Number(await page.locator('#world-scene').getAttribute('data-camera-zoom')))
      .toBeLessThan(zoomedIn);
  }

  await clickUndergroundCell(3, 2);
  await expect(page.locator('#plan-underground-route')).toBeVisible();
  page.once('dialog', (dialog) => {
    expect(dialog.message()).toContain('Предпросмотр маршрута');
    expect(dialog.message()).toContain('перенос: 1');
    void dialog.accept();
  });
  const routeResponsePromise = page.waitForResponse((response) => response.url().includes('/api/commands') && response.request().method() === 'POST');
  await page.locator('#plan-underground-route').click();
  const routeResponse = await routeResponsePromise;
  expect(routeResponse.status(), await routeResponse.text()).toBe(200);
  const queuedRoute = await getWorld();
  const queuedPlan = queuedRoute.undergroundPlans[0]!;
  expect(queuedPlan.steps).toEqual(expect.arrayContaining([
    expect.objectContaining({ kind: 'relocate-ladder', ladderId: 'g6-spare-shaft', x: 2, topDepth: 1, depth: 2 })
  ]));
  expect(queuedRoute.ladders.find((ladder) => ladder.id === 'g6-upper-shaft')?.state).toBe('complete');
  expect(queuedRoute.storages[0]?.contents.wood).toBe(12);

  const movementTrace: Array<Record<string, unknown>> = [];
  const climbFrames: Array<{
    path: string; logicalX: number; logicalY: number; worldY: number; targetWorldY: number;
    screenY: number; targetScreenY: number; animation: string; tweenCount: number;
    scaleX: number; scaleY: number; bodyHeight: number; feetY: number; angle: number;
  }> = [];
  let residentSceneScreenshot: { image: string; residents: Record<string, unknown>; gridVisible: boolean } | null = null;
  if (testInfo.project.name === 'peace-v2-desktop') await page.evaluate(() => {
    const captureWindow = window as unknown as {
      __g62DescentFrames?: Array<Record<string, unknown>>;
      __g62ResidentScaleScreenshot?: { image: string; residents: Record<string, unknown>; gridVisible: boolean };
      __g623ResidentAnimationSamples?: Array<Record<string, unknown>>;
      __g623ResidentAnimationLast?: Record<string, string>;
    };
    captureWindow.__g62DescentFrames = [];
    captureWindow.__g623ResidentAnimationSamples = [];
    captureWindow.__g623ResidentAnimationLast = {};
    const sampleFrame = () => {
      const root = document.querySelector('#world-scene') as HTMLElement | null;
      const canvas = root?.querySelector('canvas');
      if (root) {
        for (const id of ['worker-1', 'worker-2', 'worker-3', 'worker-4']) {
          const key = `resident${id.replace(/[^a-zA-Z0-9]/g, '')}`;
          const animation = root.dataset[`${key}Animation`];
          if (!animation || animation === 'missing') continue;
          const state = root.dataset[`${key}VisualState`] ?? 'missing';
          const logicalY = root.dataset[`${key}LogicalY`] ?? 'missing';
          const scaleX = root.dataset[`${key}ScaleX`] ?? 'missing';
          const scaleY = root.dataset[`${key}ScaleY`] ?? 'missing';
          const signature = `${animation}|${state}|${logicalY}|${scaleX}|${scaleY}`;
          if (captureWindow.__g623ResidentAnimationLast![id] === signature) continue;
          captureWindow.__g623ResidentAnimationLast![id] = signature;
          captureWindow.__g623ResidentAnimationSamples!.push({ id, animation, state, logicalY, scaleX, scaleY,
            bodyHeight: root.dataset[`${key}BodyHeight`], feetY: root.dataset[`${key}FeetY`],
            bodyTopY: root.dataset[`${key}BodyTopY`], angle: root.dataset[`${key}Angle`],
            tweenKind: root.dataset[`${key}TweenKind`] });
        }
      }
      const worldY = Number(root?.dataset.residentworker1WorldY);
      const targetWorldY = Number(root?.dataset.residentworker1TweenTargetY);
      const startWorldY = Number(root?.dataset.residentworker1TweenStartY);
      const frames = captureWindow.__g62DescentFrames!;
      const previous = frames.at(-1);
      if (canvas && root?.dataset.residentworker1TweenKind === 'climb' && targetWorldY > worldY && frames.length < 8 &&
          (!previous || Math.abs(worldY - Number(previous.worldY)) >= 8)) {
        frames.push({ image: canvas.toDataURL('image/png'), logicalX: Number(root.dataset.residentworker1LogicalX),
          logicalY: Number(root.dataset.residentworker1LogicalY),
          worldY, targetWorldY, screenY: Number(root.dataset.residentworker1ScreenY),
          targetScreenY: Number(root.dataset.residentworker1TweenTargetScreenY), animation: root.dataset.residentworker1Animation,
          tweenCount: Number(root.dataset.residentworker1TweenCount), scaleX: Number(root.dataset.residentworker1ScaleX),
          scaleY: Number(root.dataset.residentworker1ScaleY), bodyHeight: Number(root.dataset.residentworker1BodyHeight),
          feetY: Number(root.dataset.residentworker1FeetY), angle: Number(root.dataset.residentworker1Angle) });
      }
      const frameLow = Math.min(startWorldY, targetWorldY);
      const frameHigh = Math.max(startWorldY, targetWorldY);
      const midClimb = root?.dataset.residentworker1TweenKind === 'climb' && Number.isFinite(startWorldY) &&
        worldY > frameLow + 6 && worldY < frameHigh - 6 && Number(root.dataset.residentworker1TweenCount) === 1;
      if (canvas && root?.dataset.worldGridVisible === 'true' && midClimb && !captureWindow.__g62ResidentScaleScreenshot) {
        const ids = ['worker-1', 'worker-2', 'worker-3', 'worker-4'];
        const residents = Object.fromEntries(ids.map((id) => {
          const key = `resident${id.replace(/[^a-zA-Z0-9]/g, '')}`;
          return [id, Object.fromEntries(['LogicalX', 'LogicalY', 'WorldX', 'WorldY', 'ScreenX', 'ScreenY',
            'ScaleX', 'ScaleY', 'BodyHeight', 'FeetY', 'HitAreaWidth', 'HitAreaHeight', 'Angle', 'TweenKind', 'Animation'].map((suffix) =>
            [suffix, root.dataset[`${key}${suffix}`] ?? 'missing']))];
        }));
        captureWindow.__g62ResidentScaleScreenshot = { image: canvas.toDataURL('image/png'), residents,
          gridVisible: true };
      }
      requestAnimationFrame(sampleFrame);
    };
    requestAnimationFrame(sampleFrame);
  });
  let lastTick = -1;
  let previousTaskPath = '';
  let previousTaskId = '';
  const recordMovement = (state: Awaited<ReturnType<typeof getWorld>>) => {
    const worker = state.residents.find((resident) => resident.id === 'worker-1');
    if (worker && state.revision.serverTick > lastTick) {
      lastTick = state.revision.serverTick;
      const task = worker.task;
      const job = task?.kind === 'underground-work'
        ? state.undergroundJobs.find((candidate) => candidate.id === task.jobId) : undefined;
      const ladder = state.ladders.find((candidate) => candidate.top.x === worker.position.x &&
        worker.position.y >= candidate.top.y && worker.position.y <= candidate.bottom.y);
      const nextCell = task?.path[task.pathIndex] ?? null;
      const visual = state.phaser;
      const pathSignature = task?.path.map((point) => `${point.x},${point.y}`).join(';') ?? '';
      movementTrace.push({
        tick: state.revision.serverTick,
        workerId: worker.id,
        position: worker.position,
        logicalX: worker.position.x,
        logicalY: worker.position.y,
        state: worker.state,
        visualState: worker.visualState,
        taskId: task?.id ?? null,
        taskKind: task?.kind ?? null,
        taskPhase: task?.phase ?? null,
        currentCell: worker.position,
        nextCell,
        destination: task?.path.at(-1) ?? null,
        workTarget: task?.kind === 'underground-work' ? task.target : null,
        path: task?.path ?? [],
        pathIndex: task?.pathIndex ?? null,
        pathRecalculated: Boolean(task && task.id === previousTaskId && pathSignature !== previousTaskPath),
        taskBlockedReason: task?.blockedReason ?? null,
        job: job ? { id: job.id, kind: job.kind, status: job.status, target: job.target, blockedReason: job.blockedReason } : null,
        ladder: ladder ? { id: ladder.id, state: ladder.state, blockedReason: ladder.blockedReason } : null,
        ladders: state.ladders.map(({ id, state: ladderState, top, bottom, blockedReason }) =>
          ({ id, state: ladderState, top, bottom, blockedReason })),
        plan: state.undergroundPlans[0] ?? null,
        residentTasks: state.residents.map((resident) => ({ id: resident.id, position: resident.position,
          kind: resident.task?.kind ?? null, phase: resident.task?.phase ?? null, visualState: resident.visualState })),
        residentVisuals: state.residentVisuals,
        supportedPosition: worker.position.y <= 0 || state.undergroundCells.some((cell) =>
          cell.position.x === worker.position.x && cell.position.y === worker.position.y &&
          cell.state === 'tunnel' && cell.floorSupported),
        phaser: visual
      });
      previousTaskId = task?.id ?? '';
      previousTaskPath = pathSignature;
    }
  };
  const routeDeadline = Date.now() + 75_000;
  let routeComplete = false;
  while (Date.now() < routeDeadline && !routeComplete) {
    const state = await getWorld();
    recordMovement(state);
    routeComplete = state.undergroundPlans[0]?.state === 'completed' &&
      state.ladders.some((ladder) => ladder.id === 'g6-spare-shaft' && ladder.top.x === 2 && ladder.top.y === 1);
    await page.waitForTimeout(80);
  }
  expect(routeComplete, 'the route excavates, physically relocates the ladder, and completes').toBe(true);

  await expect.poll(async () => {
    const state = await getWorld();
    return state.undergroundCells.find((cell) => cell.position.x === 2 && cell.position.y === 2)?.state === 'tunnel' &&
      state.ladders.some((ladder) => ladder.id === 'g6-spare-shaft' && ladder.state === 'complete' &&
        ladder.top?.x === 2 && ladder.top?.y === 1 && ladder.bottom?.x === 2 && ladder.bottom?.y === 2) &&
      state.undergroundPlans[0]?.state === 'completed';
  }, { timeout: 90_000 }).toBe(true);
  const completedRoute = await getWorld();
  expect(completedRoute.ladders.find((ladder) => ladder.id === 'g6-upper-shaft')?.state).toBe('complete');
  expect(completedRoute.storages[0]?.contents.wood).toBe(12);
  await expect.poll(() => page.locator('#world-scene').evaluate((element, before) =>
    Number((element as HTMLElement).dataset.undergroundTileUpdatesTotal) > before,
  initialUndergroundRender.tileUpdates)).toBe(true);
  const afterRouteRender = await page.locator('#world-scene').evaluate((element) => {
    const root = element as HTMLElement;
    return {
      tileCount: Number(root.dataset.undergroundTileObjectCount),
      tileUpdates: Number(root.dataset.undergroundTileUpdatesTotal),
      geometryUpdates: Number(root.dataset.undergroundGeometryUpdateCount)
    };
  });
  expect(afterRouteRender.tileCount).toBe(initialUndergroundRender.tileCount);
  expect(afterRouteRender.tileUpdates - initialUndergroundRender.tileUpdates).toBeLessThan(initialUndergroundRender.tileCount);
  await page.waitForTimeout(300);
  await expect(page.locator('#world-scene')).toHaveAttribute('data-underground-tile-updates-total',
    String(afterRouteRender.tileUpdates));

  await clickUndergroundCell(3, 2);
  await expect(page.locator('#mine-underground')).toBeVisible();
  const initialWarehouseStone = (await getWorld()).storages[0]?.contents.stone ?? 0;
  await page.locator('#mine-underground').click();
  const rowsBeforeMining = movementTrace.length;
  const miningDeadline = Date.now() + 75_000;
  while (Date.now() < miningDeadline && !movementTrace.slice(rowsBeforeMining).some((row) => row.logicalY === 2)) {
    recordMovement(await getWorld());
    await page.waitForTimeout(80);
  }
  if (testInfo.project.name === 'peace-v2-desktop') {
    const captured = await page.evaluate(() => {
      const captureWindow = window as unknown as {
        __g62DescentFrames?: Array<Record<string, unknown>>;
        __g62ResidentScaleScreenshot?: { image: string; residents: Record<string, unknown>; gridVisible: boolean };
        __g623ResidentAnimationSamples?: Array<Record<string, unknown>>;
      };
      return { frames: captureWindow.__g62DescentFrames ?? [], screenshot: captureWindow.__g62ResidentScaleScreenshot ?? null,
        animations: captureWindow.__g623ResidentAnimationSamples ?? [] };
    });
    residentSceneScreenshot = captured.screenshot;
    for (const [index, frame] of captured.frames.entries()) {
      const framePath = path.join(runDirectory, `g6.2-descent-${index + 1}.png`);
      const image = String(frame.image).split(',')[1] ?? '';
      writeFileSync(framePath, Buffer.from(image, 'base64'));
      climbFrames.push({ path: framePath, logicalX: Number(frame.logicalX), logicalY: Number(frame.logicalY), worldY: Number(frame.worldY),
        targetWorldY: Number(frame.targetWorldY), screenY: Number(frame.screenY), targetScreenY: Number(frame.targetScreenY),
        animation: String(frame.animation), tweenCount: Number(frame.tweenCount), scaleX: Number(frame.scaleX),
        scaleY: Number(frame.scaleY), bodyHeight: Number(frame.bodyHeight), feetY: Number(frame.feetY), angle: Number(frame.angle) });
    }
    if (residentSceneScreenshot) {
      writeFileSync(path.join(runDirectory, 'g6.2.3-resident-scale-desktop.png'),
        Buffer.from(residentSceneScreenshot.image.split(',')[1] ?? '', 'base64'));
    }
  }
  const tracePath = path.join(runDirectory, `g6.2-movement-${testInfo.project.name}.json`);
  writeFileSync(tracePath, JSON.stringify({ rows: movementTrace, climbFrames }, null, 2));
  expect(movementTrace.length, `movement observations are saved to ${tracePath}`).toBeGreaterThanOrEqual(6);
  expect(movementTrace.slice(rowsBeforeMining).some((row) => row.logicalY === 2),
    'worker reaches the second underground level during mining').toBe(true);
  expect(movementTrace.some((row) => row.taskKind === 'underground-work' && row.pathIndex !== null),
    'the movement trace includes the worker route and task target').toBe(true);
  expect(movementTrace.some((row) => row.taskKind === 'underground-work' && row.taskPhase === 'working' &&
    ['excavating', 'mining_underground'].includes(String(row.visualState))),
  'the worker reaches its underground work cell and starts the assigned job').toBe(true);
  expect(movementTrace.every((row) => row.supportedPosition), 'workers never stop on unsupported tunnel cells').toBe(true);
  const relocationSamples = movementTrace.flatMap((row) =>
    (row.residentTasks as Array<{ id: string; position: { x: number; y: number }; kind: string | null; phase: string | null }>)
      .filter((task) => task.kind === 'relocate-ladder'));
  expect(relocationSamples.some((task) => task.phase === 'dismantling') &&
    relocationSamples.some((task) => task.phase === 'installing'),
  'a worker dismantles and reinstalls the existing ladder module').toBe(true);
  expect(new Set(relocationSamples.map((task) => `${task.id}:${task.position.x},${task.position.y}`)).size).toBeGreaterThan(1);
  expect(movementTrace.every((row) => Number((row.phaser as Record<string, string>).TweenCount) <= 1),
    'snapshot refreshes never stack movement tweens').toBe(true);
  for (const row of movementTrace) {
    for (const [id, visual] of Object.entries(row.residentVisuals as Record<string, Record<string, string>>)) {
      expect(Number(visual.BodyHeight), `${id} keeps one height across route/animation states`).toBeCloseTo(46);
      expect(Number(visual.ScaleX), `${id} x scale stays uniform`).toBeCloseTo(Number(visual.ScaleY));
      expect(Number(visual.HitAreaWidth)).toBe(48);
      expect(Number(visual.HitAreaHeight)).toBeCloseTo(46);
    }
  }
  for (let index = 1; index < movementTrace.length; index += 1) {
    const previous = movementTrace[index - 1]!;
    const current = movementTrace[index]!;
    if (previous.taskId === current.taskId && current.pathRecalculated === false && current.pathIndex !== null && previous.pathIndex !== null) {
      expect(current.pathIndex, `path index for ${String(current.taskId)} does not rewind`).toBeGreaterThanOrEqual(previous.pathIndex as number);
    }
  }
  if (testInfo.project.name === 'peace-v2-desktop') {
    expect(climbFrames.length, 'saved screenshots show the actual climbing tween').toBeGreaterThan(0);
    expect(climbFrames.every((frame) => frame.targetWorldY > frame.worldY && Number.isFinite(frame.screenY) &&
      Number.isFinite(frame.targetScreenY) && frame.animation === 'worker-climb' && frame.tweenCount === 1 &&
      Math.abs(frame.bodyHeight - 46) < 0.001 && frame.scaleX === frame.scaleY && frame.angle === 0)).toBe(true);
    expect(residentSceneScreenshot, 'grid screenshot captures surface, tunnel, and a worker mid-climb').not.toBeNull();
    const sceneResidents = residentSceneScreenshot!.residents;
    expect((sceneResidents['worker-1'] as Record<string, string>).TweenKind).toBe('climb');
    expect(Number((sceneResidents['worker-2'] as Record<string, string>).LogicalY)).toBe(0);
    expect(Number((sceneResidents['worker-3'] as Record<string, string>).LogicalY)).toBe(0);
    expect(Number((sceneResidents['worker-1'] as Record<string, string>).Angle)).toBe(0);
    for (const [id, visual] of Object.entries(sceneResidents as Record<string, Record<string, string>>)) {
      expect(Number(visual.BodyHeight), `${id} is the same size in the proof screenshot`).toBeCloseTo(46);
      expect(Number(visual.ScaleX)).toBeCloseTo(Number(visual.ScaleY));
    }
    for (let index = 1; index < climbFrames.length; index += 1) {
      const previous = climbFrames[index - 1]!;
      const current = climbFrames[index]!;
      if (previous.logicalX === current.logicalX && previous.logicalY === current.logicalY &&
          previous.targetWorldY === current.targetWorldY) {
        expect(current.worldY, 'ordinary snapshots retain climb progress instead of restarting the tween')
          .toBeGreaterThan(previous.worldY);
      }
    }
  }
  await expect.poll(async () => (await getWorld()).storages[0]?.contents.stone ?? 0, { timeout: 60_000 })
    .toBeGreaterThan(initialWarehouseStone);
  await page.screenshot({ path: path.join(projectRoot, '.gstack/run', `g6.2-underground-${testInfo.project.name}.png`), fullPage: true });
  const gridButton = page.locator('#toggle-world-grid');
  if (await gridButton.getAttribute('aria-pressed') !== 'true') await gridButton.click();
  await expect(page.locator('#world-scene')).toHaveAttribute('data-world-grid-visible', 'true');
  await page.screenshot({ path: path.join(runDirectory, `g6.2.4-underground-grid-on-${testInfo.project.name}.png`) });
  await gridButton.click();
  await expect(page.locator('#world-scene')).toHaveAttribute('data-world-grid-visible', 'false');
  await page.screenshot({ path: path.join(runDirectory, `g6.2.4-underground-grid-off-${testInfo.project.name}.png`) });
  await gridButton.click();
  const beforeReload = await getWorld();
  for (const resident of beforeReload.residents) {
    const visual = beforeReload.residentVisuals[resident.id] as Record<string, string>;
    expect(Number(visual.BodyHeight), `${resident.id} remains the same size after mining and delivery`).toBeCloseTo(46);
    expect(Number(visual.ScaleX)).toBeCloseTo(Number(visual.ScaleY));
  }
  if (testInfo.project.name === 'peace-v2-desktop') {
    const animationSamples = await page.evaluate(() =>
      (window as unknown as { __g623ResidentAnimationSamples?: Array<Record<string, unknown>> })
        .__g623ResidentAnimationSamples ?? []);
    const observedAnimations = new Set(animationSamples.map((sample) => String(sample.animation)));
    expect([...observedAnimations]).toEqual(expect.arrayContaining([
      'idle', 'worker-walk', 'worker-carry-walk', 'worker-build', 'worker-unload', 'worker-climb'
    ]));
    for (const sample of animationSamples) {
      expect(Number(sample.bodyHeight), `${String(sample.id)} stays one height during ${String(sample.animation)}`).toBeCloseTo(46);
      expect(Number(sample.scaleX)).toBeCloseTo(Number(sample.scaleY));
      expect(Number(sample.angle)).toBe(0);
      if (sample.animation === 'worker-climb') {
        expect(Number(sample.feetY) - Number(sample.bodyTopY)).toBeCloseTo(46);
      }
    }
    writeFileSync(path.join(runDirectory, 'g6.2.3-resident-animation-observations.json'),
      JSON.stringify({ observedAnimations: [...observedAnimations], samples: animationSamples }, null, 2));
    expect(residentSceneScreenshot?.gridVisible).toBe(true);
  }
  const workerBeforeReload = beforeReload.residents.find((resident) => resident.id === 'worker-1');
  await page.reload();
  await expect(page.locator('#world-scene canvas')).toBeVisible();
  await expect.poll(() => page.locator('#world-scene').evaluate((element, residentIds) => {
    const root = element as HTMLElement;
    return residentIds.every((id) => root.dataset[`resident${id.replace(/[^a-zA-Z0-9]/g, '')}BodyHeight`] !== undefined);
  }, beforeReload.residents.map((resident) => resident.id)), { timeout: 15_000 })
    .toBe(true);
  const persisted = await getWorld();
  const workerAfterReload = persisted.residents.find((resident) => resident.id === 'worker-1');
  for (const resident of persisted.residents) {
    const visual = persisted.residentVisuals[resident.id] as Record<string, string>;
    expect(Number(visual.BodyHeight), `${resident.id} retains its scale after reload`).toBeCloseTo(46);
    expect(Number(visual.ScaleX)).toBeCloseTo(Number(visual.ScaleY));
  }
  expect(persisted.ladders[0]?.state).toBe('complete');
  expect(persisted.undergroundDeposits.find((deposit) => deposit.id === 'g6-stone-seam')?.remaining).toBeLessThan(12);
  expect(workerAfterReload?.position).toEqual(workerBeforeReload?.position);
  expect(workerAfterReload?.position.y).toBeGreaterThan(0);
  if (workerBeforeReload?.task && workerAfterReload?.task) {
    expect(workerAfterReload.task.id).toBe(workerBeforeReload.task.id);
  }
});
