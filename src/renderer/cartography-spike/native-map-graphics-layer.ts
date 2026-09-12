/**
 * Composes map painters into bounded textures for native Mission and World Map.
 * These canvases stay detached; only each game's map draw event presents them.
 */
import { disposeCartographyResources } from "../cartography-lifecycle.js";
import { NATIVE_MAP_GRAPHICS_HEADER_BYTES, NATIVE_MAP_GRAPHICS_MAGIC,
  NATIVE_MAP_GRAPHICS_MAX_SIZE, NATIVE_MAP_GRAPHICS_SURFACES,
  type NativeMapGraphicsSurface } from "../../shared/native-map-graphics.js";
import type { MapUnitProjection } from "./map-projections.js";

export type MapPainterImage = Readonly<{ canvas: HTMLCanvasElement; version: string }>;
export type NativeMapGraphicsLayer = Readonly<{
  available(surface: NativeMapGraphicsSurface): boolean;
  update(surface: NativeMapGraphicsSurface, input: Readonly<{
    area: number; continent: number; projection: MapUnitProjection;
    images: readonly (MapPainterImage | null)[];
  }>): void;
  hide(surface: NativeMapGraphicsSurface): void;
  dispose(): void;
}>;

/** Convert the painted corners back into native world-map units. */
export function nativeMapGraphicsCorners(projection: MapUnitProjection): readonly number[] | null {
  const { a, b, c, d, e, f } = projection.transform;
  const { width, height } = projection.box;
  const determinant = a * d - b * c;
  if (![a, b, c, d, e, f, width, height].every(Number.isFinite)
    || width <= 0 || height <= 0 || Math.abs(determinant) < 1e-10) return null;
  const corners = [[0, 0], [width, 0], [width, height], [0, height]].flatMap(([x = 0, y = 0]) => [
    (d * (x - e) - c * (y - f)) / determinant,
    (a * (y - f) - b * (x - e)) / determinant,
  ]);
  return corners.every((value) => Number.isFinite(value) && Math.abs(value) <= 1000000) ? corners : null;
}

export function createNativeMapGraphicsLayer(exports: WebAssembly.Exports, document: Document): NativeMapGraphicsLayer {
  const memory = exports.memory; const malloc = exports.malloc; const free = exports.free;
  const surfaces = NATIVE_MAP_GRAPHICS_SURFACES.map((name) => {
    const publish = exports[`gwonmac_${name}_graphics_publish`];
    const hide = exports[`gwonmac_${name}_graphics_hide`];
    const serial = exports[`gwonmac_${name}_graphics_serial`];
    if (typeof publish !== "function" || typeof hide !== "function" || !(serial instanceof WebAssembly.Global)) return null;
    return { name, publish, hide, serial, canvas: document.createElement("canvas"), version: "", nextSerial: 0 };
  });
  let disposed = false;
  const withdraw = (surface: NativeMapGraphicsSurface) => {
    const target = surfaces.find((item) => item?.name === surface);
    if (target) { target.hide(); target.version = ""; }
  };
  const reset = () => { for (const name of NATIVE_MAP_GRAPHICS_SURFACES) withdraw(name); };
  const view = document.defaultView;
  view?.addEventListener("gw:graphics-context-reset", reset);
  const stats = () => {
    const read = (surface: NativeMapGraphicsSurface | "ranges") => {
      const prefix = surface === "ranges" ? "gwonmac_compass_ranges" : `gwonmac_${surface}_graphics`;
      const names = ["area", "uploads", "draws", "created", "destroyed"] as const;
      const values = names.map((name) => exports[`${prefix}_${surface === "ranges" && name === "draws" ? "updates" : name}`]);
      if (!values.every((value) => value instanceof WebAssembly.Global)) return null;
      return {area: Number(values[0]?.value), uploads: Number(values[1]?.value), draws: Number(values[2]?.value),
        created: Number(values[3]?.value), destroyed: Number(values[4]?.value)};
    };
    return {mission: read("mission"), world: read("world"), mission_hover: read("mission_hover"), world_hover: read("world_hover"), ranges: read("ranges")};
  };
  if (view) view.gwNativeMapGraphicsStats = stats;
  return Object.freeze({
    available: surface => !disposed && memory instanceof WebAssembly.Memory
      && typeof malloc === "function" && typeof free === "function"
      && surfaces.some(item => item?.name === surface),
    update(surface, input) {
      const target = surfaces.find((item) => item?.name === surface);
      if (disposed || !target) return;
      if (!(memory instanceof WebAssembly.Memory) || typeof malloc !== "function" || typeof free !== "function"
        || !Number.isInteger(input.area) || input.area <= 0 || input.area > 0x7fffffff) { withdraw(surface); return; }
      const images = input.images.filter((item): item is MapPainterImage => item !== null);
      const corners = nativeMapGraphicsCorners(input.projection);
      if (!images.length || corners === null) { withdraw(surface); return; }
      const key = [input.area, input.continent, ...corners, ...input.images.map((image) => image?.version ?? "hidden")].join(":");
      if (key === target.version && Number(target.serial.value) === target.nextSerial) return;
      const largestWidth = Math.max(...images.map(({canvas}) => canvas.width));
      const largestHeight = Math.max(...images.map(({canvas}) => canvas.height));
      const dimension = (size: number) => Math.min(NATIVE_MAP_GRAPHICS_MAX_SIZE, Math.max(64, 2 ** Math.ceil(Math.log2(size))));
      const width = dimension(largestWidth); const height = dimension(largestHeight);
      if (target.canvas.width !== width) target.canvas.width = width;
      if (target.canvas.height !== height) target.canvas.height = height;
      const context = target.canvas.getContext("2d");
      if (!context) { withdraw(surface); return; }
      context.clearRect(0, 0, width, height);
      for (const { canvas } of images) context.drawImage(canvas, 0, 0, width, height);
      const pixels = context.getImageData(0, 0, width, height).data;
      const bytes = NATIVE_MAP_GRAPHICS_HEADER_BYTES + pixels.length;
      // The certified wasm32 allocator returns signed i32 bits, including addresses above 2 GiB.
      const region = Number(malloc(bytes)) >>> 0;
      if (!Number.isSafeInteger(region) || region <= 0 || region % 4 !== 0 || region + bytes > memory.buffer.byteLength) {
        if (Number.isSafeInteger(region) && region > 0) free(region);
        withdraw(surface); return;
      }
      try {
        target.nextSerial = target.nextSerial >= 0x7ffffffe ? 1 : target.nextSerial + 1;
        const header = new DataView(memory.buffer, region, NATIVE_MAP_GRAPHICS_HEADER_BYTES);
        [NATIVE_MAP_GRAPHICS_MAGIC, bytes, input.area, width, height, target.nextSerial, input.continent, 0]
          .forEach((value, index) => header.setUint32(index * 4, value, true));
        corners.forEach((value, index) => header.setFloat32(32 + index * 4, value, true));
        const output = new Uint8Array(memory.buffer, region + NATIVE_MAP_GRAPHICS_HEADER_BYTES, pixels.length);
        for (let at = 0; at < pixels.length; at += 4) {
          output[at] = pixels[at + 2]!; output[at + 1] = pixels[at + 1]!;
          output[at + 2] = pixels[at]!; output[at + 3] = pixels[at + 3]!;
        }
        if (target.publish(region, bytes) === 1) target.version = key;
        else withdraw(surface);
      } finally { free(region); }
    },
    hide: withdraw,
    dispose() {
      if (disposed) return;
      if (view?.gwNativeMapGraphicsStats === stats) delete view.gwNativeMapGraphicsStats;
      disposed = true;
      try {
        disposeCartographyResources(NATIVE_MAP_GRAPHICS_SURFACES.map(name => () => withdraw(name)));
      } finally {
        view?.removeEventListener("gw:graphics-context-reset", reset);
        for (const target of surfaces) if (target) { target.canvas.width = 0; target.canvas.height = 0; }
      }
    },
  });
}
