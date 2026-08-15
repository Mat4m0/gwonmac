import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  certificationFromLocalVerification,
  certifyClientBuild,
  type CertifiedBuildTables,
} from "../../src/main/certification/client-certification.js";
import { ENHANCEMENT_BUILDS } from "../../src/main/certification/enhancement-builds.js";
import type { LocalClientVerification } from "../../src/main/certification/local-client-verifier.js";
import { TEMPLATE_SAVE_BUILDS } from "../../src/main/certification/template-save-compat.js";

const OFFICIAL = TEMPLATE_SAVE_BUILDS.find(
  (build) => build.outputSha256 === ENHANCEMENT_BUILDS[0]?.sha256,
)!;
const UNKNOWN = "0".repeat(64);

function localVerification(
  template: boolean,
  enhancement: boolean,
): LocalClientVerification {
  return {
    officialSha256: OFFICIAL.sha256,
    templateSaveBuild: template ? OFFICIAL : null,
    enhancementBuild: enhancement ? ENHANCEMENT_BUILDS[0]! : null,
    reasons: template
      ? (enhancement ? [] : ["enhancement-layout-changed"])
      : ["template-shape-changed"],
  };
}

const withoutEnhancement: CertifiedBuildTables = {
  templateSave: (sha256) =>
    TEMPLATE_SAVE_BUILDS.find((build) => build.sha256 === sha256) ?? null,
  enhancement: () => null,
};

describe("client certification", () => {
  it("returns independent exact-build records for the transform chain", () => {
    assert.deepEqual(certifyClientBuild(OFFICIAL.sha256), {
      templateSaveBuild: OFFICIAL,
      enhancementBuild: ENHANCEMENT_BUILDS[0],
    });
    assert.notEqual(OFFICIAL.sha256, OFFICIAL.outputSha256);
  });

  it("keeps each proof independent", () => {
    assert.deepEqual(certifyClientBuild(UNKNOWN), {
      templateSaveBuild: null,
      enhancementBuild: null,
    });
    assert.deepEqual(certifyClientBuild(OFFICIAL.sha256, withoutEnhancement), {
      templateSaveBuild: OFFICIAL,
      enhancementBuild: null,
    });
  });

  it("never accepts an Enhancement record without the preceding file proof", () => {
    assert.deepEqual(certifyClientBuild(UNKNOWN, {
      templateSave: () => null,
      enhancement: () => ENHANCEMENT_BUILDS[0]!,
    }), {
      templateSaveBuild: null,
      enhancementBuild: null,
    });
  });

  it("maps isolated verifier results without recreating a coarse state", () => {
    assert.deepEqual(
      certificationFromLocalVerification(localVerification(true, true)),
      { templateSaveBuild: OFFICIAL, enhancementBuild: ENHANCEMENT_BUILDS[0] },
    );
    assert.deepEqual(
      certificationFromLocalVerification(localVerification(true, false)),
      { templateSaveBuild: OFFICIAL, enhancementBuild: null },
    );
    assert.deepEqual(
      certificationFromLocalVerification(localVerification(false, false)),
      { templateSaveBuild: null, enhancementBuild: null },
    );
  });
});
