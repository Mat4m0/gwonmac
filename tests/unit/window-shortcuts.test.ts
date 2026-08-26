import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { BrowserWindow } from "electron";
import { DEFAULT_SETTINGS } from "../../src/shared/contracts.js";
import {
  captureWindowShortcut,
  captureWindowSkillKey,
  captureWindowSkillKeyPointer,
  cancelWindowSkillKeyCapture,
  installWindowShortcuts,
  releaseWindowShortcutKey,
  updateWindowShortcuts,
} from "../../src/main/window-shortcuts.js";

type ShortcutInput = Pick<
  Electron.Input,
  "type" | "key" | "code" | "meta" | "control" | "shift" | "alt" | "isAutoRepeat"
>;

describe("window shortcut input", () => {
  it("runs one Command action, preserves Control, and contains capture repeats", async () => {
    let beforeInput: (
      event: { preventDefault(): void },
      input: ShortcutInput,
    ) => void = () => undefined;
    const win = {
      webContents: {
        on(name: string, listener: typeof beforeInput) {
          if (name === "before-input-event") beforeInput = listener;
        },
      },
      on() {
        return win;
      },
    } as unknown as BrowserWindow;
    const actions: string[] = [];
    const edits: string[] = [];
    let quitOrReload = 0;
    const commandQ: string[] = [];
    const settleQuitDialogs: Array<() => void> = [];
    installWindowShortcuts(win, {
      run: (action) => actions.push(action),
      edit: (command) => edits.push(command),
      quitOrReload: () => {
        quitOrReload += 1;
        return new Promise<void>((resolve) => settleQuitDialogs.push(resolve));
      },
      recordCommandQ: (phase, reason) => commandQ.push(`${phase}:${reason}`),
    });
    updateWindowShortcuts(win, { ...DEFAULT_SETTINGS, gwonmacTools: true });

    const dispatch = (input: ShortcutInput) => {
      let prevented = false;
      beforeInput({ preventDefault: () => { prevented = true; } }, input);
      return prevented;
    };
    const keyDown = (
      code: string,
      key: string,
      overrides: Partial<ShortcutInput> = {},
    ): ShortcutInput => ({
      type: "keyDown",
      code,
      key,
      meta: true,
      control: false,
      shift: false,
      alt: false,
      isAutoRepeat: false,
      ...overrides,
    });

    assert.equal(dispatch(keyDown("KeyB", "b")), true);
    for (let repeat = 0; repeat < 3; repeat += 1) {
      assert.equal(dispatch(keyDown("KeyB", "b", { isAutoRepeat: true })), true);
    }
    assert.deepEqual(actions, ["tools.toggle"]);
    // Releasing Command first must not leak the base key's repeats or key-up.
    assert.equal(dispatch({
      ...keyDown("MetaLeft", "Meta"), type: "keyUp", meta: false,
    }), false);
    assert.equal(dispatch(keyDown("KeyB", "b", {
      meta: false, isAutoRepeat: true,
    })), true);
    assert.equal(dispatch({
      ...keyDown("KeyB", "b"), type: "keyUp", meta: false,
    }), true);
    assert.equal(dispatch(keyDown("KeyB", "b", {
      meta: false,
      control: true,
    })), false);

    assert.equal(dispatch(keyDown("KeyX", "x")), true);
    assert.deepEqual(edits, ["cut"]);
    assert.equal(dispatch(keyDown("KeyX", "x", { isAutoRepeat: true })), true);
    assert.deepEqual(edits, ["cut"]);
    // The translated chord may reuse X, but only with Control and no Command.
    assert.equal(dispatch(keyDown("KeyX", "x", {
      meta: false, control: true,
    })), false);
    assert.equal(dispatch({
      ...keyDown("KeyX", "x", { meta: false, control: true }),
      type: "keyUp",
    }), false);
    assert.equal(dispatch({
      ...keyDown("KeyX", "x"), type: "keyUp", meta: false,
    }), true);
    assert.deepEqual(edits, ["cut"]);

    assert.equal(dispatch(keyDown("KeyA", "a")), true);
    assert.deepEqual(edits, ["cut", "selectAll"]);
    releaseWindowShortcutKey(win, "KeyA");
    assert.deepEqual(edits, ["cut", "selectAll"]);

    assert.equal(dispatch(keyDown("KeyQ", "q")), true);
    assert.equal(dispatch(keyDown("KeyQ", "q", { isAutoRepeat: true })), true);
    assert.equal(quitOrReload, 1);
    settleQuitDialogs.shift()?.();
    await Promise.resolve();
    assert.deepEqual(commandQ, [
      "claimed:none",
      "repeat-contained:none",
      "rearmed:dialog-settled",
    ]);
    // A native sheet consumes the first physical key-up. Settling Cancel must
    // still re-arm Q for the very next press.
    assert.equal(dispatch(keyDown("KeyQ", "q")), true);
    assert.equal(quitOrReload, 2);
    settleQuitDialogs.shift()?.();
    await Promise.resolve();
    assert.equal(commandQ.at(-1), "rearmed:dialog-settled");
    assert.equal(dispatch({
      ...keyDown("KeyQ", "q"), type: "keyUp", meta: false,
    }), false);

    const capture = captureWindowShortcut(win);
    assert.equal(dispatch(keyDown("KeyK", "k", { shift: true })), true);
    assert.deepEqual(await capture, {
      status: "captured",
      binding: { key: "k", shift: true, option: false },
    });
    assert.equal(dispatch(keyDown("KeyK", "k", {
      shift: true,
      isAutoRepeat: true,
    })), true);
    assert.deepEqual(actions, ["tools.toggle"]);
    dispatch({
      ...keyDown("MetaLeft", "Meta"),
      type: "keyUp",
      meta: false,
    });
    assert.equal(dispatch(keyDown("KeyK", "k", {
      meta: false,
      shift: true,
      isAutoRepeat: true,
    })), true);
    assert.equal(dispatch({
      ...keyDown("KeyK", "k", { shift: true }),
      type: "keyUp",
      meta: false,
    }), true);
    assert.equal(dispatch(keyDown("KeyK", "k", { shift: true })), false);

    const secondCapture = captureWindowShortcut(win);
    assert.equal(dispatch(keyDown("KeyW", "w")), true);
    assert.deepEqual(await secondCapture, {
      status: "captured",
      binding: { key: "w", shift: false, option: false },
    });
    // AppKit consumes this release, so the shortcut controller must receive
    // the same exact code through the native normalization route.
    releaseWindowShortcutKey(win, "KeyW");
    assert.equal(dispatch(keyDown("KeyW", "w", { isAutoRepeat: true })), false);

    const skillCapture = captureWindowSkillKey(win);
    assert.equal(dispatch(keyDown("ShiftLeft", "Shift", {
      meta: false, control: false, shift: true,
    })), true);
    assert.equal(dispatch(keyDown("F12", "F12", {
      meta: true, control: true, shift: true, alt: true,
    })), true);
    assert.deepEqual(await skillCapture, {
      status: "captured",
      binding: {
        input: { kind: "keyboard", code: "F12" },
        modifiers: { control: true, option: true, shift: true, command: true },
      },
    });
    assert.deepEqual(actions, ["tools.toggle"]);
    assert.equal(dispatch({
      ...keyDown("F12", "F12", {
        meta: false, control: false, shift: false, alt: false,
      }),
      type: "keyUp",
    }), true);
    assert.equal(dispatch({
      ...keyDown("ShiftLeft", "Shift", {
        meta: false, control: false, shift: false,
      }),
      type: "keyUp",
    }), true);

    const pointerCapture = captureWindowSkillKey(win);
    const pointerBinding = {
      input: { kind: "mouse-button" as const, button: 4 },
      modifiers: { control: false, option: true, shift: false, command: false },
    };
    assert.equal(captureWindowSkillKeyPointer(win, pointerBinding), true);
    assert.equal(captureWindowSkillKeyPointer(win, pointerBinding), false);
    assert.deepEqual(await pointerCapture, {
      status: "captured",
      binding: pointerBinding,
    });
    assert.equal(dispatch(keyDown("KeyQ", "q", {
      meta: false, control: false, shift: false, alt: false,
    })), false, "a later keyboard event cannot replace the pointer winner");

    const mouseRace = captureWindowSkillKey(win);
    assert.equal(dispatch(keyDown("AltLeft", "Alt", {
      meta: false, control: false, shift: false, alt: true,
    })), true);
    cancelWindowSkillKeyCapture(win);
    assert.deepEqual(await mouseRace, { status: "cancelled" });
    assert.equal(dispatch({
      ...keyDown("AltLeft", "Alt", {
        meta: false, control: false, shift: false, alt: false,
      }),
      type: "keyUp",
    }), true);

    updateWindowShortcuts(win, {
      ...DEFAULT_SETTINGS,
      gwonmacTools: true,
      buildLibrary: false,
    });
    assert.equal(dispatch(keyDown("KeyB", "b")), false);
    assert.deepEqual(actions, ["tools.toggle"]);
  });
});
