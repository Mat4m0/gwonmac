import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  enhancementCapabilityProfile,
  ENHANCEMENT_CAPABILITY_PROFILES,
} from "../../src/shared/enhancement-contracts.js";
import {
  enhancementOutputSha256,
  ENHANCEMENT_BUILDS,
} from "../../src/main/certification/enhancement-builds.js";
import { TEMPLATE_SAVE_BUILDS } from "../../src/main/certification/template-save-compat.js";

const NO_CAPABILITIES = Object.freeze({
  nativeCursor: false,
  targetObservation: false,
  toolbox: false,
  commands: false,
});
const UNSUPPORTED_ALL_CAPABILITIES = Object.freeze({
  nativeCursor: true,
  targetObservation: true,
  toolbox: true,
  commands: false,
});
describe("Enhancement client chain", () => {
  it("has exactly six source-pinned executable capability profiles", () => {
    // Adding a profile costs an
    // `outputSha256` entry and a review; this list is where that becomes
    // unavoidable rather than incidental.
    assert.deepEqual(Object.keys(ENHANCEMENT_CAPABILITY_PROFILES), [
      "cursor",
      "target",
      "cursorTarget",
      "cursorToolbox",
      "cursorToolboxCommands",
      "cursorTargetToolboxCommands",
    ]);
    assert.deepEqual(
      Object.entries(ENHANCEMENT_CAPABILITY_PROFILES)
        .filter(([, capabilities]) => capabilities.commands)
        .map(([profile]) => profile),
      ["cursorToolboxCommands", "cursorTargetToolboxCommands"],
    );
    for (const [profile, capabilities] of Object.entries(
      ENHANCEMENT_CAPABILITY_PROFILES,
    )) {
      assert.equal(enhancementCapabilityProfile(capabilities), profile);
      for (const build of ENHANCEMENT_BUILDS) {
        const output = enhancementOutputSha256(build, capabilities);
        assert.match(output ?? "", /^[0-9a-f]{64}$/);
      }
    }
    for (const unsupported of [
      NO_CAPABILITIES,
      UNSUPPORTED_ALL_CAPABILITIES,
      { nativeCursor: false, targetObservation: false, toolbox: true, commands: false },
      // Commands without the Toolbox that would drive them are refused.
      { nativeCursor: false, targetObservation: false, toolbox: false, commands: true },
    ]) {
      assert.equal(enhancementCapabilityProfile(unsupported), null);
    }
  });

  it("certifies the Enhancement transform against the template-save output", () => {
    // The Enhancement transform is layered on the template-save client so opting
    // into the game cursor never costs template save/load. If either manifest
    // is recertified without the other, this pairing is what breaks first.
    for (const build of ENHANCEMENT_BUILDS) {
      const source = TEMPLATE_SAVE_BUILDS.find(
        (candidate) => candidate.outputSha256 === build.sha256,
      );
      assert.ok(
        source,
        `Enhancement build ${build.buildId} does not consume any template-save output`,
      );
    }
  });
});
