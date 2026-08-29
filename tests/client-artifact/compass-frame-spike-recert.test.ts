/** The development Compass locator refuses exact-client body mutations. */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { ENHANCEMENT_BUILDS } from
  "../../src/main/certification/enhancement-builds.js";
import { deriveCompassFrameSpikeProof } from
  "../../src/main/certification/compass-frame-spike-proof.js";
import { wasmEvidence } from
  "../../src/main/certification/wasm-evidence.js";
import {
  concat,
  encodeCode,
  encodeSection,
  indexOfBytes,
  paddedIndex,
  parseCode,
  sectionById,
  splitSections,
  WASM_HEADER,
} from "../../src/main/core/wasm-binary.js";

function rewriteCode(
  input: Uint8Array,
  edit: (bodies: Uint8Array[]) => void,
): Uint8Array {
  const sections = splitSections(input);
  const bodies = parseCode(sectionById(sections, 10));
  edit(bodies);
  return concat(WASM_HEADER, ...sections.map((section) => encodeSection(
    section.id === 10 ? { id: 10, body: encodeCode(bodies) } : section,
  )));
}

test("certifies one named Compass frame and refuses owner mutations", {
  timeout: 120_000,
}, async () => {
  const artifact = process.env.GW_CLIENT_WASM;
  assert.ok(artifact, "GW_CLIENT_WASM must name the retained official artifact");
  const bytes = new Uint8Array(await readFile(artifact));
  const context = wasmEvidence(bytes);
  const retained = ENHANCEMENT_BUILDS[0];
  assert.ok(context && retained?.preGameControls && retained.skillSlotGeometry);
  const proof = deriveCompassFrameSpikeProof(
    context,
    retained.preGameControls,
    retained.skillSlotGeometry,
  );
  assert.ok(proof);
  assert.equal(proof.ownerFunction, 15_750);
  assert.deepEqual(Object.keys(proof.layout).sort(), [
    "frameArray", "frameBytes", "frameCount", "frameHashId", "frameId",
    "framePositionFlags", "frameScreenBottom", "frameScreenLeft",
    "frameScreenRight", "frameScreenTop", "frameState",
    "frameViewportHeight", "frameViewportWidth",
  ].sort());

  const changed = rewriteCode(bytes, (bodies) => {
    const local = proof.ownerFunction - context.moduleView().functionImportCount;
    const body = bodies[local]!;
    const operand = indexOfBytes(body, paddedIndex(proof.labelAddress));
    assert.notEqual(operand, -1);
    body[operand] = body[operand]! ^ 1;
  });
  const changedContext = wasmEvidence(changed);
  assert.ok(changedContext);
  assert.equal(
    deriveCompassFrameSpikeProof(
      changedContext,
      retained.preGameControls,
      retained.skillSlotGeometry,
    ),
    null,
  );
});
