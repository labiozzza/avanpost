import { describe, expect, it } from 'vitest';
import {
  canMigrate,
  freeSlots,
  housingCapacity,
  levelFor,
  levelProgress,
  nextResidentIndex
} from '../src/population';

const rules = {
  baseCapacity: 3,
  housingCapacityPerHouse: 2,
  startingResidents: 3
};

describe('housing capacity (GDD 3.1, test 15)', () => {
  it('starts at base capacity with no houses', () => {
    expect(housingCapacity(0, rules)).toBe(3);
  });

  it('adds two slots per finished house', () => {
    expect(housingCapacity(1, rules)).toBe(5);
    expect(housingCapacity(3, rules)).toBe(9);
  });

  it('never goes below base for negative input', () => {
    expect(housingCapacity(-2, rules)).toBe(3);
  });
});

describe('migration gating', () => {
  it('allows migration only while a slot is free', () => {
    expect(canMigrate(3, 5, true)).toBe(true);
    expect(canMigrate(5, 5, true)).toBe(false);
  });

  it('stops migration when capacity is filled (test 15)', () => {
    const capacity = housingCapacity(1, rules);
    expect(canMigrate(capacity, capacity, true)).toBe(false);
    expect(freeSlots(capacity, capacity)).toBe(0);
  });

  it('respects the enabled flag', () => {
    expect(canMigrate(3, 5, false)).toBe(false);
  });
});

describe('next resident identity', () => {
  it('picks the first unused known name', () => {
    const known = ['Ева', 'Марта', 'Гвидо', 'Агнесса'];
    expect(nextResidentIndex([{ name: 'Ева' }, { name: 'Марта' }], known)).toBe(2);
  });

  it('wraps when all known names are taken', () => {
    const known = ['Ева', 'Марта'];
    expect(nextResidentIndex([{ name: 'Ева' }, { name: 'Марта' }], known)).toBe(2);
  });
});

describe('XP curve (D3=A: 100/200/400/800)', () => {
  const curve = { levelThresholds: [100, 200, 400, 800] };

  it('starts at level 1', () => {
    expect(levelFor(0, curve)).toBe(1);
    expect(levelFor(99, curve)).toBe(1);
  });

  it('levels up at each cumulative threshold', () => {
    expect(levelFor(100, curve)).toBe(2);
    expect(levelFor(199, curve)).toBe(2);
    expect(levelFor(200, curve)).toBe(3);
    expect(levelFor(400, curve)).toBe(4);
    expect(levelFor(800, curve)).toBe(5);
    expect(levelFor(5000, curve)).toBe(5);
  });

  it('is monotonic', () => {
    let previous = 0;
    for (let xp = 0; xp <= 1000; xp += 7) {
      const level = levelFor(xp, curve);
      expect(level).toBeGreaterThanOrEqual(previous);
      previous = level;
    }
  });

  it('reports progress into the current level', () => {
    expect(levelProgress(150, curve)).toEqual({
      level: 2,
      into: 50,
      span: 100,
      toNext: 50
    });
    expect(levelProgress(0, curve)).toEqual({
      level: 1,
      into: 0,
      span: 100,
      toNext: 100
    });
  });

  it('caps the bar at max level', () => {
    const progress = levelProgress(900, curve);
    expect(progress.level).toBe(5);
    expect(progress.toNext).toBe(0);
  });
});
