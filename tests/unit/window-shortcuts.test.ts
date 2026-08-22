import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { BrowserWindow } from "electron";
import {
  captureWindowShortcut,
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
    installWindowShortcuts(win, {
      run: (action) => actions.push(action),
      edit: (command) => edits.push(command),
    });
    updateWindowShortcuts(win, {});

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
    assert.deepEqual(edits, []);
    assert.equal(dispatch(keyDown("KeyX", "x", { isAutoRepeat: true })), true);
    assert.deepEqual(edits, []);
    assert.equal(dispatch({
      ...keyDown("KeyX", "x"), type: "keyUp", meta: false,
    }), true);
    assert.deepEqual(edits, ["cut"]);

    assert.equal(dispatch(keyDown("KeyA", "a")), true);
    releaseWindowShortcutKey(win, "KeyA");
    assert.deepEqual(edits, ["cut", "selectAll"]);

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
  });
});
