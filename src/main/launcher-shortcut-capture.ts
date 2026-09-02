/**
 * Captures one macOS application shortcut at the launcher boundary. Main owns
 * reserved keys and Tool conflicts, so renderer code cannot bypass the policy.
 */
import type { BrowserWindow, Event, Input } from "electron";
import type { AppSettings } from "../shared/contracts.js";
import type { LauncherShortcutCaptureResult } from "../shared/launcher-contracts.js";
import { resolveShortcuts, shortcutConflict, shortcutFromInput, shortcutReserved, type ShortcutAction } from "../shared/keyboard-shortcuts.js";

const CAPTURE_TIMEOUT_MS = 30_000;
const activeCaptures = new WeakMap<BrowserWindow, () => void>();

export function captureLauncherShortcut(
  win: BrowserWindow,
  action: ShortcutAction,
  getSettings: () => AppSettings,
): Promise<LauncherShortcutCaptureResult> {
  activeCaptures.get(win)?.();
  return new Promise((resolve) => {
    let settled = false;
    const finish = (result: LauncherShortcutCaptureResult): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      win.webContents.off("before-input-event", onInput);
      win.off("closed", cancel);
      win.off("blur", cancel);
      activeCaptures.delete(win);
      resolve(result);
    };
    const cancel = () => finish({ status: "cancelled" });
    const onInput = (event: Event, input: Input): void => {
      if (input.type !== "keyDown" || input.isAutoRepeat) return;
      if (["Meta", "Control", "Shift", "Alt"].includes(input.key)) return;
      event.preventDefault();
      if (input.key === "Escape") {
        finish({ status: "cancelled" });
        return;
      }
      if (input.key === "Backspace" || input.key === "Delete") {
        finish({ status: "cleared" });
        return;
      }
      const binding = shortcutFromInput(input);
      if (!binding) {
        finish({ status: "invalid" });
        return;
      }
      if (shortcutReserved(binding)) {
        finish({ status: "reserved" });
        return;
      }
      const conflict = shortcutConflict(action, binding, resolveShortcuts(getSettings().shortcutOverrides));
      finish(conflict ? { status: "conflict", action: conflict, binding } : { status: "captured", binding });
    };
    const timer = setTimeout(() => finish({ status: "cancelled" }), CAPTURE_TIMEOUT_MS);
    win.webContents.on("before-input-event", onInput);
    win.once("closed", cancel);
    win.once("blur", cancel);
    activeCaptures.set(win, cancel);
  });
}
