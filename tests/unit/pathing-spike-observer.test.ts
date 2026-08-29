import assert from "node:assert/strict";
import test from "node:test";
import {
  PATHING_SPIKE_GLOBALS,
} from "../../src/shared/cartography-spike.js";
import { createPathingSpikeReader } from
  "../../src/renderer/cartography-spike/pathing-observer.js";

function scalar(value: number, type: WebAssembly.ValueType = "i32"): WebAssembly.Global {
  return new WebAssembly.Global({ value: type, mutable: true }, value);
}

function completeExports(): WebAssembly.Exports {
  return Object.fromEntries([
    [PATHING_SPIKE_GLOBALS.status, scalar(1)],
    [PATHING_SPIKE_GLOBALS.sequence, scalar(2)],
    [PATHING_SPIKE_GLOBALS.callCount, scalar(8)],
    [PATHING_SPIKE_GLOBALS.totalTrapezoids, scalar(400)],
    [PATHING_SPIKE_GLOBALS.sampledMapTrapezoids, scalar(120)],
    [PATHING_SPIKE_GLOBALS.sampledMapZplane, scalar(-1)],
    [PATHING_SPIKE_GLOBALS.generation, scalar(3)],
    [PATHING_SPIKE_GLOBALS.reset, (() => undefined) as WebAssembly.ExportValue],
    [PATHING_SPIKE_GLOBALS.readCoordinate, ((index: number) => index + 0.5) as WebAssembly.ExportValue],
    ...PATHING_SPIKE_GLOBALS.samples.flat().map((name, index) => [name, scalar(index + 0.5, "f32")]),
  ]);
}

test("reads only the fixed scalar pathing surface", () => {
  const read = createPathingSpikeReader(completeExports());
  assert.ok(read);
  assert.deepEqual(read.snapshot(), {
    status: 1,
    sequence: 2,
    callCount: 8,
    totalTrapezoids: 400,
    sampledMapTrapezoids: 120,
    sampledMapZplane: -1,
    generation: 3,
    samples: [
      [0.5, 1.5, 2.5, 3.5, 4.5, 5.5],
      [6.5, 7.5, 8.5, 9.5, 10.5, 11.5],
      [12.5, 13.5, 14.5, 15.5, 16.5, 17.5],
    ],
  });
});

test("refuses incomplete or non-finite scalar surfaces", () => {
  const incomplete = completeExports();
  delete incomplete[PATHING_SPIKE_GLOBALS.samples[0]![0]!];
  assert.equal(createPathingSpikeReader(incomplete), null);

  const invalid = completeExports();
  invalid[PATHING_SPIKE_GLOBALS.samples[0]![0]!] = scalar(Number.NaN, "f32");
  assert.equal(createPathingSpikeReader(invalid)?.snapshot(), null);
});

test("refuses malformed complete geometry", () => {
  const exports = completeExports();
  exports[PATHING_SPIKE_GLOBALS.totalTrapezoids] = scalar(1);
  exports[PATHING_SPIKE_GLOBALS.readCoordinate] = ((index: number) =>
    [10, 5, 0, 10, 5, 20][index]) as WebAssembly.ExportValue;
  assert.equal(createPathingSpikeReader(exports)?.readLargestGeometry(), null);
});

test("contains a stale native geometry read", () => {
  const exports = completeExports();
  exports[PATHING_SPIKE_GLOBALS.totalTrapezoids] = scalar(1);
  exports[PATHING_SPIKE_GLOBALS.readCoordinate] = (() => {
    throw new WebAssembly.RuntimeError("stale pathing pointer");
  }) as WebAssembly.ExportValue;
  assert.equal(createPathingSpikeReader(exports)?.readLargestGeometry(), null);
});
