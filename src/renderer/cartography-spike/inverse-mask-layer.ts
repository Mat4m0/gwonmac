/**
 * Caches the Mission Map terrain bitmap for native map composition.
 * Raster painting is shared with the native Compass texture owner.
 */
import { createInverseMaskPainter, type InverseMaskPaint } from "./inverse-mask-painter.js";
import { cartographyWalkabilityStyleFingerprint } from "./cartography-paint.js";

export type InverseMaskLayer = Readonly<{
  update(input: InverseMaskPaint): void;
  image(): Readonly<{ canvas: HTMLCanvasElement; version: string }> | null;
  hide(): void;
  dispose(): void;
}>;

/** Detached Mission Map bitmap with content-based invalidation. */
export function createInverseMaskLayer(
  document: Document,
): InverseMaskLayer {
  const painter = createInverseMaskPainter(document);
  let drawingVersion = "";

  return Object.freeze({
    update(input) {
      if (input.opacity <= 0) { drawingVersion = ""; return; }
      const { box } = input.projection;
      const transform = input.projection.transform;
      const nextVersion = [
        input.version,
        document.defaultView?.devicePixelRatio ?? 1,
        box.width, box.height,
        transform.a, transform.b, transform.c, transform.d, transform.e, transform.f,
        JSON.stringify(input.projection.clip),
        cartographyWalkabilityStyleFingerprint(input.style), input.opacity,
      ].join(":");
      if (nextVersion !== drawingVersion) {
        const canvas = painter.draw(input, Math.min(document.defaultView?.devicePixelRatio ?? 1,
          2048 / Math.max(box.width, box.height)));
        if (canvas === null) {
          drawingVersion = "";
          return;
        }
      }
      drawingVersion = nextVersion;
    },
    image: () => drawingVersion === "" ? null : { canvas: painter.canvas, version: drawingVersion },
    hide() {
      drawingVersion = "";
    },
    dispose() {
      drawingVersion = "";
      painter.dispose();
    },
  });
}
