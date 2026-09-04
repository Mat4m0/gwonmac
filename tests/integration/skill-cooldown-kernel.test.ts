/**
 * Focused native-kernel coverage for the bounded player recharge record.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ENHANCEMENT_LAYOUT_FIELDS } from "../../src/shared/enhancement-config.ts";
import {
  ADDRESSES,
  createKernel,
  DETAIL,
  FEATURE_PLAY_REGION_OBSERVATION,
  FEATURE_SKILL_COOLDOWN_OBSERVATION,
  installGameGraph,
  installPlayerSkillbarConfig,
  installPlayerSkillbarGraph,
} from "../fixtures/enhancements.ts";

const FEATURES = FEATURE_PLAY_REGION_OBSERVATION
  | FEATURE_SKILL_COOLDOWN_OBSERVATION;

function rechargeAddress(row: number, slot: number): number {
  return row + DETAIL.skillbarSkills + slot * DETAIL.skillSlotStride + 0x08;
}

function installRechargeRow(
  view: DataView,
  row: number,
  gameTimer = 10_000,
): void {
  for (let slot = 0; slot < 8; slot += 1) {
    view.setUint32(
      rechargeAddress(row, slot),
      slot === 0 ? 0 : gameTimer + slot * 1_000,
      true,
    );
  }
}

describe("skill cooldown kernel", () => {
  it("publishes only a complete, bounded player recharge row", async () => {
    const kernel = await createKernel();
    installGameGraph(kernel.view);
    installPlayerSkillbarConfig(kernel.config);
    for (const key of ["partyContext", "skillSlotId", "skillbarDisabled"] as const) {
      assert.equal(kernel.config[ENHANCEMENT_LAYOUT_FIELDS.indexOf(key)], 0);
    }
    installPlayerSkillbarGraph(kernel.view);
    const playerRow = ADDRESSES.skillbarBuffer;
    installRechargeRow(kernel.view, playerRow);
    assert.equal(kernel.init({ features: FEATURES }), 1);
    kernel.tick(0, 10_000);
    const ready = kernel.skillCooldowns();
    assert.equal(ready.status, "ready");
    if (ready.status !== "ready") return;
    assert.equal(ready.playerAgentId, 7);
    assert.deepEqual(ready.rechargeTimestamps, [
      0, 11_000, 12_000, 13_000, 14_000, 15_000, 16_000, 17_000,
    ]);

    kernel.view.setUint32(
      rechargeAddress(playerRow, 3),
      10_000 + 1_800_001,
      true,
    );
    kernel.tick(0, 10_000);
    assert.deepEqual(kernel.skillCooldowns(), {
      status: "waiting",
      reason: "game",
    });
  });

  it("validates the cached row and periodically re-audits table ambiguity", async () => {
    const kernel = await createKernel();
    installGameGraph(kernel.view);
    installPlayerSkillbarConfig(kernel.config);
    installPlayerSkillbarGraph(kernel.view, [77, 88, 7]);
    const playerRow = ADDRESSES.skillbarBuffer + 2 * DETAIL.skillbarStride;
    installRechargeRow(kernel.view, playerRow);
    assert.equal(kernel.init({ features: FEATURES }), 1);
    kernel.tick(0, 10_000);
    assert.equal(kernel.skillCooldowns().status, "ready");

    kernel.view.setUint32(ADDRESSES.skillbarBuffer, 7, true);
    kernel.view.setUint32(
      ADDRESSES.skillbarBuffer + DETAIL.skillbarStride,
      7,
      true,
    );
    kernel.tick(0, 10_000);
    assert.equal(
      kernel.skillCooldowns().status,
      "ready",
      "ordinary ticks validate only the cached player row",
    );

    for (let tick = 0; tick < 29; tick += 1) kernel.tick(0, 10_000);
    assert.equal(
      kernel.skillCooldowns().status,
      "ready",
      "the bounded table audit has not reached its interval",
    );
    kernel.tick(0, 10_000);
    assert.deepEqual(kernel.skillCooldowns(), {
      status: "waiting",
      reason: "game",
    });

    kernel.view.setUint32(ADDRESSES.skillbarBuffer, 77, true);
    kernel.view.setUint32(
      ADDRESSES.skillbarBuffer + DETAIL.skillbarStride,
      88,
      true,
    );
    kernel.tick(0, 10_000);
    assert.equal(
      kernel.skillCooldowns().status,
      "ready",
      "ambiguity withdrawal keeps auditing until one unique row recovers",
    );

    kernel.view.setUint32(playerRow, 99, true);
    kernel.view.setUint32(ADDRESSES.skillbarBuffer, 7, true);
    kernel.view.setUint32(
      ADDRESSES.skillbarBuffer + DETAIL.skillbarStride,
      7,
      true,
    );
    kernel.tick(0, 10_000);
    assert.deepEqual(kernel.skillCooldowns(), {
      status: "waiting",
      reason: "game",
    }, "a cached-row identity failure audits and rejects duplicates immediately");

    kernel.view.setUint32(playerRow, 7, true);
    const skillbarArray = ADDRESSES.world + DETAIL.skillbars;
    kernel.view.setUint32(skillbarArray + 8, 0, true);
    kernel.tick(0, 10_000);
    assert.deepEqual(kernel.skillCooldowns(), {
      status: "waiting",
      reason: "game",
    });
    kernel.view.setUint32(skillbarArray + 8, 3, true);
    kernel.tick(0, 10_000);
    assert.deepEqual(kernel.skillCooldowns(), {
      status: "waiting",
      reason: "game",
    }, "table recovery audits and rejects duplicates before reusing a cached row");
  });

  it("withdraws the whole record while loading or in PvP", async () => {
    const kernel = await createKernel();
    installGameGraph(kernel.view);
    installPlayerSkillbarConfig(kernel.config);
    installPlayerSkillbarGraph(kernel.view);
    installRechargeRow(kernel.view, ADDRESSES.skillbarBuffer);
    assert.equal(kernel.init({ features: FEATURES }), 1);
    kernel.tick(0, 10_000);
    assert.equal(kernel.skillCooldowns().status, "ready");

    kernel.view.setUint32(ADDRESSES.character + 0x23c, 2, true);
    kernel.tick(0, 10_000);
    assert.deepEqual(kernel.skillCooldowns(), {
      status: "waiting",
      reason: "loading",
    });

    kernel.view.setUint32(ADDRESSES.character + 0x23c, 0, true);
    kernel.tick(0, 10_000);
    assert.equal(kernel.skillCooldowns().status, "ready");
    kernel.view.setUint32(ADDRESSES.areaInfo + 133 * 0x7c + 0x10, 1, true);
    kernel.tick(0, 10_000);
    assert.deepEqual(kernel.skillCooldowns(), {
      status: "waiting",
      reason: "game",
    });

    kernel.view.setUint32(ADDRESSES.character + 0x19c, 1, true);
    kernel.view.setUint32(ADDRESSES.character + 0x23c, 1, true);
    kernel.tick(0, 10_000);
    assert.deepEqual(kernel.skillCooldowns(), {
      status: "waiting",
      reason: "game",
    });
  });
});
