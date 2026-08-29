import assert from "node:assert/strict";
import test from "node:test";
import { createExplorationSpikeReader } from
  "../../src/renderer/cartography-spike/exploration-observer.js";
import { EXPLORATION_SPIKE_GLOBALS } from
  "../../src/shared/cartography-spike.js";

function scalar(value: number): WebAssembly.Global {
  return new WebAssembly.Global({ value: "i32", mutable: true }, value);
}

function exportsFor(words: readonly number[]): WebAssembly.Exports {
  return {
    [EXPLORATION_SPIKE_GLOBALS.status]: scalar(1),
    [EXPLORATION_SPIKE_GLOBALS.sequence]: scalar(4),
    [EXPLORATION_SPIKE_GLOBALS.generation]: scalar(7),
    [EXPLORATION_SPIKE_GLOBALS.width]: scalar(8),
    [EXPLORATION_SPIKE_GLOBALS.height]: scalar(4),
    [EXPLORATION_SPIKE_GLOBALS.dwordCount]: scalar(1),
    [EXPLORATION_SPIKE_GLOBALS.observe]: () => undefined,
    [EXPLORATION_SPIKE_GLOBALS.readWord]: (index: number) => words[index] ?? 0,
  };
}

test("reads only bounded exploration cells", () => {
  const reader = createExplorationSpikeReader(exportsFor([0b1000_0001]));
  assert.ok(reader);
  assert.deepEqual(reader.snapshot(), {
    status: 1,
    sequence: 4,
    generation: 7,
    width: 8,
    height: 4,
    dwordCount: 1,
  });
  assert.equal(reader.isExplored(0, 0), true);
  assert.equal(reader.isExplored(7, 0), true);
  assert.equal(reader.isExplored(1, 0), false);
  assert.equal(reader.isExplored(-1, 0), null);
  assert.equal(reader.isExplored(8, 0), null);
  assert.deepEqual(reader.readBitmap(), {
    snapshot: {
      status: 1,
      sequence: 4,
      generation: 7,
      width: 8,
      height: 4,
      dwordCount: 1,
    },
    words: new Uint32Array([0b1000_0001]),
  });
});

test("refuses inconsistent exploration bounds", () => {
  const exports = exportsFor([0]);
  (exports[EXPLORATION_SPIKE_GLOBALS.width] as WebAssembly.Global).value = 64;
  (exports[EXPLORATION_SPIKE_GLOBALS.height] as WebAssembly.Global).value = 64;
  const reader = createExplorationSpikeReader(exports);
  assert.ok(reader);
  assert.equal(reader.snapshot(), null, "one dword cannot contain a 4096-cell grid");
  assert.equal(reader.isExplored(0, 0), null);
  assert.equal(reader.readBitmap(), null);
});

test("reports a bounded refusal status without exposing bitmap data", () => {
  const exports = exportsFor([0xffff_ffff]);
  (exports[EXPLORATION_SPIKE_GLOBALS.status] as WebAssembly.Global).value = 4;
  const reader = createExplorationSpikeReader(exports);
  assert.ok(reader);
  assert.equal(reader.snapshot()?.status, 4);
  assert.equal(reader.isExplored(0, 0), null);
  assert.equal(reader.readBitmap(), null);
});
