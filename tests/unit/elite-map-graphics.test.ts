/** Verifies Elite markers stay world-anchored natively and repaint only when their drawing changes. */
import assert from "node:assert/strict";
import test from "node:test";
import { createEliteMapGraphics, type EliteMapGraphicsInput } from "../../src/renderer/elite-map-graphics.js";
import { ELITE_MAP_GRAPHICS_SURFACES } from "../../src/shared/native-map-graphics.js";
import type { EliteSceneMarker } from "../../src/shared/elite-map-scene.js";

class CanvasPeer {
  width = 0; height = 0; paints = 0;
  context = new Proxy({} as Record<string, unknown>, {
    get: (target, name) => name === "getImageData"
      ? (_x: number, _y: number, width: number, height: number) => ({ data: new Uint8ClampedArray(width * height * 4) })
      : name === "clearRect" ? () => { this.paints += 1; }
      : name in target ? target[name as string] : () => {},
    set: (target, name, value) => { target[name as string] = value; return true; },
  });
  getContext() { return this.context; }
}
function peer() {
  const view = Object.assign(new EventTarget(), { devicePixelRatio: 1 });
  const canvases: CanvasPeer[] = [];
  const document = { defaultView: view, createElement(tag: string) {
    if (tag === "img") return { decode: () => new Promise(() => {}) };
    assert.equal(tag, "canvas"); const canvas = new CanvasPeer(); canvases.push(canvas); return canvas;
  } } as unknown as Document;
  const memory = new WebAssembly.Memory({ initial: 512 });
  let next = 1024;
  const published: { surface: string; width: number; height: number; corners: number[] }[] = [];
  const hidden: string[] = [];
  const exports: Record<string, unknown> = { memory, malloc: (bytes: number) => { const at = next; next += bytes + 64; return at; }, free: () => {} };
  for (const surface of [...ELITE_MAP_GRAPHICS_SURFACES, "mission"]) {
    const serial = new WebAssembly.Global({ value: "i32", mutable: true });
    exports[`gwonmac_${surface}_graphics_serial`] = serial;
    exports[`gwonmac_${surface}_graphics_hide`] = () => { serial.value = 0; hidden.push(surface); };
    exports[`gwonmac_${surface}_graphics_publish`] = (region: number) => {
      const header = new DataView(memory.buffer, region, 64);
      serial.value = header.getUint32(20, true);
      published.push({ surface, width: header.getUint32(12, true), height: header.getUint32(16, true),
        corners: Array.from({ length: 8 }, (_, index) => Math.round(header.getFloat32(32 + index * 4, true))) });
      return 1;
    };
  }
  return { graphics: createEliteMapGraphics(exports as WebAssembly.Exports, document), published, hidden, canvases };
}
const marker = (key: string, mapX: number, mapY: number, emphasis: EliteSceneMarker["emphasis"] = "match"): EliteSceneMarker =>
  ({ key, locationId: key, skillId: Number(key.length), mapId: 1, mapX, mapY, iconUrl: null, emphasis, hovered: false });
const input = (markers: readonly EliteSceneMarker[], e = -1000, a = 1): EliteMapGraphicsInput => ({ area: 7, continent: 0, pixelRatio: 2, markers,
  surface: { box: { left: 100, top: 50, width: 400, height: 300 }, transform: { a, b: 0, c: 0, d: a, e, f: -2000 * a } } });

test("markers draw in world units and a pan reuses the uploaded texture", () => {
  const { graphics, published } = peer();
  const markers = [marker("a", 1100, 2100), marker("b", 1200, 2150, "target")];
  const placed = graphics.update("mission", input(markers));
  assert.deepEqual(placed.map(item => [item.marker.key, item.x, item.y]), [["a", 100, 100], ["b", 200, 150]], "the target draws on top");
  assert.equal(published.length, 1);
  const [upload] = published;
  assert.equal(upload?.surface, "mission_elite");
  assert.ok([upload!.width, upload!.height].every(size => Number.isInteger(Math.log2(size))), "power-of-two textures upload without resampling");
  const [left, top, right, , , bottom] = upload!.corners;
  assert.ok(left! < 1100 && right! > 1200 && top! < 2100 && bottom! > 2150, "corners cover the markers in world units");
  const panned = graphics.update("mission", input(markers, -1010));
  assert.deepEqual(panned.map(item => item.x), [90, 190], "hit targets follow the pan");
  assert.equal(published.length, 1, "the native camera moves the texture; nothing uploads");
  graphics.update("mission", input(markers, -1000 * 1.01, 1.01));
  assert.equal(published.length, 1, "a zoom inside one raster step keeps the texture");
  graphics.update("mission", input(markers, -1000 * 1.1, 1.1));
  assert.equal(published.length, 2, "a larger zoom repaints at the new detail");
  graphics.update("mission", input([{ ...markers[0]!, hovered: true }, markers[1]!]));
  assert.equal(published.length, 3, "hover changes the drawing");
});

test("an off-view target moves to a small edge texture and nothing else is drawn", () => {
  const { graphics, published, hidden } = peer();
  const placed = graphics.update("mission", input([marker("far", 5000, 2100, "target"), marker("gone", 6000, 2100)]));
  assert.deepEqual(placed.map(item => [item.marker.key, item.outside, item.x]), [["far", true, 384]]);
  assert.ok(hidden.includes("mission_elite"), "no main texture without a visible marker");
  assert.equal(published.at(-1)?.surface, "mission_elite_edge");
  assert.ok(published.at(-1)!.width <= 128, "the edge arrow stays a small upload");
  graphics.update("mission", input([]));
  assert.ok(hidden.filter(surface => surface === "mission_elite_edge").length >= 1);
});

test("refuses rotated projections and withdraws only its own surfaces", () => {
  const { graphics, published, hidden } = peer();
  const rotated = input([marker("a", 1100, 2100)]);
  graphics.update("world", { ...rotated, surface: { ...rotated.surface, transform: { ...rotated.surface.transform, b: 0.5 } } });
  assert.equal(published.length, 0);
  graphics.update("mission", input([marker("a", 1100, 2100)]));
  graphics.dispose();
  assert.ok(ELITE_MAP_GRAPHICS_SURFACES.every(surface => hidden.includes(surface)));
  assert.equal(hidden.includes("mission"), false, "Cartography keeps its own texture");
});
