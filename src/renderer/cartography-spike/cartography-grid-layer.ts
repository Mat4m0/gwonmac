/**
 * Owns the Cartography grid drawn above a certified native-map projection.
 * Both map surfaces share its cells, markers, range outlines, and redraw cache.
 */
import type {
  CartographyGridStyle,
  CartographyUnseenMarker,
} from "../../shared/cartography-overlay.js";
import {
  cartographyGridStyleFingerprint,
  drawUnseenCellMarker,
  strokeCasedPath,
  type CellCorners,
} from "./cartography-paint.js";
import {
  CARTOGRAPHY_CELL_MAP_UNITS,
  type CartographyCell,
  type CartographyGridProjection,
  type CartographyRevealRadius,
} from "./cartography-grid-projection.js";

const MIN_CELL_PIXELS = 8;
const UNSEEN_MARKER_CELL_PIXELS = 18;
const MAX_MARKED_CELLS = 4_096;

export type CartographyGridLayerSnapshot = Readonly<{
  surface: "compass" | "mission-map";
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
  otherRouteCount: number;
  drawCount: number;
}>;

export type CartographyGridLayer = Readonly<{
  update(input: Readonly<{
    projection: CartographyGridProjection;
    style: CartographyGridStyle;
    opacity: number;
    explorationVersion: string;
    isExplored(cellX: number, cellY: number): boolean | null;
    revealabilityVersion: string;
    canCurrentMapReveal(cellX: number, cellY: number): boolean | null;
    hoveredCell: CartographyCell | null;
    revealRadius: CartographyRevealRadius;
  }>): void;
  snapshot(): CartographyGridLayerSnapshot | null;
  hide(): void;
  dispose(): void;
}>;

export type CartographyCellPresentation = Readonly<{
  marker: CartographyUnseenMarker;
  tone: "unseen" | "other-route";
}>;

/** Only unexplored, current-map-relevant cells receive guidance. */
export function cartographyCellPresentation(
  explored: boolean | null,
  canCurrentMapReveal: boolean | null,
  unseenMarker: CartographyUnseenMarker,
): CartographyCellPresentation | null {
  if (explored !== false || canCurrentMapReveal === null) return null;
  return Object.freeze(canCurrentMapReveal
    ? { marker: unseenMarker, tone: "unseen" }
    : { marker: "hatch", tone: "other-route" });
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

export function createCartographyGridLayer(parent: HTMLElement, id: string): CartographyGridLayer {
  const document = parent.ownerDocument;
  const root = document.createElement("div");
  root.id = id;
  root.setAttribute("aria-hidden", "true");
  root.style.cssText = [
    "position:fixed", "z-index:9", "display:none", "overflow:hidden",
    "pointer-events:none", "user-select:none",
  ].join(";");
  const canvas = document.createElement("canvas");
  canvas.style.cssText = "position:absolute;inset:0;width:100%;height:100%;pointer-events:none";
  root.append(canvas);
  parent.append(root);
  const context = canvas.getContext("2d");
  let drawingVersion = "";
  let drawCount = 0;
  let latest: CartographyGridLayerSnapshot | null = null;

  const hide = () => {
    root.style.display = "none";
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
    canCurrentMapReveal: (cellX: number, cellY: number) => boolean | null,
    hoveredCell: CartographyCell | null,
    revealRadius: CartographyRevealRadius,
  ): Readonly<{ otherRouteCount: number }> | null => {
    if (context === null) return null;
    const dpr = document.defaultView?.devicePixelRatio ?? 1;
    const width = Math.max(1, Math.round(projection.box.width * dpr));
    const height = Math.max(1, Math.round(projection.box.height * dpr));
    sizeCanvas(canvas, width, height);
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.clearRect(0, 0, width, height);
    context.save();
    context.scale(dpr, dpr);
    clip(context, projection);
    const strength = opacity / 100;
    const minX = projection.firstCellX * CARTOGRAPHY_CELL_MAP_UNITS;
    const maxX = (projection.lastCellX + 1) * CARTOGRAPHY_CELL_MAP_UNITS;
    const minY = projection.firstCellY * CARTOGRAPHY_CELL_MAP_UNITS;
    const maxY = (projection.lastCellY + 1) * CARTOGRAPHY_CELL_MAP_UNITS;
    const focusCell = hoveredCell ?? projection.currentCell;
    let otherRouteCount = 0;

    context.beginPath();
    for (let cellX = projection.firstCellX; cellX <= projection.lastCellX + 1; cellX += 1) {
      const from = projectedPoint(projection, cellX * CARTOGRAPHY_CELL_MAP_UNITS, minY);
      const to = projectedPoint(projection, cellX * CARTOGRAPHY_CELL_MAP_UNITS, maxY);
      context.moveTo(from.x, from.y);
      context.lineTo(to.x, to.y);
    }
    for (let cellY = projection.firstCellY; cellY <= projection.lastCellY + 1; cellY += 1) {
      const from = projectedPoint(projection, minX, cellY * CARTOGRAPHY_CELL_MAP_UNITS);
      const to = projectedPoint(projection, maxX, cellY * CARTOGRAPHY_CELL_MAP_UNITS);
      context.moveTo(from.x, from.y);
      context.lineTo(to.x, to.y);
    }
    strokeCasedPath(
      context,
      style.lattice,
      style.casingColor,
      strength * (projection.surface === "compass" ? 0.72 : 0.82),
    );

    if (revealRadius > 0) {
      cellRangePolygon(context, projection, focusCell, 1);
      strokeCasedPath(context, style.normalRange, style.casingColor, Math.min(1, strength * 1.2));
    }
    if (revealRadius === 3) {
      cellRangePolygon(context, projection, focusCell, 3);
      strokeCasedPath(context, style.birdsEyeRange, style.casingColor, Math.min(1, strength * 1.1));
    }

    const visibleCellCount = (projection.lastCellX - projection.firstCellX + 1)
      * (projection.lastCellY - projection.firstCellY + 1);
    if (
      projection.surface === "mission-map"
      && Math.min(cellWidthPixels, cellHeightPixels) >= UNSEEN_MARKER_CELL_PIXELS
      && visibleCellCount <= MAX_MARKED_CELLS
    ) {
      for (let cellY = projection.firstCellY; cellY <= projection.lastCellY; cellY += 1) {
        for (let cellX = projection.firstCellX; cellX <= projection.lastCellX; cellX += 1) {
          const explored = isExplored(cellX, cellY);
          const revealable = explored === null
            ? null
            : canCurrentMapReveal(cellX, cellY);
          const presentation = cartographyCellPresentation(
            explored,
            revealable,
            style.unseen.marker,
          );
          if (presentation === null) continue;
          if (presentation.tone === "other-route") otherRouteCount += 1;
          const color = presentation.tone === "unseen"
            ? style.unseen.color
            : style.noWalkableColor;
          drawUnseenCellMarker(
            context,
            presentation.marker,
            cornersForCell(projection, cellX, cellY),
            color,
            style.casingColor,
            Math.min(1, strength * 1.25),
            Math.min(cellWidthPixels, cellHeightPixels),
          );
        }
      }
    }

    polygon(context, cornersForCell(projection, projection.currentCell.x, projection.currentCell.y));
    strokeCasedPath(context, style.current, style.casingColor, Math.min(1, strength * 1.25));
    if (hoveredCell !== null) {
      polygon(context, cornersForCell(projection, hoveredCell.x, hoveredCell.y));
      strokeCasedPath(context, style.hover, style.casingColor, Math.min(1, strength * 1.25));
    }
    context.restore();
    drawCount += 1;
    return Object.freeze({ otherRouteCount });
  };

  return Object.freeze({
    update({
      projection,
      style,
      opacity,
      explorationVersion,
      isExplored,
      revealabilityVersion,
      canCurrentMapReveal,
      hoveredCell,
      revealRadius,
    }) {
      const { box, transform } = projection;
      const cellWidthPixels = Math.hypot(transform.a, transform.b) * CARTOGRAPHY_CELL_MAP_UNITS;
      const cellHeightPixels = Math.hypot(transform.c, transform.d) * CARTOGRAPHY_CELL_MAP_UNITS;
      if (
        opacity <= 0 || !Number.isFinite(cellWidthPixels) || !Number.isFinite(cellHeightPixels)
        || Math.min(cellWidthPixels, cellHeightPixels) < MIN_CELL_PIXELS
      ) {
        hide();
        return;
      }
      root.style.left = `${box.left}px`;
      root.style.top = `${box.top}px`;
      root.style.width = `${box.width}px`;
      root.style.height = `${box.height}px`;
      const nextVersion = [
        projectionFingerprint(projection),
        document.defaultView?.devicePixelRatio ?? 1,
        cartographyGridStyleFingerprint(style), opacity, explorationVersion,
        revealabilityVersion,
        hoveredCell?.x ?? "-", hoveredCell?.y ?? "-", revealRadius,
      ].join(":");
      let otherRouteCount = latest?.otherRouteCount ?? 0;
      if (nextVersion !== drawingVersion) {
        const drawn = draw(
          projection,
          style,
          opacity,
          cellWidthPixels,
          cellHeightPixels,
          isExplored,
          canCurrentMapReveal,
          hoveredCell,
          revealRadius,
        );
        if (drawn === null) {
          hide();
          return;
        }
        otherRouteCount = drawn.otherRouteCount;
      }
      drawingVersion = nextVersion;
      root.style.display = "block";
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
        otherRouteCount,
        drawCount,
      });
    },
    snapshot: () => latest,
    hide,
    dispose() {
      root.remove();
      latest = null;
    },
  });
}
