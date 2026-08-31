/**
 * Owns the soft continent progress tint. It caches one bitmap-space mask and
 * projects that mask through a certified native-map transform without walking
 * every explored cell on animation frames.
 */
import type { ExploredCreditableBitset } from "./cartography-model.js";
import {
  CARTOGRAPHY_CELL_MAP_UNITS,
  type CartographyGridProjection,
} from "./cartography-grid-projection.js";

const DEFAULT_OPACITY = 0.16;

function has(words: Uint32Array, index: number): boolean {
  return ((words[index >>> 5]! >>> (index & 31)) & 1) === 1;
}

function sizeCanvas(canvas: HTMLCanvasElement, width: number, height: number): void {
  if (canvas.width !== width) canvas.width = width;
  if (canvas.height !== height) canvas.height = height;
}

function fingerprint(projection: CartographyGridProjection): string {
  const { box, transform } = projection;
  return [
    projection.surface,
    box.left, box.top, box.width, box.height,
    transform.a, transform.b, transform.c, transform.d, transform.e, transform.f,
    JSON.stringify(projection.clip),
  ].join(":");
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

export type ContinentCoverageLayer = Readonly<{
  update(input: Readonly<{
    projection: CartographyGridProjection;
    explored: ExploredCreditableBitset;
    version: string;
    color?: string;
    opacity?: number;
  }>): void;
  hide(): void;
  dispose(): void;
}>;

/** Create one pointer-transparent layer for Mission Map or World Map progress. */
export function createContinentCoverageLayer(
  parent: HTMLElement,
  id: string,
): ContinentCoverageLayer {
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
  root.append(canvas);
  parent.append(root);
  const context = canvas.getContext("2d");
  const mask = document.createElement("canvas");
  const maskContext = mask.getContext("2d");
  let maskVersion = "";
  let drawingVersion = "";

  const hide = (): void => {
    root.style.display = "none";
    drawingVersion = "";
  };

  return Object.freeze({
    update({ projection, explored, version, color = "#407D5C", opacity = DEFAULT_OPACITY }) {
      if (context === null || maskContext === null || opacity <= 0 || opacity > 1) {
        hide();
        return;
      }
      if (version !== maskVersion) {
        sizeCanvas(mask, explored.width, explored.height);
        const pixels = maskContext.createImageData(explored.width, explored.height);
        for (let index = 0; index < explored.width * explored.height; index += 1) {
          if (!has(explored.words, index)) continue;
          const offset = index * 4;
          pixels.data[offset] = 255;
          pixels.data[offset + 1] = 255;
          pixels.data[offset + 2] = 255;
          pixels.data[offset + 3] = 255;
        }
        maskContext.putImageData(pixels, 0, 0);
        maskVersion = version;
      }
      const dpr = document.defaultView?.devicePixelRatio ?? 1;
      const nextDrawingVersion = [fingerprint(projection), version, color, opacity, dpr].join(":");
      if (nextDrawingVersion !== drawingVersion) {
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
        context.globalAlpha = opacity;
        context.fillStyle = color;
        context.imageSmoothingEnabled = false;
        const { a, b, c, d, e, f } = projection.transform;
        context.setTransform(
          a * CARTOGRAPHY_CELL_MAP_UNITS * dpr,
          b * CARTOGRAPHY_CELL_MAP_UNITS * dpr,
          c * CARTOGRAPHY_CELL_MAP_UNITS * dpr,
          d * CARTOGRAPHY_CELL_MAP_UNITS * dpr,
          e * dpr,
          f * dpr,
        );
        context.globalCompositeOperation = "source-over";
        context.drawImage(mask, 0, 0);
        context.globalCompositeOperation = "source-in";
        context.globalAlpha = 1;
        context.fillRect(0, 0, explored.width, explored.height);
        context.restore();
        drawingVersion = nextDrawingVersion;
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
