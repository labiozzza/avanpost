export interface PanoramaLayout {
  sourceWidth: number;
  sourceHeight: number;
  scale: number;
  displayWidth: number;
  displayHeight: number;
  cropX: number;
  cropY: number;
  cropWidth: number;
  cropHeight: number;
  centerX: number;
  bottomY: number;
  visibleLeft: number;
  visibleRight: number;
  visibleTop: number;
  visibleBottom: number;
}

export function calculatePanoramaLayout(
  sourceWidth: number,
  sourceHeight: number,
  worldWidth: number,
  groundY: number,
  visibleHeight: number,
  horizontalOverscan = 1
): PanoramaLayout {
  if (![sourceWidth, sourceHeight, worldWidth, visibleHeight].every((value) =>
    Number.isFinite(value) && value > 0
  ) || !Number.isFinite(groundY) || !Number.isFinite(horizontalOverscan) || horizontalOverscan < 0) {
    throw new RangeError('Panorama dimensions must be finite and positive.');
  }

  const coverageWidth = worldWidth + horizontalOverscan * 2;
  const scale = Math.max(coverageWidth / sourceWidth, visibleHeight / sourceHeight);
  const displayWidth = sourceWidth * scale;
  const displayHeight = sourceHeight * scale;
  const cropHeight = Math.min(sourceHeight, visibleHeight / scale);
  const centerX = worldWidth / 2;

  return {
    sourceWidth,
    sourceHeight,
    scale,
    displayWidth,
    displayHeight,
    cropX: 0,
    cropY: sourceHeight - cropHeight,
    cropWidth: sourceWidth,
    cropHeight,
    centerX,
    bottomY: groundY,
    visibleLeft: centerX - displayWidth / 2,
    visibleRight: centerX + displayWidth / 2,
    visibleTop: groundY - cropHeight * scale,
    visibleBottom: groundY
  };
}
