import assert from "node:assert/strict";
import test from "node:test";
import { createStorageController } from "../../src/renderer/enhancement-storage-controller.js";
import type { ToolboxObservation } from "../../src/shared/builds/live-party.js";

const readyObservation: ToolboxObservation = {
  status: "ready",
  party: {
    status: "ready",
    playRegion: "pve",
    inOutpost: true,
    slots: [],
  },
};

test("the storage controller owns policy, events, deduplication, and teardown", () => {
  const previousWindow = globalThis.window;
  const eventTarget = new EventTarget();
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: eventTarget,
  });
  try {
    const configurations: number[][] = [];
    let opens = 0;
    const controller = createStorageController(
      () => { opens += 1; return 1; },
      (pointer, enabled) => {
        configurations.push([pointer, enabled]);
        return 1;
      },
      256,
    );
    assert.deepEqual(configurations, [[256, 0]]);

    controller.update({
      enabled: true,
      playRegion: "pve",
      observation: readyObservation,
    });
    controller.update({
      enabled: true,
      playRegion: "pve",
      observation: readyObservation,
    });
    assert.deepEqual(configurations, [[256, 0], [256, 1]]);

    const handled = new CustomEvent("gw:storage-open", { cancelable: true, detail: {} });
    eventTarget.dispatchEvent(handled);
    assert.equal(handled.defaultPrevented, true);
    assert.equal(opens, 1);

    controller.update({
      enabled: false,
      playRegion: "pve",
      observation: readyObservation,
    });
    const refusedDetail: { error?: Error } = {};
    const refused = new CustomEvent("gw:storage-open", {
      cancelable: true,
      detail: refusedDetail,
    });
    eventTarget.dispatchEvent(refused);
    assert.equal(refused.defaultPrevented, true);
    assert.match(refusedDetail.error?.message ?? "", /turned off/);

    controller.dispose();
    assert.deepEqual(configurations.at(-1), [0, 0]);
    const afterDispose = new CustomEvent("gw:storage-open", { cancelable: true, detail: {} });
    eventTarget.dispatchEvent(afterDispose);
    assert.equal(afterDispose.defaultPrevented, false);
  } finally {
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: previousWindow,
    });
  }
});
