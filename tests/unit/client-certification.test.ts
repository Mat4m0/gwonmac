// Executes the chain that decides which of the three certification states a
// client build is in — including the intermediate one the shipped tables
// cannot reach yet, which is the state that used to have no name at all.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  certifyClientBuild,
  type CertifiedBuildTables,
} from "../../src/main/client-certification.js";
import { TEMPLATE_SAVE_BUILDS } from "../../src/main/core/template-save-compat.js";
import { ENHANCEMENT_BUILDS } from "../../src/main/core/enhancement-builds.js";

const OFFICIAL = TEMPLATE_SAVE_BUILDS[0]!;
const UNKNOWN = "0".repeat(64);

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
});
