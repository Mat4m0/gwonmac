import assert from "node:assert/strict";
import test from "node:test";
import { concat, encodeCode, encodeSection, uleb, WASM_HEADER } from "../../src/main/core/wasm-binary.js";
import { encodeName, encodeTypes, nativeFrameObserver, worldMapVisibilityObserver } from "../../src/main/certification/cartography-transform-internals.js";

function observer(body: Uint8Array, types: readonly ("i32" | "f32")[]) {
  const section = (id: number, body: Uint8Array) => encodeSection({ id, body });
  const bytes = concat(WASM_HEADER,
    section(1, encodeTypes([{ params: [], results: [] }])),
    section(3, Uint8Array.of(1, 0)),
    section(5, Uint8Array.of(1, 0, 1)),
    section(6, concat(uleb(types.length), ...types.map(type => type === "i32"
      ? Uint8Array.of(0x7f, 1, 0x41, 0, 0x0b) : Uint8Array.of(0x7d, 1, 0x43, 0, 0, 0, 0, 0x0b)))),
    section(7, concat(uleb(types.length + 2), encodeName("observe"), Uint8Array.of(0, 0),
      encodeName("memory"), Uint8Array.of(2, 0),
      ...types.map((_, i) => concat(encodeName(`g${i}`), Uint8Array.of(3), uleb(i))))),
    section(10, encodeCode([body])));
  const { exports } = new WebAssembly.Instance(new WebAssembly.Module(Uint8Array.from(bytes)));
  const memory = exports.memory;
  const run = exports.observe;
  assert.ok(memory instanceof WebAssembly.Memory && typeof run === "function");
  const global = (i: number) => { const value = exports[`g${i}`]; assert.ok(value instanceof WebAssembly.Global); return value; };
  return { run, global, memory: new DataView(memory.buffer) };
}

test("native World Map closing withdraws a retained projection without a map event", () => {
  const probe = observer(worldMapVisibilityObserver({ visible: 0, sequence: 1 }, 64), ["i32", "i32"]);
  probe.global(0).value = 1;
  probe.global(1).value = 9;
  probe.memory.setUint32(64, 0x80004, true);
  probe.run();
  assert.equal(probe.global(0).value, 1);
  assert.equal(probe.global(1).value, 9);
  probe.memory.setUint32(64, 4, true);
  probe.run();
  assert.equal(probe.global(0).value, 0);
  assert.equal(probe.global(1).value, 10);
  probe.run();
  assert.equal(probe.global(1).value, 10, "unchanged hidden state is not a new publication");
  probe.memory.setUint32(64, 0x80000, true);
  probe.run();
  assert.equal(probe.global(0).value, 0, "opening cannot resurrect stale geometry");
});

test("native map frames hide at destruction start, before removal from the frame array", () => {
  const certificate = { frameArray: 4, frameCount: 8, frameBytes: 48, frameId: 0, frameHashId: 4,
    frameState: 8, frameViewportWidth: 12, frameViewportHeight: 16,
    frameScreenLeft: 20, frameScreenBottom: 24, frameScreenRight: 28, frameScreenTop: 32, labelHash: 77 };
  const globals = { status: 0, generation: 1, frameId: 2, visible: 3,
    viewportWidth: 4, viewportHeight: 5, left: 6, bottom: 7, right: 8, top: 9 };
  const probe = observer(nativeFrameObserver(certificate, globals, 10),
    ["i32", "i32", "i32", "i32", "f32", "f32", "f32", "f32", "f32", "f32", "i32"]);
  probe.memory.setUint32(4, 64, true);
  probe.memory.setUint32(8, 1, true);
  probe.memory.setUint32(64, 128, true);
  probe.memory.setUint32(128, 0, true);
  probe.memory.setUint32(132, 77, true);
  for (const [state, visible] of [[4, 1], [12, 0], [0x204, 0], [0, 0], [4, 1]]) {
    probe.memory.setUint32(136, state!, true);
    probe.run();
    assert.equal(probe.global(0).value, 1);
    assert.equal(probe.global(3).value, visible);
  }
});
