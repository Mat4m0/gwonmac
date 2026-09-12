/** Verifies remaining-only painting, native map coordinates and copied input cleanup. */
import assert from "node:assert/strict";
import test from "node:test";
import { createCartographyGridLayer } from "../../src/renderer/cartography-spike/cartography-grid-layer.js";
import { createNativeMapGraphicsLayer, nativeMapGraphicsCorners } from "../../src/renderer/cartography-spike/native-map-graphics-layer.js";
import { CARTOGRAPHY_BUILTIN_PRESETS } from "../../src/shared/cartography-overlay.js";
import type { CartographyGridProjection } from "../../src/renderer/cartography-spike/cartography-grid-projection.js";

class CanvasPeer {
  width = 128; height = 128;
  strokes = 0; fills = 0; texts: string[] = [];
  context = {
    setTransform() {}, clearRect: () => { this.strokes = 0; this.fills = 0; this.texts = []; }, save() {}, restore() {}, scale() {},
    beginPath() {}, rect() {}, arc() {}, clip() {}, drawImage() {}, fillRect() {}, moveTo() {}, lineTo() {}, closePath() {}, setLineDash() {},
    stroke: () => { this.strokes += 1; }, fill: () => { this.fills += 1; }, fillText: (value: string) => { this.texts.push(value); }, strokeText() {},
    getImageData: (_x: number, _y: number, width: number, height: number) => ({data: new Uint8ClampedArray(width * height * 4)}),
  };
  getContext() { return this.context; }
}
const projection: CartographyGridProjection = {
  surface: "mission-map", box: {left: 100, top: 200, width: 128, height: 128},
  clip: {kind: "rectangle"}, transform: {a: 1, b: 0, c: 0, d: 1, e: 0, f: 0},
  firstCellX: 0, lastCellX: 3, firstCellY: 0, lastCellY: 3, currentCell: {x: 1, y: 1},
};
function documentPeer() {
  const view = Object.assign(new EventTarget(), {devicePixelRatio: 1});
  const canvases: CanvasPeer[] = [];
  const document = {defaultView: view, createElement(tag: string) {
    assert.equal(tag, "canvas", "map graphics do not create positioned browser surfaces");
    const canvas = new CanvasPeer(); canvases.push(canvas); return canvas;
  }};
  return {document: document as unknown as Document, view, canvases};
}

test("explored areas paint nothing; all maps retain the chosen remaining icon and local hover", () => {
  const {document, canvases} = documentPeer();
  const layer = createCartographyGridLayer(document);
  const input = {projection, style: CARTOGRAPHY_BUILTIN_PRESETS.cartographer.style.grid, opacity: 70,
    explorationVersion: "1", revealabilityVersion: "1", isExplored: () => true, isRemaining: () => false,
    canCurrentMapReveal: () => true, canVisitedMapReveal: () => false, hoveredCell: null, revealRadius: 1 as const};
  layer.update(input);
  assert.equal(canvases[0]?.strokes, 0, "no permanent lattice, current-cell border or reveal range");
  assert.equal(canvases[0]?.fills, 0, "no explored-area wash");
  layer.update({...input, explorationVersion: "2", isExplored: (x, y) => x !== 2 || y !== 2,
    isRemaining: (x, y) => x === 2 && y === 2});
  assert.equal(canvases[0]?.strokes, 2, "one cased marker for one remaining cell");
  layer.update({...input, projection: {...projection, surface: "compass"}, explorationVersion: "3",
    isExplored: () => false, isRemaining: () => true, canCurrentMapReveal: () => false});
  assert.equal(canvases[0]?.strokes, 0, "Compass excludes unconfirmed estimates");
  layer.update({...input, projection: {...projection, surface: "compass"}, explorationVersion: "4",
    isExplored: (x, y) => x !== 2 || y !== 2, isRemaining: (x, y) => x === 2 && y === 2});
  assert.equal(canvases[0]?.strokes, 2, "Compass shows confirmed remaining cells");
  layer.update({...input, hoveredCell: {x: 2, y: 2}, revealRadius: 0});
  assert.equal(canvases[0]?.strokes, 2, "hover outlines only the selected cell");
  layer.dispose(); assert.equal(layer.image(), null); assert.equal(canvases[0]?.width, 0);
});

test("native corners preserve world coordinates through pan, zoom and window moves", () => {
  assert.deepEqual(nativeMapGraphicsCorners(projection), [0, 0, 128, 0, 128, 128, 0, 128]);
  const zoomed = {...projection, transform: {a: 2, b: 0, c: 0, d: 2, e: -200, f: -400}};
  assert.deepEqual(nativeMapGraphicsCorners(zoomed), [100, 200, 164, 200, 164, 264, 100, 264]);
  assert.deepEqual(nativeMapGraphicsCorners({...zoomed, box: {...zoomed.box, left: 400}}), nativeMapGraphicsCorners(zoomed));
  assert.equal(nativeMapGraphicsCorners({...projection, transform: {...projection.transform, a: 0}}), null);
  assert.equal(nativeMapGraphicsCorners({...projection, transform: {...projection.transform, e: NaN}}), null);
});

test("native maps cache textures and release copied input on success, refusal and exceptions", () => {
  const {document, view, canvases} = documentPeer();
  const memory = new WebAssembly.Memory({initial: 8});
  const serial = new WebAssembly.Global({value: "i32", mutable: true});
  let allocations = 0; let releases = 0; let uploads = 0; let behavior: "accept" | "refuse" | "throw" = "accept";
  const exports = {memory, gwonmac_mission_graphics_serial: serial,
    malloc: () => { allocations += 1; return 2048; }, free: () => { releases += 1; },
    gwonmac_mission_graphics_hide: () => { serial.value = 0; },
    gwonmac_mission_graphics_publish: (region: number, bytes: number) => {
      uploads += 1;
      const header = new DataView(memory.buffer, region, 64);
      assert.equal(bytes, 64 + 128 * 128 * 4); assert.equal(header.getUint32(8, true), 7);
      assert.equal(header.getFloat32(48, true), 128);
      if (behavior === "throw") throw new Error("native failure");
      if (behavior === "refuse") return 0;
      serial.value = header.getUint32(20, true); return 1;
    },
  };
  const layer = createNativeMapGraphicsLayer(exports, document);
  assert.equal(layer.available("mission"), true);
  assert.equal(layer.available("world"), false, "native availability is independent for each map");
  assert.equal(layer.available("mission_hover"), false);
  const image = new CanvasPeer();
  const input = {area: 7, continent: 2, projection, images: [{canvas: image as unknown as HTMLCanvasElement, version: "1"}]};
  layer.update("mission", input); layer.update("mission", input); assert.equal(uploads, 1);
  layer.update("mission", {...input, projection: {...projection, box: {...projection.box, left: 900}}});
  assert.equal(uploads, 1, "moving the native window does not repaint map artwork");
  view.dispatchEvent(new Event("gw:graphics-context-reset")); layer.update("mission", input); assert.equal(uploads, 2);
  behavior = "refuse"; layer.hide("mission"); layer.update("mission", input); assert.equal(serial.value, 0);
  behavior = "throw"; assert.throws(() => layer.update("mission", input), /native failure/);
  assert.equal(allocations, releases);
  layer.dispose(); layer.dispose(); assert.ok(canvases.every((canvas) => canvas.width === 0));
  const before = allocations; layer.update("mission", input); assert.equal(allocations, before);
  assert.equal(layer.available("mission"), false);
});

test("map tiles absorb small pans and zoom animation; hover uses only a small cell texture", async () => {
  const {nativeMapTileProjection, nativeMapHoverProjection} = await import("../../src/renderer/cartography-spike/native-map-tile.js");
  const view = {...projection, box: {...projection.box, width: 900, height: 600}, transform: {...projection.transform, e: -2000, f: -3000}};
  const first = nativeMapTileProjection(view);
  const panned = nativeMapTileProjection({...view, transform: {...view.transform, e: -2010, f: -3010}});
  assert.deepEqual(panned, first, "small pans do not invalidate terrain or markers");
  const zoomFrame = nativeMapTileProjection({...view, transform: {...view.transform, a: 1.001, d: 1.001}});
  assert.deepEqual(zoomFrame, first, "sub-detail zoom frames reuse the texture while native projection moves it");
  const crossed = nativeMapTileProjection({...view, transform: {...view.transform, e: -2300}});
  assert.notDeepEqual(crossed.transform, first.transform);
  const hover = nativeMapHoverProjection(view, {x: 65, y: 95}, 0);
  assert.equal(hover.box.width, 44); assert.equal(hover.box.height, 44);
  assert.deepEqual(nativeMapGraphicsCorners(hover), [2074, 3034, 2118, 3034, 2118, 3078, 2074, 3078]);
});


test("large cached map tiles retain remaining guidance above the detailed-marker budget", async () => {
  const {nativeMapTileProjection} = await import("../../src/renderer/cartography-spike/native-map-tile.js");
  for (const surface of ["mission-map", "world-map"] as const) {
    const {document, canvases} = documentPeer();
    const layer = createCartographyGridLayer(document);
    const tile = nativeMapTileProjection({...projection, surface,
      box: {...projection.box, width: 1280, height: 720},
      transform: {...projection.transform, a: 0.6, d: 0.6}});
    const input = {projection: tile, style: CARTOGRAPHY_BUILTIN_PRESETS.cartographer.style.grid,
      opacity: 70, explorationVersion: "1", revealabilityVersion: "1",
      isExplored: () => false, isRemaining: () => true, canCurrentMapReveal: () => true,
      canVisitedMapReveal: () => false, hoveredCell: null, revealRadius: 0 as const};
    layer.update(input);
    assert.ok(canvases[0]!.texts.length > 0, "overscan must not blank remaining guidance");
    assert.ok(canvases[0]!.texts.length <= 4096, "cluster artwork remains bounded");
    assert.ok(canvases[0]!.texts.every(value => value === "16"), "clusters retain exact current-map counts");
    const large = nativeMapTileProjection({...projection, surface,
      box: {...projection.box, width: 8000, height: 4000},
      transform: {...projection.transform, a: 0.6, d: 0.6}});
    layer.update({...input, projection: large});
    assert.ok(canvases[0]!.texts.length > 0 && canvases[0]!.texts.length <= 4096,
      "very large tiles select larger clusters within the artwork budget");
    layer.update({...input, explorationVersion: "2", isExplored: () => true, isRemaining: () => false});
    assert.equal(canvases[0]!.texts.length, 0, "explored tiles remain clear");
    layer.dispose();
  }
});


test("map disposal drains every surface and canvas when one native withdrawal throws", () => {
  const {document, view, canvases} = documentPeer();
  const withdrawn: string[] = [];
  const exports = Object.fromEntries(["mission", "world"].flatMap(name => [
    [`gwonmac_${name}_graphics_publish`, (): number => 1],
    [`gwonmac_${name}_graphics_hide`, (): void => { withdrawn.push(name); if (name === "world") throw new Error("native failure"); }],
    [`gwonmac_${name}_graphics_serial`, new WebAssembly.Global({value: "i32"})],
  ]));
  const layer = createNativeMapGraphicsLayer(exports, document);
  assert.equal(layer.available("mission"), false, "copied-input allocator is part of availability");
  assert.throws(() => layer.dispose(), /Maps cleanup failed/);
  assert.deepEqual(withdrawn.sort(), ["mission", "world"]);
  assert.ok(canvases.every(canvas => canvas.width === 0 && canvas.height === 0));
  layer.dispose();
  view.dispatchEvent(new Event("gw:graphics-context-reset"));
  assert.equal(withdrawn.length, 2, "dispose remains final even after a native release error");
});


test("native maps and Compass ranges upload and free copied pixels above 2 GiB", async () => {
  const {createNativeCompassRangesLayer} = await import("../../src/renderer/cartography-spike/native-compass-ranges-layer.js");
  const {document} = documentPeer();
  const address = 0x8000_1000;
  // WebAssembly reserves virtual pages; this fixture touches only the small upload region.
  const memory = new WebAssembly.Memory({initial: 32832});
  const freed: number[] = [];
  const published: string[] = [];
  const serial = new WebAssembly.Global({value: "i32", mutable: true});
  const area = new WebAssembly.Global({value: "i32", mutable: true});
  const inspect = (kind: string, region: number, bytes: number, serialOffset: number) => {
    assert.equal(region, address);
    const header = new DataView(memory.buffer, region, bytes);
    assert.equal(header.getUint32(4, true), bytes);
    assert.equal(header.getUint32(8, true), 7);
    serial.value = header.getUint32(serialOffset, true);
    area.value = 7;
    published.push(kind);
    return 1;
  };
  const common = {memory, malloc: () => address | 0, free: (region: number) => { freed.push(region); }};
  const map = createNativeMapGraphicsLayer({...common,
    gwonmac_mission_graphics_serial: serial,
    gwonmac_mission_graphics_hide: () => { serial.value = 0; },
    gwonmac_mission_graphics_publish: (region: number, bytes: number) => inspect("mission", region, bytes, 20),
  }, document);
  const range = createNativeCompassRangesLayer({...common,
    gwonmac_compass_ranges_serial: serial, gwonmac_compass_ranges_area: area,
    gwonmac_compass_ranges_hide: () => { serial.value = 0; },
    gwonmac_compass_ranges_publish: (region: number, bytes: number) => inspect("ranges", region, bytes, 28),
  }, document);
  const image = {canvas: new CanvasPeer() as unknown as HTMLCanvasElement, version: "1"};
  map.update("mission", {area: 7, continent: 2, projection, images: [image]});
  range.update(image, 7);
  assert.deepEqual(published, ["mission", "ranges"]);
  assert.deepEqual(freed, [address, address]);
  map.dispose(); range.dispose();
});
