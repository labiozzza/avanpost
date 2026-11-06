import { expect, test, type Page } from '@playwright/test';
import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const apiPort = 18938;
const handoffPort = 18939;
const clientPort = 14224;
const sourceSnapshot = process.env.AVANPOST_V2_FIX02A_SNAPSHOT;
const cli = path.resolve('node_modules/tsx/dist/cli.mjs');
const restoreCli = 'apps/server-v2/src/cli/restore-fix02a-snapshot.ts';

async function world(page: Page): Promise<any> {
  const response = await page.request.get('/api/world');
  expect(response.ok()).toBeTruthy();
  return response.json();
}

function restore(snapshot: string): void {
  execFileSync(process.execPath, [cli, restoreCli, snapshot], {
    cwd: process.cwd(), env: { ...process.env, AVANPOST_V2_FIX02A_INITIAL_DELAY_MS: '15000' }, stdio: 'pipe'
  });
}

async function tapGroundCell(page: Page, anchorX: number): Promise<void> {
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
        const sx = input.left + x; const sy = input.top + y;
        if (x >= 8 && x < input.width - 8 && y >= 8 && y < input.height - 8 &&
            document.elementFromPoint(sx, sy)?.tagName.toLowerCase() === 'canvas') return { x, y };
      }
    }
    throw new Error(`No unobscured ground cell is visible near anchor ${input.anchorX}.`);
  }, { anchorX, width: box.width, height: box.height, left: box.x, top: box.y });
  if ((page.viewportSize()?.width ?? 1440) <= 650) await page.touchscreen.tap(box.x + point.x, box.y + point.y);
  else await page.mouse.click(box.x + point.x, box.y + point.y);
}

async function startSchoolPlacement(page: Page, school: string, anchorX: number): Promise<void> {
  await page.locator('#camera-home').click();
  await tapGroundCell(page, anchorX);
  await expect(page.locator('#building-catalog')).toBeVisible();
  await page.locator(`#school-${school}-catalog-item`).click();
  await tapGroundCell(page, anchorX);
  await expect(page.locator('#placement-panel')).toBeVisible();
  await expect(page.locator('#placement-reason')).not.toHaveText('Проверяем участок…');
}

test('FIX-02B visual bounds block overlap while preserving existing placements and builder paths', async ({ page }, info) => {
  test.setTimeout(600_000);
  test.skip(!['geometry-desktop', 'geometry-mobile'].includes(info.project.name), 'Runs only in configured geometry viewports.');
  if (!sourceSnapshot) throw new Error('AVANPOST_V2_FIX02A_SNAPSHOT must point to the isolated source snapshot.');
  let apiProcess: ChildProcess | undefined;
  const apiOutput: string[] = [];
  try {
    const pidFile = path.resolve('.gstack/run/peace-v2-api-fix02a.pid');
    if (existsSync(pidFile)) {
      execFileSync(process.execPath, [cli, 'apps/server-v2/src/cli/stop.ts'], { cwd: process.cwd(), env: process.env, stdio: 'pipe' });
    }
    restore(sourceSnapshot);
    await page.goto(`http://127.0.0.1:${clientPort}/`);
    await expect(page.locator('#world-scene canvas')).toBeVisible();
    apiProcess = spawn(process.execPath, [cli, 'apps/server-v2/src/cli/dev.ts'], {
      cwd: process.cwd(), env: process.env, stdio: ['ignore', 'pipe', 'pipe']
    });
    apiProcess.stdout?.on('data', (chunk: Buffer) => apiOutput.push(chunk.toString()));
    apiProcess.stderr?.on('data', (chunk: Buffer) => apiOutput.push(chunk.toString()));
    await expect.poll(async () => {
      try {
        const response = await page.request.get(`http://127.0.0.1:${apiPort}/api/health`);
        return response.ok() && (await response.json() as { database?: string }).database === 'avanpost_v2_g7_2_fix02a_test';
      } catch { return false; }
    }, { timeout: 30_000 }).toBe(true);
    const panelBeforePair = page.locator('#pairing-panel');
    if (!await panelBeforePair.evaluate((element) => (element as HTMLDetailsElement).open)) await panelBeforePair.locator('summary').click();
    const initialCode = await page.evaluate(async (port) => {
      const response = await fetch(`http://127.0.0.1:${port}/api/launcher/pairing-code`);
      if (!response.ok) throw new Error(`Pairing handoff returned ${response.status}`);
      return (await response.json() as { code: string }).code;
    }, handoffPort);
    await page.locator('#pairing-input').fill(initialCode);
    await page.locator('#pair-button').click();
    await expect(page.locator('#pairing-summary')).toHaveText('Мир подключён к этому браузеру');
    const initial = await world(page);
    const initialAnchors = initial.buildings.map((building: any) => ({ id: building.id, anchor: building.anchor }));
    expect(initialAnchors).toContainEqual({ id: 'cabin-03ae12f6-d936-4c54-9431-c728267f1a2c', anchor: { x: -9, y: -1 } });
    expect(initialAnchors).toContainEqual({ id: 'workshop-12005a8b-af80-4d2f-8550-49bca9119c3e', anchor: { x: -2, y: -1 } });
    await page.screenshot({ path: info.outputPath('00-legacy-save-unchanged.png'), fullPage: true });

    const snapshot = structuredClone(JSON.parse(await readFile(sourceSnapshot, 'utf8')));
    const house = snapshot.buildings.find((building: any) => building.kind === 'cabin' && building.state === 'complete');
    const workshop = snapshot.buildings.find((building: any) => building.kind === 'workshop' && building.state === 'complete');
    if (!house || !workshop) throw new Error('Geometry fixture requires a complete house and workshop.');
    snapshot.buildings = [house, workshop];
    snapshot.trees = snapshot.trees.filter((tree: any) => tree.position.x !== 16);
    const isMobile = (page.viewportSize()?.width ?? 1440) <= 650;
    house.anchor = { x: isMobile ? -10 : -20, y: -1 }; delete house.entrance; delete house.workPoint;
    workshop.anchor = { x: 4, y: -1 }; delete workshop.entrance; delete workshop.workPoint;
    snapshot.buildOrders = snapshot.buildOrders.filter((order: any) => [house.id, workshop.id].includes(order.buildingId));
    const warehouse = snapshot.storages[0];
    warehouse.anchor = { x: 22, y: -1 };
    warehouse.capacity = 300;
    warehouse.contents = { wood: 180, stone: 100 };
    warehouse.reservedInbound = { wood: 0, stone: 0 };
    warehouse.reservedOutbound = { wood: 0, stone: 0 };
    snapshot.storage.anchor = warehouse.anchor;
    snapshot.storage.id = warehouse.id;
    snapshot.storage.capacity = warehouse.capacity;
    snapshot.resources = { wood: 180, stone: 100 };
    snapshot.clearingJobs = [];
    snapshot.residents = snapshot.residents.map((resident: any) => ({
      ...resident, task: null, state: 'idle', visualState: 'idle', blockedReason: null,
      cargo: 0, cargoItemId: null,
      ...(resident.id === 'worker-3' ? {
        workRole: 'builder', civilianProfession: 'master_builder', position: { x: 20, y: 0 }, facing: 'left'
      } : {})
    }));
    snapshot.revision.geometryVersion += 1;
    const fixturePath = info.outputPath('fix02b-disposable-fixture.json');
    await writeFile(fixturePath, JSON.stringify(snapshot));
    restore(fixturePath);
    await page.reload();
    await expect(page.locator('#world-scene canvas')).toBeVisible();
    const panel = page.locator('#pairing-panel');
    if (!await panel.evaluate((element) => (element as HTMLDetailsElement).open)) await panel.locator('summary').click();
    const code = await page.evaluate(async (port) => {
      const response = await fetch(`http://127.0.0.1:${port}/api/launcher/pairing-code`);
      if (!response.ok) throw new Error(`Pairing handoff returned ${response.status}`);
      return (await response.json() as { code: string }).code;
    }, handoffPort);
    expect(code).toBeTruthy();
    await page.locator('#pairing-input').fill(code);
    await page.locator('#pair-button').click();
    await expect(page.locator('#pairing-summary')).toHaveText('Мир подключён к этому браузеру');
    await expect.poll(async () => (await world(page)).buildings.length).toBe(2);

    await startSchoolPlacement(page, 'extraction', isMobile ? -10 : -18);
    await expect(page.locator('#confirm-placement')).toBeDisabled();
    await expect(page.locator('#placement-reason')).toContainText('визуально');
    await page.screenshot({ path: info.outputPath('01-overlap-rejected.png'), fullPage: true });
    await tapGroundCell(page, isMobile ? -6 : -14);
    await expect.poll(async () => ({
      valid: await page.locator('#placement-reason').getAttribute('data-valid'),
      reason: await page.locator('#placement-reason').innerText(),
      anchorX: await page.locator('#world-scene').getAttribute('data-placement-anchor-x')
    }), { message: 'Allowed-site tap should move the preview away from the legacy house.' }).toEqual(
      expect.objectContaining({ valid: 'true' })
    );
    await expect(page.locator('#confirm-placement')).toBeEnabled();
    await expect(page.locator('#placement-reason')).toContainText('Место подходит');
    await page.screenshot({ path: info.outputPath('02-house-school-allowed-preview.png'), fullPage: true });
    await page.locator('#confirm-placement').click();
    let builderWorked = false;
    let builderMoved = false;
    const firstBuilderStart = (await world(page)).residents.find((resident: any) => resident.id === 'worker-3')?.position;
    await expect.poll(async () => {
      const current = await world(page);
      const resident = current.residents.find((entry: any) => entry.id === 'worker-3');
      const order = current.buildOrders.find((entry: any) => current.buildings.find((building: any) =>
        building.orderId === entry.id && building.kind === 'school-extraction'));
      builderWorked ||= resident?.task?.kind === 'build-workshop' &&
        (resident.task.phase === 'walking_to_build' || resident.task.phase === 'building');
      builderMoved ||= Boolean(firstBuilderStart && resident?.position.x !== firstBuilderStart.x);
      return Boolean(order && order.assignedResidentId === 'worker-3' && builderWorked);
    }, { timeout: 30_000, intervals: [300] }).toBe(true);
    await expect.poll(async () => (await world(page)).buildings.find((building: any) =>
      building.kind === 'school-extraction')?.state, { timeout: 120_000 }).toBe('complete');
    expect(builderMoved).toBe(true);
    await page.screenshot({ path: info.outputPath('03-school-extraction-near-house.png'), fullPage: true });

    if ((page.viewportSize()?.width ?? 1440) <= 650) {
      await page.reload();
      await expect(page.locator('#world-scene canvas')).toBeVisible();
      const mobileReload = await world(page);
      expect(mobileReload.buildings.filter((building: any) => building.kind === 'school-extraction'))
        .toHaveLength(1);
      expect(mobileReload.buildings.find((building: any) => building.id === house.id)?.anchor).toEqual({ x: -10, y: -1 });
      await page.screenshot({ path: info.outputPath('05-after-reload.png'), fullPage: true });
      expect(apiProcess.exitCode).toBeNull();
      return;
    }

    await startSchoolPlacement(page, 'crafts', -8);
    await expect(page.locator('#confirm-placement')).toBeEnabled({ timeout: 20_000 });
    await page.locator('#confirm-placement').click();
    await expect.poll(async () => (await world(page)).buildings.find((building: any) =>
      building.kind === 'school-crafts')?.state, { timeout: 120_000 }).toBe('complete');
    await page.screenshot({ path: info.outputPath('04-two-neighbouring-schools.png'), fullPage: true });

    await startSchoolPlacement(page, 'logistics', -2);
    await expect(page.locator('#confirm-placement')).toBeEnabled({ timeout: 20_000 });
    await page.locator('#confirm-placement').click();
    await expect.poll(async () => (await world(page)).buildings.find((building: any) =>
      building.kind === 'school-logistics')?.state, { timeout: 120_000 }).toBe('complete');
    await page.screenshot({ path: info.outputPath('05-school-logistics-near-workshop.png'), fullPage: true });

    await startSchoolPlacement(page, 'sciences', 16);
    await expect(page.locator('#confirm-placement')).toBeEnabled({ timeout: 20_000 });
    await page.locator('#confirm-placement').click();
    await expect.poll(async () => (await world(page)).buildings.find((building: any) =>
      building.kind === 'school-sciences')?.state, { timeout: 120_000 }).toBe('complete');
    await page.screenshot({ path: info.outputPath('06-school-sciences-near-storage.png'), fullPage: true });
    const built = await world(page);
    const builder = built.residents.find((resident: any) => resident.id === 'worker-3');
    expect(builder).toMatchObject({ workRole: 'builder', civilianProfession: 'master_builder' });
    expect(built.buildOrders.filter((order: any) => built.buildings.some((building: any) =>
      building.orderId === order.id && building.kind.startsWith('school-'))).every((order: any) => order.status === 'completed')).toBe(true);
    await page.screenshot({ path: info.outputPath('03-four-schools-and-building-neighbours.png'), fullPage: true });
    await page.mouse.move(300, 300);
    await page.mouse.down();
    await page.mouse.move(460, 300, { steps: 8 });
    await page.mouse.up();
    await page.locator('#zoom-in').click();
    await page.locator('#camera-home').click();
    await page.screenshot({ path: info.outputPath('04-camera-zoom-and-pan.png'), fullPage: true });
    await page.reload();
    await expect(page.locator('#world-scene canvas')).toBeVisible();
    const afterReload = await world(page);
    expect(afterReload.buildings.filter((building: any) => building.kind.startsWith('school-')))
      .toHaveLength(4);
    expect(afterReload.buildings.filter((building: any) => building.kind.startsWith('school-'))
      .every((building: any) => building.state === 'complete')).toBe(true);
    expect(afterReload.buildings.find((building: any) => building.id === house.id)?.anchor).toEqual({ x: -20, y: -1 });
    expect(afterReload.buildings.find((building: any) => building.id === workshop.id)?.anchor).toEqual({ x: 4, y: -1 });
    await page.screenshot({ path: info.outputPath('05-after-reload.png'), fullPage: true });
    expect(apiProcess.exitCode).toBeNull();
  } catch (error) {
    throw new Error(`${String(error)}\nDisposable API output: ${apiOutput.join('') || '(empty)'}`);
  } finally {
    if (apiProcess && apiProcess.exitCode === null) apiProcess.kill('SIGTERM');
  }
});
