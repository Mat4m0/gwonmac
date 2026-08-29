import assert from "node:assert/strict";
import test from "node:test";
import { createWorldMapAnchorSpikeReader } from
  "../../src/renderer/cartography-spike/world-map-anchor-observer.js";
import { WORLD_MAP_ANCHOR_SPIKE_GLOBALS } from
  "../../src/shared/cartography-spike.js";

function scalar(type: "i32" | "f32", value: number): WebAssembly.Global {
  return new WebAssembly.Global({ value: type, mutable: true }, value);
}

function exportsFor(): WebAssembly.Exports {
  return {
    [WORLD_MAP_ANCHOR_SPIKE_GLOBALS.status]: scalar("i32", 1),
    [WORLD_MAP_ANCHOR_SPIKE_GLOBALS.generation]: scalar("i32", 7),
    [WORLD_MAP_ANCHOR_SPIKE_GLOBALS.worldAnchorX]: scalar("f32", 4_776),
    [WORLD_MAP_ANCHOR_SPIKE_GLOBALS.worldAnchorY]: scalar("f32", 4_682),
    [WORLD_MAP_ANCHOR_SPIKE_GLOBALS.observe]: () => undefined,
  };
}

test("reads a bounded pointer-free world-map anchor", () => {
  const reader = createWorldMapAnchorSpikeReader(exportsFor());
  assert.ok(reader);
  assert.deepEqual(reader.snapshot(), {
    status: 1,
    generation: 7,
    worldAnchorX: 4_776,
    worldAnchorY: 4_682,
  });
});

test("refuses an unavailable or implausible world-map anchor", () => {
  const exports = exportsFor();
  const reader = createWorldMapAnchorSpikeReader(exports);
  assert.ok(reader);
  (exports[WORLD_MAP_ANCHOR_SPIKE_GLOBALS.status] as WebAssembly.Global).value = 4;
  assert.deepEqual(reader.snapshot(), {
    status: 4,
    generation: 7,
    worldAnchorX: 4_776,
    worldAnchorY: 4_682,
  });
  (exports[WORLD_MAP_ANCHOR_SPIKE_GLOBALS.status] as WebAssembly.Global).value = 1;
  (exports[WORLD_MAP_ANCHOR_SPIKE_GLOBALS.worldAnchorX] as WebAssembly.Global).value = Infinity;
  assert.equal(reader.snapshot(), null);
});
