import { describe, expect, it } from 'vitest';
import {
  createNewWorld, parseSavedWorld, PrototypeSimulation, STORAGE_KEY, WORLD
} from './simulation.js';

function run(simulation: PrototypeSimulation, seconds: number): void {
  const frames = Math.ceil(seconds * 10);
  for (let index = 0; index < frames; index++) simulation.step(0.1);
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
    expect(loaded?.mapVersion).toBe(1);
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
    expect(loaded?.mapVersion).toBe(1);
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
});
