/** Checks persistence validation and the untrusted snapshot boundary. */
import assert from "node:assert/strict";
import test from "node:test";
import { isAlcoholTimerPosition, formatAlcoholTimer } from "../../src/shared/alcohol-timer.ts";
import { readCompanionAlcohol } from "../../src/renderer/companion-alcohol-snapshot.ts";

test("saved alcohol offsets are finite, bounded and exact", () => {
  assert.equal(isAlcoholTimerPosition({ x: -50.5, y: 25, locked: false }), true);
  for (const value of [null, {}, { x: NaN, y: 0, locked: true }, { x: 0, y: 32769, locked: true },
    { x: 0, y: 0, locked: 1 }, { x: 0, y: 0, locked: true, extra: 1 }]) {
    assert.equal(isAlcoholTimerPosition(value), false);
  }
  assert.equal(formatAlcoholTimer(59999), "1:00");
  assert.equal(formatAlcoholTimer(1001), "0:02");
  assert.equal(formatAlcoholTimer(0), "0:00");
});
test("alcohol rejects torn, unidentified and out-of-range snapshots", () => {
  const buffer = new ArrayBuffer(64);
  const words = new Uint32Array(buffer, 4, 8);
  const seed = () => words.set([0x414c5747, (32 << 16) | 1, 2, 1, 1000, 60000, 1, 0]);
  seed(); assert.deepEqual(readCompanionAlcohol(buffer, 4), { status: "ready", sequence: 2, gameTimer: 1000, remainingMs: 60000 });
  for (const [index, value] of [[0, 0], [1, (32 << 16) | 2], [2, 3], [3, 2], [5, 300001], [6, 0]] as const) {
    seed(); words[index] = value; assert.deepEqual(readCompanionAlcohol(buffer, 4), { status: "waiting" });
  }
  for (const pointer of [-4, 0, 5, 36, NaN]) assert.deepEqual(readCompanionAlcohol(buffer, pointer), { status: "waiting" });
});


test("alcohol sits below visible rows instead of the reserved Effects panel", async () => {
  const { alcoholTimerAnchor } = await import("../../src/renderer/alcohol-timer-overlay.ts");
  const bounds = { x: 20, y: 30, left: 20, top: 30, right: 520, bottom: 430, width: 500, height: 400, toJSON() {} };
  const geometry = { status: "ready" as const, sequence: 2, generation: 1, frameId: 1,
    viewportWidth: 1000, viewportHeight: 800,
    anchor: { left: 100, right: 700, bottom: 300, top: 750 },
    icons: [{ skillId: 1, left: 100, right: 150, bottom: 700, top: 750 }] };
  assert.deepEqual(alcoholTimerAnchor(geometry, bounds), { x: 70, y: 80, scaleX: 0.5, scaleY: 0.5 });
  assert.deepEqual(alcoholTimerAnchor({ ...geometry, icons: [...geometry.icons,
    { skillId: 2, left: 160, right: 210, bottom: 640, top: 690 }] }, bounds),
  { x: 70, y: 110, scaleX: 0.5, scaleY: 0.5 });
  assert.deepEqual(alcoholTimerAnchor({ ...geometry, icons: [] }, bounds),
    { x: 70, y: 55, scaleX: 0.5, scaleY: 0.5 });
});
