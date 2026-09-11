/** Certifies close-before-fade visibility and refuses a changed native owner. */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { worldMapDisplayStateAddress } from "../../src/main/certification/world-map-visibility-proof.js";
import { wasmEvidence } from "../../src/main/certification/wasm-evidence.js";
import { concat, encodeCode, encodeSection, paddedIndex, parseCode, sectionById, splitSections, WASM_HEADER } from "../../src/main/core/wasm-binary.js";

const artifact = process.env.GW_CLIENT_WASM;

test("proves the World Map display flag and rejects mismatched reads, writes, and close behavior", async () => {
  assert.ok(artifact, "GW_CLIENT_WASM must name the exact official artifact");
  const input = new Uint8Array(await readFile(artifact));
  const evidence = wasmEvidence(input);
  assert.ok(evidence);
  const address = worldMapDisplayStateAddress(evidence);
  assert.ok(address);
  const module = evidence.moduleView();
  const changed = (edit: (body: Uint8Array) => void) => {
    const sections = splitSections(input);
    const bodies = parseCode(sectionById(sections, 10));
    edit(bodies[15_919 - module.functionImportCount]!);
    const bytes = concat(WASM_HEADER, ...sections.map(section => encodeSection(
      section.id === 10 ? { id: 10, body: encodeCode(bodies) } : section)));
    const changedEvidence = wasmEvidence(bytes);
    assert.ok(changedEvidence);
    return worldMapDisplayStateAddress(changedEvidence);
  };
  assert.equal(changed(body => body.set(paddedIndex(address + 16), 220)), null);
  assert.equal(changed(body => body.set(paddedIndex(address + 16), 232)), null);
  assert.equal(changed(body => {
    body.set(paddedIndex(address + 16), 220);
    body.set(paddedIndex(address + 16), 232);
  }), address + 16, "both state operands can relocate together");
  assert.equal(changed(body => { body[228] = body[228]! ^ 1; }), null,
    "a changed close mask must not certify");
});
