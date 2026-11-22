import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test, type Page } from '@playwright/test';
import { LAND_GRID_CELLS, LAND_GRID_CONFIG, landCellAt } from '../src/land-grid.js';
import { STORAGE_KEY, WORLD, type PrototypeWorld } from '../src/simulation.js';

const evidence = resolve(process.env.PLAYWRIGHT_EVIDENCE_DIR ??
  fileURLToPath(new URL('../../../docs/gameplay-prototype-v0.1/evidence-v1.0/', import.meta.url)));

async function capture(page: Page, name: string): Promise<void> {
  mkdirSync(evidence, { recursive: true });
  await page.screenshot({ path: resolve(evidence, `${name}.png`), animations: 'disabled' });
}

async function panTo(page: Page, worldX: number): Promise<void> {
  const canvas = page.locator('#world-scene canvas');
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const view = await canvas.evaluate((element) => JSON.parse(
      (element as HTMLCanvasElement).dataset.worldView ?? '{}'
    ) as { x: number; width: number });
    if (worldX >= view.x + view.width * 0.18 && worldX <= view.x + view.width * 0.82) return;
    const box = await canvas.boundingBox();
    if (!box) throw new Error('Game canvas has no visible bounds.');
    const delta = worldX - (view.x + view.width / 2);
    const screenDistance = Math.min(Math.abs(delta) * box.width / view.width, box.width * 0.56);
    const direction = Math.sign(delta);
    const startX = box.width / 2 + direction * screenDistance / 2;
    const endX = box.width / 2 - direction * screenDistance / 2;
    const y = box.height * 0.48;
    await page.mouse.move(startX, y);
    await page.mouse.down();
    await page.mouse.move(endX, y, { steps: 10 });
    await page.mouse.up();
    await page.waitForTimeout(100);
  }
}

async function tapWorld(page: Page, worldX: number, worldY: number): Promise<void> {
  await panTo(page, worldX);
  const canvas = page.locator('#world-scene canvas');
  const input = await canvas.evaluate((element, coordinates) => {
    const canvasElement = element as HTMLCanvasElement;
    const rect = canvasElement.getBoundingClientRect();
    const view = JSON.parse(canvasElement.dataset.worldView ?? '{}') as {
      x: number; y: number; width: number; height: number;
    };
    return {
      point: {
        x: (coordinates.x - view.x) * rect.width / view.width,
        y: (coordinates.y - view.y) * rect.height / view.height
      },
      view, rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height }
    };
  }, { x: worldX, y: worldY });
  console.log('tap world', { worldX, worldY, ...input });
  await canvas.click({ position: input.point });
}

async function savedWorld(page: Page): Promise<PrototypeWorld> {
  return page.evaluate((key) => JSON.parse(localStorage.getItem(key)!), STORAGE_KEY);
}

test('v1.0 grid modes share exact geometry and building placement requires confirmation', async ({ page }) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  const canvas = page.locator('#world-scene canvas');
  await expect(canvas).toBeVisible();
  await expect.poll(async () => Boolean(await canvas.getAttribute('data-grid-cells'))).toBe(true);

  await expect(page.locator('#grid-button')).toHaveAttribute('data-mode', 'off');
  await capture(page, 'v10-grid-off');
  await page.locator('#grid-button').click();
  await expect.poll(() => canvas.getAttribute('data-grid-mode')).toBe('borders');
  await capture(page, 'v10-grid-borders');
  await page.locator('#grid-button').click();
  await expect.poll(() => canvas.getAttribute('data-grid-mode')).toBe('planning');
  await capture(page, 'v10-grid-planning');

  const cells = await canvas.evaluate((element) => JSON.parse(
    (element as HTMLCanvasElement).dataset.gridCells ?? '[]'
  ) as Array<{
    id: number; column: number; row: number;
    left: number; right: number; top: number; bottom: number;
    width: number; height: number; state: string; available: boolean;
  }>);
  expect(cells).toHaveLength(LAND_GRID_CELLS.length);
  expect(cells.every((cell) => cell.width === cell.height && cell.width === LAND_GRID_CONFIG.cellSize)).toBe(true);
  for (let row = 0; row < LAND_GRID_CONFIG.rows; row += 1) {
    const rowCells = cells.filter((cell) => cell.row === row).sort((a, b) => a.column - b.column);
    expect(rowCells).toHaveLength(LAND_GRID_CONFIG.columns);
    expect(rowCells[0]!.left).toBe(0);
    expect(rowCells.at(-1)!.right).toBe(WORLD.width);
    for (let index = 0; index < rowCells.length - 1; index += 1) {
      expect(rowCells[index]!.right).toBe(rowCells[index + 1]!.left);
    }
  }
  for (let column = 0; column < LAND_GRID_CONFIG.columns; column += 1) {
    const columnCells = cells.filter((cell) => cell.column === column).sort((a, b) => a.row - b.row);
    expect(columnCells).toHaveLength(LAND_GRID_CONFIG.rows);
    for (let index = 0; index < columnCells.length - 1; index += 1) {
      expect(columnCells[index]!.bottom).toBe(columnCells[index + 1]!.top);
    }
  }
  expect(cells.find((cell) => cell.id === 8)).toMatchObject({ state: 'occupied', available: false });
  expect(cells.find((cell) => cell.id === 9)).toMatchObject({ state: 'occupied', available: false });

  await tapWorld(page, 690, WORLD.groundY - 80);
  console.log('hit result', await canvas.getAttribute('data-last-pointer-world'));
  await expect(page.locator('#selection-title')).toHaveText('Земельная клетка 3');
  await expect(page.locator('#selection-detail')).toContainText('Подготовлена');
  await capture(page, 'v10-grid-cell-card');
  await page.locator('#close-panel').click();

  await page.locator('#dock-build').click();
  await page.locator('#build-house').click();
  await tapWorld(page, 690, WORLD.groundY - 80);
  await expect(page.locator('#selection-title')).toHaveText('Предпросмотр: дом');
  await expect(page.locator('#confirm-placement')).toBeVisible();
  expect((await savedWorld(page)).sites).toHaveLength(0);
  await capture(page, 'v10-grid-building-preview');
  await page.locator('#confirm-placement').click();
  await expect.poll(async () => (await savedWorld(page)).sites.length).toBe(1);
  expect((await savedWorld(page)).sites[0]).toMatchObject({
    kind: 'house', x: landCellAt(690, WORLD.groundY - 80)!.centerX
  });
  expect(errors).toEqual([]);
});
