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

test("instruction evidence exposes immutable bounded constant and memory operands", () => {
  const body = Uint8Array.of(
    0,
    0x41, 0x2a,
    0x28, 0x02, ...uleb(300),
    0x0b,
  );
  const [decoded] = decodeFunctions(moduleWithBody(body), []);
  assert.deepEqual(decoded?.constantSites, [{
    opcode: 0x41,
    offset: 1,
    operandStart: 2,
    operandEnd: 3,
    value: 42,
  }]);
  assert.deepEqual(decoded?.memorySites, [{
    opcode: 0x28,
    offset: 3,
    operandStart: 5,
    operandEnd: 7,
    value: 300,
    alignment: 2,
  }]);
  assert.equal(Object.isFrozen(decoded?.constantSites), true);
  assert.equal(Object.isFrozen(decoded?.memorySites), true);
  assert.equal(Object.isFrozen(decoded?.memorySites[0]), true);
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
