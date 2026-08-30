/** The automatic-return owner must not miss a fast character-select transition. */
import assert from "node:assert/strict";
import test from "node:test";
import { installAutomaticCharacterReturn } from "../../src/renderer/automatic-character-return.js";
import type { RendererMilestone } from "../../src/shared/diagnostics.js";

test("transient loading cannot skip character selection", async () => {
  const originalDocument = globalThis.document;
  const originalWindow = globalThis.window;
  const originalAnimationFrame = globalThis.requestAnimationFrame;
  const status = { hidden: true, textContent: "" };
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
