import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  certificationFromLocalVerification,
} from "../../src/main/certification/client-certification.js";
import { ENHANCEMENT_BUILDS } from "../../src/main/certification/enhancement-builds.js";
import {
  localFeatureVerdictsForBuild,
  type LocalClientVerification,
} from "../../src/main/certification/local-client-verifier.js";
import { SEMANTIC_VERIFIER_ABI } from "../../src/main/certification/semantic-proof.js";
import { TEMPLATE_SAVE_BUILDS } from "../../src/main/certification/template-save-compat.js";

const OFFICIAL = TEMPLATE_SAVE_BUILDS.find(
  (build) => build.outputSha256 === ENHANCEMENT_BUILDS[0]?.sha256,
)!;
const ALL_CAPABILITIES = Object.freeze({
  nativeCursor: true,
  targetObservation: true,
  partyObservation: true,
  teamApply: true,
  travelAction: true,
  xunlaiAction: true,
  chatAliases: true,
    skillKeyOverlay: false,
});

function localVerification(
  template: boolean,
  enhancement: boolean,
): LocalClientVerification {
  const base = {
    officialSha256: OFFICIAL.sha256,
    verifierAbi: SEMANTIC_VERIFIER_ABI,
  } as const;
  if (!template) {
    return {
      ...base,
      status: "template-refused",
      templateSaveBuild: null,
      enhancementBuild: null,
      featureVerdicts: null,
      reasons: ["template-shape-changed"],
    };
  }
  const enhancementBuild = enhancement ? ENHANCEMENT_BUILDS[0]! : null;
  const featureVerdicts = localFeatureVerdictsForBuild(
    OFFICIAL.outputSha256,
    ALL_CAPABILITIES,
    enhancementBuild,
  );
  return enhancementBuild === null
    ? {
        ...base,
        status: "enhancement-refused",
        templateSaveBuild: OFFICIAL,
        enhancementBuild: null,
        featureVerdicts,
        reasons: ["enhancement-layout-changed"],
      }
    : {
        ...base,
        status: "proved",
        templateSaveBuild: OFFICIAL,
        enhancementBuild,
        featureVerdicts,
        reasons: [],
      };
}

describe("client certification", () => {
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
