import assert from "node:assert/strict";
import test from "node:test";
import {
  enhancementRuntimePolicy,
  runtimePlayRegion,
} from "../../src/renderer/enhancement-runtime-policy.js";

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
    teamManagement: false,
    xunlaiStorage: false,
    travelPalette: false,
    skillSlotGeometry: false,
    skillCooldownOverlay: false,
  });
  assert.deepEqual(enhancementRuntimePolicy("toolbox-commands", off, "pve"), {
    tools: true,
    targetReadout: false,
    teamManagement: true,
    xunlaiStorage: true,
    travelPalette: true,
    skillSlotGeometry: false,
    skillCooldownOverlay: false,
  });
  assert.deepEqual(enhancementRuntimePolicy("xunlai-storage", off, "pve"), {
    tools: true,
    targetReadout: false,
    teamManagement: false,
    xunlaiStorage: true,
    travelPalette: true,
    skillSlotGeometry: false,
    skillCooldownOverlay: false,
  });
  assert.deepEqual(enhancementRuntimePolicy("target-observer", off, "pve"), {
    tools: false,
    targetReadout: true,
    teamManagement: false,
    xunlaiStorage: false,
    travelPalette: false,
    skillSlotGeometry: false,
    skillCooldownOverlay: false,
  });
});

test("runtime-gated commands fail closed while storage keeps its refusal reason", () => {
  const on = Object.freeze({
    gwonmacTools: true,
    targetReadout: true,
    teamManagement: true,
    xunlaiStorage: true,
    travelPalette: true,
    skillKeyBindings: off.skillKeyBindings,
    skillCooldownOverlayEnabled: false,
  });
  for (const region of ["unknown", "pvp"] as const) {
    assert.equal(enhancementRuntimePolicy("toolbox-commands", on, region).teamManagement, false);
    assert.equal(enhancementRuntimePolicy("none", on, region).teamManagement, false);
    assert.equal(enhancementRuntimePolicy("none", on, region).xunlaiStorage, true);
    assert.equal(enhancementRuntimePolicy("none", on, region).travelPalette, false);
    assert.equal(enhancementRuntimePolicy("none", on, region).targetReadout, false);
    assert.equal(enhancementRuntimePolicy("none", on, region).tools, true);
  }
});

test("a snapshot remains authoritative when party evidence disagrees", () => {
  assert.equal(runtimePlayRegion("pvp", "pve"), "pvp");
  assert.equal(runtimePlayRegion("unknown", "pve"), "unknown");
  assert.equal(runtimePlayRegion("pve", "pvp"), "pve");
  assert.equal(runtimePlayRegion(null, "pve"), "pve");
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
    teamManagement: true,
    xunlaiStorage: false,
    travelPalette: true,
    skillSlotGeometry: true,
    skillCooldownOverlay: true,
  });
});

test("skill geometry runs only for configured labels or enabled cooldowns", () => {
  const empty = enhancementRuntimePolicy("none", {
    ...off,
    gwonmacTools: true,
    skillKeyBindings: [null, null, null, null, null, null, null, null],
    skillCooldownOverlayEnabled: false,
  }, "pve");
  assert.equal(empty.skillSlotGeometry, false);
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
  assert.equal(labels.skillSlotGeometry, true);
  assert.equal(labels.skillCooldownOverlay, false);
});

test("local Tools availability never depends on a live-game safety gate", () => {
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
                enabled
                  || program === "toolbox-foundation"
                  || program === "toolbox-commands"
                  || program === "xunlai-storage",
                `${program}/${playRegion} coupled local Tools to a live feature`,
              );
            }
          }
        }
      }
    }
  }
});
