import { describe, expect, it } from 'vitest';
import {
  createNewWorld, parseSavedWorld, PROTOTYPE_CONFIG, PrototypeSimulation, STORAGE_KEY, WORLD,
  type PrototypeLogisticsRequest
} from './simulation.js';

function run(simulation: PrototypeSimulation, seconds: number): void {
  const frames = Math.ceil(seconds * 10);
  for (let index = 0; index < frames; index++) simulation.step(0.1);
}

function easternWoodTrip(stores: PrototypeSimulation['world']['stores'], stock = 1) {
  const world = createNewWorld();
  world.stores = stores.map((store) => ({ ...store }));
  world.easternSector.state = 'prepared';
  world.easternSector.clearingProgress = 1;
  world.easternForestAvailable = true;
  world.easternSector.woodStock = stock;
  world.residents[0]!.x = PROTOTYPE_CONFIG.easternSector.forestX;
  const simulation = new PrototypeSimulation(world);
  simulation.assign('r1', 'woodcutter');
  simulation.setWoodSource('r1', 'eastern');
  return simulation;
}

function waitForCargo(simulation: PrototypeSimulation, seconds = 6): void {
  const frames = Math.ceil(seconds * 10);
  for (let index = 0; index < frames && !simulation.world.residents[0]!.cargo; index++) {
    simulation.step(0.1);
  }
}

describe('Gameplay prototype simulation', () => {
  it('starts with three residents and finite physical sources', () => {
    const world = createNewWorld();
    const simulation = new PrototypeSimulation(world);
    expect(simulation.world.residents).toHaveLength(3);
    expect(simulation.world.woodSource).toBeGreaterThan(0);
    expect(simulation.world.stoneSource).toBeGreaterThan(0);
    expect(simulation.totals()).toMatchObject({ population: 3, housing: 3, capacity: 12 });
  });

  it('harvests one physical unit and deposits it at the warehouse after a visible trip', () => {
    const simulation = new PrototypeSimulation(createNewWorld());
    const beforeSource = simulation.world.woodSource;
    const beforeStock = simulation.world.stores[0]!.wood;
    simulation.assign('r1', 'woodcutter');
    run(simulation, 15);
    expect(simulation.world.woodSource).toBeLessThan(beforeSource);
    expect(simulation.world.stores[0]!.wood).toBeGreaterThan(beforeStock);
  });

  it('physically supplies a house, builds it in stages, and welcomes the fourth resident', () => {
    const simulation = new PrototypeSimulation(createNewWorld());
    expect(simulation.place('house', 1)).toEqual({ ok: true });
    simulation.assign('r1', 'builder');
    simulation.assign('r2', 'woodcutter');
    simulation.assign('r3', 'miner');
    run(simulation, 260);
    expect(simulation.world.sites).toHaveLength(0);
    expect(simulation.world.buildings.filter((building) => building.kind === 'house')).toHaveLength(1);
    expect(simulation.world.residents).toHaveLength(4);
    expect(simulation.totals().housing).toBe(4);
  });

  it('adds real storage capacity and restores the complete settlement from its isolated save key', () => {
    const simulation = new PrototypeSimulation(createNewWorld());
    expect(simulation.place('warehouse', 0)).toEqual({ ok: true });
    simulation.assign('r1', 'builder');
    simulation.assign('r2', 'woodcutter');
    simulation.assign('r3', 'miner');
    run(simulation, 240);
    expect(simulation.world.stores).toHaveLength(2);
    expect(simulation.totals().capacity).toBe(24);
    const loaded = parseSavedWorld(JSON.stringify(simulation.world));
    expect(loaded).not.toBeNull();
    expect(loaded?.stores).toHaveLength(2);
    expect(STORAGE_KEY).toBe('avanpost:gameplay-prototype:v01');
  });

  it('preserves and projects depth-map saves onto the side-view scene', () => {
    const fresh = createNewWorld();
    const depthSave = {
      ...fresh,
      mapVersion: 2,
      woodSource: 17,
      stoneSource: 21,
      residents: [
        { ...fresh.residents[0]!, x: 812, y: 980, role: 'builder' as const, targetX: 590, targetY: 1050 },
        ...fresh.residents.slice(1)
      ],
      stores: [{ id: 'store-1', x: 812, y: 860, wood: 4, stone: 3, capacity: 12 }],
      buildings: [{ id: 'house-1', kind: 'house' as const, x: 638, y: 1050 }],
      sites: [{
        id: 'site-2', kind: 'warehouse' as const, x: 1032, y: 720,
        deliveredWood: 2, deliveredStone: 1, progress: 0.4, stage: 1
      }],
      occupiedPlots: [1, 2]
    };
    const loaded = parseSavedWorld(JSON.stringify(depthSave));

    expect(loaded).not.toBeNull();
    expect(loaded?.mapVersion).toBe(3);
    expect(loaded?.woodSource).toBe(17);
    expect(loaded?.stoneSource).toBe(21);
    expect(loaded?.residents).toHaveLength(3);
    expect(loaded?.residents[0]).toMatchObject({
      x: 936, y: WORLD.groundY, role: 'builder', targetX: 680, targetY: WORLD.groundY
    });
    expect(loaded?.stores[0]).toEqual({ id: 'store-1', x: 936, wood: 4, stone: 3, capacity: 12 });
    expect(loaded?.buildings[0]).toMatchObject({ id: 'house-1', kind: 'house', x: 690, y: WORLD.groundY });
    expect(loaded?.sites[0]).toMatchObject({
      id: 'site-2', kind: 'warehouse', x: 1240, y: WORLD.groundY,
      deliveredWood: 2, deliveredStone: 1, progress: 0.4, stage: 1
    });
    expect(loaded?.occupiedPlots).toEqual([1, 2]);
    expect(STORAGE_KEY).toBe('avanpost:gameplay-prototype:v01');
  });

  it('does not reinterpret legacy depth-map plot IDs as the new eastern build plots', () => {
    const legacy = createNewWorld();
    legacy.mapVersion = 2;
    legacy.buildings = [{ id: 'old-depth-house', kind: 'house', x: 600, y: 1380 }];
    legacy.sites = [{
      id: 'old-depth-site', kind: 'warehouse', x: 850, y: 1450,
      deliveredWood: 1, deliveredStone: 0, progress: 0, stage: 0
    }];
    legacy.occupiedPlots = [4, 5];

    const migrated = parseSavedWorld(JSON.stringify(legacy));
    expect(migrated).not.toBeNull();
    expect(migrated?.buildings[0]?.x).toBe(692);
    expect(migrated?.sites[0]?.x).toBe(980);
    expect(migrated?.occupiedPlots).toEqual([1]);
    migrated!.easternSector.state = 'prepared';
    migrated!.easternSector.clearingProgress = 1;
    expect(new PrototypeSimulation(migrated!).isPlotAvailable(4)).toBe(true);
  });

  it('migrates an original side-view save once while preserving state and save identity', () => {
    const original = createNewWorld();
    delete original.mapVersion;
    original.residents.forEach((person, index) => {
      person.x = [475, 535, 595][index]!;
    });
    original.residents[0]!.x = 475;
    original.residents[0]!.targetX = 130;
    original.stores[0]!.x = 535;
    original.buildings = [{ id: 'house-1', kind: 'house', x: 420, y: 414 }];
    original.occupiedPlots = [1];

    const loaded = parseSavedWorld(JSON.stringify(original));
    expect(loaded?.mapVersion).toBe(3);
    expect(loaded?.residents).toHaveLength(3);
    expect(loaded?.residents[0]).toMatchObject({ x: 855, targetX: 234, y: WORLD.groundY });
    expect(loaded?.stores[0]).toMatchObject({ x: 963 });
    expect(loaded?.buildings[0]).toMatchObject({ id: 'house-1', x: 690, y: WORLD.groundY });
    expect(loaded?.occupiedPlots).toEqual([1]);
    expect(parseSavedWorld(JSON.stringify(loaded))?.residents[0]?.x).toBe(855);
    expect(STORAGE_KEY).toBe('avanpost:gameplay-prototype:v01');
  });

  it('rejects malformed or foreign saves instead of replacing the new-game state', () => {
    expect(parseSavedWorld(null)).toBeNull();
    expect(parseSavedWorld('{')).toBeNull();
    expect(parseSavedWorld(JSON.stringify({ version: 2, residents: [], stores: [], buildings: [], sites: [] }))).toBeNull();
  });

  it('keeps the eastern plots unavailable until the sector is both opened and prepared', () => {
    const simulation = new PrototypeSimulation(createNewWorld());
    expect(simulation.world.easternSector.state).toBe('closed');
    expect(simulation.isPlotAvailable(4)).toBe(false);
    expect(simulation.place('house', 4)).toMatchObject({ ok: false, reason: expect.stringContaining('закрыта лесом') });

    simulation.world.buildings.push({ id: 'house-1', kind: 'house', x: 690, y: WORLD.groundY });
    simulation.world.landCells.find((cell) => cell.id === 4)!.state = 'unlocked';
    expect(simulation.isPlotAvailable(4)).toBe(false);
    expect(simulation.place('warehouse', 4)).toMatchObject({ ok: false, reason: 'Сначала полностью расчисти эту клетку.' });

    simulation.world.landCells.find((cell) => cell.id === 4)!.state = 'prepared';
    simulation.world.landCells.find((cell) => cell.id === 4)!.clearingProgress = 1;
    expect(simulation.isPlotAvailable(4)).toBe(true);
    expect(simulation.isPlotAvailable(5)).toBe(false);
    expect(simulation.place('house', 4)).toEqual({ ok: true });
  });

  it('unlocks the eastern sector only after a house and atomically spends stored resources', () => {
    const world = createNewWorld();
    const simulation = new PrototypeSimulation(world);
    const before = simulation.totals();
    expect(simulation.unlockEasternSector()).toMatchObject({ ok: false, reason: 'Сначала построй первый дом.' });
    expect(simulation.totals()).toMatchObject({ wood: before.wood, stone: before.stone });

    world.buildings.push({ id: 'house-1', kind: 'house', x: 690, y: WORLD.groundY });
    world.stores = [
      { id: 'store-1', x: 963, wood: 7, stone: 4, capacity: 12 },
      { id: 'store-2', x: 1590, wood: 1, stone: 1, capacity: 12 }
    ];
    expect(simulation.unlockEasternSector()).toEqual({ ok: true });
    expect(world.easternSector.state).toBe('unlocked');
    expect(world.landCells.filter((cell) => cell.id >= 4).map((cell) => cell.state)).toEqual([
      'unlocked', 'closed', 'closed', 'closed'
    ]);
    expect(simulation.totals()).toMatchObject({ wood: 0, stone: 0 });
    expect(world.stores.every((store) => store.wood >= 0 && store.stone >= 0)).toBe(true);
    expect(world.currentGoal).toBe('prepare-eastern-sector');
  });

  it('opens the next adjacent cell only after the current cell is prepared', () => {
    const world = createNewWorld();
    world.buildings.push({ id: 'house-1', kind: 'house', x: 690, y: WORLD.groundY });
    world.stores = [{ id: 'store-1', x: 963, wood: 30, stone: 20, capacity: 60 }];
    world.residents[0]!.role = 'hauler';
    world.residents[1]!.role = 'hauler';
    const simulation = new PrototypeSimulation(world);

    expect(simulation.unlockEasternSector()).toEqual({ ok: true });
    expect(simulation.unlockEasternSector()).toMatchObject({ ok: false });
    expect(world.landCells.filter((cell) => cell.id >= 4).map((cell) => cell.state)).toEqual([
      'unlocked', 'closed', 'closed', 'closed'
    ]);
    expect(simulation.isPlotAvailable(5)).toBe(false);

    world.residents[2]!.x = world.landCells.find((cell) => cell.id === 4)!.x;
    expect(simulation.startEasternClearing()).toEqual({ ok: true });
    run(simulation, PROTOTYPE_CONFIG.expansion.clearingWorkSeconds + 1);
    expect(world.landCells.find((cell) => cell.id === 4)).toMatchObject({ state: 'prepared', clearingProgress: 1 });

    const storedBeforeSecondUnlock = simulation.availableInStores('wood');
    expect(simulation.unlockEasternSector()).toEqual({ ok: true });
    expect(world.landCells.filter((cell) => cell.id >= 4).map((cell) => cell.state)).toEqual([
      'prepared', 'unlocked', 'closed', 'closed'
    ]);
    expect(simulation.isPlotAvailable(4)).toBe(true);
    expect(simulation.isPlotAvailable(5)).toBe(false);
    expect(simulation.availableInStores('wood')).toBe(
      storedBeforeSecondUnlock - PROTOTYPE_CONFIG.expansion.unlockCost.wood
    );
  });

  it('sends a real worker to clearing, pauses without losing progress, then resumes to prepared', () => {
    const world = createNewWorld();
    world.buildings.push({ id: 'house-1', kind: 'house', x: 690, y: WORLD.groundY });
    world.landCells.find((cell) => cell.id === 4)!.state = 'unlocked';
    world.residents[2]!.role = 'builder';
    const simulation = new PrototypeSimulation(world);

    expect(simulation.startEasternClearing()).toEqual({ ok: true });
    expect(world.easternSector.state).toBe('clearing');
    expect(world.easternSector.clearerId).toBe('r3');
    run(simulation, 4);
    expect(world.residents[2]!.x).toBeGreaterThan(1180);
    expect(world.residents[2]!.x).toBeLessThan(PROTOTYPE_CONFIG.easternSector.clearingX);
    expect(world.easternSector.clearingProgress).toBe(0);
    run(simulation, 6);
    expect(world.easternSector.clearingProgress).toBeGreaterThan(0);

    const savedProgress = world.easternSector.clearingProgress;
    simulation.assign('r3', 'woodcutter');
    expect(world.easternSector.clearingPaused).toBe(true);
    run(simulation, 8);
    expect(world.easternSector.clearingProgress).toBe(savedProgress);

    simulation.assign('r3', 'idle');
    expect(simulation.startEasternClearing()).toEqual({ ok: true });
    run(simulation, PROTOTYPE_CONFIG.easternSector.clearingWorkSeconds + 12);
    expect(world.landCells.find((cell) => cell.id === 4)).toMatchObject({ state: 'prepared', clearingProgress: 1, clearerId: null });
    expect(simulation.isPlotAvailable(4)).toBe(true);
    expect(simulation.isPlotAvailable(5)).toBe(false);
  });

  it('walks to the new forest and carries harvested wood back to the existing warehouse', () => {
    const world = createNewWorld();
    world.easternSector.state = 'prepared';
    world.easternForestAvailable = true;
    world.easternSector.clearingProgress = 1;
    const beforeWood = world.stores[0]!.wood;
    const beforeForest = world.easternSector.woodStock;
    const simulation = new PrototypeSimulation(world);
    simulation.assign('r1', 'woodcutter');
    expect(simulation.setWoodSource('r1', 'eastern')).toEqual({ ok: true });

    run(simulation, 1);
    expect(world.residents[0]!.x).toBeGreaterThan(640);
    expect(world.easternSector.woodStock).toBe(beforeForest);
    run(simulation, 24);

    expect(world.easternSector.woodStock).toBeLessThan(beforeForest);
    expect(world.residents[0]!.cargo).toBe('wood');
    expect(world.stores[0]!.wood).toBe(beforeWood);
    run(simulation, 20);
    expect(world.stores[0]!.wood).toBeGreaterThan(beforeWood);
  });

  it('rejects eastern-forest assignments until the sector is prepared', () => {
    const world = createNewWorld();
    const simulation = new PrototypeSimulation(world);
    simulation.assign('r1', 'woodcutter');

    for (const state of ['closed', 'unlocked', 'clearing'] as const) {
      world.easternSector.state = state;
      const result = simulation.setWoodSource('r1', 'eastern');
      expect(result).toEqual({ ok: false, reason: 'Сначала подготовь Восточную опушку.' });
      expect(world.residents[0]!.woodSource).toBe('home');
    }

    world.easternForestAvailable = true;
    expect(simulation.setWoodSource('r1', 'eastern')).toEqual({ ok: true });
    expect(world.residents[0]!.woodSource).toBe('eastern');
  });

  it('retains cargo when every warehouse is full and slowly restores baseline sources', () => {
    const world = createNewWorld();
    world.easternSector.state = 'prepared';
    world.easternSector.woodStock = 1;
    world.stores = [{ id: 'store-1', x: 963, wood: 7, stone: 5, capacity: 12 }];
    const simulation = new PrototypeSimulation(world);
    simulation.assign('r1', 'woodcutter');
    simulation.setWoodSource('r1', 'eastern');
    run(simulation, 24);
    expect(world.residents[0]!.cargo).toBe('wood');
    expect(world.residents[0]!.mode).toBe('blocked');
    expect(world.easternSector.woodStock).toBe(0);
    expect(simulation.totals().stored).toBe(12);

    world.woodSource = 0;
    world.stoneSource = 0;
    world.easternSector.woodStock = 0;
    run(simulation, 242);
    expect(world.woodSource).toBeGreaterThan(0);
    expect(world.stoneSource).toBeGreaterThan(0);
    expect(world.easternSector.woodStock).toBeGreaterThan(0);
  });

  it('migrates pre-sector saves while preserving settlement and clearing progress on newer saves', () => {
    const oldSave = createNewWorld();
    oldSave.buildings.push({ id: 'house-1', kind: 'house', x: 690, y: WORLD.groundY });
    oldSave.stores.push({ id: 'store-2', x: 1590, wood: 2, stone: 1, capacity: 12 });
    delete (oldSave as Partial<typeof oldSave>).easternSector;
    delete (oldSave as Partial<typeof oldSave>).currentGoal;
    delete (oldSave as Partial<typeof oldSave>).woodSourceRecoverySeconds;
    delete (oldSave as Partial<typeof oldSave>).stoneSourceRecoverySeconds;
    delete (oldSave.residents[0] as Partial<(typeof oldSave.residents)[number]>).woodSource;

    const migrated = parseSavedWorld(JSON.stringify(oldSave));
    expect(migrated).not.toBeNull();
    expect(migrated).toMatchObject({
      easternSector: { state: 'closed', clearingProgress: 0, clearerId: null },
      currentGoal: 'unlock-eastern-sector',
      buildings: [{ id: 'house-1', kind: 'house', x: 690, y: WORLD.groundY }],
      stores: [{ id: 'store-1' }, { id: 'store-2' }]
    });
    expect(migrated?.residents[0]?.woodSource).toBe('home');

    migrated!.easternSector.state = 'clearing';
    migrated!.easternSector.clearingProgress = 0.42;
    migrated!.easternSector.clearingPaused = true;
    migrated!.easternSector.clearerId = 'r3';
    const restored = parseSavedWorld(JSON.stringify(migrated));
    expect(restored?.easternSector).toMatchObject({
      state: 'clearing', clearingProgress: 0.42, clearingPaused: true, clearerId: 'r3'
    });
    const orphaned = parseSavedWorld(JSON.stringify({
      ...migrated,
      easternSector: {
        ...migrated!.easternSector,
        clearerId: 'missing-resident',
        clearingPaused: false
      }
    }));
    expect(orphaned?.easternSector).toMatchObject({
      state: 'clearing', clearingProgress: 0.42, clearingPaused: true, clearerId: null
    });

    const reassigned = parseSavedWorld(JSON.stringify({
      ...migrated,
      residents: migrated!.residents.map((person, index) => index === 2
        ? { ...person, role: 'woodcutter' as const, cargo: null }
        : person),
      easternSector: {
        ...migrated!.easternSector,
        clearerId: 'r3',
        clearingPaused: false
      }
    }));
    expect(reassigned?.easternSector).toMatchObject({
      state: 'clearing', clearingProgress: 0.42, clearingPaused: true, clearerId: 'r3'
    });
  });

  it('migrates a prepared v0.7 eastern sector to exactly its two already-open cells', () => {
    const old = createNewWorld();
    old.easternSector.state = 'prepared';
    old.easternSector.clearingProgress = 1;
    old.buildings = [{ id: 'old-house-east', kind: 'house', x: 2380, y: WORLD.groundY }];
    old.sites = [{
      id: 'old-store-east', kind: 'warehouse', x: 2780, y: WORLD.groundY,
      deliveredWood: 2, deliveredStone: 1, progress: 0.3, stage: 0
    }];
    old.occupiedPlots = [4, 5];
    delete (old as Partial<typeof old>).landCells;
    delete (old as Partial<typeof old>).easternForestAvailable;

    const migrated = parseSavedWorld(JSON.stringify(old));
    expect(migrated).not.toBeNull();
    expect(migrated?.landCells.filter((cell) => cell.state === 'prepared').map((cell) => cell.id)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(migrated?.landCells.find((cell) => cell.id === 6)?.state).toBe('closed');
    expect(migrated?.buildings[0]?.id).toBe('old-house-east');
    expect(migrated?.sites[0]).toMatchObject({ id: 'old-store-east', deliveredWood: 2, deliveredStone: 1, progress: 0.3 });
    expect(migrated?.easternForestAvailable).toBe(true);
    expect(STORAGE_KEY).toBe('avanpost:gameplay-prototype:v01');
  });

  it('routes harvested wood to the nearest available warehouse and credits that exact warehouse', () => {
    const simulation = easternWoodTrip([
      { id: 'store-far', x: 2500, wood: 0, stone: 0, capacity: 8 },
      { id: 'store-near', x: 3150, wood: 0, stone: 0, capacity: 8 }
    ]);
    waitForCargo(simulation);
    const worker = simulation.world.residents[0]!;
    expect(worker.cargo).toBe('wood');
    expect(worker.targetStoreId).toBe('store-near');
    expect(worker.targetX).toBe(3150);
    run(simulation, 1);
    expect(simulation.world.stores).toMatchObject([
      { id: 'store-far', wood: 0 },
      { id: 'store-near', wood: 1 }
    ]);
    expect(worker.cargo).toBeNull();
  });

  it('skips a full nearest warehouse and selects the next nearest one', () => {
    const simulation = easternWoodTrip([
      { id: 'store-near-full', x: 3150, wood: 8, stone: 0, capacity: 8 },
      { id: 'store-next', x: 2500, wood: 0, stone: 0, capacity: 8 }
    ]);
    waitForCargo(simulation);
    expect(simulation.world.residents[0]).toMatchObject({
      cargo: 'wood', targetStoreId: 'store-next', targetX: 2500
    });
    run(simulation, 5);
    expect(simulation.world.stores).toMatchObject([
      { id: 'store-near-full', wood: 8 },
      { id: 'store-next', wood: 1 }
    ]);
  });

  it('keeps harvested cargo while all warehouses are full and resumes after capacity is freed', () => {
    const simulation = easternWoodTrip([
      { id: 'store-near', x: 3150, wood: 8, stone: 0, capacity: 8 },
      { id: 'store-far', x: 2500, wood: 8, stone: 0, capacity: 8 }
    ]);
    waitForCargo(simulation);
    const worker = simulation.world.residents[0]!;
    expect(worker).toMatchObject({ cargo: 'wood', mode: 'blocked', targetStoreId: null });
    expect(simulation.world.easternSector.woodStock).toBe(0);

    simulation.world.stores[1]!.wood--;
    run(simulation, 5);
    expect(worker.cargo).toBeNull();
    expect(simulation.world.stores[1]!.wood).toBe(8);
    expect(simulation.world.stores[0]!.wood).toBe(8);
  });

  it('reroutes cargo if its chosen warehouse fills while the worker is travelling', () => {
    const simulation = easternWoodTrip([
      { id: 'store-near', x: 3150, wood: 0, stone: 0, capacity: 1 },
      { id: 'store-far', x: 2500, wood: 0, stone: 0, capacity: 1 }
    ]);
    waitForCargo(simulation);
    const worker = simulation.world.residents[0]!;
    expect(worker.targetStoreId).toBe('store-near');
    simulation.world.stores[0]!.wood = 1;
    simulation.step(0.1);
    expect(worker).toMatchObject({ cargo: 'wood', targetStoreId: 'store-far', targetX: 2500 });
    run(simulation, 5);
    expect(simulation.world.stores).toMatchObject([
      { id: 'store-near', wood: 1 },
      { id: 'store-far', wood: 1 }
    ]);
    expect(worker.cargo).toBeNull();
  });

  it('breaks equal-distance warehouse choices deterministically by warehouse ID', () => {
    const simulation = easternWoodTrip([
      { id: 'store-z', x: 3150, wood: 0, stone: 0, capacity: 8 },
      { id: 'store-a', x: 3250, wood: 0, stone: 0, capacity: 8 }
    ]);
    waitForCargo(simulation);
    expect(simulation.world.residents[0]).toMatchObject({ targetStoreId: 'store-a', targetX: 3250 });
    run(simulation, 1);
    expect(simulation.world.stores).toMatchObject([
      { id: 'store-z', wood: 0 },
      { id: 'store-a', wood: 1 }
    ]);
  });

  it('saves and restores a wood delivery route without losing or duplicating its cargo', () => {
    const simulation = easternWoodTrip([
      { id: 'store-far', x: 2500, wood: 0, stone: 0, capacity: 8 },
      { id: 'store-near', x: 3150, wood: 0, stone: 0, capacity: 8 }
    ]);
    waitForCargo(simulation);
    expect(simulation.world.residents[0]!.targetStoreId).toBe('store-near');
    const saved = parseSavedWorld(JSON.stringify(simulation.world));
    expect(saved?.residents[0]).toMatchObject({ cargo: 'wood', targetStoreId: 'store-near' });

    const resumed = new PrototypeSimulation(saved!);
    run(resumed, 1);
    expect(resumed.world.stores).toMatchObject([
      { id: 'store-far', wood: 0 },
      { id: 'store-near', wood: 1 }
    ]);
    expect(resumed.world.residents[0]!.cargo).toBeNull();
  });

  it('reserves warehouse space for simultaneous inbound cargo and restores routes without overfilling', () => {
    const world = createNewWorld();
    world.stores = [
      { id: 'store-near', x: 1510, wood: 0, stone: 0, capacity: 1 },
      { id: 'store-next', x: 1550, wood: 0, stone: 0, capacity: 1 }
    ];
    world.residents[0] = {
      ...world.residents[0]!, x: 1500, cargo: 'wood', mode: 'carrying',
      targetStoreId: 'store-near', targetX: 1510, targetY: WORLD.groundY
    };
    world.residents[1] = {
      ...world.residents[1]!, x: 1500, cargo: 'stone', mode: 'carrying',
      targetStoreId: 'store-near', targetX: 1510, targetY: WORLD.groundY
    };

    const restored = parseSavedWorld(JSON.stringify(world));
    expect(restored?.residents.map((person) => person.targetStoreId)).toEqual([
      'store-near', 'store-next', null
    ]);

    const simulation = new PrototypeSimulation(restored!);
    run(simulation, 1);
    expect(simulation.world.stores).toMatchObject([
      { id: 'store-near', wood: 1, stone: 0 },
      { id: 'store-next', wood: 0, stone: 1 }
    ]);
    expect(simulation.world.stores.every((store) => store.wood + store.stone <= store.capacity)).toBe(true);
    expect(simulation.world.residents.slice(0, 2).every((person) => person.cargo === null)).toBe(true);
  });

  it('migrates legacy in-flight cargo without new warehouse route fields', () => {
    const simulation = easternWoodTrip([
      { id: 'store-far', x: 2500, wood: 0, stone: 0, capacity: 8 },
      { id: 'store-near', x: 3150, wood: 0, stone: 0, capacity: 8 }
    ]);
    waitForCargo(simulation);
    const legacy = JSON.parse(JSON.stringify(simulation.world)) as typeof simulation.world;
    delete (legacy.residents[0] as Partial<(typeof legacy.residents)[number]>).targetStoreId;
    delete (legacy.residents[0] as Partial<(typeof legacy.residents)[number]>).pickupStoreId;
    delete (legacy.residents[0] as Partial<(typeof legacy.residents)[number]>).pickupResource;
    const restored = parseSavedWorld(JSON.stringify(legacy));
    expect(restored?.residents[0]).toMatchObject({ cargo: 'wood', targetStoreId: 'store-near' });
    run(new PrototypeSimulation(restored!), 1);
    expect(restored?.stores).toMatchObject([
      { id: 'store-far', wood: 0 },
      { id: 'store-near', wood: 1 }
    ]);
  });

  it('delivers stone to the nearest warehouse from the miner position', () => {
    const world = createNewWorld();
    world.stores = [
      { id: 'store-far', x: 1400, wood: 0, stone: 0, capacity: 8 },
      { id: 'store-near', x: 1950, wood: 0, stone: 0, capacity: 8 }
    ];
    world.residents[0]!.x = 1900;
    const simulation = new PrototypeSimulation(world);
    simulation.assign('r1', 'miner');
    waitForCargo(simulation);
    expect(world.residents[0]).toMatchObject({ cargo: 'stone', targetStoreId: 'store-near' });
    run(simulation, 1);
    expect(world.stores).toMatchObject([
      { id: 'store-far', stone: 0 },
      { id: 'store-near', stone: 1 }
    ]);
  });

  it('physically picks construction wood and stone from the warehouse that loses each unit', () => {
    const world = createNewWorld();
    world.stores = [
      { id: 'store-wood', x: 963, wood: 1, stone: 0, capacity: 12 },
      { id: 'store-stone', x: 1200, wood: 0, stone: 1, capacity: 12 }
    ];
    world.woodSource = 0;
    world.stoneSource = 0;
    const simulation = new PrototypeSimulation(world);
    expect(simulation.place('house', 1)).toEqual({ ok: true });
    simulation.assign('r1', 'builder');

    simulation.step(0.1);
    expect(world.residents[0]).toMatchObject({ pickupStoreId: 'store-wood', pickupResource: 'wood' });
    run(simulation, 2.5);
    expect(world.residents[0]).toMatchObject({ cargo: 'wood', targetSiteId: 'site-2' });
    expect(world.stores[0]!.wood).toBe(0);
    run(simulation, 2.5);
    expect(world.sites[0]!.deliveredWood).toBe(1);

    run(simulation, 0.1);
    expect(world.residents[0]).toMatchObject({ pickupStoreId: 'store-stone', pickupResource: 'stone' });
    run(simulation, 4);
    expect(world.residents[0]!.cargo).toBe('stone');
    expect(world.stores[1]!.stone).toBe(0);
    run(simulation, 4);
    expect(world.sites[0]!.deliveredStone).toBe(1);
    expect(simulation.totals()).toMatchObject({ wood: 0, stone: 0 });
  });

  it('lets a miner work in place until a ten-unit local pile fills', () => {
    const world = createNewWorld();
    world.residents[0]!.role = 'miner';
    world.residents[0]!.x = 1900;
    world.residents[1]!.role = 'hauler';
    world.residents[1]!.x = -2000;
    world.stockpiles.find((pile) => pile.resource === 'stone')!.amount = 9;
    const before = world.stoneSource;
    const simulation = new PrototypeSimulation(world);

    run(simulation, 4);

    expect(world.stockpiles.find((pile) => pile.resource === 'stone')?.amount).toBe(10);
    expect(world.stoneSource).toBe(before - 1);
    expect(world.residents[0]).toMatchObject({ role: 'miner', mode: 'blocked', x: 1900 });
    expect(world.logisticsRequests.some((request) => request.type === 'PICKUP_RESOURCE')).toBe(true);
  });

  it('creates one resource pickup request and lets two haulers assign it only once', () => {
    const world = createNewWorld();
    world.residents[0]!.role = 'woodcutter';
    world.residents[0]!.x = 420;
    world.residents[1]!.role = 'hauler';
    world.residents[1]!.x = 420;
    world.residents[2]!.role = 'hauler';
    world.stockpiles.find((pile) => pile.sourceId === 'home')!.amount = 4;
    const simulation = new PrototypeSimulation(world);

    simulation.step(0.1);

    const requests = world.logisticsRequests.filter((request) => request.initiatorId === 'r1' && request.status !== 'cancelled');
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({ type: 'PICKUP_RESOURCE', amount: 4, status: 'assigned' });
    expect(world.residents.filter((person) => person.logisticsRequestId === requests[0]!.id)).toHaveLength(1);
  });

  it('retargets a stockpile request when its chosen warehouse fills before pickup', () => {
    const world = createNewWorld();
    world.stores = [
      { id: 'store-near', x: 500, wood: 0, stone: 0, capacity: 12 },
      { id: 'store-far', x: 1000, wood: 0, stone: 0, capacity: 12 }
    ];
    world.woodSource = 0;
    world.residents[0]!.role = 'woodcutter';
    world.residents[0]!.x = 420;
    world.residents[1]!.role = 'hauler';
    world.residents[1]!.x = 420;
    world.stockpiles.find((pile) => pile.sourceId === 'home')!.amount = 4;
    const simulation = new PrototypeSimulation(world);

    simulation.step(0.1);
    const request = world.logisticsRequests[0]!;
    expect(request).toMatchObject({ status: 'assigned', destinationStoreId: 'store-near', amount: 4 });

    world.stores[0]!.wood = world.stores[0]!.capacity;
    simulation.step(0.1);

    expect(request.destinationStoreId).toBe('store-far');
    expect(request.assignedHaulerId).toBe('r2');
    run(simulation, 5);

    expect(request.status).toBe('completed');
    expect(world.stockpiles.find((pile) => pile.sourceId === 'home')?.amount).toBe(0);
    expect(world.stores[1]).toMatchObject({ wood: 4, stone: 0 });
    expect(simulation.totals().wood).toBe(16);
  });

  it('keeps a hauler working through wood and stone stockpiles in FIFO order', () => {
    const world = createNewWorld();
    world.stores = [{ id: 'store-1', x: 700, wood: 0, stone: 0, capacity: 12 }];
    world.woodSource = 0;
    world.stoneSource = 0;
    world.residents[0]!.role = 'woodcutter';
    world.residents[0]!.x = 420;
    world.residents[1]!.role = 'miner';
    world.residents[1]!.x = 1740;
    world.residents[2]!.role = 'hauler';
    world.stockpiles.find((pile) => pile.resource === 'wood')!.amount = 3;
    world.stockpiles.find((pile) => pile.resource === 'stone')!.amount = 2;
    const simulation = new PrototypeSimulation(world);

    run(simulation, 25);

    expect(world.logisticsRequests.map((request) => request.type)).toEqual([
      'PICKUP_RESOURCE', 'PICKUP_RESOURCE'
    ]);
    expect(world.logisticsRequests.map((request) => request.status)).toEqual(['completed', 'completed']);
    expect(world.stores[0]).toMatchObject({ wood: 3, stone: 2 });
    expect(simulation.totals()).toMatchObject({ wood: 3, stone: 2 });
  });

  it('resumes harvesting after a full local pile is emptied by a hauler', () => {
    const world = createNewWorld();
    world.stores = [{ id: 'store-1', x: 500, wood: 0, stone: 0, capacity: 12 }];
    world.woodSource = 20;
    world.residents[0]!.role = 'woodcutter';
    world.residents[0]!.x = 420;
    world.residents[0]!.mode = 'blocked';
    world.residents[1]!.role = 'hauler';
    world.residents[1]!.x = 420;
    world.stockpiles.find((pile) => pile.sourceId === 'home')!.amount = 10;
    const sourceBefore = world.woodSource;
    const simulation = new PrototypeSimulation(world);

    run(simulation, 6);

    expect(world.stores[0]!.wood).toBeGreaterThanOrEqual(10);
    expect(world.woodSource).toBeLessThan(sourceBefore);
    expect(world.logisticsRequests[0]).toMatchObject({ type: 'PICKUP_RESOURCE', status: 'completed' });
    expect(world.logisticsRequests.some((request) => request.id !== world.logisticsRequests[0]!.id &&
      request.type === 'PICKUP_RESOURCE' && request.status !== 'cancelled')).toBe(true);
  });

  it('partially delivers a local pile into a nearly full warehouse without overfilling it', () => {
    const world = createNewWorld();
    world.stores = [{ id: 'store-1', x: 500, wood: 3, stone: 1, capacity: 5 }];
    world.woodSource = 0;
    world.residents[0]!.role = 'woodcutter';
    world.residents[0]!.x = 420;
    world.residents[1]!.role = 'hauler';
    world.residents[1]!.x = 420;
    world.stockpiles.find((pile) => pile.sourceId === 'home')!.amount = 8;
    const simulation = new PrototypeSimulation(world);

    run(simulation, 5);

    expect(world.stores[0]).toMatchObject({ wood: 4, stone: 1, capacity: 5 });
    expect(world.stores[0]!.wood + world.stores[0]!.stone).toBeLessThanOrEqual(world.stores[0]!.capacity);
    expect(world.stockpiles.find((pile) => pile.sourceId === 'home')?.amount).toBe(7);
  });

  it('saves a multi-unit haul in progress and restores it without duplication', () => {
    const world = createNewWorld();
    world.stores = [{ id: 'store-1', x: 500, wood: 0, stone: 0, capacity: 12 }];
    world.residents[2]!.logisticsMode = 'independent';
    world.residents[0]!.role = 'woodcutter';
    world.residents[0]!.x = 420;
    world.residents[1]!.role = 'hauler';
    world.residents[1]!.x = 420;
    world.stockpiles.find((pile) => pile.sourceId === 'home')!.amount = 4;
    const simulation = new PrototypeSimulation(world);

    simulation.step(0.1);
    expect(world.residents[1]!.cargoAmount).toBe(0);
    run(simulation, 0.5);
    const saved = parseSavedWorld(JSON.stringify(world));
    expect(saved?.stockpiles.find((pile) => pile.sourceId === 'home')?.amount).toBe(0);
    expect(saved?.residents[1]).toMatchObject({ cargo: 'wood', cargoAmount: 4, logisticsRequestId: expect.any(String) });
    expect(saved?.residents[2]?.logisticsMode).toBe('independent');
    expect(saved?.logisticsRequests[0]).toMatchObject({
      status: 'in_progress', assignedHaulerId: 'r2', amount: 4
    });
    expect(new PrototypeSimulation(saved!).totals().wood).toBe(4);

    run(new PrototypeSimulation(saved!), 1);
    expect(saved?.stores[0]).toMatchObject({ wood: 4, stone: 0 });
    expect(saved?.residents[1]!.cargo).toBeNull();
    expect(saved?.logisticsRequests[0]!.status).toBe('completed');
  });

  it('uses construction requests before collection requests and assigns FIFO between haulers', () => {
    const world = createNewWorld();
    world.stores = [{ id: 'store-1', x: 700, wood: 5, stone: 4, capacity: 12 }];
    world.residents[0]!.role = 'builder';
    world.residents[1]!.role = 'hauler';
    world.residents[2]!.role = 'hauler';
    expect(new PrototypeSimulation(world).place('house', 1)).toEqual({ ok: true });
    const siteId = world.sites[0]!.id;
    const request = (
      id: string, sequence: number, type: PrototypeLogisticsRequest['type'], resource: 'wood' | 'stone',
      input: Partial<PrototypeLogisticsRequest>
    ): PrototypeLogisticsRequest => ({
      id, sequence, createdAt: sequence, initiatorId: 'r1', type, resource, amount: 2,
      pickupStockpileId: null, pickupStoreId: type === 'DELIVER_TO_CONSTRUCTION' ? 'store-1' : null,
      destinationStoreId: type === 'PICKUP_RESOURCE' ? 'store-1' : null,
      destinationSiteId: type === 'DELIVER_TO_CONSTRUCTION' ? siteId : null,
      status: 'queued', assignedHaulerId: null, ...input
    });
    world.stockpiles.find((pile) => pile.sourceId === 'home')!.amount = 2;
    world.logisticsRequests = [
      request('older-pickup', 1, 'PICKUP_RESOURCE', 'wood', { pickupStockpileId: 'pile-wood-home' }),
      request('first-build', 2, 'DELIVER_TO_CONSTRUCTION', 'wood', {}),
      request('second-build', 3, 'DELIVER_TO_CONSTRUCTION', 'stone', { pickupStoreId: 'store-1' })
    ];
    world.nextRequestSequence = 4;
    const simulation = new PrototypeSimulation(world);

    simulation.step(0.1);

    expect(world.logisticsRequests.map((candidate) => candidate.assignedHaulerId)).toEqual([
      null, 'r2', 'r3'
    ]);
  });

  it('skips a blocked older request so available construction work continues', () => {
    const world = createNewWorld();
    world.stores = [
      { id: 'store-full', x: 500, wood: 1, stone: 0, capacity: 1 },
      { id: 'store-open', x: 700, wood: 3, stone: 2, capacity: 12 }
    ];
    world.residents[0]!.role = 'builder';
    world.residents[1]!.role = 'hauler';
    const simulation = new PrototypeSimulation(world);
    simulation.place('house', 1);
    const siteId = world.sites[0]!.id;
    world.stockpiles.find((pile) => pile.sourceId === 'home')!.amount = 2;
    world.logisticsRequests = [{
      id: 'blocked-old', sequence: 1, createdAt: 1, initiatorId: 'r3', type: 'PICKUP_RESOURCE', resource: 'wood', amount: 2,
      pickupStockpileId: 'pile-wood-home', pickupStoreId: null, destinationStoreId: 'store-full', destinationSiteId: null,
      status: 'blocked', assignedHaulerId: null
    }, {
      id: 'ready-build', sequence: 2, createdAt: 2, initiatorId: 'r1', type: 'DELIVER_TO_CONSTRUCTION', resource: 'wood', amount: 2,
      pickupStockpileId: null, pickupStoreId: 'store-open', destinationStoreId: null, destinationSiteId: siteId,
      status: 'queued', assignedHaulerId: null
    }];
    world.nextRequestSequence = 3;

    simulation.step(0.1);

    expect(world.logisticsRequests.find((request) => request.id === 'blocked-old')?.status).toBe('blocked');
    expect(world.logisticsRequests.find((request) => request.id === 'ready-build')?.assignedHaulerId).toBe('r2');
  });

  it('retries a blocked stockpile request after a warehouse frees capacity', () => {
    const world = createNewWorld();
    world.stores = [{ id: 'store-1', x: 500, wood: 2, stone: 0, capacity: 2 }];
    world.residents[0]!.role = 'woodcutter';
    world.residents[0]!.x = 420;
    world.residents[1]!.role = 'hauler';
    world.residents[1]!.x = 420;
    world.woodSource = 0;
    const pile = world.stockpiles.find((candidate) => candidate.sourceId === 'home')!;
    pile.amount = 3;
    world.logisticsRequests = [{
      id: 'blocked-pickup', sequence: 1, createdAt: 0, initiatorId: 'r1', type: 'PICKUP_RESOURCE',
      resource: 'wood', amount: 3, pickupStockpileId: pile.id, pickupStoreId: null,
      destinationStoreId: 'store-1', destinationSiteId: null, status: 'blocked', assignedHaulerId: null
    }];
    world.nextRequestSequence = 2;
    const simulation = new PrototypeSimulation(world);

    simulation.step(0.1);
    expect(world.logisticsRequests[0]).toMatchObject({ status: 'blocked', assignedHaulerId: null });
    expect(pile.amount).toBe(3);
    expect(simulation.totals().wood).toBe(5);

    world.stores[0]!.wood = 0;
    simulation.step(0.1);
    expect(world.logisticsRequests[0]).toMatchObject({ status: 'assigned', assignedHaulerId: 'r2' });
    run(simulation, 5);

    expect(world.logisticsRequests[0]!.status).toBe('completed');
    expect(world.stores[0]).toMatchObject({ wood: 2, stone: 0 });
    expect(pile.amount).toBe(1);
    expect(simulation.totals().wood).toBe(3);
  });

  it('keeps autonomous workers out of the hauler queue', () => {
    const world = createNewWorld();
    world.residents[0]!.role = 'woodcutter';
    world.residents[0]!.x = 234;
    world.residents[1]!.role = 'hauler';
    world.residents[1]!.x = 420;
    world.woodSource = 4;
    const simulation = new PrototypeSimulation(world);
    expect(simulation.setLogisticsMode('r1', 'independent')).toBe(true);

    run(simulation, 25);

    expect(world.logisticsRequests.filter((request) => request.initiatorId === 'r1' && request.status !== 'cancelled')).toHaveLength(0);
    expect(world.residents[1]!.logisticsRequestId).toBeNull();
    expect(world.stores[0]!.wood).toBeGreaterThan(3);
  });

  it('lets a miner deliver its own stone when there is no hauler', () => {
    const world = createNewWorld();
    world.stoneSource = 2;
    world.residents[0]!.role = 'miner';
    world.residents[0]!.x = 1900;
    const before = world.stores[0]!.stone;
    const simulation = new PrototypeSimulation(world);

    run(simulation, 12);

    expect(world.stoneSource).toBeLessThan(2);
    expect(world.stores[0]!.stone).toBeGreaterThan(before);
    expect(world.logisticsRequests).toHaveLength(0);
  });

  it('returns a delegated resident to queued logistics after autonomous fallback completes', () => {
    const world = createNewWorld();
    world.stores = [{ id: 'store-1', x: 963, wood: 0, stone: 0, capacity: 12 }];
    world.woodSource = 0;
    const pile = world.stockpiles.find((candidate) => candidate.sourceId === 'home')!;
    pile.amount = 3;
    world.residents[0]!.role = 'woodcutter';
    world.residents[0]!.x = pile.x;
    const simulation = new PrototypeSimulation(world);

    simulation.step(0.1);
    simulation.step(0.1);
    expect(world.residents[0]).toMatchObject({ cargo: 'wood', cargoAmount: 3, logisticsMode: 'hauler' });
    expect(world.logisticsRequests).toHaveLength(0);

    simulation.assign('r2', 'hauler');
    run(simulation, 5);
    expect(world.stores[0]).toMatchObject({ wood: 3, stone: 0 });
    expect(world.residents[0]!.cargo).toBeNull();
    expect(world.logisticsRequests).toHaveLength(0);

    pile.amount = 2;
    world.residents[0]!.mode = 'working';
    simulation.step(0.1);
    const returnedRequest = world.logisticsRequests.find((request) => request.initiatorId === 'r1');
    expect(returnedRequest).toMatchObject({ type: 'PICKUP_RESOURCE', status: 'assigned', assignedHaulerId: 'r2', amount: 2 });
    expect(simulation.totals().wood).toBe(5);
  });

  it('builds the first house with three residents when a hauler is assigned the logistics role', () => {
    const world = createNewWorld();
    world.stores = [{ id: 'store-1', x: 963, wood: 6, stone: 5, capacity: 12 }];
    const simulation = new PrototypeSimulation(world);
    expect(simulation.place('house', 1)).toEqual({ ok: true });
    simulation.assign('r1', 'builder');
    simulation.assign('r2', 'hauler');
    expect(world.residents).toHaveLength(3);

    run(simulation, 55);

    expect(world.residents).toHaveLength(4);
    expect(world.buildings.some((building) => building.kind === 'house')).toBe(true);
    expect(world.sites).toHaveLength(0);
    expect(world.logisticsRequests.filter((request) => request.type === 'DELIVER_TO_CONSTRUCTION')
      .every((request) => request.status === 'completed')).toBe(true);
  });

  it('cancels an unstarted request when its worker switches to independent logistics', () => {
    const world = createNewWorld();
    world.residents[0]!.role = 'woodcutter';
    world.residents[0]!.x = 420;
    world.residents[1]!.role = 'hauler';
    world.residents[1]!.x = -1500;
    world.stockpiles.find((pile) => pile.sourceId === 'home')!.amount = 3;
    const simulation = new PrototypeSimulation(world);
    simulation.step(0.1);
    const request = world.logisticsRequests[0]!;
    expect(request.status).toBe('assigned');

    simulation.setLogisticsMode('r1', 'independent');

    expect(request.status).toBe('cancelled');
    expect(world.stockpiles.find((pile) => pile.sourceId === 'home')?.amount).toBe(3);
    expect(world.residents[1]!.logisticsRequestId).toBeNull();
    expect(simulation.totals().wood).toBe(6);
  });

  it('self-delivers a local pile after the last hauler leaves the logistics role', () => {
    const world = createNewWorld();
    world.stores = [{ id: 'store-1', x: 500, wood: 0, stone: 0, capacity: 12 }];
    world.woodSource = 0;
    world.residents[0]!.role = 'woodcutter';
    world.residents[0]!.x = 420;
    world.residents[1]!.role = 'hauler';
    world.residents[1]!.x = 420;
    world.stockpiles.find((pile) => pile.sourceId === 'home')!.amount = 3;
    const simulation = new PrototypeSimulation(world);

    simulation.step(0.1);
    const request = world.logisticsRequests[0]!;
    expect(request.status).toBe('assigned');

    simulation.assign('r2', 'idle');
    run(simulation, 1);

    expect(request.status).toBe('cancelled');
    expect(world.stockpiles.find((pile) => pile.sourceId === 'home')?.amount).toBe(0);
    expect(world.stores[0]!.wood).toBe(3);
    expect(simulation.totals().wood).toBe(3);
  });

  it('finishes an in-progress haul when its initiator switches to independent logistics', () => {
    const world = createNewWorld();
    world.stores = [{ id: 'store-1', x: 963, wood: 0, stone: 0, capacity: 12 }];
    world.woodSource = 0;
    world.residents[0]!.role = 'woodcutter';
    world.residents[0]!.x = 420;
    world.residents[1]!.role = 'hauler';
    world.residents[1]!.x = 420;
    world.stockpiles.find((pile) => pile.sourceId === 'home')!.amount = 4;
    const simulation = new PrototypeSimulation(world);
    simulation.step(0.1);
    simulation.step(0.1);
    const request = world.logisticsRequests[0]!;
    expect(world.residents[1]).toMatchObject({ cargo: 'wood', cargoAmount: 4, logisticsRequestId: request.id });
    expect(request.status).toBe('in_progress');

    expect(simulation.setLogisticsMode('r1', 'independent')).toBe(true);
    expect(request).toMatchObject({ status: 'in_progress', assignedHaulerId: 'r2' });
    run(simulation, 5);

    expect(request.status).toBe('completed');
    expect(world.stores[0]!.wood).toBe(4);
    expect(simulation.totals().wood).toBe(4);
    expect(world.logisticsRequests.filter((candidate) => candidate.initiatorId === 'r1' &&
      candidate.status !== 'cancelled')).toHaveLength(1);
  });

  it('delivers cargo safely if a hauler changes profession mid-route', () => {
    const world = createNewWorld();
    world.stores = [{ id: 'store-1', x: 963, wood: 0, stone: 0, capacity: 12 }];
    world.woodSource = 0;
    world.residents[0]!.role = 'woodcutter';
    world.residents[0]!.x = 420;
    world.residents[1]!.role = 'hauler';
    world.residents[1]!.x = 420;
    world.stockpiles.find((pile) => pile.sourceId === 'home')!.amount = 4;
    const simulation = new PrototypeSimulation(world);
    simulation.step(0.1);
    simulation.step(0.1);
    const request = world.logisticsRequests[0]!;
    expect(world.residents[1]!.cargoAmount).toBe(4);

    expect(simulation.assign('r2', 'idle')).toBe(true);
    expect(world.residents[1]).toMatchObject({ role: 'idle', cargo: 'wood', cargoAmount: 4 });
    expect(request).toMatchObject({ status: 'in_progress', assignedHaulerId: 'r2' });
    run(simulation, 5);

    expect(request.status).toBe('completed');
    expect(world.residents[1]!.cargo).toBeNull();
    expect(world.stores[0]!.wood).toBe(4);
    expect(simulation.totals().wood).toBe(4);
  });

  it('keeps an autonomous builder independent while a hauler is available', () => {
    const world = createNewWorld();
    world.stores = [{ id: 'store-1', x: 963, wood: 6, stone: 5, capacity: 12 }];
    world.residents[1]!.role = 'hauler';
    const simulation = new PrototypeSimulation(world);
    expect(simulation.place('house', 1)).toEqual({ ok: true });
    simulation.assign('r1', 'builder');
    expect(simulation.setLogisticsMode('r1', 'independent')).toBe(true);

    run(simulation, 60);

    expect(world.buildings.some((building) => building.kind === 'house')).toBe(true);
    expect(world.logisticsRequests).toHaveLength(0);
    expect(world.residents[1]!.logisticsRequestId).toBeNull();
  });

  it('returns the hauler to resource pickups after construction is complete', () => {
    const world = createNewWorld();
    world.stores = [{ id: 'store-1', x: 963, wood: 6, stone: 5, capacity: 30 }];
    world.woodSource = 20;
    world.residents[0]!.role = 'builder';
    world.residents[1]!.role = 'hauler';
    world.residents[2]!.role = 'woodcutter';
    world.residents[2]!.x = 234;
    const simulation = new PrototypeSimulation(world);
    expect(simulation.place('house', 1)).toEqual({ ok: true });

    run(simulation, 80);

    expect(world.buildings.some((building) => building.kind === 'house')).toBe(true);
    expect(world.logisticsRequests.some((request) => request.type === 'DELIVER_TO_CONSTRUCTION' &&
      request.status === 'completed')).toBe(true);
    expect(world.logisticsRequests.some((request) => request.type === 'PICKUP_RESOURCE' &&
      request.status === 'completed')).toBe(true);
    expect(world.stores[0]!.wood).toBeGreaterThan(0);
  });
});
