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
  const published: { surface: string; width: number; height: number; corners: number[]; quads: number[][] }[] = [];
  const hidden: string[] = [];
  const exports: Record<string, unknown> = { memory, malloc: (bytes: number) => { const at = next; next += bytes + 64; return at; }, free: () => {} };
  for (const surface of [...ELITE_MAP_GRAPHICS_SURFACES, "mission"]) {
    const serial = new WebAssembly.Global({ value: "i32", mutable: true });
    exports[`gwonmac_${surface}_graphics_serial`] = serial;
    exports[`gwonmac_${surface}_graphics_hide`] = () => { serial.value = 0; hidden.push(surface); };
    exports[`gwonmac_${surface}_graphics_publish`] = (region: number) => {
      const header = new DataView(memory.buffer, region, 64);
      serial.value = header.getUint32(20, true);
      const count = header.getUint32(28, true); const floats = new DataView(memory.buffer, region + 64, count * 32);
      published.push({ surface, width: header.getUint32(12, true), height: header.getUint32(16, true),
        corners: Array.from({ length: 8 }, (_, index) => Math.round(header.getFloat32(32 + index * 4, true))),
        quads: Array.from({ length: count }, (_, quad) => Array.from({ length: 8 }, (_, index) => floats.getFloat32((quad * 8 + index) * 4, true))) });
      return 1;
    };
  }
  return { graphics: createEliteMapGraphics(exports as WebAssembly.Exports, document), published, hidden, canvases, view };
}
const marker = (key: string, mapX: number, mapY: number, emphasis: EliteSceneMarker["emphasis"] = "match"): EliteSceneMarker =>
  ({ key, locationId: key, skillId: Number(key.length), mapId: 1, mapX, mapY, iconUrl: null, emphasis, hovered: false, captured: false, position: null });
const input = (markers: readonly EliteSceneMarker[], e = -1000, a = 1): EliteMapGraphicsInput => ({ area: 7, continent: 0, pixelRatio: 2, zoom: 0, markers,
  surface: { box: { left: 100, top: 50, width: 400, height: 300 }, transform: { a, b: 0, c: 0, d: a, e, f: -2000 * a } } });

test("each marker is one world rectangle from a screen-resolution atlas; a pan uploads nothing", () => {
  const { graphics, published } = peer();
  const markers = [marker("a", 1100, 2100), marker("b", 1200, 2150, "target")];
  const placed = graphics.update("mission", input(markers));
  assert.deepEqual(placed.map(item => [item.marker.key, item.x, item.y]), [["a", 100, 100], ["b", 200, 150]], "the target draws on top");
  assert.equal(published.length, 1);
  const [upload] = published;
  assert.equal(upload?.surface, "mission_elite");
  assert.ok([upload!.width, upload!.height].every(size => Number.isInteger(Math.log2(size))), "power-of-two textures upload without resampling");
  assert.equal(upload!.quads.length, 2, "one rectangle per marker");
  const [x0, y0, x1, y1, u0, v0, u1, v1] = upload!.quads[0]!;
  assert.equal((x0! + x1!) / 2, 1100); assert.equal((y0! + y1!) / 2, 2100);
  assert.equal(x1! - x0!, 52, "at 1 pixel per map unit a 104-texel cell at ratio 2 covers 52 map units");
  assert.ok(u0! >= 0 && v0! >= 0 && u1! <= 1 && v1! <= 1 && u1! > u0!);
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
  assert.equal(published.find(item => item.surface === "mission_elite")?.quads.length, 1, "the arrow owns the target; others stay in world units");
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

test("a loaded icon, a near-edge target and several target spawns each draw exactly once", () => {
  const { graphics, published, hidden } = peer();
  const plain = marker("a", 1100, 2100);
  graphics.update("mission", input([plain]));
  graphics.update("mission", input([{ ...plain, iconUrl: "data:image/png;base64,AA" }]));
  assert.equal(published.length, 2, "an icon arriving from the catalogue repaints the placeholder");
  const near = marker("near", 1392, 2100, "target");
  const edge = graphics.update("mission", input([near]));
  assert.deepEqual(edge.map(item => item.outside), [true]);
  assert.equal(published.at(-1)?.surface, "mission_elite_edge", "the edge texture shows a target inside the edge band");
  assert.ok(hidden.includes("mission_elite"), "and no rectangle draws it a second time");
  const spawns = graphics.update("mission", input([marker("t:0", 5000, 2100, "target"), marker("t:1", 1100, 9000, "target")]));
  assert.equal(spawns.length, 1, "several off-view spawn points share one arrow and one hit target");
});

test("markers grow with the game's zoom, and a hovered boss's positions are joined by dots beneath the icons", () => {
  const { graphics, published } = peer();
  const spawn = (key: string, x: number, hovered = false): EliteSceneMarker => ({ ...marker(key, x, 2100), locationId: "boss", hovered });
  const zoomed = graphics.update("mission", { ...input([spawn("boss:0", 1100), spawn("boss:1", 1250)]), zoom: 1 });
  assert.deepEqual(zoomed.map(item => item.size), [32, 32], "18-pixel markers grow 1.8× fully zoomed in");
  assert.equal(published.at(-1)?.quads.length, 2, "no link without hover or target");
  graphics.update("mission", { ...input([spawn("boss:0", 1100, true), spawn("boss:1", 1250, true)]), zoom: 1 });
  const quads = published.at(-1)!.quads;
  const dots = quads.slice(0, -2);
  assert.ok(dots.length >= 8, "a 150-pixel link carries a row of dots");
  assert.ok(dots.every(([x0, y0, x1, y1]) => x0! > 1100 && x1! < 1250 && (y0! + y1!) / 2 === 2100), "dots lie between the two positions");
  assert.ok(dots.every(([x0, , x1]) => x1! - x0! < 16), "dots are small quads, not icon cells");
});

test("a full atlas keeps the target, links survive an edge target, and a context reset republishes", () => {
  const { graphics, published, view } = peer();
  const crowd = Array.from({ length: 120 }, (_, index) => ({ ...marker(`m${index}`, 1000 + index * 3, 2100), iconUrl: `icon-${index}` }));
  graphics.update("mission", { ...input([...crowd, { ...marker("goal", 1300, 2200, "target"), iconUrl: "goal" }]), pixelRatio: 3, zoom: 1 });
  const cells = published.at(-1)!.quads.length;
  assert.ok(cells < 121, "this atlas cannot hold every look");
  graphics.update("mission", { ...input([{ ...marker("goal", 1300, 2200, "target"), iconUrl: "goal" }]), pixelRatio: 3, zoom: 1 });
  const alone = published.at(-1)!.quads[0]!;
  graphics.update("mission", { ...input([...crowd, { ...marker("goal", 1300, 2200, "target"), iconUrl: "goal" }]), pixelRatio: 3, zoom: 1 });
  assert.ok(published.at(-1)!.quads.some(quad => quad[0] === alone[0] && quad[1] === alone[1]), "the target keeps a cell when looks overflow");

  const spawn = (key: string, x: number): EliteSceneMarker => ({ ...marker(key, x, 2100, "target"), locationId: "boss" });
  // The view spans x 1000–1400; a position at 1392 sits in the edge band and becomes the arrow.
  graphics.update("mission", input([spawn("boss:0", 1200), spawn("boss:1", 1392)]));
  const edgeCase = published.filter(item => item.surface === "mission_elite").at(-1)!;
  assert.ok(edgeCase.quads.length > 1, "dots still join the position shown as the edge arrow");
  const before = published.length;
  graphics.update("mission", input([spawn("boss:0", 1200), spawn("boss:1", 1392)]));
  assert.equal(published.length, before, "an unchanged frame publishes nothing");
  view.dispatchEvent(new Event("gw:graphics-context-reset"));
  graphics.update("mission", input([spawn("boss:0", 1200), spawn("boss:1", 1392)]));
  assert.ok(published.length > before, "a context reset republishes from the cached computation");
});

test("the edge arrow texture grows with the zoomed marker", () => {
  const { graphics, published } = peer();
  graphics.update("mission", { ...input([marker("far", 5000, 2100, "target")]), zoom: 0 });
  const small = published.filter(item => item.surface === "mission_elite_edge").at(-1)!.width;
  graphics.update("mission", { ...input([{ ...marker("far", 5000, 2100, "target"), hovered: true }]), zoom: 1 });
  const large = published.filter(item => item.surface === "mission_elite_edge").at(-1)!.width;
  assert.ok(large > small, "a grown, hovered target gets a larger arrow texture");
});
