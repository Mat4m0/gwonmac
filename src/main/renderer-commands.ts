/**
 * Main→renderer commands, and the single owner of "which window is the
 * renderer".
 *
 * Commands are typed values, never JavaScript source built by interpolation,
 * and the window they may address is the one `renderer-trust.ts` recognises —
 * the same rule `ipc.ts` applies to traffic coming the other way, so the two
 * directions cannot drift into different ideas of what the renderer is. Only
 * the renderer a command was sent to may complete it.
 */
import { ipcMain, type BrowserWindow } from "electron";
import {
  IPC,
  RENDERER_COMMAND_COMPLETIONS,
  type GameTextEditCommand,
  type RendererCommand,
  type RendererCommandCompletion,
  type RendererCommandOutcome,
} from "../shared/contracts.js";
import { logEvent } from "./diagnostics/recorder.js";
import { windowRegistry } from "./window-registry.js";

interface Pending {
  webContentsId: number;
  settle: (outcome: RendererCommandOutcome) => void;
}

const pending = new Map<number, Pending>();
let lastCommandId = 0;
export const RENDERER_COMMAND_TIMEOUT_MS = 5_000;
export const VISUAL_CAPTURE_COMMAND_TIMEOUT_MS = 60_000;

ipcMain.on(IPC.rendererCommandDone, (event, id: unknown, outcome: unknown) => {
  if (
    typeof id !== "number"
    || !RENDERER_COMMAND_COMPLETIONS.includes(
      outcome as RendererCommandCompletion,
    )
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
 * `isLoadingMainFrame()` is not a readiness boundary. The renderer installs
 * this command handler after DOMContentLoaded, before Electron emits
 * `did-finish-load`, so a command may be handled while the main frame still
 * reports loading. Conversely, a command sent before the handler exists may be
 * dropped; the bounded timeout handles that honest uncertainty. Only page
 * replacement, destruction, or loss of the renderer process may fail a command
 * before its handler answers.
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
    const timeoutMs = command.type === "diagnostics.visual"
      ? VISUAL_CAPTURE_COMMAND_TIMEOUT_MS
      : RENDERER_COMMAND_TIMEOUT_MS;
    const timer = setTimeout(
      () => settle("timed-out"),
      timeoutMs,
    );
    const settle = (outcome: RendererCommandOutcome): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      pending.delete(id);
      contents.off("destroyed", failed);
      contents.off("render-process-gone", failed);
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
    contents.on("did-start-navigation", abandon);
    try {
      contents.send(IPC.rendererCommand, id, command);
    } catch {
      failed();
    }
  });
}

/**
 * Held keys and a captured pointer belong to the game, not to the sheet or the
 * menu that just took focus. Every surface that opens one clears input first,
 * so the command has a name here instead of being spelled out at each caller.
 */
export async function resetGameInput(win: BrowserWindow): Promise<void> {
  await sendRendererCommand(win, { type: "input.reset" });
}

/** One semantic edit route for both physical shortcuts and Edit menu clicks. */
export async function editWindowText(
  win: BrowserWindow,
  command: GameTextEditCommand,
): Promise<void> {
  const outcome = await sendRendererCommand(win, { type: "text.edit", command });
  if (outcome !== "unhandled") return;
  if (command === "cut") win.webContents.cut();
  else if (command === "copy") win.webContents.copy();
  else if (command === "paste") win.webContents.paste();
  else win.webContents.selectAll();
}

/**
 * Show or hide the Build Library.
 *
 * One function for the two ways a player asks. The menu item and the keyboard
 * shortcut are different routes to the same intent, and a second copy of "send
 * the command, notice if it was refused" is how the two quietly stop agreeing.
 *
 * Deliberately no `resetGameInput`, unlike every sheet and dialog above. Those
 * take focus; this overlay does not. Opening Tools is not a statement that you
 * have stopped playing, so a held movement key keeps acting -- which is what
 * the overlay itself implements (`setOpen` releases nothing; only teardown
 * does) and what the chip and the chord already do. Clearing input here made
 * `Cmd+B` the one route that stopped your character, and on a launch without
 * the Toolbox capability it stopped them for a refusal that only reached a log.
 */
export async function toggleTools(win: BrowserWindow): Promise<void> {
  const ownerId = windowRegistry.requireDiagnosticOwnerForWindow(win);
  const outcome = await sendRendererCommand(win, { type: "tools.toggle" });
  // The renderer refuses outright when the Toolbox capability is not
  // installed, which is the ordinary case on a launch that did not ask for it.
  if (outcome !== "completed") {
    logEvent(
      { k: "tools.toggleRefused", outcome },
      ownerId,
    );
    await sendRendererCommand(win, { type: "settings.open", pane: "controls" });
  }
}

/** Show or hide the independent read-only Trade Chat surface. */
export async function toggleTrade(win: BrowserWindow): Promise<void> {
  if (await sendRendererCommand(win, { type: "trade.toggle" }) === "completed") {
    return;
  }
  await sendRendererCommand(win, { type: "settings.open", pane: "controls" });
}

/**
 * Ask the certified game-thread command queue to open Xunlai storage.
 *
 * A refusal opens the Controls settings pane, which owns the switch and its
 * availability contract. Opening the general Tools window here looked like
 * Command-Shift-C had been misrouted to the hero-build shortcut.
 */
export async function openStorage(win: BrowserWindow): Promise<void> {
  // Command-Shift-C can lose its physical modifier releases in AppKit after
  // Chromium has already forwarded Shift to the game. Clear the renderer's
  // held-key ledger before either the native Xunlai UI or the fallback dialog
  // opens, so Guild Wars cannot keep a synthetic Shift pressed for the rest of
  // the session. The Tools button takes the same harmless reset-free domain
  // action directly because it carries no held keyboard chord.
  await resetGameInput(win);
  if (await sendRendererCommand(win, { type: "storage.open" }) === "completed") {
    return;
  }
  await sendRendererCommand(win, { type: "settings.open", pane: "controls" });
}

/** Open the focused Travel palette, with Settings as the truthful fallback. */
export async function toggleTravel(win: BrowserWindow): Promise<void> {
  await resetGameInput(win);
  if (await sendRendererCommand(win, { type: "travel.toggle" }) === "completed") {
    return;
  }
  await sendRendererCommand(win, { type: "settings.open", pane: "controls" });
}
