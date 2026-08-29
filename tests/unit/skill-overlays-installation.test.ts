import assert from "node:assert/strict";
import { test } from "node:test";
import { COMPANION_FEATURE_BITS } from "../../src/shared/companion-abi.ts";
import { DEFAULT_SETTINGS } from "../../src/shared/contracts.ts";
import { createSkillOverlaysInstallation } from "../../src/renderer/skill-overlays-installation.ts";
import { createSkillSlotGeometryInstallation } from "../../src/renderer/skill-slot-geometry-installation.ts";
import { createSkillCooldownObservationInstallation } from "../../src/renderer/skill-cooldown-state-installation.ts";

const binding = Object.freeze({
  input: Object.freeze({ kind: "keyboard" as const, code: "KeyC" }),
  modifiers: Object.freeze({
    control: false,
    option: false,
    shift: false,
    command: false,
  }),
});
const withBinding = Object.freeze({
  ...DEFAULT_SETTINGS,
  skillKeyBindings: Object.freeze([
    binding,
    null,
    null,
    null,
    null,
    null,
    null,
    null,
  ] as const),
});

test("skill policy activates and withdraws only the observation regions it needs", () => {
  const capabilities = {
    skillSlotGeometry: true,
    skillCooldownObservation: true,
  };
  const skills = createSkillOverlaysInstallation(
    capabilities,
    createSkillSlotGeometryInstallation(capabilities.skillSlotGeometry),
    createSkillCooldownObservationInstallation(capabilities.skillCooldownObservation),
  );
  skills.sync(DEFAULT_SETTINGS, { skillKeyLabels: false, skillCooldowns: false });
  assert.equal(skills.geometry.active, false);
  assert.equal(skills.cooldowns.active, false);
  assert.equal(skills.activeFeatureFlags, 0);

  skills.sync(withBinding, { skillKeyLabels: true, skillCooldowns: false });
  assert.equal(skills.geometry.active, true, "a key badge needs geometry");
  assert.equal(skills.cooldowns.active, false);
  assert.equal(
    skills.activeFeatureFlags,
    COMPANION_FEATURE_BITS.skillSlotGeometry,
  );
  skills.geometry.sink?.update({
    status: "ready",
    sequence: 2,
    frameId: 1,
    chatFrameId: 0,
    chatInput: null,
    viewportWidth: 800,
    viewportHeight: 600,
    slots: Object.freeze(Array.from({ length: 8 }, (_, index) => Object.freeze({
      left: index * 50,
      bottom: 20,
      right: index * 50 + 48,
      top: 68,
    }))),
  });
  assert.equal(skills.geometry.state.status, "ready");

  skills.sync(DEFAULT_SETTINGS, { skillKeyLabels: false, skillCooldowns: false });
  assert.deepEqual(skills.geometry.state, { status: "waiting", reason: "stale" });
  skills.sync(withBinding, { skillKeyLabels: true, skillCooldowns: false });
  skills.geometry.sink?.update({
    status: "ready",
    sequence: 2,
    frameId: 2,
    chatFrameId: 0,
    chatInput: null,
    viewportWidth: 800,
    viewportHeight: 600,
    slots: Object.freeze(Array.from({ length: 8 }, (_, index) => Object.freeze({
      left: index * 50,
      bottom: 20,
      right: index * 50 + 48,
      top: 68,
    }))),
  });
  assert.deepEqual(
    skills.geometry.state,
    { status: "waiting", reason: "stale" },
    "re-enabling cannot revive the withdrawn publication",
  );
  skills.geometry.sink?.update({
    status: "ready",
    sequence: 4,
    frameId: 2,
    chatFrameId: 0,
    chatInput: null,
    viewportWidth: 800,
    viewportHeight: 600,
    slots: Object.freeze(Array.from({ length: 8 }, (_, index) => Object.freeze({
      left: index * 50,
      bottom: 20,
      right: index * 50 + 48,
      top: 68,
    }))),
  });
  assert.equal(skills.geometry.state.status, "ready");

  skills.sync(DEFAULT_SETTINGS, { skillKeyLabels: false, skillCooldowns: true });
  assert.equal(skills.geometry.active, true, "cooldowns also need geometry");
  assert.equal(skills.cooldowns.active, true);
  assert.equal(
    skills.activeFeatureFlags,
    COMPANION_FEATURE_BITS.skillSlotGeometry
      | COMPANION_FEATURE_BITS.skillCooldownObservation,
  );
  skills.disposePresentation();
  skills.geometry.dispose();
  skills.cooldowns.dispose();
});
