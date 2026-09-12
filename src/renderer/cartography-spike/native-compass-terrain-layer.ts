/**
 * Owns one nearby terrain bitmap for the native Compass Canvas.
 * Native camera motion changes UVs; map, tile, style and scale changes repaint.
 */
import type { CartographyWalkabilityStyle } from "../../shared/cartography-overlay.js";
import {
  NATIVE_COMPASS_TERRAIN_HEADER_BYTES, NATIVE_COMPASS_TERRAIN_MAGIC,
  NATIVE_COMPASS_TERRAIN_MAX_SIZE, NATIVE_COMPASS_TERRAIN_WORLD_SPAN,
  NATIVE_COMPASS_WORLD_SCALE,
} from "../../shared/native-compass-terrain.js";
import { cartographyWalkabilityStyleFingerprint } from "./cartography-paint.js";
import { createInverseMaskPainter } from "./inverse-mask-painter.js";
import { createCartographyGridLayer, type CartographyGridLayer, type CartographyGridLayerSnapshot } from "./cartography-grid-layer.js";
import { cartographyCellAt } from "./cartography-grid-projection.js";
import { cartographyGridStyleFingerprint } from "./cartography-paint.js";
import type { WalkableTerrainSurface } from "./walkable-terrain-surface.js";

export type NativeCompassTerrainInput = Readonly<{
  area: number;
  version: string;
  terrain: WalkableTerrainSurface | null;
  cartography?: Omit<Parameters<CartographyGridLayer["update"]>[0], "projection" | "hoveredCell" | "revealRadius">;
  inspectionRadius?: 0 | 1 | 3;
  anchorX: number;
  anchorY: number;
  scaleX: number;
  scaleY: number;
  style: CartographyWalkabilityStyle;
  opacity: number;
}>;
export type NativeCompassTerrainLayer = Readonly<{
  available(): boolean;
  update(input: NativeCompassTerrainInput): void;
  gridSnapshot(): CartographyGridLayerSnapshot | null;
  hide(): void;
  dispose(): void;
}>;

/** One tile provides a full Compass radius plus margin between repaints. */
export function nativeCompassTerrainTile(input: Readonly<{
  cameraX: number; cameraY: number; width: number; height: number;
  scaleX: number; scaleY: number; dpr: number;
}>) {
  if (!Object.values(input).every(Number.isFinite)
    || Math.abs(input.cameraX) > 1000000 || Math.abs(input.cameraY) > 1000000
    || input.width <= 0 || input.height <= 0 || input.scaleX <= 0 || input.scaleY <= 0
    || input.dpr <= 0 || input.dpr > 8) return null;
  const cssWorldScale = Math.max(input.width * input.scaleX, input.height * input.scaleY) * NATIVE_COMPASS_WORLD_SCALE;
  const size = Math.max(64, 2 ** Math.ceil(Math.log2(NATIVE_COMPASS_TERRAIN_WORLD_SPAN * cssWorldScale * input.dpr)));
  if (size > NATIVE_COMPASS_TERRAIN_MAX_SIZE) return null;
  const left = Math.round(input.cameraX / 4096) * 4096 - NATIVE_COMPASS_TERRAIN_WORLD_SPAN / 2;
  const top = Math.round(input.cameraY / 4096) * 4096 + NATIVE_COMPASS_TERRAIN_WORLD_SPAN / 2;
  return Object.freeze({ left, top, size, cssWorldScale,
    paintScale: size / NATIVE_COMPASS_TERRAIN_WORLD_SPAN / cssWorldScale });
}

export function createNativeCompassTerrainLayer(exports: WebAssembly.Exports, document: Document): NativeCompassTerrainLayer {
  const memory = exports.memory;
  const malloc = exports.malloc; const free = exports.free;
  const publish = exports.gwonmac_compass_terrain_publish;
  const withdraw = exports.gwonmac_compass_terrain_hide;
  const names = ["area", "serial", "updates", "uploads", "created", "destroyed", "size", "camera_x", "camera_y", "width", "height"] as const;
  const globals = names.map((name) => exports[`gwonmac_compass_terrain_${name}`]);
  if (!(memory instanceof WebAssembly.Memory) || typeof malloc !== "function" || typeof free !== "function"
    || typeof publish !== "function" || typeof withdraw !== "function"
    || !globals.every((value) => value instanceof WebAssembly.Global)) {
    return Object.freeze({ available: () => false, update() {}, gridSnapshot: () => null, hide() {}, dispose() {} });
  }
  const [area, serial, updates, uploads, created, destroyed, textureSize, cameraX, cameraY, width, height] = globals;
  if (!area || !serial || !updates || !uploads || !created || !destroyed || !textureSize || !cameraX || !cameraY || !width || !height) {
    throw new Error("incomplete native Compass terrain surface");
  }
  const painter = createInverseMaskPainter(document);
  const grid = createCartographyGridLayer(document);
  let disposed = false;
  let version = "";
  let nextSerial = 0;
  let outcome: "hidden" | "ready" | "unavailable" = "hidden";
  const hide = () => { withdraw(); grid.hide(); version = ""; outcome = "hidden"; };
  const snapshot = () => ({ status: outcome, area: Number(area.value),
    updates: Number(updates.value), uploads: Number(uploads.value),
    created: Number(created.value), destroyed: Number(destroyed.value), textureSize: Number(textureSize.value) });
  window.gwNativeCompassTerrainStats = snapshot;
  const reset = () => { if (!disposed) hide(); };
  window.addEventListener("gw:graphics-context-reset", reset);

  return Object.freeze({
    available: () => !disposed,
    update(input) {
      if (disposed) return;
      if ((input.opacity <= 0 && !input.cartography) || !Number.isInteger(input.area) || input.area <= 0 || input.area > 0x7fffffff) { hide(); return; }
      const tile = nativeCompassTerrainTile({ cameraX: Number(cameraX.value), cameraY: Number(cameraY.value),
        width: Number(width.value), height: Number(height.value), scaleX: input.scaleX, scaleY: input.scaleY,
        dpr: document.defaultView?.devicePixelRatio ?? 1 });
      if (tile === null || ![input.anchorX, input.anchorY].every(Number.isFinite)) { hide(); outcome = "unavailable"; return; }
      const currentCell = cartographyCellAt(input.anchorX + Number(cameraX.value) / 96, input.anchorY - Number(cameraY.value) / 96);
      const inspectionRadius = input.cartography ? input.inspectionRadius ?? 0 : 0;
      const inspectionKey = inspectionRadius > 0 && currentCell ? `${inspectionRadius}:${currentCell.x}:${currentCell.y}` : "off";
      const key = [inspectionKey, input.area, input.version, tile.left, tile.top, tile.size, tile.cssWorldScale,
        input.anchorX, input.anchorY, cartographyWalkabilityStyleFingerprint(input.style), input.opacity,
        input.cartography ? [input.cartography.explorationVersion, input.cartography.revealabilityVersion,
          cartographyGridStyleFingerprint(input.cartography.style), input.cartography.opacity].join(":") : "no-grid"].join(":");
      if (key === version && Number(serial.value) === nextSerial && Number(area.value) === input.area) return;
      const mapLeft = input.anchorX + tile.left / 96;
      const mapTop = input.anchorY - tile.top / 96;
      const logicalSize = tile.size / tile.paintScale;
      const mapScale = tile.cssWorldScale * 96;
      const canvas = input.terrain === null || input.opacity <= 0 ? painter.canvas : painter.draw({ terrain: input.terrain, version: input.version, style: input.style, opacity: input.opacity,
        projection: {
          box: {left: 0, top: 0, width: logicalSize, height: logicalSize}, clip: {kind: "rectangle"},
          transform: {a: mapScale * input.terrain.mapUnitsPerPixel, b: 0, c: 0, d: mapScale * input.terrain.mapUnitsPerPixel,
            e: (input.terrain.mapLeft - mapLeft) * mapScale, f: (input.terrain.mapTop - mapTop) * mapScale},
        },
      }, tile.paintScale);
      if (input.terrain === null || input.opacity <= 0) {
        if (painter.canvas.width !== tile.size) painter.canvas.width = tile.size;
        if (painter.canvas.height !== tile.size) painter.canvas.height = tile.size;
        const blank = painter.canvas.getContext("2d");
        blank?.setTransform(1, 0, 0, 1, 0, 0); blank?.clearRect(0, 0, tile.size, tile.size);
      }
      if (input.cartography) {
        const span = NATIVE_COMPASS_TERRAIN_WORLD_SPAN / 96;
        if (currentCell) grid.update({ ...input.cartography, hoveredCell: inspectionRadius > 0 ? currentCell : null, revealRadius: inspectionRadius,
          projection: { surface: "compass", box: {left: 0, top: 0, width: logicalSize, height: logicalSize},
            clip: {kind: "rectangle"}, transform: {a: mapScale, b: 0, c: 0, d: mapScale, e: -mapLeft * mapScale, f: -mapTop * mapScale},
            firstCellX: Math.floor(mapLeft / 32), lastCellX: Math.floor((mapLeft + span) / 32),
            firstCellY: Math.floor(mapTop / 32), lastCellY: Math.floor((mapTop + span) / 32), currentCell,
          },
        });
        else grid.hide();
      } else grid.hide();
      const gridImage = grid.image();
      const composite = canvas?.getContext("2d");
      if (composite && gridImage) {
        composite.save(); composite.setTransform(1, 0, 0, 1, 0, 0);
        composite.drawImage(gridImage.canvas, 0, 0, tile.size, tile.size); composite.restore();
      }
      const context = canvas?.getContext("2d");
      if (!canvas || !context) { hide(); outcome = "unavailable"; return; }
      const pixels = context.getImageData(0, 0, tile.size, tile.size).data;
      const bytes = NATIVE_COMPASS_TERRAIN_HEADER_BYTES + pixels.length;
      // The existing native allocator and copied GrTex input remain private to
      // this loader. No pointer or generic write is published through diagnostics.
      // The certified wasm32 allocator returns signed i32 bits, including addresses above 2 GiB.
      const region = Number(malloc(bytes)) >>> 0;
      if (!Number.isSafeInteger(region) || region <= 0 || region % 4 !== 0 || region + bytes > memory.buffer.byteLength) {
        if (Number.isSafeInteger(region) && region > 0) free(region);
        hide(); outcome = "unavailable"; return;
      }
      try {
        nextSerial = nextSerial >= 0x7ffffffe ? 1 : nextSerial + 1;
        const header = new DataView(memory.buffer, region, NATIVE_COMPASS_TERRAIN_HEADER_BYTES);
        header.setUint32(0, NATIVE_COMPASS_TERRAIN_MAGIC, true); header.setUint32(4, bytes, true);
        header.setUint32(8, input.area, true); header.setUint32(12, tile.size, true);
        header.setFloat32(16, tile.left, true); header.setFloat32(20, tile.top, true);
        header.setFloat32(24, NATIVE_COMPASS_TERRAIN_WORLD_SPAN, true); header.setUint32(28, nextSerial, true);
        const target = new Uint8Array(memory.buffer, region + NATIVE_COMPASS_TERRAIN_HEADER_BYTES, pixels.length);
        // GrTex format 0 is the native packed ARGB control; its byte order is BGRA.
        for (let at = 0; at < pixels.length; at += 4) {
          target[at] = pixels[at + 2]!; target[at + 1] = pixels[at + 1]!;
          target[at + 2] = pixels[at]!; target[at + 3] = pixels[at + 3]!;
        }
        if (publish(region, bytes) !== 1) { hide(); outcome = "unavailable"; return; }
        version = key; outcome = "ready";
      } finally {
        free(region);
      }
    },
    gridSnapshot: () => grid.snapshot(),
    hide,
    dispose() {
      if (disposed) return;
      disposed = true;
      try { hide(); } finally {
        painter.dispose(); grid.dispose();
        window.removeEventListener("gw:graphics-context-reset", reset);
        if (window.gwNativeCompassTerrainStats === snapshot) delete window.gwNativeCompassTerrainStats;
      }
    },
  });
}
