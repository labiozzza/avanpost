import { describe, expect, it } from 'vitest';
import { createInitialPeaceWorld } from '../src/initial-world.js';
import { ensureTerritoryWorld } from '../src/territory.js';
import { ensureUndergroundWorld, generatedGeology } from '../src/underground.js';

describe('createInitialPeaceWorld', () => {
  it('creates a validated starting settlement with deterministic seed and stable legacy-compatible residents', () => {
    const first = createInitialPeaceWorld('world-one');
    const second = createInitialPeaceWorld('world-two');

    expect(first.worldSeed).toBe('world-one');
    expect(second.worldSeed).toBe('world-two');
    expect(first.residents.map(({ id }) => id)).toEqual(['worker-1', 'worker-2']);
    expect(first.storages).toHaveLength(1);
    expect(first.trees.length).toBeGreaterThan(0);
    expect(first.stoneDeposits).toHaveLength(1);
    ensureTerritoryWorld(first);
    ensureTerritoryWorld(second);
    expect(first.sectors.find((sector) => sector.state === 'occupied')?.ownerId).toBe('world-one');
    expect(second.sectors.find((sector) => sector.state === 'occupied')?.ownerId).toBe('world-two');
  });

  it('rejects an empty world seed rather than silently falling back to the singleton seed', () => {
    expect(() => createInitialPeaceWorld(' ')).toThrow('A unique world seed is required.');
  });

  it('uses a distinct private geology seed when one is present', () => {
    const world = createInitialPeaceWorld('public-world-id');
    world.undergroundSeed = 'private-geology-seed-for-test';
    ensureTerritoryWorld(world);
    ensureUndergroundWorld(world);

    expect(world.undergroundCells.length).toBeGreaterThan(0);
    expect(world.undergroundCells.every((cell) =>
      cell.geology === generatedGeology(world.undergroundSeed!, cell.position.x, cell.position.y)
    )).toBe(true);
    expect(world.undergroundCells.some((cell) =>
      cell.geology !== generatedGeology(world.worldSeed, cell.position.x, cell.position.y)
    )).toBe(true);
  });
});
