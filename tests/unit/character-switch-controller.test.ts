import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createCharacterSwitchController } from "../../src/renderer/character-switch-controller.js";
import type { CompanionCharacterListState } from "../../src/renderer/companion-character-list-snapshot.js";

const ready = (sequence: number, selectedIndex: number): CompanionCharacterListState =>
  Object.freeze({
    status: "ready",
    sequence,
    selectedIndex,
    characters: Object.freeze([
      Object.freeze({ name: "Private Alpha", characterKey: "0000000000000001", primaryProfession: 1, secondaryProfession: 0, characterType: "roleplaying", campaign: 1, level: 20, mapId: 55 }),
      Object.freeze({ name: "Private Beta", characterKey: "0000000000000002", primaryProfession: 2, secondaryProfession: 3, characterType: "roleplaying", campaign: 2, level: 20, mapId: 55 }),
    ]),
  });

function withBrowserGlobals(run: () => Promise<void>): Promise<void> {
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  const previousDocument = Object.getOwnPropertyDescriptor(globalThis, "document");
  const events = new EventTarget();
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: events,
  });
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: Object.assign(new EventTarget(), {
      visibilityState: "visible",
      hasFocus: () => true,
    }),
  });
  return run().finally(() => {
    if (previousWindow) Object.defineProperty(globalThis, "window", previousWindow);
    else Reflect.deleteProperty(globalThis, "window");
    if (previousDocument) Object.defineProperty(globalThis, "document", previousDocument);
    else Reflect.deleteProperty(globalThis, "document");
  });
}

describe("character switch controller", { concurrency: false }, () => {
  it("sends each consequential action once and confirms only the final identity", async () => {
    await withBrowserGlobals(async () => {
      const memory = new WebAssembly.Memory({ initial: 1 });
      const pointer = 64;
      const calls: number[] = [];
      let list = ready(2, 0);
      let preGame: PreGameState = "unknown";
      const source = {
        get state() { return list; },
        subscribe() { return () => false; },
        dispose() {},
      } satisfies CharacterListSource;
      const controller = createCharacterSwitchController({
        memory,
        payloadPointer: pointer,
        configure: () => 1,
        enqueue(action) {
          calls.push(action);
          new DataView(memory.buffer).setUint32(pointer + 20, 1, true);
          if (action === 1) { preGame = "character-select"; list = ready(4, 0); }
          if (action === 2) list = ready(6, 1);
          return 1;
        },
        characters: source,
        controls: {
          state: () => preGame,
          switchContext: () => "outpost",
          diagnosticMask: () => 0,
        },
        buildId: 7,
        programId: 1,
      });

      controller.request("0000000000000002");
      await new Promise((resolve) => setTimeout(resolve, 1_000));
      assert.equal(controller.action.status, "complete");
      assert.deepEqual(calls, [1, 2, 3]);
      const diagnostics = JSON.stringify(controller.diagnostics());
      assert.equal(diagnostics.includes("Private Alpha"), false);
      assert.equal(diagnostics.includes("Private Beta"), false);
      assert.match(diagnostics, /"logout":1/);
      controller.dispose();
    });
  });

  it("resolves stable keys and refuses missing or current targets before a native action", async () => {
    await withBrowserGlobals(async () => {
      const memory = new WebAssembly.Memory({ initial: 1 });
      let calls = 0;
      let stateReads = 0;
      const source = {
        state: ready(8, 0),
        subscribe() { return () => false; },
        dispose() {},
      } satisfies CharacterListSource;
      const controller = createCharacterSwitchController({
        memory,
        payloadPointer: 64,
        configure: () => 1,
        enqueue: () => { calls += 1; return 1; },
        characters: source,
        controls: {
          state: () => { stateReads += 1; return "unknown"; },
          switchContext: () => "outpost",
          diagnosticMask: () => 0,
        },
        buildId: 7,
        programId: 1,
      });
      controller.request("00000000000000ff");
      assert.deepEqual(controller.action, { status: "failed", code: "target-missing", retryable: true });
      controller.reset();
      controller.request("0000000000000001");
      assert.deepEqual(controller.action, { status: "failed", code: "current-target", retryable: false });
      assert.equal(calls, 0);
      assert.equal(controller.diagnostics().version, 7);
      assert.equal(stateReads, 0, "diagnostics must not trigger a frame scan");
      controller.dispose();
    });
  });

  it("keeps an immediate native logout refusal distinct from a timeout", async () => {
    await withBrowserGlobals(async () => {
      const memory = new WebAssembly.Memory({ initial: 1 });
      const pointer = 64;
      const source = {
        state: ready(10, 0),
        subscribe() { return () => false; },
        dispose() {},
      } satisfies CharacterListSource;
      const controller = createCharacterSwitchController({
        memory,
        payloadPointer: pointer,
        configure: () => 1,
        enqueue: () => {
          new DataView(memory.buffer).setUint32(pointer + 20, 2, true);
          new DataView(memory.buffer).setUint32(pointer + 36, 0xff, true);
          return 1;
        },
        characters: source,
        controls: {
          state: () => "unknown",
          switchContext: () => "outpost",
          diagnosticMask: () => 0,
        },
        buildId: 7,
        programId: 1,
      });
      controller.request("0000000000000002");
      await new Promise((resolve) => setTimeout(resolve, 40));
      assert.deepEqual(controller.action, {
        status: "failed",
        code: "logout-refused",
        retryable: false,
      });
      const diagnostics = controller.diagnostics();
      assert.equal(diagnostics.version, 7);
      if (diagnostics.version !== 7) throw new Error("expected live diagnostics");
      assert.equal(diagnostics.lastCode, "logout-refused");
      assert.equal(diagnostics.lastFrameProofMask, 0xff);
      controller.reset();
      assert.deepEqual(controller.action, { status: "idle" });
      const resetDiagnostics = controller.diagnostics();
      assert.equal(resetDiagnostics.version, 7);
      if (resetDiagnostics.version !== 7) throw new Error("expected live diagnostics");
      assert.equal(resetDiagnostics.lastCode, "logout-refused");
      controller.dispose();
    });
  });

  it("reports queue refusal synchronously so the palette can stay open", async () => {
    await withBrowserGlobals(async () => {
      const memory = new WebAssembly.Memory({ initial: 1 });
      const controller = createCharacterSwitchController({
        memory,
        payloadPointer: 64,
        configure: () => 1,
        enqueue: () => 0,
        characters: {
          state: ready(11, 0),
          subscribe() { return () => false; },
          dispose() {},
        },
        controls: {
          state: () => "unknown",
          switchContext: () => "outpost",
          diagnosticMask: () => 0,
        },
        buildId: 7,
        programId: 1,
      });

      controller.request("0000000000000002");
      assert.deepEqual(controller.action, {
        status: "failed",
        code: "logout-refused",
        retryable: false,
      });
      controller.dispose();
    });
  });

  it("waits through proved pre-click Selector readiness without retrying later ambiguity", async () => {
    await withBrowserGlobals(async () => {
      const memory = new WebAssembly.Memory({ initial: 1 });
      const pointer = 64;
      let list = ready(12, 0);
      let selectAttempt = 0;
      const calls: number[] = [];
      const source = {
        get state() { return list; },
        subscribe() { return () => false; },
        dispose() {},
      } satisfies CharacterListSource;
      const controller = createCharacterSwitchController({
        memory,
        payloadPointer: pointer,
        configure: () => 1,
        enqueue(action) {
          calls.push(action);
          const packet = new DataView(memory.buffer);
          if (action === 1) {
            list = ready(13, 0);
            packet.setUint32(pointer + 20, 1, true);
          } else if (action === 2) {
            selectAttempt += 1;
            packet.setUint32(pointer + 20, selectAttempt === 1 ? 5 : 7, true);
          }
          return 1;
        },
        characters: source,
        controls: {
          state: () => "character-select",
          switchContext: () => "outpost",
          diagnosticMask: () => 0,
        },
        buildId: 7,
        programId: 1,
      });

      controller.request("0000000000000002");
      await new Promise((resolve) => setTimeout(resolve, 180));
      assert.deepEqual(calls, [1, 2, 2]);
      assert.deepEqual(controller.action, { status: "failed", code: "selection-not-confirmed", retryable: false });
      const diagnostics = controller.diagnostics();
      if (diagnostics.version !== 7) throw new Error("expected live diagnostics");
      assert.equal(diagnostics.selectorReadinessRetries, 1);
      assert.equal(diagnostics.lastSelectorReadiness, null);
      assert.equal(diagnostics.selectorClickProved, false);
      controller.dispose();
    });
  });

  it("never retries a readiness code after the proof says a click was sent", async () => {
    await withBrowserGlobals(async () => {
      const memory = new WebAssembly.Memory({ initial: 1 });
      const pointer = 64;
      let list = ready(20, 0);
      const calls: number[] = [];
      const source = {
        get state() { return list; },
        subscribe() { return () => false; },
        dispose() {},
      } satisfies CharacterListSource;
      const controller = createCharacterSwitchController({
        memory,
        payloadPointer: pointer,
        configure: () => 1,
        enqueue(action) {
          calls.push(action);
          const packet = new DataView(memory.buffer);
          if (action === 1) {
            list = ready(21, 0);
            packet.setUint32(pointer + 20, 1, true);
          } else {
            packet.setUint32(pointer + 36, 1 << 10, true);
            packet.setUint32(pointer + 20, 4, true);
          }
          return 1;
        },
        characters: source,
        controls: {
          state: () => "character-select",
          switchContext: () => "outpost",
          diagnosticMask: () => 0,
        },
        buildId: 7,
        programId: 1,
      });

      controller.request("0000000000000002");
      await new Promise((resolve) => setTimeout(resolve, 60));
      assert.deepEqual(calls, [1, 2]);
      assert.deepEqual(controller.action, { status: "failed", code: "selection-not-confirmed", retryable: false });
      const diagnostics = controller.diagnostics();
      if (diagnostics.version !== 7) throw new Error("expected live diagnostics");
      assert.equal(diagnostics.selectorClickProved, true);
      controller.dispose();
    });
  });

  it("requires PvE confirmation and rechecks context before native logout", async () => {
    await withBrowserGlobals(async () => {
      const create = (contexts: CharacterSwitchContext[]) => {
        const memory = new WebAssembly.Memory({ initial: 1 });
        const pointer = 64;
        let calls = 0;
        let reads = 0;
        const controller = createCharacterSwitchController({
          memory,
          payloadPointer: pointer,
          configure: () => 1,
          enqueue: () => {
            calls += 1;
            new DataView(memory.buffer).setUint32(pointer + 20, 2, true);
            return 1;
          },
          characters: {
            state: ready(30, 0),
            subscribe() { return () => false; },
            dispose() {},
          },
          controls: {
            state: () => "unknown",
            switchContext: () => contexts[Math.min(reads++, contexts.length - 1)]!,
            diagnosticMask: () => 0,
          },
          buildId: 7,
          programId: 1,
        });
        return { controller, calls: () => calls };
      };

      const unconfirmed = create(["pve-explorable"]);
      unconfirmed.controller.request("0000000000000002");
      assert.deepEqual(unconfirmed.controller.action, { status: "confirming" });
      assert.equal(unconfirmed.calls(), 0);
      unconfirmed.controller.cancelConfirmation();
      assert.deepEqual(unconfirmed.controller.action, { status: "idle" });
      unconfirmed.controller.dispose();

      const confirmed = create(["pve-explorable"]);
      confirmed.controller.request("0000000000000002");
      confirmed.controller.confirm();
      await new Promise((resolve) => setTimeout(resolve, 30));
      assert.equal(confirmed.calls(), 1);
      assert.deepEqual(confirmed.controller.action, { status: "failed", code: "logout-refused", retryable: false });
      confirmed.controller.dispose();

      const raced = create(["pve-explorable", "pvp-explorable"]);
      raced.controller.request("0000000000000002");
      raced.controller.confirm();
      assert.deepEqual(raced.controller.action, { status: "failed", code: "active-pvp", retryable: false });
      assert.equal(raced.calls(), 0);
      raced.controller.dispose();
    });
  });

  it("blocks PvP and loading before any native action", async () => {
    await withBrowserGlobals(async () => {
      for (const [context, code] of [
        ["pvp-explorable", "active-pvp"],
        ["loading", "game-loading"],
      ] as const) {
        const memory = new WebAssembly.Memory({ initial: 1 });
        let calls = 0;
        const controller = createCharacterSwitchController({
          memory,
          payloadPointer: 64,
          configure: () => 1,
          enqueue: () => { calls += 1; return 1; },
          characters: {
            state: ready(40, 0),
            subscribe() { return () => false; },
            dispose() {},
          },
          controls: {
            state: () => "unknown",
            switchContext: () => context,
            diagnosticMask: () => 0,
          },
          buildId: 7,
          programId: 1,
        });
        controller.request("0000000000000002");
        assert.deepEqual(controller.action, {
          status: "failed",
          code,
          retryable: context === "loading",
        });
        assert.equal(calls, 0);
        controller.dispose();
      }
    });
  });
});
