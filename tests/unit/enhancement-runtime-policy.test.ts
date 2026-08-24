import assert from "node:assert/strict";
import test from "node:test";
import {
  enhancementRuntimePolicy,
} from "../../src/renderer/enhancement-runtime-policy.js";
import { FEATURE_SELECTION_POLICIES } from "../../src/shared/feature-contracts.js";

const off = Object.freeze({
  gwonmacTools: false,
  targetReadout: false,
  teamManagement: false,
  xunlaiStorage: false,
  travelPalette: false,
  skillKeyBindings: [null, null, null, null, null, null, null, null] as const,
  skillCooldownOverlayEnabled: false,
});

test("developer programs replace saved optional-tool selection in PvE", () => {
  assert.deepEqual(enhancementRuntimePolicy("toolbox-foundation", off, "pve"), {
    tools: true,
    targetReadout: false,
    teamApply: false,
    xunlaiStorage: false,
    travel: false,
    skillKeyLabels: false,
    skillCooldowns: false,
  });
  assert.deepEqual(enhancementRuntimePolicy("toolbox-commands", off, "pve"), {
    tools: true,
    targetReadout: false,
    teamApply: true,
    xunlaiStorage: true,
    travel: true,
    skillKeyLabels: false,
    skillCooldowns: false,
  });
  assert.deepEqual(enhancementRuntimePolicy("xunlai-storage", off, "pve"), {
    tools: true,
    targetReadout: false,
    teamApply: false,
    xunlaiStorage: true,
    travel: true,
    skillKeyLabels: false,
    skillCooldowns: false,
  });
  assert.deepEqual(enhancementRuntimePolicy("target-observer", off, "pve"), {
    tools: false,
    targetReadout: true,
    teamApply: false,
    xunlaiStorage: false,
    travel: false,
    skillKeyLabels: false,
    skillCooldowns: false,
  });
});

test("unknown regions keep local Tools while live PvE features fail closed", () => {
  const on = Object.freeze({
    gwonmacTools: true,
    targetReadout: true,
    teamManagement: true,
    xunlaiStorage: true,
    travelPalette: true,
    skillKeyBindings: off.skillKeyBindings,
    skillCooldownOverlayEnabled: false,
  });
  assert.deepEqual(enhancementRuntimePolicy("none", on, "unknown"), {
    tools: true,
    targetReadout: false,
    teamApply: false,
    xunlaiStorage: true,
    travel: false,
    skillKeyLabels: false,
    skillCooldowns: false,
  });
});

test("confirmed PvP and guild halls disable every product and developer tool", () => {
  const on = Object.freeze({
    gwonmacTools: true,
    targetReadout: true,
    teamManagement: true,
    xunlaiStorage: true,
    travelPalette: true,
    skillKeyBindings: [{
      input: { kind: "keyboard" as const, code: "KeyC" },
      modifiers: {
        control: false,
        option: false,
        shift: false,
        command: false,
      },
    }, null, null, null, null, null, null, null] as const,
    skillCooldownOverlayEnabled: true,
  });
  for (const program of [
    "none",
    "target-observer",
    "toolbox-foundation",
    "toolbox-commands",
    "xunlai-storage",
  ] as const) {
    assert.deepEqual(enhancementRuntimePolicy(program, on, "pvp"), {
      tools: false,
      targetReadout: false,
      teamApply: false,
      xunlaiStorage: false,
      travel: false,
      skillKeyLabels: false,
      skillCooldowns: false,
    }, program);
  }
});

test("product tool settings remain live once the capability is present", () => {
  assert.deepEqual(enhancementRuntimePolicy("none", {
    gwonmacTools: true,
    targetReadout: false,
    teamManagement: true,
    xunlaiStorage: false,
    travelPalette: true,
    skillKeyBindings: off.skillKeyBindings,
    skillCooldownOverlayEnabled: true,
  }, "pve"), {
    tools: true,
    targetReadout: false,
    teamApply: true,
    xunlaiStorage: false,
    travel: true,
    skillKeyLabels: false,
    skillCooldowns: true,
  });
});

test("skill feature selection distinguishes labels from cooldowns", () => {
  const empty = enhancementRuntimePolicy("none", {
    ...off,
    gwonmacTools: true,
    skillKeyBindings: [null, null, null, null, null, null, null, null],
    skillCooldownOverlayEnabled: false,
  }, "pve");
  assert.equal(empty.skillKeyLabels, false);
  assert.equal(empty.skillCooldowns, false);
  const labels = enhancementRuntimePolicy("none", {
    ...off,
    gwonmacTools: true,
    skillKeyBindings: [
      {
        input: { kind: "keyboard", code: "KeyC" },
        modifiers: { control: false, option: false, shift: false, command: false },
      },
      null,
      null,
      null,
      null,
      null,
      null,
      null,
    ],
    skillCooldownOverlayEnabled: false,
  }, "pve");
  assert.equal(labels.skillKeyLabels, true);
  assert.equal(labels.skillCooldowns, false);
});

test("runtime policy projects every registered feature exactly once", () => {
  assert.deepEqual(
    Object.keys(enhancementRuntimePolicy("none", off, "unknown")).sort(),
    Object.keys(FEATURE_SELECTION_POLICIES).sort(),
  );
});

test("local Tools require their setting or developer program and only confirmed PvP blocks them", () => {
  const regions = ["pve", "pvp", "unknown"] as const;
  const programs = [
    "none",
    "cursor-observer",
    "target-observer",
    "toolbox-foundation",
    "toolbox-commands",
    "xunlai-storage",
  ] as const;
  for (const program of programs) {
    for (const playRegion of regions) {
      for (const enabled of [false, true]) {
        for (const teamManagement of [false, true]) {
          for (const targetReadout of [false, true]) {
            for (const xunlaiStorage of [false, true]) {
              const policy = enhancementRuntimePolicy(program, {
                ...off,
                gwonmacTools: enabled,
                teamManagement,
                xunlaiStorage,
                targetReadout,
              }, playRegion);
              assert.equal(
                policy.tools,
                playRegion !== "pvp" && (
                  enabled
                    || program === "toolbox-foundation"
                    || program === "toolbox-commands"
                    || program === "xunlai-storage"
                ),
                `${program}/${playRegion} coupled local Tools to a live feature`,
              );
            }
          }
        }
      }
    }
  }
});
