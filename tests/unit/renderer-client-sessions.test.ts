import assert from "node:assert/strict";
import test from "node:test";
import type { ClientSession } from "../../src/shared/contracts.ts";
import { RendererClientSessions } from "../../src/main/renderer-client-sessions.ts";

const base: ClientSession = {
  appVersion: "test",
  compatibility: {
    clientSha256: "4".repeat(64),
    features: {
      gameFileSaving: { status: "available" },
      nativeCursor: { status: "available" },
      targetObservation: { status: "available" },
      partyObservation: { status: "available" },
      teamApply: { status: "available" },
      travelAction: { status: "available" },
      xunlaiAction: { status: "available" },
      chatAliases: { status: "available" },
      skillSlotGeometry: { status: "available" },
      skillCooldownObservation: { status: "off" },
      playRegionObservation: { status: "off" },
        preGameControls: { status: "off" },
    },
  },
  extendedMemory: {
    requestedAtLaunch: false,
    status: "standard",
    effectiveCapBytes: 2_147_483_648,
    fallbackReason: null,
  },
  healthToken: null,
};

test("renderer failures stay with one document and client generation", () => {
  const sessions = new RendererClientSessions<object>();
  const accountA = {};
  const accountB = {};
  const a = { owner: accountA, documentId: 1, generation: 1 };
  const b = { owner: accountB, documentId: 2, generation: 1 };

  sessions.recordFailures(b, base, ["nativeCursor", "teamApply"]);

  assert.deepEqual(
    sessions.session(a, base).compatibility?.features.nativeCursor,
    { status: "available" },
  );
  assert.deepEqual(
    sessions.session(b, base).compatibility?.features.nativeCursor,
    { status: "unavailable", reason: "preparation-failed" },
  );
  assert.deepEqual(base.compatibility?.features.teamApply, { status: "available" });

  assert.deepEqual(
    sessions.session({ ...b, documentId: 3 }, base).compatibility?.features.nativeCursor,
    { status: "available" },
    "a new renderer document retries the installation",
  );
  sessions.recordFailures(b, base, ["nativeCursor"]);
  assert.deepEqual(
    sessions.session({ ...b, generation: 2 }, base).compatibility?.features.nativeCursor,
    { status: "available" },
    "a new active generation retries the installation",
  );
});
