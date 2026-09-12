/**
 * Copies range artwork into its own native Compass Canvas draw object.
 * Native camera frames reuse that texture until range styling or scale changes.
 */
import { NATIVE_COMPASS_TERRAIN_HEADER_BYTES, NATIVE_COMPASS_TERRAIN_MAGIC,
  NATIVE_COMPASS_TERRAIN_MAX_SIZE, NATIVE_COMPASS_TERRAIN_WORLD_SPAN } from "../../shared/native-compass-terrain.js";
import type { MapPainterImage } from "./native-map-graphics-layer.js";

export function createNativeCompassRangesLayer(exports: WebAssembly.Exports, document: Document) {
  const memory = exports.memory; const malloc = exports.malloc; const free = exports.free;
  const publish = exports.gwonmac_compass_ranges_publish; const hide = exports.gwonmac_compass_ranges_hide;
  const serial = exports.gwonmac_compass_ranges_serial;
  const nativeArea = exports.gwonmac_compass_ranges_area;
  const canvas = document.createElement("canvas");
  let version = ""; let nextSerial = 0; let disposed = false;
  const withdraw = () => { if (typeof hide === "function") hide(); version = ""; };
  const view = document.defaultView;
  view?.addEventListener("gw:graphics-context-reset", withdraw);
  return Object.freeze({
    available: () => !disposed && memory instanceof WebAssembly.Memory
      && typeof malloc === "function" && typeof free === "function"
      && typeof publish === "function" && typeof hide === "function"
      && serial instanceof WebAssembly.Global && nativeArea instanceof WebAssembly.Global,
    update(image: MapPainterImage | null, area: number) {
      if (disposed) return;
      if (!image || !Number.isInteger(area) || area <= 0 || area > 0x7fffffff) { withdraw(); return; }
      if (!(memory instanceof WebAssembly.Memory) || typeof malloc !== "function" || typeof free !== "function"
        || typeof publish !== "function" || !(serial instanceof WebAssembly.Global) || !(nativeArea instanceof WebAssembly.Global)) return;
      const key = `${area}:${image.version}`;
      if (version === key && Number(serial.value) === nextSerial && Number(nativeArea.value) === area) return;
      const size = Math.min(NATIVE_COMPASS_TERRAIN_MAX_SIZE, Math.max(64, 2 ** Math.ceil(Math.log2(Math.max(image.canvas.width, image.canvas.height)))));
      if (canvas.width !== size) canvas.width = size;
      if (canvas.height !== size) canvas.height = size;
      const context = canvas.getContext("2d");
      if (!context) { withdraw(); return; }
      context.clearRect(0, 0, size, size); context.drawImage(image.canvas, 0, 0, size, size);
      const pixels = context.getImageData(0, 0, size, size).data;
      const bytes = NATIVE_COMPASS_TERRAIN_HEADER_BYTES + pixels.length;
      // The certified wasm32 allocator returns signed i32 bits, including addresses above 2 GiB.
      const region = Number(malloc(bytes)) >>> 0;
      if (!Number.isSafeInteger(region) || region <= 0 || region % 4 !== 0 || region + bytes > memory.buffer.byteLength) {
        if (Number.isSafeInteger(region) && region > 0) free(region);
        withdraw(); return;
      }
      try {
        nextSerial = nextSerial >= 0x7ffffffe ? 1 : nextSerial + 1;
        const header = new DataView(memory.buffer, region, NATIVE_COMPASS_TERRAIN_HEADER_BYTES);
        [NATIVE_COMPASS_TERRAIN_MAGIC, bytes, area, size].forEach((value, index) => header.setUint32(index * 4, value, true));
        [-8192, 8192, NATIVE_COMPASS_TERRAIN_WORLD_SPAN].forEach((value, index) => header.setFloat32(16 + index * 4, value, true));
        header.setUint32(28, nextSerial, true);
        const output = new Uint8Array(memory.buffer, region + NATIVE_COMPASS_TERRAIN_HEADER_BYTES, pixels.length);
        for (let at = 0; at < pixels.length; at += 4) {
          output[at] = pixels[at + 2]!; output[at + 1] = pixels[at + 1]!;
          output[at + 2] = pixels[at]!; output[at + 3] = pixels[at + 3]!;
        }
        if (publish(region, bytes) === 1) version = key; else withdraw();
      } finally { free(region); }
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      try { withdraw(); } finally {
        view?.removeEventListener("gw:graphics-context-reset", withdraw);
        canvas.width = 0; canvas.height = 0;
      }
    },
  });
}
