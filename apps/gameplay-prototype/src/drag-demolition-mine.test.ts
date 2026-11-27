import { describe, expect, it } from 'vitest';
import {
  createNewWorld, demolitionRefund, isLooseMaterial, mineStockpileSourceId, NATURAL_ORE_WORKPLACE_ID,
  parseSavedWorld, PROTOTYPE_CONFIG, PrototypeSimulation, WORLD, type PrototypeBuilding,
  type PrototypeWorld
} from './simulation.js';
import { LAND_GRID_CELLS, LAND_GRID_CONFIG } from './land-grid.js';

function run(simulation: PrototypeSimulation, seconds: number): void {
  for (let tick = 0; tick < Math.ceil(seconds * 10); tick += 1) simulation.step(0.1);
}

function runUntilBuildingRemoved(simulation: PrototypeSimulation, buildingId: string, seconds = 80): void {
  for (let tick = 0; tick < Math.ceil(seconds * 10) &&
      simulation.world.buildings.some((building) => building.id === buildingId); tick += 1) simulation.step(0.1);
}

function addMine(world: PrototypeWorld, id: string, column: number): PrototypeBuilding {
  const cell = LAND_GRID_CELLS.find((candidate) => candidate.environment === 'surface' && candidate.column === column)!;
  const mine: PrototypeBuilding = {
    id, kind: 'mine', x: cell.centerX, y: WORLD.groundY, gridColumn: column,
    gridRow: LAND_GRID_CONFIG.surfaceCellRow, footprint: { widthCells: 1, heightCells: 1 }
  };
  world.buildings.push(mine);
  world.occupiedPlots.push(cell.id);
  return mine;
}

function addWarehouse(world: PrototypeWorld, storeId: string, column: number): PrototypeBuilding {
  const cell = LAND_GRID_CELLS.find((candidate) => candidate.environment === 'surface' && candidate.column === column)!;
  const building: PrototypeBuilding = {
    id: `warehouse:${storeId}`, kind: 'warehouse', x: cell.centerX, y: WORLD.groundY,
    gridColumn: column, gridRow: LAND_GRID_CONFIG.surfaceCellRow,
    footprint: { widthCells: 1, heightCells: 1 }
  };
  world.buildings.push(building);
  world.stores.push({ id: storeId, buildingId: building.id, x: cell.centerX, wood: 0, ore: 0,
    capacity: PROTOTYPE_CONFIG.warehouseCapacity });
  world.occupiedPlots.push(cell.id);
  return building;
}

describe('drag assignment, warehouse demolition, and independent mines', () => {
  it('keeps each dragged builder on the selected construction site across reload', () => {
    const world = createNewWorld();
    world.sites.push(
      { id: 'site-west', kind: 'house', x: 1650, y: WORLD.groundY, gridColumn: 5,
        gridRow: LAND_GRID_CONFIG.surfaceCellRow, footprint: { widthCells: 1, heightCells: 1 },
        deliveredWood: 0, deliveredOre: 0, progress: 0, stage: 0, priority: 2, paused: false },
      { id: 'site-east', kind: 'house', x: 2250, y: WORLD.groundY, gridColumn: 7,
        gridRow: LAND_GRID_CONFIG.surfaceCellRow, footprint: { widthCells: 1, heightCells: 1 },
        deliveredWood: 0, deliveredOre: 0, progress: 0, stage: 0, priority: 2, paused: false }
    );
    const simulation = new PrototypeSimulation(world);

    expect(simulation.assign('r1', 'builder', 'site-west')).toBe(true);
    expect(simulation.assign('r2', 'builder', 'site-east')).toBe(true);
    expect(world.residents[0]).toMatchObject({ workplaceId: 'site-west', targetSiteId: 'site-west' });
    expect(world.residents[1]).toMatchObject({ workplaceId: 'site-east', targetSiteId: 'site-east' });

    const saved = parseSavedWorld(JSON.stringify(world));
    expect(saved?.residents[0]).toMatchObject({ workplaceId: 'site-west' });
    expect(saved?.residents[1]).toMatchObject({ workplaceId: 'site-east' });
    const restored = new PrototypeSimulation(saved!);
    expect(restored.world.residents[0]?.workplaceId).toBe('site-west');
    expect(restored.world.residents[1]?.workplaceId).toBe('site-east');
  });

  it('permits multiple mines only on separate free prepared cells', () => {
    const simulation = new PrototypeSimulation(createNewWorld());
    const mineA = LAND_GRID_CELLS.find((cell) => cell.environment === 'surface' && cell.column === 5)!;
    const mineB = LAND_GRID_CELLS.find((cell) => cell.environment === 'surface' && cell.column === 7)!;
    const naturalOre = LAND_GRID_CELLS.find((cell) => cell.resource === 'ore-main')!;
    const closedCell = LAND_GRID_CELLS.find((cell) => cell.environment === 'surface' && cell.column === 8)!;

    expect(simulation.place('mine', mineA.id)).toEqual({ ok: true });
    expect(simulation.place('mine', mineB.id)).toEqual({ ok: true });
    expect(simulation.place('mine', mineA.id).ok).toBe(false);
    expect(simulation.place('mine', naturalOre.id).ok).toBe(false);
    expect(simulation.place('mine', closedCell.id).ok).toBe(false);
    const matureTree = simulation.world.trees.find((tree) => tree.state === 'mature')!;
    expect(simulation.place('mine', matureTree.cellId).ok).toBe(false);
  });

  it('keeps sawmills restricted to one adult tree and rejects empty cells and saplings', () => {
    const world = createNewWorld();
    const simulation = new PrototypeSimulation(world);
    const matureTree = world.trees.find((tree) => tree.state === 'mature')!;
    const empty = LAND_GRID_CELLS.find((cell) => cell.environment === 'surface' && cell.column === 4)!;
    const saplingCell = LAND_GRID_CELLS.find((cell) => cell.environment === 'surface' && cell.column === 5)!;
    world.trees.push({ id: 'sapling', cellId: saplingCell.id, sourceId: 'home', x: saplingCell.centerX,
      state: 'growing', growthSeconds: 0, cutProgress: 0, stateSeconds: 0, workerId: null, planted: true });

    expect(simulation.place('sawmill', empty.id).ok).toBe(false);
    expect(simulation.place('sawmill', saplingCell.id).ok).toBe(false);
    expect(simulation.place('sawmill', matureTree.cellId)).toEqual({ ok: true });
    expect(simulation.place('sawmill', matureTree.cellId).ok).toBe(false);
  });

  it('assigns miners to independent mine piles and leaves the natural deposit finite', () => {
    const world = createNewWorld();
    world.oreSource = 0;
    world.stores[0]!.wood = world.stores[0]!.capacity;
    world.stores[0]!.ore = 0;
    world.productionSettings!.quota.ore = 500;
    const mineA = addMine(world, 'mine-a', 5);
    const mineB = addMine(world, 'mine-b', 7);
    const simulation = new PrototypeSimulation(world);
    const pileA = world.stockpiles.find((pile) => pile.sourceId === mineStockpileSourceId(mineA.id))!;
    const pileB = world.stockpiles.find((pile) => pile.sourceId === mineStockpileSourceId(mineB.id))!;

    world.residents[0]!.x = mineA.x;
    world.residents[1]!.x = mineB.x;
    expect(simulation.assign('r1', 'miner', mineA.id)).toBe(true);
    expect(simulation.assign('r2', 'miner', mineB.id)).toBe(true);
    run(simulation, 45);

    expect(world.oreSource).toBe(0);
    expect(pileA.capacity).toBe(50);
    expect(pileB.capacity).toBe(50);
    expect(pileA.amount).toBeGreaterThan(0);
    expect(pileB.amount).toBeGreaterThan(0);
    expect(world.residents[0]?.workplaceId).toBe(mineA.id);
    expect(world.residents[1]?.workplaceId).toBe(mineB.id);
    expect(world.stockpiles.find((pile) => pile.sourceId === 'ore')?.amount).toBe(0);

    world.oreSource = 3;
    expect(simulation.assign('r3', 'miner', NATURAL_ORE_WORKPLACE_ID)).toBe(true);
    world.residents[2]!.x = PROTOTYPE_CONFIG.sources.oreX;
    run(simulation, 15);
    expect(world.oreSource).toBe(0);
    expect(world.residents[2]?.workplaceId).toBe(mineA.id);
  });

  it('migrates the old shared ore pile to one mine without changing its ID or duplicating materials', () => {
    const world = createNewWorld();
    world.mineLayoutVersion = undefined;
    world.oreSource = 17;
    const legacyPile = world.stockpiles.find((pile) => pile.sourceId === 'ore')!;
    legacyPile.amount = 12;
    const mineA = addMine(world, 'mine-a', 5);
    const mineB = addMine(world, 'mine-b', 7);
    legacyPile.x = mineB.x;
    world.residents[0]!.role = 'miner';
    world.residents[0]!.pickupStockpileId = legacyPile.id;
    const simulation = new PrototypeSimulation(world);

    expect(world.stockpiles.filter((pile) => pile.resource === 'ore').reduce((sum, pile) => sum + pile.amount, 0)).toBe(12);
    expect(world.oreSource).toBe(17);
    expect(legacyPile).toMatchObject({ id: 'pile-ore-main', sourceId: mineStockpileSourceId(mineB.id), amount: 12, capacity: 50 });
    expect(world.residents[0]?.pickupStockpileId).toBe(legacyPile.id);
    expect(world.stockpiles.find((pile) => pile.sourceId === mineStockpileSourceId(mineA.id))?.amount).toBe(0);
    expect(world.stockpiles.find((pile) => pile.sourceId === 'ore')).toMatchObject({ amount: 0, capacity: 10 });
    expect(simulation.world.mineLayoutVersion).toBe(1);
  });

  it('clears the selected warehouse and only destroys its confirmed stock when demolition finishes', () => {
    const world = createNewWorld();
    const building = world.buildings.find((candidate) => candidate.kind === 'warehouse')!;
    const store = world.stores.find((candidate) => candidate.buildingId === building.id)!;
    store.wood = 80;
    store.ore = 40;
    const simulation = new PrototypeSimulation(world);
    simulation.assign('r1', 'builder');

    expect(simulation.clearWarehouse(building.id)).toEqual({ ok: true, wood: 80, ore: 40 });
    expect(store).toMatchObject({ wood: 0, ore: 0 });
    store.wood = 80;
    store.ore = 40;
    expect(simulation.startDemolition(building.id)).toMatchObject({
      ok: false, reason: 'Нужно подтвердить потерю содержимого: 80 древесины и 40 породы.'
    });
    expect(simulation.startDemolition(building.id, true)).toEqual({ ok: true });
    expect(store).toMatchObject({ wood: 80, ore: 40, closedForDemolition: true });
    run(simulation, 2);
    expect(store).toMatchObject({ wood: 80, ore: 40 });

    expect(simulation.cancelDemolition(building.id)).toBe(true);
    expect(store).toMatchObject({ wood: 80, ore: 40 });
    expect(store.closedForDemolition).toBeUndefined();
    expect(simulation.startDemolition(building.id, true)).toEqual({ ok: true });
    runUntilBuildingRemoved(simulation, building.id);

    expect(world.stores).toHaveLength(0);
    expect(world.stockpiles.filter((pile) => isLooseMaterial(pile) && pile.amount > 0)
      .reduce((sum, pile) => sum + pile.amount, 0)).toBe(45);
    expect(world.stockpiles.filter((pile) => pile.resource === 'wood' && pile.amount > 0)
      .reduce((sum, pile) => sum + pile.amount, 0)).toBe(demolitionRefund('warehouse').wood);
    expect(world.stockpiles.filter((pile) => pile.resource === 'ore' && pile.amount > 0)
      .reduce((sum, pile) => sum + pile.amount, 0)).toBe(demolitionRefund('warehouse').ore);
  });

  it('demolishes the last full warehouse only after confirmation, then exposes no free replacement stock', () => {
    const world = createNewWorld();
    const building = world.buildings.find((candidate) => candidate.kind === 'warehouse')!;
    const store = world.stores[0]!;
    store.wood = store.capacity;
    store.ore = 0;
    const simulation = new PrototypeSimulation(world);
    simulation.assign('r1', 'builder');

    expect(simulation.startDemolition(building.id)).toMatchObject({ ok: false });
    expect(simulation.startDemolition(building.id, true)).toEqual({ ok: true });
    expect(store).toMatchObject({ wood: 120, ore: 0, closedForDemolition: true });
    run(simulation, 2);
    expect(store.wood).toBe(120);
    expect(simulation.cancelDemolition(building.id)).toBe(true);
    expect(store).toMatchObject({ wood: 120, ore: 0 });

    expect(simulation.startDemolition(building.id, true)).toEqual({ ok: true });
    runUntilBuildingRemoved(simulation, building.id);
    expect(world.stores).toHaveLength(0);
    expect(world.buildings.some((candidate) => candidate.id === building.id)).toBe(false);
    expect(world.stockpiles.filter((pile) => isLooseMaterial(pile) && pile.amount > 0)
      .reduce((sum, pile) => sum + pile.amount, 0)).toBe(demolitionRefund('warehouse').wood + demolitionRefund('warehouse').ore);
    expect(world.stockpiles.filter((pile) => isLooseMaterial(pile) && pile.amount > 0)
      .every((pile) => pile.sourceId === 'demolition')).toBe(true);
    expect(world.oreSource).toBe(PROTOTYPE_CONFIG.ore.initialDeposit);
  });

  it('rebuilds storage after the last warehouse from actual woodcutting and mine output', () => {
    const world = createNewWorld();
    const warehouse = world.buildings.find((candidate) => candidate.kind === 'warehouse')!;
    world.stores[0]!.wood = world.stores[0]!.capacity;
    world.stores[0]!.ore = 0;
    const simulation = new PrototypeSimulation(world);
    simulation.assign('r1', 'builder');
    expect(simulation.startDemolition(warehouse.id, true)).toEqual({ ok: true });
    runUntilBuildingRemoved(simulation, warehouse.id);
    expect(world.stores).toHaveLength(0);
    expect(world.stockpiles.filter((pile) => pile.sourceId === 'demolition' && pile.resource === 'wood')
      .reduce((sum, pile) => sum + pile.amount, 0)).toBe(25);
    expect(world.stockpiles.filter((pile) => pile.sourceId === 'demolition' && pile.resource === 'ore')
      .reduce((sum, pile) => sum + pile.amount, 0)).toBe(20);
    expect(world.oreSource).toBe(PROTOTYPE_CONFIG.ore.initialDeposit);

    expect(simulation.assign('r2', 'woodcutter', 'tree-home')).toBe(true);
    const mineCell = LAND_GRID_CELLS.find((cell) => cell.environment === 'surface' && cell.column === 2)!;
    expect(simulation.place('mine', mineCell.id)).toEqual({ ok: true });
    const mineSite = world.sites.find((site) => site.kind === 'mine')!;
    expect(simulation.assign('r1', 'builder', mineSite.id)).toBe(true);
    for (let tick = 0; tick < 12_000 && !world.buildings.some((building) => building.kind === 'mine'); tick += 1) {
      simulation.step(0.1);
    }
    const mine = world.buildings.find((building) => building.kind === 'mine');
    expect(mine, 'the mine should be buildable without a warehouse using physical tree resources').toBeDefined();
    expect(simulation.assign('r3', 'miner', mine!.id)).toBe(true);
    world.residents[2]!.x = mine!.x;
    run(simulation, 180);

    const warehouseCell = LAND_GRID_CELLS.find((cell) => cell.environment === 'surface' && cell.column === 4)!;
    expect(simulation.place('warehouse', warehouseCell.id)).toEqual({ ok: true });
    const replacementSite = world.sites.find((site) => site.kind === 'warehouse')!;
    expect(simulation.assign('r1', 'builder', replacementSite.id)).toBe(true);
    for (let tick = 0; tick < 18_000 && !world.stores.some((store) => store.buildingId !== 'warehouse:store-1'); tick += 1) {
      simulation.step(0.1);
    }

    expect(world.stores.some((store) => store.buildingId !== 'warehouse:store-1'))
      .toBe(true);
    expect(simulation.activity.harvested.wood).toBeGreaterThan(0);
    expect(simulation.activity.harvested.ore).toBeGreaterThan(0);
    expect(world.oreSource).toBe(PROTOTYPE_CONFIG.ore.initialDeposit);
  });

  it('preserves cargo and cancels stale warehouse routes while demolishing a full second warehouse', () => {
    const world = createNewWorld();
    const target = addWarehouse(world, 'store-2', 5);
    world.stores[0]!.wood = world.stores[0]!.capacity;
    world.stores[0]!.ore = 0;
    world.stores[1]!.wood = 80;
    world.stores[1]!.ore = 40;
    Object.assign(world.residents[2]!, {
      role: 'hauler', cargo: 'ore', cargoAmount: 4, targetStoreId: 'store-2',
      targetX: world.stores[1]!.x, targetY: WORLD.groundY, mode: 'carrying'
    });
    const simulation = new PrototypeSimulation(world);
    simulation.assign('r1', 'builder');

    expect(simulation.startDemolition(target.id, true)).toEqual({ ok: true });
    expect(world.stores[1]).toMatchObject({ wood: 80, ore: 40, closedForDemolition: true });
    expect(world.residents[2]).toMatchObject({ cargo: null, cargoAmount: 0, targetStoreId: null });
    expect(world.stockpiles.filter((pile) => pile.resource === 'ore' && isLooseMaterial(pile))
      .reduce((sum, pile) => sum + pile.amount, 0)).toBe(4);
    expect(simulation.diagnostics.issues).toEqual([]);

    runUntilBuildingRemoved(simulation, target.id);
    expect(world.stores.map((store) => store.id)).toEqual(['store-1']);
    expect(world.stores[0]).toMatchObject({ wood: 120, ore: 0 });
    expect(world.stockpiles.filter((pile) => pile.resource === 'wood' && pile.sourceId === 'demolition')
      .reduce((sum, pile) => sum + pile.amount, 0)).toBe(demolitionRefund('warehouse').wood);
    expect(world.stockpiles.filter((pile) => pile.resource === 'ore' && pile.sourceId === 'demolition')
      .reduce((sum, pile) => sum + pile.amount, 0)).toBe(demolitionRefund('warehouse').ore + 4);
  });

  it('keeps a demolished mine pile as one selectable ground stockpile', () => {
    const world = createNewWorld();
    const mine = addMine(world, 'mine-to-remove', 5);
    world.mineLayoutVersion = 1;
    const simulation = new PrototypeSimulation(world);
    const pile = world.stockpiles.find((candidate) => candidate.sourceId === mineStockpileSourceId(mine.id))!;
    pile.amount = 17;
    simulation.assign('r1', 'builder');
    expect(simulation.startDemolition(mine.id)).toEqual({ ok: true });
    runUntilBuildingRemoved(simulation, mine.id);

    expect(pile).toMatchObject({ sourceId: 'demolition', amount: 17, capacity: 50 });
    expect(world.stockpiles.filter((candidate) => candidate.id === pile.id)).toHaveLength(1);
    expect(isLooseMaterial(pile)).toBe(true);
  });
});
