import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  SIGN_IN_CLEANUP_DEADLINE_MS,
  waitForSignInCleanup,
} from "../../src/main/core/steam-cleanup.js";

describe("Steam sign-in cleanup deadline", () => {
  it("settles immediately when cleanup succeeds or rejects", async () => {
    for (const cleanup of [
      Promise.resolve(),
      Promise.reject(new Error("fixture cleanup failure")),
    ]) {
      let cleared = false;
      await waitForSignInCleanup(cleanup, {
        set: () => 1,
        clear: () => {
          cleared = true;
        },
      });
      assert.equal(cleared, true);
    }
  });

  it("uses the one deadline and cancels its timer without waiting for a clock", async () => {
    let releaseDeadline: (() => void) | undefined;
    let delay = 0;
    let cleared: unknown;
    const waiting = waitForSignInCleanup(
      new Promise(() => undefined),
      {
        set: (callback, delayMs) => {
          releaseDeadline = callback;
          delay = delayMs;
          return "deadline";
        },
        clear: (handle) => {
          cleared = handle;
        },
      },
    );
    assert.equal(delay, SIGN_IN_CLEANUP_DEADLINE_MS);
    assert.ok(releaseDeadline);
    releaseDeadline();
    await waiting;
    assert.equal(cleared, "deadline");
  });
});
