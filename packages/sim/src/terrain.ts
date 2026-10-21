import { TERRAIN_TYPES, type TerrainType } from '@avanpost/shared';
import { createRng } from './rng';
import type { BiomeRule, GeneratedCell, TerrainRule } from './types';

export function mixSeed(worldSeed: number, gridX: number, gridY: number): number {
  let hash = (worldSeed ^ 0x9e3779b9) >>> 0;
  hash = Math.imul(hash ^ (gridX >>> 0), 0x85ebca6b) >>> 0;
  hash = Math.imul(hash ^ (gridY >>> 0), 0xc2b2ae35) >>> 0;
  hash = (hash ^ (hash >>> 16)) >>> 0;
  return hash % 2_147_483_646 + 1;
}

export function pickBiome(seed: number, biomes: BiomeRule[]): BiomeRule {
  if (biomes.length === 0) throw new Error('at least one biome is required');
  const total = biomes.reduce((sum, biome) => sum + Math.max(0, biome.weight), 0);
  if (total <= 0) throw new Error('biome weights must have a positive total');

  const rng = createRng((seed ^ 0x5f3759df) >>> 0);
  let roll = rng() * total;
  for (const biome of biomes) {
    roll -= Math.max(0, biome.weight);
    if (roll < 0) return biome;
  }
  return biomes[biomes.length - 1] as BiomeRule;
}

function pickType(
  roll: number,
  weights: Partial<Record<TerrainType, number>>
): TerrainType {
  const total = TERRAIN_TYPES.reduce(
    (sum, type) => sum + Math.max(0, weights[type] ?? 0),
    0
  );
  if (total <= 0) return 'grass';

  let cursor = roll * total;
  for (const type of TERRAIN_TYPES) {
    cursor -= Math.max(0, weights[type] ?? 0);
    if (cursor < 0) return type;
  }
  return 'grass';
}

export function settlementOrigin(
  width: number,
  height: number
): { x: number; y: number; width: number; height: number } {
  return {
    x: Math.floor(width * 0.45),
    y: Math.floor(height * 0.4),
    width: 6,
    height: 5
  };
}

export function generateTerrain(
  seed: number,
  width: number,
  height: number,
  biome: BiomeRule,
  terrains: Record<TerrainType, TerrainRule>,
  options: { stampOutcrop?: boolean } = {}
): GeneratedCell[] {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
    throw new Error('terrain dimensions must be positive integers');
  }

  const stampOutcrop = options.stampOutcrop ?? true;
  const rng = createRng(seed);
  const cells: GeneratedCell[] = [];
  const origin = settlementOrigin(width, height);
  const clearingX = origin.x;
  const clearingY = origin.y;
  const outcropX = clearingX + 6;
  const outcropY = clearingY + 2;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const roll = rng();
      const inClearing =
        x >= clearingX && x < clearingX + origin.width &&
        y >= clearingY && y < clearingY + origin.height;
      const inYard =
        x >= clearingX - 1 && x < clearingX + 7 &&
        y >= clearingY + 5 && y < clearingY + 8;
      const inOutcrop =
        stampOutcrop &&
        x >= outcropX &&
        x < outcropX + 2 &&
        y >= outcropY &&
        y < outcropY + 2;
      const type: TerrainType = inClearing || inYard
        ? 'soil'
        : inOutcrop
          ? 'rock'
          : pickType(roll, biome.terrainWeights);
      const rule = terrains[type];
      if (!rule) throw new Error(`missing terrain rule for ${type}`);
      cells.push({
        x,
        y,
        type,
        obstacle: !rule.passable,
        passable: rule.passable
      });
    }
  }

  return cells;
}
