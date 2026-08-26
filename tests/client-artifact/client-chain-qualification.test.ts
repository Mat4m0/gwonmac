/** Exact real-client qualification for every certified transform profile. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  ENHANCEMENT_BUILDS,
  enhancementOutputSha256,
  enhancementProfilesForBuild,
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
  enhancementCapabilitiesForProfile,
} from "../../src/shared/enhancement-contracts.js";

const sha256 = (bytes: Uint8Array): string =>
  createHash("sha256").update(bytes).digest("hex");

test("every certified runtime profile reproduces the real client chain", async () => {
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
  const authoredBuild = ENHANCEMENT_BUILDS.find(
    (candidate) => candidate.sha256 === enhancementBuild.sha256,
  );
  assert.ok(authoredBuild, "the exact client must retain its authored build row");
  for (const profile of enhancementProfilesForBuild(authoredBuild)) {
    const capabilities = enhancementCapabilitiesForProfile(profile);
    assert.ok(capabilities, `authored profile ${profile} must be valid`);
    assert.equal(
      sha256(transformEnhancementWasm(template, enhancementBuild, capabilities)),
      enhancementOutputSha256(authoredBuild, capabilities),
    );
  }

  const templateDoubleClick = deriveNativeDoubleClickBuild(template);
  assert.ok(templateDoubleClick?.route, "the complete native input route must prove");
  assert.equal(
    isDerivedNativeDoubleClickBuild(templateDoubleClick, sha256(template)),
    true,
  );
  rewriteExtendedMemoryWasm(rewriteNativeDoubleClickWasm(template));
  for (const profile of enhancementProfilesForBuild(authoredBuild)) {
    const capabilities = enhancementCapabilitiesForProfile(profile);
    assert.ok(capabilities, `certified profile ${profile} must be valid`);
    const profileVerification = verifyLocalClientBytes(official, capabilities);
    const profileBuild = profileVerification.enhancementBuild;
    assert.ok(profileBuild, `profile ${profile} must prove independently`);
    const enhanced = transformEnhancementWasm(template, profileBuild, capabilities);
    assert.equal(
      sha256(enhanced),
      enhancementOutputSha256(authoredBuild, capabilities),
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
