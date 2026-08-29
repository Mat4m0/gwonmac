/**
 * Captures one macOS application shortcut at the launcher boundary. Main owns
 * reserved keys and Tool conflicts, so renderer code cannot bypass the policy.
 */
import type { BrowserWindow, Event, Input } from "electron";
import type { AppSettings } from "../shared/contracts.js";
import type { GlobalTool, LauncherShortcutCaptureResult } from "../shared/launcher-contracts.js";
import { shortcutFromInput, shortcutReserved } from "../shared/keyboard-shortcuts.js";
import { shortcutOwner } from "./core/launcher-tools.js";

const CAPTURE_TIMEOUT_MS = 30_000;

export function captureLauncherShortcut(
  win: BrowserWindow,
  tool: GlobalTool,
  getSettings: () => AppSettings,
): Promise<LauncherShortcutCaptureResult> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (result: LauncherShortcutCaptureResult): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      win.webContents.off("before-input-event", onInput);
      resolve(result);
    };
    const onInput = (event: Event, input: Input): void => {
      if (input.type !== "keyDown" || input.isAutoRepeat) return;
      event.preventDefault();
      if (input.key === "Escape") {
        finish({ status: "cancelled" });
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
      const conflict = shortcutOwner(binding, getSettings(), tool);
      finish(conflict ? { status: "conflict", tool: conflict, binding } : { status: "captured", binding });
    };
    const timer = setTimeout(() => finish({ status: "cancelled" }), CAPTURE_TIMEOUT_MS);
    win.webContents.on("before-input-event", onInput);
    win.once("closed", () => finish({ status: "cancelled" }));
  });
}
