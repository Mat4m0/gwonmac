/**
 * Main-process producer and enable gate for the player-visible input harness.
 * Renderer memory remains the only trace store.
 */
import type { BrowserWindow } from 'electron';
import {
  IPC,
  type RendererCommandOutcome,
} from '../shared/contracts.js';
import type { MainInputTraceEntry } from '../shared/input-trace.js';

type InputTraceCommandSender = (
  win: BrowserWindow,
  command: { type: 'input.trace'; enabled: boolean },
) => Promise<RendererCommandOutcome>;

const enabledWindows = new WeakSet<BrowserWindow>();
const observedWindows = new WeakSet<BrowserWindow>();

const observeRendererLifetime = (win: BrowserWindow): void => {
  if (observedWindows.has(win)) return;
  observedWindows.add(win);
  const disable = () => enabledWindows.delete(win);
  win.webContents.on('render-process-gone', disable);
  win.webContents.on('did-start-navigation', (details) => {
    if (details.isMainFrame && !details.isSameDocument) disable();
  });
  win.webContents.once('destroyed', disable);
  win.once('closed', disable);
};

export function inputTraceEnabled(win: BrowserWindow): boolean {
  return enabledWindows.has(win);
}

export function setInputTraceEnabled(
  win: BrowserWindow,
  enabled: boolean,
): void {
  if (enabled) enabledWindows.add(win);
  else enabledWindows.delete(win);
}

/** Commit main's gate only after the renderer confirms the same state. */
export async function setInputTraceVisibility(
  win: BrowserWindow,
  enabled: boolean,
  send: InputTraceCommandSender,
): Promise<boolean> {
  const outcome = await send(win, { type: 'input.trace', enabled });
  if (outcome !== 'completed') return false;
  setInputTraceEnabled(win, enabled);
  if (enabled) observeRendererLifetime(win);
  return true;
}

export function recordMainInput(
  win: BrowserWindow,
  entry: MainInputTraceEntry,
): void {
  if (
    !enabledWindows.has(win)
    || win.isDestroyed()
    || win.webContents.isDestroyed()
  ) return;
  try {
    win.webContents.send(IPC.inputTraceEvent, entry);
  } catch {
    // A renderer may disappear between the checks and send. Tracing is an
    // observer and must never interrupt the input path it is observing.
  }
}
