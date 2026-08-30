/**
 * Draws the boundary of the current instance's certified live evidence. The
 * boundary explains why solid-orange guidance stops without implying anything
 * about surrounding continent candidates.
 */
import { strokeCasedPath } from "./cartography-paint.js";
import type { CartographyGridProjection } from "./cartography-grid-projection.js";

type MapBounds = Readonly<{
  min: Readonly<{ x: number; y: number }>;
  max: Readonly<{ x: number; y: number }>;
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
  const { transform } = projection;
  return Object.freeze({
    x: transform.a * mapX + transform.c * mapY + transform.e,
    y: transform.b * mapX + transform.d * mapY + transform.f,
  });
}

function clip(context: CanvasRenderingContext2D, projection: CartographyGridProjection): void {
  context.beginPath();
  if (projection.clip.kind === "circle") {
    context.arc(
      projection.clip.centerX,
      projection.clip.centerY,
      projection.clip.radius,
      0,
      Math.PI * 2,
    );
  } else context.rect(0, 0, projection.box.width, projection.box.height);
  context.clip();
}

export type CurrentInstanceBoundaryLayer = Readonly<{
  update(input: Readonly<{
    projection: CartographyGridProjection;
    bounds: MapBounds;
    version: string;
  }>): void;
  hide(): void;
  dispose(): void;
}>;

/** Create one passive boundary layer for a non-Compass map surface. */
export function createCurrentInstanceBoundaryLayer(
  parent: HTMLElement,
  id: string,
): CurrentInstanceBoundaryLayer {
  const document = parent.ownerDocument;
  const root = document.createElement("div");
  root.id = id;
  root.setAttribute("aria-hidden", "true");
  root.style.cssText = [
    "position:fixed", "z-index:11", "display:none", "overflow:hidden",
    "pointer-events:none", "user-select:none",
  ].join(";");
  const canvas = document.createElement("canvas");
  canvas.style.cssText = "position:absolute;inset:0;width:100%;height:100%;pointer-events:none";
  root.append(canvas);
  parent.append(root);
  const context = canvas.getContext("2d");
  let drawingVersion = "";

  const hide = (): void => {
    root.style.display = "none";
    drawingVersion = "";
  };

  return Object.freeze({
    update({ projection, bounds, version }) {
      if (context === null || projection.surface === "compass") {
        hide();
        return;
      }
      const dpr = document.defaultView?.devicePixelRatio ?? 1;
      const { a, b, c, d, e, f } = projection.transform;
      const fingerprint = [
        version,
        projection.box.width,
        projection.box.height,
        a, b, c, d, e, f,
        bounds.min.x,
        bounds.min.y,
        bounds.max.x,
        bounds.max.y,
        dpr,
      ].join(":");
      if (fingerprint !== drawingVersion) {
        sizeCanvas(
          canvas,
          Math.max(1, Math.round(projection.box.width * dpr)),
          Math.max(1, Math.round(projection.box.height * dpr)),
        );
        context.setTransform(1, 0, 0, 1, 0, 0);
        context.clearRect(0, 0, canvas.width, canvas.height);
        context.save();
        context.scale(dpr, dpr);
        clip(context, projection);
        const corners = [
          projectedPoint(projection, bounds.min.x, bounds.min.y),
          projectedPoint(projection, bounds.max.x, bounds.min.y),
          projectedPoint(projection, bounds.max.x, bounds.max.y),
          projectedPoint(projection, bounds.min.x, bounds.max.y),
        ];
        context.beginPath();
        context.moveTo(corners[0]!.x, corners[0]!.y);
        for (const corner of corners.slice(1)) context.lineTo(corner.x, corner.y);
        context.closePath();
        strokeCasedPath(
          context,
          Object.freeze({ color: "#D7D3C7", width: 1.25, pattern: "solid" }),
          "#111719",
          0.62,
        );
        context.restore();
        drawingVersion = fingerprint;
      }
      root.style.left = `${projection.box.left}px`;
      root.style.top = `${projection.box.top}px`;
      root.style.width = `${projection.box.width}px`;
      root.style.height = `${projection.box.height}px`;
      root.style.display = "block";
    },
    hide,
    dispose() {
      root.remove();
    },
  });
}
