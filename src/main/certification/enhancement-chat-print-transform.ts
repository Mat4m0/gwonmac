/**
 * Owns one bounded local chat-line mailbox on the game-thread command queue.
 * Enqueue accepts only printable ASCII and wraps it as a literal encoded
 * string. The drain prints it through the certified chat-log producer, which
 * adds the line to this player's own chat log and sends no packet.
 */
import { concat, sleb, uleb } from "../core/wasm-binary.js";
import { CHAT_PRINT_MAILBOX as M, CHAT_PRINT_STATUS, CHAT_PRINT_UNITS } from "../../shared/chat-print.js";
import { mailboxConfigure } from "./enhancement-whisper-transform.js";

const COMMAND = -8;
// The game's own notices use this chat channel. Confirmed only by reading its
// callers, so the live Developer Build check must confirm the colour.
export const CHAT_PRINT_CHANNEL = 10;
// Encoded-string markers: a literal string starts with 0x108 0x107 and ends with 0x1.
const LITERAL_START = [0x108, 0x107] as const;
const LITERAL_END = 0x1;
const op = (...bytes: number[]) => Uint8Array.of(...bytes);
const c = (n: number) => concat(op(0x41), sleb(n));
const g = (n: number) => concat(op(0x23), uleb(n));
const sg = (n: number) => concat(op(0x24), uleb(n));
const l = (n: number) => concat(op(0x20), uleb(n));
const sl = (n: number) => concat(op(0x21), uleb(n));
const load = (offset: number) => concat(op(0x28, 2), uleb(offset));
const store = (offset: number) => concat(op(0x36, 2), uleb(offset));
const load16 = (offset: number) => concat(op(0x2f, 1), uleb(offset));
const store16 = (offset: number) => concat(op(0x3b, 1), uleb(offset));
const refuse = concat(op(0x04, 0x40), c(0), op(0x0f, 0x0b));

export function chatPrintConfigure(pending: number, pointer: number, enabled: number): Uint8Array {
  return mailboxConfigure(COMMAND, M.bytes, pending, pointer, enabled);
}

export function chatPrintEnqueue(pending: number, pointer: number, enabled: number): Uint8Array {
  // locals: length, index, unit.
  const unitAddress = concat(g(pointer), l(1), c(2), op(0x6c, 0x6a));
  return concat(uleb(1), uleb(3), op(0x7f),
    g(enabled), op(0x45), refuse, g(pending), refuse,
    g(pointer), load(M.length), sl(0),
    l(0), op(0x45), l(0), c(CHAT_PRINT_UNITS), op(0x4b, 0x72), refuse,
    c(0), sl(1),
    op(0x02, 0x40, 0x03, 0x40),
      l(1), l(0), op(0x4f, 0x0d, 1),
      unitAddress, load16(M.source), sl(2),
      // Printable ASCII without `<` and `>`, which would open game markup.
      l(2), c(32), op(0x49), l(2), c(126), op(0x4b, 0x72), refuse,
      l(2), c(60), op(0x46), l(2), c(62), op(0x46, 0x72), refuse,
      unitAddress, l(2), store16(M.queued + 4),
      l(1), c(1), op(0x6a), sl(1), op(0x0c, 0, 0x0b, 0x0b),
    g(pointer), c(LITERAL_START[0]), store16(M.queued),
    g(pointer), c(LITERAL_START[1]), store16(M.queued + 2),
    g(pointer), l(0), c(2), op(0x6c, 0x6a), c(LITERAL_END), store16(M.queued + 4),
    g(pointer), l(0), c(2), op(0x6c, 0x6a), c(0), store16(M.queued + 6),
    g(pointer), c(CHAT_PRINT_STATUS.queued), store(M.status),
    c(COMMAND), sg(pending), c(1), op(0x0b));
}

/** The game's own validator runs first: the producer asserts on a line it rejects. */
export function chatPrintDrain(pending: number, pointer: number, enabled: number,
  native: Readonly<{ validator: number; producer: number }>): Uint8Array {
  return concat(g(pending), c(COMMAND), op(0x46, 0x04, 0x40),
    c(0), sg(pending), g(enabled), op(0x04, 0x40),
      g(pointer), c(CHAT_PRINT_STATUS.printed), store(M.status),
      g(pointer), c(M.queued), op(0x6a), op(0x10), uleb(native.validator), op(0x04, 0x40),
        c(CHAT_PRINT_CHANNEL), g(pointer), c(M.queued), op(0x6a), op(0x10), uleb(native.producer),
      op(0x0b),
    op(0x0b, 0x0f, 0x0b));
}
