/**
 * Draws the generated cartography grid above either native map surface. The
 * canvas is pointer-transparent, redraws only when projection state changes,
 * and hides before sub-pixel lines can turn into visual noise.
 */
import type { CartographyOverlayStyle } from "../../shared/cartography-overlay.js";
import {
  CARTOGRAPHY_CELL_MAP_UNITS,
  type CartographyGridProjection,
} from "./cartography-grid-projection.js";

const MIN_CELL_PIXELS = 8;
const CENTER_MARKER_CELL_PIXELS = 18;

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
  drawCount: number;
}>;

export type CartographyGridLayer = Readonly<{
  update(input: Readonly<{
    projection: CartographyGridProjection;
    style: CartographyOverlayStyle;
    opacity: number;
    explorationVersion: string;
    isExplored(cellX: number, cellY: number): boolean | null;
  }>): void;
  snapshot(): CartographyGridLayerSnapshot | null;
  hide(): void;
  dispose(): void;
}>;

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
  return {
    x: a * mapX + c * mapY + e,
    y: b * mapX + d * mapY + f,
  };
}

function clip(
  context: CanvasRenderingContext2D,
  projection: CartographyGridProjection,
): void {
  context.beginPath();
  if (projection.clip.kind === "circle") {
    context.arc(
      projection.clip.centerX,
      projection.clip.centerY,
      projection.clip.radius,
      0,
      Math.PI * 2,
    );
  } else {
    context.rect(0, 0, projection.box.width, projection.box.height);
  }
  context.clip();
}

function cellPolygon(
  context: CanvasRenderingContext2D,
  projection: CartographyGridProjection,
  cellX: number,
  cellY: number,
): void {
  const left = cellX * CARTOGRAPHY_CELL_MAP_UNITS;
  const top = cellY * CARTOGRAPHY_CELL_MAP_UNITS;
  const right = left + CARTOGRAPHY_CELL_MAP_UNITS;
  const bottom = top + CARTOGRAPHY_CELL_MAP_UNITS;
  const corners = [
    projectedPoint(projection, left, top),
    projectedPoint(projection, right, top),
    projectedPoint(projection, right, bottom),
    projectedPoint(projection, left, bottom),
  ];
  context.beginPath();
  context.moveTo(corners[0]!.x, corners[0]!.y);
  for (const corner of corners.slice(1)) context.lineTo(corner.x, corner.y);
  context.closePath();
}

export function createCartographyGridLayer(
  parent: HTMLElement,
  id: string,
): CartographyGridLayer {
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
    style: CartographyOverlayStyle,
    opacity: number,
    cellWidthPixels: number,
    cellHeightPixels: number,
    isExplored: (cellX: number, cellY: number) => boolean | null,
  ): boolean => {
    if (context === null) return false;
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
    const outlineVisible = style.outlineWidth > 0;

    context.fillStyle = style.veilColor;
    context.globalAlpha = strength * 0.2;
    for (let cellY = projection.firstCellY; cellY <= projection.lastCellY; cellY += 1) {
      for (let cellX = projection.firstCellX; cellX <= projection.lastCellX; cellX += 1) {
        if (isExplored(cellX, cellY) !== false) continue;
        cellPolygon(context, projection, cellX, cellY);
        context.fill();
      }
    }

    context.strokeStyle = style.outlineColor;
    context.lineWidth = Math.max(1, style.outlineWidth);
    context.globalAlpha = outlineVisible
      ? strength * (projection.surface === "compass" ? 0.34 : 0.44)
      : 0;
    context.beginPath();
    for (let cellX = projection.firstCellX; cellX <= projection.lastCellX + 1; cellX += 1) {
      const from = projectedPoint(
        projection,
        cellX * CARTOGRAPHY_CELL_MAP_UNITS,
        minY,
      );
      const to = projectedPoint(
        projection,
        cellX * CARTOGRAPHY_CELL_MAP_UNITS,
        maxY,
      );
      context.moveTo(from.x, from.y);
      context.lineTo(to.x, to.y);
    }
    for (let cellY = projection.firstCellY; cellY <= projection.lastCellY + 1; cellY += 1) {
      const from = projectedPoint(
        projection,
        minX,
        cellY * CARTOGRAPHY_CELL_MAP_UNITS,
      );
      const to = projectedPoint(
        projection,
        maxX,
        cellY * CARTOGRAPHY_CELL_MAP_UNITS,
      );
      context.moveTo(from.x, from.y);
      context.lineTo(to.x, to.y);
    }
    context.stroke();

    if (
      projection.surface === "mission-map"
      && Math.min(cellWidthPixels, cellHeightPixels) >= CENTER_MARKER_CELL_PIXELS
      && (projection.lastCellX - projection.firstCellX + 1)
        * (projection.lastCellY - projection.firstCellY + 1) <= 4_096
    ) {
      const radius = Math.min(
        4,
        Math.max(2.5, Math.min(cellWidthPixels, cellHeightPixels) * 0.08),
      );
      context.lineCap = "round";
      for (let cellY = projection.firstCellY; cellY <= projection.lastCellY; cellY += 1) {
        for (let cellX = projection.firstCellX; cellX <= projection.lastCellX; cellX += 1) {
          if (isExplored(cellX, cellY) !== false) continue;
          const center = projectedPoint(
            projection,
            (cellX + 0.5) * CARTOGRAPHY_CELL_MAP_UNITS,
            (cellY + 0.5) * CARTOGRAPHY_CELL_MAP_UNITS,
          );
          context.beginPath();
          context.moveTo(center.x - radius, center.y - radius);
          context.lineTo(center.x + radius, center.y + radius);
          context.moveTo(center.x + radius, center.y - radius);
          context.lineTo(center.x - radius, center.y + radius);
          context.strokeStyle = style.veilColor;
          context.lineWidth = 4;
          context.globalAlpha = strength * 0.9;
          context.stroke();
          context.strokeStyle = style.outlineColor;
          context.lineWidth = 1.5;
          context.globalAlpha = strength;
          context.stroke();
        }
      }
    }

    cellPolygon(
      context,
      projection,
      projection.currentCell.x,
      projection.currentCell.y,
    );
    context.fillStyle = style.veilColor;
    context.globalAlpha = strength * 0.22;
    context.fill();
    context.strokeStyle = style.outlineColor;
    context.lineWidth = Math.max(1, style.outlineWidth + 1);
    context.globalAlpha = outlineVisible ? strength * 0.95 : 0;
    context.stroke();
    context.restore();
    drawCount += 1;
    return true;
  };

  return Object.freeze({
    update({ projection, style, opacity, explorationVersion, isExplored }) {
      const { box, transform } = projection;
      const cellWidthPixels = Math.hypot(transform.a, transform.b)
        * CARTOGRAPHY_CELL_MAP_UNITS;
      const cellHeightPixels = Math.hypot(transform.c, transform.d)
        * CARTOGRAPHY_CELL_MAP_UNITS;
      if (
        opacity <= 0
        || !Number.isFinite(cellWidthPixels)
        || !Number.isFinite(cellHeightPixels)
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
        projection.surface,
        (document.defaultView?.devicePixelRatio ?? 1).toFixed(2),
        box.width.toFixed(2), box.height.toFixed(2),
        transform.a.toFixed(6), transform.b.toFixed(6),
        transform.c.toFixed(6), transform.d.toFixed(6),
        transform.e.toFixed(4), transform.f.toFixed(4),
        projection.firstCellX, projection.lastCellX,
        projection.firstCellY, projection.lastCellY,
        projection.currentCell.x, projection.currentCell.y,
        style.veilColor, style.outlineColor, style.outlineWidth, opacity,
        explorationVersion,
      ].join(":");
      if (
        nextVersion !== drawingVersion
        && !draw(
          projection,
          style,
          opacity,
          cellWidthPixels,
          cellHeightPixels,
          isExplored,
        )
      ) {
        hide();
        return;
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
