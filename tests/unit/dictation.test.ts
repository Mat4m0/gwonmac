/**
 * Dictation ownership and privacy tests at the main/native boundary.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import type { BrowserWindow } from 'electron';
import { IPC } from '../../src/shared/contracts.js';
import {
  DictationController,
  safeDictationText,
} from '../../src/main/dictation.js';
import { dictationPlacement } from '../../src/renderer/dictation.js';
import type { NativeDictationEvent, NativeHost } from '../../src/main/native-host.js';

test('the mic stays beside moved chat and vertically centered', () => {
  assert.deepEqual(
    dictationPlacement(
      { x: 100, y: 300, width: 420, height: 28 },
      { width: 1_000, height: 700 },
    ),
    { left: 528, top: 296 },
  );
  assert.deepEqual(
    dictationPlacement(
      { x: 260, y: 120, width: 500, height: 40 },
      { width: 1_000, height: 700 },
    ),
    { left: 768, top: 122 },
  );
});

function fixture(
  permission: boolean,
  permissionHostReady = true,
  insertionError?: Error,
) {
  const sent: Array<[string, unknown]> = [];
  const inserted: string[] = [];
  const listeners = new Map<string, () => void>();
  let handler: ((event: NativeDictationEvent) => void) | null = null;
  let finished = 0;
  let cancelled = 0;
  const native = {
    startDictation(next: (event: NativeDictationEvent) => void) { handler = next; },
    prepareDictation(next: (event: NativeDictationEvent) => void) { handler = next; },
    finishDictation() { finished += 1; },
    cancelDictation() { cancelled += 1; },
  } as unknown as NativeHost;
  const window = {
    isDestroyed: () => false,
    isFocused: () => true,
    once: (name: string, listener: () => void) => { listeners.set(name, listener); },
    removeListener: (name: string) => { listeners.delete(name); },
    webContents: {
      isDestroyed: () => false,
      send: (channel: string, event: unknown) => sent.push([channel, event]),
      sendInputEvent: (event: { type: string; keyCode?: string }) => {
        if (insertionError) throw insertionError;
        if (event.type === 'char' && event.keyCode) inserted.push(event.keyCode);
      },
    },
  } as unknown as BrowserWindow;
  let permissionRequests = 0;
  const controller = new DictationController(native, async () => {
    permissionRequests += 1;
    return permission;
  }, permissionHostReady);
  return {
    controller,
    window,
    sent,
    inserted,
    emit(event: NativeDictationEvent) { handler?.(event); },
    finished: () => finished,
    cancelled: () => cancelled,
    permissionRequests: () => permissionRequests,
  };
}

test('setup prepares the model without microphone permission or game events', async () => {
  const subject = fixture(true);
  const prepared = subject.controller.prepare(subject.window);
  subject.emit({ type: 'preparing', progress: 0.5 });
  subject.emit({ type: 'ready', locale: 'English (US)' });
  assert.equal(await prepared, 'English (US)');
  assert.equal(subject.permissionRequests(), 0);
  assert.deepEqual(subject.sent, []);
});

test('an unpackaged Electron host never touches macOS speech privacy APIs', async () => {
  const subject = fixture(true, false);
  await subject.controller.start(subject.window);
  assert.deepEqual(subject.sent, [
    [IPC.dictationEvent, { state: 'error', reason: 'unavailable' }],
  ]);
  assert.equal(subject.permissionRequests(), 0);
  assert.equal(subject.cancelled(), 0);
});

test('permission refusal produces no native recording', async () => {
  const subject = fixture(false);
  await subject.controller.start(subject.window);
  assert.deepEqual(subject.sent, [
    [IPC.dictationEvent, { state: 'requesting' }],
    [IPC.dictationEvent, { state: 'error', reason: 'permission-denied' }],
  ]);
  assert.equal(subject.finished(), 0);
  assert.equal(subject.cancelled(), 0);
});

test('the owning window receives and directly inserts the final transcript', async () => {
  const subject = fixture(true);
  await subject.controller.start(subject.window);
  subject.emit({ type: 'listening' });
  subject.emit({ type: 'result', transcript: 'hello', final: false });
  subject.controller.finish(subject.window);
  subject.emit({ type: 'result', transcript: 'hello world', final: true });

  assert.equal(subject.finished(), 1);
  assert.equal(subject.inserted.join(''), 'hello world');
  assert.deepEqual(subject.sent.slice(1), [
    [IPC.dictationEvent, { state: 'listening', transcript: '' }],
    [IPC.dictationEvent, { state: 'listening', transcript: 'hello' }],
    [IPC.dictationEvent, { state: 'final', transcript: 'hello world' }],
  ]);
});

test('an insertion failure is reported without claiming the transcript was added', async () => {
  const subject = fixture(true, true, new Error('insertion failed'));
  await subject.controller.start(subject.window);
  subject.emit({ type: 'result', transcript: 'hello world', final: true });

  assert.deepEqual(subject.inserted, []);
  assert.deepEqual(subject.sent.slice(1), [
    [IPC.dictationEvent, { state: 'error', reason: 'insertion-failed' }],
  ]);
});

test('a duplicate native final cannot insert the phrase twice', async () => {
  const subject = fixture(true);
  await subject.controller.start(subject.window);
  subject.emit({ type: 'result', transcript: 'one phrase', final: true });
  subject.emit({ type: 'result', transcript: 'one phrase', final: true });

  assert.equal(subject.inserted.join(''), 'one phrase');
  assert.deepEqual(subject.sent.slice(1), [
    [IPC.dictationEvent, { state: 'final', transcript: 'one phrase' }],
  ]);
});

test('dictation cannot synthesize submit, focus, escape, or control characters', () => {
  assert.equal(
    safeDictationText('hello\nworld\t\u001bnext\u2028line'),
    'hello world  next line',
  );
});
