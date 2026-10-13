/**
 * Owns one generation's private chat-print mailbox and a short line queue.
 * Lines go one at a time to the game thread, which prints them in this
 * player's own chat log only. No IPC, storage or network path is involved.
 */
import { CHAT_PRINT_MAILBOX as M, CHAT_PRINT_STATUS, isChatPrintText } from "../shared/chat-print.js";

// Reminders arrive in small bursts; a longer backlog means the game stopped draining.
const QUEUE_LIMIT = 8;

export function createChatPrintInstallation(exports: WebAssembly.Exports, available: boolean) {
  const configure = available ? exports.enhancement_configure_chat_print : null;
  const enqueue = available ? exports.enhancement_print_chat : null;
  if (available && (typeof configure !== "function" || typeof enqueue !== "function")) {
    throw new Error("Certified chat print exports are unavailable.");
  }
  let pointer = 0;
  let memory: WebAssembly.Memory | null = null;
  let enabled = false;
  let disposed = false;
  let inFlight = false;
  const queue: string[] = [];
  return {
    get enabled() { return enabled; },
    get region() { return pointer === 0 ? null : { name: "chat-print", pointer, size: M.bytes, align: 4 as const }; },
    allocate(malloc: (bytes: number) => unknown) {
      if (!available) return;
      pointer = Number(malloc(M.bytes));
      if (!Number.isInteger(pointer) || pointer <= 0 || pointer % 4 !== 0) {
        throw new Error("Chat print memory allocation failed.");
      }
    },
    initialize(value: WebAssembly.Memory) { memory = value; },
    setEnabled(next: boolean) {
      next = available && next && !disposed && pointer !== 0;
      if (next === enabled || typeof configure !== "function") return;
      if (configure(next ? pointer : 0, next ? 1 : 0) !== 1) throw new Error("Chat print configuration was refused.");
      enabled = next;
      if (!next) { queue.length = 0; inFlight = false; }
    },
    /** Queues one line; returns false when it is not printable or chat print is off. */
    print(text: string): boolean {
      if (!enabled || !isChatPrintText(text)) return false;
      if (queue.length >= QUEUE_LIMIT) queue.shift();
      queue.push(text);
      return true;
    },
    /** Hands at most one line per frame to the game thread. */
    poll() {
      if (!enabled || memory === null || typeof enqueue !== "function") return;
      const view = new DataView(memory.buffer);
      if (inFlight && view.getUint32(pointer + M.status, true) !== CHAT_PRINT_STATUS.printed) return;
      inFlight = false;
      const text = queue[0];
      if (text === undefined) return;
      view.setUint32(pointer + M.length, text.length, true);
      for (let i = 0; i < text.length; i++) view.setUint16(pointer + M.source + i * 2, text.charCodeAt(i), true);
      // Another command may hold the shared game-thread slot; try again next frame.
      if (enqueue() !== 1) return;
      queue.shift();
      inFlight = true;
    },
    dispose(free: (pointer: number) => void) {
      if (disposed) return;
      if (typeof configure === "function") configure(0, 0);
      enabled = false; disposed = true; queue.length = 0;
      if (pointer !== 0) {
        if (memory !== null) new Uint8Array(memory.buffer, pointer, M.bytes).fill(0);
        free(pointer); pointer = 0;
      }
      memory = null;
    },
  };
}
export type ChatPrintInstallation = ReturnType<typeof createChatPrintInstallation>;
