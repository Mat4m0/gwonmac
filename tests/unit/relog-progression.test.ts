import assert from "node:assert/strict";
import test from "node:test";
import {
  isRelogCharacterEntryState,
  isRelogPostCharacterState,
  observeRelogPlayableTransition,
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

test("a stale playable publication cannot complete a new relog", () => {
  const stale = observeRelogPlayableTransition(false, "outpost");
  assert.deepEqual(stale, { observedNonPlayable: false, outcome: null });
  const loading = observeRelogPlayableTransition(
    stale.observedNonPlayable,
    null,
  );
  assert.deepEqual(loading, { observedNonPlayable: true, outcome: null });
  assert.deepEqual(
    observeRelogPlayableTransition(loading.observedNonPlayable, "explorable"),
    { observedNonPlayable: true, outcome: "restored" },
  );
});
