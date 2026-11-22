import { describe, expect, it } from 'vitest';
import { LAND_GRID_CONFIG, gridCellId } from './land-grid.js';
import {
  createNewWorld, GRID_VERSION, MAP_VERSION, parseSavedWorld, PrototypeSimulation, WORLD
} from './simulation.js';

describe('grid save migrations', () => {
  it('moves intermediate grid saves down one row without changing world positions or duplicating state', () => {
    const world = createNewWorld();
    world.gridVersion = 1;
    world.mapVersion = 8;
    world.landCells = world.landCells
      .filter((cell) => cell.row === LAND_GRID_CONFIG.surfaceCellRow)
      .map((cell) => ({
        ...cell,
        id: cell.column! + LAND_GRID_CONFIG.columns,
        row: 1,
        y: WORLD.groundY - 150
      }));
    world.occupiedPlots = [LAND_GRID_CONFIG.columns + 3];
    world.buildings[0]!.gridRow = 1;
    world.landCells.find((cell) => cell.column === 2)!.state = 'unlocked';
    world.landCells.find((cell) => cell.column === 2)!.clearingProgress = 0.36;
    world.stores[0]!.wood = 19;
    world.residents[0]!.cargo = 'stone';
    world.residents[0]!.cargoAmount = 4;

    const first = parseSavedWorld(JSON.stringify(world));
    const second = parseSavedWorld(JSON.stringify(first));

    expect(first).not.toBeNull();
    expect(first).toMatchObject({ gridVersion: GRID_VERSION, mapVersion: MAP_VERSION });
    expect(first?.landCells).toHaveLength(LAND_GRID_CONFIG.columns * LAND_GRID_CONFIG.rows);
    expect(first?.buildings).toHaveLength(1);
    expect(first?.buildings[0]).toMatchObject({ x: 1050, gridColumn: 3, gridRow: LAND_GRID_CONFIG.surfaceCellRow });
    expect(first?.occupiedPlots).toEqual([8]);
    expect(first?.landCells.find((cell) => cell.id === gridCellId(2, LAND_GRID_CONFIG.surfaceCellRow)))
      .toMatchObject({ state: 'unlocked', clearingProgress: 0.36 });
    expect(first?.stores).toMatchObject([{ wood: 19, stone: 20 }]);
    expect(first?.residents[0]).toMatchObject({ cargo: 'stone', cargoAmount: 4 });
    expect(second?.buildings).toEqual(first?.buildings);
    expect(second?.stores).toEqual(first?.stores);
    expect(second?.landCells).toEqual(first?.landCells);
    expect(second?.occupiedPlots).toEqual(first?.occupiedPlots);
  });

  it('migrates the legacy 1D layout and pauses old road work without losing state', () => {
    const world = createNewWorld();
    delete world.gridVersion;
    world.mapVersion = 7;
    world.buildings = [
      { id: 'warehouse:store-1', kind: 'warehouse', x: 963, y: WORLD.groundY },
      { id: 'old-house', kind: 'house', x: 690, y: WORLD.groundY }
    ];
    world.stores[0]!.buildingId = 'warehouse:store-1';
    world.stores[0]!.x = 963;
    world.stores[0]!.wood = 27;
    world.stores[0]!.stone = 18;
    world.sites = [{ id: 'old-site', kind: 'house', x: 1240, y: WORLD.groundY,
      deliveredWood: 21, deliveredStone: 17, progress: 0.38, stage: 1 }];
    world.occupiedPlots = [8, 1, 2];
    world.landCells = [
      { id: 8, x: 963, y: WORLD.groundY, state: 'prepared', clearingProgress: 1, clearingPaused: false, clearerId: null },
      { id: 1, x: 690, y: WORLD.groundY, state: 'prepared', clearingProgress: 1, clearingPaused: false, clearerId: null },
      { id: 2, x: 1240, y: WORLD.groundY, state: 'prepared', clearingProgress: 1, clearingPaused: false, clearerId: null },
      { id: 4, x: 2380, y: WORLD.groundY, state: 'clearing', clearingProgress: 0.42, clearingPaused: true, clearerId: null }
    ];
    world.roads = [{ id: 'built-road', x: 400, builtAt: 11 }];
    world.sites.push({ id: 'old-road-site', kind: 'road', x: 900, y: WORLD.groundY,
      deliveredWood: 7, deliveredStone: 3, progress: 0.22, stage: 0, paused: false });

    const migrated = parseSavedWorld(JSON.stringify(world));
    const reloaded = parseSavedWorld(JSON.stringify(migrated));
    const simulation = new PrototypeSimulation(migrated!);

    expect(migrated).not.toBeNull();
    expect(migrated).toMatchObject({ gridVersion: GRID_VERSION, mapVersion: MAP_VERSION });
    expect(migrated?.buildings.map((building) => [building.id, building.kind, building.x]))
      .toEqual([['warehouse:store-1', 'warehouse', 1050], ['old-house', 'house', 750]]);
    expect(migrated?.sites.find((site) => site.id === 'old-site'))
      .toMatchObject({ x: 1350, deliveredWood: 21, deliveredStone: 17, progress: 0.38, gridColumn: 4 });
    expect(migrated?.sites.find((site) => site.id === 'old-road-site'))
      .toMatchObject({ deliveredWood: 7, deliveredStone: 3, progress: 0.22, paused: true });
    expect(migrated?.roads).toEqual([{ id: 'built-road', x: 400, builtAt: 11 }]);
    expect(migrated?.stores[0]).toMatchObject({ x: 1050, wood: 27, stone: 18 });
    expect(migrated?.occupiedPlots).toEqual([1, 2, 8]);
    expect(migrated?.landCells.find((cell) => cell.id === 4))
      .toMatchObject({ state: 'clearing', clearingProgress: 0.42, clearingPaused: true });
    expect(reloaded?.buildings).toEqual(migrated?.buildings);
    expect(reloaded?.sites?.map(({ id, x, deliveredWood, deliveredStone, progress, stage }) =>
      [id, x, deliveredWood, deliveredStone, progress, stage]))
      .toEqual(migrated?.sites.map(({ id, x, deliveredWood, deliveredStone, progress, stage }) =>
        [id, x, deliveredWood, deliveredStone, progress, stage]));
    expect(reloaded?.roads).toEqual(migrated?.roads);
    expect(reloaded?.occupiedPlots).toEqual(migrated?.occupiedPlots);
    expect(simulation.world.sites.find((site) => site.id === 'old-road-site')?.paused).toBe(true);
  });
});
