/** Exact real-client qualification for both shipped transform profiles. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  enhancementOutputSha256,
} from "../../src/main/certification/enhancement-builds.js";
import { transformEnhancementWasm } from
  "../../src/main/certification/enhancement-transform.js";
import {
  isLocalClientVerification,
  verifyLocalClientBytes,
} from "../../src/main/certification/local-client-verifier.js";
import {
  deriveNativeDoubleClickBuild,
  isDerivedNativeDoubleClickBuild,
  rewriteNativeDoubleClickWasm,
} from "../../src/main/certification/native-double-click.js";
import { rewriteExtendedMemoryWasm } from
  "../../src/main/certification/extended-memory.js";
import { rewriteTemplateSaveWasm } from
  "../../src/main/certification/template-save-compat.js";
import {
  enhancementCapabilityProfile,
  RELEASE_ENHANCEMENT_CAPABILITIES,
} from "../../src/shared/enhancement-contracts.js";

const sha256 = (bytes: Uint8Array): string =>
  createHash("sha256").update(bytes).digest("hex");

test("every shipped runtime profile reproduces the real client chain", async () => {
  const artifact = process.env.GW_CLIENT_WASM;
  assert.ok(artifact, "GW_CLIENT_WASM must name the real Gw.jspi.wasm artifact");
  const official = new Uint8Array(await readFile(artifact));
  const verified = verifyLocalClientBytes(official);
  assert.equal(isLocalClientVerification(verified, sha256(official)), true);
  const templateBuild = verified.templateSaveBuild;
  assert.ok(templateBuild, "the real client must pass file compatibility proof");
  const template = rewriteTemplateSaveWasm(official, templateBuild);
  const enhancementBuild = verified.enhancementBuild;
  assert.ok(enhancementBuild, "the file output must pass feature proof");
  const templateDoubleClick = deriveNativeDoubleClickBuild(template);
  assert.ok(templateDoubleClick, "the complete native input route must prove");
  assert.equal(
    isDerivedNativeDoubleClickBuild(templateDoubleClick, sha256(template)),
    true,
  );
  rewriteExtendedMemoryWasm(rewriteNativeDoubleClickWasm(template));
  for (const [launch, capabilities] of Object.entries(
    RELEASE_ENHANCEMENT_CAPABILITIES,
  )) {
    const profile = enhancementCapabilityProfile(capabilities);
    assert.ok(profile, `${launch} release capabilities must form a profile`);
    const profileVerification = verifyLocalClientBytes(official, capabilities);
    const profileBuild = profileVerification.enhancementBuild;
    assert.ok(profileBuild, `profile ${profile} must prove independently`);
    const enhanced = transformEnhancementWasm(template, profileBuild, capabilities);
    assert.equal(
      sha256(enhanced),
      enhancementOutputSha256(profileBuild, capabilities),
    );
    const doubleClick = deriveNativeDoubleClickBuild(enhanced);
    assert.equal(
      isDerivedNativeDoubleClickBuild(doubleClick, sha256(enhanced)),
      true,
      `profile ${profile} must independently prove native double-click`,
    );
    rewriteExtendedMemoryWasm(rewriteNativeDoubleClickWasm(enhanced));
  }
});
