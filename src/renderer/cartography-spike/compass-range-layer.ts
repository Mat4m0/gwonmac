/**
 * Owns standard player-centred range rings on the certified native Compass.
 * The native Compass edge is the single 5000-unit scale reference.
 */
import type { ScreenBox } from "./frame-placement.js";
import {
  COMPASS_RANGE_INDICATORS,
  COMPASS_RANGE_OPACITY_MAX,
  COMPASS_RANGE_OPACITY_MIN,
  DEFAULT_COMPASS_RANGE_OPACITY,
  compassRangeColor,
  type CompassRangeId,
  type CompassRangeTheme,
} from "../../shared/compass-ranges.js";
import {
  COMPASS_FRAME_WIDTH,
  COMPASS_MAP_RADIUS,
  COMPASS_WORLD_RADIUS,
} from "./map-projections.js";

export type CompassRangeSelection = Readonly<{
  id: CompassRangeId;
  opacity: number;
}>;
export type CompassRangeProjection = Readonly<{
  centerX: number;
  centerY: number;
  clipRadius: number;
  rings: readonly Readonly<{
    id: CompassRangeId;
    label: string;
    units: number;
    color: string;
    opacity: number;
    radiusPixels: number;
  }>[];
}>;
export type CompassRangeLayerSnapshot = Readonly<{
  status: "disabled" | "frame-unavailable" | "visible";
  drawCount: number;
  projection: CompassRangeProjection | null;
}>;
export type CompassRangeLayer = Readonly<{
  update(
    box: ScreenBox | null,
    ranges: readonly CompassRangeSelection[],
    theme: CompassRangeTheme,
  ): void;
  snapshot(): CompassRangeLayerSnapshot;
  dispose(): void;
}>;

/** Project standard ranges from the certified native Compass geometry. */
export function projectCompassRangeIndicators(
  box: ScreenBox,
  ranges: readonly CompassRangeSelection[] = COMPASS_RANGE_INDICATORS.map(({ id }) => ({
    id,
    opacity: DEFAULT_COMPASS_RANGE_OPACITY,
  })),
  theme: CompassRangeTheme = "color",
): CompassRangeProjection | null {
  if (
    ![box.left, box.top, box.width, box.height].every(Number.isFinite)
    || box.width <= 0 || box.height <= 0
    || ranges.some(({ opacity }) => !Number.isInteger(opacity)
      || opacity < COMPASS_RANGE_OPACITY_MIN
      || opacity > COMPASS_RANGE_OPACITY_MAX)
  ) return null;
  const centerX = box.width / 2;
  const centerY = box.width / 2;
  const clipRadius = box.width * COMPASS_MAP_RADIUS / COMPASS_FRAME_WIDTH;
  if (clipRadius <= 0 || centerY + clipRadius > box.height) return null;
  return Object.freeze({
    centerX,
    centerY,
    clipRadius,
    rings: Object.freeze(ranges.map((selection) => {
      const range = COMPASS_RANGE_INDICATORS.find(({ id }) => id === selection.id);
      if (range === undefined) throw new Error(`Unknown Compass range: ${selection.id}`);
      return Object.freeze({
        id: range.id,
        label: range.label,
        units: range.units,
        color: compassRangeColor(range, theme),
        opacity: selection.opacity,
        radiusPixels: clipRadius * range.units / COMPASS_WORLD_RADIUS,
      });
    })),
  });
}

export function compassRangeAtPoint(
  projection: CompassRangeProjection,
  x: number,
  y: number,
  tolerance = 4,
): CompassRangeProjection["rings"][number] | null {
  if (projection.rings.length === 0) return null;
  const distance = Math.hypot(x - projection.centerX, y - projection.centerY);
  const nearest = projection.rings.reduce((best, ring) => (
    Math.abs(ring.radiusPixels - distance) < Math.abs(best.radiusPixels - distance)
      ? ring : best
  ));
  return Math.abs(nearest.radiusPixels - distance) <= tolerance ? nearest : null;
}

function sizeCanvas(canvas: HTMLCanvasElement, width: number, height: number): void {
  if (canvas.width !== width) canvas.width = width;
  if (canvas.height !== height) canvas.height = height;
}

export function createCompassRangeLayer(parent: HTMLElement): CompassRangeLayer {
  const document = parent.ownerDocument;
  const root = document.createElement("div");
  root.id = "compass-range-indicators";
  root.setAttribute("aria-hidden", "true");
  root.style.cssText = [
    "position:fixed", "z-index:10", "display:none", "overflow:hidden",
    "pointer-events:none", "user-select:none",
  ].join(";");
  const canvas = document.createElement("canvas");
  canvas.style.cssText = "position:absolute;inset:0;width:100%;height:100%;pointer-events:none";
  const tooltip = document.createElement("div");
  tooltip.className = "compass-range-tooltip";
  tooltip.hidden = true;
  root.append(canvas, tooltip);
  parent.append(root);
  const context = canvas.getContext("2d");
  let drawingVersion = "";
  let drawCount = 0;
  let latest: CompassRangeLayerSnapshot = Object.freeze({
    status: "disabled", drawCount, projection: null,
  });

  const hideTooltip = (): void => { tooltip.hidden = true; };
  const hide = (status: "disabled" | "frame-unavailable"): void => {
    hideTooltip();
    root.style.display = "none";
    drawingVersion = "";
    latest = Object.freeze({ status, drawCount, projection: null });
  };
  const draw = (projection: CompassRangeProjection): boolean => {
    if (context === null) return false;
    const dpr = document.defaultView?.devicePixelRatio ?? 1;
    const cssWidth = Number.parseFloat(root.style.width);
    const cssHeight = Number.parseFloat(root.style.height);
    const width = Math.max(1, Math.round(cssWidth * dpr));
    const height = Math.max(1, Math.round(cssHeight * dpr));
    sizeCanvas(canvas, width, height);
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    context.clearRect(0, 0, cssWidth, cssHeight);
    context.save();
    context.beginPath();
    context.arc(projection.centerX, projection.centerY, projection.clipRadius, 0, Math.PI * 2);
    context.clip();
    for (const ring of [...projection.rings].reverse()) {
      context.beginPath();
      context.arc(projection.centerX, projection.centerY, ring.radiusPixels, 0, Math.PI * 2);
      context.strokeStyle = "#050709";
      context.globalAlpha = 0.75 * ring.opacity / 100;
      context.lineWidth = 2.5;
      context.stroke();
      context.strokeStyle = ring.color;
      context.globalAlpha = 0.95 * ring.opacity / 100;
      context.lineWidth = 1.25;
      context.stroke();
    }
    context.restore();
    drawCount += 1;
    return true;
  };
  const onPointerMove = (event: PointerEvent): void => {
    const projection = latest.projection;
    if (latest.status !== "visible" || projection === null) {
      hideTooltip();
      return;
    }
    const localX = event.clientX - Number.parseFloat(root.style.left);
    const localY = event.clientY - Number.parseFloat(root.style.top);
    const nearest = compassRangeAtPoint(projection, localX, localY);
    if (nearest === null) {
      hideTooltip();
      return;
    }
    tooltip.textContent = nearest.label;
    tooltip.style.left = `${localX}px`;
    tooltip.style.top = `${localY}px`;
    tooltip.style.transform = localX > projection.centerX
      ? "translate(calc(-100% - 7px), -50%)"
      : "translate(7px, -50%)";
    tooltip.hidden = false;
  };
  document.addEventListener("pointermove", onPointerMove, { passive: true });

  return Object.freeze({
    update(box, ranges, theme) {
      if (ranges.length === 0) { hide("disabled"); return; }
      if (box === null) { hide("frame-unavailable"); return; }
      const projection = projectCompassRangeIndicators(box, ranges, theme);
      if (projection === null) { hide("frame-unavailable"); return; }
      root.style.left = `${box.left}px`;
      root.style.top = `${box.top}px`;
      root.style.width = `${box.width}px`;
      root.style.height = `${box.height}px`;
      const nextVersion = [
        box.width,
        box.height,
        document.defaultView?.devicePixelRatio ?? 1,
        theme,
        ...ranges.flatMap(({ id, opacity }) => [id, opacity]),
      ].join(":");
      if (nextVersion !== drawingVersion && !draw(projection)) {
        hide("frame-unavailable");
        return;
      }
      drawingVersion = nextVersion;
      root.style.display = "block";
      latest = Object.freeze({ status: "visible", drawCount, projection });
    },
    snapshot: () => latest,
    dispose() {
      document.removeEventListener("pointermove", onPointerMove);
      root.remove();
      hide("disabled");
    },
  });
}
