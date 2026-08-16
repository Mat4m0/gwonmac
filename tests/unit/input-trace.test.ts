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
} from '../../src/main/input-trace.js';

test('main input trace emits only while its renderer harness is enabled', () => {
  const sent: unknown[][] = [];
  const win = {
    isDestroyed: () => false,
    webContents: { send: (...args: unknown[]) => sent.push(args) },
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
});
