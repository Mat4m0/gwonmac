/** Status bar consumables: only listed, still running effects show, in a fixed order. */
import assert from "node:assert/strict";
import test from "node:test";
import { activeConsumables } from "../../src/renderer/status-bar-consumables.js";

const CELERITY = 2522, GRAIL = 2521, LUCKY_AURA = 1927, THIRTY = 30 * 60_000;
const observe = (gameTimer: number, ...effects: [skillId: number, appliedAt: number, duration?: number][]) =>
  activeConsumables({ status: "ready", sequence: 2, generation: 1, gameTimer, playerAgentId: 7,
    effects: effects.map(([skillId, appliedAtGameMs, durationMs = THIRTY], index) =>
      ({ effectId: index + 1, skillId, attributeLevel: 0, maintainerAgentId: 0, durationMs, appliedAtGameMs })) })
    .map(({ label, remainingMs }) => `${label} ${remainingMs}`);

test("shows running consumables in list order, longest instance, across a timer wrap", () => {
  for (const [name, actual, expected] of [
    ["list order, not application order", observe(1_000, [GRAIL, 0], [CELERITY, 1_000]), [`Essence ${THIRTY}`, `Grail ${THIRTY - 1_000}`]],
    ["a fresher instance wins", observe(THIRTY - 10_000, [CELERITY, 0], [CELERITY, THIRTY - 20_000]), [`Essence ${THIRTY - 10_000}`]],
    ["the game timer wraps", observe(5_000, [CELERITY, 0xffff_ffff - 4_999]), [`Essence ${THIRTY - 10_000}`]],
    ["run out", observe(THIRTY, [CELERITY, 0]), []],
    ["not a tracked effect", observe(0, [LUCKY_AURA, 0]), []],
    ["an hour-long placeholder", observe(0, [GRAIL, 0, 3_600_000]), []],
  ] as const) assert.deepEqual(actual, expected, name);
  assert.deepEqual(activeConsumables({ status: "waiting", reason: "loading" }), [], "a loading screen hides every chip");
});
