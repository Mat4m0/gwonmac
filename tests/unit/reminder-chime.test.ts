/** The reminder chime plays at most once per second. */
import assert from "node:assert/strict";
import test from "node:test";
import { createReminderChime } from "../../src/renderer/reminder-chime.js";

test("many reminders within a second play one chime", () => {
  const tones: number[] = [];
  class FakeAudio {
    currentTime = 0; destination = {};
    createOscillator() { return { frequency: { setValueAtTime() {} }, connect() {}, start: () => tones.push(1), stop() {}, onended: null }; }
    createGain() { return { gain: { setValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect() {} }; }
    close() { return Promise.resolve(); }
  }
  const original = (globalThis as { AudioContext?: unknown }).AudioContext;
  (globalThis as { AudioContext?: unknown }).AudioContext = FakeAudio;
  try {
    let now = 0;
    const chime = createReminderChime(() => now);
    assert.deepEqual([chime.play(), chime.play(), chime.play()], [true, false, false]);
    now = 999; assert.equal(chime.play(), false);
    now = 1_000; assert.equal(chime.play(), true);
    assert.equal(tones.length, 2);
    chime.dispose();
  } finally { (globalThis as { AudioContext?: unknown }).AudioContext = original; }
});
