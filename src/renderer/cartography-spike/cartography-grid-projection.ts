/**
 * Derives the game's fixed cartography-cell grid from certified native map
 * scalars. Coordinates remain in world-map units so the 32-unit phase has one
 * source of truth across Compass and Mission Map presentation.
 */
import type {
  CompassFrameSpikeSnapshot,
  MissionMapFrameSpikeSnapshot,
  WorldMapFrameSpikeSnapshot,
} from "../../shared/cartography-spike.js";
import type { ScreenBox } from "./frame-placement.js";
import {
  projectMapUnitsToCompass,
  projectMapUnitsToMissionMap,
  projectMapUnitsToWorldMap,
  type MaskTransform,
} from "./map-projections.js";

export const CARTOGRAPHY_CELL_MAP_UNITS = 32;
const CELL_EPSILON = 1 / 64;
const COMPASS_CELL_RADIUS = 3;
const MAX_GRID_AXIS_CELLS = 1_024;

export type CartographyCell = Readonly<{ x: number; y: number }>;
export type CartographyRevealRadius = 0 | 1 | 3;

export type CompassCartographyAnchor = Readonly<{
  generation: number;
  playerMapX: number;
  playerMapY: number;
}>;

export type CartographyGridProjection = Readonly<{
  box: ScreenBox;
  transform: MaskTransform;
  clip: Readonly<{ kind: "rectangle" }> | Readonly<{
    kind: "circle";
    centerX: number;
    centerY: number;
    radius: number;
  }>;
  firstCellX: number;
  lastCellX: number;
  firstCellY: number;
  lastCellY: number;
  currentCell: CartographyCell;
  surface: "compass" | "mission-map" | "world-map";
}>;

/** Match the client's half-open X and north-up Y ownership at exact edges. */
export function cartographyCellAt(mapX: number, mapY: number): CartographyCell | null {
  if (!Number.isFinite(mapX) || !Number.isFinite(mapY)) return null;
  const x = Math.floor((mapX + CELL_EPSILON) / CARTOGRAPHY_CELL_MAP_UNITS);
  const y = Math.ceil((mapY - CELL_EPSILON) / CARTOGRAPHY_CELL_MAP_UNITS) - 1;
  return Number.isSafeInteger(x) && Number.isSafeInteger(y)
    ? Object.freeze({ x, y })
    : null;
}

/** Resolve a passive screen-space hover through the current Mission Map transform. */
export function cartographyCellAtScreenPoint(
  projection: CartographyGridProjection,
  clientX: number,
  clientY: number,
): CartographyCell | null {
  const { box, transform } = projection;
  if (
    projection.surface === "compass"
    || !Number.isFinite(clientX)
    || !Number.isFinite(clientY)
    || clientX < box.left
    || clientX >= box.left + box.width
    || clientY < box.top
    || clientY >= box.top + box.height
  ) return null;
  const determinant = transform.a * transform.d - transform.b * transform.c;
  if (!Number.isFinite(determinant) || Math.abs(determinant) < Number.EPSILON) return null;
  const localX = clientX - box.left - transform.e;
  const localY = clientY - box.top - transform.f;
  const mapX = (transform.d * localX - transform.c * localY) / determinant;
  const mapY = (-transform.b * localX + transform.a * localY) / determinant;
  return cartographyCellAt(mapX, mapY);
}

function validFrameProjection(frame: MissionMapFrameSpikeSnapshot): boolean {
  return frame.status === 1
    && frame.projectionStatus === 1
    && frame.projectionGeneration === frame.generation
    && frame.generation > 0
    && [
      frame.zoom, frame.panX, frame.panY,
      frame.playerMapX, frame.playerMapY,
      frame.drawableWidth, frame.drawableHeight,
    ].every(Number.isFinite)
    && frame.zoom > 0
    && frame.drawableWidth > 0
    && frame.drawableHeight > 0;
}

function validCellRange(first: number, last: number): boolean {
  return Number.isSafeInteger(first)
    && Number.isSafeInteger(last)
    && first <= last
    && last - first + 1 <= MAX_GRID_AXIS_CELLS;
}

/** Project the visible Mission Map rectangle, including one clipped edge cell. */
export function projectCartographyGridToMissionMap(input: Readonly<{
  frame: MissionMapFrameSpikeSnapshot;
  box: ScreenBox;
}>): CartographyGridProjection | null {
  const { frame, box } = input;
  if (
    !frame.visible
    || !validFrameProjection(frame)
    || ![box.left, box.top, box.width, box.height].every(Number.isFinite)
    || box.width <= 0
    || box.height <= 0
  ) return null;
  const currentCell = cartographyCellAt(frame.playerMapX, frame.playerMapY);
  if (currentCell === null) return null;
  const halfMapWidth = frame.drawableWidth / (2 * frame.zoom);
  const halfMapHeight = frame.drawableHeight / (2 * frame.zoom);
  const firstCellX = Math.floor((frame.panX - halfMapWidth) / CARTOGRAPHY_CELL_MAP_UNITS) - 1;
  const lastCellX = Math.floor((frame.panX + halfMapWidth) / CARTOGRAPHY_CELL_MAP_UNITS) + 1;
  const firstCellY = Math.floor((frame.panY - halfMapHeight) / CARTOGRAPHY_CELL_MAP_UNITS) - 1;
  const lastCellY = Math.floor((frame.panY + halfMapHeight) / CARTOGRAPHY_CELL_MAP_UNITS) + 1;
  if (!validCellRange(firstCellX, lastCellX) || !validCellRange(firstCellY, lastCellY)) {
    return null;
  }
  const mapProjection = projectMapUnitsToMissionMap(frame, box);
  if (mapProjection === null) return null;
  return Object.freeze({
    box,
    transform: mapProjection.transform,
    clip: mapProjection.clip,
    firstCellX,
    lastCellX,
    firstCellY,
    lastCellY,
    currentCell,
    surface: "mission-map",
  });
}

/** Project the visible dedicated World Map viewport on the global cell phase. */
export function projectCartographyGridToWorldMap(input: Readonly<{
  frame: WorldMapFrameSpikeSnapshot;
  box: ScreenBox;
}>): CartographyGridProjection | null {
  const { frame, box } = input;
  const firstCellX = Math.floor(frame.topLeftX / CARTOGRAPHY_CELL_MAP_UNITS) - 1;
  const lastCellX = Math.floor(frame.bottomRightX / CARTOGRAPHY_CELL_MAP_UNITS) + 1;
  const firstCellY = Math.floor(frame.topLeftY / CARTOGRAPHY_CELL_MAP_UNITS) - 1;
  const lastCellY = Math.floor(frame.bottomRightY / CARTOGRAPHY_CELL_MAP_UNITS) + 1;
  const currentCell = cartographyCellAt(
    (frame.topLeftX + frame.bottomRightX) / 2,
    (frame.topLeftY + frame.bottomRightY) / 2,
  );
  if (
    currentCell === null
    || !validCellRange(firstCellX, lastCellX)
    || !validCellRange(firstCellY, lastCellY)
  ) return null;
  const mapProjection = projectMapUnitsToWorldMap(frame, box);
  if (mapProjection === null) return null;
  return Object.freeze({
    box,
    transform: mapProjection.transform,
    clip: mapProjection.clip,
    firstCellX,
    lastCellX,
    firstCellY,
    lastCellY,
    currentCell,
    surface: "world-map",
  });
}

/** Conservative cell size used for stable level-of-detail selection. */
export function cartographyCellPixelSize(projection: CartographyGridProjection): number {
  const { a, b, c, d } = projection.transform;
  return Math.min(Math.hypot(a, b), Math.hypot(c, d)) * CARTOGRAPHY_CELL_MAP_UNITS;
}

/**
 * Project a small local grid through the rotating Compass. The absolute phase
 * comes from a currently certified world-map coordinate; the Compass
 * contributes only its certified camera basis.
 */
export function projectCartographyGridToCompass(input: Readonly<{
  frame: CompassCartographyAnchor;
  compass: CompassFrameSpikeSnapshot;
  box: ScreenBox;
}>): CartographyGridProjection | null {
  const { frame: anchor, compass, box } = input;
  const directionLength = Math.hypot(
    compass.compassDirectionX,
    compass.compassDirectionY,
  );
  if (
    anchor.generation !== compass.generation
    || !Number.isFinite(anchor.playerMapX)
    || !Number.isFinite(anchor.playerMapY)
    || compass.status !== 1
    || !compass.visible
    || !Number.isFinite(directionLength)
    || directionLength < 0.99
    || directionLength > 1.01
    || ![box.left, box.top, box.width, box.height].every(Number.isFinite)
    || box.width <= 0
    || box.height <= 0
  ) return null;
  const currentCell = cartographyCellAt(anchor.playerMapX, anchor.playerMapY);
  if (currentCell === null) return null;
  const mapProjection = projectMapUnitsToCompass({
    box,
    playerMapX: anchor.playerMapX,
    playerMapY: anchor.playerMapY,
    directionX: compass.compassDirectionX,
    directionY: compass.compassDirectionY,
  });
  if (mapProjection === null) return null;
  return Object.freeze({
    box,
    transform: mapProjection.transform,
    clip: mapProjection.clip,
    firstCellX: currentCell.x - COMPASS_CELL_RADIUS,
    lastCellX: currentCell.x + COMPASS_CELL_RADIUS,
    firstCellY: currentCell.y - COMPASS_CELL_RADIUS,
    lastCellY: currentCell.y + COMPASS_CELL_RADIUS,
    currentCell,
    surface: "compass",
  });
}
