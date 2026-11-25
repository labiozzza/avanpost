import { describe, expect, it } from 'vitest';
import { catchUpSettlement } from './offline-progress.js';
import { createNewWorld, PrototypeSimulation, WORLD } from './simulation.js';
import { LAND_GRID_CONFIG } from './land-grid.js';

describe('offline settlement progression', () => {
  it('delivers both upgrade resources and completes a house upgrade during catch-up', async () => {
    const world = createNewWorld();
    const row = LAND_GRID_CONFIG.surfaceCellRow;
    const houseX = 750;
    world.buildings.push({ id: 'house-offline', kind: 'house', x: houseX, y: WORLD.groundY,
      gridColumn: 1, gridRow: row, footprint: { widthCells: 1, heightCells: 1 }, level: 1 });
    world.occupiedPlots.push(1);
    world.stores[0]!.wood = 40;
    world.stores[0]!.ore = 30;

    const simulation = new PrototypeSimulation(world);
    simulation.assign('r1', 'builder');
    simulation.assign('r2', 'hauler');
    expect(simulation.startHouseUpgrade('house-offline')).toEqual({ ok: true });

    const now = 1_800_000_000_000;
    world.lastSimulatedAtMs = now - 180_000;
    const report = await catchUpSettlement(simulation, now, { yieldToUi: async () => {} });

    expect(report.seconds).toBe(180);
    expect(report.upgrades).toEqual(['дом до второго уровня']);
    expect(report.delivered.wood).toBeGreaterThan(0);
    expect(report.delivered.ore).toBeGreaterThan(0);
    expect(world.buildings.find((building) => building.id === 'house-offline')?.level).toBe(2);
    expect(simulation.totals().housing).toBe(5);
    expect(world.residents).toHaveLength(5);
    expect(world.stores.every((store) => store.wood + store.ore <= store.capacity)).toBe(true);
  });
});
