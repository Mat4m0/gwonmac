// Executes the chain that decides which of the three certification states a
// client build is in — including the intermediate one the shipped tables
// cannot reach yet, which is the state that used to have no name at all.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  certificationFromLocalVerification,
  certifyClientBuild,
  type CertifiedBuildTables,
} from "../../src/main/certification/client-certification.js";
import { TEMPLATE_SAVE_BUILDS } from "../../src/main/certification/template-save-compat.js";
import { ENHANCEMENT_BUILDS } from "../../src/main/certification/enhancement-builds.js";
import {
  type LocalClientVerification,
} from "../../src/main/certification/local-client-verifier.js";

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

/** The shipped tables with the Enhancement side emptied: state 2, exactly. */
const withoutEnhancement: CertifiedBuildTables = {
  templateSave: (sha256) =>
    TEMPLATE_SAVE_BUILDS.find((build) => build.sha256 === sha256) ?? null,
  enhancement: () => null,
};

describe("client certification", () => {
  it("certifies the shipped build through both transforms", () => {
    const certification = certifyClientBuild(OFFICIAL.sha256);
    assert.equal(certification.state, "certified");
    assert.equal(
      certification.state === "certified"
        ? certification.templateSaveBuild
        : null,
      OFFICIAL,
    );
    // Keyed by the template-save transform's OUTPUT, not by the official hash.
    assert.equal(
      certification.state === "certified"
        ? certification.enhancementBuild.sha256
        : null,
      ENHANCEMENT_BUILDS[0]!.sha256,
    );
    assert.notEqual(OFFICIAL.sha256, OFFICIAL.outputSha256);
  });

  it("reports an unknown ArenaNet build as uncertified", () => {
    assert.deepEqual(certifyClientBuild(UNKNOWN), { state: "uncertified" });
  });

  it("reports templates certified and Enhancement not as its own state", () => {
    // The recertification intermediate: saving is fixed first, the cursor
    // second. Before this module it was two independent gauges and no state.
    const certification = certifyClientBuild(OFFICIAL.sha256, withoutEnhancement);
    assert.equal(certification.state, "template-only");
    assert.equal(
      certification.state === "template-only"
        ? certification.templateSaveBuild
        : null,
      OFFICIAL,
    );
  });

  it("stays uncertified when the Enhancement table certifies an unrelated build", () => {
    // A Enhancement entry that matches the official hash rather than the
    // template-save output must not promote anything: the chain is ordered.
    const certification = certifyClientBuild(UNKNOWN, {
      templateSave: () => null,
      enhancement: () => ENHANCEMENT_BUILDS[0]!,
    });
    assert.deepEqual(certification, { state: "uncertified" });
  });

  it("maps a complete local proof into the canonical certified state", () => {
    const certification = certificationFromLocalVerification(
      localVerification(true, true),
    );
    assert.equal(certification.state, "certified");
  });

  it("keeps a partial local proof useful without enabling Enhancement", () => {
    const certification = certificationFromLocalVerification(
      localVerification(true, false),
    );
    assert.equal(certification.state, "template-only");
  });

  it("keeps the official module when local verification proves nothing", () => {
    assert.deepEqual(
      certificationFromLocalVerification(localVerification(false, false)),
      { state: "uncertified" },
    );
  });
});
