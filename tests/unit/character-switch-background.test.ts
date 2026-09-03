/** The accepted switch owns its native channel independently of window focus. */
import assert from "node:assert/strict";
import { setTimeout as delay } from "node:timers/promises";
import { describe, it, type TestContext } from "node:test";
import { createCharacterSwitchController } from "../../src/renderer/character-switch-controller.js";
import type { CharacterSummary, CompanionCharacterListState } from "../../src/renderer/companion-character-list-snapshot.js";
import { CHARACTER_SWITCH_ACTION_ABI as ABI } from "../../src/shared/character-switch-action-abi.js";

const characters = [
  { name: "Alpha", characterKey: "0000000000000001", primaryProfession: 1, secondaryProfession: 0, characterType: "roleplaying", campaign: 1, level: 20, mapId: 55 },
  { name: "Beta", characterKey: "0000000000000002", primaryProfession: 2, secondaryProfession: 0, characterType: "roleplaying", campaign: 1, level: 20, mapId: 55 },
] as const;

async function until(accept: () => boolean, timeout = 1_500): Promise<void> {
  const deadline = performance.now() + timeout;
  while (!accept() && performance.now() < deadline) await delay(10);
  assert.ok(accept(), "the expected transaction boundary was reached");
}

function fixture(t: TestContext, options: {
  refusedAction?: number;
  heldAction?: number;
  throwingAction?: number;
} = {}) {
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  const previousDocument = Object.getOwnPropertyDescriptor(globalThis, "document");
  let focused = true;
  const events = new EventTarget();
  const document = Object.assign(new EventTarget(), {
    visibilityState: "visible",
    hasFocus: () => focused,
  });
  Object.defineProperty(globalThis, "window", { configurable: true, value: events });
  Object.defineProperty(globalThis, "document", { configurable: true, value: document });
  const memory = new WebAssembly.Memory({ initial: 1 });
  const pointer = 64;
  let enabled = false;
  let pending: { kind: number; argument: number } | null = null;
  let selectedIndex = 0;
  let sequence = 2;
  let context: CharacterSwitchContext = "outpost";
  let records: readonly CharacterSummary[] = characters;
  const calls: number[] = [];
  const drained: number[] = [];
  const list = (): CompanionCharacterListState => ({
    status: "ready", sequence, selectedIndex, characters: records,
  });
  const drain = () => {
    if (!enabled || pending === null) return;
    const { kind, argument } = pending;
    pending = null;
    drained.push(kind);
    if (kind === ABI.action.logout) { context = "character-select"; sequence += 2; }
    if (kind === ABI.action.select) selectedIndex = argument;
    if (kind === ABI.action.play) context = "outpost";
    new DataView(memory.buffer).setUint32(pointer + ABI.fields.result, ABI.result.sent, true);
  };
  const controller = createCharacterSwitchController({
    memory, payloadPointer: pointer, buildId: 7, programId: 1,
    configure(payload, policy) {
      enabled = payload === pointer && policy === 1;
      // Match native configure: disabling clears a queued action.
      if (!enabled) pending = null;
      return 1;
    },
    enqueue(kind, argument) {
      assert.ok(enabled, "the channel must be owned before enqueue");
      if (kind === options.throwingAction) throw new Error("native action unavailable");
      calls.push(kind);
      if (kind === options.refusedAction) return 0;
      assert.equal(pending, null, "only one native action may be pending");
      pending = { kind, argument };
      if (kind !== options.heldAction) setImmediate(drain);
      return 1;
    },
    characters: { get state() { return list(); }, subscribe: () => () => false, dispose() {} },
    controls: { state: () => "unknown", switchContext: () => context, diagnosticMask: () => 0 },
  });
  t.after(() => {
    controller.dispose();
    if (previousWindow) Object.defineProperty(globalThis, "window", previousWindow);
    else Reflect.deleteProperty(globalThis, "window");
    if (previousDocument) Object.defineProperty(globalThis, "document", previousDocument);
    else Reflect.deleteProperty(globalThis, "document");
  });
  return {
    controller, calls, drained, drain,
    enabled: () => enabled,
    pending: () => pending,
    setContext(next: CharacterSwitchContext) { context = next; },
    changeAccount() { records = characters.map(character => ({ ...character, characterKey: `1${character.characterKey.slice(1)}` })); },
    blur(hidden = false) {
      focused = false;
      events.dispatchEvent(new Event("blur"));
      if (hidden) {
        document.visibilityState = "hidden";
        document.dispatchEvent(new Event("visibilitychange"));
      }
    },
    focus() {
      document.visibilityState = "visible";
      focused = true;
      events.dispatchEvent(new Event("focus"));
      document.dispatchEvent(new Event("visibilitychange"));
    },
  };
}

describe("background character switch", { concurrency: false }, () => {
  for (const boundary of ["immediate", "selector", "selection", "confirmation"] as const) {
    for (const hidden of [false, true]) {
      it(`finishes after ${hidden ? "hiding" : "blur"} at ${boundary}`, async (t) => {
        const f = fixture(t);
        assert.equal(f.enabled(), false, "idle focus must not enable native actions");
        f.controller.subscribe(() => {
          const action = f.controller.action;
          if (action.status === "switching" && action.stage === boundary) f.blur(hidden);
          if (action.status === "complete") assert.equal(f.enabled(), false);
        });
        f.controller.request(characters[1].characterKey);
        if (boundary === "immediate") f.blur(hidden);
        assert.equal(f.enabled(), true);
        const diagnostics = f.controller.diagnostics();
        if (diagnostics.version !== 7) throw new Error("expected live diagnostics");
        assert.equal(diagnostics.policyEnabled, true);
        if (boundary === "immediate") assert.equal(diagnostics.focused, false);
        f.controller.request(characters[1].characterKey);
        f.controller.reset();
        await until(() => f.controller.action.status === "complete");
        assert.deepEqual(f.calls, [1, 2, 3]);
        assert.deepEqual(f.drained, [1, 2, 3]);
        assert.equal(f.enabled(), false);
        assert.equal(f.pending(), null);
        f.focus();
        assert.equal(f.enabled(), false, "regaining focus does not rearm a finished switch");
      });
    }
  }

  it("requires focus both for a new request and for explorable confirmation", (t) => {
    const f = fixture(t);
    f.blur();
    f.controller.request(characters[1].characterKey);
    assert.deepEqual(f.controller.action, { status: "failed", code: "focus-lost", retryable: true });
    f.focus();
    f.setContext("pve-explorable");
    f.controller.request(characters[1].characterKey);
    assert.equal(f.controller.action.status, "confirming");
    assert.equal(f.enabled(), false);
    f.blur(true);
    f.controller.confirm();
    assert.deepEqual(f.controller.action, { status: "failed", code: "focus-lost", retryable: true });
    assert.deepEqual(f.calls, []);
    assert.equal(f.enabled(), false);
  });

  for (const kind of [ABI.action.logout, ABI.action.select, ABI.action.play]) {
    it(`disposal clears pending action ${kind} and prevents later actions`, async (t) => {
      const f = fixture(t, { heldAction: kind });
      f.controller.request(characters[1].characterKey);
      await until(() => f.calls.includes(kind));
      f.blur(true);
      f.controller.dispose();
      const calls = [...f.calls];
      f.drain();
      f.focus();
      f.controller.request(characters[0].characterKey);
      await delay(100);
      assert.equal(f.enabled(), false);
      assert.equal(f.pending(), null);
      assert.deepEqual(f.calls, calls);
      assert.equal(f.drained.includes(kind), false);
    });

    it(`native refusal at action ${kind} releases the channel before failure publication`, async (t) => {
      const f = fixture(t, { refusedAction: kind });
      f.controller.subscribe(() => {
        if (f.controller.action.status === "failed") assert.equal(f.enabled(), false);
      });
      f.controller.request(characters[1].characterKey);
      f.blur();
      await until(() => f.controller.action.status === "failed");
      assert.deepEqual(f.calls, [1, 2, 3].slice(0, kind));
      assert.equal(f.enabled(), false);
      assert.equal(f.pending(), null);
    });
  }

  it("times out in the background and clears an undrained logout", async (t) => {
    const f = fixture(t, { heldAction: ABI.action.logout });
    f.controller.request(characters[1].characterKey);
    f.blur(true);
    await until(() => f.controller.action.status === "failed", 3_000);
    assert.deepEqual(f.controller.action, { status: "failed", code: "logout-timeout", retryable: false });
    assert.equal(f.enabled(), false);
    f.drain();
    assert.deepEqual(f.drained, []);
  });

  it("still refuses a changed account after background logout", async (t) => {
    const f = fixture(t);
    f.controller.subscribe(() => {
      const action = f.controller.action;
      if (action.status === "switching" && action.stage === "selector") {
        f.changeAccount();
        f.blur();
      }
    });
    f.controller.request(characters[1].characterKey);
    await until(() => f.controller.action.status === "failed");
    assert.deepEqual(f.controller.action, { status: "failed", code: "target-missing", retryable: false });
    assert.deepEqual(f.calls, [1]);
    assert.equal(f.enabled(), false);
  });

  for (const kind of [ABI.action.logout, ABI.action.select]) {
    it(`releases the channel if native action ${kind} throws`, async (t) => {
      const f = fixture(t, { throwingAction: kind });
      f.controller.request(characters[1].characterKey);
      await until(() => f.controller.action.status === "failed");
      assert.equal(f.enabled(), false);
      assert.equal(f.pending(), null);
    });
  }

  it("terminal cleanup cannot disable a new switch started by a subscriber", async (t) => {
    const f = fixture(t);
    let completed = 0;
    f.controller.subscribe(() => {
      if (f.controller.action.status !== "complete") return;
      assert.equal(f.enabled(), false);
      if (++completed === 1) f.controller.request(characters[0].characterKey);
    });
    f.controller.request(characters[1].characterKey);
    await until(() => completed === 2);
    assert.deepEqual(f.calls, [1, 2, 3, 1, 2, 3]);
    assert.equal(f.enabled(), false);
  });
});
