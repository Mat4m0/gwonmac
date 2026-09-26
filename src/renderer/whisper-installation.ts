/**
 * Owns one generation's private chat region and explicit submission of a
 * whisper or a party invite. Only game-observed log records leave this
 * adapter; no IPC or files are used.
 */
import { COMPANION_ABI } from "../shared/companion-abi.js";
import { WHISPER_MAILBOX as M, partyInviteLine, whisperLine, type ObservedChatEvent } from "../shared/whispers.js";
import { readCompanionWhispers } from "./companion-whisper-snapshot.js";

type Listener = (messages: readonly ObservedChatEvent[], missed: number) => void;
export function createWhisperInstallation(exports: WebAssembly.Exports, available: boolean) {
  const configure = available ? exports.enhancement_configure_whispers : null;
  const enqueue = available ? exports.enhancement_send_whisper : null;
  const enqueueInvite = available ? exports.enhancement_send_party_invite : null;
  if (available && (typeof configure !== "function" || typeof enqueue !== "function" || typeof enqueueInvite !== "function")) {
    throw new Error("Certified whisper exports are unavailable.");
  }
  let pointer = 0;
  let memory: WebAssembly.Memory | null = null;
  let enabled = false;
  let cursor = 0;
  let rejected = 0;
  let disposed = false;
  const listeners = new Set<Listener>();
  // An invite has no chat echo; the drained mailbox is its only receipt.
  let pending: { kind: "whisper" | "invite"; recipient: string; message: string; resolve(): void; reject(error: Error): void; timer: ReturnType<typeof setTimeout> } | null = null;
  const rejectPending = (message: string) => {
    const request = pending;
    pending = null;
    if (request) { clearTimeout(request.timer); request.reject(new Error(message)); }
  };
  function submit(request: { kind: "whisper" | "invite"; recipient: string; message: string }, line: string,
    command: unknown, unavailable: string, refused: string, timeout: string): Promise<void> {
    if (!enabled || memory === null || typeof command !== "function") return Promise.reject(new Error(unavailable));
    if (pending) return Promise.reject(new Error("Guild Wars is still taking the last chat command. Wait before trying again."));
    const view = new DataView(memory.buffer);
    const mailbox = pointer + COMPANION_ABI.whispers.snapshotBytes;
    view.setUint32(mailbox + M.length, line.length, true);
    for (let i = 0; i < line.length; i++) view.setUint16(mailbox + M.source + i * 2, line.charCodeAt(i), true);
    if (command() !== 1) return Promise.reject(new Error(refused));
    return new Promise<void>((resolve, reject) => {
      pending = { ...request, resolve, reject, timer: setTimeout(() => rejectPending(timeout), 5_000) };
    });
  }
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
      if (!next) rejectPending("Chat became unavailable. Check original chat before trying again.");
    },
    poll() {
      if (disposed || pointer === 0 || memory === null) return;
      const state = readCompanionWhispers(memory.buffer, pointer, cursor);
      if (state.status !== "ready") return;
      cursor = state.writeCount;
      const missed = state.dropped + Math.max(0, state.rejectedCount - rejected);
      rejected = state.rejectedCount;
      if (!enabled) return;
      const status = new DataView(memory.buffer).getUint32(pointer + COMPANION_ABI.whispers.snapshotBytes + M.status, true);
      if (pending?.kind === "invite" && status === 2) {
        const completed = pending; pending = null;
        clearTimeout(completed.timer); completed.resolve();
      }
      if (pending?.kind === "whisper" && status === 2 && state.messages.some(message => message.direction === "outgoing"
        && message.sender.toLocaleLowerCase("en-US") === pending?.recipient.toLocaleLowerCase("en-US")
        && message.message === pending?.message)) {
        const completed = pending; pending = null;
        clearTimeout(completed.timer); completed.resolve();
      }
      if (state.messages.length || missed) {
        for (const listener of listeners) listener(state.messages, missed);
      }
      if (pending && status === 3) {
        rejectPending(pending.kind === "invite" ? "The game session changed. The invite was not sent."
          : "The game session changed. Your whisper was not submitted.");
      }
    },
    send(recipient: string, message: string): Promise<void> {
      let line: string;
      try { line = whisperLine(recipient, message); } catch (error) { return Promise.reject(error); }
      return submit({ kind: "whisper", recipient, message }, line, enqueue,
        "Whispers are available with this tool enabled in a supported PvE area.",
        "Guild Wars is busy or the session changed. Your draft is kept.",
        "Guild Wars has not shown the outgoing whisper. Check original chat before trying again.");
    },
    /** Resolves once Guild Wars has taken the command; the game reports the result in chat. */
    invite(name: string): Promise<void> {
      let line: string;
      try { line = partyInviteLine(name); } catch (error) { return Promise.reject(error); }
      return submit({ kind: "invite", recipient: name, message: "" }, line, enqueueInvite,
        "Party invites need Whispers enabled in a supported PvE outpost.",
        "Guild Wars is busy or the session changed. The invite was not sent.",
        "Guild Wars has not taken the invite. Check chat before trying again.");
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
