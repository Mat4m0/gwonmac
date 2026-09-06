/**
 * Owns one generation's private whisper region and explicit submission.
 * Only game-observed log records leave this adapter; no IPC or files are used.
 */
import { COMPANION_ABI } from "../shared/companion-abi.js";
import { WHISPER_MAILBOX as M, whisperLine, type ObservedWhisper } from "../shared/whispers.js";
import { readCompanionWhispers } from "./companion-whisper-snapshot.js";

type Listener = (messages: readonly ObservedWhisper[], missed: number) => void;
export function createWhisperInstallation(exports: WebAssembly.Exports, available: boolean) {
  const configure = available ? exports.enhancement_configure_whispers : null;
  const enqueue = available ? exports.enhancement_send_whisper : null;
  if (available && (typeof configure !== "function" || typeof enqueue !== "function")) {
    throw new Error("Certified whisper exports are unavailable.");
  }
  let pointer = 0;
  let memory: WebAssembly.Memory | null = null;
  let enabled = false;
  let cursor = 0;
  let rejected = 0;
  let disposed = false;
  const listeners = new Set<Listener>();
  let pending: { recipient: string; message: string; resolve(): void; reject(error: Error): void; timer: ReturnType<typeof setTimeout> } | null = null;
  const rejectPending = (message: string) => {
    const request = pending;
    pending = null;
    if (request) { clearTimeout(request.timer); request.reject(new Error(message)); }
  };
  return {
    get pointer() { return pointer; },
    get bytes() { return available ? COMPANION_ABI.whispers.bytes : 0; },
    get enabled() { return enabled; },
    get region() { return pointer === 0 ? null : { name: "whispers", pointer, size: COMPANION_ABI.whispers.bytes, align: 4 as const }; },
    allocate(malloc: (bytes: number) => unknown) {
      if (!available) return;
      pointer = Number(malloc(COMPANION_ABI.whispers.bytes));
      if (!Number.isInteger(pointer) || pointer <= 0 || pointer % 4 !== 0) {
        throw new Error("Whisper memory allocation failed.");
      }
    },
    initialize(value: WebAssembly.Memory) { memory = value; },
    subscribe(listener: Listener) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    setEnabled(next: boolean) {
      next = available && next && !disposed;
      if (next === enabled) return;
      if (typeof configure !== "function") return;
      if (configure(next ? pointer + COMPANION_ABI.whispers.snapshotBytes : 0, next ? 1 : 0) !== 1) {
        throw new Error("Whisper configuration was refused.");
      }
      enabled = next;
      if (!next) rejectPending("Whispers became unavailable. Check original chat before sending again.");
    },
    poll() {
      if (disposed || pointer === 0 || memory === null) return;
      const state = readCompanionWhispers(memory.buffer, pointer, cursor);
      if (state.status !== "ready") return;
      cursor = state.writeCount;
      const missed = state.dropped + Math.max(0, state.rejectedCount - rejected);
      rejected = state.rejectedCount;
      if (!enabled) return;
      if (pending && new DataView(memory.buffer).getUint32(pointer + COMPANION_ABI.whispers.snapshotBytes + M.status, true) === 2 && state.messages.some(message => message.direction === "outgoing"
        && message.sender.toLocaleLowerCase("en-US") === pending?.recipient.toLocaleLowerCase("en-US")
        && message.message === pending?.message)) {
        const completed = pending; pending = null;
        clearTimeout(completed.timer); completed.resolve();
      }
      if (state.messages.length || missed) {
        for (const listener of listeners) listener(state.messages, missed);
      }
      if (pending && new DataView(memory.buffer).getUint32(pointer + COMPANION_ABI.whispers.snapshotBytes + M.status, true) === 3) {
        rejectPending("The game session changed. Your whisper was not submitted.");
      }
    },
    send(recipient: string, message: string): Promise<void> {
      if (!enabled || memory === null || typeof enqueue !== "function") {
        return Promise.reject(new Error("Whispers are available with this tool enabled in a supported PvE area."));
      }
      if (pending) return Promise.reject(new Error("A whisper is still being submitted. Wait before sending another."));
      let line: string;
      try { line = whisperLine(recipient, message); } catch (error) { return Promise.reject(error); }
      const view = new DataView(memory.buffer);
      const mailbox = pointer + COMPANION_ABI.whispers.snapshotBytes;
      view.setUint32(mailbox + M.length, line.length, true);
      for (let i = 0; i < line.length; i++) view.setUint16(mailbox + M.source + i * 2, line.charCodeAt(i), true);
      if (enqueue() !== 1) return Promise.reject(new Error("Guild Wars is busy or the session changed. Your draft is kept."));
      return new Promise<void>((resolve, reject) => {
        pending = { recipient, message, resolve, reject, timer: setTimeout(() => {
          rejectPending("Guild Wars has not shown the outgoing whisper. Check original chat before trying again.");
        }, 5_000) };
      });
    },
    dispose(free: (pointer: number) => void) {
      if (disposed) return;
      if (typeof configure === "function") configure(0, 0);
      enabled = false; disposed = true;
      rejectPending("The game session ended."); listeners.clear();
      if (pointer !== 0) {
        if (memory !== null) new Uint8Array(memory.buffer, pointer, COMPANION_ABI.whispers.bytes).fill(0);
        free(pointer); pointer = 0;
      }
      memory = null;
    },
  };
}
export type WhisperInstallation = ReturnType<typeof createWhisperInstallation>;
