/**
 * The one app-wide macOS dictation session. Main owns microphone permission,
 * the native recognizer, the active game window, and trusted text insertion.
 * Transcripts are forwarded only to that window and are never logged.
 */

import type { BrowserWindow, WebContents } from 'electron';
import { DICTATION_TEXT_CEILING, IPC, type DictationEvent } from '../shared/contracts.js';
import type { NativeDictationEvent, NativeHost } from './native-host.js';

type ActiveDictation = Readonly<{
  generation: number;
  window: BrowserWindow;
  onClosed: () => void;
} & (
  | { kind: 'capture' }
  | { kind: 'setup'; resolve(locale: string): void; reject(reason: Error): void }
)>;

export function safeDictationText(transcript: string): string {
  return Array.from(transcript, (character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint <= 0x1f
      || (codePoint >= 0x7f && codePoint <= 0x9f)
      || codePoint === 0x2028
      || codePoint === 0x2029
      ? ' '
      : character;
  }).join('');
}

export function sendDictationText(contents: WebContents, transcript: string): void {
  for (const keyCode of safeDictationText(transcript)) {
    contents.sendInputEvent({ type: 'keyDown', keyCode });
    contents.sendInputEvent({ type: 'char', keyCode });
    contents.sendInputEvent({ type: 'keyUp', keyCode });
  }
}

export class DictationController {
  private active: ActiveDictation | null = null;
  private generation = 0;
  private readonly nativeHost: NativeHost;
  private readonly requestMicrophone: () => Promise<boolean>;
  private readonly permissionHostReady: boolean;

  constructor(
    nativeHost: NativeHost,
    requestMicrophone: () => Promise<boolean>,
    permissionHostReady = true,
  ) {
    this.nativeHost = nativeHost;
    this.requestMicrophone = requestMicrophone;
    this.permissionHostReady = permissionHostReady;
  }

  async start(window: BrowserWindow): Promise<void> {
    this.cancel();
    // Forge's unpackaged development host is the generic Electron.app. It has
    // no speech privacy description, and macOS terminates it instead of
    // returning a permission error. Packaged builds carry both declarations.
    if (!this.permissionHostReady) {
      this.send(window, { state: 'error', reason: 'unavailable' });
      return;
    }
    const generation = ++this.generation;
    const onClosed = () => this.cancel(window);
    this.active = { kind: 'capture', generation, window, onClosed };
    window.once('closed', onClosed);
    this.send(window, { state: 'requesting' });

    const microphoneAllowed = await this.requestMicrophone();
    if (!this.isActive(generation, window)) return;
    if (!microphoneAllowed) {
      this.send(window, { state: 'error', reason: 'permission-denied' });
      this.releaseActive();
      return;
    }

    try {
      this.nativeHost.startDictation((event) => {
        this.receive(generation, window, event);
      });
    } catch {
      if (!this.isActive(generation, window)) return;
      this.send(window, { state: 'error', reason: 'unavailable' });
      this.releaseActive();
    }
  }

  prepare(window: BrowserWindow): Promise<string> {
    if (!this.permissionHostReady) {
      return Promise.reject(new Error('On-device dictation setup is unavailable'));
    }
    this.cancel();
    const generation = ++this.generation;
    const onClosed = () => this.cancel(window);
    return new Promise((resolve, reject) => {
      this.active = { kind: 'setup', generation, window, onClosed, resolve, reject };
      window.once('closed', onClosed);
      try {
        this.nativeHost.prepareDictation((event) => {
          this.receive(generation, window, event);
        });
      } catch (cause) {
        this.releaseActive();
        reject(new Error('On-device dictation setup is unavailable', { cause }));
      }
    });
  }

  finish(window: BrowserWindow): void {
    if (this.active?.window !== window) return;
    this.nativeHost.finishDictation();
  }

  cancel(window?: BrowserWindow): void {
    if (!this.active || (window && this.active.window !== window)) return;
    if (this.active.kind === 'setup') {
      this.active.reject(new Error('On-device dictation setup was cancelled'));
    }
    this.generation += 1;
    this.releaseActive();
    this.nativeHost.cancelDictation();
  }

  dispose(): void {
    this.cancel();
  }

  private receive(
    generation: number,
    window: BrowserWindow,
    event: NativeDictationEvent,
  ): void {
    if (!this.isActive(generation, window)) return;
    if (event.type === 'ready') {
      if (this.active?.kind !== 'setup') return;
      this.active.resolve(event.locale);
      this.releaseActive();
      return;
    }
    if (this.active?.kind === 'setup' && event.type !== 'error') {
      if (event.type === 'preparing') return;
      this.active.reject(new Error('On-device dictation setup returned an invalid event'));
      this.releaseActive();
      return;
    }
    if (event.type === 'preparing') {
      this.send(window, { state: 'preparing' });
      return;
    }
    if (event.type === 'listening') {
      this.send(window, { state: 'listening', transcript: '' });
      return;
    }
    if (event.type === 'result') {
      const transcript = event.transcript.slice(0, DICTATION_TEXT_CEILING);
      if (event.final) {
        if (this.active?.kind !== 'capture') return;
        this.releaseActive();
        this.commitFinal(window, transcript);
      } else {
        this.send(window, { state: 'listening', transcript });
      }
      return;
    }
    if (this.active?.kind === 'setup') {
      this.active.reject(new Error(`On-device dictation setup failed: ${event.reason}`));
    } else {
      this.send(window, { state: 'error', reason: event.reason });
    }
    this.releaseActive();
  }

  private commitFinal(window: BrowserWindow, transcript: string): void {
    try {
      if (window.isDestroyed() || !window.isFocused()) {
        throw new Error('owning window lost focus');
      }
      sendDictationText(window.webContents, transcript);
      this.send(window, { state: 'final' });
    } catch {
      this.send(window, { state: 'error', reason: 'insertion-failed' });
    }
  }

  private isActive(generation: number, window: BrowserWindow): boolean {
    return this.active?.generation === generation
      && this.active.window === window
      && !window.isDestroyed();
  }

  private send(window: BrowserWindow, event: DictationEvent): void {
    if (window.isDestroyed() || window.webContents.isDestroyed()) return;
    try {
      window.webContents.send(IPC.dictationEvent, event);
    } catch {
      // The renderer can disappear between the liveness check and delivery.
    }
  }

  private releaseActive(): void {
    const active = this.active;
    this.active = null;
    if (active && !active.window.isDestroyed()) {
      active.window.removeListener('closed', active.onClosed);
    }
  }
}
