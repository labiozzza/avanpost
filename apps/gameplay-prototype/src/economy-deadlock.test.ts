import { describe, expect, it } from 'vitest';
import { createNewWorld, parseSavedWorld, PrototypeSimulation, costOf, ECONOMY_VERSION, WORLD,
  type PrototypeWorld, type Resource } from './simulation.js';

function advanceUntil(sim: PrototypeSimulation, predicate: () => boolean, seconds: number): boolean {
  for (let tick = 0; tick < seconds * 10 && !predicate(); tick++) sim.step(0.1);
  return predicate();
}

describe('Owner regression: full store, hauler becomes builder', () => {
  it('allows a newly assigned builder with cargo to supply a site when the only store is full', () => {
    const sim = new PrototypeSimulation(createNewWorld());
    sim.assign('r1', 'woodcutter'); sim.assign('r2', 'miner'); sim.assign('r3', 'hauler');
    advanceUntil(sim, () => sim.totals().stored === sim.totals().capacity, 240);
    // A worker who already has a load must keep it through either profession change.
    // Existing v0.9 saves can already contain a carrier blocked with cargo.
    // New gatherers correctly leave that same stock on the ground instead.
    const pile = sim.world.stockpiles[0]!;
    expect(advanceUntil(sim, () => pile.amount === 10, 60)).toBe(true);
    pile.amount -= 10;
    Object.assign(sim.world.residents[2]!, { cargo: 'wood', cargoAmount: 10, mode: 'blocked' });
    sim.assign('r3', 'hauler');
    sim.assign('r3', 'builder');
    sim.place('house', 1);
    sim.setLogisticsMode('r1', 'independent'); sim.setLogisticsMode('r2', 'independent');
    expect(advanceUntil(sim, () => sim.world.residents.length === 4, 480),
      JSON.stringify(sim.world.residents)).toBe(true);
  });
  it.each([0.1, 0.5, 1, 2, 4, 8, 16, 30])('preserves autonomous pickup on reload after %s seconds', (delay) => {
    let sim = new PrototypeSimulation(createNewWorld());
    sim.assign('r1', 'woodcutter'); sim.assign('r2', 'miner'); sim.assign('r3', 'hauler');
    advanceUntil(sim, () => sim.totals().stored === sim.totals().capacity, 240);
    sim.assign('r3', 'builder'); sim.place('house', 1);
    advanceUntil(sim, () => false, delay);
    sim = new PrototypeSimulation(parseSavedWorld(JSON.stringify(sim.world))!);
    sim.setLogisticsMode('r1', 'independent'); sim.setLogisticsMode('r2', 'independent');
    expect(advanceUntil(sim, () => sim.world.residents.length === 4, 480), JSON.stringify({
      sites: sim.world.sites, residents: sim.world.residents, requests: sim.world.logisticsRequests
    }, null, 2)).toBe(true);
  });
  it.each([0, 0.1, 1, 3, 5, 10, 20, 30, 60])('resumes after waiting %s seconds with a full store', (delay) => {
    const sim = new PrototypeSimulation(createNewWorld());
    sim.assign('r1', 'woodcutter'); sim.assign('r2', 'miner'); sim.assign('r3', 'hauler');
    expect(advanceUntil(sim, () => sim.totals().stored === sim.totals().capacity, 240)).toBe(true);
    advanceUntil(sim, () => false, delay);
    sim.assign('r3', 'builder'); sim.place('house', 1);
    advanceUntil(sim, () => false, 40);
    sim.setLogisticsMode('r1', 'independent'); sim.setLogisticsMode('r2', 'independent');
    expect(advanceUntil(sim, () => sim.world.residents.length === 4, 480), JSON.stringify({
      sites: sim.world.sites, residents: sim.world.residents, requests: sim.world.logisticsRequests
    }, null, 2)).toBe(true);
  });
  it('starts construction after physical delivery and resumes autonomous gathering', () => {
    const sim = new PrototypeSimulation(createNewWorld());
    sim.assign('r1', 'woodcutter');
    sim.assign('r2', 'miner');
    sim.assign('r3', 'hauler');
    expect(advanceUntil(sim, () => sim.totals().stored === sim.totals().capacity, 240)).toBe(true);
    sim.assign('r3', 'builder');
    sim.place('house', 1);
    advanceUntil(sim, () => sim.world.sites[0]?.progress! > 0, 180);
    sim.setLogisticsMode('r1', 'independent');
    sim.setLogisticsMode('r2', 'independent');
    const finished = advanceUntil(sim, () => sim.world.residents.length === 4, 480);
    expect(finished, JSON.stringify({ sites: sim.world.sites, residents: sim.world.residents,
      requests: sim.world.logisticsRequests, stores: sim.world.stores }, null, 2)).toBe(true);
  });
});

function physical(world: PrototypeWorld, item: Resource): number {
  return world.stores.reduce((sum, store) => sum + store[item], 0) +
    world.residents.reduce((sum, person) => sum + (person.cargo === item ? person.cargoAmount : 0), 0) +
    world.stockpiles.reduce((sum, pile) => sum + (pile.resource === item ? pile.amount : 0), 0) +
    world.sites.reduce((sum, site) => sum + (item === 'wood' ? site.deliveredWood : site.deliveredStone), 0);
}

describe('Economy migration and conservation', () => {
  it('recovers after repeated profession and mode changes, including reloads during transport', () => {
    let sim = new PrototypeSimulation(createNewWorld());
    sim.place('house', 1);
    let seed = 7070;
    const random = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed; };
    const roles = ['woodcutter', 'miner', 'hauler', 'builder', 'idle'] as const;
    for (let tick = 0; tick < 1800; tick++) {
      if (tick % 37 === 0) {
        const person = sim.world.residents[random() % 3]!;
        sim.assign(person.id, roles[random() % roles.length]!);
        sim.setLogisticsMode(person.id, random() % 2 ? 'independent' : 'hauler');
      }
      if (tick % 73 === 0) sim = new PrototypeSimulation(parseSavedWorld(JSON.stringify(sim.world))!);
      sim.step(0.1);
      expect(sim.world.stores.every((store) => store.wood >= 0 && store.stone >= 0 &&
        store.wood + store.stone <= store.capacity)).toBe(true);
      expect(sim.world.residents.every((person) => person.cargoAmount <= 10)).toBe(true);
    }
    sim.assign('r1', 'woodcutter'); sim.assign('r2', 'miner'); sim.assign('r3', 'builder');
    expect(advanceUntil(sim, () => sim.world.residents.length === 4, 600),
      JSON.stringify(sim.world.residents)).toBe(true);
  });

  it('sets an unusable builder load down physically to free a full warehouse', () => {
    const sim = new PrototypeSimulation(createNewWorld());
    sim.world.stores[0]!.wood = 120; sim.world.stores[0]!.stone = 0;
    sim.place('house', 1); sim.world.sites[0]!.deliveredStone = 50;
    Object.assign(sim.world.residents[2]!, { cargo: 'stone', cargoAmount: 10 });
    sim.assign('r3', 'builder');
    const before = physical(sim.world, 'stone');
    expect(advanceUntil(sim, () => sim.world.residents.length === 4, 400)).toBe(true);
    expect(physical(sim.world, 'stone') + costOf('house').stone).toBe(before);
    expect(sim.world.stockpiles.filter((pile) => pile.sourceId === 'overflow')
      .every((pile) => pile.amount <= 10)).toBe(true);
  });

  it('scales all physical stocks once, splits oversized loads without loss and preserves progress', () => {
    const old = createNewWorld();
    delete old.economyVersion;
    old.stores[0]!.wood = 3; old.stores[0]!.stone = 2; old.stores[0]!.capacity = 12;
    old.woodSource = 23; old.stoneSource = 19; old.woodSourceRecoverySeconds = 90;
    old.easternSector.woodStock = 8;
    old.stockpiles[0]!.amount = 8;
    old.residents[0] = { ...old.residents[0]!, role: 'hauler', cargo: 'wood', cargoAmount: 4,
      mode: 'carrying', targetSiteId: 'old-site', targetX: 690, targetY: WORLD.groundY,
      logisticsRequestId: 'old-request' };
    old.sites.push({ id: 'old-site', kind: 'house', x: 690, y: WORLD.groundY,
      deliveredWood: 2, deliveredStone: 1, progress: 0.42, stage: 1 });
    old.occupiedPlots.push(1);
    old.landCells[4]!.state = 'clearing'; old.landCells[4]!.clearingProgress = 0.3;
    old.landCells[4]!.clearingPaused = true;
    old.buildings[0]!.demolition = { state: 'demolishing', progress: 0.25, workerId: null,
      paused: true, blockedReason: 'Пауза' };
    old.logisticsRequests.push({ id: 'old-request', sequence: 1, createdAt: 4,
      initiatorId: 'r2', type: 'DELIVER_TO_CONSTRUCTION', resource: 'wood', amount: 4,
      pickupStockpileId: null, pickupStoreId: 'store-1', destinationStoreId: null,
      destinationSiteId: 'old-site', status: 'in_progress', assignedHaulerId: 'r1' });
    const before = { wood: physical(old, 'wood'), stone: physical(old, 'stone') };
    const loaded = parseSavedWorld(JSON.stringify(old))!;
    expect(loaded.economyVersion).toBe(ECONOMY_VERSION);
    for (const item of ['wood', 'stone'] as const) expect(physical(loaded, item)).toBe(before[item] * 10);
    expect(loaded.stores[0]).toMatchObject({ wood: 30, stone: 20, capacity: 120 });
    expect(loaded.woodSource).toBe(230); expect(loaded.stoneSource).toBe(190);
    expect(loaded.woodSourceRecoverySeconds).toBe(9);
    expect(loaded.easternSector.woodStock).toBe(80);
    expect(loaded.sites[0]).toMatchObject({ progress: 0.42, deliveredWood: 20, deliveredStone: 10 });
    expect(loaded.landCells[4]).toMatchObject({ state: 'clearing', clearingProgress: 0.3 });
    expect(loaded.buildings[0]!.demolition?.progress).toBe(0.25);
    expect(loaded.residents[0]).toMatchObject({ cargoAmount: 10, targetSiteId: 'old-site' });
    expect(loaded.logisticsRequests[0]).toMatchObject({ amount: 10, status: 'in_progress' });
    expect(loaded.stockpiles.every((pile) => pile.capacity === 10 && pile.amount <= 10)).toBe(true);
    expect(loaded.stockpiles.filter((pile) => pile.sourceId === 'migration' && pile.x === old.residents[0]!.x)
      .reduce((sum, pile) => sum + pile.amount, 0)).toBe(30);
    const again = parseSavedWorld(JSON.stringify(loaded))!;
    expect(again).toEqual(loaded);
    const sim = new PrototypeSimulation(again);
    sim.cancelSite('old-site');
    expect(physical(sim.world, 'wood')).toBe(before.wood * 10);
    expect(physical(sim.world, 'stone')).toBe(before.stone * 10);
    sim.cancelSite('old-site');
    expect(physical(sim.world, 'wood')).toBe(before.wood * 10);
  });

  it('conserves every unit through full-store reassignment, delivery and house completion', () => {
    const sim = new PrototypeSimulation(createNewWorld());
    const initial = { wood: physical(sim.world, 'wood') + sim.world.woodSource,
      stone: physical(sim.world, 'stone') + sim.world.stoneSource };
    const regenerated = { wood: 0, stone: 0 };
    sim.assign('r1', 'woodcutter'); sim.assign('r2', 'miner'); sim.assign('r3', 'hauler');
    let placed = false, building = false, resumed = false;
    for (let tick = 0; tick < 7000 && sim.world.residents.length < 4; tick++) {
      const w = sim.world;
      if (!placed && sim.totals().stored === 120) {
        sim.assign('r3', 'builder'); expect(sim.place('house', 1).ok).toBe(true); placed = true;
        sim.setLogisticsMode('r1', 'independent'); sim.setLogisticsMode('r2', 'independent');
      }
      // Account only for the documented natural regeneration, never for reservations.
      if (w.woodSource < 320 && w.woodSourceRecoverySeconds + 0.1 >= 18) regenerated.wood++;
      if (w.stoneSource < 300 && w.stoneSourceRecoverySeconds + 0.1 >= 24) regenerated.stone++;
      sim.step(0.1);
      building ||= w.residents.some((person) => person.role === 'builder' && person.mode === 'building');
      resumed ||= placed && w.residents.some((person) =>
        ['r1', 'r2'].includes(person.id) && person.mode === 'carrying' && person.targetStoreId !== null);
      for (const item of ['wood', 'stone'] as const) {
        const spent = w.buildings.filter((b) => b.kind === 'house').length * costOf('house')[item];
        expect(physical(w, item) + (item === 'wood' ? w.woodSource : w.stoneSource) + spent)
          .toBe(initial[item] + regenerated[item]);
      }
      expect(w.stores.every((store) => store.wood + store.stone <= store.capacity)).toBe(true);
    }
    expect({ placed, building, resumed, population: sim.world.residents.length })
      .toEqual({ placed: true, building: true, resumed: true, population: 4 });
  });

  it('restores capacity reservations using full loads and releases unpicked work immediately', () => {
    const w = createNewWorld(); w.stores[0]!.wood = 100; w.stores[0]!.stone = 5;
    for (const person of w.residents.slice(0, 2)) Object.assign(person, {
      cargo: 'wood', cargoAmount: 10, mode: 'carrying', targetStoreId: 'store-1' });
    const restored = parseSavedWorld(JSON.stringify(w))!;
    expect(restored.residents.filter((person) => person.targetStoreId === 'store-1')).toHaveLength(1);
    expect(physical(restored, 'wood')).toBe(120);
    const sim = new PrototypeSimulation(createNewWorld());
    sim.assign('r1', 'woodcutter'); sim.assign('r3', 'hauler');
    sim.world.stockpiles[0]!.amount = 10;
    sim.step(0.1);
    const request = sim.world.logisticsRequests[0]!;
    sim.setLogisticsMode('r1', 'independent');
    expect(request.status).toBe('cancelled');
    expect(sim.world.residents[2]!.logisticsRequestId).toBeNull();
    expect(sim.world.residents[0]!.mode).toBe('moving');
    expect(advanceUntil(sim, () => sim.world.stores[0]!.wood >= 40, 25)).toBe(true);
  });

  it('explains a genuine lack of progress without resetting residents', () => {
    const sim = new PrototypeSimulation(createNewWorld());
    sim.place('house', 1);
    sim.assign('r1', 'woodcutter'); sim.assign('r2', 'miner');
    sim.world.stores[0]!.wood = 70; sim.world.stores[0]!.stone = 50;
    advanceUntil(sim, () => false, 600);
    const position = sim.world.residents.map((person) => person.x);
    // Natural stock regeneration is still progress; saturate it to inspect the full-store wait.
    sim.world.woodSource = 320; sim.world.stoneSource = 300;
    advanceUntil(sim, () => false, 20);
    expect(sim.diagnostics.issues).toContain('builder_missing');
    expect(sim.residentDiagnosis(sim.world.residents[0]!).code).toBe('stockpile_full');
    expect(sim.world.residents.map((person) => person.x)).toEqual(position);
    sim.assign('r3', 'builder');
    expect(advanceUntil(sim, () => sim.world.residents.length === 4, 480)).toBe(true);
  });
});
