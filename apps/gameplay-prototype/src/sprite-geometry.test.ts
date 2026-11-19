import { describe, expect, it } from 'vitest';
import { groundedSpriteLayout } from './sprite-geometry.js';

const art = {
  warehouse: { width: 256, height: 256, alpha: { left: 31, top: 104, right: 215, bottom: 223 } },
  house: { width: 256, height: 256, alpha: { left: 44, top: 106, right: 220, bottom: 235 } }
} as const;

describe('sprite grounding geometry', () => {
  it('anchors the warehouse visible base instead of its transparent PNG edge', () => {
    const layout = groundedSpriteLayout({
      worldX: 963, groundY: 600, textureWidth: art.warehouse.width, textureHeight: art.warehouse.height,
      displayWidth: 377, displayHeight: 377, alpha: art.warehouse.alpha
    });

    expect(layout.visibleBounds.bottom).toBeCloseTo(600);
    expect(layout.y).toBeCloseTo(648.59765625);
    expect(layout.visibleBounds.left + layout.visibleBounds.right).toBeCloseTo(2 * 963);
  });

  it('anchors a house and construction-stage sprite to the same logical surface', () => {
    const layout = groundedSpriteLayout({
      worldX: 690, groundY: 600, textureWidth: art.house.width, textureHeight: art.house.height,
      displayWidth: 377, displayHeight: 377, alpha: art.house.alpha
    });

    expect(layout.visibleBounds.bottom).toBeCloseTo(600);
    expect(layout.y).toBeCloseTo(630.92578125);
  });

  it('keeps the visible base on one ground line at different image scales and camera zooms', () => {
    for (const displaySize of [188.5, 377, 508.95]) {
      const layout = groundedSpriteLayout({
        worldX: 1240, groundY: 600, textureWidth: art.warehouse.width, textureHeight: art.warehouse.height,
        displayWidth: displaySize, displayHeight: displaySize, alpha: art.warehouse.alpha
      });
      for (const zoom of [0.58, 0.84, 1.35]) {
        expect((layout.visibleBounds.bottom - 420) * zoom).toBeCloseTo((600 - 420) * zoom);
      }
    }
  });
});
