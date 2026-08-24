/**
 * Focused native-kernel coverage for the bounded player recharge record.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  ADDRESSES,
  COOLDOWN_CONFIG_START,
  createKernel,
  DETAIL,
  FEATURE_PLAY_REGION_OBSERVATION,
  FEATURE_SKILL_COOLDOWN_OBSERVATION,
  FEATURE_TOOLBOX_FOUNDATION,
  installGameGraph,
  installPartyDetailGraph,
} from "../fixtures/enhancements.ts";

describe("skill cooldown kernel", () => {
  it("publishes only a complete, bounded player recharge row", async () => {
    const kernel = await createKernel({ partyDetail: true });
    installGameGraph(kernel.view);
    installPartyDetailGraph(kernel.view);
    kernel.config[COOLDOWN_CONFIG_START] = 0x08;
    const playerRow = ADDRESSES.skillbarBuffer + 2 * DETAIL.skillbarStride;
    for (let slot = 0; slot < 8; slot += 1) {
      kernel.view.setUint32(
        playerRow + DETAIL.skillbarSkills + slot * DETAIL.skillSlotStride + 0x08,
        slot === 0 ? 0 : 10_000 + slot * 1_000,
        true,
      );
    }
    assert.equal(kernel.init({
      features:
        FEATURE_TOOLBOX_FOUNDATION | FEATURE_PLAY_REGION_OBSERVATION
          | FEATURE_SKILL_COOLDOWN_OBSERVATION,
    }), 1);
    kernel.tick(0, 10_000);
    const ready = kernel.skillCooldowns();
    assert.equal(ready.status, "ready");
    if (ready.status !== "ready") return;
    assert.equal(ready.playerAgentId, 7);
    assert.deepEqual(ready.rechargeTimestamps, [
      0, 11_000, 12_000, 13_000, 14_000, 15_000, 16_000, 17_000,
    ]);

    kernel.view.setUint32(
      playerRow + DETAIL.skillbarSkills + 3 * DETAIL.skillSlotStride + 0x08,
      10_000 + 1_800_001,
      true,
    );
    kernel.tick(0, 10_000);
    assert.deepEqual(kernel.skillCooldowns(), {
      status: "waiting",
      reason: "game",
    });
  });
});
