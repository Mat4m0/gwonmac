/**
 * Converts the shared world-space mask into Compass and Mission Map transforms.
 * Keeps surface-specific pan, zoom, rotation, and content bounds in one place.
 */
import type { MissionMapFrameSpikeSnapshot } from "../../shared/cartography-spike.js";
import type { ScreenBox } from "./frame-placement.js";
import type { WalkableTerrainSurface } from "./walkable-terrain-surface.js";

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

export type MapUnitProjection = InverseMaskProjection;

/** The one absolute world-map-unit projection used by every Compass layer. */
export function projectMapUnitsToCompass(input: Readonly<{
  box: ScreenBox;
  playerMapX: number;
  playerMapY: number;
  directionX: number;
  directionY: number;
}>): MapUnitProjection | null {
  const directionLength = Math.hypot(input.directionX, input.directionY);
  if (
    !Number.isFinite(directionLength)
    || directionLength < 0.99
    || directionLength > 1.01
    || ![input.playerMapX, input.playerMapY, input.box.width, input.box.height]
      .every(Number.isFinite)
    || input.box.width <= 0
    || input.box.height <= 0
  ) return null;
  const centerX = input.box.width / 2;
  const centerY = input.box.width / 2;
  const radius = input.box.width * COMPASS_MAP_RADIUS / COMPASS_FRAME_WIDTH;
  if (radius <= 0 || centerY + radius > input.box.height) return null;
  const directionX = input.directionX / directionLength;
  const directionY = input.directionY / directionLength;
  const scale = GAME_UNITS_PER_MAP_UNIT * radius / COMPASS_WORLD_RADIUS;
  const a = scale * directionY;
  const b = -scale * directionX;
  const c = scale * directionX;
  const d = scale * directionY;
  return Object.freeze({
    box: input.box,
    transform: Object.freeze({
      a, b, c, d,
      e: centerX - a * input.playerMapX - c * input.playerMapY,
      f: centerY - b * input.playerMapX - d * input.playerMapY,
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

/** The one absolute world-map-unit projection used by every Mission Map layer. */
export function projectMapUnitsToMissionMap(
  frame: MissionMapFrameSpikeSnapshot,
  box: ScreenBox,
): MapUnitProjection | null {
  if (
    !frame.visible
    || frame.status !== 1
    || frame.projectionStatus !== 1
    || frame.projectionGeneration !== frame.generation
    || frame.generation <= 0
    || ![
      frame.zoom, frame.panX, frame.panY,
      frame.drawableWidth, frame.drawableHeight,
      box.left, box.top, box.width, box.height,
    ].every(Number.isFinite)
    || frame.zoom <= 0
    || frame.drawableWidth <= 0
    || frame.drawableHeight <= 0
    || box.width <= 0
    || box.height <= 0
  ) return null;
  const scaleX = frame.zoom * box.width / frame.drawableWidth;
  const scaleY = frame.zoom * box.height / frame.drawableHeight;
  return Object.freeze({
    box,
    transform: Object.freeze({
      a: scaleX,
      b: 0,
      c: 0,
      d: scaleY,
      e: box.width / 2 - frame.panX * scaleX,
      f: box.height / 2 - frame.panY * scaleY,
    }),
    clip: Object.freeze({ kind: "rectangle" }),
  });
}

function projectTerrain(
  projection: MapUnitProjection,
  terrain: WalkableTerrainSurface,
): InverseMaskProjection {
  const { a, b, c, d, e, f } = projection.transform;
  const scale = terrain.mapUnitsPerPixel;
  return Object.freeze({
    box: projection.box,
    transform: Object.freeze({
      a: a * scale,
      b: b * scale,
      c: c * scale,
      d: d * scale,
      e: e + a * terrain.mapLeft + c * terrain.mapTop,
      f: f + b * terrain.mapLeft + d * terrain.mapTop,
    }),
    clip: projection.clip,
  });
}

export function projectTerrainToCompass(input: Readonly<{
  box: ScreenBox;
  terrain: WalkableTerrainSurface;
  playerMapX: number;
  playerMapY: number;
  directionX: number;
  directionY: number;
}>): InverseMaskProjection | null {
  const projection = projectMapUnitsToCompass(input);
  return projection === null ? null : projectTerrain(projection, input.terrain);
}

export function projectTerrainToMissionMap(input: Readonly<{
  frame: MissionMapFrameSpikeSnapshot;
  box: ScreenBox;
  terrain: WalkableTerrainSurface;
}>): InverseMaskProjection | null {
  const projection = projectMapUnitsToMissionMap(input.frame, input.box);
  return projection === null ? null : projectTerrain(projection, input.terrain);
}
