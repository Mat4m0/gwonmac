/**
 * Main-process producer and enable gate for the player-visible input harness.
 * Renderer memory remains the only trace store.
 */
import type { BrowserWindow } from 'electron';
import { IPC } from '../shared/contracts.js';
import type { InputTraceEntry } from '../shared/input-trace.js';

const enabledWindows = new WeakSet<BrowserWindow>();

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

export function recordMainInput(
  win: BrowserWindow,
  entry: InputTraceEntry,
): void {
  if (!enabledWindows.has(win) || win.isDestroyed()) return;
  win.webContents.send(IPC.inputTraceEvent, entry);
}
