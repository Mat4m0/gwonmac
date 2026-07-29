import { ipcMain, type BrowserWindow } from "electron";
import {
  IPC,
  type RendererCommand,
  type RendererCommandCompletion,
  type RendererCommandOutcome,
} from "../shared/contracts.js";

/**
 * Main→renderer commands, and the single owner of "which window is the
 * renderer". `diagnostics.ts` used to answer that question itself with
 * `getURL().startsWith("gw://app")` — looser than the check `ipc.ts` applies to
 * traffic coming the other way — and built the command as JavaScript source.
 */

interface Pending {
  webContentsId: number;
  settle: (outcome: RendererCommandOutcome) => void;
}

const pending = new Map<number, Pending>();
let lastCommandId = 0;
export const RENDERER_COMMAND_TIMEOUT_MS = 5_000;

ipcMain.on(IPC.rendererCommandDone, (event, id: unknown, outcome: unknown) => {
  if (
    typeof id !== "number"
    || (outcome !== "completed" && outcome !== "failed")
  ) {
    return;
  }
  const entry = pending.get(id);
  // Only the renderer the command was sent to may complete it.
  if (!entry || entry.webContentsId !== event.sender.id) return;
  entry.settle(outcome as RendererCommandCompletion);
});

/**
 * Resolves with the renderer's truthful completion, failure when the page that
 * would answer goes away, or a bounded timeout. It never rejects and it never
 * hangs: every caller is a menu action or a capture step, and capture stop runs
 * on the quit path.
 *
 * A command sent while a page is still loading is dropped by Chromium — the
 * handler is not registered yet — so `did-finish-load` is a give-up signal, not
 * a deadline. Once a page is loaded, only its replacement, its destruction, or
 * the loss of its renderer process settles a command it has not answered.
 *
 * A renderer whose process is gone cannot answer, and after a second crash the
 * window and its `webContents` are both still alive with the canonical URL —
 * `render-process-gone` has already fired and will not fire again, so the
 * up-front check is the one that matters and the listener covers a process that
 * dies while a command is outstanding. Without both, `stopDiagnosticCapture`
 * waits for a flush that can never arrive and the quit path never completes.
 */
export function sendRendererCommand(
  win: BrowserWindow | null,
  command: RendererCommand,
): Promise<RendererCommandOutcome> {
  if (
    !win
    || win.isDestroyed()
    || win.webContents.isDestroyed()
    || win.webContents.isCrashed()
  ) {
    return Promise.resolve("failed");
  }
  const contents = win.webContents;
  const id = (lastCommandId += 1);
  return new Promise<RendererCommandOutcome>((resolve) => {
    let settled = false;
    const timer = setTimeout(
      () => settle("timed-out"),
      RENDERER_COMMAND_TIMEOUT_MS,
    );
    const settle = (outcome: RendererCommandOutcome): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      pending.delete(id);
      contents.off("destroyed", failed);
      contents.off("render-process-gone", failed);
      contents.off("did-finish-load", failed);
      contents.off("did-start-navigation", abandon);
      resolve(outcome);
    };
    const failed = (): void => settle("failed");
    const abandon = (
      details: Electron.Event<Electron.WebContentsDidStartNavigationEventParams>,
    ): void => {
      if (details.isMainFrame && !details.isSameDocument) failed();
    };
    pending.set(id, { webContentsId: contents.id, settle });
    contents.once("destroyed", failed);
    contents.once("render-process-gone", failed);
    contents.once("did-finish-load", failed);
    contents.on("did-start-navigation", abandon);
    try {
      contents.send(IPC.rendererCommand, id, command);
    } catch {
      failed();
    }
  });
}
