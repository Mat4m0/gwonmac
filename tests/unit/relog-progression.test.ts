import assert from "node:assert/strict";
import test from "node:test";
import {
  isRelogCharacterEntryState,
  isRelogPostCharacterState,
  relogOutcomeForPlayable,
} from "../../src/renderer/relog-progression.js";

test("loading cannot impersonate character selection or playable completion", () => {
  assert.equal(isRelogCharacterEntryState("character-select"), true);
  assert.equal(isRelogCharacterEntryState("reconnect"), true);
  assert.equal(isRelogCharacterEntryState("loading"), false);
  assert.equal(isRelogCharacterEntryState("unknown"), false);

  assert.equal(isRelogPostCharacterState("reconnect"), true);
  assert.equal(isRelogPostCharacterState("loading"), true);
  assert.equal(relogOutcomeForPlayable(null), null);
});

test("only a certified playable instance completes relog", () => {
  assert.equal(relogOutcomeForPlayable("outpost"), "outpost");
  assert.equal(relogOutcomeForPlayable("explorable"), "restored");
});
