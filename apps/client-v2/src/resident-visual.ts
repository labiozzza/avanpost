/** Shared visible-pixel bounds produced by scripts/build-peace-v2-worker-atlas.py. */
export const RESIDENT_ATLAS_FRAME = {
  width: 192,
  height: 224,
  bodyTop: 36,
  feetLine: 214,
  baseFigureWidth: 44,
  maxPoseWidth: 181
} as const;

export const RESIDENT_TARGET_BODY_HEIGHT = 46;

export interface ResidentVisualMetrics {
  scale: number;
  frameWidth: number;
  frameHeight: number;
  bodyWidth: number;
  bodyHeight: number;
  hitAreaWidth: number;
  hitAreaHeight: number;
  originY: number;
}

export function residentVisualMetrics(cellSize: number): ResidentVisualMetrics {
  const bodyHeight = RESIDENT_ATLAS_FRAME.feetLine - RESIDENT_ATLAS_FRAME.bodyTop;
  const scale = Math.min(
    RESIDENT_TARGET_BODY_HEIGHT / bodyHeight,
    cellSize / RESIDENT_ATLAS_FRAME.maxPoseWidth
  );
  const displayedBodyHeight = bodyHeight * scale;
  return {
    scale,
    frameWidth: RESIDENT_ATLAS_FRAME.width * scale,
    frameHeight: RESIDENT_ATLAS_FRAME.height * scale,
    bodyWidth: RESIDENT_ATLAS_FRAME.baseFigureWidth * scale,
    bodyHeight: displayedBodyHeight,
    hitAreaWidth: cellSize,
    hitAreaHeight: displayedBodyHeight,
    originY: RESIDENT_ATLAS_FRAME.feetLine / RESIDENT_ATLAS_FRAME.height
  };
}

export interface ResidentHitBounds {
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
}

export function residentHitBounds(
  centerX: number,
  feetY: number,
  metrics: ResidentVisualMetrics
): ResidentHitBounds {
  return {
    left: centerX - metrics.hitAreaWidth / 2,
    top: feetY - metrics.hitAreaHeight,
    right: centerX + metrics.hitAreaWidth / 2,
    bottom: feetY,
    width: metrics.hitAreaWidth,
    height: metrics.hitAreaHeight
  };
}

export function residentAnimationForState(state: string, climbing = false): string {
  if (climbing || state === 'climb') return 'worker-climb';
  if (state === 'carrying_ladder') return 'worker-carry-walk';
  if ([
    'walking_to_source', 'walking_to_build', 'walking_to_stone', 'walking_to_clearing', 'walking_away_from_worksite',
    'walking_to_underground', 'hauling_to_source', 'hauling_to_storage', 'hauling_to_worksite'
  ].includes(state)) return 'worker-walk';
  if ([
    'carrying_to_storage', 'carrying_materials_to_build', 'carrying_stone_to_storage', 'carrying_stone_to_build',
    'carrying_underground_to_surface'
  ].includes(state)) return 'worker-carry-walk';
  if (['gathering', 'mining_stone', 'mining_underground', 'hauling_loading'].includes(state)) return 'worker-gather';
  if (['building', 'building_ladder', 'dismantling_ladder', 'installing_ladder', 'clearing', 'excavating', 'dig'].includes(state)) return 'worker-build';
  if (['loading', 'loading_stone'].includes(state)) return 'worker-load';
  if (['unloading', 'unloading_stone', 'unloading_stone_at_build', 'hauling_unloading'].includes(state)) return 'worker-unload';
  return 'idle';
}
