/**
 * Exercises shared evidence ceilings before large inputs can amplify on heap.
 * The fixtures are synthetic and refuse through the evidence parser itself.
 */
import assert from "node:assert/strict";
import test from "node:test";
import type { ModuleShape } from "../../src/main/certification/enhancement-evidence-types.js";
import {
  activeTableEvidence,
  decodeFunctions,
} from "../../src/main/certification/wasm-evidence.js";
import { WasmDataEvidence } from "../../src/main/certification/wasm-data-evidence.js";
import { concat, uleb } from "../../src/main/core/wasm-binary.js";

function moduleWithBody(body: Uint8Array): ModuleShape {
  return {
    types: [{ params: [], results: [] }],
    functionTypeIndices: [0],
    functionImportCount: 0,
    bodies: [body],
    exports: [],
    importSection: null,
    memorySection: null,
    tableSection: null,
    elementSection: null,
    dataSegments: [],
  };
}

test("direct-call evidence refuses before its allocation ceiling is crossed", () => {
  const calls = 250_001;
  const body = new Uint8Array(1 + calls * 2 + 1);
  for (let index = 0; index < calls; index += 1) {
    body[1 + index * 2] = 0x10;
  }
  body[body.byteLength - 1] = 0x0b;
  assert.throws(
    () => decodeFunctions(moduleWithBody(body), []),
    /analysis-limit-exceeded/u,
  );
});

test("active-table evidence refuses excessive entries and unsupported forms", () => {
  const excessiveEntries = concat(
    uleb(1),
    uleb(0),
    Uint8Array.of(0x41, 0, 0x0b),
    uleb(100_001),
  );
  assert.throws(() => activeTableEvidence(excessiveEntries), /analysis-limit-exceeded/u);
  assert.throws(
    () => activeTableEvidence(Uint8Array.of(1, 4)),
    /active-table-unsupported/u,
  );
});

test("linear-memory evidence refuses valid encodings outside its supported form", () => {
  const module = moduleWithBody(Uint8Array.of(0, 0x0b));
  const unsupported = { ...module, memorySection: Uint8Array.of(1, 3, 1, 1) };
  assert.throws(() => new WasmDataEvidence(unsupported), /module-shape-unsupported/u);
});
