/**
 * Qualification against a real installed client artifact.
 *
 * This is deliberately outside `tests/unit`: it processes a large, untracked
 * input that ordinary pull-request CI does not possess. Its caller must name
 * that input explicitly, so a local test run never changes cost by accident;
 * the recertification workflow runs it against the artifact it downloaded.
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  compareToCertified,
  deriveTemplateSaveBuild,
  inspectTemplateSaveCandidate,
} from "../../src/tools/template-save-recert.js";
import {
  isLocalClientVerification,
  verifyLocalClientBytes,
} from "../../src/main/certification/local-client-verifier.js";
import { deriveEquivalentTemplateSaveBuild } from "../../src/main/certification/template-save-verifier.js";
import {
  concat,
  encodeCode,
  encodeSection,
  paddedIndex,
  parseCode,
  sectionById,
  splitSections,
  WASM_HEADER,
} from "../../src/main/core/wasm-binary.js";
import { ENHANCEMENT_BUILDS } from "../../src/main/certification/enhancement-builds.js";

function rewriteCode(
  input: Uint8Array,
  edit: (bodies: Uint8Array[]) => void,
): Uint8Array {
  const sections = splitSections(input);
  const bodies = parseCode(sectionById(sections, 10));
  edit(bodies);
  return concat(
    WASM_HEADER,
    ...sections.map((sectionValue) =>
      encodeSection(sectionValue.id === 10
        ? { id: 10, body: encodeCode(bodies) }
        : sectionValue)),
  );
}

test("the template-save verifier makes a fail-closed decision for a real client", async () => {
  const artifact = process.env.GW_CLIENT_WASM;
  assert.ok(
    artifact,
    "GW_CLIENT_WASM must explicitly name the real Gw.jspi.wasm artifact",
  );
  const bytes = await readFile(artifact);
  const derived = deriveTemplateSaveBuild(bytes);
  const report = inspectTemplateSaveCandidate(bytes);
  const local = verifyLocalClientBytes(bytes);
  assert.equal(isLocalClientVerification(local, local.officialSha256), true);

  // If this is a statically shipped build, the shape locator must still
  // reproduce that record exactly. Unknown builds are intentionally decided
  // by the local verifier instead of making this test demand a release.
  if (report.certified) assert.deepEqual(compareToCertified(derived), []);

  const fileExists = derived.bridges.find(
    (bridge) => bridge.kind === "fileExists",
  )!;
  const site = fileExists.callSites[0]!;
  // Keep the call at the same byte offset while changing the computation of
  // its path argument. The verifier must detect semantics, not only offsets.
  const changedCaller = rewriteCode(bytes, (bodies) => {
    const caller = bodies[site.localFunction]!;
    const pathImmediate = site.bodyOffset - 7;
    caller[pathImmediate] = caller[pathImmediate]! ^ 1;
  });
  assert.equal(WebAssembly.validate(new Uint8Array(changedCaller)), true);
  assert.equal(deriveEquivalentTemplateSaveBuild(changedCaller), null);
  assert.deepEqual(
    verifyLocalClientBytes(changedCaller).reasons,
    ["template-shape-changed"],
  );

  const layout = ENHANCEMENT_BUILDS[ENHANCEMENT_BUILDS.length - 1]!.layout;
  const needle = paddedIndex(layout.agentArray);
  const touched = new Set(
    derived.bridges.flatMap((bridge) =>
      bridge.callSites.map((callSite) => callSite.localFunction)),
  );
  let changedAddress = false;
  const changedAddressReference = rewriteCode(bytes, (bodies) => {
    for (let local = 0; local < bodies.length; local += 1) {
      if (touched.has(local)) continue;
      const body = bodies[local]!;
      const at = body.findIndex((_, offset) =>
        needle.every((byte, index) => body[offset + index] === byte));
      if (at < 0) continue;
      body[at] = body[at]! ^ 1;
      changedAddress = true;
      break;
    }
  });
  assert.equal(changedAddress, true);
  assert.equal(WebAssembly.validate(new Uint8Array(changedAddressReference)), true);
  const addressDecision = verifyLocalClientBytes(changedAddressReference);
  assert.ok(addressDecision.templateSaveBuild);
  assert.equal(addressDecision.enhancementBuild, null);
  assert.deepEqual(addressDecision.reasons, ["enhancement-layout-changed"]);
});
