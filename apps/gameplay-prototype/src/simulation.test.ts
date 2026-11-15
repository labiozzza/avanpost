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

  it('rejects malformed or foreign saves instead of replacing the new-game state', () => {
    expect(parseSavedWorld(null)).toBeNull();
    expect(parseSavedWorld('{')).toBeNull();
    expect(parseSavedWorld(JSON.stringify({ version: 2, residents: [], stores: [], buildings: [], sites: [] }))).toBeNull();
  });
});
