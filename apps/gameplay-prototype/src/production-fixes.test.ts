import { describe, expect, it } from 'vitest';
import { createNewWorld, PrototypeSimulation, parseSavedWorld, materialFraction, costOf,
  PROTOTYPE_CONFIG, cellBounds, PLOTS, type PrototypeWorld } from './simulation.js';
import { catchUpSettlement } from './offline-progress.js';

function run(sim: PrototypeSimulation, seconds: number) {
  for (let tick = 0; tick < Math.round(seconds * 10); tick++) sim.step(0.1);
}
function siteWorld(kind: 'house' | 'warehouse' = 'house'): PrototypeWorld {
  const sim = new PrototypeSimulation(createNewWorld()); sim.place(kind, 1);
  sim.world.stores[0]!.wood = 0; sim.world.stores[0]!.stone = 0;
  sim.assign('r3', 'builder'); sim.world.residents[2]!.x = 690;
  return sim.world;
}

describe('Owner production fixes', () => {
  it('keeps mining through successive piles with a 360-capacity store, owner inventory and an active house order', () => {
    const world = createNewWorld();
    world.stores = [
      { id: 'store-1', buildingId: 'warehouse:store-1', x: 963, wood: 55, stone: 100, capacity: 180 },
      { id: 'store-2', buildingId: 'warehouse:store-2', x: 1590, wood: 0, stone: 0, capacity: 180 }
    ];
    world.buildings.push({ id: 'warehouse:store-2', kind: 'warehouse', x: 1590, y: 600 });
    world.stockpiles[1]!.amount = 3;
    world.stoneSource = 150;
    world.sites.push({ id: 'owner-house', kind: 'house', x: 690, y: 600,
      deliveredWood: 35, deliveredStone: costOf('house').stone - 6, progress: 0.4, stage: 1,
      priority: 2, paused: false });
    world.occupiedPlots.push(1);
    Object.assign(world.residents[0]!, { role: 'miner', x: 1900, mode: 'working', progress: 0 });
    Object.assign(world.residents[1]!, { role: 'hauler', x: 1810 });
    Object.assign(world.residents[2]!, { role: 'builder', x: 690 });

    const simulation = new PrototypeSimulation(world);
    expect(simulation.totals()).toMatchObject({ capacity: 360, stored: 155, wood: 55, stone: 103 });
    run(simulation, 150);

    expect(simulation.activity.harvested.stone).toBeGreaterThan(2);
    expect(world.stoneSource).toBeLessThan(150);
    expect(world.stockpiles[1]!.amount).toBeGreaterThanOrEqual(0);
    expect(world.stockpiles[1]!.amount).toBeLessThanOrEqual(world.stockpiles[1]!.capacity);
    expect(world.sites[0]!.deliveredStone).toBeGreaterThan(costOf('house').stone - 6);
    expect(world.residents[0]!.blockedReason).toBeNull();
  });

  it('takes 25–30 seconds for ten units and keeps the entire pile on the ground at a full warehouse', () => {
    const sim = new PrototypeSimulation(createNewWorld());
    sim.world.stores[0]!.wood = 120; sim.world.stores[0]!.stone = 0;
    sim.world.residents[0]!.x = PROTOTYPE_CONFIG.sources.homeX;
    sim.assign('r1', 'woodcutter'); sim.setLogisticsMode('r1', 'independent');
    run(sim, 25); expect(sim.activity.harvested.wood).toBeLessThan(10);
    run(sim, 5); expect(sim.activity.harvested.wood).toBe(10);
    expect(sim.world.stockpiles[0]!.amount).toBe(10);
    expect(sim.world.residents[0]).toMatchObject({ cargo: null, mode: 'blocked' });
    run(sim, 20); expect(sim.activity.harvested.wood).toBe(10);
    sim.world.stockpiles[0]!.amount -= 4;
    run(sim, 6); expect(sim.world.stockpiles[0]!.amount).toBeGreaterThan(6);
    expect(sim.world.residents[0]!.cargo).toBeNull();
  });

  it('reports an exhausted natural wood source without losing resources or inventing a hauler', () => {
    const simulation = new PrototypeSimulation(createNewWorld());
    const world = simulation.world;
    world.stores[0]!.wood = world.stores[0]!.capacity;
    world.stores[0]!.stone = 0;
    world.woodSource = 0;
    world.woodSourceRecoverySeconds = 0;
    world.residents[0]!.role = 'woodcutter';
    world.residents[0]!.x = PROTOTYPE_CONFIG.sources.homeX;
    world.residents[0]!.logisticsMode = 'independent';

    run(simulation, 1);

    expect(world.woodSource).toBe(0);
    expect(world.stockpiles.find((pile) => pile.sourceId === 'home')?.amount).toBe(0);
    expect(world.residents[0]).toMatchObject({ role: 'woodcutter', mode: 'blocked', cargo: null });
    expect(world.residents[0]!.blockedReason).toContain('Лесной участок выработан');
    expect(world.residents.some((person) => person.role === 'hauler')).toBe(false);
  });

  it('delivers directly from the source to a site while all warehouses remain full', () => {
    const sim = new PrototypeSimulation(createNewWorld());
    sim.world.stores[0]!.wood = 120; sim.world.stores[0]!.stone = 0;
    sim.world.stockpiles[1]!.amount = 10;
    sim.world.residents[1]!.x = 1900;
    sim.place('house', 1); sim.assign('r2', 'miner'); sim.setLogisticsMode('r2', 'independent');
    run(sim, 12);
    expect(sim.world.sites[0]!.deliveredStone).toBe(10);
    expect(sim.world.stores[0]!.wood).toBe(120);
    expect(sim.world.residents[1]!.cargoAmount).toBeLessThanOrEqual(10);
  });

  it('builds only the delivered fraction, preserves it across reload, and resumes with new materials', () => {
    const w = siteWorld(); w.sites[0]!.deliveredWood = 25;
    let sim = new PrototypeSimulation(w); sim.assign('r2', 'hauler');
    run(sim, 90);
    expect(w.sites[0]!.progress).toBeCloseTo(25 / 110, 8);
    expect(w.sites[0]!.progress).toBeLessThanOrEqual(materialFraction(w.sites[0]!));
    const progress = w.sites[0]!.progress;
    sim = new PrototypeSimulation(parseSavedWorld(JSON.stringify(w))!);
    expect(sim.world.sites[0]!.progress).toBe(progress);
    sim.world.sites[0]!.deliveredStone = 50; sim.world.sites[0]!.deliveredWood = 60;
    run(sim, 260);
    expect(sim.world.sites).toHaveLength(0); expect(sim.world.residents).toHaveLength(4);
    expect(sim.world.residents[2]!.mode).toBe('idle');
  });

  it('starts work after one unit, without completing a building missing stone', () => {
    const w = siteWorld(); w.sites[0]!.deliveredWood = 1;
    const sim = new PrototypeSimulation(w); sim.assign('r2', 'hauler');
    run(sim, 10);
    expect(w.sites[0]!.progress).toBeCloseTo(1 / 110, 8);
    w.sites[0]!.deliveredWood = 60;
    run(sim, 240);
    expect(w.sites[0]!.progress).toBeCloseTo(60 / 110, 8);
    expect(w.residents).toHaveLength(3);
  });

  it('serves construction before blocked full-store pickups and resumes hauling afterwards', () => {
    const w = siteWorld(); w.stores[0]!.wood = 70; w.stores[0]!.stone = 50;
    w.stockpiles[0]!.amount = 10; w.stockpiles[1]!.amount = 10;
    const sim = new PrototypeSimulation(w);
    sim.assign('r1', 'woodcutter'); sim.assign('r2', 'hauler');
    run(sim, 2);
    expect(w.logisticsRequests.some((r) => r.type === 'DELIVER_TO_CONSTRUCTION' &&
      ['assigned', 'in_progress'].includes(r.status))).toBe(true);
    run(sim, 410);
    expect(w.residents).toHaveLength(4);
    expect(w.logisticsRequests.some((r) => r.type === 'PICKUP_RESOURCE' && r.status === 'completed')).toBe(true);
    expect(sim.diagnostics.issues.some((issue) => issue.startsWith('over_reserved'))).toBe(false);
  });

  it('uses multiple haulers without double reservations and preserves FIFO within construction', () => {
    const w = siteWorld(); w.stores[0]!.wood = 60; w.stores[0]!.stone = 50;
    const sim = new PrototypeSimulation(w); sim.assign('r1', 'hauler'); sim.assign('r2', 'hauler');
    run(sim, 0.2);
    const assigned = w.residents.slice(0, 2).map((p) => p.logisticsRequestId);
    expect(new Set(assigned).size).toBe(2); expect(assigned.every(Boolean)).toBe(true);
    run(sim, 370);
    expect(w.residents).toHaveLength(4);
    expect(w.stores[0]!.wood).toBe(0); expect(w.stores[0]!.stone).toBe(0);
  });

  it('gives each buildable cell one non-overlapping footprint and keeps piles in source areas', () => {
    const buildablePlots = PLOTS.filter((plot) => plot.role === 'building');
    for (const plot of buildablePlots) {
      const bounds = cellBounds(plot.id)!;
      expect(bounds.right - bounds.left).toBeGreaterThan(271);
      for (const other of buildablePlots.filter((p) => p.id !== plot.id)) {
        const b = cellBounds(other.id)!;
        expect(Math.min(bounds.right, b.right) - Math.max(bounds.left, b.left)).toBeLessThanOrEqual(0);
      }
      for (const pile of createNewWorld().stockpiles) {
        expect(pile.x + 41 <= bounds.left || pile.x - 41 >= bounds.right).toBe(true);
      }
    }
    const w = createNewWorld();
    delete w.sourceLayoutVersion;
    delete w.gridVersion;
    w.mapVersion = 7;
    w.stockpiles[1]!.x = 1700; w.stockpiles[1]!.amount = 7;
    const loaded = parseSavedWorld(JSON.stringify(w))!;
    expect(loaded.stockpiles[1]).toMatchObject({ x: 1850, amount: 7 });
    expect(loaded.buildings).toEqual(w.buildings);
    expect(parseSavedWorld(JSON.stringify(loaded))).toEqual(loaded);
  });
});

describe('Offline state-machine progression', () => {
  const now = 1_800_000_000_000;
  const options = { yieldToUi: async () => {} };
  it('finishes a funded warehouse at 47% after ten minutes, then does not apply the same time twice', async () => {
    const w = siteWorld('warehouse'); Object.assign(w.sites[0]!, {
      deliveredWood: costOf('warehouse').wood, deliveredStone: costOf('warehouse').stone, progress: 0.47 });
    w.lastSimulatedAtMs = now - 600_000;
    const sim = new PrototypeSimulation(w);
    const report = await catchUpSettlement(sim, now, options);
    expect(report.buildings).toEqual(['склад']); expect(w.stores).toHaveLength(2);
    const elapsed = w.elapsedSeconds;
    const again = new PrototypeSimulation(parseSavedWorld(JSON.stringify(w))!);
    expect((await catchUpSettlement(again, now, options)).seconds).toBe(0);
    expect(again.world.elapsedSeconds).toBe(elapsed);
  });

  it('stops at the material limit and preserves an older progress already above that limit', async () => {
    const w = siteWorld('warehouse'); w.sites[0]!.deliveredWood = 25;
    w.lastSimulatedAtMs = now - 600_000;
    const sim = new PrototypeSimulation(w); sim.assign('r2', 'hauler');
    await catchUpSettlement(sim, now, options);
    expect(w.sites[0]!.progress).toBeCloseTo(25 / 90, 8);
    w.sites[0]!.progress = 0.47; w.lastSimulatedAtMs = now - 600_000;
    await catchUpSettlement(sim, now, options);
    expect(w.sites[0]!.progress).toBe(0.47);
  });

  it('harvests, transports, regenerates and respects full warehouse and pile limits while absent', async () => {
    const sim = new PrototypeSimulation(createNewWorld());
    sim.assign('r1', 'woodcutter'); sim.assign('r2', 'miner'); sim.assign('r3', 'hauler');
    sim.world.lastSimulatedAtMs = now - 600_000;
    const report = await catchUpSettlement(sim, now, options);
    expect(report.harvested.wood).toBeGreaterThan(0); expect(report.delivered.stone).toBeGreaterThan(0);
    expect(sim.totals().stored).toBe(120);
    expect(sim.world.stockpiles.slice(0, 2).map((pile) => pile.amount)).toEqual([10, 10]);
    expect(sim.world.residents.every((person) => !person.cargo || person.cargoAmount <= 10)).toBe(true);
  });

  it('ignores backwards time, establishes old-save timestamps, caps long absences and yields to the UI', async () => {
    const sim = new PrototypeSimulation(createNewWorld());
    expect((await catchUpSettlement(sim, now, options)).seconds).toBe(0);
    expect((await catchUpSettlement(sim, now - 1000, options)).seconds).toBe(0);
    let yields = 0;
    const report = await catchUpSettlement(sim, now + 3 * 86400_000,
      { yieldToUi: async () => { yields++; } });
    expect(report).toMatchObject({ seconds: 8 * 3600, capped: true });
    expect(yields).toBeGreaterThan(1);
    expect(sim.world.lastSimulatedAtMs).toBe(now + 3 * 86400_000);
    expect((await catchUpSettlement(sim, now + 3 * 86400_000, options)).seconds).toBe(0);
  }, 30_000);
});
