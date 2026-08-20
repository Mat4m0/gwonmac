/**
 * Qualification against a real installed client artifact.
 *
 * This is deliberately outside `tests/unit`: it processes a large, untracked
 * input that ordinary pull-request CI does not possess. Its caller must name
 * that input explicitly, so a local test run never changes cost by accident;
 * the recertification workflow runs it against the artifact it downloaded.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
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
import {
  ENHANCEMENT_BUILDS,
  findEnhancementBuild,
  enhancementOutputSha256,
} from "../../src/main/certification/enhancement-builds.js";
import { transformEnhancementWasm } from "../../src/main/certification/enhancement-transform.js";
import { rewriteNativeDoubleClickWasm } from "../../src/main/certification/native-double-click.js";
import { rewriteExtendedMemoryWasm } from "../../src/main/certification/extended-memory.js";
import {
  findTemplateSaveBuild,
  rewriteTemplateSaveWasm,
} from "../../src/main/certification/template-save-compat.js";
import { ENHANCEMENT_CAPABILITY_PROFILES } from "../../src/shared/enhancement-contracts.js";

const sha256 = (bytes: Uint8Array): string =>
  createHash("sha256").update(bytes).digest("hex");

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

  const observationBase = ENHANCEMENT_BUILDS[ENHANCEMENT_BUILDS.length - 1]!
    .observationBase!;
  const needle = paddedIndex(observationBase.layout.agentArray);
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
  assert.ok(addressDecision.enhancementBuild?.cursorEvent);
  assert.equal(addressDecision.enhancementBuild.targetObservation, undefined);
  assert.equal(addressDecision.enhancementBuild.partyObservation, undefined);
  assert.equal(addressDecision.enhancementBuild.teamApply, undefined);
  assert.deepEqual(
    Object.keys(addressDecision.enhancementBuild.outputSha256),
    ["cursor"],
  );
  assert.deepEqual(addressDecision.reasons, []);
});

test("every certified runtime profile reproduces the real client chain", async () => {
  const artifact = process.env.GW_CLIENT_WASM;
  assert.ok(
    artifact,
    "GW_CLIENT_WASM must explicitly name the real Gw.jspi.wasm artifact",
  );
  const official = new Uint8Array(await readFile(artifact));
  const templateBuild = findTemplateSaveBuild(sha256(official));
  assert.ok(templateBuild, "the real client must be template-save certified");
  const template = rewriteTemplateSaveWasm(official, templateBuild);
  const enhancementBuild = findEnhancementBuild(sha256(template));
  assert.ok(enhancementBuild, "the template output must be Enhancement certified");

  // The off profile and every optional capability profile feed the same two
  // downstream exact-hash transforms. Reproducing the complete chain here is
  // what catches an ABI/config edit whose source tests pass but whose authored
  // certificate hashes were not regenerated.
  rewriteExtendedMemoryWasm(rewriteNativeDoubleClickWasm(template));
  for (const capabilities of Object.values(ENHANCEMENT_CAPABILITY_PROFILES)) {
    const enhanced = transformEnhancementWasm(
      template,
      enhancementBuild,
      capabilities,
    );
    assert.equal(
      sha256(enhanced),
      enhancementOutputSha256(enhancementBuild, capabilities),
    );
    rewriteExtendedMemoryWasm(rewriteNativeDoubleClickWasm(enhanced));
  }
});
