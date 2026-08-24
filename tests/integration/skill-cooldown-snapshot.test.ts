import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  COMPANION_SKILL_COOLDOWN_BYTES,
  readCompanionSkillCooldowns,
} from "../../src/renderer/companion-skill-snapshot.ts";

function snapshot(overrides: Readonly<{
  sequence?: number;
  flags?: number;
  gameTimer?: number;
  playerAgentId?: number;
  timestamps?: readonly number[];
}> = {}) {
  const buffer = new ArrayBuffer(COMPANION_SKILL_COOLDOWN_BYTES);
  const view = new DataView(buffer);
  view.setUint32(0, 0x53435747, true);
  view.setUint16(4, 1, true);
  view.setUint16(6, COMPANION_SKILL_COOLDOWN_BYTES, true);
  view.setUint32(8, overrides.sequence ?? 2, true);
  view.setUint32(12, overrides.flags ?? 1, true);
  view.setUint32(16, 4, true);
  view.setUint32(20, overrides.gameTimer ?? 10_000, true);
  view.setUint32(24, overrides.playerAgentId ?? 7, true);
  (overrides.timestamps ?? [0, 11_000, 12_000, 13_000, 14_000, 15_000, 16_000, 17_000])
    .forEach((value, index) => view.setUint32(28 + index * 4, value, true));
  return buffer;
}

describe("skill cooldown snapshot ABI", () => {
  it("decodes exactly eight bounded timestamps", () => {
    const state = readCompanionSkillCooldowns(snapshot(), 0);
    assert.equal(state.status, "ready");
    if (state.status !== "ready") return;
    assert.equal(state.gameTimer, 10_000);
    assert.equal(state.rechargeTimestamps.length, 8);
    assert.deepEqual(state.rechargeTimestamps.slice(0, 3), [0, 11_000, 12_000]);
  });

  it("rejects torn, malformed, wrapped, partial, and loading records", () => {
    assert.deepEqual(readCompanionSkillCooldowns(snapshot({ sequence: 3 }), 0), {
      status: "waiting", reason: "writing",
    });
    assert.deepEqual(readCompanionSkillCooldowns(snapshot({
      timestamps: [0, 9_999, 0, 0, 0, 0, 0, 0],
    }), 0), { status: "waiting", reason: "corrupt" });
    assert.deepEqual(readCompanionSkillCooldowns(snapshot({
      timestamps: [0, 1_810_001, 0, 0, 0, 0, 0, 0],
    }), 0), { status: "waiting", reason: "corrupt" });
    assert.deepEqual(readCompanionSkillCooldowns(snapshot({
      flags: 2, gameTimer: 0, playerAgentId: 0,
      timestamps: [0, 0, 0, 0, 0, 0, 0, 0],
    }), 0), { status: "waiting", reason: "loading" });
    assert.deepEqual(readCompanionSkillCooldowns(snapshot({ flags: 3 }), 0), {
      status: "waiting", reason: "snapshot",
    });
  });
});
