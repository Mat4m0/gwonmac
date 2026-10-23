/**
 * A key-up the game never received leaves Control or Shift down for it, so the
 * next typed A selects all and a drag offers a split stack. The renderer can
 * tell from a trusted event's own flags; these tests pin when a held modifier
 * counts as stale and that its release reaches the original press target.
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  HeldKeys,
  modifierOfCode,
  staleModifiers,
  type HeldKey,
} from "../../src/renderer/held-keys.ts";

const flags = (ctrlKey: boolean, shiftKey: boolean, altKey: boolean) => ({ ctrlKey, shiftKey, altKey });

test("a held modifier is stale only when the event's own flag for it is false", () => {
  const table: [string, string[], ReturnType<typeof flags>, string[]][] = [
    ["Control held, no flag: stale", ["ControlLeft"], flags(false, false, false), ["ControlLeft"]],
    ["Control held, flag true: real", ["ControlLeft"], flags(true, false, false), []],
    ["right Control is the same modifier", ["ControlRight"], flags(false, true, false), ["ControlRight"]],
    ["Shift held, no flag: stale", ["ShiftLeft"], flags(true, false, false), ["ShiftLeft"]],
    ["Alt held, no flag: stale", ["AltRight"], flags(false, false, false), ["AltRight"]],
    ["only the denied modifier is stale", ["ControlLeft", "ShiftLeft"], flags(true, false, false), ["ShiftLeft"]],
    ["every flag true: nothing is stale", ["ControlLeft", "ShiftLeft", "AltLeft"], flags(true, true, true), []],
    ["no modifier held: nothing to release", [], flags(false, false, false), []],
    ["ordinary held keys are never modifiers", ["KeyW", "ArrowUp", "MetaLeft"], flags(false, false, false), []],
  ];
  for (const [name, held, eventFlags, expected] of table) {
    assert.deepEqual(staleModifiers(held, eventFlags).map(({ code }) => code), expected, name);
  }
});

test("a stale modifier is reported by the name the trace records", () => {
  assert.deepEqual(staleModifiers(["ControlRight", "ShiftLeft", "AltLeft"], flags(false, false, false)), [
    { code: "ControlRight", modifier: "ctrl" },
    { code: "ShiftLeft", modifier: "shift" },
    { code: "AltLeft", modifier: "alt" },
  ]);
  assert.equal(modifierOfCode("MetaLeft"), undefined, "Guild Wars has no Command modifier");
  assert.equal(modifierOfCode("KeyA"), undefined);
});

test("the ledger releases a stale modifier at its press target and forgets it", () => {
  class FakeKeyboardEvent {
    type: string;
    init: { code: string; key: string };
    constructor(type: string, init: { code: string; key: string }) {
      this.type = type;
      this.init = init;
    }
  }
  const original = (globalThis as { KeyboardEvent?: unknown }).KeyboardEvent;
  (globalThis as { KeyboardEvent?: unknown }).KeyboardEvent = FakeKeyboardEvent;
  try {
    const seen: { type: string; code: string }[] = [];
    const target = {
      dispatchEvent: (event: FakeKeyboardEvent) => seen.push({ type: event.type, code: event.init.code }),
    } as unknown as EventTarget;
    const held = (code: string, key: string): HeldKey => ({
      target, key, code, location: 1, charCode: 0, keyCode: 0, which: 0,
      ctrlKey: false, shiftKey: false, altKey: false, metaKey: false,
    });
    const ledger = new HeldKeys(undefined, () => "canvas");
    ledger.hold(held("ControlLeft", "Control"));
    ledger.hold(held("KeyW", "w"));

    const [stale] = ledger.staleModifiers(flags(false, false, false));
    assert.equal(stale?.code, "ControlLeft");
    ledger.releaseNormalized(stale!.code);

    assert.deepEqual(seen, [{ type: "keyup", code: "ControlLeft" }], "the game gets the missing key-up");
    assert.equal(ledger.get("ControlLeft"), undefined);
    assert.ok(ledger.get("KeyW"), "other held keys stay held");
    assert.deepEqual(ledger.staleModifiers(flags(false, false, false)), [], "healed once");
  } finally {
    (globalThis as { KeyboardEvent?: unknown }).KeyboardEvent = original;
  }
});
