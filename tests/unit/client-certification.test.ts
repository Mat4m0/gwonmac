// Executes the chain that decides which of the three certification states a
// client build is in — including the intermediate one the shipped tables
// cannot reach yet, which is the state that used to have no name at all.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  certifyClientBuild,
  toolboxMayLoad,
  type CertifiedBuildTables,
} from "../../src/main/client-certification.js";
import { TEMPLATE_SAVE_BUILDS } from "../../src/main/core/template-save-compat.js";
import { TOOLBOX_BUILDS } from "../../src/main/core/toolbox-builds.js";

const OFFICIAL = TEMPLATE_SAVE_BUILDS[0]!;
const UNKNOWN = "0".repeat(64);

/** The shipped tables with the Toolbox side emptied: state 2, exactly. */
const withoutToolbox: CertifiedBuildTables = {
  templateSave: (sha256) =>
    TEMPLATE_SAVE_BUILDS.find((build) => build.sha256 === sha256) ?? null,
  toolbox: () => null,
};

describe("client certification", () => {
  it("certifies the shipped build through both transforms", () => {
    const certification = certifyClientBuild(OFFICIAL.sha256);
    assert.equal(certification.state, "certified");
    assert.equal(
      certification.state === "certified"
        ? certification.templateSaveOutputSha256
        : null,
      OFFICIAL.outputSha256,
    );
    // Keyed by the template-save transform's OUTPUT, not by the official hash.
    assert.equal(
      certification.state === "certified"
        ? certification.toolboxBuild.sha256
        : null,
      TOOLBOX_BUILDS[0]!.sha256,
    );
    assert.notEqual(OFFICIAL.sha256, OFFICIAL.outputSha256);
  });

  it("reports an unknown ArenaNet build as uncertified", () => {
    assert.deepEqual(certifyClientBuild(UNKNOWN), { state: "uncertified" });
  });

  it("reports templates certified and Toolbox not as its own state", () => {
    // The recertification intermediate: saving is fixed first, the cursor
    // second. Before this module it was two independent gauges and no state.
    const certification = certifyClientBuild(OFFICIAL.sha256, withoutToolbox);
    assert.equal(certification.state, "template-only");
    assert.equal(
      certification.state === "template-only"
        ? certification.templateSaveOutputSha256
        : null,
      OFFICIAL.outputSha256,
    );
  });

  it("stays uncertified when the Toolbox table certifies an unrelated build", () => {
    // A Toolbox entry that matches the official hash rather than the
    // template-save output must not promote anything: the chain is ordered.
    const certification = certifyClientBuild(UNKNOWN, {
      templateSave: () => null,
      toolbox: () => TOOLBOX_BUILDS[0]!,
    });
    assert.deepEqual(certification, { state: "uncertified" });
  });

  it("lets the Toolbox kernel load only against a fully certified build", () => {
    assert.equal(toolboxMayLoad("certified"), true);
    assert.equal(toolboxMayLoad("template-only"), false);
    assert.equal(toolboxMayLoad("uncertified"), false);
  });
});
