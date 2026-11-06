import { expect, test } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';

const handoffPort = Number(process.env.AVANPOST_V2_TEST_HANDOFF_PORT ?? 19949);

test('FIX-02C.2 fixture renders and the browser reconnects after reload', async ({ page }, testInfo) => {
  await page.goto('/');
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
  const fixture = await page.evaluate(async () => {
    const response = await fetch('/api/world');
    if (!response.ok) throw new Error(`World API returned ${response.status}`);
    return response.json();
  });
  expect(fixture.storages).toHaveLength(2);
  expect(fixture.buildings.some((building: { kind: string }) => building.kind === 'school-extraction')).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('warehouse-ui.png'), fullPage: true });
  await page.reload();
  await expect(page.locator('#world-scene canvas')).toBeVisible();
});

test('FIX-02C.2A UI delivers school wood from warehouse B before training', async ({ page }, testInfo) => {
  test.setTimeout(240_000);
  const evidence: Array<Record<string, unknown>> = [];
  const world = async () => page.evaluate(async () => {
    const response = await fetch('/api/world');
    if (!response.ok) throw new Error(`World API returned ${response.status}`);
    return response.json();
  });
  const capture = async (moment: string) => {
    const snapshot = await world();
    const carrier = snapshot.residents.find((resident: any) => resident.id === 'worker-3');
    const trainee = snapshot.residents.find((resident: any) => resident.id === 'worker-4');
    evidence.push({ moment, tick: snapshot.revision.serverTick,
      storages: snapshot.storages.map((storage: any) => ({ id: storage.id, contents: storage.contents,
        reservedInbound: storage.reservedInbound, reservedOutbound: storage.reservedOutbound })),
      carrier: { position: carrier.position, cargo: carrier.cargo, cargoItemId: carrier.cargoItemId, task: carrier.task },
      school: snapshot.buildings.find((building: any) => building.id === 'g7-logistics-school'),
      trainee: { profession: trainee.civilianProfession, task: trainee.task } });
    await page.screenshot({ path: testInfo.outputPath(`${moment}.png`), fullPage: true });
    return snapshot;
  };
  const inspectStorage = async (index: number, expectedName: string, expectedStock: string) => {
    const canvas = page.locator('#world-scene canvas');
    const box = await canvas.boundingBox();
    if (!box) throw new Error('Game canvas is not visible.');
    const point = await page.locator('#world-scene').evaluate((element, storageIndex) => {
      const data = (element as HTMLElement).dataset;
      return { x: Number(data[`storage${storageIndex}CanvasX`]), y: Number(data[`storage${storageIndex}CanvasY`]) };
    }, index);
    await page.mouse.click(box.x + point.x, box.y + point.y);
    await expect(page.locator('#inspector-title')).toHaveText(expectedName);
    await expect(page.locator('#inspector-detail')).toContainText(expectedStock);
    await page.locator('#close-context').click();
  };

  await page.goto('/');
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

  const initial = await capture('01-before-order');
  expect(initial.storages.map((storage: any) => storage.contents.wood)).toEqual([0, 4]);
  expect(initial.buildings.find((building: any) => building.id === 'g7-logistics-school')?.state).toBe('complete');
  expect(initial.residents.find((resident: any) => resident.id === 'worker-4')?.civilianProfession).toBe('general_worker');
  expect(initial.residents.find((resident: any) => resident.id === 'worker-3')?.workRole).toBe('hauler');
  await inspectStorage(0, 'Главный склад', '0 дерева · 16 камня');
  await inspectStorage(1, 'Восточный склад', '4 дерева · 0 камня');

  await page.locator('#population-panel > summary').click();
  await page.locator('#population-registry button').filter({ hasText: 'Анна' }).click();
  await expect(page.locator('#training-control')).toBeVisible();
  await page.getByRole('button', { name: /Школа добычи → Добытчик · (?:доставка из склада|доступно)/ }).click();

  await expect.poll(async () => {
    const snapshot = await world();
    return snapshot.residents.find((resident: any) => resident.id === 'worker-3')?.task?.sourceId;
  }, { timeout: 15_000 }).toBe('storehouse-2');
  await expect.poll(async () => {
    const snapshot = await world();
    const carrier = snapshot.residents.find((resident: any) => resident.id === 'worker-3');
    return carrier.task?.phase === 'walking_to_source' && carrier.task.sourceId === 'storehouse-2';
  }, { timeout: 15_000 }).toBe(true);
  const assigned = await capture('02-hauler-heading-to-warehouse-b');
  expect(assigned.logisticsTasks.filter((task: any) => task.trainingResidentId === 'worker-4')).toHaveLength(1);

  await expect.poll(async () => {
    const snapshot = await world();
    const carrier = snapshot.residents.find((resident: any) => resident.id === 'worker-3');
    return carrier.cargo === 1 && carrier.cargoItemId === 'wood';
  }, { timeout: 60_000 }).toBe(true);
  const carrying = await capture('03-hauler-carrying-wood');
  expect(carrying.storages[1].contents.wood).toBe(3);
  expect(carrying.storages[1].reservedOutbound.wood).toBe(0);
  expect(carrying.buildings.find((building: any) => building.id === 'g7-logistics-school')?.inTransitTrainingWood).toBe(1);
  expect(carrying.residents.find((resident: any) => resident.id === 'worker-4')?.task?.phase).toBe('waiting_materials');

  await expect.poll(async () => {
    const snapshot = await world();
    return snapshot.buildings.find((building: any) => building.id === 'g7-logistics-school')?.trainingMaterialsWood;
  }, { timeout: 90_000, intervals: [20, 50, 100, 250] }).toBe(1);
  const delivered = await capture('04-delivered-at-school');
  expect(delivered.storages[1].contents.wood).toBe(3);
  expect(delivered.storages[1].reservedOutbound.wood).toBe(0);
  expect(delivered.buildings.find((building: any) => building.id === 'g7-logistics-school')?.reservedTrainingWood).toBe(0);
  expect(delivered.buildings.find((building: any) => building.id === 'g7-logistics-school')?.inTransitTrainingWood).toBe(0);
  expect(delivered.buildings.find((building: any) => building.id === 'g7-logistics-school')?.trainingMaterialsWood).toBe(1);

  await expect.poll(async () => (await world()).residents.find((resident: any) => resident.id === 'worker-4')?.task?.phase,
    { timeout: 20_000 }).toBe('studying');
  const studying = await capture('05-training-started');
  expect(studying.buildings.find((building: any) => building.id === 'g7-logistics-school')?.trainingMaterialsWood).toBe(0);
  await expect.poll(async () => (await world()).residents.find((resident: any) => resident.id === 'worker-4')?.civilianProfession,
    { timeout: 90_000 }).toBe('extractor');
  await capture('06-profession-earned');
  await page.reload();
  await expect(page.locator('#world-scene canvas')).toBeVisible();
  const afterReload = await world();
  expect(afterReload.residents.find((resident: any) => resident.id === 'worker-4')?.civilianProfession).toBe('extractor');
  evidence.push({ moment: '07-after-reload', tick: afterReload.revision.serverTick,
    profession: afterReload.residents.find((resident: any) => resident.id === 'worker-4')?.civilianProfession,
    storages: afterReload.storages.map((storage: any) => storage.contents) });
  await mkdir(testInfo.outputDir, { recursive: true });
  await writeFile(testInfo.outputPath('resource-balance.json'), JSON.stringify(evidence, null, 2));
});
