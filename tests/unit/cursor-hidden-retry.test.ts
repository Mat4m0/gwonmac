/**
 * The hidden-cursor retry loop's invariants: the first ask rides the poll
 * after the hide, later asks are paced by the interval, the deadline stops it
 * permanently until the cursor resolves, the resolved gap is recorded, and
 * `active` names exactly the window in which the consumer may hold art.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createHiddenCursorRetry } from "../../src/renderer/cursor-refresh.js";

function harness(retestResult = true) {
  let clock = 0;
  let retests = 0;
  const retry = createHiddenCursorRetry(
    () => {
      retests += 1;
      return retestResult;
    },
    () => clock,
  );
  return {
    retry,
    attempts: () => retests,
    tick(ms: number, state: { hidden: boolean; valid: boolean }) {
      clock += ms;
      retry.afterPoll(state);
    },
  };
}

const HIDDEN = { hidden: true, valid: true };
const VISIBLE = { hidden: false, valid: true };
const WAITING = { hidden: false, valid: false };

describe("hidden-cursor retry", () => {
  it("asks on the poll after the hide, then paces by the interval", () => {
    const h = harness();
    h.tick(0, HIDDEN);
    assert.equal(h.attempts(), 0);
    h.tick(16, HIDDEN);
    assert.equal(h.attempts(), 1);
    h.tick(16, HIDDEN);
    assert.equal(h.attempts(), 1);
    h.tick(150, HIDDEN);
    assert.equal(h.attempts(), 2);
  });

  it("asks once per interval, not once per poll", () => {
    const h = harness();
    h.tick(0, HIDDEN);
    for (let i = 0; i < 20; i += 1) h.tick(16, HIDDEN);
    // First ask at 16 ms, one more paced ask inside the remaining 304 ms.
    assert.equal(h.attempts(), 2);
  });

  it("stops at the deadline and stays stopped until the cursor resolves", () => {
    const h = harness();
    h.tick(0, HIDDEN);
    for (let i = 0; i < 200; i += 1) h.tick(50, HIDDEN);
    const atDeadline = h.attempts();
    // Asks at 50 ms then every 150 ms until the 2,500 ms deadline.
    assert.equal(atDeadline, 17);
    h.tick(5_000, HIDDEN);
    assert.equal(h.attempts(), atDeadline);
    // Resolution re-arms the loop for the next transition.
    h.tick(16, VISIBLE);
    h.tick(16, HIDDEN);
    h.tick(16, HIDDEN);
    assert.equal(h.attempts(), atDeadline + 1);
  });

  it("is not expired before the loop has seen anything", () => {
    // The hold predicate is `!expired && armed`. The consumer applies a hide
    // before the loop learns of it, so a fresh loop must already answer
    // "hold" — an activity-shaped flag here would miss the hide frame.
    const h = harness();
    assert.equal(h.retry.expired, false);
  });

  it("expires at the deadline and resets on resolution", () => {
    const h = harness();
    h.tick(0, HIDDEN);
    assert.equal(h.retry.expired, false);
    h.tick(2_000, HIDDEN);
    assert.equal(h.retry.expired, false);
    h.tick(1_000, HIDDEN);
    assert.equal(h.retry.expired, true);
    h.tick(16, VISIBLE);
    assert.equal(h.retry.expired, false);
    h.tick(16, HIDDEN);
    assert.equal(h.retry.expired, false);
  });

  it("records the resolved gap and only for a valid resolution", () => {
    const h = harness();
    h.tick(0, HIDDEN);
    h.tick(400, HIDDEN);
    h.tick(100, VISIBLE);
    assert.equal(h.retry.lastGapMs, 500);
    h.tick(16, HIDDEN);
    h.tick(16, WAITING);
    // An invalid poll is not a resolution; the recorded gap is unchanged.
    assert.equal(h.retry.lastGapMs, 500);
  });

  it("counts only re-tests the dispatcher accepted", () => {
    const h = harness(false);
    h.tick(0, HIDDEN);
    h.tick(200, HIDDEN);
    h.tick(200, HIDDEN);
    assert.equal(h.attempts(), 2);
    assert.equal(h.retry.retests, 0);
  });

  it("does nothing while the consumer has no valid state", () => {
    const h = harness();
    for (let i = 0; i < 10; i += 1) h.tick(100, WAITING);
    assert.equal(h.attempts(), 0);
    assert.equal(h.retry.expired, false);
  });
});
