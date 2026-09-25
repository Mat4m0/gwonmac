/**
 * Owns the Cartography grid drawn above a certified native-map projection.
 * Both map surfaces share its cells, markers, range outlines, reach guide, and
 * redraw cache.
 */
import type {
  CartographyGridStyle,
  CartographyUnseenMarker,
} from "../../shared/cartography-overlay.js";
import {
  cartographyGridStyleFingerprint,
  cartographyLineDash,
  drawUnseenCellMarker,
  lineBetween,
  strokeCasedPath,
  type CellCorners,
} from "./cartography-paint.js";
import {
  CARTOGRAPHY_CELL_MAP_UNITS,
  type CartographyCell,
  type CartographyGridProjection,
  type CartographyRevealRadius,
} from "./cartography-grid-projection.js";

const MIN_GRID_CELL_PIXELS = 8;
const MIN_PROGRESS_CELL_PIXELS = 1.5;
const UNSEEN_MARKER_CELL_PIXELS = 18;
const MAX_MARKED_CELLS = 4_096;
const MAX_REACH_CELLS = MAX_MARKED_CELLS * 16;
const ESTIMATED_COLOR = "#E2AE3E";

export type CartographyProgressClusterSize = 1 | 4 | 16;

export type CartographyClusterPresentation = Readonly<{
  count: number;
  source: "current" | "remembered" | "estimate";
}>;

/** Prefer exact live or remembered map knowledge over the continent estimate. */
export function cartographyClusterPresentation(input: Readonly<{
  estimatedRemaining: number;
  currentKnown: number;
  currentRemaining: number;
  rememberedKnown: number;
  rememberedRemaining: number;
}>): CartographyClusterPresentation | null {
  if (input.estimatedRemaining === 0) return null;
  if (input.currentKnown > 0) {
    return input.currentRemaining > 0
      ? Object.freeze({ count: input.currentRemaining, source: "current" as const })
      : null;
  }
  if (input.rememberedKnown > 0) {
    return input.rememberedRemaining > 0
      ? Object.freeze({ count: input.rememberedRemaining, source: "remembered" as const })
      : null;
  }
  return Object.freeze({ count: input.estimatedRemaining, source: "estimate" as const });
}

/** Stable level of detail for one projected cartography cell. */
export function cartographyProgressClusterSize(
  cellPixels: number,
): CartographyProgressClusterSize {
  if (cellPixels >= UNSEEN_MARKER_CELL_PIXELS) return 1;
  if (cellPixels >= MIN_GRID_CELL_PIXELS) return 4;
  return 16;
}

/** Global cluster origin; it never depends on the current viewport. */
export function cartographyProgressClusterOrigin(
  cell: CartographyCell,
  size: CartographyProgressClusterSize,
): CartographyCell {
  return Object.freeze({
    x: Math.floor(cell.x / size) * size,
    y: Math.floor(cell.y / size) * size,
  });
}

export type CartographyGridLayerSnapshot = Readonly<{
  surface: "compass" | "mission-map" | "world-map";
  currentCellX: number;
  currentCellY: number;
  cellWidthPixels: number;
  cellHeightPixels: number;
  firstCellX: number;
  lastCellX: number;
  firstCellY: number;
  lastCellY: number;
  focusCellX: number;
  focusCellY: number;
  revealRadius: CartographyRevealRadius;
  hovering: boolean;
  drawCount: number;
}>;

export type CartographyGridLayer = Readonly<{
  update(input: Readonly<{
    projection: CartographyGridProjection;
    style: CartographyGridStyle;
    opacity: number;
    explorationVersion: string;
    isExplored(cellX: number, cellY: number): boolean | null;
    isRemaining(cellX: number, cellY: number): boolean | null;
    revealabilityVersion: string;
    canCurrentMapReveal(cellX: number, cellY: number): boolean | null;
    canVisitedMapReveal(cellX: number, cellY: number): boolean | null;
    hoveredCell: CartographyCell | null;
    revealRadius: CartographyRevealRadius;
    reachRadius: CartographyRevealRadius;
  }>): void;
  image(): Readonly<{ canvas: HTMLCanvasElement; version: string }> | null;
  snapshot(): CartographyGridLayerSnapshot | null;
  hide(): void;
  dispose(): void;
}>;

export type CartographyCellPresentation = Readonly<{
  marker: CartographyUnseenMarker;
}>;

/** Only unexplored, current-map-relevant cells receive guidance. */
export function cartographyCellPresentation(
  explored: boolean | null,
  canCurrentMapReveal: boolean | null,
  unseenMarker: CartographyUnseenMarker,
): CartographyCellPresentation | null {
  if (explored !== false || canCurrentMapReveal !== true) return null;
  return Object.freeze({ marker: unseenMarker });
}

export type CartographyCellBounds = Readonly<{
  firstX: number;
  lastX: number;
  firstY: number;
  lastY: number;
}>;

export type CartographyRevealCounts = Readonly<{
  /** Remaining cells revealed by standing in this cell; zero is out of reach. */
  count(cellX: number, cellY: number): number;
}>;

/**
 * Counts, for every standing cell, the marked cells inside its reveal square.
 * Marked cells up to `radius` outside `bounds` count, so values stay stable
 * across tile and viewport borders.
 */
export function cartographyRevealCounts(
  bounds: CartographyCellBounds,
  radius: 1 | 3,
  isMarked: (cellX: number, cellY: number) => boolean,
): CartographyRevealCounts {
  const width = bounds.lastX - bounds.firstX + 1;
  const height = bounds.lastY - bounds.firstY + 1;
  const scanWidth = width + radius * 2;
  const scanHeight = height + radius * 2;
  // Summed-area table: each square is four lookups.
  const sums = new Uint32Array((scanWidth + 1) * (scanHeight + 1));
  for (let row = 0; row < scanHeight; row += 1) {
    let rowSum = 0;
    for (let column = 0; column < scanWidth; column += 1) {
      if (isMarked(bounds.firstX - radius + column, bounds.firstY - radius + row)) rowSum += 1;
      sums[(row + 1) * (scanWidth + 1) + column + 1] = sums[row * (scanWidth + 1) + column + 1]! + rowSum;
    }
  }
  const side = radius * 2 + 1;
  return Object.freeze({
    count(cellX: number, cellY: number) {
      const x = cellX - bounds.firstX;
      const y = cellY - bounds.firstY;
      if (x < 0 || y < 0 || x >= width || y >= height) return 0;
      const at = (column: number, row: number) => sums[row * (scanWidth + 1) + column]!;
      return at(x + side, y + side) - at(x, y + side) - at(x + side, y) + at(x, y);
    },
  });
}

const REACH_HEAT_LEVELS = 5;

/** Reveal count at which a standing cell shows the strongest tint. */
function reachHeatSaturation(radius: 1 | 3): number {
  return radius === 1 ? 4 : 12;
}

/**
 * Answers "where do I stand?": cells are tinted by how many remaining cells
 * they reveal, a faint lattice lets the player count steps, and one thin
 * neutral outline separates the reach from cells that reveal nothing.
 */
function drawReachGuide(
  context: CanvasRenderingContext2D,
  projection: CartographyGridProjection,
  style: CartographyGridStyle,
  strength: number,
  radius: 1 | 3,
  counts: CartographyRevealCounts,
  lattice: boolean,
): void {
  const heat: CellCorners[][] = Array.from({ length: REACH_HEAT_LEVELS }, () => []);
  const saturation = reachHeatSaturation(radius);
  for (let cellY = projection.firstCellY; cellY <= projection.lastCellY; cellY += 1) {
    for (let cellX = projection.firstCellX; cellX <= projection.lastCellX; cellX += 1) {
      const count = counts.count(cellX, cellY);
      if (count === 0) continue;
      const level = Math.min(REACH_HEAT_LEVELS, Math.ceil(count / saturation * REACH_HEAT_LEVELS)) - 1;
      heat[level]!.push(cornersForCell(projection, cellX, cellY));
    }
  }
  context.save();
  context.fillStyle = style.unseen.color;
  heat.forEach((cells, level) => {
    if (cells.length === 0) return;
    context.globalAlpha = Math.max(0, Math.min(1, strength * (0.05 + 0.2 * (level + 1) / REACH_HEAT_LEVELS)));
    context.beginPath();
    for (const corners of cells) {
      context.moveTo(corners[0].x, corners[0].y);
      for (const corner of corners.slice(1)) context.lineTo(corner.x, corner.y);
      context.closePath();
    }
    context.fill();
  });
  context.restore();

  const inner: number[] = [];
  const outline: number[] = [];
  const edge = (fromX: number, fromY: number, toX: number, toY: number, a: number, b: number) => {
    if (a === 0 && b === 0) return;
    (a > 0 && b > 0 ? inner : outline).push(fromX, fromY, toX, toY);
  };
  for (let cellY = projection.firstCellY; cellY <= projection.lastCellY; cellY += 1) {
    for (let cellX = projection.firstCellX; cellX <= projection.lastCellX + 1; cellX += 1) {
      edge(cellX, cellY, cellX, cellY + 1, counts.count(cellX - 1, cellY), counts.count(cellX, cellY));
    }
  }
  for (let cellY = projection.firstCellY; cellY <= projection.lastCellY + 1; cellY += 1) {
    for (let cellX = projection.firstCellX; cellX <= projection.lastCellX; cellX += 1) {
      edge(cellX, cellY, cellX + 1, cellY, counts.count(cellX, cellY - 1), counts.count(cellX, cellY));
    }
  }
  const segments = (points: readonly number[]) => {
    context.beginPath();
    for (let index = 0; index < points.length; index += 4) {
      const from = projectedPoint(projection, points[index]! * CARTOGRAPHY_CELL_MAP_UNITS,
        points[index + 1]! * CARTOGRAPHY_CELL_MAP_UNITS);
      const to = projectedPoint(projection, points[index + 2]! * CARTOGRAPHY_CELL_MAP_UNITS,
        points[index + 3]! * CARTOGRAPHY_CELL_MAP_UNITS);
      lineBetween(context, from, to);
    }
  };
  if (lattice && style.lattice.width > 0 && inner.length > 0) {
    context.save();
    context.globalAlpha = Math.max(0, Math.min(1, strength * 0.3));
    context.lineCap = "butt";
    context.strokeStyle = style.lattice.color;
    context.lineWidth = 1;
    context.setLineDash([...cartographyLineDash(style.lattice.pattern, 1)]);
    segments(inner);
    context.stroke();
    context.restore();
  }
  if (outline.length > 0) {
    // Neutral on purpose: cyan and magenta belong to hover inspection.
    segments(outline);
    strokeCasedPath(context, { color: style.lattice.color, width: 1.5, pattern: "solid" },
      style.casingColor, Math.min(1, strength), 1.5);
  }
}

/** Labels a hover inspection with the number of remaining cells it reveals. */
function drawRevealBadge(
  context: CanvasRenderingContext2D,
  projection: CartographyGridProjection,
  focus: CartographyCell,
  radius: 1 | 3,
  count: number,
  style: CartographyGridStyle,
  strength: number,
): void {
  const corner = projectedPoint(projection,
    (focus.x + radius + 1) * CARTOGRAPHY_CELL_MAP_UNITS, (focus.y - radius) * CARTOGRAPHY_CELL_MAP_UNITS);
  const text = count > 0 ? `+${count}` : "0";
  context.save();
  context.globalAlpha = Math.max(0, Math.min(1, strength * 1.25));
  context.font = "600 11px system-ui, sans-serif";
  const width = Math.max(20, context.measureText(text).width + 10);
  const height = 16;
  // Straddle the corner like a notification badge so it never hides a marker.
  const left = corner.x - width / 2;
  const top = corner.y - height / 2;
  context.beginPath();
  context.roundRect(left - 1, top - 1, width + 2, height + 2, 9);
  context.fillStyle = style.casingColor;
  context.fill();
  context.beginPath();
  context.roundRect(left, top, width, height, 8);
  context.fillStyle = count > 0 ? style.unseen.color : style.casingColor;
  context.fill();
  context.fillStyle = count > 0 ? style.casingColor : style.lattice.color;
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillText(text, left + width / 2, top + height / 2 + 0.5);
  context.restore();
}

const NO_MARKER = 0;
const ESTIMATED_MARKER = 1;
const ACTIONABLE_MARKER = 2;

function drawClusterMarker(
  context: CanvasRenderingContext2D,
  projection: CartographyGridProjection,
  firstX: number,
  firstY: number,
  size: number,
  count: number,
  source: CartographyClusterPresentation["source"],
  actionableColor: string,
  casingColor: string,
  opacity: number,
): void {
  const left = firstX * CARTOGRAPHY_CELL_MAP_UNITS;
  const top = firstY * CARTOGRAPHY_CELL_MAP_UNITS;
  const right = (firstX + size) * CARTOGRAPHY_CELL_MAP_UNITS;
  const bottom = (firstY + size) * CARTOGRAPHY_CELL_MAP_UNITS;
  const topLeft = projectedPoint(projection, left, top);
  const bottomRight = projectedPoint(projection, right, bottom);
  const centerX = (topLeft.x + bottomRight.x) / 2;
  const centerY = (topLeft.y + bottomRight.y) / 2;
  const radius = Math.max(10, Math.min(18, Math.min(
    Math.abs(bottomRight.x - topLeft.x),
    Math.abs(bottomRight.y - topLeft.y),
  ) * 0.28));
  context.save();
  context.globalAlpha = Math.max(0, Math.min(1, opacity));
  context.beginPath();
  context.arc(centerX, centerY, radius + 2, 0, Math.PI * 2);
  context.fillStyle = casingColor;
  context.fill();
  context.beginPath();
  context.arc(centerX, centerY, radius, 0, Math.PI * 2);
  if (source === "current") {
    context.fillStyle = actionableColor;
    context.fill();
  } else {
    context.strokeStyle = source === "remembered" ? actionableColor : ESTIMATED_COLOR;
    context.lineWidth = 2;
    context.stroke();
  }
  context.fillStyle = source === "current"
    ? casingColor
    : source === "remembered" ? actionableColor : ESTIMATED_COLOR;
  context.font = "600 11px system-ui, sans-serif";
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillText(source === "estimate" ? `≈${count}` : String(count), centerX, centerY + 0.5);
  context.restore();
}

function sizeCanvas(canvas: HTMLCanvasElement, width: number, height: number): void {
  if (canvas.width !== width) canvas.width = width;
  if (canvas.height !== height) canvas.height = height;
}

function projectedPoint(
  projection: CartographyGridProjection,
  mapX: number,
  mapY: number,
): Readonly<{ x: number; y: number }> {
  const { a, b, c, d, e, f } = projection.transform;
  return { x: a * mapX + c * mapY + e, y: b * mapX + d * mapY + f };
}

function clip(context: CanvasRenderingContext2D, projection: CartographyGridProjection): void {
  context.beginPath();
  if (projection.clip.kind === "circle") {
    context.arc(projection.clip.centerX, projection.clip.centerY, projection.clip.radius, 0, Math.PI * 2);
  } else {
    context.rect(0, 0, projection.box.width, projection.box.height);
  }
  context.clip();
}

function cornersForCell(
  projection: CartographyGridProjection,
  cellX: number,
  cellY: number,
): CellCorners {
  const left = cellX * CARTOGRAPHY_CELL_MAP_UNITS;
  const top = cellY * CARTOGRAPHY_CELL_MAP_UNITS;
  const right = left + CARTOGRAPHY_CELL_MAP_UNITS;
  const bottom = top + CARTOGRAPHY_CELL_MAP_UNITS;
  return [
    projectedPoint(projection, left, top),
    projectedPoint(projection, right, top),
    projectedPoint(projection, right, bottom),
    projectedPoint(projection, left, bottom),
  ];
}

function polygon(context: CanvasRenderingContext2D, corners: CellCorners): void {
  context.beginPath();
  context.moveTo(corners[0].x, corners[0].y);
  for (const corner of corners.slice(1)) context.lineTo(corner.x, corner.y);
  context.closePath();
}

function cellRangePolygon(
  context: CanvasRenderingContext2D,
  projection: CartographyGridProjection,
  center: CartographyCell,
  radius: CartographyRevealRadius,
): void {
  const left = (center.x - radius) * CARTOGRAPHY_CELL_MAP_UNITS;
  const top = (center.y - radius) * CARTOGRAPHY_CELL_MAP_UNITS;
  const right = (center.x + radius + 1) * CARTOGRAPHY_CELL_MAP_UNITS;
  const bottom = (center.y + radius + 1) * CARTOGRAPHY_CELL_MAP_UNITS;
  polygon(context, [
    projectedPoint(projection, left, top),
    projectedPoint(projection, right, top),
    projectedPoint(projection, right, bottom),
    projectedPoint(projection, left, bottom),
  ]);
}

function projectionFingerprint(projection: CartographyGridProjection): string {
  const { box, transform } = projection;
  return [
    projection.surface, box.width, box.height,
    transform.a, transform.b, transform.c, transform.d, transform.e, transform.f,
    JSON.stringify(projection.clip),
    projection.firstCellX, projection.lastCellX,
    projection.firstCellY, projection.lastCellY,
    projection.currentCell.x, projection.currentCell.y,
  ].join(":");
}

export function createCartographyGridLayer(document: Document, inspectionOnly = false): CartographyGridLayer {
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");
  let drawingVersion = "";
  let drawCount = 0;
  let latest: CartographyGridLayerSnapshot | null = null;

  const hide = () => {
    drawingVersion = "";
    latest = null;
  };

  const draw = (
    projection: CartographyGridProjection,
    style: CartographyGridStyle,
    opacity: number,
    cellWidthPixels: number,
    cellHeightPixels: number,
    isExplored: (cellX: number, cellY: number) => boolean | null,
    isRemaining: (cellX: number, cellY: number) => boolean | null,
    canCurrentMapReveal: (cellX: number, cellY: number) => boolean | null,
    canVisitedMapReveal: (cellX: number, cellY: number) => boolean | null,
    hoveredCell: CartographyCell | null,
    revealRadius: CartographyRevealRadius,
    reachRadius: CartographyRevealRadius,
  ): boolean => {
    if (context === null) return false;
    const dpr = Math.min(document.defaultView?.devicePixelRatio ?? 1,
      2048 / Math.max(projection.box.width, projection.box.height));
    const width = Math.max(1, Math.round(projection.box.width * dpr));
    const height = Math.max(1, Math.round(projection.box.height * dpr));
    sizeCanvas(canvas, width, height);
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.clearRect(0, 0, width, height);
    context.save();
    context.scale(dpr, dpr);
    clip(context, projection);
    const strength = opacity / 100;
    const focusCell = hoveredCell ?? projection.currentCell;

    if (hoveredCell !== null && revealRadius > 0 && Math.min(cellWidthPixels, cellHeightPixels) >= MIN_GRID_CELL_PIXELS) {
      cellRangePolygon(context, projection, focusCell, 1);
      strokeCasedPath(context, style.normalRange, style.casingColor, Math.min(1, strength * 1.2));
    }
    const markerAt = (cellX: number, cellY: number): number => {
      const explored = isExplored(cellX, cellY);
      const revealable = explored === null
        ? null
        : canCurrentMapReveal(cellX, cellY);
      if (cartographyCellPresentation(explored, revealable, style.unseen.marker) !== null) {
        return ACTIONABLE_MARKER;
      }
      return projection.surface !== "compass" && isRemaining(cellX, cellY) === true && revealable !== true
        ? ESTIMATED_MARKER
        : NO_MARKER;
    };
    if (hoveredCell !== null && revealRadius === 3 && Math.min(cellWidthPixels, cellHeightPixels) >= MIN_GRID_CELL_PIXELS) {
      cellRangePolygon(context, projection, focusCell, 3);
      strokeCasedPath(context, style.birdsEyeRange, style.casingColor, Math.min(1, strength * 1.1));
    }
    if (
      inspectionOnly && hoveredCell !== null && revealRadius > 0 && projection.surface !== "compass"
      && Math.min(cellWidthPixels, cellHeightPixels) >= MIN_GRID_CELL_PIXELS
    ) {
      let revealed = 0;
      for (let cellY = focusCell.y - revealRadius; cellY <= focusCell.y + revealRadius; cellY += 1) {
        for (let cellX = focusCell.x - revealRadius; cellX <= focusCell.x + revealRadius; cellX += 1) {
          if (markerAt(cellX, cellY) !== NO_MARKER) revealed += 1;
        }
      }
      drawRevealBadge(context, projection, focusCell, revealRadius as 1 | 3, revealed, style, strength);
    }

    const visibleCellCount = (projection.lastCellX - projection.firstCellX + 1)
      * (projection.lastCellY - projection.firstCellY + 1);
    // Cached tiles include an offscreen margin. When that pushes detailed
    // markers over budget, retain guidance with clusters instead of a blank map.
    const detailed = visibleCellCount <= MAX_MARKED_CELLS
      && (projection.surface === "compass" || Math.min(cellWidthPixels, cellHeightPixels) >= UNSEEN_MARKER_CELL_PIXELS);
    const cellPixels = Math.min(cellWidthPixels, cellHeightPixels);
    // The reach guide reads real cells, so it also guides clustered zoom
    // levels; only the tint and outline remain once cells are too small for a lattice.
    const reach = reachRadius > 0 && projection.surface !== "compass"
      && cellPixels >= MIN_GRID_CELL_PIXELS && visibleCellCount <= MAX_REACH_CELLS;
    if (!inspectionOnly && (detailed || reach)) {
      // One marker pass feeds both the guide and the markers. The guide reads
      // one border cell beyond the tile, plus its own radius.
      const margin = reach ? reachRadius + 1 : 0;
      const scanFirstX = projection.firstCellX - margin;
      const scanFirstY = projection.firstCellY - margin;
      const scanWidth = projection.lastCellX - projection.firstCellX + 1 + margin * 2;
      const scanHeight = projection.lastCellY - projection.firstCellY + 1 + margin * 2;
      const markers = new Uint8Array(scanWidth * scanHeight);
      for (let row = 0; row < scanHeight; row += 1) {
        for (let column = 0; column < scanWidth; column += 1) {
          markers[row * scanWidth + column] = markerAt(scanFirstX + column, scanFirstY + row);
        }
      }
      const markerIn = (cellX: number, cellY: number): number => {
        const column = cellX - scanFirstX;
        const row = cellY - scanFirstY;
        return column < 0 || row < 0 || column >= scanWidth || row >= scanHeight
          ? NO_MARKER
          : markers[row * scanWidth + column]!;
      };
      if (reach) {
        drawReachGuide(context, projection, style, strength, reachRadius as 1 | 3, cartographyRevealCounts(
          {
            firstX: projection.firstCellX - 1,
            lastX: projection.lastCellX + 1,
            firstY: projection.firstCellY - 1,
            lastY: projection.lastCellY + 1,
          },
          reachRadius as 1 | 3,
          (cellX, cellY) => markerIn(cellX, cellY) !== NO_MARKER,
        ), cellPixels >= UNSEEN_MARKER_CELL_PIXELS);
      }
      if (detailed) {
        for (let cellY = projection.firstCellY; cellY <= projection.lastCellY; cellY += 1) {
          for (let cellX = projection.firstCellX; cellX <= projection.lastCellX; cellX += 1) {
            const marker = markerIn(cellX, cellY);
            if (marker === NO_MARKER) continue;
            const estimated = marker === ESTIMATED_MARKER;
            drawUnseenCellMarker(
              context,
              estimated ? "diamond" : style.unseen.marker,
              cornersForCell(projection, cellX, cellY),
              estimated ? ESTIMATED_COLOR : style.unseen.color,
              style.casingColor,
              Math.min(1, estimated ? strength : strength * 1.25),
              cellPixels,
            );
          }
        }
      }
    }

    if (
      !inspectionOnly && projection.surface !== "compass" && !detailed
    ) {
      const detailSize = cartographyProgressClusterSize(Math.min(cellWidthPixels, cellHeightPixels));
      const groupSize = detailSize === 16 || visibleCellCount > MAX_MARKED_CELLS * 16 ? 16 : 4;
      const firstGroup = cartographyProgressClusterOrigin(
        { x: projection.firstCellX, y: projection.firstCellY },
        groupSize,
      );
      const firstGroupX = firstGroup.x;
      const firstGroupY = firstGroup.y;
      for (let groupY = firstGroupY; groupY <= projection.lastCellY; groupY += groupSize) {
        for (let groupX = firstGroupX; groupX <= projection.lastCellX; groupX += groupSize) {
          let remainingCount = 0;
          let currentKnownCount = 0;
          let currentRemainingCount = 0;
          let rememberedKnownCount = 0;
          let rememberedRemainingCount = 0;
          for (let y = Math.max(groupY, projection.firstCellY);
            y <= Math.min(groupY + groupSize - 1, projection.lastCellY); y += 1) {
            for (let x = Math.max(groupX, projection.firstCellX);
              x <= Math.min(groupX + groupSize - 1, projection.lastCellX); x += 1) {
              const remaining = isRemaining(x, y) === true;
              const currentKnown = canCurrentMapReveal(x, y) === true;
              const rememberedKnown = canVisitedMapReveal(x, y) === true;
              if (remaining) remainingCount += 1;
              if (currentKnown) currentKnownCount += 1;
              if (remaining && currentKnown) currentRemainingCount += 1;
              if (rememberedKnown) rememberedKnownCount += 1;
              if (remaining && rememberedKnown) rememberedRemainingCount += 1;
            }
          }
          const cluster = cartographyClusterPresentation({
            estimatedRemaining: remainingCount,
            currentKnown: currentKnownCount,
            currentRemaining: currentRemainingCount,
            rememberedKnown: rememberedKnownCount,
            rememberedRemaining: rememberedRemainingCount,
          });
          if (cluster === null) continue;
          drawClusterMarker(
            context,
            projection,
            groupX,
            groupY,
            groupSize,
            cluster.count,
            cluster.source,
            style.unseen.color,
            style.casingColor,
            Math.min(1, strength * 1.2),
          );
        }
      }
    }

    if (hoveredCell !== null && Math.min(cellWidthPixels, cellHeightPixels) >= MIN_GRID_CELL_PIXELS) {
      polygon(context, cornersForCell(projection, hoveredCell.x, hoveredCell.y));
      strokeCasedPath(context, style.hover, style.casingColor, Math.min(1, strength * 1.25));
    }
    context.restore();
    drawCount += 1;
    return true;
  };

  return Object.freeze({
    update({
      projection,
      style,
      opacity,
      explorationVersion,
      isExplored,
      isRemaining,
      revealabilityVersion,
      canCurrentMapReveal,
      canVisitedMapReveal,
      hoveredCell,
      revealRadius,
      reachRadius,
    }) {
      const { transform } = projection;
      const cellWidthPixels = Math.hypot(transform.a, transform.b) * CARTOGRAPHY_CELL_MAP_UNITS;
      const cellHeightPixels = Math.hypot(transform.c, transform.d) * CARTOGRAPHY_CELL_MAP_UNITS;
      if (
        opacity <= 0 || !Number.isFinite(cellWidthPixels) || !Number.isFinite(cellHeightPixels)
        || Math.min(cellWidthPixels, cellHeightPixels) < (
          projection.surface === "compass" ? MIN_GRID_CELL_PIXELS : MIN_PROGRESS_CELL_PIXELS
        )
      ) {
        hide();
        return;
      }
      const nextVersion = [
        projectionFingerprint(projection),
        document.defaultView?.devicePixelRatio ?? 1,
        cartographyGridStyleFingerprint(style), opacity, explorationVersion,
        revealabilityVersion,
        hoveredCell?.x ?? "-", hoveredCell?.y ?? "-", revealRadius, reachRadius,
      ].join(":");
      if (nextVersion !== drawingVersion) {
        const drawn = draw(
          projection,
          style,
          opacity,
          cellWidthPixels,
          cellHeightPixels,
          isExplored,
          isRemaining,
          canCurrentMapReveal,
          canVisitedMapReveal,
          hoveredCell,
          revealRadius,
          reachRadius,
        );
        if (!drawn) {
          hide();
          return;
        }
      }
      drawingVersion = nextVersion;
      latest = Object.freeze({
        surface: projection.surface,
        currentCellX: projection.currentCell.x,
        currentCellY: projection.currentCell.y,
        cellWidthPixels,
        cellHeightPixels,
        firstCellX: projection.firstCellX,
        lastCellX: projection.lastCellX,
        firstCellY: projection.firstCellY,
        lastCellY: projection.lastCellY,
        focusCellX: (hoveredCell ?? projection.currentCell).x,
        focusCellY: (hoveredCell ?? projection.currentCell).y,
        revealRadius,
        hovering: hoveredCell !== null,
        drawCount,
      });
    },
    image: () => latest === null ? null : { canvas, version: drawingVersion },
    snapshot: () => latest,
    hide,
    dispose() {
      hide();
      canvas.width = 0; canvas.height = 0;
      latest = null;
    },
  });
}
