/**
 * Derives the game's fixed cartography-cell grid from certified native map
 * scalars. Coordinates remain in world-map units so the 32-unit phase has one
 * source of truth across Compass and Mission Map presentation.
 */
import type {
  CompassFrameSpikeSnapshot,
  MissionMapFrameSpikeSnapshot,
} from "../../shared/cartography-spike.js";
import type { ScreenBox } from "./frame-placement.js";
import {
  COMPASS_FRAME_WIDTH,
  COMPASS_MAP_RADIUS,
  COMPASS_WORLD_RADIUS,
  GAME_UNITS_PER_MAP_UNIT,
  type MaskTransform,
} from "./map-projections.js";

export const CARTOGRAPHY_CELL_MAP_UNITS = 32;
const CELL_EPSILON = 1 / 64;
const COMPASS_CELL_RADIUS = 3;
const MAX_GRID_AXIS_CELLS = 128;

export type CartographyCell = Readonly<{ x: number; y: number }>;
export type CartographyRevealRadius = 0 | 1 | 3;

export type CartographyGridAnchor = Readonly<{
  frame: MissionMapFrameSpikeSnapshot;
  playerX: number;
  playerY: number;
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
  surface: "compass" | "mission-map";
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
    projection.surface !== "mission-map"
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

/**
 * Retain the last certified map-space origin so the Compass grid can continue
 * while the Mission Map is closed. Live game-space movement advances the
 * anchor; a generation change invalidates it.
 */
export function createCartographyGridAnchor(input: Readonly<{
  frame: MissionMapFrameSpikeSnapshot;
  playerX: number;
  playerY: number;
}>): CartographyGridAnchor | null {
  if (
    !validFrameProjection(input.frame)
    || !Number.isFinite(input.playerX)
    || !Number.isFinite(input.playerY)
  ) return null;
  return Object.freeze({
    frame: input.frame,
    playerX: input.playerX,
    playerY: input.playerY,
  });
}

export function advanceCartographyGridAnchor(
  anchor: CartographyGridAnchor,
  input: Readonly<{ generation: number; playerX: number; playerY: number }>,
): MissionMapFrameSpikeSnapshot | null {
  if (
    input.generation !== anchor.frame.generation
    || !Number.isFinite(input.playerX)
    || !Number.isFinite(input.playerY)
  ) return null;
  return Object.freeze({
    ...anchor.frame,
    playerMapX: anchor.frame.playerMapX
      + (input.playerX - anchor.playerX) / GAME_UNITS_PER_MAP_UNIT,
    playerMapY: anchor.frame.playerMapY
      - (input.playerY - anchor.playerY) / GAME_UNITS_PER_MAP_UNIT,
  });
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
    firstCellX,
    lastCellX,
    firstCellY,
    lastCellY,
    currentCell,
    surface: "mission-map",
  });
}

/**
 * Project a small local grid through the rotating Compass. The absolute phase
 * comes from the Mission Map's player world-map coordinate, even while that
 * frame is hidden; the Compass contributes only its certified camera basis.
 */
export function projectCartographyGridToCompass(input: Readonly<{
  frame: MissionMapFrameSpikeSnapshot;
  compass: CompassFrameSpikeSnapshot;
  box: ScreenBox;
}>): CartographyGridProjection | null {
  const { frame, compass, box } = input;
  const directionLength = Math.hypot(
    compass.compassDirectionX,
    compass.compassDirectionY,
  );
  if (
    !validFrameProjection(frame)
    || frame.generation !== compass.generation
    || compass.status !== 1
    || !compass.visible
    || !Number.isFinite(directionLength)
    || directionLength < 0.99
    || directionLength > 1.01
    || ![box.left, box.top, box.width, box.height].every(Number.isFinite)
    || box.width <= 0
    || box.height <= 0
  ) return null;
  const currentCell = cartographyCellAt(frame.playerMapX, frame.playerMapY);
  if (currentCell === null) return null;
  const directionX = compass.compassDirectionX / directionLength;
  const directionY = compass.compassDirectionY / directionLength;
  const centerX = box.width / 2;
  const centerY = box.width / 2;
  const radius = box.width * COMPASS_MAP_RADIUS / COMPASS_FRAME_WIDTH;
  if (radius <= 0 || centerY + radius > box.height) return null;
  const mapUnitScale = GAME_UNITS_PER_MAP_UNIT * radius / COMPASS_WORLD_RADIUS;
  const a = mapUnitScale * directionY;
  const b = -mapUnitScale * directionX;
  const c = mapUnitScale * directionX;
  const d = mapUnitScale * directionY;
  return Object.freeze({
    box,
    transform: Object.freeze({
      a,
      b,
      c,
      d,
      e: centerX - a * frame.playerMapX - c * frame.playerMapY,
      f: centerY - b * frame.playerMapX - d * frame.playerMapY,
    }),
    clip: Object.freeze({ kind: "circle", centerX, centerY, radius }),
    firstCellX: currentCell.x - COMPASS_CELL_RADIUS,
    lastCellX: currentCell.x + COMPASS_CELL_RADIUS,
    firstCellY: currentCell.y - COMPASS_CELL_RADIUS,
    lastCellY: currentCell.y + COMPASS_CELL_RADIUS,
    currentCell,
    surface: "compass",
  });
}
