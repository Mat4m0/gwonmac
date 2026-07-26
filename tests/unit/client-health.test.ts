import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createClientHealthConfirmation } from "../../src/renderer/client-health.js";
import type { ClientHealthToken } from "../../src/shared/contracts.js";

const token: ClientHealthToken = {
  generation: 7,
  fingerprint: "a".repeat(64),
};

const turn = () => new Promise<void>((resolve) => setImmediate(resolve));

/**
 * The controller's timer handle is whatever the host's `setTimeout` returns, so
 * the fake hands back real handles instead of integer ids of its own. Standing
 * in with a different handle type would let this test agree with a `schedule`
 * and `cancel` pair the controller could never be given. The timers are
 * cancelled the moment they are created — only the handle's identity is used,
 * and nothing here may fire on its own.
 */
type RetryTimer = ReturnType<typeof setTimeout>;

function fakeScheduler() {
  const pending = new Map<RetryTimer, () => void>();
  return {
    schedule(task: () => void, delayMs: number) {
      assert.equal(delayMs, 1_000);
      const timer = setTimeout(() => {}, 1_000);
      clearTimeout(timer);
      pending.set(timer, task);
      return timer;
    },
    cancel(timer: RetryTimer) {
      pending.delete(timer);
    },
    runNext() {
      const entry = pending.entries().next().value;
      assert.ok(entry, "no retry was scheduled");
      const [timer, task] = entry;
      pending.delete(timer);
      task();
    },
    count: () => pending.size,
  };
}

describe("client health confirmation", () => {
  it("waits for both signals and retries one rejection without duplicating success", async () => {
    const scheduler = fakeScheduler();
    let attempts = 0;
    const failures: Array<{ attempt: number; willRetry: boolean }> = [];
    const confirmation = createClientHealthConfirmation({
      token,
      confirm: async (received) => {
        assert.deepEqual(received, token);
        attempts += 1;
        if (attempts === 1) throw new Error("transient");
      },
      onFailure: (_error, attempt, willRetry) => {
        failures.push({ attempt, willRetry });
      },
      schedule: scheduler.schedule,
      cancel: scheduler.cancel,
    });

    confirmation.firstFramePresented();
    confirmation.firstFramePresented();
    await turn();
    assert.equal(attempts, 0, "a frame alone confirmed the candidate");

    confirmation.gameSocketOpened();
    confirmation.gameSocketOpened();
    await turn();
    assert.equal(attempts, 1);
    assert.equal(scheduler.count(), 1);
    assert.deepEqual(failures, [{ attempt: 1, willRetry: true }]);

    confirmation.firstFramePresented();
    confirmation.gameSocketOpened();
    await turn();
    assert.equal(attempts, 1);
    assert.equal(scheduler.count(), 1, "readiness signals duplicated the retry");

    scheduler.runNext();
    await turn();
    assert.equal(attempts, 2);
    assert.equal(scheduler.count(), 0);

    confirmation.firstFramePresented();
    confirmation.gameSocketOpened();
    await turn();
    assert.equal(attempts, 2, "success was not idempotent");
  });

  it("stops after three permanent failures", async () => {
    const scheduler = fakeScheduler();
    let attempts = 0;
    const failures: Array<{ attempt: number; willRetry: boolean }> = [];
    const confirmation = createClientHealthConfirmation({
      token,
      confirm: async () => {
        attempts += 1;
        throw new Error("permanent");
      },
      onFailure: (_error, attempt, willRetry) => {
        failures.push({ attempt, willRetry });
      },
      schedule: scheduler.schedule,
      cancel: scheduler.cancel,
    });

    confirmation.firstFramePresented();
    confirmation.gameSocketOpened();
    await turn();
    scheduler.runNext();
    await turn();
    scheduler.runNext();
    await turn();

    assert.equal(attempts, 3);
    assert.equal(scheduler.count(), 0);
    assert.deepEqual(failures, [
      { attempt: 1, willRetry: true },
      { attempt: 2, willRetry: true },
      { attempt: 3, willRetry: false },
    ]);

    confirmation.firstFramePresented();
    confirmation.gameSocketOpened();
    await turn();
    assert.equal(attempts, 3, "permanent failure exceeded the retry bound");
  });

  it("cancels a pending retry when the renderer unloads", async () => {
    const scheduler = fakeScheduler();
    let attempts = 0;
    const confirmation = createClientHealthConfirmation({
      token,
      confirm: async () => {
        attempts += 1;
        throw new Error("transient");
      },
      onFailure: () => undefined,
      schedule: scheduler.schedule,
      cancel: scheduler.cancel,
    });

    confirmation.firstFramePresented();
    confirmation.gameSocketOpened();
    await turn();
    assert.equal(scheduler.count(), 1);

    confirmation.dispose();
    assert.equal(scheduler.count(), 0);
    await turn();
    assert.equal(attempts, 1);
  });
});
