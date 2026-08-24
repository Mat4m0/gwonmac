import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  ADDRESSES,
  createKernel,
  FEATURE_GAME_SNAPSHOT,
  FEATURE_PLAY_REGION_OBSERVATION,
  FEATURE_SKILL_COOLDOWN_OBSERVATION,
  FEATURE_SKILL_SLOT_GEOMETRY,
  FEATURE_TOOLBOX_FOUNDATION,
  installGameGraph,
  installPlayerSkillbarConfig,
} from "../fixtures/enhancements.ts";

const AREA_133 = ADDRESSES.areaInfo + 133 * 0x7c;

describe("play-region kernel", () => {
  it("publishes the bounded area policy without traversing the agent array", async () => {
    const kernel = await createKernel();
    installGameGraph(kernel.view);
    kernel.view.setUint32(ADDRESSES.agentArray, 0xffff_fffc, true);
    kernel.view.setUint32(ADDRESSES.agentArray + 4, 0xffff_ffff, true);
    kernel.view.setUint32(ADDRESSES.agentArray + 8, 0xffff_ffff, true);
    assert.equal(kernel.init({ features: FEATURE_PLAY_REGION_OBSERVATION }), 1);

    kernel.tick();
    assert.deepEqual(kernel.playRegion(), {
      status: "ready",
      sequence: 4,
      mapId: 133,
      instanceType: 0,
      playRegion: "pve",
    });

    kernel.view.setUint32(AREA_133 + 0x10, 1, true);
    kernel.tick();
    assert.deepEqual(kernel.playRegion(), {
      status: "ready",
      sequence: 6,
      mapId: 133,
      instanceType: 0,
      playRegion: "pvp",
    });
  });

  it("publishes loading and withdraws malformed area data", async () => {
    const kernel = await createKernel();
    installGameGraph(kernel.view);
    assert.equal(kernel.init({ features: FEATURE_PLAY_REGION_OBSERVATION }), 1);

    kernel.view.setUint32(ADDRESSES.character + 0x23c, 2, true);
    kernel.tick();
    assert.deepEqual(kernel.playRegion(), {
      status: "waiting", reason: "loading",
    });

    kernel.view.setUint32(ADDRESSES.character + 0x23c, 0, true);
    kernel.view.setUint32(AREA_133 + 0x0c, 22, true);
    kernel.tick();
    assert.deepEqual(kernel.playRegion(), {
      status: "waiting", reason: "game",
    });
  });

  it("requires its exact region and cannot be deactivated after init", async () => {
    const invalid = await createKernel();
    assert.equal(invalid.init({
      features: FEATURE_PLAY_REGION_OBSERVATION,
      playRegionSize: 24,
    }), 0);

    const kernel = await createKernel();
    installGameGraph(kernel.view);
    assert.equal(kernel.init({ features: FEATURE_PLAY_REGION_OBSERVATION }), 1);
    kernel.activeFeatures(0);
    kernel.tick();
    const first = kernel.playRegion();
    assert.equal(first.status, "ready");
    kernel.tick();
    const second = kernel.playRegion();
    assert.equal(second.status, "ready");
    if (first.status === "ready" && second.status === "ready") {
      assert.equal(second.sequence, first.sequence + 2);
    }
  });

  it("decouples both skill observations from Toolbox", async () => {
    const geometryWithoutRegion = await createKernel();
    assert.equal(geometryWithoutRegion.init({
      features: FEATURE_SKILL_SLOT_GEOMETRY,
    }), 0);

    const geometry = await createKernel();
    assert.equal(geometry.init({
      features: FEATURE_PLAY_REGION_OBSERVATION | FEATURE_SKILL_SLOT_GEOMETRY,
    }), 1);

    const cooldownWithoutRegion = await createKernel();
    installPlayerSkillbarConfig(cooldownWithoutRegion.config);
    assert.equal(cooldownWithoutRegion.init({
      features: FEATURE_SKILL_COOLDOWN_OBSERVATION,
    }), 0);

    const cooldown = await createKernel();
    installPlayerSkillbarConfig(cooldown.config);
    assert.equal(cooldown.init({
      features:
        FEATURE_PLAY_REGION_OBSERVATION
        | FEATURE_SKILL_COOLDOWN_OBSERVATION,
    }), 1);
  });

  it("is required by every native observation that publishes region-dependent state", async () => {
    const cases = [
      { name: "game snapshot", feature: FEATURE_GAME_SNAPSHOT },
      { name: "Toolbox foundation", feature: FEATURE_TOOLBOX_FOUNDATION },
      { name: "skill-slot geometry", feature: FEATURE_SKILL_SLOT_GEOMETRY },
      {
        name: "skill cooldowns",
        feature: FEATURE_SKILL_COOLDOWN_OBSERVATION,
      },
    ] as const;

    for (const { name, feature } of cases) {
      const withoutRegion = await createKernel({ partyDetail: true });
      assert.equal(
        withoutRegion.init({ features: feature }),
        0,
        `${name} must fail closed without play-region observation`,
      );

      const withRegion = await createKernel({ partyDetail: true });
      assert.equal(
        withRegion.init({ features: feature | FEATURE_PLAY_REGION_OBSERVATION }),
        1,
        `${name} must accept its declared play-region substrate`,
      );
    }
  });

  it("rejects active observer masks that detach dependants from the policy substrate", async () => {
    const kernel = await createKernel({ partyDetail: true });
    installGameGraph(kernel.view);
    assert.equal(kernel.init({
      features: FEATURE_PLAY_REGION_OBSERVATION | FEATURE_TOOLBOX_FOUNDATION,
    }), 1);

    kernel.activeFeatures(FEATURE_PLAY_REGION_OBSERVATION);
    kernel.tick();
    const disabled = kernel.toolbox();
    assert.equal(disabled.status, "ready");
    if (disabled.status !== "ready") return;
    const disabledSequence = disabled.sequence;

    kernel.activeFeatures(FEATURE_TOOLBOX_FOUNDATION);
    kernel.tick();
    const stillDisabled = kernel.toolbox();
    assert.equal(stillDisabled.status, "ready");
    if (stillDisabled.status !== "ready") return;
    assert.equal(stillDisabled.sequence, disabledSequence,
      "an invalid active mask must leave Toolbox disabled");

    kernel.activeFeatures(
      FEATURE_PLAY_REGION_OBSERVATION | FEATURE_TOOLBOX_FOUNDATION,
    );
    kernel.tick();
    const enabled = kernel.toolbox();
    assert.equal(enabled.status, "ready");
    if (enabled.status !== "ready") return;
    assert.notEqual(enabled.sequence, disabledSequence);

    const cooldown = await createKernel({ partyDetail: true });
    assert.equal(cooldown.init({
      features:
        FEATURE_PLAY_REGION_OBSERVATION | FEATURE_SKILL_COOLDOWN_OBSERVATION,
    }), 1);
    cooldown.activeFeatures(FEATURE_PLAY_REGION_OBSERVATION);
    cooldown.tick();
    const cooldownSequence = cooldown.view.getUint32(
      ADDRESSES.skillCooldowns + 8,
      true,
    );
    cooldown.activeFeatures(FEATURE_SKILL_COOLDOWN_OBSERVATION);
    cooldown.tick();
    assert.equal(
      cooldown.view.getUint32(ADDRESSES.skillCooldowns + 8, true),
      cooldownSequence,
      "an invalid active mask must leave cooldown observation disabled",
    );
    cooldown.activeFeatures(
      FEATURE_PLAY_REGION_OBSERVATION | FEATURE_SKILL_COOLDOWN_OBSERVATION,
    );
    cooldown.tick();
    assert.notEqual(
      cooldown.view.getUint32(ADDRESSES.skillCooldowns + 8, true),
      cooldownSequence,
    );
  });
});
