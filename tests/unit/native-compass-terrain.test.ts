/** Verifies tile stability, bounded uploads and renderer cleanup without a live client. */
import assert from "node:assert/strict";
import { CARTOGRAPHY_BUILTIN_PRESETS } from "../../src/shared/cartography-overlay.js";
import test from "node:test";
import { createNativeCompassTerrainLayer, nativeCompassTerrainTile, type NativeCompassTerrainInput } from "../../src/renderer/cartography-spike/native-compass-terrain-layer.js";
import { NATIVE_COMPASS_TERRAIN_HEADER_BYTES, NATIVE_COMPASS_TERRAIN_MAGIC } from "../../src/shared/native-compass-terrain.js";

test("nearby camera motion reuses a bounded terrain tile with a full Compass margin", () => {
  const input = {cameraX: 0, cameraY: 0, width: 245, height: 245, scaleX: 1, scaleY: 1, dpr: 2};
  const initial = nativeCompassTerrainTile(input); assert.ok(initial);
  assert.deepEqual(nativeCompassTerrainTile({...input, cameraX: 2000, cameraY: -2000}), initial);
  const moved = nativeCompassTerrainTile({...input, cameraX: 2100}); assert.ok(moved);
  assert.equal(moved.left - initial.left, 4096);
  assert.ok(2100 - moved.left > 4500 && moved.left + 16384 - 2100 > 4500);
  assert.equal(initial.size & (initial.size - 1), 0);
  assert.equal(nativeCompassTerrainTile({...input, cameraX: NaN}), null);
  assert.equal(nativeCompassTerrainTile({...input, width: 0}), null);
  assert.equal(nativeCompassTerrainTile({...input, scaleX: 1000}), null);
});

class CanvasPeer {
  width = 0; height = 0;
  context = {
    setTransform() {}, clearRect() {}, save() {}, restore() {}, scale() {},
    beginPath() {}, rect() {}, arc() {}, clip() {}, drawImage() {}, fillRect() {},
    moveTo() {}, lineTo() {}, closePath() {}, stroke() {}, setLineDash() {},
    getImageData: (_x: number, _y: number, width: number, height: number) => {
      const data = new Uint8ClampedArray(width * height * 4); data.set([17, 34, 51, 128]); return {data};
    },
  };
  getContext() { return this.context; }
}

for (const address of [2048, 0x8000_0800]) {
test(`native terrain uploads and frees copied input at wasm32 address ${address.toString(16)}`, () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "window");
  const peer = new EventTarget(); Object.defineProperty(globalThis, "window", {configurable: true, value: peer});
  try {
    const canvases: CanvasPeer[] = [];
    const document = {defaultView: {devicePixelRatio: 1}, createElement() { const canvas = new CanvasPeer(); canvases.push(canvas); return canvas; }};
    const memory = new WebAssembly.Memory({initial: Math.ceil((address + 4 * 1024 * 1024) / 65536)});
    const globals = Object.fromEntries(["area", "serial", "updates", "uploads", "created", "destroyed", "size", "camera_x", "camera_y", "width", "height"].map((name) => [
      `gwonmac_compass_terrain_${name}`, new WebAssembly.Global({value: ["camera_x", "camera_y", "width", "height"].includes(name) ? "f32" : "i32", mutable: true}, ["width", "height"].includes(name) ? 245 : 0),
    ]));
    const global = (name: string) => { const value = globals[`gwonmac_compass_terrain_${name}`]; assert.ok(value); return value; };
    let allocations = 0; let releases = 0; let uploads = 0; let fail = false;
    const exports = {...globals, memory,
      malloc: (bytes: number) => { assert.ok(bytes <= 4 * 1024 * 1024 - 2048); allocations += 1; return address | 0; },
      free: (region: number) => { assert.equal(region, address); releases += 1; },
      gwonmac_compass_terrain_hide: () => { global("area").value = 0; },
      gwonmac_compass_terrain_publish: (region: number, bytes: number) => {
        assert.equal(region, address, "signed allocator bits become an unsigned byte offset");
        if (fail) throw new Error("native refusal");
        const header = new DataView(memory.buffer, region, NATIVE_COMPASS_TERRAIN_HEADER_BYTES);
        assert.equal(header.getUint32(0, true), NATIVE_COMPASS_TERRAIN_MAGIC);
        assert.equal(header.getUint32(4, true), bytes);
        assert.deepEqual([...new Uint8Array(memory.buffer, region + 32, 4)], [51, 34, 17, 128]);
        global("area").value = header.getUint32(8, true); global("serial").value = header.getUint32(28, true);
        global("uploads").value = ++uploads; return 1;
      },
    };
    // Test-only DOM boundary: the painter peer implements its canvas operations.
    const layer = createNativeCompassTerrainLayer(exports, document as unknown as Document);
    assert.equal(layer.available(), true);
    assert.equal(createNativeCompassTerrainLayer({}, document as unknown as Document).available(), false);
    const input = {area: 7, version: "7:1", anchorX: 100, anchorY: 200, scaleX: 1, scaleY: 1, opacity: 40,
      style: {veilColor: "#081014", boundaryColor: "#F2A900", boundaryWidth: 1, boundaryCasingColor: "#FFFFFF"},
      terrain: {canvas: new CanvasPeer() as unknown as HTMLCanvasElement, mapLeft: 0, mapTop: 0, mapUnitsPerPixel: 2},
    } satisfies NativeCompassTerrainInput;
    layer.update(input); assert.equal(uploads, 1);
    global("camera_x").value = 1000; layer.update(input); assert.equal(uploads, 1);
    global("camera_x").value = 3000; layer.update(input); assert.equal(uploads, 2);
    const inspection = {...input, inspectionRadius: 1 as const, cartography: {
      style: CARTOGRAPHY_BUILTIN_PRESETS.cartographer.style.grid, opacity: 45,
      explorationVersion: "1", revealabilityVersion: "1", isExplored: () => true,
      isRemaining: () => false, canCurrentMapReveal: () => false, canVisitedMapReveal: () => false,
    }};
    layer.update(inspection); assert.equal(uploads, 3);
    global("camera_x").value = 3100; layer.update(inspection);
    assert.equal(uploads, 3, "inspection follows native camera without subcell repaint");
    global("camera_x").value = 6000; layer.update(inspection);
    assert.equal(uploads, 4, "a newly selected inspection cell repaints within the same cached tile");
    assert.equal(allocations, releases);
    peer.dispatchEvent(new Event("gw:graphics-context-reset"));
    assert.equal(window.gwNativeCompassTerrainStats?.().status, "hidden");
    fail = true; assert.throws(() => layer.update(input), /native refusal/); assert.equal(allocations, releases);
    layer.dispose(); layer.dispose(); assert.equal(window.gwNativeCompassTerrainStats, undefined);
    assert.equal(layer.available(), false);
    assert.ok(canvases.every((canvas) => canvas.width === 0 && canvas.height === 0));
    const before = allocations; layer.update(input); assert.equal(allocations, before);
    global("area").value = 9; peer.dispatchEvent(new Event("gw:graphics-context-reset")); assert.equal(global("area").value, 9);
  } finally {
    if (previous) Object.defineProperty(globalThis, "window", previous); else Reflect.deleteProperty(globalThis, "window");
  }
});

}
