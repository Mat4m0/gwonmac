/** Exact-client mutation refusal for the development-only pathing shape proof. */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { certifyPathingShape } from "../../src/main/certification/pathing-spike-proof.js";
import { wasmEvidence } from "../../src/main/certification/wasm-evidence.js";
import {
  concat,
  encodeCode,
  encodeSection,
  parseCode,
  sectionById,
  splitSections,
  WASM_HEADER,
} from "../../src/main/core/wasm-binary.js";

const PATHING_FUNCTIONS = Object.freeze([3208, 3216, 3273, 3281, 3288]);

function mutateFunction(input: Uint8Array, functionIndex: number): Uint8Array {
  const sections = splitSections(input);
  const module = wasmEvidence(input)?.moduleView();
  assert.ok(module);
  const bodies = parseCode(sectionById(sections, 10));
  const body = bodies[functionIndex - module.functionImportCount];
  assert.ok(body && body.byteLength > 4);
  body[body.byteLength - 2] = body[body.byteLength - 2]! ^ 1;
  return concat(WASM_HEADER, ...sections.map((section) => encodeSection(
    section.id === 10 ? { id: 10, body: encodeCode(bodies) } : section,
  )));
}

test("the exact pathing shape refuses every changed participating body", {
  timeout: 120_000,
}, async () => {
  const artifact = process.env.GW_CLIENT_WASM;
  assert.ok(artifact, "GW_CLIENT_WASM must name the exact official artifact");
  const input = new Uint8Array(await readFile(artifact));
  assert.ok(certifyPathingShape(input));
  for (const functionIndex of PATHING_FUNCTIONS) {
    assert.equal(
      certifyPathingShape(mutateFunction(input, functionIndex)),
      null,
      `function ${functionIndex}`,
    );
  }
});
