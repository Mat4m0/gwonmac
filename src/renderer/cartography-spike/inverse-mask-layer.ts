/**
 * Draws one inverse walkability mask for any certified native map projection.
 * Owns clipping, veil removal, boundary drawing, and screen-sized canvas reuse.
 */
import type { CartographyOverlayStyle } from "../../shared/cartography-overlay.js";
import type { InverseMaskProjection } from "./map-projections.js";
import type { WalkabilityMask } from "./walkability-mask.js";

export type InverseMaskLayer = Readonly<{
  update(input: Readonly<{
    projection: InverseMaskProjection;
    mask: WalkabilityMask;
    version: string;
    style: CartographyOverlayStyle;
    opacity: number;
  }>): void;
  hide(): void;
  dispose(): void;
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

/** One renderer for every native map surface; only the projection changes. */
export function createInverseMaskLayer(
  parent: HTMLElement,
  id: string,
): InverseMaskLayer {
  const document = parent.ownerDocument;
  const root = document.createElement("div");
  root.id = id;
  root.setAttribute("aria-hidden", "true");
  root.style.cssText = [
    "position:fixed", "z-index:8", "display:none", "overflow:hidden",
    "pointer-events:none", "user-select:none",
  ].join(";");
  const canvas = document.createElement("canvas");
  canvas.style.cssText = "position:absolute;inset:0;width:100%;height:100%;pointer-events:none";
  const context = canvas.getContext("2d");
  const walkable = document.createElement("canvas");
  const expanded = document.createElement("canvas");
  const walkableContext = walkable.getContext("2d");
  const expandedContext = expanded.getContext("2d");
  root.append(canvas);
  parent.append(root);
  let drawingVersion = "";

  const draw = (input: Parameters<InverseMaskLayer["update"]>[0]): boolean => {
    if (context === null || walkableContext === null || expandedContext === null) return false;
    const dpr = document.defaultView?.devicePixelRatio ?? 1;
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
    walkableContext.drawImage(input.mask.canvas, 0, 0);
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

    const outlineRadius = Math.round(input.style.outlineWidth * dpr);
    if (outlineRadius > 0) {
      expandedContext.setTransform(1, 0, 0, 1, 0, 0);
      expandedContext.clearRect(0, 0, width, height);
      for (let y = -outlineRadius; y <= outlineRadius; y += outlineRadius) {
        for (let x = -outlineRadius; x <= outlineRadius; x += outlineRadius) {
          if (x !== 0 || y !== 0) expandedContext.drawImage(walkable, x, y);
        }
      }
      expandedContext.globalCompositeOperation = "destination-out";
      expandedContext.drawImage(walkable, 0, 0);
      expandedContext.globalCompositeOperation = "source-in";
      expandedContext.fillStyle = input.style.outlineColor;
      expandedContext.fillRect(0, 0, width, height);
      expandedContext.globalCompositeOperation = "source-over";
      context.save();
      context.globalAlpha = input.opacity / 100;
      context.drawImage(expanded, 0, 0);
      context.restore();
    }
    return true;
  };

  return Object.freeze({
    update(input) {
      const { box } = input.projection;
      root.style.left = `${box.left}px`;
      root.style.top = `${box.top}px`;
      root.style.width = `${box.width}px`;
      root.style.height = `${box.height}px`;
      const transform = input.projection.transform;
      const nextVersion = [
        input.version,
        (document.defaultView?.devicePixelRatio ?? 1).toFixed(2),
        box.width.toFixed(2), box.height.toFixed(2),
        transform.a.toFixed(5), transform.b.toFixed(5),
        transform.c.toFixed(5), transform.d.toFixed(5),
        transform.e.toFixed(2), transform.f.toFixed(2),
        input.style.veilColor, input.style.outlineColor,
        input.style.outlineWidth, input.opacity,
      ].join(":");
      if (nextVersion !== drawingVersion && !draw(input)) {
        root.style.display = "none";
        drawingVersion = "";
        return;
      }
      drawingVersion = nextVersion;
      root.style.display = input.opacity === 0 ? "none" : "block";
    },
    hide() {
      root.style.display = "none";
      drawingVersion = "";
    },
    dispose() {
      root.remove();
    },
  });
}
