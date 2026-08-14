import assert from "node:assert/strict";
import test from "node:test";
import {
  enhancementRuntimePolicy,
  runtimePlayRegion,
} from "../../src/renderer/enhancement-runtime-policy.js";

const off = Object.freeze({ enabled: false, targetReadout: false, teamManagement: false });

test("developer programs replace saved optional-tool selection in PvE", () => {
  assert.deepEqual(enhancementRuntimePolicy("toolbox-foundation", off, "pve"), {
    tools: true,
    targetReadout: false,
    teamManagement: true,
  });
  assert.deepEqual(enhancementRuntimePolicy("toolbox-commands", off, "pve"), {
    tools: true,
    targetReadout: false,
    teamManagement: true,
  });
  assert.deepEqual(enhancementRuntimePolicy("target-observer", off, "pve"), {
    tools: false,
    targetReadout: true,
    teamManagement: false,
  });
});

test("unknown and PvP regions fail closed for every optional command surface", () => {
  const on = Object.freeze({ enabled: true, targetReadout: true, teamManagement: true });
  for (const region of ["unknown", "pvp"] as const) {
    assert.equal(enhancementRuntimePolicy("toolbox-commands", on, region).teamManagement, false);
    assert.equal(enhancementRuntimePolicy("none", on, region).teamManagement, false);
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
    enabled: true,
    targetReadout: false,
    teamManagement: true,
  }, "pve"), {
    tools: true,
    targetReadout: false,
    teamManagement: true,
  });
});

test("local Tools availability never depends on a live-game safety gate", () => {
  const regions = ["pve", "pvp", "unknown"] as const;
  const programs = [
    "none",
    "cursor-observer",
    "target-observer",
    "toolbox-foundation",
    "toolbox-commands",
  ] as const;
  for (const program of programs) {
    for (const playRegion of regions) {
      for (const enabled of [false, true]) {
        for (const teamManagement of [false, true]) {
          for (const targetReadout of [false, true]) {
            const policy = enhancementRuntimePolicy(program, {
              enabled,
              teamManagement,
              targetReadout,
            }, playRegion);
            assert.equal(
              policy.tools,
              enabled
                || program === "toolbox-foundation"
                || program === "toolbox-commands",
              `${program}/${playRegion} coupled local Tools to a live feature`,
            );
          }
        }
      }
    }
  }
});
