import assert from "node:assert/strict";
import test from "node:test";
import {
  createStorageController,
  type StorageGameState,
} from "../../src/renderer/enhancement-storage-controller.js";

const accessible = {
  status: "ready",
  xunlaiAccess: true,
} satisfies StorageGameState;

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
      state: accessible,
    });
    controller.update({
      enabled: true,
      state: accessible,
    });
    assert.deepEqual(configurations, [[256, 0], [256, 1]]);

    const handled = new CustomEvent("gw:storage-open", { cancelable: true, detail: {} });
    eventTarget.dispatchEvent(handled);
    assert.equal(handled.defaultPrevented, true);
    assert.equal(opens, 1);

    controller.update({
      enabled: false,
      state: accessible,
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

test("storage fails closed without a confirmed character access proof", () => {
  const previousWindow = globalThis.window;
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: new EventTarget(),
  });
  try {
    const configurations: number[][] = [];
    const controller = createStorageController(
      () => 1,
      (pointer, enabled) => { configurations.push([pointer, enabled]); return 1; },
      512,
    );
    for (const state of [
      null,
      { status: "waiting" as const },
      { status: "ready" as const, xunlaiAccess: null },
      { status: "ready" as const, xunlaiAccess: false },
    ]) controller.update({ enabled: true, state });
    assert.deepEqual(configurations, [[512, 0]]);

    controller.update({ enabled: true, state: accessible });
    controller.update({
      enabled: true,
      state: { ...accessible, xunlaiAccess: false },
    });
    assert.deepEqual(configurations, [[512, 0], [512, 1], [512, 0]]);
    controller.dispose();
  } finally {
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: previousWindow,
    });
  }
});

test("storage development traces identify the live refusal without account data", () => {
  const previousWindow = globalThis.window;
  const previousDebug = console.debug;
  const messages: string[] = [];
  const eventTarget = new EventTarget();
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: eventTarget,
  });
  console.debug = (message?: unknown) => { messages.push(String(message)); };
  try {
    const controller = createStorageController(
      () => 1,
      () => 1,
      512,
      true,
    );
    controller.update({
      enabled: true,
      state: { status: "ready", xunlaiAccess: false },
    });
    eventTarget.dispatchEvent(new CustomEvent("gw:storage-open", {
      cancelable: true,
      detail: {},
    }));
    assert.ok(messages.some((message) =>
      message.includes("storage.refused")
      && message.includes('"state":"ready"')
      && message.includes('"access":false')
      && message.includes("cannot access Xunlai storage")
    ));
    controller.dispose();
  } finally {
    console.debug = previousDebug;
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: previousWindow,
    });
  }
});
