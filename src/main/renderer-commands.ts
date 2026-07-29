import { ipcMain, type BrowserWindow } from "electron";
import {
  IPC,
  type RendererCommand,
  type RendererCommandOutcome,
} from "../shared/contracts.js";
import {
  RendererCommandBroker,
  type RendererCommandWindow,
} from "./core/renderer-command-broker.js";

/**
 * Main→renderer commands, and the single owner of "which window is the
 * renderer". `diagnostics.ts` used to answer that question itself with
 * `getURL().startsWith("gw://app")` — looser than the check `ipc.ts` applies to
 * traffic coming the other way — and built the command as JavaScript source.
 */

export const RENDERER_COMMAND_TIMEOUT_MS = 5_000;
const broker = new RendererCommandBroker(
  IPC.rendererCommand,
  RENDERER_COMMAND_TIMEOUT_MS,
);

ipcMain.on(IPC.rendererCommandDone, (event, id: unknown, outcome: unknown) => {
  broker.complete(event.sender.id, id, outcome);
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
  return broker.send(
    win as unknown as RendererCommandWindow | null,
    command,
  );
}
