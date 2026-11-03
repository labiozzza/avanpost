import { describe, expect, it } from 'vitest';
import {
  RESIDENT_ATLAS_FRAME, RESIDENT_TARGET_BODY_HEIGHT, residentAnimationForState,
  residentHitBounds, residentVisualMetrics
} from '../src/resident-visual.js';

describe('resident visual contract', () => {
  const metrics = residentVisualMetrics(48);

  it('uses one uniform scale that keeps the atlas body within a cell', () => {
    expect(metrics.scale).toBeCloseTo(metrics.frameWidth / RESIDENT_ATLAS_FRAME.width);
    expect(metrics.scale).toBeCloseTo(metrics.frameHeight / RESIDENT_ATLAS_FRAME.height);
    expect(metrics.bodyHeight).toBeGreaterThanOrEqual(44);
    expect(metrics.bodyHeight).toBeLessThanOrEqual(48);
    expect(RESIDENT_TARGET_BODY_HEIGHT).toBe(46);
    expect(RESIDENT_ATLAS_FRAME.maxPoseWidth * metrics.scale).toBeLessThanOrEqual(48);
    expect(metrics.bodyWidth).toBeLessThanOrEqual(48);
  });

  it('anchors the normalized feet and selection bounds to the same logical baseline', () => {
    const bounds = residentHitBounds(72, 191, metrics);
    const atlasFootLine = metrics.originY * metrics.frameHeight;
    const visibleBodyBottomRelativeToAnchor = RESIDENT_ATLAS_FRAME.feetLine * metrics.scale - atlasFootLine;
    expect(atlasFootLine).toBeCloseTo(RESIDENT_ATLAS_FRAME.feetLine * metrics.scale);
    expect(visibleBodyBottomRelativeToAnchor).toBeCloseTo(0);
    expect(bounds).toMatchObject({ left: 48, right: 96, bottom: 191, width: 48 });
    expect(bounds.height).toBeCloseTo(metrics.bodyHeight);
    expect(bounds.top).toBeCloseTo(191 - metrics.bodyHeight);
  });

  it('keeps the same 46 px body size for surface and underground residents', () => {
    const underground = residentVisualMetrics(48);
    expect(metrics.bodyHeight).toBeCloseTo(46);
    expect(underground.bodyHeight).toBeCloseTo(46);
    expect(underground.scale).toBeCloseTo(metrics.scale);
    expect(underground.hitAreaHeight).toBeCloseTo(metrics.hitAreaHeight);
  });

  it.each([
    ['idle', 'idle'],
    ['walking_to_underground', 'worker-walk'],
    ['carrying_materials_to_build', 'worker-carry-walk'],
    ['carrying_underground_to_surface', 'worker-carry-walk'],
    ['building_ladder', 'worker-build'],
    ['excavating', 'worker-build'],
    ['dig', 'worker-build'],
    ['mining_underground', 'worker-gather'],
    ['unloading_stone', 'worker-unload'],
    ['loading_stone', 'worker-load'],
    ['climb', 'worker-climb']
  ])('keeps the %s pose in the shared animation pipeline', (state, animation) => {
    expect(residentAnimationForState(state)).toBe(animation);
  });

  it('uses the same climbing animation override for vertical movement only', () => {
    expect(residentAnimationForState('carrying_materials_to_build', true)).toBe('worker-climb');
    expect(residentAnimationForState('carrying_materials_to_build')).toBe('worker-carry-walk');
  });
});
