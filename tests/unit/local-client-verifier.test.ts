import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ENHANCEMENT_BUILDS } from "../../src/main/certification/enhancement-builds.js";
import {
  isLocalClientVerification,
  type LocalClientVerification,
} from "../../src/main/certification/local-client-verifier.js";
import { TEMPLATE_SAVE_BUILDS } from "../../src/main/certification/template-save-compat.js";

const ENHANCEMENT = ENHANCEMENT_BUILDS[0]!;
const TEMPLATE = TEMPLATE_SAVE_BUILDS.find(
  (build) => build.outputSha256 === ENHANCEMENT.sha256,
)!;
function valid(): LocalClientVerification {
  return {
    officialSha256: TEMPLATE.sha256,
    templateSaveBuild: TEMPLATE,
    // The verifier returns the exact table entry for this exact transformed
    // input. A different build in the same table must not affect this proof.
    enhancementBuild: ENHANCEMENT,
    reasons: [],
  };
}

describe("local client verification boundary", () => {
  it("accepts the verifier's complete baseline proof", () => {
    assert.equal(isLocalClientVerification(valid(), TEMPLATE.sha256), true);
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
