/**
 * Locks the bounded, copy-only contract of shared initialized-data evidence.
 * Synthetic memory makes adversarial cardinality deterministic and cheap.
 */
import assert from "node:assert/strict";
import test from "node:test";
import type { ModuleShape } from "../../src/main/certification/enhancement-evidence-types.js";
import { WasmDataEvidence } from "../../src/main/certification/wasm-data-evidence.js";

function moduleWithData(bytes: Uint8Array, base = 0): ModuleShape {
  return {
    types: [],
    functionTypeIndices: [],
    functionImportCount: 0,
    bodies: [],
    exports: [],
    importSection: null,
    memorySection: Uint8Array.of(1, 0, 1),
    tableSection: null,
    elementSection: null,
    dataSegments: [{ base, bytes }],
  };
}

test("initialized-data reads return copies and bound C strings", () => {
  const source = new Uint8Array(4_099);
  source.fill(65);
  source[source.byteLength - 1] = 0;
  const evidence = new WasmDataEvidence(moduleWithData(source));

  const copy = evidence.readBytes(0, 2);
  assert.ok(copy);
  copy[0] = 0;
  assert.deepEqual(evidence.readBytes(0, 2), Uint8Array.of(65, 65));
  assert.equal(evidence.readCString(0), null);
});

test("initialized-data occurrence queries reject empty and excessive evidence", () => {
  const evidence = new WasmDataEvidence(
    moduleWithData(new Uint8Array(4_097).fill(7)),
  );
  assert.throws(() => evidence.addresses(new Uint8Array()), /module-shape-unsupported/u);
  assert.throws(
    () => evidence.addresses(Uint8Array.of(7)),
    /analysis-limit-exceeded/u,
  );
});

test("initialized data and the derived BSS boundary relocate together", () => {
  const bytes = Uint8Array.of(11, 12, 13, 0);
  const original = new WasmDataEvidence(moduleWithData(bytes, 32));
  const relocated = new WasmDataEvidence(moduleWithData(bytes, 1_040));

  assert.deepEqual(original.readBytes(32, 4), bytes);
  assert.deepEqual(relocated.readBytes(1_040, 4), bytes);
  assert.deepEqual(original.addresses(Uint8Array.of(12, 13)), [33]);
  assert.deepEqual(relocated.addresses(Uint8Array.of(12, 13)), [1_041]);
  assert.equal(relocated.initializedDataEnd - original.initializedDataEnd, 1_008);
  assert.equal(relocated.zeroInitializedBase - original.zeroInitializedBase, 1_008);
  assert.equal(relocated.readBytes(32, 4), null);
});
