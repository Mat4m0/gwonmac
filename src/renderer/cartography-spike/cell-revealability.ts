/**
 * Classifies current-map cartography cells from live pathing and the compact
 * continent coverage masks imported from GWToolbox++.
 */
import type { PathingSpikeTrapezoid } from "../../shared/cartography-spike.js";
import { CARTOGRAPHY_CELL_MAP_UNITS } from "./cartography-grid-projection.js";
import { GAME_UNITS_PER_MAP_UNIT } from "./map-projections.js";
import {
  TOOLBOX_CARTOGRAPHY_CONTINENTS,
  type ToolboxCartographyMask,
} from "./toolbox-cartography-data.js";

const MAX_INDEXED_CELLS = 65_536;
const GEOMETRY_EPSILON = 1e-4;
const MAP_BOUNDARY_SLACK_CELLS = 1;
const TOOLBOX_BAKED_REVEAL_RADIUS = 1;

type Point = Readonly<{ x: number; y: number }>;

export type CartographyCellRevealability = Readonly<{
  groundCellCount: number;
  /**
   * True means the loaded map has ground within reveal range. False means the
   * cell is globally creditable according to Toolbox++ but not from known
   * current-map ground. Null means explored-state UI should show no marker.
   */
  canCurrentMapReveal(
    cellX: number,
    cellY: number,
  ): boolean | null;
}>;

function sample(mask: ToolboxCartographyMask, x: number, y: number): boolean {
  const localX = x - mask.x0;
  const localY = y - mask.y0;
  if (localX < 0 || localY < 0 || localX >= mask.width || localY >= mask.height) {
    return false;
  }
  const bit = localY * mask.width + localX;
  return ((mask.bits[bit >>> 3]! >>> (bit & 7)) & 1) === 1;
}

function key(x: number, y: number): string {
  return `${x}:${y}`;
}

function clip(
  polygon: readonly Point[],
  inside: (point: Point) => boolean,
  intersection: (from: Point, to: Point) => Point,
): Point[] {
  if (polygon.length === 0) return [];
  const output: Point[] = [];
  let from = polygon.at(-1)!;
  let fromInside = inside(from);
  for (const to of polygon) {
    const toInside = inside(to);
    if (toInside !== fromInside) output.push(intersection(from, to));
    if (toInside) output.push(to);
    from = to;
    fromInside = toInside;
  }
  return output;
}

function clippedArea(
  trapezoid: PathingSpikeTrapezoid,
  left: number,
  bottom: number,
  right: number,
  top: number,
): number {
  let polygon: readonly Point[] = [
    { x: trapezoid.topLeftX, y: trapezoid.topY },
    { x: trapezoid.topRightX, y: trapezoid.topY },
    { x: trapezoid.bottomRightX, y: trapezoid.bottomY },
    { x: trapezoid.bottomLeftX, y: trapezoid.bottomY },
  ];
  polygon = clip(polygon, ({ x }) => x >= left, (from, to) => {
    const ratio = (left - from.x) / (to.x - from.x);
    return { x: left, y: from.y + (to.y - from.y) * ratio };
  });
  polygon = clip(polygon, ({ x }) => x <= right, (from, to) => {
    const ratio = (right - from.x) / (to.x - from.x);
    return { x: right, y: from.y + (to.y - from.y) * ratio };
  });
  polygon = clip(polygon, ({ y }) => y >= bottom, (from, to) => {
    const ratio = (bottom - from.y) / (to.y - from.y);
    return { x: from.x + (to.x - from.x) * ratio, y: bottom };
  });
  polygon = clip(polygon, ({ y }) => y <= top, (from, to) => {
    const ratio = (top - from.y) / (to.y - from.y);
    return { x: from.x + (to.x - from.x) * ratio, y: top };
  });
  let twiceArea = 0;
  for (let index = 0; index < polygon.length; index += 1) {
    const current = polygon[index]!;
    const next = polygon[(index + 1) % polygon.length]!;
    twiceArea += current.x * next.y - next.x * current.y;
  }
  return Math.abs(twiceArea) / 2;
}

/** Build one immutable lookup per pathing generation and world-map anchor. */
export function createCartographyCellRevealability(input: Readonly<{
  geometry: readonly PathingSpikeTrapezoid[];
  worldAnchorX: number;
  worldAnchorY: number;
  continent: number;
  mapMinX: number;
  mapMinY: number;
  mapMaxX: number;
  mapMaxY: number;
  revealRadius: 1 | 3;
}>): CartographyCellRevealability | null {
  if (
    input.geometry.length === 0
    || !Number.isFinite(input.worldAnchorX)
    || !Number.isFinite(input.worldAnchorY)
    || !Number.isSafeInteger(input.continent)
    || ![input.mapMinX, input.mapMinY, input.mapMaxX, input.mapMaxY].every(Number.isFinite)
    || input.mapMaxX <= input.mapMinX
    || input.mapMaxY <= input.mapMinY
  ) return null;
  const continent = TOOLBOX_CARTOGRAPHY_CONTINENTS.find(
    ({ id }) => id === input.continent,
  );
  if (!continent) return null;
  const ground = new Set<string>();
  const groundCells: Point[] = [];
  const gameUnitsPerCell = CARTOGRAPHY_CELL_MAP_UNITS * GAME_UNITS_PER_MAP_UNIT;

  const mapX = (gameX: number) => input.worldAnchorX + gameX / GAME_UNITS_PER_MAP_UNIT;
  const mapY = (gameY: number) => input.worldAnchorY - gameY / GAME_UNITS_PER_MAP_UNIT;
  for (const trapezoid of input.geometry) {
    const values = Object.values(trapezoid);
    if (!values.every(Number.isFinite)) return null;
    const xs = [mapX(trapezoid.topLeftX), mapX(trapezoid.topRightX),
      mapX(trapezoid.bottomRightX), mapX(trapezoid.bottomLeftX)];
    const ys = [mapY(trapezoid.topY), mapY(trapezoid.topY),
      mapY(trapezoid.bottomY), mapY(trapezoid.bottomY)];
    const firstX = Math.floor(Math.min(...xs) / CARTOGRAPHY_CELL_MAP_UNITS);
    const lastX = Math.floor((Math.max(...xs) - GEOMETRY_EPSILON)
      / CARTOGRAPHY_CELL_MAP_UNITS);
    const firstY = Math.floor(Math.min(...ys) / CARTOGRAPHY_CELL_MAP_UNITS);
    const lastY = Math.floor((Math.max(...ys) - GEOMETRY_EPSILON)
      / CARTOGRAPHY_CELL_MAP_UNITS);
    if (![firstX, lastX, firstY, lastY].every(Number.isSafeInteger)) return null;
    const candidates = (lastX - firstX + 1) * (lastY - firstY + 1);
    // The native pathing collection includes zero-area seam records. They
    // contain no walkable surface and must not poison the complete map index.
    if (candidates <= 0) continue;
    if (candidates > MAX_INDEXED_CELLS) return null;
    for (let cellY = firstY; cellY <= lastY; cellY += 1) {
      for (let cellX = firstX; cellX <= lastX; cellX += 1) {
        const gameLeft = (cellX * CARTOGRAPHY_CELL_MAP_UNITS - input.worldAnchorX)
          * GAME_UNITS_PER_MAP_UNIT;
        const gameRight = gameLeft + gameUnitsPerCell;
        const gameTop = (input.worldAnchorY - cellY * CARTOGRAPHY_CELL_MAP_UNITS)
          * GAME_UNITS_PER_MAP_UNIT;
        const gameBottom = gameTop - gameUnitsPerCell;
        if (clippedArea(
          trapezoid,
          gameLeft,
          gameBottom,
          gameRight,
          gameTop,
        ) > GEOMETRY_EPSILON) {
          const groundKey = key(cellX, cellY);
          if (!ground.has(groundKey)) {
            ground.add(groundKey);
            groundCells.push({ x: cellX, y: cellY });
          }
          if (ground.size > MAX_INDEXED_CELLS) return null;
        }
      }
    }
  }
  if (ground.size === 0) return null;
  const firstMapCellX = Math.floor(input.mapMinX / CARTOGRAPHY_CELL_MAP_UNITS);
  const firstMapCellY = Math.floor(input.mapMinY / CARTOGRAPHY_CELL_MAP_UNITS);
  const lastMapCellX = Math.ceil(input.mapMaxX / CARTOGRAPHY_CELL_MAP_UNITS) - 1;
  const lastMapCellY = Math.ceil(input.mapMaxY / CARTOGRAPHY_CELL_MAP_UNITS) - 1;
  const firstCreditableCellX = firstMapCellX - MAP_BOUNDARY_SLACK_CELLS;
  const firstCreditableCellY = firstMapCellY - MAP_BOUNDARY_SLACK_CELLS;
  const lastCreditableCellX = lastMapCellX + MAP_BOUNDARY_SLACK_CELLS;
  const lastCreditableCellY = lastMapCellY + MAP_BOUNDARY_SLACK_CELLS;
  const currentCreditable = new Set<string>();
  for (const cell of groundCells) {
    for (let dy = -input.revealRadius; dy <= input.revealRadius; dy += 1) {
      for (let dx = -input.revealRadius; dx <= input.revealRadius; dx += 1) {
        const x = cell.x + dx;
        const y = cell.y + dy;
        if (
          x >= firstCreditableCellX && x <= lastCreditableCellX
          && y >= firstCreditableCellY && y <= lastCreditableCellY
        ) currentCreditable.add(key(x, y));
      }
    }
  }
  if (currentCreditable.size > MAX_INDEXED_CELLS) return null;
  const globallyCreditable = (cellX: number, cellY: number): boolean => {
    if (sample(continent.creditable, cellX, cellY)) return true;
    if (input.revealRadius <= TOOLBOX_BAKED_REVEAL_RADIUS) return false;
    for (let dy = -input.revealRadius; dy <= input.revealRadius; dy += 1) {
      for (let dx = -input.revealRadius; dx <= input.revealRadius; dx += 1) {
        if (
          Math.max(Math.abs(dx), Math.abs(dy)) > TOOLBOX_BAKED_REVEAL_RADIUS
          && sample(continent.standable, cellX + dx, cellY + dy)
        ) return true;
      }
    }
    return false;
  };

  return Object.freeze({
    groundCellCount: ground.size,
    canCurrentMapReveal(cellX, cellY) {
      if (!Number.isSafeInteger(cellX) || !Number.isSafeInteger(cellY)) return null;
      if (
        cellX < firstCreditableCellX || cellX > lastCreditableCellX
        || cellY < firstCreditableCellY || cellY > lastCreditableCellY
      ) return null;
      if (currentCreditable.has(key(cellX, cellY))) return true;
      return globallyCreditable(cellX, cellY) ? false : null;
    },
  });
}
