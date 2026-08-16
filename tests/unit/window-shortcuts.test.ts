import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { BrowserWindow } from "electron";
import {
  captureWindowShortcut,
  installWindowShortcuts,
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
    installWindowShortcuts(win, {
      run: (action) => actions.push(action),
      changed: () => undefined,
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
    assert.equal(dispatch(keyDown("KeyB", "b", {
      meta: false,
      control: true,
    })), false);

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
    assert.equal(dispatch(keyDown("KeyK", "k", { shift: true })), false);
  });
});
