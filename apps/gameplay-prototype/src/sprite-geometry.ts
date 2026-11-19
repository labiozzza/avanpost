export interface AlphaBounds {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface GroundedSpriteLayout {
  x: number;
  y: number;
  visibleBounds: { left: number; top: number; right: number; bottom: number };
}

/** Positions a centered Phaser image so its visible alpha bounds meet the logical ground. */
export function groundedSpriteLayout(input: {
  worldX: number;
  groundY: number;
  textureWidth: number;
  textureHeight: number;
  displayWidth: number;
  displayHeight: number;
  alpha: AlphaBounds;
}): GroundedSpriteLayout {
  const { worldX, groundY, textureWidth, textureHeight, displayWidth, displayHeight, alpha } = input;
  const scaleX = displayWidth / textureWidth;
  const scaleY = displayHeight / textureHeight;
  const alphaCenterX = (alpha.left + alpha.right) / 2;
  const x = worldX + (textureWidth / 2 - alphaCenterX) * scaleX;
  const y = groundY + (textureHeight - alpha.bottom) * scaleY;
  const left = x - displayWidth / 2 + alpha.left * scaleX;
  const right = x - displayWidth / 2 + alpha.right * scaleX;
  const top = y - displayHeight + alpha.top * scaleY;
  const bottom = y - displayHeight + alpha.bottom * scaleY;
  return { x, y, visibleBounds: { left, top, right, bottom } };
}
