import { describe, expect, it } from 'vitest';
import { calculatePanoramaLayout } from './panorama-layout.js';

describe('calculatePanoramaLayout', () => {
  it('covers the full world with one centered crop without distorting the source ratio', () => {
    const panorama = calculatePanoramaLayout(2172, 724, 3600, 600, 1022, 1);

    expect(panorama.centerX).toBe(1800);
    expect(panorama.visibleLeft).toBeLessThan(0);
    expect(panorama.visibleRight).toBeGreaterThan(3600);
    expect(panorama.displayWidth / panorama.displayHeight).toBeCloseTo(2172 / 724, 10);
    expect(panorama.cropX).toBe(0);
    expect(panorama.cropWidth).toBe(panorama.sourceWidth);
    expect(panorama.visibleTop).toBeCloseTo(600 - 1022, 8);
    expect(panorama.visibleBottom).toBe(600);
    expect(panorama.cropY).toBeGreaterThan(0);
    expect(panorama.cropY + panorama.cropHeight).toBeCloseTo(panorama.sourceHeight, 10);
  });

  it('covers every supported viewport at both camera zoom limits and world edges', () => {
    const panorama = calculatePanoramaLayout(2172, 724, 3600, 600, 1022, 1);
    const viewportWidths = [375, 390, 844, 1440];
    const zoomLimits = [0.58, 1.35];

    for (const viewportWidth of viewportWidths) {
      for (const zoom of zoomLimits) {
        const visibleWidth = viewportWidth / zoom;
        expect(visibleWidth).toBeLessThan(3600);
        for (const viewLeft of [0, 3600 - visibleWidth]) {
          expect(viewLeft).toBeGreaterThanOrEqual(panorama.visibleLeft);
          expect(viewLeft + visibleWidth).toBeLessThanOrEqual(panorama.visibleRight);
        }
      }
    }
  });

  it('rejects unusable source or world dimensions', () => {
    expect(() => calculatePanoramaLayout(0, 724, 3600, 600, 1022)).toThrow(RangeError);
    expect(() => calculatePanoramaLayout(2172, 724, Number.NaN, 600, 1022)).toThrow(RangeError);
  });
});
