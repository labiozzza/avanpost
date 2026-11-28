import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync, inflateSync } from 'node:zlib';

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const assetDirectory = join(scriptDirectory, '../public/assets/gameplay-prototype');

const assets = [
  { source: 'female-worker-atlas.png', output: 'female-worker-atlas-clean.png', frames: true },
  { source: 'sawmill-operating.png', output: 'sawmill-operating-clean.png' },
  { source: 'sawmill-construction.png', output: 'sawmill-construction-clean.png' }
];

const crcTable = new Uint32Array(256);
for (let index = 0; index < crcTable.length; index += 1) {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  crcTable[index] = value >>> 0;
}

function crc32(buffer) {
  let value = 0xffffffff;
  for (const byte of buffer) value = crcTable[(value ^ byte) & 0xff] ^ (value >>> 8);
  return (value ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const typeBytes = Buffer.from(type, 'ascii');
  const chunk = Buffer.alloc(12 + data.length);
  chunk.writeUInt32BE(data.length, 0);
  typeBytes.copy(chunk, 4);
  data.copy(chunk, 8);
  chunk.writeUInt32BE(crc32(chunk.subarray(4, 8 + data.length)), 8 + data.length);
  return chunk;
}

function decodeRgbaPng(buffer, label) {
  if (buffer.toString('hex', 0, 8) !== '89504e470d0a1a0a') throw new Error(`${label}: not a PNG`);
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  let interlace = 0;
  const imageData = [];

  for (let offset = 8; offset < buffer.length;) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString('ascii', offset + 4, offset + 8);
    const data = buffer.subarray(offset + 8, offset + 8 + length);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
      interlace = data[12];
    } else if (type === 'IDAT') imageData.push(data);
    offset += length + 12;
    if (type === 'IEND') break;
  }

  if (!width || !height || bitDepth !== 8 || colorType !== 6 || interlace !== 0) {
    throw new Error(`${label}: expected non-interlaced 8-bit RGBA PNG (got ${width}x${height}, depth ${bitDepth}, type ${colorType}, interlace ${interlace})`);
  }

  const stride = width * 4;
  const decoded = inflateSync(Buffer.concat(imageData));
  if (decoded.length !== (stride + 1) * height) throw new Error(`${label}: unexpected scanline data length`);
  const pixels = Buffer.alloc(height * stride);
  let sourceOffset = 0;

  for (let y = 0; y < height; y += 1) {
    const filter = decoded[sourceOffset++];
    const rowOffset = y * stride;
    for (let x = 0; x < stride; x += 1) {
      const raw = decoded[sourceOffset++];
      const left = x >= 4 ? pixels[rowOffset + x - 4] : 0;
      const above = y > 0 ? pixels[rowOffset + x - stride] : 0;
      const upperLeft = y > 0 && x >= 4 ? pixels[rowOffset + x - stride - 4] : 0;
      let predictor = 0;
      if (filter === 1) predictor = left;
      else if (filter === 2) predictor = above;
      else if (filter === 3) predictor = Math.floor((left + above) / 2);
      else if (filter === 4) {
        const base = left + above - upperLeft;
        const leftDistance = Math.abs(base - left);
        const aboveDistance = Math.abs(base - above);
        const upperLeftDistance = Math.abs(base - upperLeft);
        predictor = leftDistance <= aboveDistance && leftDistance <= upperLeftDistance
          ? left : aboveDistance <= upperLeftDistance ? above : upperLeft;
      } else if (filter !== 0) throw new Error(`${label}: unsupported PNG filter ${filter}`);
      pixels[rowOffset + x] = (raw + predictor) & 0xff;
    }
  }

  return { width, height, pixels };
}

function encodeRgbaPng({ width, height, pixels }) {
  const scanlines = Buffer.alloc(height * (width * 4 + 1));
  const stride = width * 4;
  for (let y = 0; y < height; y += 1) {
    const offset = y * (stride + 1);
    scanlines[offset] = 0;
    pixels.copy(scanlines, offset + 1, y * stride, (y + 1) * stride);
  }

  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;
  return Buffer.concat([
    Buffer.from('89504e470d0a1a0a', 'hex'),
    pngChunk('IHDR', header),
    pngChunk('IDAT', deflateSync(scanlines, { level: 9 })),
    pngChunk('IEND', Buffer.alloc(0))
  ]);
}

function isChromaticFringe(red, green, blue) {
  const maximum = Math.max(red, green, blue);
  const minimum = Math.min(red, green, blue);
  if (maximum - minimum < 48) return false;

  return (red >= 140 && red - green >= 65 && red - blue >= 35 && green < 140 && blue < 140) ||
    (green >= 100 && green - red >= 28 && green - blue >= 22) ||
    (blue >= 115 && blue - red >= 32 && blue - green >= 24) ||
    (red >= 105 && blue >= 105 && Math.min(red, blue) - green >= 24);
}

function isConstructionOpening(x, y) {
  const openGable = x >= 860 && x <= 1430 && y >= 58 && y <= 400;
  const scaffoldBays = x >= 1370 && x <= 1535 && y >= 320 && y <= 700;
  return openGable || scaffoldBays;
}

function isForcedConstructionVoid(x, y) {
  const openWorkBay = x >= 925 && x <= 1280 && y >= 410 && y <= 620;
  const windowOpenings = y >= 410 && y <= 515 && (
    (x >= 710 && x <= 770) || (x >= 790 && x <= 850) || (x >= 870 && x <= 910)
  );
  return openWorkBay || windowOpenings;
}

function isWarmTimber(red, green, blue) {
  const maximum = Math.max(red, green, blue);
  const minimum = Math.min(red, green, blue);
  const warmPigment = red >= green + 8 && green > blue + 4 && red > blue + 24 && red - green < 135;
  const paleNeutral = minimum >= 150 && maximum - minimum < 62;
  return warmPigment && !paleNeutral;
}

function isOperatingOutfeedSpark(x, y) {
  return x >= 1245 && x <= 1370 && y >= 465 && y <= 565;
}

function validateAtlas({ width, height, pixels }, label) {
  if (width !== 768 || height !== 896) throw new Error(`${label}: expected a 4x4 192x224 atlas`);
  const frameBottoms = [];
  for (let frameY = 0; frameY < 4; frameY += 1) {
    for (let frameX = 0; frameX < 4; frameX += 1) {
      let bottom = -1;
      for (let y = frameY * 224; y < (frameY + 1) * 224; y += 1) {
        for (let x = frameX * 192; x < (frameX + 1) * 192; x += 1) {
          if (pixels[(y * width + x) * 4 + 3] <= 16) continue;
          bottom = Math.max(bottom, y - frameY * 224);
        }
      }
      if (frameX === 3 && frameY === 3) {
        if (bottom !== -1) throw new Error(`${label}: reserved final frame must stay transparent`);
      } else {
        if (bottom < 210 || bottom > 214) throw new Error(`${label}: frame ${frameY * 4 + frameX} feet line moved to ${bottom}`);
        frameBottoms.push(bottom);
      }
    }
  }
  if (Math.max(...frameBottoms) - Math.min(...frameBottoms) > 2) {
    throw new Error(`${label}: animation frames no longer share a common feet line`);
  }
  return { frameCount: frameBottoms.length, feetLine: `${Math.min(...frameBottoms)}–${Math.max(...frameBottoms)}` };
}

for (const asset of assets) {
  const sourcePath = join(assetDirectory, asset.source);
  const outputPath = join(assetDirectory, asset.output);
  const image = decodeRgbaPng(await readFile(sourcePath), asset.source);
  let clearedFringePixels = 0;
  let clearedHiddenRgbPixels = 0;
  let clearedOpeningPixels = 0;
  let clearedStaticSparks = 0;

  for (let offset = 0; offset < image.pixels.length; offset += 4) {
    const pixel = offset / 4;
    const x = pixel % image.width;
    const y = Math.floor(pixel / image.width);
    const red = image.pixels[offset];
    const green = image.pixels[offset + 1];
    const blue = image.pixels[offset + 2];
    const alpha = image.pixels[offset + 3];

    // These saturated red, green, cyan, and magenta pixels are generation
    // fringe, not part of the warm AVANPOST palette. They are fringe-only
    // cleanup so anti-aliased neutral and warm edges retain their alpha.
    if (alpha <= 24 && alpha > 0 && isChromaticFringe(red, green, blue)) {
      image.pixels[offset + 3] = 0;
      clearedFringePixels += 1;
    }
    if (asset.source === 'sawmill-construction.png' && image.pixels[offset + 3] > 0 &&
        (isForcedConstructionVoid(x, y) ||
          (isConstructionOpening(x, y) && !isWarmTimber(red, green, blue)))) {
      image.pixels[offset + 3] = 0;
      clearedOpeningPixels += 1;
    }
    if (asset.source === 'sawmill-operating.png' && image.pixels[offset + 3] > 0 &&
        isOperatingOutfeedSpark(x, y)) {
      image.pixels[offset + 3] = 0;
      clearedStaticSparks += 1;
    }
    if (image.pixels[offset + 3] === 0 && (red !== 0 || green !== 0 || blue !== 0)) {
      image.pixels[offset] = 0;
      image.pixels[offset + 1] = 0;
      image.pixels[offset + 2] = 0;
      clearedHiddenRgbPixels += 1;
    }
  }

  const frameInfo = asset.frames ? validateAtlas(image, asset.output) : null;
  const corners = [
    3,
    (image.width - 4) * 4 + 3,
    ((image.height - 1) * image.width + 3) * 4 + 3,
    (image.height * image.width - 4) * 4 + 3
  ];
  if (corners.some((offset) => image.pixels[offset] !== 0)) {
    throw new Error(`${asset.output}: expected transparent canvas corners`);
  }

  const output = encodeRgbaPng(image);
  await writeFile(outputPath, output);
  const sizeKb = Math.round(output.length / 1024);
  console.log(`${asset.output}: ${image.width}x${image.height}, RGBA, transparent corners; ` +
    `${clearedFringePixels} fringe pixels removed, ${clearedHiddenRgbPixels} hidden RGB pixels cleared` +
    (frameInfo ? `; ${frameInfo.frameCount} frames, feet line ${frameInfo.feetLine}` : '') +
    (clearedOpeningPixels ? `; ${clearedOpeningPixels} non-timber opening pixels cleared` : '') +
    (clearedStaticSparks ? `; ${clearedStaticSparks} baked outfeed sparks cleared for runtime animation` : '') +
    `; ${sizeKb} KiB`);
}
