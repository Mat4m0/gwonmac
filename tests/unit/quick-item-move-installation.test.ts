import assert from "node:assert/strict";
import test from "node:test";
import {
  installQuickItemMove,
  quickItemMoveExports,
} from "../../src/renderer/quick-item-move-installation.js";

function keyboard(type: "keydown" | "keyup", ctrlKey: boolean, shiftKey: boolean): Event {
  return Object.assign(new Event(type), { ctrlKey, shiftKey });
}

test("Quick Item Move publishes Control and Shift and clears them on blur", () => {
  const target = new EventTarget();
  const configurations: number[][] = [];
  const modifiers: number[] = [];
  const installation = installQuickItemMove({
    configure: (enabled, pointer) => (configurations.push([enabled, pointer]), 1),
    setModifiers: (value) => (modifiers.push(value), 1),
    scratchPointer: 64,
    target,
  });

  assert.deepEqual(configurations, [[0, 64]]);
  assert.deepEqual(modifiers, [0]);
  installation.update(true);
  target.dispatchEvent(keyboard("keydown", true, false));
  target.dispatchEvent(keyboard("keydown", true, true));
  target.dispatchEvent(new Event("blur"));
  installation.update(false);

  assert.deepEqual(configurations, [[0, 64], [1, 64], [0, 64]]);
  assert.deepEqual(modifiers, [0, 1, 3, 0]);
  installation.dispose();
  assert.deepEqual(configurations.at(-1), [0, 64]);
  assert.equal(modifiers.at(-1), 0);
});

test("Quick Item Move refuses an incomplete transformed export pair", () => {
  assert.equal(quickItemMoveExports({}), null);
  assert.equal(quickItemMoveExports({
    enhancement_configure_quick_item_move: () => 1,
  }), null);
  assert.ok(quickItemMoveExports({
    enhancement_configure_quick_item_move: () => 1,
    enhancement_quick_item_move_modifiers: () => 1,
  }));
});

test("Quick Item Move does not leak listeners when initialization fails", () => {
  const target = new EventTarget();
  let modifierCalls = 0;
  assert.throws(() => installQuickItemMove({
    configure: () => { throw new Error("initialization failed"); },
    setModifiers: () => (modifierCalls += 1),
    scratchPointer: 64,
    target,
  }), /initialization failed/);

  target.dispatchEvent(keyboard("keydown", true, false));
  assert.equal(modifierCalls, 0);

  const configurations: number[] = [];
  assert.throws(() => installQuickItemMove({
    configure: (enabled) => (configurations.push(enabled), 1),
    setModifiers: () => { throw new Error("modifier initialization failed"); },
    scratchPointer: 64,
    target,
  }), /modifier initialization failed/);
  target.dispatchEvent(keyboard("keydown", true, false));
  assert.deepEqual(configurations, [0]);
});

test("Quick Item Move disposal is final and idempotent", () => {
  const target = new EventTarget();
  const configurations: number[] = [];
  const installation = installQuickItemMove({
    configure: (enabled) => (configurations.push(enabled), 1),
    setModifiers: () => 1,
    scratchPointer: 64,
    target,
  });

  installation.dispose();
  installation.dispose();
  installation.update(true);
  assert.deepEqual(configurations, [0, 0]);
});
