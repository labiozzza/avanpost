import { expect, test, type Page } from '@playwright/test';
import { writeFile } from 'node:fs/promises';

const handoffPort = Number(process.env.AVANPOST_V2_TEST_HANDOFF_PORT ?? 19939);

async function getWorld(page: Page): Promise<any> {
  const response = await page.request.get(new URL('/api/world', page.url()).toString());
  if (!response.ok()) throw new Error(`World API returned ${response.status()}`);
  return response.json();
}

async function clickGround(page: Page, anchorX: number): Promise<void> {
  const canvas = page.locator('#world-scene canvas');
  const box = await canvas.boundingBox();
  if (!box) throw new Error('Game canvas is not visible.');
  const point = await page.locator('#world-scene').evaluate((element, input) => {
    const data = (element as HTMLElement).dataset;
    const viewX = Number(data.cameraWorldViewX ?? 0), viewY = Number(data.cameraWorldViewY ?? 0);
    const vx = Number(data.cameraViewportX ?? 0), vy = Number(data.cameraViewportY ?? 0);
    const vw = Number(data.cameraViewportWidth ?? 1), vh = Number(data.cameraViewportHeight ?? 1);
    const zoom = Number(data.cameraZoom ?? 1);
    for (let distance = 0; distance <= 24; distance += 1) for (const xCell of distance === 0 ? [input.anchorX] : [input.anchorX - distance, input.anchorX + distance]) {
      const x = (vx + (xCell * 48 + 24 - viewX) * zoom) * input.width / vw;
      const y = (vy + (12 - viewY) * zoom) * input.height / vh;
      if (x >= 8 && x < input.width - 8 && y >= 8 && y < input.height - 8 &&
          document.elementFromPoint(input.left + x, input.top + y)?.tagName.toLowerCase() === 'canvas') return { x, y };
    }
    throw new Error(`No visible ground cell near x=${input.anchorX}`);
  }, { anchorX, width: box.width, height: box.height, left: box.x, top: box.y });
  await page.mouse.click(box.x + point.x, box.y + point.y);
}

test('FIX-02C.1 builds a second warehouse through the game UI and retains it after reload', async ({ page }, info) => {
  test.setTimeout(240_000);
  await page.goto('/');
  await expect(page.locator('#world-scene canvas')).toBeVisible();
  const pairing = page.locator('#pairing-panel');
  if (!(await pairing.evaluate((element) => (element as HTMLDetailsElement).open))) await pairing.locator('summary').click();
  const code = await page.evaluate(async (port) => {
    const response = await fetch(`http://127.0.0.1:${port}/api/launcher/pairing-code`);
    if (!response.ok) throw new Error(`Handoff failed: ${response.status}`);
    return (await response.json() as { code: string }).code;
  }, handoffPort);
  await page.locator('#pairing-input').fill(code);
  await page.locator('#pair-button').click();
  await expect(page.locator('#pairing-summary')).toHaveText('Мир подключён к этому браузеру');
  await pairing.evaluate((element) => { (element as HTMLDetailsElement).open = false; });

  const before = await getWorld(page);
  const beforeCapacity = before.storages.reduce((total: number, store: { capacity: number }) => total + store.capacity, 0);
  await clickGround(page, -22);
  await expect(page.locator('#building-catalog')).toBeVisible();
  await expect(page.locator('#warehouse-catalog-item')).toBeVisible();
  await page.screenshot({ path: info.outputPath('warehouse-build-menu.png'), fullPage: true });
  await page.locator('#warehouse-catalog-item').click();
  await clickGround(page, -22);
  await expect(page.locator('#confirm-placement')).toBeEnabled({ timeout: 20_000 });
  await page.locator('#confirm-placement').click();

  const observedStates = new Set<string>();
  let builderAssigned = false;
  let builderTaskObserved = false;
  let materialsReserved = false;
  await expect.poll(async () => {
    const current = await getWorld(page);
    const building = current.buildings.find((candidate: any) => candidate.kind === 'warehouse');
    if (building) {
      observedStates.add(building.state);
      const order = current.buildOrders.find((candidate: any) => candidate.buildingId === building.id);
      builderAssigned ||= Boolean(order?.assignedResidentId);
      builderTaskObserved ||= current.residents.some((resident: any) => resident.task?.kind === 'build-workshop' && resident.task.orderId === order?.id);
      materialsReserved ||= building.reservedWood > 0 && building.reservedStone > 0;
    }
    return building?.state;
  }, { timeout: 150_000 }).toBe('complete');
  expect(observedStates).toContain('complete');
  expect(observedStates).toContain('foundation');
  expect(observedStates).toContain('scaffold');
  expect(builderAssigned).toBe(true);
  expect(builderTaskObserved).toBe(true);
  expect(materialsReserved).toBe(true);
  const complete = await getWorld(page);
  const added = complete.storages.find((store: any) => !before.storages.some((old: any) => old.id === store.id));
  expect(added).toBeTruthy();
  expect(complete.storages.reduce((total: number, store: { capacity: number }) => total + store.capacity, 0))
    .toBe(beforeCapacity + added.capacity);
  await expect(page.locator('#world-scene')).toHaveAttribute('data-storage-visual-count', String(complete.storages.length));
  const index = complete.storages.findIndex((store: any) => store.id === added.id);
  const point = await page.locator('#world-scene').evaluate((element, storageIndex) => {
    const data = (element as HTMLElement).dataset;
    return { x: Number(data[`storage${storageIndex}CanvasX`]), y: Number(data[`storage${storageIndex}CanvasY`]) };
  }, index);
  await page.locator('#world-scene canvas').click({ position: point });
  await expect(page.locator('#context-kind')).toHaveText('СКЛАД');
  await expect(page.locator('#inspector-title')).toHaveText(added.name);
  await expect(page.locator('#inspector-detail')).toContainText(String(added.capacity));
  await page.screenshot({ path: info.outputPath('second-warehouse-card.png'), fullPage: true });

  await page.reload();
  await expect(page.locator('#world-scene canvas')).toBeVisible();
  await expect.poll(async () => (await getWorld(page)).storages.some((store: any) => store.id === added.id)).toBe(true);
  expect((await getWorld(page)).storages.find((store: any) => store.id === added.id)?.capacity).toBe(added.capacity);
  await page.screenshot({ path: info.outputPath('second-warehouse-after-reload.png'), fullPage: true });
  await writeFile(info.outputPath('acceptance.json'), JSON.stringify({
    database: 'avanpost_v2_fix02c1_test', beforeCapacity, afterCapacity: complete.storages.reduce((total: number, store: { capacity: number }) => total + store.capacity, 0),
    storageId: added.id, storageCapacity: added.capacity, observedStates: [...observedStates], builderAssigned,
    builderTaskObserved, materialsReserved, persistedAfterReload: true
  }, null, 2));
});
