import assert from "node:assert/strict";
import test from "node:test";
import { observeCompanion } from "../../src/renderer/companion-observer.js";
import {
  COMPANION_SKILL_SLOT_ABI,
  COMPANION_SKILL_SLOT_BYTES,
  type CompanionSkillSlotState,
} from "../../src/renderer/companion-interface-geometry-snapshot.js";

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

test("Core reads chat geometry without loading optional Tools readers", () => {
  const previousRequest = globalThis.requestAnimationFrame;
  const previousCancel = globalThis.cancelAnimationFrame;
  const scheduled: FrameRequestCallback[] = [];
  globalThis.requestAnimationFrame = ((callback: FrameRequestCallback) => {
    scheduled.push(callback);
    return 11;
  }) as typeof requestAnimationFrame;
  globalThis.cancelAnimationFrame = (() => undefined) as typeof cancelAnimationFrame;

  try {
    const memory = new WebAssembly.Memory({ initial: 1 });
    const view = new DataView(memory.buffer, 0, COMPANION_SKILL_SLOT_BYTES);
    view.setUint32(0, 0x534b5747, true);
    view.setUint16(4, COMPANION_SKILL_SLOT_ABI, true);
    view.setUint16(6, COMPANION_SKILL_SLOT_BYTES, true);
    view.setUint32(8, 2, true);
    view.setUint32(12, 3, true);
    view.setUint32(16, 1, true);
    view.setUint32(164, 42, true);
    view.setFloat32(172, 100, true);
    view.setFloat32(176, 200, true);
    view.setFloat32(180, 900, true);
    view.setFloat32(184, 240, true);
    view.setFloat32(28, 1_920, true);
    view.setFloat32(32, 1_080, true);
    for (let index = 0; index < 8; index += 1) {
      const at = 36 + index * 16;
      view.setFloat32(at, 10 + index * 20, true);
      view.setFloat32(at + 4, 10, true);
      view.setFloat32(at + 8, 20 + index * 20, true);
      view.setFloat32(at + 12, 20, true);
    }
    const states: CompanionSkillSlotState[] = [];
    const stop = observeCompanion(
      {
        memory,
        snapshotPointer: 0,
        toolboxPointer: 0,
        partyPointer: 0,
        skillSlotPointer: 0,
        snapshotReads: 0,
        rejectedSnapshots: 0,
        hertz: 0,
        lastRenderUs: 0,
        renderSamples: [],
      },
      [],
      null,
      null,
      false,
      false,
      { update: (next) => { states.push(next); } },
    );

    scheduled.shift()?.(0);
    const state = states.at(-1);
    assert.equal(state?.status, "ready");
    if (state?.status === "ready") {
      assert.deepEqual(state.chatInput, {
        left: 100,
        bottom: 200,
        right: 900,
        top: 240,
      });
    }
    stop();
  } finally {
    globalThis.requestAnimationFrame = previousRequest;
    globalThis.cancelAnimationFrame = previousCancel;
  }
});
