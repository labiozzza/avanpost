import { describe, expect, it } from 'vitest';
import {
  createNewWorld, parseSavedWorld, PrototypeSimulation, STORAGE_KEY
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
    run(simulation, 24);
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

  it('migrates legacy one-row saves to the depth map without changing the storage key or plot IDs', () => {
    const legacy = createNewWorld();
    delete (legacy as unknown as Record<string, unknown>).mapVersion;
    legacy.residents.forEach((person, index) => {
      person.x = [475, 535, 595][index]!;
      delete (person as unknown as Record<string, unknown>).y;
      person.targetY = null;
    });
    legacy.stores[0]!.x = 535;
    delete (legacy.stores[0] as unknown as Record<string, unknown>).y;
    legacy.buildings.push({ id: 'building-old', kind: 'house', x: 420, y: 414 });
    legacy.occupiedPlots = [1];
    const loaded = parseSavedWorld(JSON.stringify(legacy));
    expect(loaded?.mapVersion).toBe(2);
    expect(loaded?.buildings[0]).toMatchObject({ x: 638, y: 1050 });
    expect(loaded?.occupiedPlots).toEqual([1]);
    expect(loaded?.stores[0]?.y).toBe(860);
    expect(loaded?.residents.every((person) => Number.isFinite(person.y))).toBe(true);
    expect(STORAGE_KEY).toBe('avanpost:gameplay-prototype:v01');
  });

  it('routes residents to resource nodes and construction sites in both world axes', () => {
    const simulation = new PrototypeSimulation(createNewWorld());
    const person = simulation.world.residents[0]!;
    const startY = person.y;
    simulation.assign(person.id, 'woodcutter');
    run(simulation, 3);
    expect(person.y).not.toBe(startY);
    expect(person.targetY).not.toBeNull();
    expect(Math.abs(person.targetY! - person.y)).toBeLessThan(100);
  });

  it('rejects malformed or foreign saves instead of replacing the new-game state', () => {
    expect(parseSavedWorld(null)).toBeNull();
    expect(parseSavedWorld('{')).toBeNull();
    expect(parseSavedWorld(JSON.stringify({ version: 2, residents: [], stores: [], buildings: [], sites: [] }))).toBeNull();
  });
});
