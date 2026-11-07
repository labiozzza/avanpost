import { describe, expect, it } from 'vitest';
import { createInitialPeaceWorld } from '../src/initial-world.js';

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
  });

  it('rejects an empty world seed rather than silently falling back to the singleton seed', () => {
    expect(() => createInitialPeaceWorld(' ')).toThrow('A unique world seed is required.');
  });
});
