import assert from "node:assert/strict";
import { test } from "node:test";
import { ENHANCEMENT_CONFIG_FIELDS } from "../../src/shared/enhancement-config.ts";
import {
  ENHANCEMENT_CAPABILITY_CONTRACTS,
  enhancementCapabilitiesForProfile,
  enhancementConfigWordActive,
  enhancementHooksFor,
} from "../../src/shared/enhancement-contracts.ts";

test("the minimal cooldown profile needs play-region policy but no Party or UI hook", () => {
  const capabilities = enhancementCapabilitiesForProfile("features-300");
  assert.ok(capabilities);
  assert.equal(capabilities.playRegionObservation, true);
  assert.equal(capabilities.skillCooldownObservation, true);
  assert.equal(capabilities.partyObservation, false);
  assert.equal(capabilities.skillSlotGeometry, false);
  assert.deepEqual(enhancementHooksFor(capabilities), {
    tick: true,
    cursor: false,
    ui: false,
  });

  const contract = ENHANCEMENT_CAPABILITY_CONTRACTS.find(
    ({ id }) => id === "skillCooldownObservation",
  );
  assert.deepEqual(contract, {
    id: "skillCooldownObservation",
    requiresAll: ["playRegionObservation"],
    requiresAny: [],
    configOwners: ["observation", "player-skillbar", "skill-cooldown"],
    hooks: [],
  });
});

test("the minimal cooldown profile activates only its shared read substrate", () => {
  const capabilities = enhancementCapabilitiesForProfile("features-300");
  assert.ok(capabilities);
  const activeOwners = new Set([
    "play-region",
    "observation",
    "player-skillbar",
    "skill-cooldown",
  ]);

  ENHANCEMENT_CONFIG_FIELDS.forEach((field, index) => {
    assert.equal(
      enhancementConfigWordActive(capabilities, index),
      activeOwners.has(field.owner),
      `${field.owner}:${field.source === "layout" ? field.key : index}`,
    );
  });

  assert.equal(
    ENHANCEMENT_CONFIG_FIELDS.some(
      (field, index) => field.owner === "party"
        && enhancementConfigWordActive(capabilities, index),
    ),
    false,
  );
  assert.equal(
    ENHANCEMENT_CONFIG_FIELDS.some(
      (field, index) => field.owner === "party-skillbar"
        && enhancementConfigWordActive(capabilities, index),
    ),
    false,
  );
});
