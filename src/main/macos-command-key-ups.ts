/**
 * macOS Command-held key releases that AppKit consumes before Chromium sees
 * them. The focused game window receives one physical-key release through the
 * existing renderer command boundary.
 */
import { BrowserWindow } from "electron";
import { physicalCodeForMacKeyCode } from "./core/macos-key-code.js";
import type { NativeHost } from "./native-host.js";
import { sendRendererCommand } from "./renderer-commands.js";
import { windowRegistry } from "./window-registry.js";

export function installMacosCommandKeyUps(nativeHost: NativeHost): () => void {
  return nativeHost.monitorCommandKeyUps((keyCode) => {
    const code = physicalCodeForMacKeyCode(keyCode);
    const win = BrowserWindow.getFocusedWindow();
    const context = win
      ? windowRegistry.contextForWebContents(win.webContents.id)
      : null;
    if (!code || !win || context?.role !== "game") return false;
    void sendRendererCommand(win, { type: "input.release", code });
    return true;
  });
}
