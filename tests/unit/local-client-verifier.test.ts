import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ENHANCEMENT_BUILDS } from "../../src/main/certification/enhancement-builds.js";
import {
  isLocalClientVerification,
  LOCAL_CLIENT_BASELINE_FINGERPRINT,
  LOCAL_CLIENT_VERIFIER_ABI,
  type LocalClientVerification,
} from "../../src/main/certification/local-client-verifier.js";
import { TEMPLATE_SAVE_BUILDS } from "../../src/main/certification/template-save-compat.js";

const ENHANCEMENT = ENHANCEMENT_BUILDS[0]!;
const TEMPLATE = TEMPLATE_SAVE_BUILDS.find(
  (build) => build.outputSha256 === ENHANCEMENT.sha256,
)!;
function valid(): LocalClientVerification {
  return {
    verifierAbi: LOCAL_CLIENT_VERIFIER_ABI,
    baselineFingerprint: LOCAL_CLIENT_BASELINE_FINGERPRINT,
    officialSha256: TEMPLATE.sha256,
    templateSaveBuild: TEMPLATE,
    // What deriveEnhancementBuild actually emits: the relocated layout under
    // the baseline's own buildId, because a locally verified client cannot
    // prove its build number. The first manifest entry carried the same id as
    // the baseline until the baseline was corrected to the build its client
    // self-reports, which is what this spread now makes explicit.
    enhancementBuild: {
      ...ENHANCEMENT,
      buildId: ENHANCEMENT_BUILDS[ENHANCEMENT_BUILDS.length - 1]!.buildId,
    },
    reasons: [],
  };
}

describe("local client verification boundary", () => {
  it("accepts the verifier's complete baseline proof", () => {
    assert.equal(isLocalClientVerification(valid(), TEMPLATE.sha256), true);
  });

  it("expires cached answers when verifier code changes", () => {
    assert.equal(isLocalClientVerification(
      { ...valid(), verifierAbi: LOCAL_CLIENT_VERIFIER_ABI + 1 },
      TEMPLATE.sha256,
    ), false);
    assert.equal(isLocalClientVerification(
      { ...valid(), baselineFingerprint: "0".repeat(64) },
      TEMPLATE.sha256,
    ), false);
  });

  it("rejects a proof for any other official client", () => {
    assert.equal(
      isLocalClientVerification(valid(), "0".repeat(64)),
      false,
    );
  });

  it("rejects an unconstrained enhancement layout", () => {
    assert.equal(isLocalClientVerification({
      ...valid(),
      enhancementBuild: {
        ...ENHANCEMENT,
        layout: {
          ...ENHANCEMENT.layout,
          currentMapId: ENHANCEMENT.layout.currentMapId + 4,
        },
      },
    }, TEMPLATE.sha256), false);
  });

  it("rejects any certificate other than the exact shipped build", () => {
    assert.equal(isLocalClientVerification({
      ...valid(),
      enhancementBuild: {
        ...ENHANCEMENT,
        hookFunction: ENHANCEMENT.hookFunction + 1,
      },
    }, TEMPLATE.sha256), false);
  });

  it("accepts a template-only proof and requires no enhancement behind failure", () => {
    const templateOnly: LocalClientVerification = {
      ...valid(),
      enhancementBuild: null,
      reasons: ["enhancement-layout-changed"],
    };
    assert.equal(
      isLocalClientVerification(templateOnly, TEMPLATE.sha256),
      true,
    );
    assert.equal(isLocalClientVerification({
      ...templateOnly,
      templateSaveBuild: null,
      enhancementBuild: ENHANCEMENT,
    }, TEMPLATE.sha256), false);
  });
});
