import { describe, expect, it } from 'vitest';
import { catchUpSettlement } from './offline-progress.js';
import { createNewWorld, PrototypeSimulation, WORLD } from './simulation.js';
import { cellsForFootprint, footprintCenterX, LAND_GRID_CONFIG } from './land-grid.js';

describe('offline production progression', () => {
  it('produces boards, delivers the upgrade materials, and completes a house upgrade after reload time', async () => {
    const world = createNewWorld();
    const row = LAND_GRID_CONFIG.surfaceCellRow;
    const houseX = footprintCenterX({ column: 1, row }, { widthCells: 1, heightCells: 1 });
    world.buildings.push({ id: 'house-offline', kind: 'house', x: houseX, y: WORLD.groundY,
      gridColumn: 1, gridRow: row, footprint: { widthCells: 1, heightCells: 1 }, level: 1 });
    const millFootprint = { widthCells: 2, heightCells: 1 };
    const millAnchor = { column: 4, row };
    const millX = footprintCenterX(millAnchor, millFootprint);
    world.buildings.push({ id: 'mill-offline', kind: 'sawmill', x: millX, y: WORLD.groundY,
      gridColumn: millAnchor.column, gridRow: row, footprint: millFootprint,
      inputWood: 4, productionProgress: 0 });
    world.occupiedPlots.push(1, ...cellsForFootprint(millAnchor, millFootprint)!.map((cell) => cell.id));
    world.stores[0]!.wood = 0;
    world.stores[0]!.stone = 10;
    world.stores[0]!.boards = 12;
    world.residents.push({ ...world.residents[2]!, id: 'r4', name: 'Лада', x: houseX,
      role: 'idle', cargo: null, cargoAmount: 0, mode: 'idle', targetX: null, targetY: null,
      targetSiteId: null, targetBuildingId: null, targetStoreId: null, pickupStoreId: null,
      pickupResource: null, pickupStockpileId: null, pickupAmount: 0, logisticsRequestId: null });

    const simulation = new PrototypeSimulation(world);
    simulation.assign('r1', 'builder');
    simulation.assign('r2', 'sawmiller');
    simulation.assign('r3', 'hauler');
    expect(simulation.startHouseUpgrade('house-offline')).toEqual({ ok: true });

    const now = 1_800_000_000_000;
    world.lastSimulatedAtMs = now - 180_000;
    const report = await catchUpSettlement(simulation, now, { yieldToUi: async () => {} });

    expect(report.seconds).toBe(180);
    expect(report.produced.boards).toBeGreaterThan(0);
    expect(report.delivered.boards).toBeGreaterThanOrEqual(12);
    expect(report.upgrades).toEqual(['дом до второго уровня']);
    expect(world.buildings.find((building) => building.id === 'house-offline')?.level).toBe(2);
    expect(world.residents.length).toBe(5);
    expect(world.stores.every((store) => store.wood + store.stone + (store.boards ?? 0) <= store.capacity)).toBe(true);
  });
});
