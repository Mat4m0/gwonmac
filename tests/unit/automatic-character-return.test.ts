/** The automatic-return owner must not miss a fast character-select transition. */
import assert from "node:assert/strict";
import test from "node:test";
import { installAutomaticCharacterReturn } from "../../src/renderer/automatic-character-return.js";
import { installLoginStatus } from "../../src/renderer/login-status.js";
import type { RendererMilestone } from "../../src/shared/diagnostics.js";

test("a timed-out return notice clears itself", async (context) => {
  const status = { hidden: true, textContent: "" };
  const loginStatus = installLoginStatus(status as unknown as HTMLElement);
  context.mock.timers.enable({ apis: ["setTimeout"] });

  const controller = installAutomaticCharacterReturn({
    claimIntent: async () => true,
    input: () => null,
    record() {},
    status: loginStatus,
  });

  try {
    await Promise.resolve();
    context.mock.timers.tick(30_000);

    assert.equal(status.hidden, false);
    assert.match(status.textContent, /You can continue manually\./);

    context.mock.timers.tick(7_999);
    assert.equal(status.hidden, false);

    context.mock.timers.tick(1);
    assert.equal(status.hidden, true);
  } finally {
    controller.dispose();
    context.mock.timers.reset();
  }
});

test("manual character switching clears an elapsed return notice", async (context) => {
  const status = { hidden: true, textContent: "" };
  const loginStatus = installLoginStatus(status as unknown as HTMLElement);
  context.mock.timers.enable({ apis: ["setTimeout"] });
  const controller = installAutomaticCharacterReturn({
    claimIntent: async () => true,
    input: () => null,
    record() {},
    status: loginStatus,
  });

  try {
    await Promise.resolve();
    context.mock.timers.tick(30_000);
    assert.equal(status.hidden, false);

    controller.cancelForCharacterSwitch();
    assert.equal(status.hidden, true);
  } finally {
    controller.dispose();
    context.mock.timers.reset();
  }
});

test("a pending login cannot record input after its terminal timeout", async (context) => {
  const originalDocument = globalThis.document;
  const originalWindow = globalThis.window;
  const originalAnimationFrame = globalThis.requestAnimationFrame;
  const browserWindow = new EventTarget() as EventTarget & {
    gwPreGameControls: PreGameControls;
  };
  browserWindow.gwPreGameControls = {
    state: () => "unknown",
    switchContext: () => "unavailable",
    diagnosticMask: () => 0,
  };
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: browserWindow,
  });
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: {
      visibilityState: "visible",
      hasFocus: () => true,
    },
  });
  globalThis.requestAnimationFrame = ((callback: FrameRequestCallback) => {
    queueMicrotask(() => callback(performance.now()));
    return 1;
  });
  context.mock.timers.enable({ apis: ["setTimeout"] });

  let settleLogin: ((outcome: AutomaticEnterOutcome) => void) | null = null;
  const records: Array<{ name: RendererMilestone; fields: unknown }> = [];
  const input: GameInputController = {
    releaseAll() {},
    traceState() {},
    cancelAutomaticEnter() {
      settleLogin?.("cancelled");
      settleLogin = null;
    },
    setLoginProviderChooser() {},
    expectCharacterSelection() {},
    submitSavedLogin: () => new Promise((resolve) => { settleLogin = resolve; }),
    playSelectedCharacter: async () => "sent",
    acceptReconnect: async () => "sent",
  };
  const controller = installAutomaticCharacterReturn({
    claimIntent: async () => true,
    input: () => input,
    record(name, ...fields) {
      records.push({ name, fields: fields[0] });
    },
    status: installLoginStatus(null),
  });

  try {
    await Promise.resolve();
    controller.savedCredentialsLoaded();
    for (let index = 0; index < 6; index += 1) await Promise.resolve();
    assert.notEqual(settleLogin, null);

    context.mock.timers.tick(30_000);
    await Promise.resolve();
    await Promise.resolve();

    assert.equal(records.at(-1)?.name, "relog.finished");
    assert.equal(records.some(({ name }) => name === "relog.inputSettled"), false);
  } finally {
    controller.dispose();
    context.mock.timers.reset();
    Object.defineProperty(globalThis, "document", {
      configurable: true,
      value: originalDocument,
    });
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: originalWindow,
    });
    globalThis.requestAnimationFrame = originalAnimationFrame;
  }
});

test("transient loading cannot skip character selection", async () => {
  const originalDocument = globalThis.document;
  const originalWindow = globalThis.window;
  const originalAnimationFrame = globalThis.requestAnimationFrame;
  const status = { hidden: true, textContent: "" };
  const loginStatus = installLoginStatus(status as unknown as HTMLElement);
  let screen: "loading" | "character" | "playable" = "loading";
  let characterSubmissions = 0;
  const records: Array<{ name: RendererMilestone; fields: unknown }> = [];
  const browserWindow = new EventTarget() as EventTarget & {
    gwPreGameControls: PreGameControls;
  };
  browserWindow.gwPreGameControls = {
    state: () => screen === "loading"
      ? "loading"
      : screen === "character"
        ? "character-select"
        : "unknown",
    switchContext: () => screen === "playable" ? "outpost" : "unavailable",
    diagnosticMask: () => 1,
  };
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: browserWindow,
  });
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: {
      visibilityState: "visible",
      hasFocus: () => true,
      getElementById: (id: string) => id === "login-status" ? status : null,
    },
  });
  globalThis.requestAnimationFrame = ((callback: FrameRequestCallback) => {
    queueMicrotask(() => callback(performance.now()));
    return 1;
  });

  const input: GameInputController = {
    releaseAll() {},
    traceState() {},
    cancelAutomaticEnter() {},
    setLoginProviderChooser() {},
    expectCharacterSelection() {},
    submitSavedLogin: async () => "progressed",
    playSelectedCharacter: async () => {
      characterSubmissions += 1;
      screen = "playable";
      return "sent";
    },
    acceptReconnect: async () => "sent",
  };
  const controller = installAutomaticCharacterReturn({
    claimIntent: async () => true,
    input: () => input,
    record(name, ...fields) {
      records.push({ name, fields: fields[0] });
    },
    status: loginStatus,
  });

  try {
    await Promise.resolve();
    controller.savedCredentialsLoaded();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    const request = new EventTarget() as XMLHttpRequest;
    Object.defineProperty(request, "status", { value: 200 });
    controller.tokenRequested(request);
    await Promise.resolve();
    request.dispatchEvent(new Event("loadend"));
    assert.equal(characterSubmissions, 0);
    screen = "character";
    for (let index = 0; index < 12; index += 1) await Promise.resolve();

    assert.equal(characterSubmissions, 1);
    assert.equal(
      records.filter(({ name }) => name === "relog.finished").length,
      1,
    );
    assert.deepEqual(records.find(({ name }) => name === "relog.finished"), {
      name: "relog.finished",
      fields: { outcome: "outpost" },
    });
  } finally {
    controller.dispose();
    Object.defineProperty(globalThis, "document", {
      configurable: true,
      value: originalDocument,
    });
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: originalWindow,
    });
    globalThis.requestAnimationFrame = originalAnimationFrame;
  }
});
