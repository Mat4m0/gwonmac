/**
 * Builds the one bounded world-space walkability union shared by both map surfaces.
 * Rejects geometry that cannot fit the fixed raster memory budget.
 */
import type { PathingSpikeTrapezoid } from "../../shared/cartography-spike.js";

export const GAME_UNITS_PER_RASTER_PIXEL = 48;
export const MAX_WALKABILITY_RASTER_EDGE = 4_096;
export const MAX_WALKABILITY_RASTER_PIXELS = 8_000_000;

export type WalkabilityMask = Readonly<{
  canvas: HTMLCanvasElement;
  minX: number;
  maxY: number;
  worldWidth: number;
  worldHeight: number;
}>;

/**
 * Rasterize the complete trapezoid union once per map generation.
 * Interaction frames transform this bounded bitmap and never revisit geometry.
 */
export function createWalkabilityMask(
  document: Document,
  geometry: readonly PathingSpikeTrapezoid[],
): WalkabilityMask | null {
  if (geometry.length === 0) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const trapezoid of geometry) {
    const coordinates = [
      trapezoid.topLeftX, trapezoid.topRightX, trapezoid.topY,
      trapezoid.bottomLeftX, trapezoid.bottomRightX, trapezoid.bottomY,
    ];
    if (
      !coordinates.every(Number.isFinite)
      || trapezoid.topY < trapezoid.bottomY
      || trapezoid.topLeftX > trapezoid.topRightX
      || trapezoid.bottomLeftX > trapezoid.bottomRightX
    ) return null;
    minX = Math.min(minX, trapezoid.topLeftX, trapezoid.bottomLeftX);
    maxX = Math.max(maxX, trapezoid.topRightX, trapezoid.bottomRightX);
    minY = Math.min(minY, trapezoid.bottomY);
    maxY = Math.max(maxY, trapezoid.topY);
  }
  if (!(minX < maxX && minY < maxY)) return null;

  const width = Math.ceil((maxX - minX) / GAME_UNITS_PER_RASTER_PIXEL) + 2;
  const height = Math.ceil((maxY - minY) / GAME_UNITS_PER_RASTER_PIXEL) + 2;
  if (
    width > MAX_WALKABILITY_RASTER_EDGE
    || height > MAX_WALKABILITY_RASTER_EDGE
    || width * height > MAX_WALKABILITY_RASTER_PIXELS
  ) return null;

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (context === null) return null;
  context.setTransform(
    1 / GAME_UNITS_PER_RASTER_PIXEL,
    0,
    0,
    -1 / GAME_UNITS_PER_RASTER_PIXEL,
    1 - minX / GAME_UNITS_PER_RASTER_PIXEL,
    1 + maxY / GAME_UNITS_PER_RASTER_PIXEL,
  );
  context.beginPath();
  for (const trapezoid of geometry) {
    context.moveTo(trapezoid.topLeftX, trapezoid.topY);
    context.lineTo(trapezoid.topRightX, trapezoid.topY);
    context.lineTo(trapezoid.bottomRightX, trapezoid.bottomY);
    context.lineTo(trapezoid.bottomLeftX, trapezoid.bottomY);
    context.closePath();
  }
  context.fillStyle = "#FFFFFF";
  context.fill();
  // Close sub-pixel seams between adjacent trapezoids without exposing their edges.
  context.lineWidth = GAME_UNITS_PER_RASTER_PIXEL;
  context.strokeStyle = "#FFFFFF";
  context.stroke();
  return Object.freeze({
    canvas,
    minX: minX - GAME_UNITS_PER_RASTER_PIXEL,
    maxY: maxY + GAME_UNITS_PER_RASTER_PIXEL,
    worldWidth: width * GAME_UNITS_PER_RASTER_PIXEL,
    worldHeight: height * GAME_UNITS_PER_RASTER_PIXEL,
  });
}
