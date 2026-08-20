import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  enhancementCapabilitiesForProfile,
  enhancementCapabilityProfile,
  type EnhancementCapabilities,
  type EnhancementCapabilityProfile,
} from "../../src/shared/enhancement-contracts.js";
import {
  enhancementOutputSha256,
  enhancementProfilesForBuild,
  ENHANCEMENT_BUILDS,
  hasValidEnhancementProfileHashes,
  supportedEnhancementCapabilities,
  type KnownEnhancementBuild,
} from "../../src/main/certification/enhancement-builds.js";
import { TEMPLATE_SAVE_BUILDS } from "../../src/main/certification/template-save-compat.js";

const NO_CAPABILITIES = Object.freeze({
  nativeCursor: false,
  targetObservation: false,
  partyObservation: false,
  teamApply: false,
  travelAction: false,
  xunlaiAction: false,
  chatAliases: false,
});
describe("Enhancement client chain", () => {
  it("source-pins every executable capability profile", () => {
    // Seven booleans have 127 non-empty combinations. Team Apply requires
    // Party observation, and chat aliases require Travel or Xunlai to give
    // them an action they can truthfully expose.
    const profiles = Array.from({ length: 127 }, (_, index) => {
      const profile = `features-${(index + 1).toString(16).padStart(2, "0")}` as
        EnhancementCapabilityProfile;
      const capabilities = enhancementCapabilitiesForProfile(profile);
      return capabilities
        ? [[profile, capabilities] as const satisfies readonly [
            EnhancementCapabilityProfile,
            EnhancementCapabilities,
          ]]
        : [];
    }).flat();
    assert.equal(profiles.length, 83);
    assert.equal(new Set(profiles.map(([, value]) => JSON.stringify(value))).size, 83);
    const teamProfiles = profiles.filter(([, capabilities]) => capabilities.teamApply);
    assert.equal(teamProfiles.length, 28);
    assert.ok(teamProfiles.every(([, capabilities]) => capabilities.partyObservation));
    for (const [profile, capabilities] of profiles) {
      assert.equal(enhancementCapabilityProfile(capabilities), profile);
      for (const build of ENHANCEMENT_BUILDS) {
        const output = enhancementOutputSha256(build, capabilities);
        assert.equal(
          output !== null,
          enhancementProfilesForBuild(build).includes(profile),
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
        teamApply: true,
        travelAction: false,
        xunlaiAction: false,
        chatAliases: false,
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
    assert.equal(hasValidEnhancementProfileHashes(full), true);

    const cursorOnly: KnownEnhancementBuild = {
      ...full,
      outputSha256: Object.freeze({
        "features-01": full.outputSha256["features-01"]!,
      }),
    };
    delete cursorOnly.targetObservation;
    delete cursorOnly.partyObservation;
    delete cursorOnly.teamApply;
    delete cursorOnly.gameThread;
    delete cursorOnly.xunlaiAction;
    delete cursorOnly.travelAction;
    delete cursorOnly.chatAliases;
    assert.deepEqual(enhancementProfilesForBuild(cursorOnly), ["features-01"]);
    assert.equal(hasValidEnhancementProfileHashes(cursorOnly), true);

    const partyOnly: KnownEnhancementBuild = {
      ...full,
      outputSha256: Object.freeze({
        "features-04": full.outputSha256["features-04"]!,
      }),
    };
    delete partyOnly.cursorEvent;
    delete partyOnly.targetObservation;
    delete partyOnly.teamApply;
    delete partyOnly.gameThread;
    delete partyOnly.xunlaiAction;
    delete partyOnly.travelAction;
    delete partyOnly.chatAliases;
    assert.deepEqual(enhancementProfilesForBuild(partyOnly), ["features-04"]);
    assert.equal(hasValidEnhancementProfileHashes(partyOnly), true);

    const missingObservationBase = { ...partyOnly };
    delete missingObservationBase.observationBase;
    assert.equal(
      hasValidEnhancementProfileHashes(missingObservationBase),
      false,
      "party facts require their shared observation base",
    );

    const missingPartyDispatcher = { ...partyOnly };
    delete missingPartyDispatcher.uiDispatcher;
    assert.equal(
      hasValidEnhancementProfileHashes(missingPartyDispatcher),
      false,
      "party facts require their shared UI dispatcher",
    );

    const storageWithoutTarget = { ...full };
    delete storageWithoutTarget.targetObservation;
    assert.equal(
      supportedEnhancementCapabilities(storageWithoutTarget).xunlaiAction,
      true,
      "storage and Travel do not require target observation",
    );

    const prooflessXunlai = {
      openExport: full.xunlaiAction!.openExport,
      configureExport: full.xunlaiAction!.configureExport,
      handler: full.xunlaiAction!.handler,
    };
    const storageWithoutAccessProof: KnownEnhancementBuild = {
      ...full,
      xunlaiAction: prooflessXunlai,
    };
    assert.equal(
      hasValidEnhancementProfileHashes(storageWithoutAccessProof),
      false,
      "a legacy bundled output cannot claim the missing Xunlai proof",
    );
    assert.equal(
      supportedEnhancementCapabilities(storageWithoutAccessProof).travelAction,
      true,
      "Travel authority remains independent from Xunlai access proof",
    );
    assert.equal(
      supportedEnhancementCapabilities(storageWithoutAccessProof).xunlaiAction,
      false,
    );
    const storageWithDuplicateReaders: KnownEnhancementBuild = {
      ...full,
      xunlaiAction: {
        ...full.xunlaiAction!,
        accessProof: {
          ...full.xunlaiAction!.accessProof!,
          readers: {
            ...full.xunlaiAction!.accessProof!.readers,
            "access-flags": {
              ...full.xunlaiAction!.accessProof!.readers["access-flags"],
              functionIndex:
                full.xunlaiAction!.accessProof!.readers["agent-id"].functionIndex,
            },
          },
        },
      },
    };
    assert.equal(
      hasValidEnhancementProfileHashes(storageWithDuplicateReaders),
      false,
      "storage requires three independent player-record readers",
    );

    assert.equal(
      hasValidEnhancementProfileHashes({
        ...cursorOnly,
        outputSha256: Object.freeze({}),
      }),
      false,
      "a supported profile cannot omit its output hash",
    );
    assert.equal(
      hasValidEnhancementProfileHashes({
        ...cursorOnly,
        outputSha256: Object.freeze({
          "features-01": full.outputSha256["features-01"]!,
          "features-02": full.outputSha256["features-02"]!,
        }),
      }),
      false,
      "an unsupported profile cannot retain an output hash",
    );
    assert.equal(
      hasValidEnhancementProfileHashes({
        ...cursorOnly,
        outputSha256: Object.freeze({ "features-01": "not-a-digest" }),
      }),
      false,
      "every implied profile hash must be a digest",
    );
    const commonOnly = { ...cursorOnly };
    delete commonOnly.cursorEvent;
    assert.equal(
      hasValidEnhancementProfileHashes({
        ...commonOnly,
        outputSha256: Object.freeze({}),
      }),
      false,
      "a certificate with no supported profile is not executable",
    );
  });
});
