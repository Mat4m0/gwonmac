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
    value: Object.assign(events, {
      gwNative: {
        characterSwitchUsage: {
          get: async () => ({ formatVersion: 1, sequence: 0, entries: [] }),
          record: async ({ characterKey }: { characterKey: string }) => ({
            formatVersion: 1,
            sequence: 1,
            entries: [{ characterKey, successfulSwitches: 1, lastUsedSequence: 1 }],
          }),
        },
      },
    }),
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
      const recorded: string[] = [];
      window.gwNative.characterSwitchUsage.record = async ({ characterKey }) => {
        recorded.push(characterKey);
        return {
          formatVersion: 1,
          sequence: 1,
          entries: [{ characterKey, successfulSwitches: 1, lastUsedSequence: 1 }],
        };
      };
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
          playable: () => "outpost",
          diagnosticMask: () => 0,
        },
        buildId: 7,
        programId: 1,
      });

      controller.request(2, 1);
      await new Promise((resolve) => setTimeout(resolve, 1_000));
      assert.equal(controller.action.status, "complete");
      assert.deepEqual(calls, [1, 2, 3]);
      assert.deepEqual(recorded, ["0000000000000002"]);
      const diagnostics = JSON.stringify(controller.diagnostics());
      assert.equal(diagnostics.includes("Private Alpha"), false);
      assert.equal(diagnostics.includes("Private Beta"), false);
      assert.match(diagnostics, /"logout":1/);
      controller.dispose();
    });
  });

  it("refuses stale and current targets before a native action", async () => {
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
          playable: () => "outpost",
          diagnosticMask: () => 0,
        },
        buildId: 7,
        programId: 1,
      });
      controller.request(7, 1);
      assert.equal(controller.action.code, "stale-snapshot");
      controller.request(8, 0);
      assert.equal(controller.action.code, "current-target");
      assert.equal(calls, 0);
      assert.equal(controller.diagnostics().version, 6);
      assert.equal(stateReads, 0, "diagnostics must not trigger a frame scan");
      controller.dispose();
    });
  });

  it("keeps an immediate native logout refusal distinct from a timeout", async () => {
    await withBrowserGlobals(async () => {
      const memory = new WebAssembly.Memory({ initial: 1 });
      const pointer = 64;
      let usageRecords = 0;
      window.gwNative.characterSwitchUsage.record = async () => {
        usageRecords += 1;
        throw new Error("failed switches must not reach usage persistence");
      };
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
          playable: () => "outpost",
          diagnosticMask: () => 0,
        },
        buildId: 7,
        programId: 1,
      });
      controller.request(10, 1);
      await new Promise((resolve) => setTimeout(resolve, 40));
      assert.deepEqual(controller.action, {
        status: "failed",
        code: "logout-refused",
        retryable: false,
      });
      assert.equal(controller.diagnostics().lastCode, "logout-refused");
      assert.equal(controller.diagnostics().lastFrameProofMask, 0xff);
      assert.equal(usageRecords, 0);
      controller.reset();
      assert.deepEqual(controller.action, { status: "idle" });
      assert.equal(controller.diagnostics().lastCode, "logout-refused");
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
          playable: () => "outpost",
          diagnosticMask: () => 0,
        },
        buildId: 7,
        programId: 1,
      });

      controller.request(12, 1);
      await new Promise((resolve) => setTimeout(resolve, 180));
      assert.deepEqual(calls, [1, 2, 2]);
      assert.equal(controller.action.code, "selection-not-confirmed");
      assert.equal(controller.diagnostics().selectorReadinessRetries, 1);
      assert.equal(controller.diagnostics().lastSelectorReadiness, null);
      assert.equal(controller.diagnostics().selectorClickProved, false);
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
          playable: () => "outpost",
          diagnosticMask: () => 0,
        },
        buildId: 7,
        programId: 1,
      });

      controller.request(20, 1);
      await new Promise((resolve) => setTimeout(resolve, 60));
      assert.deepEqual(calls, [1, 2]);
      assert.equal(controller.action.code, "selection-not-confirmed");
      assert.equal(controller.diagnostics().selectorClickProved, true);
      controller.dispose();
    });
  });
});
