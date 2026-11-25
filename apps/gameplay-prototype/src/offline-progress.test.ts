import { describe, expect, it } from 'vitest';
import { catchUpSettlement } from './offline-progress.js';
import { createNewWorld, PrototypeSimulation, WORLD } from './simulation.js';
import { LAND_GRID_CONFIG } from './land-grid.js';

describe('offline settlement progression', () => {
  it('preserves every economy transition while reporting progress between save checkpoints', async () => {
    const now = 1_800_000_000_000;
    const fastWorld = createNewWorld();
    fastWorld.residents[0]!.role = 'woodcutter';
    fastWorld.residents[1]!.role = 'miner';
    fastWorld.residents[2]!.role = 'hauler';
    fastWorld.lastSimulatedAtMs = now - 650_000;
    const referenceWorld = structuredClone(fastWorld);
    const fast = new PrototypeSimulation(fastWorld);
    const reference = new PrototypeSimulation(referenceWorld);
    const progress: number[] = [];
    const checkpoints: number[] = [];
    let yields = 0;

    const report = await catchUpSettlement(fast, now, {
      progress: (fraction) => progress.push(fraction),
      checkpoint: (fraction) => checkpoints.push(fraction),
      yieldToUi: async () => { yields++; }
    });
    for (let remaining = report.seconds; remaining > 1e-7;) {
      const dt = Math.min(0.1, remaining);
      reference.step(dt);
      remaining -= dt;
    }
    referenceWorld.lastSimulatedAtMs = now;

    expect(fastWorld.elapsedSeconds).toBeCloseTo(referenceWorld.elapsedSeconds, 8);
    referenceWorld.elapsedSeconds = fastWorld.elapsedSeconds;
    expect(fastWorld).toEqual(referenceWorld);
    expect(fast.activity).toEqual(reference.activity);
    expect(fast.diagnostics.issues).toEqual(reference.diagnostics.issues);
    expect(Math.abs(fast.diagnostics.stalledSeconds - reference.diagnostics.stalledSeconds)).toBeLessThanOrEqual(15);
    expect(progress.map((fraction) => Number(fraction.toFixed(6))))
      .toEqual([150 / 650, 300 / 650, 450 / 650, 600 / 650, 1].map((fraction) => Number(fraction.toFixed(6))));
    expect(checkpoints.map((fraction) => Number(fraction.toFixed(6))))
      .toEqual([300 / 650, 600 / 650, 1].map((fraction) => Number(fraction.toFixed(6))));
    expect(yields).toBe(4);
  });

  it('restarts from the last persisted catch-up checkpoint without double-counting work', async () => {
    const now = 1_800_000_000_000;
    const initial = createNewWorld();
    initial.residents[0]!.role = 'woodcutter';
    initial.residents[1]!.role = 'miner';
    initial.residents[2]!.role = 'hauler';
    initial.lastSimulatedAtMs = now - 900_000;
    const referenceWorld = structuredClone(initial);
    const uninterrupted = new PrototypeSimulation(referenceWorld);
    const target = new PrototypeSimulation(structuredClone(initial));
    let persistedAtCheckpoint: string | null = null;
    let yields = 0;

    await expect(catchUpSettlement(target, now, {
      checkpoint: () => { persistedAtCheckpoint = JSON.stringify(target.world); },
      yieldToUi: async () => { if (++yields === 2) throw new Error('simulated interruption'); }
    })).rejects.toThrow('simulated interruption');
    expect(persistedAtCheckpoint).not.toBeNull();
    const recoveredWorld = JSON.parse(persistedAtCheckpoint!) as typeof initial;
    const recovered = new PrototypeSimulation(recoveredWorld);
    await catchUpSettlement(recovered, now, { yieldToUi: async () => {} });

    for (let remaining = 900; remaining > 1e-7;) {
      const dt = Math.min(0.1, remaining);
      uninterrupted.step(dt);
      remaining -= dt;
    }
    referenceWorld.lastSimulatedAtMs = now;
    expect(recoveredWorld.elapsedSeconds).toBeCloseTo(referenceWorld.elapsedSeconds, 8);
    referenceWorld.elapsedSeconds = recoveredWorld.elapsedSeconds;
    expect(recoveredWorld).toEqual(referenceWorld);
  });

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
