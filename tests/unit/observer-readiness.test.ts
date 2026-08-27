import assert from "node:assert/strict";
import { test } from "node:test";
import {
  observerReadiness,
  setSkillCooldownReadiness,
  setSkillGeometryReadiness,
  subscribeObserverReadiness,
} from "../../src/renderer/observer-readiness.ts";

test("observer readiness retains only closed presentation state", () => {
  const published: ReturnType<typeof observerReadiness>[] = [];
  const unsubscribe = subscribeObserverReadiness((state) => published.push(state));

  assert.equal(setSkillGeometryReadiness({ status: "waiting", reason: "inactive" }), true);
  assert.equal(setSkillGeometryReadiness({ status: "waiting", reason: "inactive" }), false);
  assert.equal(setSkillGeometryReadiness({ status: "ready" }), true);
  assert.equal(setSkillCooldownReadiness("ready"), true);
  assert.equal(setSkillCooldownReadiness("ready"), false);
  unsubscribe();

  assert.deepEqual(observerReadiness(), {
    skillGeometry: { status: "ready" },
    skillCooldowns: "ready",
  });
  assert.equal(published.length, 3);
  assert.deepEqual(Object.keys(observerReadiness()).sort(), [
    "skillCooldowns",
    "skillGeometry",
  ]);
});
