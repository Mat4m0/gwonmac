/** Compile-time and runtime proofs for exact renderer-facing state unions. */
import assert from "node:assert/strict";
import test from "node:test";
import type {
  ClientSession,
  SteamTokenResult,
} from "../../src/shared/contracts.js";
import type {
  PublishedCompanionState,
} from "../../src/renderer/companion-snapshot.js";

const preparing = {
  appVersion: "test",
  compatibility: null,
  extendedMemory: null,
  healthToken: null,
} satisfies ClientSession;

const unsupported = {
  status: "unsupported",
} satisfies PublishedCompanionState;

const refused = {
  token: null,
  reason: "cancelled",
} satisfies SteamTokenResult;

// @ts-expect-error a refusal and a token cannot describe one Steam result.
const tokenWithRefusal: SteamTokenResult = { token: "secret", reason: "failed" };
// @ts-expect-error a preparing session cannot already carry a health token.
const preparingWithHealth: ClientSession = {
  ...preparing,
  healthToken: { generation: 1, fingerprint: "candidate" },
};
const unsupportedWithTick: PublishedCompanionState = {
  status: "unsupported",
  // @ts-expect-error an unsupported installation cannot invent snapshot fields.
  tickCount: 1,
};

test("runtime states admit only their complete valid phases", () => {
  assert.equal(preparing.extendedMemory, null);
  assert.equal(unsupported.status, "unsupported");
  assert.deepEqual(refused, { token: null, reason: "cancelled" });
  assert.equal(tokenWithRefusal.token, "secret");
  assert.equal(preparingWithHealth.healthToken?.generation, 1);
  assert.equal(unsupportedWithTick.status, "unsupported");
});
