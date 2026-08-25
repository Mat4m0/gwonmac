/** Verifies the explicit observed/unknown contract of the Travel unlock snapshot. */
import assert from "node:assert/strict";
import { test } from "node:test";
import { readCompanionSnapshot } from "../../src/renderer/companion-snapshot.js";
import { snapshot } from "../fixtures/enhancements.js";

const TRAVEL_UNLOCKS_OBSERVED = 1 << 6;

test("the companion publishes unlocked-map words only with positive observation", () => {
  const words = Array.from({ length: 28 }, () => 0);
  words[Math.floor(81 / 32)] = 1 << (81 % 32);
  const observed = readCompanionSnapshot(snapshot({
    flags: 7 | TRAVEL_UNLOCKS_OBSERVED,
    unlockedMapWords: words,
  }), 0);
  assert.equal(observed.status, "ready");
  if (observed.status === "ready") assert.deepEqual(observed.unlockedMapWords, words);

  const unknown = readCompanionSnapshot(snapshot({ flags: 7 }), 0);
  assert.equal(unknown.status, "ready");
  if (unknown.status === "ready") assert.equal(unknown.unlockedMapWords, null);
});

test("unlock words without the observed flag are corrupt, not all locked", () => {
  const words = Array.from({ length: 28 }, () => 0);
  words[0] = 1;
  assert.deepEqual(
    readCompanionSnapshot(snapshot({ flags: 7, unlockedMapWords: words }), 0),
    { status: "waiting", reason: "snapshot" },
  );
});
