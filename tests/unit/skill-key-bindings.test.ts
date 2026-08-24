/** The display-only binding vocabulary stays exact across settings and HUD. */
import assert from "node:assert/strict";
import test from "node:test";
import {
  EMPTY_SKILL_KEY_BINDINGS,
  isSkillKeyBindings,
  skillKeyPresentation,
  withSkillKeyBinding,
} from "../../src/shared/skill-key-bindings.js";

const modifiers = {
  control: true,
  option: true,
  shift: true,
  command: true,
};

test("formats modifiers in one fixed order before the main key", () => {
  assert.deepEqual(skillKeyPresentation({
    input: { kind: "keyboard", code: "F12" },
    modifiers,
  }), {
    modifiers: ["⌃", "⌥", "⇧", "⌘"],
    main: { kind: "text", label: "F12" },
    accessibleLabel: "Control + Option + Shift + Command + F12",
  });
});

test("formats mouse buttons and wheel directions without stored labels", () => {
  assert.deepEqual(skillKeyPresentation({
    input: { kind: "mouse-button", button: 0 },
    modifiers: { ...modifiers, control: false, option: false, command: false },
  }).main, { kind: "mouse", button: "left", label: "Left click" });
  assert.deepEqual(skillKeyPresentation({
    input: { kind: "mouse-button", button: 4 },
    modifiers,
  }).main, { kind: "text", label: "M5" });
  assert.deepEqual(skillKeyPresentation({
    input: { kind: "wheel", direction: "down" },
    modifiers,
  }).main, { kind: "wheel", direction: "down", label: "Wheel down" });
});

test("requires exactly eight closed, bounded bindings", () => {
  assert.equal(isSkillKeyBindings(EMPTY_SKILL_KEY_BINDINGS), true);
  const good = withSkillKeyBinding(EMPTY_SKILL_KEY_BINDINGS, 7, {
    input: { kind: "keyboard", code: "KeyC" },
    modifiers,
  });
  assert.equal(isSkillKeyBindings(good), true);
  for (const invalid of [
    good.slice(0, 7),
    [...good, null],
    [{ input: { kind: "keyboard", code: "Unknown" }, modifiers }, ...good.slice(1)],
    [{ input: { kind: "mouse-button", button: 16 }, modifiers }, ...good.slice(1)],
    [{ input: { kind: "wheel", direction: "left" }, modifiers }, ...good.slice(1)],
    [{ input: { kind: "keyboard", code: "KeyC", label: "C" }, modifiers }, ...good.slice(1)],
  ]) assert.equal(isSkillKeyBindings(invalid), false);
});
