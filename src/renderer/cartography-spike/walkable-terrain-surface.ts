/**
 * Owns conversion from the typed kernel terrain raster to a cached paint surface.
 * Projection remains outside this module so the source raster has one meaning.
 */
import type { WalkableTerrainRaster } from "./cartography-model.js";

export type WalkableTerrainSurface = Readonly<{
  canvas: HTMLCanvasElement;
  mapLeft: number;
  mapTop: number;
  mapUnitsPerPixel: number;
}>;

export function createWalkableTerrainSurface(
  document: Document,
  raster: WalkableTerrainRaster,
): WalkableTerrainSurface | null {
  const cells = raster.width * raster.height;
  if (
    !Number.isSafeInteger(cells) || cells <= 0
    || raster.words.length !== Math.ceil(cells / 32)
  ) return null;
  const canvas = document.createElement("canvas");
  canvas.width = raster.width;
  canvas.height = raster.height;
  const context = canvas.getContext("2d");
  if (context === null) return null;
  const image = context.createImageData(raster.width, raster.height);
  for (let index = 0; index < cells; index += 1) {
    if (((raster.words[index >>> 5]! >>> (index & 31)) & 1) === 0) continue;
    const pixel = index * 4;
    image.data[pixel] = 255;
    image.data[pixel + 1] = 255;
    image.data[pixel + 2] = 255;
    image.data[pixel + 3] = 255;
  }
  context.putImageData(image, 0, 0);
  return Object.freeze({
    canvas,
    mapLeft: raster.mapLeft,
    mapTop: raster.mapTop,
    mapUnitsPerPixel: raster.mapUnitsPerPixel,
  });
}
