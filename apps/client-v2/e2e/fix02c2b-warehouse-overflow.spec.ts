import { mkdir, writeFile } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';

const mainHandoffPort = Number(process.env.AVANPOST_V2_TEST_HANDOFF_PORT ?? 19959);
const competitionClient = process.env.FIX02C2B_COMPETITION_URL ?? 'http://127.0.0.1:14275/';
const competitionHandoffPort = Number(process.env.AVANPOST_V2_COMP_HANDOFF_PORT ?? 19969);

async function connect(page: Page, url: string, handoffPort: number): Promise<void> {
  await page.goto(url);
  await expect(page.locator('#world-scene canvas')).toBeVisible();
  const code = await page.evaluate(async (port) => {
    const response = await fetch(`http://127.0.0.1:${port}/api/launcher/pairing-code`);
    if (!response.ok) throw new Error(`Pairing handoff returned ${response.status}`);
    return (await response.json() as { code: string }).code;
  }, handoffPort);
  await page.locator('#pairing-panel').evaluate((element) => { (element as HTMLDetailsElement).open = true; });
  await page.locator('#pairing-input').fill(code);
  await page.locator('#pair-button').click();
  await expect(page.locator('#pairing-summary')).toHaveText('Мир подключён к этому браузеру');
}

async function world(page: Page): Promise<any> {
  return page.evaluate(async () => {
    const response = await fetch('/api/world', { cache: 'no-store' });
    if (!response.ok) throw new Error(`World API returned ${response.status}`);
    return response.json();
  });
}

async function selectResident(page: Page, residentId: string): Promise<void> {
  const panel = page.locator('#population-panel');
  if (!(await panel.evaluate((element) => (element as HTMLDetailsElement).open))) {
    await panel.locator(':scope > summary').click();
  }
  const index = (await world(page)).residents.findIndex((resident: any) => resident.id === residentId);
  if (index < 0) throw new Error(`Unknown resident ${residentId}`);
  await page.locator('#population-registry button').nth(index).click();
}

async function setRole(page: Page, residentId: string, name: string, role: string): Promise<void> {
  await selectResident(page, residentId);
  await page.locator('#resident-work-role').selectOption(role);
  await expect.poll(async () => (await world(page)).residents.find((resident: any) => resident.id === residentId)?.workRole,
    { timeout: 10_000 }).toBe(role);
  await page.locator('#close-context').click();
}

async function inspectStorage(page: Page, index: number, title: string, stock: RegExp): Promise<void> {
  const canvas = page.locator('#world-scene canvas');
  const box = await canvas.boundingBox();
  if (!box) throw new Error('Game canvas is not visible.');
  const point = await page.locator('#world-scene').evaluate((element, storageIndex) => {
    const data = (element as HTMLElement).dataset;
    return { x: Number(data[`storage${storageIndex}CanvasX`]), y: Number(data[`storage${storageIndex}CanvasY`]) };
  }, index);
  await page.mouse.click(box.x + point.x, box.y + point.y);
  await expect(page.locator('#inspector-title')).toHaveText(title);
  await expect(page.locator('#inspector-detail')).toContainText(stock);
  await page.locator('#close-context').click();
}

test('FIX-02C.2B A/B: harvested wood and stone physically unload at warehouse B', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === 'fix02c2b-mobile', 'Stateful resource delivery flow runs once on desktop Chromium.');
  test.setTimeout(240_000);
  const evidence: any[] = [];
  const capture = async (moment: string, knownSnapshot?: any) => {
    const snapshot = knownSnapshot ?? await world(page);
    evidence.push({ moment, tick: snapshot.revision.serverTick,
      storages: snapshot.storages.map((storage: any) => ({ id: storage.id, contents: storage.contents,
        reservedInbound: storage.reservedInbound, reservedOutbound: storage.reservedOutbound })),
      treeBuffer: snapshot.trees.map((tree: any) => ({ id: tree.id, bufferQuantity: tree.bufferQuantity, reservedBuffer: tree.reservedBuffer })),
      stoneBuffers: snapshot.stoneDeposits.map((deposit: any) => ({ id: deposit.id, bufferQuantity: deposit.bufferQuantity, reservedBuffer: deposit.reservedBuffer })),
      residents: snapshot.residents.map((resident: any) => ({ id: resident.id, workRole: resident.workRole,
        position: resident.position, cargo: resident.cargo, cargoItemId: resident.cargoItemId, task: resident.task })) });
    await page.screenshot({ path: testInfo.outputPath(`${moment}.png`), fullPage: true });
    return snapshot;
  };
  const waitForCarrierCargo = async (itemId: 'wood' | 'stone') => {
    let carryingSnapshot: any;
    await expect.poll(async () => {
      const snapshot = await world(page);
      const carrier = snapshot.residents.find((resident: any) => resident.id === 'worker-3');
      if (carrier?.cargo > 0 && carrier.cargoItemId === itemId) carryingSnapshot = snapshot;
      return carrier?.cargo > 0 && carrier.cargoItemId === itemId;
    }, { timeout: 15_000, intervals: [10, 20, 50] }).toBe(true);
    const carrying = await capture(`carrying-${itemId}`, carryingSnapshot);
    const carrier = carrying.residents.find((resident: any) => resident.id === 'worker-3');
    expect(carrier.cargo).toBeGreaterThan(0);
    expect(carrier.task).toMatchObject({ kind: 'haul', destinationKind: 'storage', destinationId: 'storehouse-2', itemId });
  };
  const waitForDelivery = async (itemId: 'wood' | 'stone', before: number) => {
    await expect.poll(async () => (await world(page)).storages.find((storage: any) => storage.id === 'storehouse-2')?.contents[itemId],
      { timeout: 90_000, intervals: [50, 100, 250] }).toBeGreaterThan(before);
    const delivered = await capture(`delivered-${itemId}`);
    expect(delivered.storages[0].contents.wood).toBe(16);
    expect(delivered.storages[0].contents.stone).toBe(0);
    const expectedInbound = delivered.residents.reduce((sum: number, resident: any) => sum +
      (resident.task?.kind === 'haul' && resident.task.destinationId === 'storehouse-2' && resident.task.itemId === itemId
        ? resident.task.quantity : 0), 0);
    const expectedOutbound = delivered.residents.reduce((sum: number, resident: any) => sum +
      (resident.task?.kind === 'haul' && resident.task.sourceKind === 'storage' && resident.task.sourceId === 'storehouse-2' && resident.task.itemId === itemId
        ? resident.task.quantity : 0), 0);
    expect(delivered.storages[1].reservedInbound[itemId]).toBe(expectedInbound);
    expect(delivered.storages[1].reservedOutbound[itemId]).toBe(expectedOutbound);
    expect(delivered.storages[0].reservedInbound[itemId]).toBe(0);
    return delivered;
  };

  await connect(page, process.env.PEACE_V2_FIX02C2B_URL ?? 'http://127.0.0.1:14265/', mainHandoffPort);
  const initial = await capture('before-resource-orders');
  expect(initial.storages).toHaveLength(2);
  expect(initial.storages[0]).toMatchObject({ contents: { wood: 16, stone: 0 }, status: 'full' });
  expect(initial.storages[1]).toMatchObject({ contents: { wood: 0, stone: 0 }, status: 'available' });
  expect(initial.residents.every((resident: any) => resident.task === null && resident.cargo === 0)).toBe(true);
  await inspectStorage(page, 0, 'Главный склад', /16 дерева · 0 камня/);
  await inspectStorage(page, 1, 'Восточный склад', /0 дерева · 0 камня/);

  await setRole(page, 'worker-1', 'Илья', 'woodcutter');
  await expect.poll(async () => {
    const snapshot = await world(page);
    return snapshot.residents.find((resident: any) => resident.id === 'worker-3')?.task?.destinationId;
  }, { timeout: 60_000, intervals: [50, 100, 250] }).toBe('storehouse-2');
  const woodTask = await capture('wood-haul-assigned');
  expect(woodTask.residents.find((resident: any) => resident.id === 'worker-3')?.task).toMatchObject({
    kind: 'haul', destinationId: 'storehouse-2', itemId: 'wood'
  });
  await waitForCarrierCargo('wood');
  const woodDelivered = await waitForDelivery('wood', 0);
  expect(woodDelivered.storages[1].contents.wood).toBeGreaterThan(0);
  await setRole(page, 'worker-1', 'Илья', 'none');

  await setRole(page, 'worker-2', 'Марья', 'stone_miner');
  await expect.poll(async () => {
    const snapshot = await world(page);
    const task = snapshot.residents.find((resident: any) => resident.id === 'worker-3')?.task;
    return task?.itemId === 'stone' && task.destinationId === 'storehouse-2';
  }, { timeout: 90_000, intervals: [50, 100, 250] }).toBe(true);
  const stoneTask = await capture('stone-haul-assigned');
  expect(stoneTask.residents.find((resident: any) => resident.id === 'worker-3')?.task).toMatchObject({
    kind: 'haul', destinationId: 'storehouse-2', itemId: 'stone'
  });
  await waitForCarrierCargo('stone');
  const stoneDelivered = await waitForDelivery('stone', 0);
  expect(stoneDelivered.storages[1].contents.stone).toBeGreaterThan(0);
  await setRole(page, 'worker-2', 'Марья', 'none');

  await mkdir(testInfo.outputDir, { recursive: true });
  await writeFile(testInfo.outputPath('resource-balance.json'), JSON.stringify(evidence, null, 2));
});

test('FIX-02C.2B C: two haulers cannot reserve the final warehouse slot twice', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === 'fix02c2b-mobile', 'Stateful competition flow runs once on desktop Chromium.');
  test.setTimeout(120_000);
  const evidence: any[] = [];
  const capture = async (moment: string) => {
    const snapshot = await world(page);
    evidence.push({ moment, tick: snapshot.revision.serverTick,
      storages: snapshot.storages.map((storage: any) => ({ id: storage.id, capacity: storage.capacity,
        contents: storage.contents, reservedInbound: storage.reservedInbound, reservedOutbound: storage.reservedOutbound })),
      tree: snapshot.trees.find((tree: any) => tree.id === 'tree-1') && (({ id, bufferQuantity, reservedBuffer }: any) => ({ id, bufferQuantity, reservedBuffer }))(snapshot.trees.find((tree: any) => tree.id === 'tree-1')),
      residents: snapshot.residents.map((resident: any) => ({ id: resident.id, workRole: resident.workRole, position: resident.position,
        cargo: resident.cargo, cargoItemId: resident.cargoItemId, task: resident.task })) });
    await page.screenshot({ path: testInfo.outputPath(`${moment}.png`), fullPage: true });
    return snapshot;
  };
  await connect(page, competitionClient, competitionHandoffPort);
  const initial = await capture('competition-before-dispatch');
  expect(initial.storages[0].contents.wood).toBe(16);
  expect(initial.storages[1]).toMatchObject({ capacity: 10, contents: { wood: 9, stone: 0 } });
  expect(initial.storages[1].reservedInbound.wood).toBe(0);
  expect(initial.trees[0]).toMatchObject({ bufferQuantity: 2, reservedBuffer: 0 });
  expect(initial.residents.every((resident: any) => resident.task === null && resident.cargo === 0)).toBe(true);

  await setRole(page, 'worker-3', 'Илья', 'hauler');
  await expect.poll(async () => (await world(page)).storages[1].reservedInbound.wood,
    { timeout: 15_000, intervals: [50, 100, 250] }).toBe(1);
  const firstReservation = await capture('competition-first-hauler-reserved');
  expect(firstReservation.residents.filter((resident: any) => resident.task?.kind === 'haul' &&
    resident.task.destinationId === 'storehouse-2')).toHaveLength(1);
  expect(firstReservation.storages[1].reservedInbound.wood).toBe(1);
  expect(firstReservation.storages[1].contents.wood + firstReservation.storages[1].reservedInbound.wood).toBe(10);
  await setRole(page, 'worker-4', 'Лада', 'hauler');
  const reserved = await capture('competition-one-slot-reserved');
  const activeHauls = reserved.residents.filter((resident: any) => resident.task?.kind === 'haul' && resident.task.destinationId === 'storehouse-2');
  expect(activeHauls.length).toBeLessThanOrEqual(1);
  expect(reserved.storages[1].reservedInbound.wood).toBeLessThanOrEqual(1);
  expect(reserved.storages[1].contents.wood + reserved.storages[1].reservedInbound.wood).toBe(10);
  expect(reserved.storages[1].contents.wood).toBeLessThanOrEqual(10);
  expect(reserved.trees[0].reservedBuffer).toBeGreaterThanOrEqual(0);
  expect(reserved.residents.find((resident: any) => resident.id === 'worker-4')?.cargo).toBe(0);

  await expect.poll(async () => (await world(page)).storages[1].contents.wood,
    { timeout: 60_000, intervals: [50, 100, 250] }).toBe(10);
  const delivered = await capture('competition-first-delivery');
  expect(delivered.storages[0].contents.wood).toBe(16);
  expect(delivered.storages[1].reservedInbound.wood).toBe(0);
  expect(delivered.trees[0]).toMatchObject({ bufferQuantity: 1, reservedBuffer: 0 });
  expect(delivered.residents.every((resident: any) => resident.cargo === 0)).toBe(true);
  expect(delivered.logisticsTasks.filter((task: any) => task.status === 'completed' && task.itemId === 'wood')).toHaveLength(1);
  await mkdir(testInfo.outputDir, { recursive: true });
  await writeFile(testInfo.outputPath('competition-balance.json'), JSON.stringify(evidence, null, 2));
});

test('FIX-02C.2B mobile smoke renders both warehouse UI', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'fix02c2b-mobile', 'Mobile viewport smoke only.');
  await connect(page, process.env.PEACE_V2_FIX02C2B_URL ?? 'http://127.0.0.1:14265/', mainHandoffPort);
  const snapshot = await world(page);
  expect(snapshot.storages).toHaveLength(2);
  await page.screenshot({ path: testInfo.outputPath('mobile-warehouse.png'), fullPage: true });
});
