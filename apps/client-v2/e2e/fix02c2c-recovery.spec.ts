import { expect, test } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';

const handoffPort = Number(process.env.AVANPOST_V2_TEST_HANDOFF_PORT ?? 19978);

test('FIX-02C.2C keeps gathered wood while both stores are full and resumes after UI training consumes stock', async ({ page }, testInfo) => {
  test.setTimeout(240_000);
  test.skip(testInfo.project.name.includes('mobile'), 'The recovery flow is recorded once in desktop Chromium.');
  const evidence: Array<Record<string, unknown>> = [];
  const world = async () => page.evaluate(async () => {
    const response = await fetch('/api/world');
    if (!response.ok) throw new Error(`World API returned ${response.status}`);
    return response.json();
  });
  const capture = async (moment: string) => {
    const snapshot = await world();
    evidence.push({ moment, tick: snapshot.revision.serverTick,
      storages: snapshot.storages.map((storage: any) => ({ id: storage.id, contents: storage.contents,
        reservedInbound: storage.reservedInbound, reservedOutbound: storage.reservedOutbound })),
      sources: { wood: snapshot.trees.map((tree: any) => ({ id: tree.id, bufferQuantity: tree.bufferQuantity, reservedBuffer: tree.reservedBuffer })),
        stone: snapshot.stoneDeposits.map((deposit: any) => ({ id: deposit.id, bufferQuantity: deposit.bufferQuantity, reservedBuffer: deposit.reservedBuffer })) },
      residents: snapshot.residents.map((resident: any) => ({ id: resident.id, cargo: resident.cargo,
        cargoItemId: resident.cargoItemId, task: resident.task })), logisticsTasks: snapshot.logisticsTasks });
    await page.screenshot({ path: testInfo.outputPath(`${moment}.png`), fullPage: true });
    return snapshot;
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

  const initial = await capture('01-full-stores');
  expect(initial.storages.map((storage: any) => storage.contents)).toEqual([{ wood: 16, stone: 0 }, { wood: 0, stone: 16 }]);
  expect(initial.storages.every((storage: any) => storage.reservedInbound.wood + storage.reservedInbound.stone === 0)).toBe(true);

  await page.locator('#population-panel > summary').click();
  await page.locator('#population-registry button').filter({ hasText: 'Илья' }).first().click();
  await expect(page.locator('#collect-wood')).toBeVisible();
  await page.locator('#collect-wood').click();
  await expect.poll(async () => (await world()).residents.some((resident: any) => resident.task?.kind === 'gather-wood'),
    { timeout: 15_000 }).toBe(true);
  await expect.poll(async () => {
    const snapshot = await world();
    return snapshot.trees.some((tree: any) => tree.bufferQuantity > 0) &&
      snapshot.logisticsTasks.some((task: any) => task.status === 'blocked' && task.blockedReason === 'STORAGE_FULL');
  }, { timeout: 90_000 }).toBe(true);
  const waiting = await capture('02-wood-waiting-storage');
  const bufferedWood = waiting.trees.reduce((sum: number, tree: any) => sum + tree.bufferQuantity, 0);
  expect(bufferedWood).toBeGreaterThan(0);
  const blockedWoodDemands = waiting.logisticsTasks.filter((task: any) => task.itemId === 'wood' && task.blockedReason === 'STORAGE_FULL');
  expect(blockedWoodDemands.length).toBeGreaterThan(0);
  expect(new Set(blockedWoodDemands.map((task: any) => task.demandKey)).size).toBe(blockedWoodDemands.length);
  expect(blockedWoodDemands.every((task: any) => task.allocatedQuantity === 0)).toBe(true);
  await page.reload();
  await expect(page.locator('#world-scene canvas')).toBeVisible();
  const reloaded = await capture('03-waiting-after-reload');
  expect(reloaded.trees.reduce((sum: number, tree: any) => sum + tree.bufferQuantity, 0)).toBeGreaterThanOrEqual(bufferedWood);
  expect(reloaded.logisticsTasks.some((task: any) => task.status === 'blocked' && task.blockedReason === 'STORAGE_FULL')).toBe(true);

  await page.locator('#population-panel > summary').click();
  await page.locator('#population-registry button').filter({ hasText: 'Анна' }).click();
  await expect(page.locator('#training-control')).toBeVisible();
  await page.getByRole('button', { name: /Школа добычи → Добытчик/ }).click();
  await expect.poll(async () => {
    const snapshot = await world();
    return snapshot.residents.some((actor: any) => actor.task?.kind === 'haul' && actor.task?.phase === 'walking_to_source') ||
      snapshot.logisticsTasks.some((task: any) => task.kind === 'active_training' && task.status === 'assigned');
  }, { timeout: 45_000 }).toBe(true);
  await capture('04-haul-resumed');
  await expect.poll(async () => {
    const snapshot = await world();
    return snapshot.residents.some((resident: any) => resident.cargo === 1 && resident.cargoItemId === 'wood' && resident.task?.kind === 'haul' && resident.task?.phase === 'carrying');
  }, { timeout: 90_000 }).toBe(true);
  await capture('05-wood-physically-carried');
  await expect.poll(async () => {
    const snapshot = await world();
    return snapshot.storages.some((storage: any) => storage.contents.wood > 0) &&
      snapshot.residents.some((resident: any) => resident.cargo === 0 && resident.task === null);
  }, { timeout: 90_000 }).toBe(true);
  const delivered = await capture('06-wood-unloaded');
  expect(delivered.storages.reduce((sum: number, storage: any) => sum + storage.reservedInbound.wood + storage.reservedInbound.stone, 0)).toBe(0);
  await mkdir(testInfo.outputDir, { recursive: true });
  await writeFile(testInfo.outputPath('resource-balance.json'), JSON.stringify(evidence, null, 2));
});

test('FIX-02C.2C reserves one competing wood delivery at a time and recovers the second after a second UI withdrawal', async ({ page }, testInfo) => {
  test.setTimeout(360_000);
  test.skip(testInfo.project.name.includes('mobile'), 'Competition evidence is recorded in desktop Chromium.');
  page.setDefaultTimeout(15_000);
  const evidence: Array<Record<string, unknown>> = [];
  const world = async () => page.evaluate(async () => (await fetch('/api/world')).json());
  const record = async (s: any, moment: string) => {
    evidence.push({ moment, tick: s.revision.serverTick,
      stores: s.storages.map((x: any) => ({ id: x.id, contents: x.contents, reservedInbound: x.reservedInbound, reservedOutbound: x.reservedOutbound })),
      woodBuffers: s.trees.map((x: any) => ({ id: x.id, quantity: x.bufferQuantity, reserved: x.reservedBuffer })),
      residents: s.residents.map((x: any) => ({ id: x.id, cargo: x.cargo, cargoItemId: x.cargoItemId, task: x.task })),
      logistics: s.logisticsTasks });
    await page.screenshot({ path: testInfo.outputPath(`${moment}.png`), fullPage: true });
    await writeFile(testInfo.outputPath('competition-resource-balance.json'), JSON.stringify(evidence, null, 2));
    return s;
  };
  const capture = async (moment: string) => record(await world(), moment);
  const connect = async () => {
    await page.goto('/');
    await expect(page.locator('#world-scene canvas')).toBeVisible();
    const code = await page.evaluate(async (port) => (await (await fetch(`http://127.0.0.1:${port}/api/launcher/pairing-code`)).json()).code, handoffPort);
    await page.locator('#pairing-panel').evaluate((element) => { (element as HTMLDetailsElement).open = true; });
    await page.locator('#pairing-input').fill(code);
    await page.locator('#pair-button').click();
    await expect(page.locator('#pairing-summary')).toHaveText('Мир подключён к этому браузеру');
  };
  const train = async (name: string) => {
    await page.locator('#population-panel > summary').click();
    await page.locator('#population-registry button').filter({ hasText: name }).click();
    await expect(page.locator('#training-control')).toBeVisible();
    await page.getByRole('button', { name: /Школа добычи → Добытчик/ }).click();
  };

  await connect();
  const initial = await capture('C1-both-stores-full');
  expect(initial.storages.map((x: any) => x.contents)).toEqual([{ wood: 16, stone: 0 }, { wood: 0, stone: 16 }]);
  await expect.poll(async () => (await world()).logisticsTasks.filter((x: any) => x.itemId === 'wood' && x.blockedReason === 'STORAGE_FULL').length,
    { timeout: 30_000 }).toBe(2);
  const bothWaiting = await capture('C2-two-wood-demands-blocked');
  const blocked = bothWaiting.logisticsTasks.filter((x: any) => x.itemId === 'wood' && x.blockedReason === 'STORAGE_FULL');
  expect(new Set(blocked.map((x: any) => x.demandKey)).size).toBe(blocked.length);
  expect(blocked.every((x: any) => x.allocatedQuantity === 0 && x.assignedResidentId === null)).toBe(true);
  expect(bothWaiting.trees.reduce((sum: number, x: any) => sum + x.bufferQuantity, 0)).toBeGreaterThanOrEqual(2);
  const sourceStart = new Map(bothWaiting.trees.map((x: any) => [x.id, x.bufferQuantity]));
  const originalWaitingSources = blocked.map((x: any) => x.sourceId);

  await train('Анна');
  await expect.poll(async () => {
    const s = await world();
    const deliveredSource = originalWaitingSources.find((id: string) =>
      (s.trees.find((tree: any) => tree.id === id)?.bufferQuantity ?? 0) < (sourceStart.get(id) as number));
    const secondStillWaiting = originalWaitingSources.some((id: string) => id !== deliveredSource &&
      s.logisticsTasks.some((x: any) => x.sourceId === id && x.status === 'blocked' && x.blockedReason === 'STORAGE_FULL'));
    const firstCompleted = Boolean(deliveredSource);
    return firstCompleted && secondStillWaiting && s.storages.every((x: any) =>
      x.contents.wood + x.contents.stone + x.reservedInbound.wood + x.reservedInbound.stone <= x.capacity);
  }, { timeout: 120_000, intervals: [25, 50, 100] }).toBe(true);
  const firstSlot = await capture('C3-one-slot-claimed');
  const firstDemand = originalWaitingSources.find((id: string) =>
    (firstSlot.trees.find((tree: any) => tree.id === id)?.bufferQuantity ?? 0) < (sourceStart.get(id) as number));
  expect(firstDemand).toBeTruthy();
  const secondSourceId = originalWaitingSources.find((id: string) => id !== firstDemand)!;
  expect(firstSlot.logisticsTasks.some((x: any) => x.sourceId === secondSourceId && x.status === 'blocked' && x.blockedReason === 'STORAGE_FULL')).toBe(true);
  expect(firstSlot.storages.reduce((sum: number, x: any) => sum + x.reservedInbound.wood + x.reservedInbound.stone, 0)).toBe(0);
  expect(firstSlot.storages.every((x: any) => x.contents.wood + x.contents.stone + x.reservedInbound.wood + x.reservedInbound.stone <= x.capacity)).toBe(true);
  expect(firstSlot.trees.find((x: any) => x.id === firstDemand)?.bufferQuantity).toBeLessThan(sourceStart.get(firstDemand) as number);

  await train('Мира');
  await expect.poll(async () => {
    const s = await world();
    return (s.trees.find((x: any) => x.id === secondSourceId)?.bufferQuantity ?? 0) < (sourceStart.get(secondSourceId) as number) &&
      !s.logisticsTasks.some((x: any) => x.sourceId === secondSourceId && x.status === 'blocked' && x.blockedReason === 'STORAGE_FULL') &&
      s.storages.reduce((sum: number, x: any) => sum + x.reservedInbound.wood + x.reservedInbound.stone, 0) === 0;
  }, { timeout: 120_000, intervals: [25, 50, 100] }).toBe(true);
  const secondSlot = await capture('C5-second-slot-claimed-and-delivered');
  const secondDemand = secondSlot.logisticsTasks.find((x: any) => x.sourceId === secondSourceId && x.itemId === 'wood');
  if (secondDemand) expect(secondDemand.status === 'completed' || secondDemand.deliveredQuantity > 0).toBe(true);
  expect(secondSlot.trees.find((x: any) => x.id === secondSourceId)?.bufferQuantity).toBeLessThan(sourceStart.get(secondSourceId) as number);
  expect(secondSlot.storages.reduce((sum: number, x: any) => sum + x.reservedInbound.wood + x.reservedInbound.stone, 0)).toBe(0);
  expect(secondSlot.storages.every((x: any) => x.contents.wood + x.contents.stone + x.reservedInbound.wood + x.reservedInbound.stone <= x.capacity)).toBe(true);
  await mkdir(testInfo.outputDir, { recursive: true });
  await writeFile(testInfo.outputPath('competition-resource-balance.json'), JSON.stringify(evidence, null, 2));
});

test('FIX-02C.2C retains buffered stone through reload and dispatches it automatically after UI training frees capacity', async ({ page }, testInfo) => {
  test.setTimeout(300_000);
  test.skip(testInfo.project.name.includes('mobile'), 'Stone recovery evidence is recorded in desktop Chromium.');
  const evidence: Array<Record<string, unknown>> = [];
  const world = async () => page.evaluate(async () => (await (await fetch('/api/world')).json()));
  const capture = async (moment: string) => {
    const s = await world();
    evidence.push({ moment, tick: s.revision.serverTick,
      stores: s.storages.map((x: any) => ({ id: x.id, contents: x.contents, reservedInbound: x.reservedInbound, reservedOutbound: x.reservedOutbound })),
      stoneBuffers: s.stoneDeposits.map((x: any) => ({ id: x.id, quantity: x.bufferQuantity, reserved: x.reservedBuffer })),
      residents: s.residents.map((x: any) => ({ id: x.id, cargo: x.cargo, cargoItemId: x.cargoItemId, task: x.task })), logistics: s.logisticsTasks });
    await page.screenshot({ path: testInfo.outputPath(`${moment}.png`), fullPage: true });
    return s;
  };
  await page.goto('/');
  await expect(page.locator('#world-scene canvas')).toBeVisible();
  const code = await page.evaluate(async (port) => (await (await fetch(`http://127.0.0.1:${port}/api/launcher/pairing-code`)).json()).code, handoffPort);
  await page.locator('#pairing-panel').evaluate((element) => { (element as HTMLDetailsElement).open = true; });
  await page.locator('#pairing-input').fill(code);
  await page.locator('#pair-button').click();
  await expect(page.locator('#pairing-summary')).toHaveText('Мир подключён к этому браузеру');
  const initial = await capture('D1-stores-full-before-mining');
  expect(initial.storages.map((x: any) => x.contents)).toEqual([{ wood: 16, stone: 0 }, { wood: 0, stone: 16 }]);

  await page.locator('#population-panel > summary').click();
  await page.locator('#population-registry button').filter({ hasText: 'Марья' }).click();
  const canvas = page.locator('#world-scene canvas');
  const box = await canvas.boundingBox();
  if (!box) throw new Error('Game canvas is not visible.');
  const point = await page.locator('#world-scene').evaluate((element) => ({
    x: Number((element as HTMLElement).dataset.firstStoneCanvasX), y: Number((element as HTMLElement).dataset.firstStoneCanvasY)
  }));
  await canvas.click({ position: point });
  await expect(page.locator('#assign-target')).toBeVisible();
  await page.locator('#assign-target').click();
  await expect.poll(async () => (await world()).residents.some((x: any) => x.task?.kind === 'gather-stone'), { timeout: 20_000 }).toBe(true);
  await expect.poll(async () => {
    const s = await world();
    return s.stoneDeposits.some((x: any) => x.bufferQuantity > 0) &&
      s.logisticsTasks.some((x: any) => x.itemId === 'stone' && x.status === 'blocked' && x.blockedReason === 'STORAGE_FULL');
  }, { timeout: 120_000 }).toBe(true);
  const waiting = await capture('D2-stone-buffer-waits-full');
  const bufferedStone = waiting.stoneDeposits.reduce((sum: number, x: any) => sum + x.bufferQuantity, 0);
  expect(bufferedStone).toBeGreaterThan(0);
  expect(waiting.logisticsTasks.some((x: any) => x.itemId === 'stone' && x.blockedReason === 'STORAGE_FULL')).toBe(true);
  await page.reload();
  await expect(page.locator('#world-scene canvas')).toBeVisible();
  const reloaded = await capture('D3-stone-buffer-after-reload');
  expect(reloaded.stoneDeposits.reduce((sum: number, x: any) => sum + x.bufferQuantity, 0)).toBeGreaterThanOrEqual(bufferedStone);
  expect(reloaded.logisticsTasks.some((x: any) => x.itemId === 'stone' && x.blockedReason === 'STORAGE_FULL')).toBe(true);

  await page.locator('#population-panel > summary').click();
  await page.locator('#population-registry button').filter({ hasText: 'Анна' }).click();
  await page.getByRole('button', { name: /Школа добычи → Добытчик/ }).click();
  await expect.poll(async () => {
    const s = await world();
    return s.residents.some((x: any) => x.task?.kind === 'haul' && x.task?.sourceKind === 'stone-buffer' &&
      ['walking_to_source', 'loading', 'carrying', 'unloading'].includes(x.task.phase)) ||
      s.residents.some((x: any) => x.cargoItemId === 'stone');
  }, { timeout: 120_000, intervals: [20, 50, 100] }).toBe(true);
  await capture('D4-stone-haul-automatically-assigned');
  await expect.poll(async () => (await world()).residents.some((x: any) => x.cargo === 1 && x.cargoItemId === 'stone' && x.task?.kind === 'haul' && x.task?.phase === 'carrying'),
    { timeout: 90_000, intervals: [20, 50, 100] }).toBe(true);
  await capture('D5-stone-physically-carried');
  await expect.poll(async () => {
    const s = await world();
    return s.storages.some((x: any) => x.contents.stone > 0) &&
      s.stoneDeposits.reduce((sum: number, x: any) => sum + x.bufferQuantity, 0) < bufferedStone &&
      s.storages.reduce((sum: number, x: any) => sum + x.reservedInbound.stone, 0) === 0;
  }, { timeout: 90_000 }).toBe(true);
  const delivered = await capture('D6-stone-unloaded');
  expect(delivered.storages.reduce((sum: number, x: any) => sum + x.reservedInbound.stone, 0)).toBe(0);
  await mkdir(testInfo.outputDir, { recursive: true });
  await writeFile(testInfo.outputPath('stone-resource-balance.json'), JSON.stringify(evidence, null, 2));
});

test('FIX-02C.2C resumes a reserved buffer haul after a real API process restart without player commands', async ({ page }, testInfo) => {
  test.setTimeout(300_000);
  test.skip(testInfo.project.name.includes('mobile'), 'API restart evidence is recorded in desktop Chromium.');
  page.setDefaultTimeout(15_000);
  const evidence: Array<Record<string, unknown>> = [];
  const world = async () => page.evaluate(async () => {
    const response = await fetch('/api/world');
    if (!response.ok) throw new Error(`World API returned ${response.status}`);
    return response.json();
  });
  const record = async (s: any, moment: string) => {
    const snapshot = { moment, tick: s.revision.serverTick,
      stores: s.storages.map((x: any) => ({ id: x.id, contents: x.contents, reservedInbound: x.reservedInbound, reservedOutbound: x.reservedOutbound })),
      buffers: s.trees.map((x: any) => ({ id: x.id, quantity: x.bufferQuantity, reserved: x.reservedBuffer })),
      residents: s.residents.map((x: any) => ({ id: x.id, cargo: x.cargo, cargoItemId: x.cargoItemId, task: x.task })),
      logistics: s.logisticsTasks };
    evidence.push(snapshot);
    await page.screenshot({ path: testInfo.outputPath(`${moment}.png`), fullPage: true });
    return s;
  };
  const capture = async (moment: string) => record(await world(), moment);
  const pair = async () => {
    const code = await page.evaluate(async (port) => {
      const response = await fetch(`http://127.0.0.1:${port}/api/launcher/pairing-code`);
      if (!response.ok) throw new Error(`Pairing handoff returned ${response.status}`);
      return (await response.json() as { code: string }).code;
    }, handoffPort);
    await page.locator('#pairing-panel').evaluate((element) => { (element as HTMLDetailsElement).open = true; });
    await page.locator('#pairing-input').fill(code);
    await page.locator('#pair-button').click();
    await expect(page.locator('#pairing-summary')).toHaveText('Мир подключён к этому браузеру');
  };

  await page.goto('/');
  await expect(page.locator('#world-scene canvas')).toBeVisible();
  await pair();
  const initial = await capture('R1-full-with-two-blocked-demands');
  expect(initial.storages.map((x: any) => x.contents)).toEqual([{ wood: 16, stone: 0 }, { wood: 0, stone: 16 }]);
  expect(initial.logisticsTasks?.filter((x: any) => x.itemId === 'wood' && x.status === 'blocked')).toHaveLength(2);

  await page.locator('#population-panel > summary').click();
  await page.locator('#population-registry button').filter({ hasText: 'Анна' }).click();
  await page.getByRole('button', { name: /Школа добычи → Добытчик/ }).click();
  let activeSnapshot: any;
  await expect.poll(async () => {
    const s = await world();
    const ready = s.storages.reduce((sum: number, x: any) => sum + x.reservedInbound.wood + x.reservedInbound.stone, 0) === 1 &&
      s.residents.some((x: any) => x.task?.kind === 'haul' && x.task.sourceKind === 'tree-buffer' && x.task.phase === 'carrying') &&
      s.logisticsTasks.some((x: any) => x.itemId === 'wood' && x.status === 'blocked' && x.blockedReason === 'STORAGE_FULL');
    if (ready) activeSnapshot = s;
    return ready;
  }, { timeout: 120_000, intervals: [20, 50, 100] }).toBe(true);
  const beforeRestart = await record(activeSnapshot, 'R2-active-reserved-before-api-restart');
  const activeBefore = beforeRestart.residents.find((x: any) => x.task?.kind === 'haul' && x.task.sourceKind === 'tree-buffer' &&
    ['walking_to_source', 'loading', 'carrying', 'unloading'].includes(x.task.phase));
  expect(activeBefore).toBeTruthy();
  expect(beforeRestart.storages.reduce((sum: number, x: any) => sum + x.reservedInbound.wood + x.reservedInbound.stone, 0)).toBe(1);
  const signal = process.env.FIX02C2C_RESTART_SIGNAL;
  if (!signal) throw new Error('FIX02C2C_RESTART_SIGNAL was not configured by the restart harness.');
  await mkdir(testInfo.outputDir, { recursive: true });
  await writeFile(signal, JSON.stringify({ ready: true, demandKey: activeBefore.task.logisticsTaskId,
    sourceId: activeBefore.task.sourceId, beforeRestart }, null, 2));

  await expect.poll(async () => {
    try { return await page.evaluate(async () => (await fetch('/api/health')).status === 200); }
    catch { return false; }
  }, { timeout: 120_000, intervals: [100, 250, 500] }).toBe(true);
  await page.reload();
  await expect(page.locator('#world-scene canvas')).toBeVisible();
  await expect.poll(async () => {
    try { return await page.evaluate(async () => (await fetch('/api/world')).ok); }
    catch { return false; }
  }, { timeout: 30_000, intervals: [100, 250, 500] }).toBe(true);
  const afterRestart = await capture('R3-reserved-haul-restored-after-api-restart');
  await expect.poll(async () => {
    const s = await world();
    return s.storages.find((x: any) => x.id === activeBefore.task.destinationId)?.contents.wood === 16 &&
      s.storages.reduce((sum: number, x: any) => sum + x.reservedInbound.wood + x.reservedInbound.stone, 0) === 0 &&
      s.residents.every((x: any) => x.cargo === 0 || x.cargoItemId !== 'wood');
  }, { timeout: 120_000, intervals: [25, 50, 100] }).toBe(true);
  const delivered = await capture('R4-delivered-after-restart-without-reassignment');
  expect(delivered.storages.find((x: any) => x.id === activeBefore.task.destinationId)?.contents.wood).toBe(16);
  expect(delivered.storages.reduce((sum: number, x: any) => sum + x.reservedInbound.wood + x.reservedInbound.stone, 0)).toBe(0);
  await writeFile(testInfo.outputPath('api-restart-resource-balance.json'), JSON.stringify(evidence, null, 2));
});
