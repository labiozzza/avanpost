import { describe, expect, it } from 'vitest';
import type { TerrainType } from '@avanpost/shared';
import {
  advanceClearing,
  advanceExtraction,
  advanceTick,
  buildGraph,
  cellKey,
  createRng,
  findPath,
  generateTerrain,
  mixSeed,
  pickBiome,
  reachableFrom,
  stepPath,
  settlementOrigin,
  type BiomeRule,
  type GraphCell,
  type TerrainRule
} from '../src';

const terrains: Record<TerrainType, TerrainRule> = {
  grass: {
    id: 'grass',
    label: 'Трава',
    color: '#3f6b47',
    passable: true,
    cartPassable: true,
    moveCost: 1,
    clearable: false,
    clearingWork: 0,
    becomes: null
  },
  soil: {
    id: 'soil',
    label: 'Грунт',
    color: '#6b543a',
    passable: true,
    cartPassable: true,
    moveCost: 1,
    clearable: false,
    clearingWork: 0,
    becomes: null
  },
  forest: {
    id: 'forest',
    label: 'Лес',
    color: '#24452f',
    passable: true,
    cartPassable: true,
    moveCost: 2,
    clearable: true,
    clearingWork: 12,
    becomes: 'soil'
  },
  scree: {
    id: 'scree',
    label: 'Осыпь',
    color: '#8a7f6a',
    passable: true,
    cartPassable: false,
    moveCost: 2,
    clearable: false,
    clearingWork: 0,
    becomes: null
  },
  rock: {
    id: 'rock',
    label: 'Скала',
    color: '#5a5f66',
    passable: false,
    cartPassable: false,
    moveCost: 1,
    clearable: true,
    clearingWork: 30,
    becomes: 'soil'
  },
  water: {
    id: 'water',
    label: 'Вода',
    color: '#2c5d7c',
    passable: false,
    cartPassable: false,
    moveCost: 1,
    clearable: false,
    clearingWork: 0,
    becomes: null
  }
};

const meadow: BiomeRule = {
  id: 'meadow',
  label: 'Луг',
  tint: '#3f6b47',
  weight: 1,
  terrainWeights: { grass: 60, soil: 10, forest: 20, rock: 10 }
};

describe('deterministic randomness', () => {
  it('replays the same sequence for the same seed', () => {
    const a = createRng(42);
    const b = createRng(42);
    expect([a(), a(), a()]).toEqual([b(), b(), b()]);
  });

  it('produces a different sequence for a different seed', () => {
    const a = createRng(1);
    const b = createRng(2);
    expect([a(), a(), a()]).not.toEqual([b(), b(), b()]);
  });
});

describe('sector seeds and biomes', () => {
  it('derives stable seeds per sector and never returns zero', () => {
    expect(mixSeed(99, 0, 0)).toBe(mixSeed(99, 0, 0));
    expect(mixSeed(99, 1, 0)).not.toBe(mixSeed(99, 0, 0));
    expect(mixSeed(99, -1, 0)).not.toBe(mixSeed(99, 1, 0));
    expect(mixSeed(99, -1, 0)).toBeGreaterThan(0);
  });

  it('picks a biome deterministically', () => {
    const biomes: BiomeRule[] = [
      { ...meadow, id: 'meadow', weight: 1 },
      { ...meadow, id: 'forest', weight: 1 },
      { ...meadow, id: 'rocky', weight: 1 }
    ];
    const first = pickBiome(7, biomes).id;
    expect(pickBiome(7, biomes).id).toBe(first);
    expect(biomes.map((biome) => biome.id)).toContain(first);
  });
});

describe('terrain generation', () => {
  it('is deterministic for a seed and size', () => {
    expect(generateTerrain(7, 16, 8, meadow, terrains)).toEqual(
      generateTerrain(7, 16, 8, meadow, terrains)
    );
  });

  it('changes with the seed', () => {
    expect(generateTerrain(7, 16, 8, meadow, terrains)).not.toEqual(
      generateTerrain(8, 16, 8, meadow, terrains)
    );
  });

  it('covers every cell exactly once', () => {
    const cells = generateTerrain(11, 10, 6, meadow, terrains);
    expect(cells).toHaveLength(60);
    expect(new Set(cells.map((cell) => `${cell.x}:${cell.y}`)).size).toBe(60);
  });

  it('keeps the settlement clearing passable and stamps a rock outcrop', () => {
    const width = 20;
    const height = 10;
    const clearingX = Math.floor(width * 0.45);
    const clearingY = Math.floor(height * 0.4);
    const cells = generateTerrain(3, width, height, meadow, terrains);

    const clearing = cells.filter(
      (cell) =>
        cell.x >= clearingX &&
        cell.x < clearingX + 6 &&
        cell.y >= clearingY &&
        cell.y < clearingY + 5
    );
    expect(clearing.every((cell) => cell.type === 'soil' && cell.passable)).toBe(true);

    const outcrop = cells.filter(
      (cell) =>
        cell.x >= clearingX + 6 &&
        cell.x < clearingX + 8 &&
        cell.y >= clearingY + 2 &&
        cell.y < clearingY + 4
    );
    expect(outcrop).toHaveLength(4);
    expect(outcrop.every((cell) => cell.type === 'rock' && !cell.passable)).toBe(true);
  });
});

describe('path graph', () => {
  const width = 5;
  const height = 3;
  const map = (wallX: number): GraphCell[] => {
    const cells: GraphCell[] = [];
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        cells.push({ x, y, type: x === wallX ? 'rock' : x === 4 ? 'forest' : 'grass' });
      }
    }
    return cells;
  };

  it('does not cross a rock wall', () => {
    const graph = buildGraph(map(2), terrains, 'person');
    const reachable = reachableFrom(graph, cellKey(0, 1));
    expect(reachable.has(cellKey(1, 1))).toBe(true);
    expect(reachable.has(cellKey(3, 1))).toBe(false);
    expect(reachable.has(cellKey(4, 0))).toBe(false);
  });

  it('expands reachability after the wall cell becomes passable', () => {
    const cells = map(2);
    const target = cells.find((cell) => cell.x === 2 && cell.y === 1);
    if (!target) throw new Error('target missing');
    target.type = 'soil';

    const graph = buildGraph(cells, terrains, 'person');
    const reachable = reachableFrom(graph, cellKey(0, 1));
    expect(reachable.has(cellKey(3, 1))).toBe(true);
    expect(reachable.has(cellKey(4, 1))).toBe(true);
  });

  it('respects transport restrictions', () => {
    const cells: GraphCell[] = [
      { x: 0, y: 0, type: 'grass' },
      { x: 1, y: 0, type: 'scree' },
      { x: 2, y: 0, type: 'grass' }
    ];
    const person = reachableFrom(buildGraph(cells, terrains, 'person'), cellKey(0, 0));
    const cart = reachableFrom(buildGraph(cells, terrains, 'cart'), cellKey(0, 0));
    expect(person.has(cellKey(2, 0))).toBe(true);
    expect(cart.has(cellKey(2, 0))).toBe(false);
  });

  it('applies road costs and building blockers', () => {
    const cells: GraphCell[] = [
      { x: 0, y: 0, type: 'grass' },
      { x: 1, y: 0, type: 'grass' },
      { x: 2, y: 0, type: 'grass' }
    ];
    const road = buildGraph(cells, terrains, 'person', [
      { x: 1, y: 0, passable: true, moveCost: 0.5 }
    ]);
    expect(road.get(cellKey(1, 0))?.find((edge) => edge.key === cellKey(2, 0))?.cost).toBe(
      1
    );
    expect(road.get(cellKey(0, 0))?.find((edge) => edge.key === cellKey(1, 0))?.cost).toBe(
      0.5
    );

    const blocked = buildGraph(cells, terrains, 'person', [
      { x: 1, y: 0, passable: false }
    ]);
    expect(reachableFrom(blocked, cellKey(0, 0)).has(cellKey(2, 0))).toBe(false);

    const stairs = buildGraph(cells, terrains, 'cart', [
      { x: 1, y: 0, passable: true, moveCost: 0.9, cartPassable: false }
    ]);
    expect(reachableFrom(stairs, cellKey(0, 0)).has(cellKey(2, 0))).toBe(false);
  });

  it('requires a two-cell-wide corridor for carts', () => {
    const corridor = (wide: boolean): GraphCell[] => {
      const cells: GraphCell[] = [];
      for (let y = 0; y < 3; y += 1) {
        for (let x = 0; x < 5; x += 1) {
          cells.push({
            x,
            y,
            type: y === 1 || (wide && y === 2) ? 'soil' : 'rock'
          });
        }
      }
      return cells;
    };

    const narrowPerson = buildGraph(corridor(false), terrains, 'person');
    expect(findPath(narrowPerson, cellKey(0, 1), cellKey(4, 1))).not.toBeNull();

    const narrowCart = buildGraph(corridor(false), terrains, 'cart');
    expect(findPath(narrowCart, cellKey(0, 1), cellKey(4, 1))).toBeNull();

    const wideCart = buildGraph(corridor(true), terrains, 'cart');
    expect(findPath(wideCart, cellKey(0, 1), cellKey(4, 1))).not.toBeNull();
  });

  it('finds the cheapest route and reports blocked routes', () => {
    const graph = buildGraph(map(2), terrains, 'person');
    expect(findPath(graph, cellKey(0, 1), cellKey(1, 0))).not.toBeNull();

    const opened = map(2);
    const wall = opened.find((cell) => cell.x === 2 && cell.y === 1);
    if (!wall) throw new Error('wall missing');
    wall.type = 'soil';
    const path = findPath(buildGraph(opened, terrains, 'person'), cellKey(0, 1), cellKey(4, 1));
    expect(path?.[0]).toBe(cellKey(0, 1));
    expect(path?.at(-1)).toBe(cellKey(4, 1));
  });
});

describe('clearing progression', () => {
  it('advances partially and clamps at the required work', () => {
    const result = advanceClearing(
      [
        { id: 'a', workDone: 0, workRequired: 30 },
        { id: 'b', workDone: 10, workRequired: 12 }
      ],
      3,
      4
    );
    expect(result).toEqual([
      { id: 'a', workDone: 12, completed: false },
      { id: 'b', workDone: 12, completed: true }
    ]);
  });
});

describe('world clock', () => {
  it('advances by the requested number of ticks', () => {
    expect(advanceTick(5, 3)).toBe(8);
  });

  it('rejects invalid inputs', () => {
    expect(() => advanceTick(-1, 1)).toThrow();
    expect(() => advanceTick(0, 0)).toThrow();
    expect(() => advanceTick(0, 61)).toThrow();
  });
});

describe('resource extraction', () => {
  it('fills a capped buffer and regenerates renewable nodes', () => {
    const result = advanceExtraction(
      {
        amount: 240,
        maxAmount: 240,
        renewable: true,
        regenPerTick: 4,
        yieldPerTick: 4,
        buffer: 0,
        bufferCapacity: 20
      },
      30
    );
    expect(result.buffer).toBe(20);
    expect(result.gained).toBe(20);
    expect(result.amount).toBe(240);
    expect(result.depleted).toBe(false);
  });

  it('depletes a finite node and stops at zero', () => {
    const result = advanceExtraction(
      {
        amount: 5,
        maxAmount: 5,
        renewable: false,
        regenPerTick: 0,
        yieldPerTick: 3,
        buffer: 0,
        bufferCapacity: 18
      },
      10
    );
    expect(result.amount).toBe(0);
    expect(result.buffer).toBe(5);
    expect(result.gained).toBe(5);
    expect(result.depleted).toBe(true);
  });
});

describe('path stepping', () => {
  it('moves along a path and clamps at the destination', () => {
    const path: Array<[number, number]> = [
      [0, 0],
      [1, 0],
      [2, 0]
    ];
    expect(stepPath(path, 0, 1)).toEqual({ index: 1, x: 1, y: 0 });
    expect(stepPath(path, 1, 5)).toEqual({ index: 2, x: 2, y: 0 });
  });

  it('derives a deterministic settlement origin', () => {
    expect(settlementOrigin(64, 24)).toEqual({
      x: 28,
      y: 9,
      width: 6,
      height: 5
    });
  });
});
