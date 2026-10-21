import { describe, expect, it } from 'vitest';
import { TERRAIN_TYPES } from '@avanpost/shared';
import { loadWorldBalance, toCatalog } from '../src/balance';

describe('world balance registry', () => {
  it('loads the P0 registry and validates every terrain', () => {
    const balance = loadWorldBalance();
    expect(balance.meta.provenance).toBe('proposed');
    expect(balance.sector.width).toBe(64);
    expect(balance.sector.height).toBe(24);
    expect(balance.economyEnabled).toBe(true);
    expect(Object.keys(balance.items)).toHaveLength(16);
    expect(balance.items.logs?.volume).toBe(1);
    expect(balance.storageTypes.warehouse?.capacity).toBe(600);
    expect(balance.storageTypes.granary?.categories).toEqual(['food']);
    expect(balance.carrier).toMatchObject({
      capacity: 10,
      cartCapacity: 30,
      count: 2,
      cartCount: 1
    });
    expect(balance.gathererCount).toBe(1);
    expect(balance.startingStorages).toHaveLength(3);
    expect(balance.nodes.map((node) => node.kind).sort()).toEqual([
      'clay',
      'field',
      'forest',
      'stone',
      'well'
    ]);
    expect(balance.biomes.length).toBeGreaterThanOrEqual(4);
    expect(Object.keys(balance.terrains).sort()).toEqual([...TERRAIN_TYPES].sort());
    expect(balance.terrains.rock.clearable).toBe(true);
    expect(balance.terrains.rock.becomes).toBe('soil');
    expect(balance.terrains.scree.passable).toBe(true);
    expect(balance.terrains.scree.cartPassable).toBe(false);
    expect(balance.clearing.workPerTick).toBeGreaterThan(0);
  });

  it('builds the catalog from the registry', () => {
    const balance = loadWorldBalance();
    const catalog = toCatalog(balance);
    expect(catalog.terrains).toHaveLength(TERRAIN_TYPES.length);
    expect(catalog.items).toHaveLength(16);
    expect(catalog.storageTypes).toHaveLength(3);
    expect(catalog.nodeTypes).toHaveLength(5);
    expect(catalog.balanceVersion).toBe(balance.meta.version);
    expect(catalog.provenance).toBe(balance.meta.provenance);
  });
});
