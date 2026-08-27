/**
 * Owns privacy-safe proof-color analysis for the graphics spike. It reduces a
 * screenshot to scalar bounds and pixel counts, and never returns image data.
 */

import type { TextureProofPalette } from "../../src/renderer/webgl-texture-recon.js";

export type CheckerboardBounds = Readonly<{
  palette: TextureProofPalette;
  pixels: number;
  firstColorPixels: number;
  secondColorPixels: number;
  bounds: Readonly<{ left: number; top: number; right: number; bottom: number }>;
}>;

type RgbaImage = Readonly<{
  width: number;
  height: number;
  data: Uint8Array;
}>;

type ColorClass = 0 | 1 | 2;

const MIN_PIXELS_PER_COLOR = 64;

function magentaCyan(red: number, green: number, blue: number): ColorClass {
  if (red >= 170 && green <= 130 && blue >= 160) return 1;
  if (red <= 130 && green >= 150 && blue >= 150) return 2;
  return 0;
}

function yellowBlue(red: number, green: number, blue: number): ColorClass {
  if (red >= 170 && green >= 160 && blue <= 130) return 1;
  if (red <= 130 && green <= 150 && blue >= 160) return 2;
  return 0;
}

function largestDenseRun(counts: Uint32Array, minimum: number): readonly [number, number] | null {
  let bestStart = -1;
  let bestEnd = -1;
  let currentStart = -1;
  let lastDense = -1;
  const maximumGap = 16;
  for (let index = 0; index <= counts.length + maximumGap; index += 1) {
    if (index < counts.length && counts[index]! >= minimum) {
      if (currentStart < 0) currentStart = index;
      lastDense = index;
      continue;
    }
    if (currentStart >= 0 && index - lastDense <= maximumGap) continue;
    if (currentStart >= 0 && lastDense + 1 - currentStart > bestEnd - bestStart) {
      bestStart = currentStart;
      bestEnd = lastDense + 1;
    }
    currentStart = -1;
    lastDense = -1;
  }
  return bestStart >= 0 ? [bestStart, bestEnd] : null;
}

function denseBounds(
  image: RgbaImage,
  palette: TextureProofPalette,
  classify: (red: number, green: number, blue: number) => ColorClass,
): CheckerboardBounds | null {
  const pixelCount = image.width * image.height;
  if (
    !Number.isSafeInteger(image.width)
    || !Number.isSafeInteger(image.height)
    || image.width <= 0
    || image.height <= 0
    || image.data.byteLength !== pixelCount * 4
  ) return null;

  const rowCounts = new Uint32Array(image.height);
  const columnCounts = new Uint32Array(image.width);
  for (let pixel = 0; pixel < pixelCount; pixel += 1) {
    const offset = pixel * 4;
    const color = classify(
      image.data[offset]!,
      image.data[offset + 1]!,
      image.data[offset + 2]!,
    );
    if (color > 0) {
      const x = pixel % image.width;
      const y = Math.floor(pixel / image.width);
      rowCounts[y] = rowCounts[y]! + 1;
      columnCounts[x] = columnCounts[x]! + 1;
    }
  }

  const horizontal = largestDenseRun(rowCounts, Math.max(16, Math.floor(image.width / 100)));
  const vertical = largestDenseRun(columnCounts, Math.max(16, Math.floor(image.height / 100)));
  if (!horizontal || !vertical) return null;
  const [top, bottom] = horizontal;
  const [left, right] = vertical;
  let firstColorPixels = 0;
  let secondColorPixels = 0;
  for (let y = top; y < bottom; y += 1) {
    for (let x = left; x < right; x += 1) {
      const offset = (y * image.width + x) * 4;
      const color = classify(
        image.data[offset]!,
        image.data[offset + 1]!,
        image.data[offset + 2]!,
      );
      if (color === 1) firstColorPixels += 1;
      if (color === 2) secondColorPixels += 1;
    }
  }
  if (firstColorPixels < MIN_PIXELS_PER_COLOR || secondColorPixels < MIN_PIXELS_PER_COLOR) return null;
  return Object.freeze({
    palette,
    pixels: firstColorPixels + secondColorPixels,
    firstColorPixels,
    secondColorPixels,
    bounds: Object.freeze({ left, top, right, bottom }),
  });
}

export function analyzeCheckerboardBounds(image: RgbaImage): readonly CheckerboardBounds[] {
  return Object.freeze([
    denseBounds(image, "magenta-cyan", magentaCyan),
    denseBounds(image, "yellow-blue", yellowBlue),
  ].filter((result): result is CheckerboardBounds => result !== null));
}
