import { describe, expect, it } from 'vitest';
import {
  createNewWorld, ECONOMY_VERSION, parseSavedWorld, PROTOTYPE_CONFIG, PrototypeSimulation, WORLD
} from './simulation.js';
import { LAND_GRID_CELLS, LAND_GRID_CONFIG } from './land-grid.js';

function run(simulation: PrototypeSimulation, seconds: number): void {
  for (let tick = 0; tick < Math.ceil(seconds * 10); tick++) simulation.step(0.1);
}

function advanceUntil(simulation: PrototypeSimulation, predicate: () => boolean, seconds: number): boolean {
  for (let tick = 0; tick < seconds * 10 && !predicate(); tick++) simulation.step(0.1);
  return predicate();
}

function activeStoreCapacity(world: ReturnType<typeof createNewWorld>): boolean {
  return world.stores.every((store) => store.wood >= 0 && store.ore >= 0 &&
    store.wood + store.ore <= store.capacity);
}

describe('two-resource economy regressions', () => {
  it.each([
    { wood: 60, ore: 60 },
    { wood: 100, ore: 20 }
  ])('counts $wood wood and $ore ore against one combined 120-unit warehouse capacity', ({ wood, ore }) => {
    const world = createNewWorld();
    world.stores = [{ id: 'store-1', x: 500, wood, ore, capacity: PROTOTYPE_CONFIG.warehouseCapacity }];
    const simulation = new PrototypeSimulation(world);

    expect(simulation.totals()).toMatchObject({ stored: 120, capacity: 120 });
    expect(activeStoreCapacity(world)).toBe(true);
    expect(parseSavedWorld(JSON.stringify(world))?.stores[0]).toMatchObject({ wood, ore, capacity: 120 });
  });

  it('migrates old stone and boards throughout a save without losing overflow or routes', () => {
    const legacy = JSON.parse(JSON.stringify(createNewWorld())) as Record<string, any>;
    legacy.economyVersion = 3;
    legacy.stores = [{ id: 'store-1', buildingId: 'warehouse:store-1', x: 1050,
      wood: 60, stone: 30, boards: 30, capacity: 120 }];
    legacy.buildings = [
      ...legacy.buildings,
      { id: 'house-upgrade-owner', kind: 'house', x: 750, y: WORLD.groundY,
        gridColumn: 1, gridRow: LAND_GRID_CONFIG.surfaceCellRow,
        footprint: { widthCells: 1, heightCells: 1 }, level: 1 },
      { id: 'owner-sawmill', kind: 'sawmill', x: 1900, y: WORLD.groundY,
        gridColumn: 5, gridRow: LAND_GRID_CONFIG.surfaceCellRow,
        footprint: { widthCells: 2, heightCells: 1 }, sourceTreeId: 'tree-home',
        inputWood: 5, productionProgress: 3 }
    ];
    legacy.sites = [{ id: 'owner-upgrade', kind: 'house-upgrade', x: 750, y: WORLD.groundY,
      gridColumn: 1, gridRow: LAND_GRID_CONFIG.surfaceCellRow,
      footprint: { widthCells: 1, heightCells: 1 }, upgradeBuildingId: 'house-upgrade-owner',
      deliveredWood: 7, deliveredStone: 9, deliveredBoards: 8, progress: 0.24, stage: 1 }];
    legacy.stockpiles = [
      { id: 'pile-wood-home', sourceId: 'home', resource: 'wood', x: 150, amount: 4, capacity: 10, treeId: 'tree-home' },
      { id: 'pile-ore-main', sourceId: 'stone', resource: 'stone', x: 1850, amount: 6, capacity: 10 },
      { id: 'old-board-output', sourceId: 'sawmill-output', resource: 'boards', x: 1400, amount: 5, capacity: 10 }
    ];
    legacy.residents[0] = { ...legacy.residents[0], role: 'sawmiller', cargo: 'boards', cargoAmount: 3,
      mode: 'carrying', targetSiteId: 'owner-upgrade', logisticsRequestId: 'old-delivery',
      pickupResource: 'stone', pickupAmount: 4 };
    legacy.logisticsRequests = [{ id: 'old-delivery', sequence: 1, createdAt: 0, initiatorId: 'r2',
      type: 'DELIVER_TO_CONSTRUCTION', resource: 'boards', amount: 3, pickupStockpileId: null,
      pickupStoreId: 'store-1', destinationStoreId: null, destinationSiteId: 'owner-upgrade',
      status: 'in_progress', assignedHaulerId: 'r1' }];

    const migrated = parseSavedWorld(JSON.stringify(legacy));
    expect(migrated).not.toBeNull();
    expect(migrated?.economyVersion).toBe(ECONOMY_VERSION);
    expect(migrated?.stores[0]).toMatchObject({ wood: 120, ore: 0, capacity: 120 });
    expect(migrated?.stockpiles.find((pile) => pile.sourceId === 'migration' && pile.resource === 'wood')?.amount)
      .toBe(10);
    expect(migrated?.stockpiles.filter((pile) => pile.sourceId === 'migration-storage-overflow' && pile.resource === 'ore')
      .reduce((sum, pile) => sum + pile.amount, 0)).toBe(30);
    expect(migrated?.stockpiles.find((pile) => pile.treeId === 'tree-home'))
      .toMatchObject({ resource: 'wood', amount: 9, capacity: 50 });
    expect(migrated?.buildings.find((building) => building.id === 'owner-sawmill'))
      .toMatchObject({ sourceTreeId: 'tree-home' });
    expect(migrated?.buildings.find((building) => building.id === 'owner-sawmill'))
      .not.toHaveProperty('inputWood');
    expect(migrated?.sites[0]).toMatchObject({ deliveredWood: 23, deliveredOre: 9, progress: 0.24,
      upgradeBuildingId: 'house-upgrade-owner' });
    expect(migrated?.residents[0]).toMatchObject({ role: 'woodcutter', cargo: 'wood', cargoAmount: 6,
      pickupResource: null, pickupAmount: 4, targetSiteId: 'owner-upgrade' });
    expect(migrated?.logisticsRequests[0]).toMatchObject({ resource: 'wood', amount: 6,
      status: 'in_progress', destinationSiteId: 'owner-upgrade' });
    expect(JSON.stringify(migrated)).not.toMatch(/"(?:boards|stone|deliveredBoards|deliveredStone)"/);
    expect(parseSavedWorld(JSON.stringify(migrated))).toEqual(migrated);
  });

  it('requires a living adult tree for the sawmill and raises only that source pile to fifty', () => {
    const world = createNewWorld();
    const tree = world.trees.find((candidate) => candidate.id === 'tree-home')!;
    const emptyPrepared = LAND_GRID_CELLS.find((cell) => cell.environment === 'surface' &&
      cell.role === 'building' && world.landCells.find((state) => state.id === cell.id)?.state === 'prepared' &&
      !world.trees.some((candidate) => candidate.cellId === cell.id))!;
    const simulation = new PrototypeSimulation(world);

    expect(simulation.place('sawmill', emptyPrepared.id).ok).toBe(false);
    expect(simulation.place('sawmill', tree.cellId)).toEqual({ ok: true });
    expect(world.sites[0]?.sourceTreeId).toBe(tree.id);
    world.stores[0]!.wood = 50;
    world.stores[0]!.ore = 40;
    simulation.assign('r1', 'builder');
    simulation.assign('r2', 'hauler');
    expect(advanceUntil(simulation, () => world.buildings.some((building) => building.kind === 'sawmill'), 700))
      .toBe(true);

    const sawmill = world.buildings.find((building) => building.kind === 'sawmill')!;
    const pile = world.stockpiles.find((candidate) => candidate.treeId === tree.id)!;
    expect(sawmill.sourceTreeId).toBe(tree.id);
    expect(pile.capacity).toBe(PROTOTYPE_CONFIG.stockpile.upgradedCapacity);
    expect(world.stores[0]!.capacity).toBe(PROTOTYPE_CONFIG.warehouseCapacity);
    const harvestedBeforeWorker = simulation.activity.harvested.wood;
    run(simulation, 35);
    expect(simulation.activity.harvested.wood).toBe(harvestedBeforeWorker);
    expect(Object.keys(simulation.activity.harvested)).toEqual(['wood', 'ore']);
    expect(Object.keys(world.stores[0]!)).not.toContain('boards');
  });

  it('grows a planted tree, fells one batch, regrows quickly, and supports a second harvest', () => {
    const world = createNewWorld();
    world.stores[0]!.wood = PROTOTYPE_CONFIG.trees.plantingCost;
    const cell = LAND_GRID_CELLS.find((candidate) => candidate.environment === 'surface' &&
      candidate.role === 'building' && world.landCells.find((stored) => stored.id === candidate.id)?.state === 'prepared' &&
      !world.trees.some((tree) => tree.cellId === candidate.id))!;
    const simulation = new PrototypeSimulation(world);
    const planted = simulation.plantTree(cell.id);
    expect(planted.ok).toBe(true);
    if (!planted.ok) return;
    const tree = world.trees.find((candidate) => candidate.id === planted.treeId)!;
    expect(tree.planted).toBe(true);
    run(simulation, PROTOTYPE_CONFIG.trees.initialGrowthSeconds - 1);
    expect(tree.state).toBe('growing');
    const restored = parseSavedWorld(JSON.stringify(world))!;
    expect(restored.trees.find((candidate) => candidate.id === tree.id)?.growthSeconds).toBeGreaterThan(0);
    const resumed = new PrototypeSimulation(restored);
    const resumedTree = resumed.world.trees.find((candidate) => candidate.id === tree.id)!;
    run(resumed, 2);
    expect(resumedTree.state).toBe('mature');

    resumed.world.trees = resumed.world.trees.filter((candidate) => candidate.id === resumedTree.id);
    resumed.world.residents[0]!.x = resumedTree.x;
    expect(resumed.assign('r1', 'woodcutter')).toBe(true);
    expect(advanceUntil(resumed, () => resumedTree.state === 'falling', 40)).toBe(true);
    expect(resumed.activity.harvested.wood).toBe(10);
    const pile = resumed.world.stockpiles.find((candidate) => candidate.treeId === resumedTree.id)!;
    expect(pile.amount).toBe(10);
    run(resumed, PROTOTYPE_CONFIG.trees.fallSeconds + PROTOTYPE_CONFIG.trees.stumpSeconds +
      PROTOTYPE_CONFIG.trees.regrowthSeconds + 1);
    expect(resumedTree.state).toBe('mature');
    resumed.world.stockpiles.find((candidate) => candidate.treeId === resumedTree.id)!.amount = 0;
    expect(advanceUntil(resumed, () => resumed.activity.harvested.wood === 20, 40)).toBe(true);
    expect(resumedTree.state).toBe('falling');
  });

  it('keeps a finite deposit finite, then lets a completed mine produce ore up to its local limit', () => {
    const finite = new PrototypeSimulation(createNewWorld());
    finite.world.residents[0]!.x = PROTOTYPE_CONFIG.sources.oreX;
    finite.assign('r1', 'miner');
    run(finite, 4);
    expect(finite.world.oreSource).toBeLessThan(PROTOTYPE_CONFIG.ore.initialDeposit);
    finite.world.oreSource = 0;
    run(finite, 60);
    expect(finite.world.oreSource).toBe(0);
    expect(finite.world.residents[0]!.blockedReason).toContain('Построй шахту');

    const world = createNewWorld();
    const oreCell = LAND_GRID_CELLS.find((cell) => cell.resource === 'ore-main')!;
    world.oreSource = 0;
    world.stores[0]!.wood = PROTOTYPE_CONFIG.ore.mineCost.wood;
    world.stores[0]!.ore = 0;
    const mine = new PrototypeSimulation(world);
    expect(mine.place('mine', oreCell.id)).toEqual({ ok: true });
    mine.assign('r1', 'builder');
    expect(advanceUntil(mine, () => world.buildings.some((building) => building.kind === 'mine'), 400)).toBe(true);
    const pile = world.stockpiles.find((candidate) => candidate.sourceId === 'ore')!;
    expect(pile.capacity).toBe(50);
    expect(world.stores[0]!.capacity).toBe(PROTOTYPE_CONFIG.warehouseCapacity);
    world.residents[1]!.x = world.buildings.find((building) => building.kind === 'mine')!.x;
    mine.assign('r2', 'miner');
    expect(advanceUntil(mine, () => mine.activity.harvested.ore > 0, 20)).toBe(true);
    expect(world.oreSource).toBe(0);
    expect(pile.amount).toBeGreaterThan(0);
    pile.amount = pile.capacity;
    world.stores[0]!.wood = 0;
    world.stores[0]!.ore = world.stores[0]!.capacity;
    const harvested = mine.activity.harvested.ore;
    run(mine, 20);
    expect(pile.amount).toBe(50);
    expect(mine.activity.harvested.ore).toBe(harvested);
  });

  it('keeps the house upgrade action active at the two-resource cost and preserves work on role changes', () => {
    const world = createNewWorld();
    const houseId = 'upgradeable-house';
    world.buildings.push({ id: houseId, kind: 'house', x: 750, y: WORLD.groundY,
      gridColumn: 1, gridRow: LAND_GRID_CONFIG.surfaceCellRow,
      footprint: { widthCells: 1, heightCells: 1 }, level: 1 });
    world.occupiedPlots.push(1);
    world.stores[0]!.wood = 40;
    world.stores[0]!.ore = 30;
    const simulation = new PrototypeSimulation(world);
    expect(simulation.startHouseUpgrade(houseId)).toEqual({ ok: true });
    simulation.assign('r1', 'builder');
    simulation.assign('r2', 'hauler');
    expect(advanceUntil(simulation, () => world.sites[0]?.deliveredWood === 40 &&
      world.sites[0]?.deliveredOre === 30, 60)).toBe(true);
    const site = world.sites[0]!;
    const progress = site.progress;
    expect(site.deliveredWood).toBe(40);
    expect(site.deliveredOre).toBe(30);

    simulation.assign('r1', 'miner');
    run(simulation, 15);
    expect(site.progress).toBe(progress);
    simulation.assign('r1', 'builder');
    expect(advanceUntil(simulation, () => world.buildings.find((building) => building.id === houseId)?.level === 2, 180))
      .toBe(true);
    expect(simulation.totals().housing).toBe(5);
    expect(world.residents).toHaveLength(5);
    expect(activeStoreCapacity(world)).toBe(true);
  });
});
