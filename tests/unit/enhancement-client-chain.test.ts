import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  enhancementCapabilityProfile,
  ENHANCEMENT_CAPABILITY_PROFILES,
} from "../../src/shared/enhancement-contracts.js";
import {
  enhancementOutputSha256,
  enhancementProfilesForBuild,
  ENHANCEMENT_BUILDS,
  hasCompleteEnhancementProfileHashes,
  type KnownEnhancementBuild,
} from "../../src/main/certification/enhancement-builds.js";
import { TEMPLATE_SAVE_BUILDS } from "../../src/main/certification/template-save-compat.js";

const NO_CAPABILITIES = Object.freeze({
  nativeCursor: false,
  targetObservation: false,
  partyObservation: false,
  commands: false,
  storage: false,
});
describe("Enhancement client chain", () => {
  it("source-pins every executable capability profile", () => {
    // Adding a profile costs an
    // `outputSha256` entry and a review; this list is where that becomes
    // unavoidable rather than incidental.
    assert.deepEqual(Object.keys(ENHANCEMENT_CAPABILITY_PROFILES), [
      "cursor",
      "target",
      "cursorTarget",
      "party",
      "cursorParty",
      "targetParty",
      "cursorTargetParty",
      "partyCommands",
      "cursorPartyCommands",
      "targetPartyCommands",
      "cursorTargetPartyCommands",
      "partyStorage",
      "cursorPartyStorage",
      "targetPartyStorage",
      "cursorTargetPartyStorage",
      "partyCommandsStorage",
      "cursorPartyCommandsStorage",
      "targetPartyCommandsStorage",
      "cursorTargetPartyCommandsStorage",
    ]);
    assert.deepEqual(
      Object.entries(ENHANCEMENT_CAPABILITY_PROFILES)
        .filter(([, capabilities]) => capabilities.commands)
        .map(([profile]) => profile),
      [
        "partyCommands",
        "cursorPartyCommands",
        "targetPartyCommands",
        "cursorTargetPartyCommands",
        "partyCommandsStorage",
        "cursorPartyCommandsStorage",
        "targetPartyCommandsStorage",
        "cursorTargetPartyCommandsStorage",
      ],
    );
    for (const [profile, capabilities] of Object.entries(
      ENHANCEMENT_CAPABILITY_PROFILES,
    )) {
      assert.equal(enhancementCapabilityProfile(capabilities), profile);
      for (const build of ENHANCEMENT_BUILDS) {
        const output = enhancementOutputSha256(build, capabilities);
        assert.equal(
          output !== null,
          enhancementProfilesForBuild(build).includes(
            profile as keyof typeof ENHANCEMENT_CAPABILITY_PROFILES,
          ),
        );
        if (output !== null) assert.match(output, /^[0-9a-f]{64}$/);
      }
    }
    for (const unsupported of [
      NO_CAPABILITIES,
      // Commands without the Toolbox that would drive them are refused.
      {
        nativeCursor: false,
        targetObservation: false,
        partyObservation: false,
        commands: true,
        storage: false,
      },
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

  it("requires all and only the hashes implied by optional capability facts", () => {
    const full = ENHANCEMENT_BUILDS[0]!;
    assert.equal(hasCompleteEnhancementProfileHashes(full), true);

    const cursorOnly: KnownEnhancementBuild = {
      ...full,
      outputSha256: Object.freeze({ cursor: full.outputSha256.cursor! }),
    };
    delete cursorOnly.targetObservation;
    delete cursorOnly.partyObservation;
    delete cursorOnly.teamApply;
    delete cursorOnly.gameThread;
    delete cursorOnly.storage;
    assert.deepEqual(enhancementProfilesForBuild(cursorOnly), ["cursor"]);
    assert.equal(hasCompleteEnhancementProfileHashes(cursorOnly), true);

    const partyOnly: KnownEnhancementBuild = {
      ...full,
      outputSha256: Object.freeze({ party: full.outputSha256.party! }),
    };
    delete partyOnly.cursorEvent;
    delete partyOnly.targetObservation;
    delete partyOnly.teamApply;
    delete partyOnly.gameThread;
    delete partyOnly.storage;
    assert.deepEqual(enhancementProfilesForBuild(partyOnly), ["party"]);
    assert.equal(hasCompleteEnhancementProfileHashes(partyOnly), true);

    const missingObservationBase = { ...partyOnly };
    delete missingObservationBase.observationBase;
    assert.equal(
      hasCompleteEnhancementProfileHashes(missingObservationBase),
      false,
      "party facts require their shared observation base",
    );

    const storageWithoutTarget = { ...full };
    delete storageWithoutTarget.targetObservation;
    assert.equal(
      hasCompleteEnhancementProfileHashes(storageWithoutTarget),
      false,
      "storage facts require the target layout used by travel",
    );

    assert.equal(
      hasCompleteEnhancementProfileHashes({
        ...cursorOnly,
        outputSha256: Object.freeze({}),
      }),
      false,
      "a supported profile cannot omit its output hash",
    );
    assert.equal(
      hasCompleteEnhancementProfileHashes({
        ...cursorOnly,
        outputSha256: Object.freeze({
          cursor: full.outputSha256.cursor!,
          target: full.outputSha256.target!,
        }),
      }),
      false,
      "an unsupported profile cannot retain an output hash",
    );
    assert.equal(
      hasCompleteEnhancementProfileHashes({
        ...cursorOnly,
        outputSha256: Object.freeze({ cursor: "not-a-digest" }),
      }),
      false,
      "every implied profile hash must be a digest",
    );
    const commonOnly = { ...cursorOnly };
    delete commonOnly.cursorEvent;
    assert.equal(
      hasCompleteEnhancementProfileHashes({
        ...commonOnly,
        outputSha256: Object.freeze({}),
      }),
      false,
      "a certificate with no supported profile is not executable",
    );
  });
});
