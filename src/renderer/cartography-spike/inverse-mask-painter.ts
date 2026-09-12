/**
 * Owns inverse-mask raster painting shared by native Compass textures and Mission Map.
 * Surface placement and native texture ownership stay with their respective layers.
 */
import type { CartographyWalkabilityStyle } from "../../shared/cartography-overlay.js";
import type { InverseMaskProjection } from "./map-projections.js";
import type { WalkableTerrainSurface } from "./walkable-terrain-surface.js";

export type InverseMaskPaint = Readonly<{
  projection: InverseMaskProjection;
  terrain: WalkableTerrainSurface;
  version: string;
  style: CartographyWalkabilityStyle;
  opacity: number;
}>;

function clipProjection(
  context: CanvasRenderingContext2D,
  projection: InverseMaskProjection,
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

function sizeCanvas(canvas: HTMLCanvasElement, width: number, height: number): void {
  if (canvas.width !== width) canvas.width = width;
  if (canvas.height !== height) canvas.height = height;
}

export function createInverseMaskPainter(document: Document) {
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");
  const walkable = document.createElement("canvas");
  const expanded = document.createElement("canvas");
  const walkableContext = walkable.getContext("2d");
  const expandedContext = expanded.getContext("2d");
  const draw = (input: InverseMaskPaint, dpr: number): HTMLCanvasElement | null => {
    if (context === null || walkableContext === null || expandedContext === null) return null;
    const width = Math.max(1, Math.round(input.projection.box.width * dpr));
    const height = Math.max(1, Math.round(input.projection.box.height * dpr));
    for (const target of [canvas, walkable, expanded]) sizeCanvas(target, width, height);

    const { a, b, c, d, e, f } = input.projection.transform;
    walkableContext.setTransform(1, 0, 0, 1, 0, 0);
    walkableContext.clearRect(0, 0, width, height);
    walkableContext.save();
    walkableContext.scale(dpr, dpr);
    clipProjection(walkableContext, input.projection);
    walkableContext.setTransform(a * dpr, b * dpr, c * dpr, d * dpr, e * dpr, f * dpr);
    walkableContext.imageSmoothingEnabled = true;
    walkableContext.drawImage(input.terrain.canvas, 0, 0);
    walkableContext.restore();

    context.setTransform(1, 0, 0, 1, 0, 0);
    context.clearRect(0, 0, width, height);
    context.save();
    context.scale(dpr, dpr);
    clipProjection(context, input.projection);
    context.globalAlpha = input.opacity / 100;
    context.fillStyle = input.style.veilColor;
    context.fillRect(0, 0, input.projection.box.width, input.projection.box.height);
    context.restore();
    context.globalCompositeOperation = "destination-out";
    context.drawImage(walkable, 0, 0);
    context.globalCompositeOperation = "source-over";

    const outlineRadius = Math.round(input.style.boundaryWidth * dpr);
    if (outlineRadius > 0) {
      const paintOutline = (radius: number, color: string, alpha: number): void => {
        expandedContext.setTransform(1, 0, 0, 1, 0, 0);
        expandedContext.clearRect(0, 0, width, height);
        expandedContext.globalCompositeOperation = "source-over";
        // One blurred alpha shadow replaces the old radius-squared loop of
        // full-surface copies. The core is removed below, leaving only the rim.
        expandedContext.shadowColor = color;
        expandedContext.shadowBlur = Math.max(1, radius * 1.35);
        expandedContext.drawImage(walkable, 0, 0);
        expandedContext.shadowColor = "transparent";
        expandedContext.shadowBlur = 0;
        expandedContext.globalCompositeOperation = "destination-out";
        expandedContext.drawImage(walkable, 0, 0);
        expandedContext.globalCompositeOperation = "source-in";
        expandedContext.fillStyle = color;
        expandedContext.fillRect(0, 0, width, height);
        expandedContext.globalCompositeOperation = "source-over";
        context.save();
        context.globalAlpha = alpha;
        context.drawImage(expanded, 0, 0);
        context.restore();
      };
      const strength = input.opacity / 100;
      paintOutline(
        outlineRadius + Math.max(1, Math.round(dpr)),
        input.style.boundaryCasingColor,
        Math.min(1, strength * 1.45),
      );
      paintOutline(
        outlineRadius,
        input.style.boundaryColor,
        Math.min(1, strength * 1.6),
      );
    }
    return canvas;
  };

  return Object.freeze({ canvas, draw, dispose() { for (const target of [canvas, walkable, expanded]) { target.width = 0; target.height = 0; } } });
}
