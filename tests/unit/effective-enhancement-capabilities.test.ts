import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { effectiveCapabilities } from
  "../../src/renderer/effective-enhancement-capabilities.js";
import type {
  ClientCompatibility,
  ClientSession,
  OptionalFeatureStatus,
} from "../../src/shared/contracts.js";
import {
  ENHANCEMENT_CAPABILITY_PROFILES,
  type EnhancementCapabilities,
} from "../../src/shared/enhancement-contracts.js";

const available = Object.freeze({ status: "available" } as const);
const off = Object.freeze({ status: "off" } as const);

function session(capabilities: EnhancementCapabilities): ClientSession {
  const selected = (active: boolean): OptionalFeatureStatus =>
    active ? available : off;
  const compatibility: ClientCompatibility = {
    clientSha256: "a".repeat(64),
    features: {
      gameFileSaving: available,
      nativeCursor: selected(capabilities.nativeCursor),
      targetObservation: selected(capabilities.targetObservation),
      partyObservation: selected(capabilities.partyObservation),
      teamApply: selected(capabilities.commands),
    },
  };
  return {
    appVersion: "test",
    compatibility,
    extendedMemory: null,
    healthToken: null,
  };
}

describe("effective Enhancement capability boundary", () => {
  it("reproduces every served profile from Main's session, independent of request", () => {
    for (const capabilities of Object.values(ENHANCEMENT_CAPABILITY_PROFILES)) {
      assert.deepEqual(effectiveCapabilities(session(capabilities)), capabilities);
    }
  });

  it("does not revive off or unavailable features", () => {
    const original = session(
      ENHANCEMENT_CAPABILITY_PROFILES.cursorTargetPartyCommands,
    );
    const value: ClientSession = {
      ...original,
      compatibility: {
        ...original.compatibility!,
        features: {
          gameFileSaving: available,
          nativeCursor: { status: "unavailable", reason: "preparation-failed" },
          targetObservation: { status: "unavailable", reason: "game-update" },
          partyObservation: off,
          teamApply: off,
        },
      },
    };

    assert.deepEqual(effectiveCapabilities(value), {
      nativeCursor: false,
      targetObservation: false,
      partyObservation: false,
      commands: false,
    });
  });

  it("refuses to invent a profile before Main publishes a session", () => {
    assert.equal(effectiveCapabilities({
      appVersion: "test",
      compatibility: null,
      extendedMemory: null,
      healthToken: null,
    }), null);
  });
});
