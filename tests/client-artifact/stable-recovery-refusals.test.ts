/** Reject upstream changes to the October native gate and Hero panel messages. */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { isLocalClientVerification, verifyLocalClientBytes } from "../../src/main/certification/local-client-verifier.js";
import {
  concat, encodeCode, encodeSection, parseCode, sectionById, splitSections, WASM_HEADER,
} from "../../src/main/core/wasm-binary.js";
import { wasmEvidence } from "../../src/main/certification/wasm-evidence.js";

const OCTOBER_CLIENT = "266b5a8aa88fe6440b10737d3eda27f4ceae2401d51d263debc0bca5c2075d87";

test("changed native Team gate or Hero panel message refuses live integration", {
  timeout: 120_000,
}, async () => {
  assert.ok(process.env.GW_CLIENT_WASM, "GW_CLIENT_WASM must name the retained October artifact");
  const input = new Uint8Array(await readFile(process.env.GW_CLIENT_WASM));
  const evidence = wasmEvidence(input);
  assert.ok(evidence);
  assert.equal(evidence.inputSha256, OCTOBER_CLIENT);
  const original = verifyLocalClientBytes(input);
  assert.equal(original.fileVerdict?.status, "proved");
  for (const verdict of Object.values(original.featureVerdicts!)) {
    assert.equal(verdict.status, "proved");
  }

  // These coordinates identify the retained regression fixture, not runtime
  // authority. Alter a real native predicate and a real native message ID.
  for (const mutation of [
    { functionIndex: 9514, offset: 14, value: 4 },
    { functionIndex: 16552, offset: 128, value: 0xa4 },
  ]) {
    const sections = splitSections(input);
    const bodies = parseCode(sectionById(sections, 10));
    bodies[mutation.functionIndex - evidence.moduleView().functionImportCount]![mutation.offset] = mutation.value;
    const changed = concat(WASM_HEADER, ...sections.map((section) => encodeSection(
      section.id === 10 ? { id: 10, body: encodeCode(bodies) } : section,
    )));
    assert.equal(WebAssembly.validate(Uint8Array.from(changed)), true);
    const result = verifyLocalClientBytes(changed);
    assert.equal(result.fileVerdict?.status, "proved");
    assert.equal(result.featureVerdicts!.nativeCursor.status, "proved");
    assert.equal(result.featureVerdicts!.partyObservation.status, "changed");
    assert.equal(result.featureVerdicts!.teamApply.status, "changed");
  }
});


test("retaining the October record preserves the previous Stable client proof", {
  timeout: 120_000,
  skip: process.env.GW_PREVIOUS_CLIENT_WASM === undefined
    ? "GW_PREVIOUS_CLIENT_WASM must explicitly name the previous Stable fixture" : false,
}, async () => {
  const input = new Uint8Array(await readFile(process.env.GW_PREVIOUS_CLIENT_WASM!));
  const result = verifyLocalClientBytes(input);
  assert.equal(isLocalClientVerification(result, result.officialSha256), true);
  assert.equal(result.fileVerdict?.status, "proved");
  for (const verdict of Object.values(result.featureVerdicts!)) {
    assert.equal(verdict.status, "proved");
  }
});
