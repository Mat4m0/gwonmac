// A WASM abort is the one failure the flight recorder used to see only as a
// timestamp: the Emscripten abort argument is prose, and prose may not cross
// IPC or enter the export. What crosses instead is a closed reason kind plus
// an FNV-1a fingerprint. These tests pin the two halves of that bargain:
// every reason collapses into the declared vocabulary, and every fingerprint
// the renderer can produce is one the boundary validator accepts.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  classifyWasmAbortReason,
  wasmAbortFingerprint,
} from "../../src/renderer/wasm-abort-reason.ts";
import { WASM_ABORT_REASON_KINDS } from "../../src/shared/diagnostics.ts";
import {
  asRendererFingerprint,
  diagnosticEventRecord,
} from "../../src/main/diagnostics/schema.ts";

describe("wasm abort reasons collapse into the closed vocabulary", () => {
  it("names the failure class of each known Emscripten abort shape", () => {
    const cases: [unknown, string][] = [
      ["Aborted(Assertion failed: agent->type == kAgentLiving)", "assertion"],
      ["RuntimeError: null function or function signature mismatch", "indirectCall"],
      ["RuntimeError: table index is out of bounds", "indirectCall"],
      ["RuntimeError: memory access out of bounds", "memoryBounds"],
      ["RuntimeError: unreachable", "unreachable"],
      ["RangeError: Maximum call stack size exceeded", "stackOverflow"],
      ["Aborted(OOM)", "oom"],
      ["Cannot enlarge memory arrays to size 2147483648", "oom"],
      ["Aborted(native code called abort())", "nativeAbort"],
      [undefined, "unspecified"],
      [null, "unspecified"],
      ["", "unspecified"],
      ["something entirely new", "other"],
    ];
    for (const [reason, expected] of cases) {
      assert.equal(classifyWasmAbortReason(reason), expected, String(reason));
    }
  });

  it("classifies an Error by its name and message", () => {
    const trap = new WebAssembly.RuntimeError("unreachable");
    assert.equal(classifyWasmAbortReason(trap), "unreachable");
  });

  it("never invents a kind outside the declared union", () => {
    const inputs = [
      undefined,
      42,
      {},
      new Error("x"),
      "ASSERTION FAILED IN UPPERCASE",
    ];
    const declared: readonly string[] = WASM_ABORT_REASON_KINDS;
    for (const input of inputs) {
      assert.equal(declared.includes(classifyWasmAbortReason(input)), true);
    }
  });
});

describe("wasm abort fingerprints", () => {
  it("always satisfy the boundary validator, whatever the reason was", () => {
    const inputs = [
      undefined,
      "",
      "Aborted(Assertion failed)",
      new Error("boom"),
      "☃".repeat(10_000),
    ];
    for (const input of inputs) {
      // Throws if the shape ever drifts from the declared 8-hex form.
      asRendererFingerprint(wasmAbortFingerprint(input));
    }
  });

  it("cluster identical causes and separate different ones", () => {
    const a = wasmAbortFingerprint("Aborted(Assertion failed: x)");
    assert.equal(a, wasmAbortFingerprint("Aborted(Assertion failed: x)"));
    assert.notEqual(a, wasmAbortFingerprint("Aborted(Assertion failed: y)"));
  });
});

describe("the recorded abort event", () => {
  it("is an error-level renderer event carrying kind, fingerprint, and heap", () => {
    assert.deepEqual(
      diagnosticEventRecord({
        k: "wasm.abort",
        clockSynchronized: true,
        reasonKind: "indirectCall",
        fingerprint: asRendererFingerprint(wasmAbortFingerprint("x")),
        heapBytes: 2_147_483_648,
      }),
      {
        subsystem: "renderer",
        level: "error",
        name: "wasm.abort",
        fields: {
          clockSynchronized: true,
          reasonKind: "indirectCall",
          fingerprint: wasmAbortFingerprint("x"),
          heapBytes: 2_147_483_648,
        },
      },
    );
  });
});

describe("the recorded heap staircase", () => {
  it("is an info-level renderer event carrying both sides of a growth step", () => {
    assert.deepEqual(
      diagnosticEventRecord({
        k: "wasm.heapGrew",
        fromBytes: 1_879_048_192,
        toBytes: 1_979_711_488,
      }),
      {
        subsystem: "renderer",
        level: "info",
        name: "wasm.heapGrew",
        fields: { fromBytes: 1_879_048_192, toBytes: 1_979_711_488 },
      },
    );
  });
});
