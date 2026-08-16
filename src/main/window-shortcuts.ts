/**
 * Window-scoped shortcut interception and recording before Guild Wars sees a key.
 * Settings stay durable elsewhere; this controller owns only the live input state.
 */
import type { BrowserWindow } from "electron";
import {
  resolveShortcuts,
  shortcutFromInput,
  shortcutMatches,
  type ShortcutAction,
  type ShortcutCaptureResult,
  type ShortcutOverrides,
} from "../shared/keyboard-shortcuts.js";

interface ShortcutActions {
  run(action: ShortcutAction): void;
  changed(
    shortcuts: ReturnType<typeof resolveShortcuts>,
  ): void;
}

class WindowShortcuts {
  readonly #actions: ShortcutActions;
  #shortcuts = resolveShortcuts({});
  #capture: ((result: ShortcutCaptureResult) => void) | null = null;
  #capturedCode: string | null = null;

  constructor(win: BrowserWindow, actions: ShortcutActions) {
    this.#actions = actions;
    win.webContents.on("before-input-event", (event, input) => {
      if (input.type === "keyUp") {
        if (input.key === "Meta" || input.code === this.#capturedCode) {
          this.#capturedCode = null;
        }
        return;
      }
      if (input.type !== "keyDown") return;
      if (input.code === this.#capturedCode) {
        event.preventDefault();
        return;
      }
      if (this.#capture) {
        if (["Meta", "Control", "Shift", "Alt"].includes(input.key)) return;
        if (input.key === "Tab") return;
        event.preventDefault();
        this.#capturedCode = input.code;
        if (input.key === "Escape") {
          this.#finish({ status: "cancelled" });
          return;
        }
        if (input.key === "Backspace" || input.key === "Delete") {
          this.#finish({ status: "cleared" });
          return;
        }
        const binding = shortcutFromInput(input);
        this.#finish(binding
          ? { status: "captured", binding }
          : { status: "invalid" });
        return;
      }
      for (const [action, binding] of Object.entries(this.#shortcuts)) {
        if (binding && shortcutMatches(binding, input)) {
          event.preventDefault();
          if (!input.isAutoRepeat) {
            this.#actions.run(action as ShortcutAction);
          }
          return;
        }
      }
    });
    win.on("blur", () => this.cancelCapture());
    win.on("closed", () => this.cancelCapture());
  }

  update(overrides: ShortcutOverrides): void {
    this.#shortcuts = resolveShortcuts(overrides);
    this.#actions.changed(this.#shortcuts);
  }

  capture(): Promise<ShortcutCaptureResult> {
    this.cancelCapture();
    this.#capturedCode = null;
    return new Promise((resolve) => {
      this.#capture = resolve;
    });
  }

  cancelCapture(): void {
    this.#capturedCode = null;
    this.#finish({ status: "cancelled" });
  }

  #finish(result: ShortcutCaptureResult): void {
    const resolve = this.#capture;
    if (!resolve) return;
    this.#capture = null;
    resolve(result);
  }
}

const controllers = new WeakMap<BrowserWindow, WindowShortcuts>();

export function installWindowShortcuts(
  win: BrowserWindow,
  actions: ShortcutActions,
): void {
  controllers.set(win, new WindowShortcuts(win, actions));
}

export function updateWindowShortcuts(
  win: BrowserWindow,
  overrides: ShortcutOverrides,
): void {
  controllers.get(win)?.update(overrides);
}

export function captureWindowShortcut(
  win: BrowserWindow,
): Promise<ShortcutCaptureResult> {
  const controller = controllers.get(win);
  return controller
    ? controller.capture()
    : Promise.resolve({ status: "cancelled" });
}

export function cancelWindowShortcutCapture(win: BrowserWindow): void {
  controllers.get(win)?.cancelCapture();
}
