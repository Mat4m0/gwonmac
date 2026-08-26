import assert from "node:assert/strict";
import test from "node:test";
import { observeCompanion } from "../../src/renderer/companion-observer.js";

test("frame pollers run on every observer frame without an observation change", () => {
  const previousRequest = globalThis.requestAnimationFrame;
  const previousCancel = globalThis.cancelAnimationFrame;
  const scheduled: FrameRequestCallback[] = [];
  let cancelled = 0;
  globalThis.requestAnimationFrame = ((callback: FrameRequestCallback) => {
    scheduled.push(callback);
    return 7;
  }) as typeof requestAnimationFrame;
  globalThis.cancelAnimationFrame = ((handle: number) => {
    assert.equal(handle, 7);
    cancelled += 1;
  }) as typeof cancelAnimationFrame;

  try {
    let polls = 0;
    const stop = observeCompanion(
      {
        memory: new WebAssembly.Memory({ initial: 1 }),
        snapshotPointer: 0,
        toolboxPointer: 0,
        partyPointer: 0,
        snapshotReads: 0,
        rejectedSnapshots: 0,
        hertz: 0,
        lastRenderUs: 0,
        renderSamples: [],
      },
      [{ poll: () => { polls += 1; } }],
      null,
      null,
      false,
      false,
    );

    for (let frame = 0; frame < 3; frame += 1) {
      const callback = scheduled.shift();
      if (!callback) throw new Error("observer did not schedule its next frame");
      callback(frame * 16);
    }
    assert.equal(polls, 3);
    stop();
    assert.equal(cancelled, 1);
  } finally {
    globalThis.requestAnimationFrame = previousRequest;
    globalThis.cancelAnimationFrame = previousCancel;
  }
});

test("a disabled optional poller stops before touching its implementation", () => {
  const previousRequest = globalThis.requestAnimationFrame;
  const previousCancel = globalThis.cancelAnimationFrame;
  const scheduled: FrameRequestCallback[] = [];
  globalThis.requestAnimationFrame = ((callback: FrameRequestCallback) => {
    scheduled.push(callback);
    return 9;
  }) as typeof requestAnimationFrame;
  globalThis.cancelAnimationFrame = (() => undefined) as typeof cancelAnimationFrame;

  try {
    let enabled = true;
    let polls = 0;
    const stop = observeCompanion(
      {
        memory: new WebAssembly.Memory({ initial: 1 }),
        snapshotPointer: 0,
        toolboxPointer: 0,
        partyPointer: 0,
        snapshotReads: 0,
        rejectedSnapshots: 0,
        hertz: 0,
        lastRenderUs: 0,
        renderSamples: [],
      },
      [{ enabled: () => enabled, poll: () => { polls += 1; } }],
      null,
      null,
      false,
      false,
    );

    scheduled.shift()?.(0);
    enabled = false;
    scheduled.shift()?.(16);
    scheduled.shift()?.(32);
    assert.equal(polls, 1);
    stop();
  } finally {
    globalThis.requestAnimationFrame = previousRequest;
    globalThis.cancelAnimationFrame = previousCancel;
  }
});
