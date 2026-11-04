import { expect, test } from '@playwright/test';

const handoffPort = Number(process.env.AVANPOST_V2_MANUAL_HANDOFF_PORT ?? 18909);

test('population registry, resident detail and saved world survive reload', async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto('/');
  await expect(page.locator('#world-scene canvas')).toBeVisible();
  await expect(page.locator('#pairing-panel summary')).toBeVisible();
  if (!(await page.locator('#pairing-panel').evaluate((element) => (element as HTMLDetailsElement).open))) {
    await page.locator('#pairing-panel summary').click();
  }
  const code = await page.evaluate(async (port) => {
    const response = await fetch(`http://127.0.0.1:${port}/api/launcher/pairing-code`);
    if (!response.ok) throw new Error(`Pairing handoff returned ${response.status}`);
    return (await response.json() as { code: string }).code;
  }, handoffPort);
  await page.locator('#pairing-input').fill(code);
  await page.locator('#pair-button').click();
  await expect(page.locator('#pairing-summary')).toHaveText('Мир подключён к этому браузеру');
  await page.locator('#pairing-panel summary').click();

  await page.locator('#population-panel summary').click();
  await expect(page.locator('#population-summary')).toContainText('Жилые места:');
  await expect(page.locator('#population-registry button').first()).toBeVisible();
  const residentCard = page.locator('#population-registry button').filter({ hasText: 'Илья' }).first();
  await expect(residentCard).toBeVisible();
  await residentCard.click();
  await expect(page.locator('#inspector-detail')).toContainText('профессия: Разнорабочий');
  await expect(page.locator('#inspector-detail')).toContainText('характеристики:');
  await expect(page.locator('#inspector-detail')).toContainText('жильё:');

  const worldBefore = await page.evaluate(async () => (await (await fetch('/api/world')).json()) as {
    residents: Array<{ id: string; housingBuildingId: string | null }>;
    buildings: Array<{ id: string; kind: string; state: string; housingCapacity: number }>;
    populationMigration: { nextResidentSequence: number };
  });
  expect(worldBefore.buildings.some((building) => building.kind === 'cabin' && building.state === 'complete' && building.housingCapacity > 0)).toBe(true);
  expect(worldBefore.residents.some((resident) => resident.housingBuildingId !== null)).toBe(true);

  await page.reload();
  await expect(page.locator('#pairing-summary')).toBeVisible();
  const reloadWorldResponse = await page.evaluate(async () => {
    const response = await fetch('/api/world', { credentials: 'include' });
    return { status: response.status, world: response.ok ? await response.json() : null };
  }) as { status: number; world: { residents: Array<{ id: string; housingBuildingId: string | null }>;
    populationMigration: { nextResidentSequence: number } } | null };
  let reloadedWorld = reloadWorldResponse.world;
  if (reloadWorldResponse.status !== 200 || !reloadedWorld) {
    await page.locator('#pairing-panel').evaluate((element) => { (element as HTMLDetailsElement).open = true; });
    const renewedCode = await page.evaluate(async (port) => {
      const response = await fetch(`http://127.0.0.1:${port}/api/launcher/pairing-code`);
      if (!response.ok) throw new Error(`Pairing renewal returned ${response.status}`);
      return (await response.json() as { code: string }).code;
    }, handoffPort);
    await page.locator('#pairing-input').fill(renewedCode);
    await page.locator('#pair-button').click({ force: true });
    await expect(page.locator('#pairing-summary')).toHaveText('Мир подключён к этому браузеру');
    reloadedWorld = await page.evaluate(async () => (await (await fetch('/api/world', { credentials: 'include' })).json()));
  }
  const worldAfter = reloadedWorld!;
  expect(worldAfter.populationMigration.nextResidentSequence).toBe(worldBefore.populationMigration.nextResidentSequence);
  expect(worldAfter.residents.map((resident) => [resident.id, resident.housingBuildingId]))
    .toEqual(worldBefore.residents.map((resident) => [resident.id, resident.housingBuildingId]));
});
