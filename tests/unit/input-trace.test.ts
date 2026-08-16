/**
 * The main trace producer is gated and transports only the shared entry.
 * Its disabled state must be completely dormant.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import type { BrowserWindow } from 'electron';
import { IPC } from '../../src/shared/contracts.js';
import {
  inputTraceEnabled,
  recordMainInput,
  setInputTraceEnabled,
  setInputTraceVisibility,
} from '../../src/main/input-trace.js';

test('main input trace emits only while its renderer harness is enabled', () => {
  const sent: unknown[][] = [];
  const win = {
    isDestroyed: () => false,
    webContents: {
      isDestroyed: () => false,
      send: (...args: unknown[]) => sent.push(args),
    },
  } as unknown as BrowserWindow;
  const entry = {
    source: 'main',
    kind: 'native-key',
    phase: 'down',
    key: 'printable',
    repeat: true,
    decision: 'forwarded',
  } as const;

  assert.equal(inputTraceEnabled(win), false);
  recordMainInput(win, entry);
  assert.deepEqual(sent, []);

  setInputTraceEnabled(win, true);
  assert.equal(inputTraceEnabled(win), true);
  recordMainInput(win, entry);
  assert.deepEqual(sent, [[IPC.inputTraceEvent, entry]]);

  setInputTraceEnabled(win, false);
  recordMainInput(win, entry);
  assert.equal(sent.length, 1);

  setInputTraceEnabled(win, true);
  win.webContents.send = () => { throw new Error('renderer disappeared'); };
  assert.doesNotThrow(() => recordMainInput(win, entry));
});

test('main trace state changes only after renderer acknowledgement', async () => {
  const contentsListeners = new Map<string, (...args: never[]) => void>();
  const winListeners = new Map<string, (...args: never[]) => void>();
  const win = {
    isDestroyed: () => false,
    webContents: {
      isDestroyed: () => false,
      on: (name: string, listener: (...args: never[]) => void) => {
        contentsListeners.set(name, listener);
      },
      once: (name: string, listener: (...args: never[]) => void) => {
        contentsListeners.set(name, listener);
      },
    },
    once: (name: string, listener: (...args: never[]) => void) => {
      winListeners.set(name, listener);
    },
  } as unknown as BrowserWindow;

  assert.equal(await setInputTraceVisibility(
    win,
    true,
    async () => 'failed',
  ), false);
  assert.equal(inputTraceEnabled(win), false);

  assert.equal(await setInputTraceVisibility(
    win,
    true,
    async () => 'completed',
  ), true);
  assert.equal(inputTraceEnabled(win), true);
  contentsListeners.get('did-start-navigation')?.({
    isMainFrame: true,
    isSameDocument: false,
  } as never);
  assert.equal(inputTraceEnabled(win), false);
  assert.equal(winListeners.has('closed'), true);
});
