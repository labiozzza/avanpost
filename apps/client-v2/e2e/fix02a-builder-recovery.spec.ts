import { expect, test } from '@playwright/test';
import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';

const handoffPort = Number(process.env.AVANPOST_V2_FIX02A_HANDOFF_PORT ?? 18939);
const buildingId = 'school-crafts-2ebd198c-dc79-4577-bafc-f0750f4387e6';
const orderId = 'order-2ebd198c-dc79-4577-bafc-f0750f4387e6';

async function world(page: import('@playwright/test').Page): Promise<any> {
  const response = await page.request.get('/api/world');
  expect(response.ok()).toBeTruthy();
  return response.json();
}

test('FIX-02A: resumes Arina from stale stump clearing and completes the queued school', async ({ page }, info) => {
  test.setTimeout(90_000);
  let apiProcess: ChildProcess | undefined;
  const apiOutput: string[] = [];
  try {
  await page.goto('http://127.0.0.1:14224/');
  await expect(page.locator('#world-scene canvas')).toBeVisible();
  const pairingPanel = page.locator('#pairing-panel');
  if (!await pairingPanel.evaluate((element) => (element as HTMLDetailsElement).open)) {
    await pairingPanel.locator('summary').click();
  }
  const snapshotPath = process.env.AVANPOST_V2_FIX02A_SNAPSHOT;
  if (!snapshotPath) throw new Error('AVANPOST_V2_FIX02A_SNAPSHOT must point to the FIX-02A source snapshot.');
  const runtimePidFile = path.resolve('.gstack/run/peace-v2-api-fix02a.pid');
  if (existsSync(runtimePidFile)) {
    execFileSync(process.execPath, [path.resolve('node_modules/tsx/dist/cli.mjs'), 'apps/server-v2/src/cli/stop.ts'], {
      cwd: process.cwd(), env: process.env, stdio: 'pipe'
    });
  }
  // Restore immediately before booting the ticker. This test-only reset is
  // guarded by the restore CLI to the disposable FIX-02A database.
  execFileSync(process.execPath, [path.resolve('node_modules/tsx/dist/cli.mjs'),
    'apps/server-v2/src/cli/restore-fix02a-snapshot.ts', snapshotPath], {
    cwd: process.cwd(), env: process.env, stdio: 'pipe'
  });
  // The Phaser client and Chromium are ready before the API starts ticking.
  apiProcess = spawn(process.execPath, [path.resolve('node_modules/tsx/dist/cli.mjs'), 'apps/server-v2/src/cli/dev.ts'], {
    cwd: process.cwd(), env: process.env, stdio: ['ignore', 'pipe', 'pipe']
  });
  apiProcess.stdout?.on('data', (chunk: Buffer) => apiOutput.push(chunk.toString()));
  apiProcess.stderr?.on('data', (chunk: Buffer) => apiOutput.push(chunk.toString()));
  try {
    await expect.poll(async () => {
      try {
        if (apiProcess?.exitCode !== null) throw new Error(`API process exited: ${apiOutput.join('')}`);
        const response = await page.request.get('http://127.0.0.1:18938/api/health');
        return response.ok() && (await response.json() as { database?: string }).database === 'avanpost_v2_g7_2_fix02a_test';
      } catch { return false; }
    }, { timeout: 30_000, intervals: [100] }).toBe(true);
  } catch (error) {
    throw new Error(`Disposable API did not become ready. Output: ${apiOutput.join('') || '(empty)'}\n${String(error)}`);
  }
  expect(apiProcess.exitCode).toBeNull();
  const code = await page.evaluate(async (port) => {
    const response = await fetch(`http://127.0.0.1:${port}/api/launcher/pairing-code`);
    if (!response.ok) throw new Error(`Pairing handoff returned ${response.status}`);
    return (await response.json() as { code: string }).code;
  }, handoffPort);
  await expect(page.locator('#pairing-input')).toBeVisible();
  await page.locator('#pairing-input').fill(code);
  await page.locator('#pair-button').click();
  await expect(page.locator('#pairing-summary')).toHaveText('Мир подключён к этому браузеру');

  const initial = await world(page);
  const arina = initial.residents.find((resident: any) => resident.id === 'worker-3');
  expect(arina).toMatchObject({ civilianProfession: 'master_builder', workRole: 'builder' });
  expect(arina.task).toMatchObject({ kind: 'clear-cell', phase: 'blocked', blockedReason: 'CLEARING_OUTPUT_UNAVAILABLE' });
  expect(initial.buildOrders.find((order: any) => order.id === orderId)?.status).toBe('waiting_builder');
  expect(['waiting_builder', 'scaffold']).toContain(initial.buildings.find((building: any) => building.id === buildingId)?.state);
  expect(initial.trees.find((tree: any) => tree.id === 'tree-1-0-28')).toMatchObject({ remaining: 0 });
  await page.screenshot({ path: info.outputPath('01-arina-before-work.png'), fullPage: true });

  const observedPositions: Array<{ x: number; y: number }> = [arina.position];
  const observedStates: Array<Record<string, unknown>> = [{ tick: initial.revision.serverTick,
    position: arina.position, taskKind: arina.task?.kind, taskPhase: arina.task?.phase,
    taskBlockedReason: arina.task?.blockedReason,
    orderStatus: initial.buildOrders.find((entry: any) => entry.id === orderId)?.status,
    assignedResidentId: initial.buildOrders.find((entry: any) => entry.id === orderId)?.assignedResidentId,
    buildingState: initial.buildings.find((entry: any) => entry.id === buildingId)?.state,
    buildProgress: initial.buildings.find((entry: any) => entry.id === buildingId)?.progressTicks }];
  let reachedSite = arina.task?.kind === 'build-workshop' && arina.task.phase === 'building';
  let sawArinaBuildTask = arina.task?.kind === 'build-workshop' && arina.task.buildingId === buildingId;
  let sawArinaAssignedOrder = initial.buildOrders.find((entry: any) => entry.id === orderId)?.assignedResidentId === 'worker-3';
  let sawArinaBuildProgress = sawArinaAssignedOrder && initial.buildings.find((entry: any) => entry.id === buildingId)?.progressTicks > 0;
  let capturedOnRoute = false;
  await expect.poll(async () => {
    const snapshot = await world(page);
    const resident = snapshot.residents.find((entry: any) => entry.id === 'worker-3');
    const order = snapshot.buildOrders.find((entry: any) => entry.id === orderId);
    const building = snapshot.buildings.find((entry: any) => entry.id === buildingId);
    const stump = snapshot.trees.find((entry: any) => entry.id === 'tree-1-0-28');
    if (resident?.position) observedPositions.push(resident.position);
    observedStates.push({
      tick: snapshot.revision.serverTick, position: resident?.position,
      taskKind: resident?.task?.kind, taskPhase: resident?.task?.phase,
      taskBuildingId: resident?.task?.buildingId, taskBlockedReason: resident?.task?.blockedReason,
      orderStatus: order?.status, assignedResidentId: order?.assignedResidentId,
      buildingState: building?.state, buildProgress: building?.progressTicks
    });
    sawArinaBuildTask ||= resident?.task?.kind === 'build-workshop' && resident.task.buildingId === buildingId;
    sawArinaAssignedOrder ||= order?.assignedResidentId === 'worker-3';
    sawArinaBuildProgress ||= order?.assignedResidentId === 'worker-3' && (building?.progressTicks ?? 0) > 0;
    if (resident?.task?.kind === 'build-workshop' && resident.task.phase === 'building') {
      reachedSite = true;
      if (!capturedOnRoute) {
        await page.screenshot({ path: info.outputPath('02-arina-at-worksite.png'), fullPage: true });
        capturedOnRoute = true;
      }
    }
    expect(stump?.remaining).toBe(0);
    expect(['stump', 'uprooted']).toContain(stump?.state);
    expect(stump?.bufferQuantity).toBe(0);
    return order?.status === 'completed' && building?.state === 'complete';
  }, { timeout: 60_000, intervals: [250] }).toBe(true);

  const final = await world(page);
  const finalArina = final.residents.find((resident: any) => resident.id === 'worker-3');
  const finalBuilding = final.buildings.find((building: any) => building.id === buildingId);
  expect(finalBuilding).toMatchObject({ state: 'complete', progressTicks: 10, progressRequired: 10 });
  expect(final.buildOrders.find((order: any) => order.id === orderId)).toMatchObject({ status: 'completed', assignedResidentId: null });
  const evidence = JSON.stringify({ initial: { tick: initial.revision.serverTick, arina,
    order: initial.buildOrders.find((order: any) => order.id === orderId) }, final: { finalArina, finalBuilding }, observedStates });
  expect(sawArinaBuildTask, evidence).toBe(true);
  expect(sawArinaAssignedOrder, evidence).toBe(true);
  expect(sawArinaBuildProgress, evidence).toBe(true);
  expect(observedPositions.some((position) => position.x !== 27), evidence).toBe(true);
  expect(reachedSite, evidence).toBe(true);
  await page.screenshot({ path: info.outputPath('02-school-complete.png'), fullPage: true });
  await page.reload();
  const persisted = await world(page);
  expect(persisted.buildings.find((building: any) => building.id === buildingId)).toMatchObject({ state: 'complete', progressTicks: 10 });
  expect(persisted.trees.find((tree: any) => tree.id === 'tree-1-0-28')).toMatchObject({ remaining: 0, bufferQuantity: 0 });
  expect(persisted.residents.find((resident: any) => resident.id === 'worker-3'))
    .toMatchObject({ civilianProfession: 'master_builder', workRole: 'builder' });
  await page.screenshot({ path: info.outputPath('03-after-reload.png'), fullPage: true });
  } finally {
    if (apiProcess?.exitCode === null) {
      apiProcess.kill('SIGTERM');
      await new Promise<void>((resolve) => apiProcess?.once('exit', () => resolve()));
    }
  }
});
