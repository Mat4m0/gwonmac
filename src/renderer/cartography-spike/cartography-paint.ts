/**
 * Owns the visual grammar shared by Cartography's Canvas layers.
 * Cased strokes, line patterns, and unseen-cell markers are painted only here.
 */
import type {
  CartographyColor,
  CartographyGridStyle,
  CartographyLinePattern,
  CartographyLineStyle,
  CartographyUnseenMarker,
  CartographyWalkabilityStyle,
} from "../../shared/cartography-overlay.js";

export type PaintPoint = Readonly<{ x: number; y: number }>;
export type CellCorners = readonly [PaintPoint, PaintPoint, PaintPoint, PaintPoint];
const styleFingerprints = new WeakMap<object, string>();

function styleFingerprint(style: object): string {
  const existing = styleFingerprints.get(style);
  if (existing !== undefined) return existing;
  const fingerprint = JSON.stringify(style);
  styleFingerprints.set(style, fingerprint);
  return fingerprint;
}

export function cartographyHoverRevealRadius(
  shiftHeld: boolean,
  optionHeld: boolean,
): 0 | 1 | 3 {
  return shiftHeld ? optionHeld ? 3 : 1 : 0;
}

export function cartographyLineDash(
  pattern: CartographyLinePattern,
  width: number,
): readonly number[] {
  const unit = Math.max(1, width);
  switch (pattern) {
    case "solid": return [];
    case "dashed": return [6 * unit, 4 * unit];
    case "dotted": return [unit, 3 * unit];
    case "dash-dot": return [6 * unit, 3 * unit, unit, 3 * unit];
  }
}

/** Stroke the current path twice without changing its semantic dash pattern. */
export function strokeCasedPath(
  context: CanvasRenderingContext2D,
  line: CartographyLineStyle,
  casingColor: string,
  opacity: number,
  casingExtraWidth = 2,
): void {
  if (line.width <= 0 || opacity <= 0) return;
  const dash = cartographyLineDash(line.pattern, line.width);
  context.save();
  context.globalAlpha = Math.max(0, Math.min(1, opacity));
  context.lineJoin = "round";
  context.lineCap = line.pattern === "dotted" ? "round" : "butt";
  context.setLineDash([...dash]);
  context.strokeStyle = casingColor;
  context.lineWidth = line.width + casingExtraWidth;
  context.stroke();
  context.strokeStyle = line.color;
  context.lineWidth = line.width;
  context.stroke();
  context.restore();
}

function pointInCell(corners: CellCorners, u: number, v: number): PaintPoint {
  const [topLeft, topRight, bottomRight, bottomLeft] = corners;
  return {
    x: (1 - u) * (1 - v) * topLeft.x + u * (1 - v) * topRight.x
      + u * v * bottomRight.x + (1 - u) * v * bottomLeft.x,
    y: (1 - u) * (1 - v) * topLeft.y + u * (1 - v) * topRight.y
      + u * v * bottomRight.y + (1 - u) * v * bottomLeft.y,
  };
}

function lineBetween(
  context: CanvasRenderingContext2D,
  from: PaintPoint,
  to: PaintPoint,
): void {
  context.moveTo(from.x, from.y);
  context.lineTo(to.x, to.y);
}

/** The only renderer for unexplored-cell marks. */
export function drawUnseenCellMarker(
  context: CanvasRenderingContext2D,
  marker: CartographyUnseenMarker,
  corners: CellCorners,
  color: CartographyColor,
  casingColor: CartographyColor,
  opacity: number,
  cellPixels: number,
): void {
  const width = Math.max(1, Math.min(2, cellPixels * 0.055));
  const line: CartographyLineStyle = { color, width, pattern: "solid" };
  if (marker === "stipple") {
    context.save();
    context.globalAlpha = Math.max(0, Math.min(1, opacity));
    const radius = Math.max(1.25, Math.min(2.4, cellPixels * 0.055));
    for (const [u, v] of [[0.5, 0.5], [0.35, 0.35], [0.65, 0.35], [0.35, 0.65], [0.65, 0.65]]) {
      const point = pointInCell(corners, u!, v!);
      context.beginPath();
      context.arc(point.x, point.y, radius + 1, 0, Math.PI * 2);
      context.fillStyle = casingColor;
      context.fill();
      context.beginPath();
      context.arc(point.x, point.y, radius, 0, Math.PI * 2);
      context.fillStyle = color;
      context.fill();
    }
    context.restore();
    return;
  }

  context.beginPath();
  switch (marker) {
    case "corners": {
      for (const [u, v, du, dv] of [
        [0.22, 0.22, 0.18, 0], [0.22, 0.22, 0, 0.18],
        [0.78, 0.22, -0.18, 0], [0.78, 0.22, 0, 0.18],
        [0.78, 0.78, -0.18, 0], [0.78, 0.78, 0, -0.18],
        [0.22, 0.78, 0.18, 0], [0.22, 0.78, 0, -0.18],
      ]) lineBetween(context, pointInCell(corners, u!, v!), pointInCell(corners, u! + du!, v! + dv!));
      break;
    }
    case "cross":
      lineBetween(context, pointInCell(corners, 0.34, 0.34), pointInCell(corners, 0.66, 0.66));
      lineBetween(context, pointInCell(corners, 0.66, 0.34), pointInCell(corners, 0.34, 0.66));
      break;
    case "diamond": {
      const points = [[0.5, 0.3], [0.7, 0.5], [0.5, 0.7], [0.3, 0.5]] as const;
      const first = pointInCell(corners, ...points[0]);
      context.moveTo(first.x, first.y);
      for (const [u, v] of points.slice(1)) {
        const projected = pointInCell(corners, u, v);
        context.lineTo(projected.x, projected.y);
      }
      context.closePath();
      break;
    }
    case "hatch":
      lineBetween(context, pointInCell(corners, 0.27, 0.55), pointInCell(corners, 0.45, 0.27));
      lineBetween(context, pointInCell(corners, 0.35, 0.73), pointInCell(corners, 0.73, 0.35));
      lineBetween(context, pointInCell(corners, 0.55, 0.73), pointInCell(corners, 0.73, 0.55));
      break;
    default: {
      const exhaustive: never = marker;
      return exhaustive;
    }
  }
  strokeCasedPath(context, line, casingColor, opacity, 2);
}

export function cartographyGridStyleFingerprint(style: CartographyGridStyle): string {
  return styleFingerprint(style);
}

export function cartographyWalkabilityStyleFingerprint(
  style: CartographyWalkabilityStyle,
): string {
  return styleFingerprint(style);
}
