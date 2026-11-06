import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import assets from '../../../content/peace-v2/g72-visual-assets.json';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../public/assets/peace-v2');

async function pngDimensions(file: string): Promise<[number, number]> {
  const data = await readFile(path.join(root, file));
  expect(data.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  return [data.readUInt32BE(16), data.readUInt32BE(20)];
}

describe('G7.2 standalone visual assets', () => {
  it('documents collage extents and crops fully inside each source PNG', async () => {
    for (const source of Object.values(assets.sourceAtlases)) {
      expect(await pngDimensions(source.file)).toEqual([source.width, source.height]);
    }
    for (const asset of [...assets.schools, ...assets.professions]) {
      const source = asset.file.startsWith('g72-school-') ? assets.sourceAtlases.schools : assets.sourceAtlases.professions;
      const [left, top, right, bottom] = asset.sourceRect;
      expect(left).toBeGreaterThanOrEqual(0);
      expect(top).toBeGreaterThanOrEqual(0);
      expect(right).toBeLessThanOrEqual(source.width);
      expect(bottom).toBeLessThanOrEqual(source.height);
      expect(right - left).toBe(asset.width);
      expect(bottom - top).toBe(asset.height);
      const [width, height] = await pngDimensions(asset.file);
      expect([width, height]).toEqual([asset.width, asset.height]);
      const [contentLeft, contentTop, contentRight, contentBottom] = asset.contentRect;
      expect(contentLeft).toBeGreaterThanOrEqual(0);
      expect(contentTop).toBeGreaterThanOrEqual(0);
      expect(contentRight).toBeLessThanOrEqual(width);
      expect(contentBottom).toBeLessThanOrEqual(height);
    }
  });

  it('has one distinct bottom-centered texture per school and one texture per catalog profession', () => {
    expect(assets.schools).toHaveLength(4);
    expect(new Set(assets.schools.map((asset) => asset.kind)).size).toBe(4);
    expect(new Set(assets.schools.map((asset) => asset.textureKey)).size).toBe(4);
    expect(assets.schools.every((asset) => asset.anchor === 'bottom-center' && asset.displayWidth === 210)).toBe(true);
    expect(assets.professions).toHaveLength(23);
    expect(new Set(assets.professions.map((asset) => asset.profession)).size).toBe(23);
    expect(new Set(assets.professions.map((asset) => asset.textureKey)).size).toBe(23);
  });

  it('does not load the irregular G7.2 collages as Phaser spritesheets', async () => {
    const scene = await readFile(path.resolve(root, '../../../src/settlement-scene.ts'), 'utf8');
    expect(scene).not.toMatch(/load\.spritesheet\(['"](?:school-atlas|profession-icons)['"]/);
    expect(scene).toContain('this.load.image(asset.textureKey');
    expect(scene).toContain('markParented: visual.professionMark.parentContainer === visual.labelGroup');
  });
});
