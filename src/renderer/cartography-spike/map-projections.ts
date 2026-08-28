/**
 * Converts the shared world-space mask into Compass and Mission Map transforms.
 * Keeps surface-specific pan, zoom, rotation, and content bounds in one place.
 */
import type { MissionMapFrameSpikeSnapshot } from "../../shared/cartography-spike.js";
import type { ScreenBox } from "./frame-placement.js";
import type { WalkabilityMask } from "./walkability-mask.js";
import { GAME_UNITS_PER_RASTER_PIXEL } from "./walkability-mask.js";

export const COMPASS_WORLD_RADIUS = 5_000;
export const COMPASS_MAP_RADIUS = 96;
export const COMPASS_FRAME_WIDTH = 245;
export const GAME_UNITS_PER_MAP_UNIT = 96;
const MISSION_MAP_BOTTOM_PADDING = 2;

export type MaskTransform = Readonly<{
  a: number;
  b: number;
  c: number;
  d: number;
  e: number;
  f: number;
}>;

export type InverseMaskProjection = Readonly<{
  box: ScreenBox;
  transform: MaskTransform;
  clip: Readonly<{ kind: "rectangle" }> | Readonly<{
    kind: "circle";
    centerX: number;
    centerY: number;
    radius: number;
  }>;
}>;

export function projectWalkabilityToCompass(input: Readonly<{
  box: ScreenBox;
  mask: WalkabilityMask;
  playerX: number;
  playerY: number;
  directionX: number;
  directionY: number;
}>): InverseMaskProjection | null {
  const directionLength = Math.hypot(input.directionX, input.directionY);
  if (!Number.isFinite(directionLength) || directionLength < 0.99 || directionLength > 1.01) {
    return null;
  }
  const centerX = input.box.width / 2;
  const centerY = input.box.width / 2;
  const radius = input.box.width * COMPASS_MAP_RADIUS / COMPASS_FRAME_WIDTH;
  if (radius <= 0 || centerY + radius > input.box.height) return null;

  const directionX = input.directionX / directionLength;
  const directionY = input.directionY / directionLength;
  const scale = radius / COMPASS_WORLD_RADIUS;
  const rasterScale = GAME_UNITS_PER_RASTER_PIXEL * scale;
  const originX = input.mask.minX - input.playerX;
  const originY = input.mask.maxY - input.playerY;
  return Object.freeze({
    box: input.box,
    transform: Object.freeze({
      a: rasterScale * directionY,
      b: -rasterScale * directionX,
      c: rasterScale * directionX,
      d: rasterScale * directionY,
      e: centerX + (originX * directionY - originY * directionX) * scale,
      f: centerY + (-originX * directionX - originY * directionY) * scale,
    }),
    clip: Object.freeze({ kind: "circle", centerX, centerY, radius }),
  });
}

/** Derive the native drawable rectangle from its certified size and frame. */
export function projectMissionMapContentBox(
  frame: MissionMapFrameSpikeSnapshot,
  outerBox: ScreenBox,
): ScreenBox | null {
  const nativeWidth = frame.right - frame.left;
  const nativeHeight = frame.top - frame.bottom;
  if (
    ![nativeWidth, nativeHeight, frame.drawableWidth, frame.drawableHeight]
      .every(Number.isFinite)
    || nativeWidth <= 0 || nativeHeight <= 0
    || frame.drawableWidth <= 0 || frame.drawableWidth > nativeWidth
    || frame.drawableHeight <= 0 || frame.drawableHeight > nativeHeight
  ) return null;
  const scaleX = outerBox.width / nativeWidth;
  const scaleY = outerBox.height / nativeHeight;
  const sideInset = (nativeWidth - frame.drawableWidth) / 2;
  const verticalInset = nativeHeight - frame.drawableHeight;
  const bottomInset = sideInset + MISSION_MAP_BOTTOM_PADDING;
  if (sideInset < 0 || bottomInset > verticalInset) return null;
  const width = frame.drawableWidth * scaleX;
  const height = frame.drawableHeight * scaleY;
  return Object.freeze({
    left: outerBox.left + sideInset * scaleX,
    // The title bar makes the vertical margins asymmetric. The native map has
    // two additional lower-padding units beyond its shared side-border inset.
    top: outerBox.top + (verticalInset - bottomInset) * scaleY,
    width,
    height,
  });
}

/** Current-map projection anchored to the live player, avoiding DAT map bounds. */
export function projectGamePointToMissionMap(
  frame: MissionMapFrameSpikeSnapshot,
  contentBox: ScreenBox,
  playerX: number,
  playerY: number,
  worldX: number,
  worldY: number,
): Readonly<{ x: number; y: number }> {
  const mapX = frame.playerMapX + (worldX - playerX) / GAME_UNITS_PER_MAP_UNIT;
  const mapY = frame.playerMapY - (worldY - playerY) / GAME_UNITS_PER_MAP_UNIT;
  return Object.freeze({
    x: contentBox.width / 2
      + (mapX - frame.panX) * frame.zoom * contentBox.width / frame.drawableWidth,
    y: contentBox.height / 2
      + (mapY - frame.panY) * frame.zoom * contentBox.height / frame.drawableHeight,
  });
}

export function projectWalkabilityToMissionMap(input: Readonly<{
  frame: MissionMapFrameSpikeSnapshot;
  box: ScreenBox;
  mask: WalkabilityMask;
  playerX: number;
  playerY: number;
}>): InverseMaskProjection | null {
  const values = [
    input.frame.zoom,
    input.frame.panX,
    input.frame.panY,
    input.frame.playerMapX,
    input.frame.playerMapY,
    input.frame.drawableWidth,
    input.frame.drawableHeight,
    input.box.width,
    input.box.height,
  ];
  if (
    !values.every(Number.isFinite)
    || input.frame.zoom <= 0
    || input.frame.drawableWidth <= 0
    || input.frame.drawableHeight <= 0
    || input.box.width <= 0
    || input.box.height <= 0
  ) return null;
  const scaleX = input.box.width / input.frame.drawableWidth;
  const scaleY = input.box.height / input.frame.drawableHeight;
  const mapLeft = input.frame.playerMapX
    + (input.mask.minX - input.playerX) / GAME_UNITS_PER_MAP_UNIT;
  const mapTop = input.frame.playerMapY
    - (input.mask.maxY - input.playerY) / GAME_UNITS_PER_MAP_UNIT;
  const unitX = input.frame.zoom * scaleX / GAME_UNITS_PER_MAP_UNIT;
  const unitY = input.frame.zoom * scaleY / GAME_UNITS_PER_MAP_UNIT;
  return Object.freeze({
    box: input.box,
    transform: Object.freeze({
      a: GAME_UNITS_PER_RASTER_PIXEL * unitX,
      b: 0,
      c: 0,
      d: GAME_UNITS_PER_RASTER_PIXEL * unitY,
      e: input.box.width / 2 + (mapLeft - input.frame.panX) * input.frame.zoom * scaleX,
      f: input.box.height / 2 + (mapTop - input.frame.panY) * input.frame.zoom * scaleY,
    }),
    clip: Object.freeze({ kind: "rectangle" }),
  });
}
