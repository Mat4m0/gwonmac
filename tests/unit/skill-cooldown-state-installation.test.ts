import assert from "node:assert/strict";
import { it } from "node:test";
import { createSkillCooldownObservationInstallation } from "../../src/renderer/skill-cooldown-state-installation.ts";

it("withdraws a cooldown publication whose sequence stops advancing", () => {
  let now = 0;
  let scheduled: (() => void) | null = null;
  const installation = createSkillCooldownObservationInstallation(true, {
    now: () => now,
    schedule: (callback) => {
      scheduled = callback;
      return 1;
    },
    cancel: () => { scheduled = null; },
    staleAfterMs: 500,
  });
  installation.setActive(true);
  installation.sink?.update(Object.freeze({
    status: "ready",
    sequence: 2,
    generation: 1,
    gameTimer: 10_000,
    playerAgentId: 7,
    rechargeTimestamps: Object.freeze([0, 11_000, 0, 0, 0, 0, 0, 0]),
  }));
  assert.equal(installation.state.status, "ready");
  now = 500;
  const expire = scheduled as (() => void) | null;
  assert.ok(expire);
  expire();
  assert.deepEqual(installation.state, { status: "waiting", reason: "stale" });
  installation.sink?.update(Object.freeze({
    status: "ready",
    sequence: 2,
    generation: 1,
    gameTimer: 10_100,
    playerAgentId: 7,
    rechargeTimestamps: Object.freeze([0, 11_000, 0, 0, 0, 0, 0, 0]),
  }));
  assert.deepEqual(
    installation.state,
    { status: "waiting", reason: "stale" },
    "the same frozen publication must not reappear on the next render frame",
  );
});
