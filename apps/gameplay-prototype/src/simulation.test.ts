import { describe, expect, it } from 'vitest';
import {
  createNewWorld, parseSavedWorld, PROTOTYPE_CONFIG, PrototypeSimulation, STORAGE_KEY, WORLD, MAP_VERSION,
  demolitionRefund, EXPANSION_CELL_ORDER, type PrototypeLogisticsRequest
} from './simulation.js';
import { LAND_GRID_CELLS, LAND_GRID_CONFIG } from './land-grid.js';

function run(simulation: PrototypeSimulation, seconds: number): void {
  const frames = Math.ceil(seconds * 10);
  for (let index = 0; index < frames; index++) simulation.step(0.1);
}

function runUntilBuildingRemoved(simulation: PrototypeSimulation, buildingId: string, seconds = 60): void {
  const frames = Math.ceil(seconds * 10);
  for (let index = 0; index < frames && simulation.world.buildings.some((building) => building.id === buildingId); index++) {
    simulation.step(0.1);
  }
}

function easternWoodTrip(stores: PrototypeSimulation['world']['stores'], stock = 1) {
  const world = createNewWorld();
  world.stores = stores.map((store) => ({ ...store }));
  world.easternSector.state = 'prepared';
  world.easternSector.clearingProgress = 1;
  world.easternForestAvailable = true;
  addEasternTree(world);
  const easternPile = world.stockpiles.find((pile) => pile.sourceId === 'eastern')!;
  easternPile.amount = 0;
  easternPile.x = PROTOTYPE_CONFIG.easternSector.forestX;
  world.residents[0]!.x = PROTOTYPE_CONFIG.easternSector.forestX;
  Object.assign(world.residents[0]!, {
    role: 'woodcutter', woodSource: 'eastern', cargo: 'wood', cargoAmount: stock, mode: 'carrying'
  });
  const simulation = new PrototypeSimulation(world);
  simulation.assign('r1', 'woodcutter');
  simulation.setWoodSource('r1', 'eastern');
  return simulation;
}

function addEasternTree(world: ReturnType<typeof createNewWorld>) {
  const cell = LAND_GRID_CELLS.find((candidate) => candidate.column === 12 &&
    candidate.row === LAND_GRID_CONFIG.surfaceCellRow)!;
  const tree = { ...world.trees[0]!, id: 'tree-eastern', cellId: cell.id, sourceId: 'eastern' as const,
    x: PROTOTYPE_CONFIG.easternSector.forestX };
  if (!world.trees.some((candidate) => candidate.id === tree.id)) world.trees.push(tree);
  const pile = world.stockpiles.find((candidate) => candidate.sourceId === 'eastern')!;
  pile.treeId = tree.id;
  pile.x = tree.x;
  return tree;
}

function removeTreeSource(world: ReturnType<typeof createNewWorld>, sourceId: 'home' | 'eastern'): void {
  const removed = new Set(world.trees.filter((tree) => tree.sourceId === sourceId).map((tree) => tree.id));
  world.trees = world.trees.filter((tree) => !removed.has(tree.id));
  for (const pile of world.stockpiles) if (pile.treeId && removed.has(pile.treeId)) delete pile.treeId;
}

function waitForCargo(simulation: PrototypeSimulation, seconds = 6): void {
  const frames = Math.ceil(seconds * 10);
  for (let index = 0; index < frames && !simulation.world.residents[0]!.cargo; index++) {
    simulation.step(0.1);
  }
}

function addHouse(world: ReturnType<typeof createNewWorld>, id = 'house-test', x = 690): void {
  world.buildings.push({ id, kind: 'house', x, y: WORLD.groundY });
  const plot = [350, 690, 1240, 1590].findIndex((candidate) => candidate === x);
  if (plot >= 0 && !world.occupiedPlots.includes(plot)) world.occupiedPlots.push(plot);
}

function addWarehouse(world: ReturnType<typeof createNewWorld>, id = 'store-2', x = 1590): void {
  const buildingId = `warehouse:${id}`;
  world.buildings.push({ id: buildingId, kind: 'warehouse', x, y: WORLD.groundY });
  world.stores.push({ id, buildingId, x, wood: 0, ore: 0, capacity: PROTOTYPE_CONFIG.warehouseCapacity });
  if (x === 1590 && !world.occupiedPlots.includes(3)) world.occupiedPlots.push(3);
}


function refunds(world: ReturnType<typeof createNewWorld>) {
  const piles = world.stockpiles.filter((pile) => pile.sourceId === 'demolition');
  expect(piles.every((pile) => pile.capacity === 10 && pile.amount <= 10)).toBe(true);
  return { wood: piles.filter((pile) => pile.resource === 'wood').reduce((sum, pile) => sum + pile.amount, 0),
    ore: piles.filter((pile) => pile.resource === 'ore').reduce((sum, pile) => sum + pile.amount, 0) };
}

describe('Gameplay prototype simulation', () => {
  it('starts with three residents and finite physical sources', () => {
    const world = createNewWorld();
    const simulation = new PrototypeSimulation(world);
    expect(simulation.world.residents).toHaveLength(3);
    expect(simulation.world.trees.some((tree) => tree.state === 'mature')).toBe(true);
    expect(simulation.world.oreSource).toBeGreaterThan(0);
    expect(simulation.totals()).toMatchObject({ population: 3, housing: 3, capacity: 120 });
  });

  it('harvests a physical batch and deposits it at the warehouse after a visible trip', () => {
    const simulation = new PrototypeSimulation(createNewWorld());
    const beforeHarvested = simulation.activity.harvested.wood;
    const beforeStock = simulation.world.stores[0]!.wood;
    simulation.assign('r1', 'woodcutter');
    run(simulation, 45);
    expect(simulation.activity.harvested.wood).toBeGreaterThan(beforeHarvested);
    expect(simulation.world.stores[0]!.wood).toBeGreaterThan(beforeStock);
  });

  it('physically supplies a house, builds it in stages, and welcomes the fourth resident', () => {
    const simulation = new PrototypeSimulation(createNewWorld());
    expect(simulation.place('house', 1)).toEqual({ ok: true });
    simulation.assign('r1', 'builder');
    simulation.assign('r2', 'woodcutter');
    simulation.assign('r3', 'miner');
    run(simulation, 500);
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
    run(simulation, 480);
    expect(simulation.world.stores).toHaveLength(2);
    expect(simulation.totals().capacity).toBe(240);
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
      oreSource: 21,
      residents: [
        { ...fresh.residents[0]!, x: 812, y: 980, role: 'builder' as const, targetX: 590, targetY: 1050 },
        ...fresh.residents.slice(1)
      ],
      stores: [{ id: 'store-1', x: 812, y: 860, wood: 4, ore: 3, capacity: 12 }],
      buildings: [{ id: 'house-1', kind: 'house' as const, x: 638, y: 1050 }],
      sites: [{
        id: 'site-2', kind: 'warehouse' as const, x: 1032, y: 720,
        deliveredWood: 2, deliveredOre: 1, progress: 0.4, stage: 1
      }],
      occupiedPlots: [1, 2]
    };
    delete depthSave.gridVersion;
    const loaded = parseSavedWorld(JSON.stringify(depthSave));

    expect(loaded).not.toBeNull();
    expect(loaded?.mapVersion).toBe(MAP_VERSION);
    expect(loaded?.oreSource).toBe(21);
    expect(loaded?.residents).toHaveLength(3);
    expect(loaded?.residents[0]).toMatchObject({
      x: 936, y: WORLD.groundY, role: 'builder', targetX: 680, targetY: WORLD.groundY
    });
    expect(loaded?.stores[0]).toEqual({
      id: 'store-1', buildingId: 'warehouse:store-1', x: 1050, wood: 4, ore: 3, capacity: 12
    });
    expect(loaded?.buildings[0]).toMatchObject({ id: 'house-1', kind: 'house', x: 750, y: WORLD.groundY });
    expect(loaded?.sites[0]).toMatchObject({
      id: 'site-2', kind: 'warehouse', x: 1350, y: WORLD.groundY,
      deliveredWood: 2, deliveredOre: 1, progress: 0.4, stage: 1
    });
    expect(loaded?.occupiedPlots).toEqual([1, 2, 8]);
    expect(STORAGE_KEY).toBe('avanpost:gameplay-prototype:v01');
  });

  it('does not reinterpret legacy depth-map plot IDs as the new eastern build plots', () => {
    const legacy = createNewWorld();
    legacy.mapVersion = 2;
    delete legacy.gridVersion;
    legacy.buildings = [{ id: 'old-depth-house', kind: 'house', x: 600, y: 1380 }];
    legacy.sites = [{
      id: 'old-depth-site', kind: 'warehouse', x: 850, y: 1450,
      deliveredWood: 1, deliveredOre: 0, progress: 0, stage: 0
    }];
    legacy.occupiedPlots = [4, 5];

    const migrated = parseSavedWorld(JSON.stringify(legacy));
    expect(migrated).not.toBeNull();
    expect(migrated?.buildings[0]?.x).toBe(750);
    expect(migrated?.sites[0]?.x).toBe(1050);
    expect(migrated?.occupiedPlots).toEqual([1, 2, 8]);
    migrated!.easternSector.state = 'prepared';
    migrated!.easternSector.clearingProgress = 1;
    expect(new PrototypeSimulation(migrated!).isPlotAvailable(4)).toBe(true);
  });

  it('migrates an original side-view save once while preserving state and save identity', () => {
    const original = createNewWorld();
    delete original.mapVersion;
    delete original.gridVersion;
    original.residents.forEach((person, index) => {
      person.x = [475, 535, 595][index]!;
    });
    original.residents[0]!.x = 475;
    original.residents[0]!.targetX = 130;
    original.stores[0]!.x = 535;
    original.buildings = [{ id: 'house-1', kind: 'house', x: 420, y: 414 }];
    original.occupiedPlots = [1];

    const loaded = parseSavedWorld(JSON.stringify(original));
    expect(loaded?.mapVersion).toBe(MAP_VERSION);
    expect(loaded?.residents).toHaveLength(3);
    expect(loaded?.residents[0]).toMatchObject({ x: 855, targetX: 234, y: WORLD.groundY });
    expect(loaded?.stores[0]).toMatchObject({ x: 1050 });
    expect(loaded?.buildings[0]).toMatchObject({ id: 'house-1', x: 750, y: WORLD.groundY });
    expect(loaded?.occupiedPlots).toEqual([1, 8]);
    expect(parseSavedWorld(JSON.stringify(loaded))?.residents[0]?.x).toBe(855);
    expect(STORAGE_KEY).toBe('avanpost:gameplay-prototype:v01');
  });

  it('moves a v4 claim off the stone-source cell without losing its clearing progress', () => {
    const v4 = createNewWorld();
    v4.mapVersion = 4;
    delete v4.gridVersion;
    v4.landCells.find((cell) => cell.id === 9)!.state = 'clearing';
    v4.landCells.find((cell) => cell.id === 9)!.clearingProgress = 0.37;
    v4.landCells.find((cell) => cell.id === 9)!.clearingPaused = true;

    const migrated = parseSavedWorld(JSON.stringify(v4));
    expect(migrated?.mapVersion).toBe(MAP_VERSION);
    expect(migrated?.landCells.find((cell) => cell.id === 4)).toMatchObject({
      state: 'clearing', clearingProgress: 0.37, clearingPaused: true
    });
    expect(migrated?.landCells.find((cell) => cell.id === 9)).toMatchObject({
      state: 'prepared', clearingProgress: 1, clearingPaused: false
    });
  });

  it('migrates v5 saves to the road-aware map without moving or charging existing objects', () => {
    const v5 = createNewWorld();
    v5.mapVersion = 5;
    delete v5.gridVersion;
    v5.stores[0]!.wood = 24;
    v5.stores[0]!.ore = 13;
    v5.landCells.find((cell) => cell.id === 1)!.state = 'prepared';
    const beforeBuildingPositions = v5.buildings.map(({ id, x }) => [id, x]);
    const loaded = parseSavedWorld(JSON.stringify(v5));

    expect(loaded?.mapVersion).toBe(MAP_VERSION);
    expect(loaded?.roads).toEqual([]);
    expect(loaded?.buildings.map(({ id, x }) => [id, x])).toEqual(beforeBuildingPositions);
    expect(loaded?.stores[0]).toMatchObject({ wood: 24, ore: 13 });
    expect(loaded?.landCells.find((cell) => cell.id === 1)?.state).toBe('prepared');
  });

  it('disables road placement and removal behind the feature flag', () => {
    const simulation = new PrototypeSimulation(createNewWorld());
    simulation.world.roads = [{ id: 'road-existing', x: 400, builtAt: 12 }];
    expect(simulation.placeRoad(401)).toMatchObject({ ok: false, reason: expect.stringContaining('отключена') });
    expect(simulation.roadPlacementError(401)).toContain('отключена');
    expect(simulation.removeRoad('road-existing')).toMatchObject({ ok: false });
    expect(simulation.world.roads).toEqual([{ id: 'road-existing', x: 400, builtAt: 12 }]);
  });

  it('migrates v6 saves onto the square grid and preserves road records', () => {
    const v6 = createNewWorld();
    v6.mapVersion = 6;
    delete v6.gridVersion;
    v6.buildings.push({ id: 'house-v6', kind: 'house', x: 690, y: WORLD.groundY });
    v6.occupiedPlots.push(1);
    v6.roads = [{ id: 'road-v6', x: 400, builtAt: 12 }];
    v6.stores[0]!.wood = 24;
    v6.stores[0]!.ore = 13;

    const loaded = parseSavedWorld(JSON.stringify(v6));

    expect(loaded?.mapVersion).toBe(MAP_VERSION);
    expect(loaded?.buildings.find((building) => building.id === 'house-v6'))
      .toMatchObject({ x: 750, y: WORLD.groundY });
    expect(loaded?.roads).toEqual([{ id: 'road-v6', x: 400, builtAt: 12 }]);
    expect(loaded?.stores[0]).toMatchObject({ wood: 24, ore: 13 });
    expect(loaded?.occupiedPlots).toContain(1);
  });

  it('pauses saved road work without losing site materials, progress or a carried load', () => {
    const world = createNewWorld();
    world.sites.push({ id: 'road-site-old', kind: 'road', x: 400, y: WORLD.groundY,
      deliveredWood: 7, deliveredOre: 3, progress: 0.4, stage: 1, paused: false });
    world.roads.push({ id: 'road-old', x: 400, builtAt: 12 });
    Object.assign(world.residents[0]!, {
      role: 'hauler', mode: 'carrying', cargo: 'wood', cargoAmount: 4,
      targetSiteId: 'road-site-old', targetStoreId: null, targetX: 400, targetY: WORLD.groundY
    });
    world.logisticsRequests.push({ id: 'road-request', sequence: 1, createdAt: 1, initiatorId: 'r2',
      type: 'DELIVER_TO_CONSTRUCTION', resource: 'wood', amount: 4, pickupStockpileId: null,
      pickupStoreId: 'store-1', destinationStoreId: null, destinationSiteId: 'road-site-old',
      status: 'in_progress', assignedHaulerId: 'r1' });

    const simulation = new PrototypeSimulation(world);

    expect(world.sites[0]).toMatchObject({ deliveredWood: 7, deliveredOre: 3, progress: 0.4, paused: true });
    expect(world.roads).toEqual([{ id: 'road-old', x: 400, builtAt: 12 }]);
    expect(world.residents[0]).toMatchObject({ cargo: 'wood', cargoAmount: 4, targetStoreId: 'store-1' });
    expect(world.logisticsRequests[0]).toMatchObject({ status: 'cancelled', assignedHaulerId: null });
    run(simulation, 8);
    expect(world.sites[0]).toMatchObject({ deliveredWood: 7, deliveredOre: 3, progress: 0.4, paused: true });
    expect(world.residents[0]!.cargo).toBeNull();
    expect(world.stores[0]!.wood).toBe(34);
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
    expect(simulation.place('house', 4)).toMatchObject({ ok: false, reason: expect.stringContaining('открой') });

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
    expect(simulation.totals()).toMatchObject({ wood: before.wood, ore: before.ore });

    world.buildings.push({ id: 'house-1', kind: 'house', x: 690, y: WORLD.groundY });
    world.stores = [
      { id: 'store-1', x: 963, wood: 70, ore: 40, capacity: 120 },
      { id: 'store-2', x: 1590, wood: 10, ore: 10, capacity: 120 }
    ];
    expect(simulation.unlockEasternSector()).toEqual({ ok: true });
    expect(world.easternSector.state).toBe('unlocked');
    expect(EXPANSION_CELL_ORDER.map((id) => world.landCells.find((cell) => cell.id === id)!.state)).toEqual([
      'unlocked', 'closed', 'closed', 'closed'
    ]);
    expect(simulation.totals()).toMatchObject({ wood: 0, ore: 0 });
    expect(world.stores.every((store) => store.wood >= 0 && store.ore >= 0)).toBe(true);
    expect(world.currentGoal).toBe('prepare-eastern-sector');
  });

  it('opens the next adjacent cell only after the current cell is prepared', () => {
    const world = createNewWorld();
    world.buildings.push({ id: 'house-1', kind: 'house', x: 690, y: WORLD.groundY });
    world.stores = [{ id: 'store-1', x: 963, wood: 300, ore: 200, capacity: 600 }];
    world.residents[0]!.role = 'hauler';
    world.residents[1]!.role = 'hauler';
    const simulation = new PrototypeSimulation(world);

    expect(simulation.unlockEasternSector()).toEqual({ ok: true });
    expect(simulation.unlockEasternSector()).toMatchObject({ ok: false });
    expect(EXPANSION_CELL_ORDER.map((id) => world.landCells.find((cell) => cell.id === id)!.state)).toEqual([
      'unlocked', 'closed', 'closed', 'closed'
    ]);
    expect(simulation.isPlotAvailable(5)).toBe(false);

    world.residents[2]!.x = world.landCells.find((cell) => cell.id === 4)!.x;
    expect(simulation.startEasternClearing()).toEqual({ ok: true });
    run(simulation, PROTOTYPE_CONFIG.expansion.clearingWorkSeconds + 1);
    expect(world.landCells.find((cell) => cell.id === 4)).toMatchObject({ state: 'prepared', clearingProgress: 1 });

    const storedBeforeSecondUnlock = simulation.availableInStores('wood');
    expect(simulation.unlockEasternSector()).toEqual({ ok: true });
    expect(EXPANSION_CELL_ORDER.map((id) => world.landCells.find((cell) => cell.id === id)!.state)).toEqual([
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

  it('restores an active land-clearing assignment from a current-version save', () => {
    const world = createNewWorld();
    const cost = PROTOTYPE_CONFIG.expansion.unlockCost;
    world.buildings.push({ id: 'house-1', kind: 'house', x: 690, y: WORLD.groundY });
    world.occupiedPlots.push(1);
    world.stores[0]!.wood = cost.wood + 10;
    world.stores[0]!.ore = cost.ore + 10;
    world.stores[0]!.capacity = Math.max(world.stores[0]!.capacity, cost.wood + cost.ore + 20);
    const simulation = new PrototypeSimulation(world);

    expect(simulation.unlockEasternSector()).toEqual({ ok: true });
    expect(simulation.startEasternClearing()).toEqual({ ok: true });

    const restored = parseSavedWorld(JSON.stringify(world));
    expect(restored?.landCells.find((cell) => cell.id === 4))
      .toMatchObject({ state: 'clearing', clearingPaused: false });
    expect(restored?.landCells.find((cell) => cell.id === 4)?.clearerId).not.toBeNull();
    expect(restored?.easternSector.state).toBe('clearing');
  });

  it('sends a woodcutter to the new forest, harvests a tree, and carries the batch to storage', () => {
    const world = createNewWorld();
    world.easternSector.state = 'prepared';
    world.easternForestAvailable = true;
    world.easternSector.clearingProgress = 1;
    addEasternTree(world);
    const beforeWood = world.stores[0]!.wood;
    const simulation = new PrototypeSimulation(world);
    simulation.assign('r1', 'woodcutter');
    expect(simulation.setWoodSource('r1', 'eastern')).toEqual({ ok: true });

    run(simulation, 1);
    expect(world.residents[0]!.x).toBeGreaterThan(640);
    waitForCargo(simulation, 65);

    expect(simulation.activity.harvested.wood).toBeGreaterThan(0);
    expect(world.residents[0]!.cargo).toBe('wood');
    expect(world.stores[0]!.wood).toBe(beforeWood);
    run(simulation, 25);
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

  it('keeps a full source pile and pauses chopping while every warehouse is full', () => {
    const world = createNewWorld();
    world.easternSector.state = 'prepared';
    addEasternTree(world);
    world.stores = [{ id: 'store-1', x: 963, wood: 7, ore: 5, capacity: 12 }];
    const simulation = new PrototypeSimulation(world);
    simulation.assign('r1', 'woodcutter');
    simulation.setWoodSource('r1', 'eastern');
    run(simulation, 150);
    expect(world.residents[0]!.cargo).toBeNull();
    expect(world.stockpiles.find((pile) => pile.sourceId === 'eastern')!.amount).toBe(10);
    expect(world.residents[0]!.mode).toBe('blocked');
    expect(simulation.totals().stored).toBe(12);

    const oreBefore = world.oreSource;
    run(simulation, 242);
    expect(simulation.activity.harvested.wood).toBe(10);
    expect(world.oreSource).toBe(oreBefore);
    expect(world.stockpiles.find((pile) => pile.sourceId === 'eastern')!.amount).toBe(10);
  });

  it('migrates pre-sector saves while preserving settlement and clearing progress on newer saves', () => {
    const oldSave = createNewWorld();
    oldSave.mapVersion = 7;
    delete oldSave.gridVersion;
    oldSave.buildings.push({ id: 'house-1', kind: 'house', x: 690, y: WORLD.groundY });
    oldSave.stores.push({ id: 'store-2', x: 1590, wood: 20, ore: 10, capacity: 120 });
    delete (oldSave as Partial<typeof oldSave>).easternSector;
    delete (oldSave as Partial<typeof oldSave>).currentGoal;
    delete (oldSave.residents[0] as Partial<(typeof oldSave.residents)[number]>).woodSource;

    const migrated = parseSavedWorld(JSON.stringify(oldSave));
    expect(migrated).not.toBeNull();
    expect(migrated).toMatchObject({
      easternSector: { state: 'closed', clearingProgress: 0, clearerId: null },
      currentGoal: 'unlock-eastern-sector',
      stores: [{ id: 'store-1' }, { id: 'store-2' }]
    });
    expect(migrated?.buildings).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'house-1', kind: 'house', x: 750, y: WORLD.groundY }),
      expect.objectContaining({ id: 'warehouse:store-1', kind: 'warehouse', x: 1050, y: WORLD.groundY }),
      expect.objectContaining({ id: 'warehouse:store-2', kind: 'warehouse', x: 1650, y: WORLD.groundY })
    ]));
    expect(migrated?.residents[0]?.woodSource).toBe('home');

    migrated!.easternSector.state = 'clearing';
    migrated!.easternSector.clearingProgress = 0.42;
    migrated!.easternSector.clearingPaused = true;
    migrated!.easternSector.clearerId = 'r3';
    Object.assign(migrated!.landCells.find((cell) => cell.id === EXPANSION_CELL_ORDER[0])!, {
      state: 'clearing', clearingProgress: 0.42, clearingPaused: true, clearerId: 'r3'
    });
    const restored = parseSavedWorld(JSON.stringify(migrated));
    expect(restored?.easternSector).toMatchObject({
      state: 'clearing', clearingProgress: 0.42, clearingPaused: true, clearerId: 'r3'
    });
    const orphaned = parseSavedWorld(JSON.stringify({
      ...migrated,
      landCells: migrated!.landCells.map((cell) => cell.id === EXPANSION_CELL_ORDER[0]
        ? { ...cell, clearingPaused: false, clearerId: 'missing-resident' }
        : cell),
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
      landCells: migrated!.landCells.map((cell) => cell.id === EXPANSION_CELL_ORDER[0]
        ? { ...cell, clearingPaused: false, clearerId: 'r3' }
        : cell),
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
    old.mapVersion = 7;
    delete old.gridVersion;
    old.easternSector.state = 'prepared';
    old.easternSector.clearingProgress = 1;
    old.buildings = [{ id: 'old-house-east', kind: 'house', x: 2380, y: WORLD.groundY }];
    old.sites = [{
      id: 'old-store-east', kind: 'warehouse', x: 2780, y: WORLD.groundY,
      deliveredWood: 2, deliveredOre: 1, progress: 0.3, stage: 0
    }];
    old.occupiedPlots = [4, 5];
    delete (old as Partial<typeof old>).landCells;
    delete (old as Partial<typeof old>).easternForestAvailable;

    const migrated = parseSavedWorld(JSON.stringify(old));
    expect(migrated).not.toBeNull();
    expect(migrated?.landCells.filter((cell) => cell.row === 2 && cell.state === 'prepared')
      .map((cell) => cell.id).sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4, 5, 8, 9, 10, 11, 19, 20]);
    expect(migrated?.landCells.find((cell) => cell.id === 6)?.state).toBe('closed');
    expect(migrated?.buildings[0]?.id).toBe('old-house-east');
    expect(migrated?.sites[0]).toMatchObject({ id: 'old-store-east', deliveredWood: 2, deliveredOre: 1, progress: 0.3 });
    expect(migrated?.easternForestAvailable).toBe(true);
    expect(STORAGE_KEY).toBe('avanpost:gameplay-prototype:v01');
  });

  it('routes a wood load to the nearest available warehouse and credits that exact warehouse', () => {
    const simulation = easternWoodTrip([
      { id: 'store-far', x: 2500, wood: 0, ore: 0, capacity: 8 },
      { id: 'store-near', x: 3750, wood: 0, ore: 0, capacity: 8 }
    ]);
    waitForCargo(simulation);
    const worker = simulation.world.residents[0]!;
    expect(worker.cargo).toBe('wood');
    expect(worker.targetStoreId).toBe('store-near');
    expect(worker.targetX).toBe(3750);
    run(simulation, 1);
    expect(simulation.world.stores).toMatchObject([
      { id: 'store-far', wood: 0 },
      { id: 'store-near', wood: 1 }
    ]);
    expect(worker.cargo).toBeNull();
  });

  it('skips a full nearest warehouse and selects the next nearest one', () => {
    const simulation = easternWoodTrip([
      { id: 'store-near-full', x: 3750, wood: 8, ore: 0, capacity: 8 },
      { id: 'store-next', x: 2500, wood: 0, ore: 0, capacity: 8 }
    ]);
    waitForCargo(simulation);
    expect(simulation.world.residents[0]).toMatchObject({
      cargo: 'wood', targetStoreId: 'store-next', targetX: 2500
    });
    run(simulation, 10);
    expect(simulation.world.stores).toMatchObject([
      { id: 'store-near-full', wood: 8 },
      { id: 'store-next', wood: 1 }
    ]);
  });

  it('keeps an in-flight wood load while all warehouses are full and resumes after capacity is freed', () => {
    const simulation = easternWoodTrip([
      { id: 'store-near', x: 3750, wood: 8, ore: 0, capacity: 8 },
      { id: 'store-far', x: 2500, wood: 8, ore: 0, capacity: 8 }
    ]);
    run(simulation, 4);
    const worker = simulation.world.residents[0]!;
    expect(worker).toMatchObject({ cargo: 'wood', cargoAmount: 1, mode: 'blocked', targetStoreId: null });
    expect(simulation.world.stockpiles.find((pile) => pile.sourceId === 'eastern')?.amount).toBe(0);

    simulation.world.stores[1]!.wood--;
    run(simulation, 10);
    expect(worker.cargo).toBeNull();
    expect(simulation.world.stores[1]!.wood).toBe(8);
    expect(simulation.world.stores[0]!.wood).toBe(8);
  });

  it('reroutes cargo if its chosen warehouse fills while the worker is travelling', () => {
    const simulation = easternWoodTrip([
      { id: 'store-near', x: 3750, wood: 0, ore: 0, capacity: 1 },
      { id: 'store-far', x: 2500, wood: 0, ore: 0, capacity: 1 }
    ]);
    waitForCargo(simulation);
    const worker = simulation.world.residents[0]!;
    expect(worker.targetStoreId).toBe('store-near');
    simulation.world.stores[0]!.wood = 1;
    simulation.step(0.1);
    expect(worker).toMatchObject({ cargo: 'wood', targetStoreId: 'store-far', targetX: 2500 });
    run(simulation, 10);
    expect(simulation.world.stores).toMatchObject([
      { id: 'store-near', wood: 1 },
      { id: 'store-far', wood: 1 }
    ]);
    expect(worker.cargo).toBeNull();
  });

  it('breaks equal-distance warehouse choices deterministically by warehouse ID', () => {
    const simulation = easternWoodTrip([
      { id: 'store-z', x: 3720, wood: 0, ore: 0, capacity: 8 },
      { id: 'store-a', x: 3780, wood: 0, ore: 0, capacity: 8 }
    ]);
    waitForCargo(simulation);
    expect(simulation.world.residents[0]).toMatchObject({ targetStoreId: 'store-a', targetX: 3780 });
    run(simulation, 1);
    expect(simulation.world.stores).toMatchObject([
      { id: 'store-z', wood: 0 },
      { id: 'store-a', wood: 1 }
    ]);
  });

  it('saves and restores a wood delivery route without losing or duplicating its cargo', () => {
    const simulation = easternWoodTrip([
      { id: 'store-far', x: 2500, wood: 0, ore: 0, capacity: 8 },
      { id: 'store-near', x: 3750, wood: 0, ore: 0, capacity: 8 }
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
      { id: 'store-near', x: 1510, wood: 0, ore: 0, capacity: 1 },
      { id: 'store-next', x: 1550, wood: 0, ore: 0, capacity: 1 }
    ];
    world.residents[0] = {
      ...world.residents[0]!, x: 1500, cargo: 'wood', mode: 'carrying',
      targetStoreId: 'store-near', targetX: 1510, targetY: WORLD.groundY
    };
    world.residents[1] = {
      ...world.residents[1]!, x: 1500, cargo: 'ore', mode: 'carrying',
      targetStoreId: 'store-near', targetX: 1510, targetY: WORLD.groundY
    };

    const restored = parseSavedWorld(JSON.stringify(world));
    expect(restored?.residents.map((person) => person.targetStoreId)).toEqual([
      'store-near', 'store-next', null
    ]);

    const simulation = new PrototypeSimulation(restored!);
    run(simulation, 10);
    expect(simulation.world.stores).toMatchObject([
      { id: 'store-near', wood: 1, ore: 0 },
      { id: 'store-next', wood: 0, ore: 1 }
    ]);
    expect(simulation.world.stores.every((store) => store.wood + store.ore <= store.capacity)).toBe(true);
    expect(simulation.world.residents.slice(0, 2).every((person) => person.cargo === null)).toBe(true);
  });

  it('migrates legacy in-flight cargo without new warehouse route fields', () => {
    const simulation = easternWoodTrip([
      { id: 'store-far', x: 2500, wood: 0, ore: 0, capacity: 8 },
      { id: 'store-near', x: 3750, wood: 0, ore: 0, capacity: 8 }
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

  it('delivers ore to the nearest warehouse from the miner position', () => {
    const world = createNewWorld();
    world.stores = [
      { id: 'store-far', x: 1400, wood: 0, ore: 0, capacity: 8 },
      { id: 'store-near', x: 1950, wood: 0, ore: 0, capacity: 8 }
    ];
    world.residents[0]!.x = 1900;
    world.oreSource = 1;
    const simulation = new PrototypeSimulation(world);
    simulation.assign('r1', 'miner');
    waitForCargo(simulation);
    expect(world.residents[0]).toMatchObject({ cargo: 'ore', targetStoreId: 'store-near' });
    run(simulation, 10);
    expect(world.stores).toMatchObject([
      { id: 'store-far', ore: 0 },
      { id: 'store-near', ore: 1 }
    ]);
  });

  it('physically picks construction wood and ore from the warehouse that loses each unit', () => {
    const world = createNewWorld();
    world.stores = [
      { id: 'store-wood', x: 963, wood: 1, ore: 0, capacity: 12 },
      { id: 'store-stone', x: 1200, wood: 0, ore: 1, capacity: 12 }
    ];
    removeTreeSource(world, 'home');
    world.oreSource = 0;
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

    run(simulation, 2.7);
    expect(world.residents[0]).toMatchObject({ pickupStoreId: 'store-stone', pickupResource: 'ore' });
    run(simulation, 4);
    expect(world.residents[0]!.cargo).toBe('ore');
    expect(world.stores[1]!.ore).toBe(0);
    run(simulation, 4);
    expect(world.sites[0]!.deliveredOre).toBe(1);
    expect(simulation.totals()).toMatchObject({ wood: 0, ore: 0 });
  });

  it('lets a miner work in place until a ten-unit local pile fills', () => {
    const world = createNewWorld();
    world.residents[0]!.role = 'miner';
    world.residents[0]!.x = 1900;
    world.residents[1]!.role = 'hauler';
    world.residents[1]!.x = -2000;
    world.stockpiles.find((pile) => pile.resource === 'ore')!.amount = 9;
    const before = world.oreSource;
    const simulation = new PrototypeSimulation(world);

    run(simulation, 4);

    expect(world.stockpiles.find((pile) => pile.resource === 'ore')?.amount).toBe(10);
    expect(world.oreSource).toBe(before - 1);
    expect(world.residents[0]).toMatchObject({ role: 'miner', mode: 'blocked', x: 1950 });
    expect(world.logisticsRequests.some((request) => request.type === 'PICKUP_RESOURCE')).toBe(true);
  });

  it('creates one resource pickup request and lets two haulers assign it only once', () => {
    const world = createNewWorld();
    world.residents[0]!.role = 'woodcutter';
    world.residents[0]!.x = PROTOTYPE_CONFIG.sources.homePileX;
    world.residents[1]!.role = 'hauler';
    world.residents[1]!.x = PROTOTYPE_CONFIG.sources.homePileX;
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
      { id: 'store-near', x: 500, wood: 0, ore: 0, capacity: 12 },
      { id: 'store-far', x: 1000, wood: 0, ore: 0, capacity: 12 }
    ];
    removeTreeSource(world, 'home');
    world.residents[0]!.role = 'woodcutter';
    world.residents[0]!.x = PROTOTYPE_CONFIG.sources.homePileX;
    world.residents[1]!.role = 'hauler';
    world.residents[1]!.x = PROTOTYPE_CONFIG.sources.homePileX;
    world.stockpiles.find((pile) => pile.sourceId === 'home')!.amount = 4;
    const simulation = new PrototypeSimulation(world);

    simulation.step(0.1);
    const request = world.logisticsRequests[0]!;
    expect(request).toMatchObject({ status: 'assigned', destinationStoreId: 'store-near', amount: 4 });

    world.stores[0]!.wood = world.stores[0]!.capacity;
    simulation.step(0.1);

    expect(request.destinationStoreId).toBe('store-far');
    expect(request.assignedHaulerId).toBe('r2');
    run(simulation, 7);

    expect(request.status).toBe('completed');
    expect(world.stockpiles.find((pile) => pile.sourceId === 'home')?.amount).toBe(0);
    expect(world.stores[1]).toMatchObject({ wood: 4, ore: 0 });
    expect(simulation.totals().wood).toBe(16);
  });

  it('keeps a hauler working through wood and ore stockpiles in FIFO order', () => {
    const world = createNewWorld();
    world.stores = [{ id: 'store-1', x: 700, wood: 0, ore: 0, capacity: 12 }];
    removeTreeSource(world, 'home');
    world.oreSource = 0;
    world.residents[0]!.role = 'woodcutter';
    world.residents[0]!.x = PROTOTYPE_CONFIG.sources.homePileX;
    world.residents[1]!.role = 'miner';
    world.residents[1]!.x = 1740;
    world.residents[2]!.role = 'hauler';
    world.stockpiles.find((pile) => pile.resource === 'wood')!.amount = 3;
    world.stockpiles.find((pile) => pile.resource === 'ore')!.amount = 2;
    const simulation = new PrototypeSimulation(world);

    run(simulation, 29);

    expect(world.logisticsRequests.slice(0, 2).map((request) => request.type)).toEqual([
      'PICKUP_RESOURCE', 'PICKUP_RESOURCE'
    ]);
    expect(world.logisticsRequests.slice(0, 2).map((request) => request.status)).toEqual(['completed', 'completed']);
    expect(world.stores[0]!.wood).toBeGreaterThanOrEqual(3);
    expect(world.stores[0]!.ore).toBeGreaterThanOrEqual(2);
  });

  it('resumes harvesting after a full local pile is emptied by a hauler', () => {
    const world = createNewWorld();
    world.stores = [{ id: 'store-1', x: 500, wood: 0, ore: 0, capacity: 12 }];
    world.residents[0]!.role = 'woodcutter';
    world.residents[0]!.x = PROTOTYPE_CONFIG.sources.homePileX;
    world.residents[0]!.mode = 'blocked';
    world.residents[1]!.role = 'hauler';
    world.residents[1]!.x = PROTOTYPE_CONFIG.sources.homePileX;
    world.stockpiles.find((pile) => pile.sourceId === 'home')!.amount = 10;
    const simulation = new PrototypeSimulation(world);

    run(simulation, 8);
    run(simulation, 40);

    expect(world.stores[0]!.wood).toBeGreaterThanOrEqual(10);
    expect(simulation.activity.harvested.wood).toBeGreaterThan(0);
    expect(world.logisticsRequests[0]).toMatchObject({ type: 'PICKUP_RESOURCE', status: 'completed' });
    expect(world.logisticsRequests.some((request) => request.id !== world.logisticsRequests[0]!.id &&
      request.type === 'PICKUP_RESOURCE' && request.status !== 'cancelled')).toBe(true);
  });

  it('partially delivers a local pile into a nearly full warehouse without overfilling it', () => {
    const world = createNewWorld();
    world.stores = [{ id: 'store-1', x: 500, wood: 3, ore: 1, capacity: 5 }];
    removeTreeSource(world, 'home');
    world.residents[0]!.role = 'woodcutter';
    world.residents[0]!.x = PROTOTYPE_CONFIG.sources.homePileX;
    world.residents[1]!.role = 'hauler';
    world.residents[1]!.x = PROTOTYPE_CONFIG.sources.homePileX;
    world.stockpiles.find((pile) => pile.sourceId === 'home')!.amount = 8;
    const simulation = new PrototypeSimulation(world);

    run(simulation, 5);

    expect(world.stores[0]).toMatchObject({ wood: 4, ore: 1, capacity: 5 });
    expect(world.stores[0]!.wood + world.stores[0]!.ore)
      .toBeLessThanOrEqual(world.stores[0]!.capacity);
    expect(world.stockpiles.find((pile) => pile.sourceId === 'home')?.amount).toBe(7);
  });

  it('saves a multi-unit haul in progress and restores it without duplication', () => {
    const world = createNewWorld();
    world.stores = [{ id: 'store-1', x: 500, wood: 0, ore: 0, capacity: 12 }];
    world.residents[2]!.logisticsMode = 'independent';
    world.residents[0]!.role = 'woodcutter';
    world.residents[0]!.x = PROTOTYPE_CONFIG.sources.homePileX;
    world.residents[1]!.role = 'hauler';
    world.residents[1]!.x = PROTOTYPE_CONFIG.sources.homePileX;
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

    run(new PrototypeSimulation(saved!), 3);
    expect(saved?.stores[0]).toMatchObject({ wood: 4, ore: 0 });
    expect(saved?.residents[1]!.cargo).toBeNull();
    expect(saved?.logisticsRequests[0]!.status).toBe('completed');
  });

  it('uses construction requests before collection requests and assigns FIFO between haulers', () => {
    const world = createNewWorld();
    world.stores = [{ id: 'store-1', x: 700, wood: 5, ore: 4, capacity: 12 }];
    world.residents[0]!.role = 'builder';
    world.residents[1]!.role = 'hauler';
    world.residents[2]!.role = 'hauler';
    expect(new PrototypeSimulation(world).place('house', 0)).toEqual({ ok: true });
    const siteId = world.sites[0]!.id;
    const request = (
      id: string, sequence: number, type: PrototypeLogisticsRequest['type'], resource: 'wood' | 'ore',
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
      request('second-build', 3, 'DELIVER_TO_CONSTRUCTION', 'ore', { pickupStoreId: 'store-1' })
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
      { id: 'store-full', x: 500, wood: 1, ore: 0, capacity: 1 },
      { id: 'store-open', x: 700, wood: 3, ore: 2, capacity: 12 }
    ];
    world.residents[0]!.role = 'builder';
    world.residents[1]!.role = 'hauler';
    const simulation = new PrototypeSimulation(world);
    simulation.place('house', 2);
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

    expect(world.logisticsRequests.find((request) => request.id === 'blocked-old')?.status).toBe('cancelled');
    expect(world.logisticsRequests.find((request) => request.id === 'ready-build')?.assignedHaulerId).toBe('r2');
  });

  it('retries a blocked stockpile request after a warehouse frees capacity', () => {
    const world = createNewWorld();
    world.stores = [{ id: 'store-1', x: 500, wood: 2, ore: 0, capacity: 2 }];
    world.residents[0]!.role = 'woodcutter';
    world.residents[0]!.x = PROTOTYPE_CONFIG.sources.homePileX;
    world.residents[1]!.role = 'hauler';
    world.residents[1]!.x = PROTOTYPE_CONFIG.sources.homePileX;
    removeTreeSource(world, 'home');
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
    expect(world.stores[0]).toMatchObject({ wood: 2, ore: 0 });
    expect(pile.amount).toBe(1);
    expect(simulation.totals().wood).toBe(3);
  });

  it('keeps autonomous workers out of the hauler queue', () => {
    const world = createNewWorld();
    world.residents[0]!.role = 'woodcutter';
    world.residents[0]!.x = 234;
    world.residents[1]!.role = 'hauler';
    world.residents[1]!.x = PROTOTYPE_CONFIG.sources.homePileX;
    const simulation = new PrototypeSimulation(world);
    expect(simulation.setLogisticsMode('r1', 'independent')).toBe(true);

    run(simulation, 25);

    expect(world.logisticsRequests.filter((request) => request.initiatorId === 'r1' && request.status !== 'cancelled')).toHaveLength(0);
    expect(world.residents[1]!.logisticsRequestId).toBeNull();
    expect(world.stores[0]!.wood).toBeGreaterThan(3);
  });

  it('lets a miner deliver its own ore when there is no hauler', () => {
    const world = createNewWorld();
    world.oreSource = 2;
    world.residents[0]!.role = 'miner';
    world.residents[0]!.x = 1900;
    const before = world.stores[0]!.ore;
    const simulation = new PrototypeSimulation(world);

    run(simulation, 15);

    expect(world.oreSource).toBeLessThan(2);
    expect(world.stores[0]!.ore).toBeGreaterThan(before);
    expect(world.logisticsRequests).toHaveLength(0);
  });

  it('returns a delegated resident to queued logistics after autonomous fallback completes', () => {
    const world = createNewWorld();
    world.stores = [{ id: 'store-1', x: 963, wood: 0, ore: 0, capacity: 12 }];
    removeTreeSource(world, 'home');
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
    run(simulation, 6);
    expect(world.stores[0]).toMatchObject({ wood: 3, ore: 0 });
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
    world.stores = [{ id: 'store-1', x: 963, wood: 60, ore: 50, capacity: 120 }];
    const simulation = new PrototypeSimulation(world);
    expect(simulation.place('house', 1)).toEqual({ ok: true });
    simulation.assign('r1', 'builder');
    simulation.assign('r2', 'hauler');
    expect(world.residents).toHaveLength(3);

    run(simulation, 420);

    expect(world.residents).toHaveLength(4);
    expect(world.buildings.some((building) => building.kind === 'house')).toBe(true);
    expect(world.sites).toHaveLength(0);
    expect(world.logisticsRequests.filter((request) => request.type === 'DELIVER_TO_CONSTRUCTION')
      .every((request) => request.status === 'completed')).toBe(true);
  });

  it('cancels an unstarted request when its worker switches to independent logistics', () => {
    const world = createNewWorld();
    world.residents[0]!.role = 'woodcutter';
    world.residents[0]!.x = PROTOTYPE_CONFIG.sources.homePileX;
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
    expect(simulation.totals().wood).toBe(33);
  });

  it('self-delivers a local pile after the last hauler leaves the logistics role', () => {
    const world = createNewWorld();
    world.stores = [{ id: 'store-1', x: 500, wood: 0, ore: 0, capacity: 12 }];
    removeTreeSource(world, 'home');
    world.residents[0]!.role = 'woodcutter';
    world.residents[0]!.x = PROTOTYPE_CONFIG.sources.homePileX;
    world.residents[1]!.role = 'hauler';
    world.residents[1]!.x = PROTOTYPE_CONFIG.sources.homePileX;
    world.stockpiles.find((pile) => pile.sourceId === 'home')!.amount = 3;
    const simulation = new PrototypeSimulation(world);

    simulation.step(0.1);
    const request = world.logisticsRequests[0]!;
    expect(request.status).toBe('assigned');

    simulation.assign('r2', 'idle');
    run(simulation, 4);

    expect(request.status).toBe('cancelled');
    expect(world.stockpiles.find((pile) => pile.sourceId === 'home')?.amount).toBe(0);
    expect(world.stores[0]!.wood).toBe(3);
    expect(simulation.totals().wood).toBe(3);
  });

  it('finishes an in-progress haul when its initiator switches to independent logistics', () => {
    const world = createNewWorld();
    world.stores = [{ id: 'store-1', x: 963, wood: 0, ore: 0, capacity: 12 }];
    removeTreeSource(world, 'home');
    world.residents[0]!.role = 'woodcutter';
    world.residents[0]!.x = PROTOTYPE_CONFIG.sources.homePileX;
    world.residents[1]!.role = 'hauler';
    world.residents[1]!.x = PROTOTYPE_CONFIG.sources.homePileX;
    world.stockpiles.find((pile) => pile.sourceId === 'home')!.amount = 4;
    const simulation = new PrototypeSimulation(world);
    simulation.step(0.1);
    simulation.step(0.1);
    const request = world.logisticsRequests[0]!;
    expect(world.residents[1]).toMatchObject({ cargo: 'wood', cargoAmount: 4, logisticsRequestId: request.id });
    expect(request.status).toBe('in_progress');

    expect(simulation.setLogisticsMode('r1', 'independent')).toBe(true);
    expect(request).toMatchObject({ status: 'in_progress', assignedHaulerId: 'r2' });
    run(simulation, 6.5);

    expect(request.status).toBe('completed');
    expect(world.stores[0]!.wood).toBe(4);
    expect(simulation.totals().wood).toBe(4);
    expect(world.logisticsRequests.filter((candidate) => candidate.initiatorId === 'r1' &&
      candidate.status !== 'cancelled')).toHaveLength(1);
  });

  it('delivers cargo safely if a hauler changes profession mid-route', () => {
    const world = createNewWorld();
    world.stores = [{ id: 'store-1', x: 963, wood: 0, ore: 0, capacity: 12 }];
    removeTreeSource(world, 'home');
    world.residents[0]!.role = 'woodcutter';
    world.residents[0]!.x = PROTOTYPE_CONFIG.sources.homePileX;
    world.residents[1]!.role = 'hauler';
    world.residents[1]!.x = PROTOTYPE_CONFIG.sources.homePileX;
    world.stockpiles.find((pile) => pile.sourceId === 'home')!.amount = 4;
    const simulation = new PrototypeSimulation(world);
    simulation.step(0.1);
    simulation.step(0.1);
    const request = world.logisticsRequests[0]!;
    expect(world.residents[1]!.cargoAmount).toBe(4);

    expect(simulation.assign('r2', 'idle')).toBe(true);
    expect(world.residents[1]).toMatchObject({ role: 'idle', cargo: 'wood', cargoAmount: 4 });
    expect(request).toMatchObject({ status: 'in_progress', assignedHaulerId: 'r2' });
    run(simulation, 6.5);

    expect(request.status).toBe('completed');
    expect(world.residents[1]!.cargo).toBeNull();
    expect(world.stores[0]!.wood).toBe(4);
    expect(simulation.totals().wood).toBe(4);
  });

  it('keeps an autonomous builder independent while a hauler is available', () => {
    const world = createNewWorld();
    world.stores = [{ id: 'store-1', x: 963, wood: 60, ore: 50, capacity: 120 }];
    world.residents[1]!.role = 'hauler';
    const simulation = new PrototypeSimulation(world);
    expect(simulation.place('house', 1)).toEqual({ ok: true });
    simulation.assign('r1', 'builder');
    expect(simulation.setLogisticsMode('r1', 'independent')).toBe(true);

    run(simulation, 420);

    expect(world.buildings.some((building) => building.kind === 'house')).toBe(true);
    expect(world.logisticsRequests.every((request) => request.status === 'cancelled')).toBe(true);
    expect(world.residents[1]!.logisticsRequestId).toBeNull();
  });

  it('returns the hauler to resource pickups after construction is complete', () => {
    const world = createNewWorld();
    world.stores = [{ id: 'store-1', x: 963, wood: 60, ore: 50, capacity: 300 }];
    world.residents[0]!.role = 'builder';
    world.residents[1]!.role = 'hauler';
    world.residents[2]!.role = 'woodcutter';
    world.residents[2]!.x = 234;
    const simulation = new PrototypeSimulation(world);
    expect(simulation.place('house', 1)).toEqual({ ok: true });

    run(simulation, 420);

    expect(world.buildings.some((building) => building.kind === 'house')).toBe(true);
    expect(world.logisticsRequests.some((request) => request.type === 'DELIVER_TO_CONSTRUCTION' &&
      request.status === 'completed')).toBe(true);
    expect(world.logisticsRequests.some((request) => request.type === 'PICKUP_RESOURCE' &&
      request.status === 'completed')).toBe(true);
    expect(world.stores[0]!.wood).toBeGreaterThan(0);
  });

  it('blocks an unconfirmed or unstaffed demolition and sends a free builder to the target', () => {
    const world = createNewWorld();
    addHouse(world);
    const simulation = new PrototypeSimulation(world);

    expect(simulation.startDemolition('house-test')).toMatchObject({ ok: false, reason: 'Нужен свободный строитель.' });
    simulation.assign('r1', 'builder');
    expect(simulation.startDemolition('house-test')).toEqual({ ok: true });
    expect(world.residents[0]).toMatchObject({ role: 'builder', mode: 'moving', targetX: 750 });
    simulation.step(0.1);
    expect(world.buildings.find((building) => building.id === 'house-test')?.demolition?.progress).toBe(0);
    expect(simulation.startDemolition('house-test')).toMatchObject({ ok: false, reason: 'Снос уже начат.' });
  });

  it('waits for physical arrival, works for fifteen seconds, refunds a house once, and opens its cell', () => {
    const world = createNewWorld();
    addHouse(world);
    const simulation = new PrototypeSimulation(world);
    simulation.assign('r1', 'builder');
    expect(simulation.startDemolition('house-test')).toEqual({ ok: true });

    run(simulation, 1.5);
    expect(world.residents[0]).toMatchObject({ x: 750, mode: 'building' });
    expect(world.buildings.find((building) => building.id === 'house-test')?.demolition?.progress)
      .toBeGreaterThan(0);
    runUntilBuildingRemoved(simulation, 'house-test', PROTOTYPE_CONFIG.demolition.workSeconds + 3);

    expect(world.buildings.some((building) => building.id === 'house-test')).toBe(false);
    expect(world.landCells.find((cell) => cell.id === 1)?.state).toBe('prepared');
    expect(world.occupiedPlots).not.toContain(1);
    expect(world.residents[0]!.role).toBe('builder');
    expect(refunds(world)).toEqual(demolitionRefund('house'));
  });

  it('pauses demolition without losing progress when the builder changes profession, then resumes', () => {
    const world = createNewWorld();
    addHouse(world);
    const simulation = new PrototypeSimulation(world);
    simulation.assign('r1', 'builder');
    simulation.startDemolition('house-test');
    run(simulation, 2);
    const beforePause = world.buildings.find((building) => building.id === 'house-test')!.demolition!.progress;

    simulation.assign('r1', 'miner');
    const demolition = world.buildings.find((building) => building.id === 'house-test')!.demolition!;
    expect(demolition).toMatchObject({ paused: true, progress: beforePause, workerId: null });
    run(simulation, 4);
    expect(demolition.progress).toBe(beforePause);
    expect(simulation.resumeDemolition('house-test')).toMatchObject({
      ok: false, reason: 'Освободи строителя, чтобы продолжить снос.'
    });

    simulation.assign('r2', 'builder');
    expect(simulation.resumeDemolition('house-test')).toEqual({ ok: true });
    expect(world.buildings.find((building) => building.id === 'house-test')?.demolition)
      .toMatchObject({ paused: false, progress: beforePause, workerId: 'r2' });
    run(simulation, PROTOTYPE_CONFIG.demolition.workSeconds + 2);
    expect(world.buildings.some((building) => building.id === 'house-test')).toBe(false);
  });

  it('cancels demolition by restoring the building and freeing the worker without refund', () => {
    const world = createNewWorld();
    addHouse(world);
    const simulation = new PrototypeSimulation(world);
    simulation.assign('r1', 'builder');
    simulation.startDemolition('house-test');
    run(simulation, 2);

    expect(simulation.cancelDemolition('house-test')).toBe(true);
    expect(world.buildings.find((building) => building.id === 'house-test')?.demolition).toBeUndefined();
    expect(world.occupiedPlots).toContain(1);
    expect(world.stockpiles.filter((pile) => pile.sourceId === 'demolition')).toHaveLength(0);
    expect(world.residents[0]).toMatchObject({ role: 'builder', mode: 'idle', targetX: null });
    expect(simulation.cancelDemolition('house-test')).toBe(false);
  });

  it('restores an unfinished demolition and its assigned builder from the existing save key', () => {
    const world = createNewWorld();
    addHouse(world);
    const simulation = new PrototypeSimulation(world);
    simulation.assign('r1', 'builder');
    simulation.startDemolition('house-test');
    run(simulation, 4);
    const beforeSave = world.buildings.find((building) => building.id === 'house-test')!.demolition!.progress;
    const restored = parseSavedWorld(JSON.stringify(world));

    expect(restored?.buildings.find((building) => building.id === 'house-test')?.demolition)
      .toMatchObject({ progress: beforeSave, workerId: 'r1', paused: false });
    const resumed = new PrototypeSimulation(restored!);
    expect(resumed.world.residents.find((person) => person.id === 'r1')).toMatchObject({
      role: 'builder', targetX: 750
    });
    run(resumed, PROTOTYPE_CONFIG.demolition.workSeconds + 2);
    expect(resumed.world.buildings.some((building) => building.id === 'house-test')).toBe(false);
    expect(refunds(resumed.world).wood + resumed.world.residents.reduce((sum, person) => sum + (person.cargo === 'wood' ? person.cargoAmount : 0), 0) + resumed.world.stores.reduce((sum, store) => sum + store.wood, 0)).toBe(PROTOTYPE_CONFIG.initialResources.wood + demolitionRefund('house').wood);
  });

  it('returns the configured warehouse refund and rebuilds on the same prepared cell', () => {
    const world = createNewWorld();
    addWarehouse(world);
    world.stores[1]!.wood = 6;
    world.stores[1]!.ore = 5;
    const simulation = new PrototypeSimulation(world);
    simulation.assign('r1', 'builder');
    expect(simulation.startDemolition('warehouse:store-2')).toMatchObject({
      ok: false, reason: 'Нужно подтвердить потерю содержимого: 6 древесины и 5 породы.'
    });
    expect(simulation.startDemolition('warehouse:store-2', true)).toEqual({ ok: true });
    runUntilBuildingRemoved(simulation, 'warehouse:store-2');

    expect(world.stores.map((store) => store.id)).toEqual(['store-1']);
    expect(refunds(world)).toEqual(demolitionRefund('warehouse'));
    expect(simulation.isPlotAvailable(3)).toBe(true);
    expect(simulation.place('house', 3)).toEqual({ ok: true });
  });

  it('allows demolition of the last or stocked warehouse after confirming its contents', () => {
    const onlyStore = createNewWorld();
    const alone = new PrototypeSimulation(onlyStore);
    alone.assign('r1', 'builder');
    expect(alone.demolitionRestriction('warehouse:store-1')).toBeNull();
    expect(alone.startDemolition('warehouse:store-1')).toMatchObject({ ok: false });
    expect(alone.startDemolition('warehouse:store-1', true)).toEqual({ ok: true });

    const world = createNewWorld();
    addWarehouse(world);
    world.stores[1]!.wood = 1;
    const simulation = new PrototypeSimulation(world);
    simulation.assign('r1', 'builder');
    expect(simulation.demolitionRestriction('warehouse:store-2')).toBeNull();
    expect(simulation.startDemolition('warehouse:store-2')).toMatchObject({ ok: false });
    expect(simulation.startDemolition('warehouse:store-2', true)).toEqual({ ok: true });
    expect(world.stores[1]).toMatchObject({ wood: 1, closedForDemolition: true });

    const routedWorld = createNewWorld();
    addWarehouse(routedWorld);
    routedWorld.residents[2]!.role = 'hauler';
    routedWorld.stockpiles.push({ id: 'loose-inbound', sourceId: 'test-ground', resource: 'wood',
      x: 900, amount: 8, capacity: 10 });
    routedWorld.logisticsRequests.push({
      id: 'request-store-two', sequence: 1, createdAt: 0, initiatorId: 'r1',
      type: 'PICKUP_RESOURCE', resource: 'wood', amount: 8,
      pickupStockpileId: 'loose-inbound', pickupStoreId: null, destinationStoreId: 'store-2', destinationSiteId: null,
      status: 'assigned', assignedHaulerId: 'r3'
    });
    Object.assign(routedWorld.residents[2]!, { logisticsRequestId: 'request-store-two', pickupStockpileId: 'loose-inbound',
      targetStoreId: 'store-2', pickupAmount: 8, pickupResource: 'wood', mode: 'moving' });
    const routed = new PrototypeSimulation(routedWorld);
    routed.assign('r1', 'builder');
    expect(routed.demolitionRestriction('warehouse:store-2')).toBeNull();
    expect(routed.startDemolition('warehouse:store-2')).toEqual({ ok: true });
    expect(routedWorld.logisticsRequests.find((request) => request.id === 'request-store-two'))
      .toMatchObject({ status: 'cancelled', assignedHaulerId: null });
    expect(routedWorld.residents[2]).toMatchObject({ logisticsRequestId: null, targetStoreId: null, cargo: null });
  });

  it('refuses to remove housing while population would exceed the remaining capacity', () => {
    const world = createNewWorld();
    addHouse(world);
    world.residents.push({ ...world.residents[2]!, id: 'r4', name: 'Тихон', x: 850, role: 'idle' });
    const simulation = new PrototypeSimulation(world);
    simulation.assign('r1', 'builder');

    expect(simulation.demolitionRestriction('house-test')).toContain('будет 3 мест жилья на 4 жителей');
    expect(simulation.startDemolition('house-test').ok).toBe(false);
  });

  it('delivers demolition materials physically and keeps them at the site while storage is full', () => {
    const world = createNewWorld();
    addWarehouse(world);
    world.stores[0]!.wood = 120;
    world.stores[0]!.ore = 0;
    world.residents[1]!.role = 'hauler';
    const simulation = new PrototypeSimulation(world);
    simulation.assign('r1', 'builder');
    simulation.startDemolition('warehouse:store-2');
    run(simulation, 30);

    expect(refunds(world)).toEqual(demolitionRefund('warehouse'));
    expect(world.stores).toHaveLength(1);
    world.stores[0]!.wood -= 45;
    run(simulation, 80);
    expect(refunds(world)).toEqual({ wood: 0, ore: 0 });
    expect(world.stores[0]).toMatchObject({ wood: 100, ore: 20 });
  });

  it('preserves returned piles across repeated reloads without issuing a second refund', () => {
    const world = createNewWorld();
    addWarehouse(world);
    const simulation = new PrototypeSimulation(world);
    simulation.assign('r1', 'builder');
    simulation.startDemolition('warehouse:store-2');
    runUntilBuildingRemoved(simulation, 'warehouse:store-2');

    const firstReload = parseSavedWorld(JSON.stringify(world));
    const secondReload = parseSavedWorld(JSON.stringify(firstReload));
    expect(refunds(firstReload!)).toEqual(demolitionRefund('warehouse'));
    expect(secondReload?.stockpiles).toEqual(firstReload?.stockpiles);
    expect(secondReload?.buildings.some((building) => building.id === 'warehouse:store-2')).toBe(false);
  });

  it('physically supplies construction from demolition refunds when no hauler exists', () => {
    const world = createNewWorld();
    addHouse(world); addWarehouse(world);
    world.residents[0]!.x = 1590;
    world.stores[0]!.wood = 4; world.stores[0]!.ore = 3;
    removeTreeSource(world, 'home'); world.oreSource = 0;
    const simulation = new PrototypeSimulation(world);
    simulation.assign('r1', 'builder');
    expect(simulation.startDemolition('warehouse:store-2')).toEqual({ ok: true });
    for (let tick = 0; tick < 200 && world.buildings.some((b) => b.id === 'warehouse:store-2'); tick++) simulation.step(0.1);
    expect(refunds(world)).toEqual({ wood: 25, ore: 20 });
    expect(simulation.place('house', 2)).toEqual({ ok: true });
    const site = world.sites[0]!;
    simulation.step(0.1);
    expect(world.residents[0]).toMatchObject({ mode: 'moving', targetSiteId: site.id });
    expect(site).toMatchObject({ deliveredWood: 0, deliveredOre: 0 });
    run(simulation, 200);
    expect(refunds(world)).toEqual({ wood: 0, ore: 0 });
    expect(site).toMatchObject({ deliveredWood: 29, deliveredOre: 23 });
    expect(site.progress).toBeCloseTo(52 / 110, 8);
    expect(world.stores[0]).toMatchObject({ wood: 0, ore: 0 });
    expect(world.residents[0]!.cargo).toBeNull();
  });
});
