import assert from "node:assert/strict";
import test from "node:test";
import {
  enhancementRuntimePolicy,
} from "../../src/renderer/enhancement-runtime-policy.js";
import { FEATURE_SELECTION_POLICIES } from "../../src/shared/feature-contracts.js";

const off = Object.freeze({
  characterSwitchEnabled: false,
  cartographyEnabled: false,
  gwonmacTools: false,
  buildLibrary: false,
  tradeChat: false,
  targetReadout: false,
  xunlaiStorage: false,
  travelPalette: false,
  skillKeyLabelsEnabled: false,
  skillCooldownOverlayEnabled: false,
  quickItemMove: false,
});

test("developer programs replace saved optional-tool selection in PvE", () => {
  assert.deepEqual(enhancementRuntimePolicy("toolbox-foundation", off, "pve"), {
    characterSwitch: false,
    cartography: false,
    tools: true,
    buildLibrary: true,
    tradeChat: true,
    targetReadout: false,
    teamApply: false,
    xunlaiStorage: false,
    travel: false,
    skillKeyLabels: false,
    skillCooldowns: false,
    quickItemMove: false,
  });
  assert.deepEqual(enhancementRuntimePolicy("toolbox-commands", off, "pve"), {
    characterSwitch: false,
    cartography: false,
    tools: true,
    buildLibrary: true,
    tradeChat: true,
    targetReadout: false,
    teamApply: true,
    xunlaiStorage: true,
    travel: true,
    skillKeyLabels: false,
    skillCooldowns: false,
    quickItemMove: false,
  });
  assert.deepEqual(enhancementRuntimePolicy("xunlai-storage", off, "pve"), {
    characterSwitch: false,
    cartography: false,
    tools: true,
    buildLibrary: true,
    tradeChat: true,
    targetReadout: false,
    teamApply: false,
    xunlaiStorage: true,
    travel: true,
    skillKeyLabels: false,
    skillCooldowns: false,
    quickItemMove: false,
  });
  assert.deepEqual(enhancementRuntimePolicy("target-observer", off, "pve"), {
    characterSwitch: false,
    cartography: false,
    tools: false,
    buildLibrary: false,
    tradeChat: false,
    targetReadout: true,
    teamApply: false,
    xunlaiStorage: false,
    travel: false,
    skillKeyLabels: false,
    skillCooldowns: false,
    quickItemMove: false,
  });
});

test("unknown regions keep local Tools while live PvE features fail closed", () => {
  const on = Object.freeze({
    characterSwitchEnabled: false,
    cartographyEnabled: false,
    gwonmacTools: true,
    buildLibrary: true,
    tradeChat: true,
    targetReadout: true,
    xunlaiStorage: true,
    travelPalette: true,
    skillKeyLabelsEnabled: false,
    skillCooldownOverlayEnabled: false,
    quickItemMove: false,
  });
  assert.deepEqual(enhancementRuntimePolicy("none", on, "unknown"), {
    characterSwitch: false,
    cartography: false,
    tools: true,
    buildLibrary: true,
    tradeChat: true,
    targetReadout: false,
    teamApply: false,
    xunlaiStorage: true,
    travel: false,
    skillKeyLabels: false,
    skillCooldowns: false,
    quickItemMove: false,
  });
});

test("confirmed active PvP play disables every product and developer tool", () => {
  const on = Object.freeze({
    characterSwitchEnabled: false,
    cartographyEnabled: false,
    gwonmacTools: true,
    buildLibrary: true,
    tradeChat: true,
    targetReadout: true,
    xunlaiStorage: true,
    travelPalette: true,
    skillKeyLabelsEnabled: true,
    skillCooldownOverlayEnabled: true,
    quickItemMove: false,
  });
  for (const program of [
    "none",
    "target-observer",
    "toolbox-foundation",
    "toolbox-commands",
    "xunlai-storage",
  ] as const) {
    assert.deepEqual(enhancementRuntimePolicy(program, on, "pvp"), {
      characterSwitch: false,
      cartography: false,
      tools: false,
      buildLibrary: false,
      tradeChat: false,
      targetReadout: false,
      teamApply: false,
      xunlaiStorage: false,
      travel: false,
      skillKeyLabels: false,
      skillCooldowns: false,
      quickItemMove: false,
    }, program);
  }
});

test("product tool settings remain live once the capability is present", () => {
  assert.deepEqual(enhancementRuntimePolicy("none", {
    characterSwitchEnabled: false,
    cartographyEnabled: false,
    gwonmacTools: true,
    buildLibrary: true,
    tradeChat: true,
    targetReadout: false,
    xunlaiStorage: false,
    travelPalette: true,
    skillKeyLabelsEnabled: false,
    skillCooldownOverlayEnabled: true,
    quickItemMove: false,
  }, "pve"), {
    characterSwitch: false,
    cartography: false,
    tools: true,
    buildLibrary: true,
    tradeChat: true,
    targetReadout: false,
    teamApply: true,
    xunlaiStorage: false,
    travel: true,
    skillKeyLabels: false,
    skillCooldowns: true,
    quickItemMove: false,
  });
});

test("skill feature selection distinguishes labels from cooldowns", () => {
  const empty = enhancementRuntimePolicy("none", {
    ...off,
    characterSwitchEnabled: false,
    cartographyEnabled: false,
    gwonmacTools: true,
    skillKeyLabelsEnabled: false,
    skillCooldownOverlayEnabled: false,
    quickItemMove: false,
  }, "pve");
  assert.equal(empty.skillKeyLabels, false);
  assert.equal(empty.skillCooldowns, false);
  const labels = enhancementRuntimePolicy("none", {
    ...off,
    characterSwitchEnabled: false,
    cartographyEnabled: false,
    gwonmacTools: true,
    skillKeyLabelsEnabled: true,
    skillCooldownOverlayEnabled: false,
    quickItemMove: false,
  }, "pve");
  assert.equal(labels.skillKeyLabels, true);
  assert.equal(labels.skillCooldowns, false);
});

test("Quick Item Move follows its single Tools switch and withdraws in PvP", () => {
  const settings = { ...off, gwonmacTools: true, quickItemMove: true };
  assert.equal(enhancementRuntimePolicy("none", settings, "pve").quickItemMove, true);
  assert.equal(enhancementRuntimePolicy("none", settings, "unknown").quickItemMove, true);
  assert.equal(enhancementRuntimePolicy("none", settings, "pvp").quickItemMove, false);
  assert.equal(enhancementRuntimePolicy("none", { ...settings, gwonmacTools: false }, "pve").quickItemMove, false);
});

test("runtime policy projects every registered feature exactly once", () => {
  assert.deepEqual(
    Object.keys(enhancementRuntimePolicy("none", off, "unknown")).sort(),
    Object.keys(FEATURE_SELECTION_POLICIES).sort(),
  );
});

test("local Tools require their setting or developer program and only active PvP blocks them", () => {
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
        for (const buildLibrary of [false, true]) {
          for (const targetReadout of [false, true]) {
            for (const xunlaiStorage of [false, true]) {
              const policy = enhancementRuntimePolicy(program, {
                ...off,
                gwonmacTools: enabled,
                buildLibrary,
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
