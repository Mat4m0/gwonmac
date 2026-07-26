import { BrowserWindow, ipcMain } from "electron";
import { IPC, type RendererCommand } from "../shared/contracts.js";
import { isCanonicalRendererUrl } from "./core/renderer-trust.js";

/**
 * Main→renderer commands, and the single owner of "which window is the
 * renderer". `diagnostics.ts` used to answer that question itself with
 * `getURL().startsWith("gw://app")` — looser than the check `ipc.ts` applies to
 * traffic coming the other way — and built the command as JavaScript source.
 */

interface Pending {
  webContentsId: number;
  settle: () => void;
}

const pending = new Map<number, Pending>();
let lastCommandId = 0;

ipcMain.on(IPC.rendererCommandDone, (event, id: unknown) => {
  if (typeof id !== "number") return;
  const entry = pending.get(id);
  // Only the renderer the command was sent to may complete it.
  if (!entry || entry.webContentsId !== event.sender.id) return;
  entry.settle();
});

export function canonicalRendererWindow(): BrowserWindow | null {
  return (
    BrowserWindow.getAllWindows().find(
      (win) =>
        !win.isDestroyed()
        && !win.webContents.isDestroyed()
        && isCanonicalRendererUrl(win.webContents.getURL()),
    ) ?? null
  );
}

/**
 * Resolves when the renderer has finished the command, when the page that would
 * answer it goes away, or immediately when there is no live renderer. It never
 * rejects and it never hangs: every caller is a menu action or a capture step
 * whose only failure mode is that the renderer was not there, and one of them
 * runs on the quit path.
 *
 * A command sent while a page is still loading is dropped by Chromium — the
 * handler is not registered yet — so `did-finish-load` is a give-up signal, not
 * a deadline. Once a page is loaded, only its replacement or its destruction
 * settles a command the renderer has not answered.
 */
export function sendRendererCommand(
  win: BrowserWindow | null,
  command: RendererCommand,
): Promise<void> {
  if (!win || win.isDestroyed() || win.webContents.isDestroyed()) {
    return Promise.resolve();
  }
  const contents = win.webContents;
  const id = (lastCommandId += 1);
  return new Promise<void>((resolve) => {
    const settle = (): void => {
      pending.delete(id);
      contents.off("destroyed", settle);
      contents.off("did-finish-load", settle);
      contents.off("did-start-navigation", abandon);
      resolve();
    };
    const abandon = (
      details: Electron.Event<Electron.WebContentsDidStartNavigationEventParams>,
    ): void => {
      if (details.isMainFrame && !details.isSameDocument) settle();
    };
    pending.set(id, { webContentsId: contents.id, settle });
    contents.once("destroyed", settle);
    contents.once("did-finish-load", settle);
    contents.on("did-start-navigation", abandon);
    contents.send(IPC.rendererCommand, id, command);
  });
}
