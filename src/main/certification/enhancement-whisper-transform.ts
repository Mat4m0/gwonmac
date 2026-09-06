/**
 * Owns one bounded whisper mailbox on the existing game-thread command queue.
 * Enqueue snapshots the line; execution consumes it once and calls native chat.
 */
import { concat, sleb, uleb } from "../core/wasm-binary.js";
import { WHISPER_MAILBOX as M, WHISPER_LINE_UNITS, WHISPER_NAME_UNITS, WHISPER_MESSAGE_UNITS } from "../../shared/whispers.js";

const COMMAND = -7;
const op = (...bytes: number[]) => Uint8Array.of(...bytes);
const c = (n: number) => concat(op(0x41), sleb(n));
const g = (n: number) => concat(op(0x23), uleb(n));
const sg = (n: number) => concat(op(0x24), uleb(n));
const l = (n: number) => concat(op(0x20), uleb(n));
const sl = (n: number) => concat(op(0x21), uleb(n));
const load = (offset: number) => concat(op(0x28, 2), uleb(offset));
const store = (offset: number) => concat(op(0x36, 2), uleb(offset));
const refuse = concat(op(0x04, 0x40), c(0), op(0x0f, 0x0b));

export type WhisperGate = Readonly<{ hookGlobal: number; dispatchType: number }>;
function authorize(pointer: number, gate: WhisperGate, phase: number): Uint8Array {
  return concat(g(pointer), c(3), store(M.status),
    g(gate.hookGlobal), op(0x04, 0x40),
      c(5), g(pointer), c(phase), c(0), c(0), c(0),
      g(gate.hookGlobal), c(1), op(0x6b, 0x11), uleb(gate.dispatchType), uleb(0),
    op(0x0b));
}

export function whisperConfigure(pending: number, pointer: number, enabled: number): Uint8Array {
  return concat(uleb(0),
    // Disabling always cancels only this command, before the allocation is freed.
    c(0), sg(enabled),
    g(pending), c(COMMAND), op(0x46, 0x04, 0x40), c(0), sg(pending), op(0x0b),
    c(0), sg(pointer), l(1), op(0x45, 0x04, 0x40), c(1), op(0x0f, 0x0b),
    l(0), op(0x45), refuse, l(0), c(3), op(0x71), refuse,
    // Widen before adding: memory32 may cover all four GiB.
    l(0), op(0xad), concat(op(0x42), sleb(M.bytes)), op(0x7c),
    op(0x3f, 0, 0xad), concat(op(0x42), sleb(16)), op(0x86, 0x56), refuse,
    l(0), sg(pointer), c(1), sg(enabled), c(1), op(0x0b));
}

export function whisperEnqueue(pending: number, pointer: number, enabled: number, gate: WhisperGate): Uint8Array {
  // locals: length, index, unit, comma index (zero until encountered).
  return concat(uleb(1), uleb(4), op(0x7f),
    g(enabled), op(0x45), refuse, g(pending), refuse,
    authorize(pointer, gate, 0), g(pointer), load(M.status), c(4), op(0x47), refuse,
    g(pointer), load(M.length), sl(0),
    l(0), c(4), op(0x49), l(0), c(WHISPER_LINE_UNITS), op(0x4b, 0x72), refuse,
    g(pointer), op(0x2f, 1), uleb(M.source), c(34), op(0x47), refuse,
    c(1), sl(1), c(0), sl(3),
    op(0x02, 0x40, 0x03, 0x40),
      l(1), l(0), op(0x4f, 0x0d, 1),
      g(pointer), l(1), c(2), op(0x6c, 0x6a, 0x2f, 1), uleb(M.source), sl(2),
      l(2), c(32), op(0x49), l(2), c(127), op(0x46, 0x72), refuse,
      // UTF-16 pairs must remain complete at the native boundary as well.
      l(2), c(0xd800), op(0x4f), l(2), c(0xdbff), op(0x4d, 0x71, 0x04, 0x40),
        l(1), c(1), op(0x6a), l(0), op(0x4f), refuse,
        g(pointer), l(1), c(2), op(0x6c, 0x6a, 0x2f, 1), uleb(M.source + 2), c(0xfc00), op(0x71), c(0xdc00), op(0x47), refuse,
      op(0x0b),
      l(2), c(0xdc00), op(0x4f), l(2), c(0xdfff), op(0x4d, 0x71, 0x04, 0x40),
        g(pointer), l(1), c(2), op(0x6c, 0x6a, 0x2f, 1), uleb(M.source - 2), c(0xfc00), op(0x71), c(0xd800), op(0x47), refuse,
      op(0x0b),
      l(3), op(0x45, 0x04, 0x40),
        l(2), c(34), op(0x46), refuse,
        l(2), c(44), op(0x46, 0x04, 0x40), l(1), sl(3), op(0x0b),
      op(0x0b),
      l(1), c(1), op(0x6a), sl(1), op(0x0c, 0, 0x0b, 0x0b),
    l(3), c(2), op(0x49), l(3), c(WHISPER_NAME_UNITS + 1), op(0x4b, 0x72), refuse,
    l(0), l(3), op(0x6b), c(1), op(0x6b), sl(2),
    l(2), op(0x45), l(2), c(WHISPER_MESSAGE_UNITS), op(0x4b, 0x72), refuse,
    g(pointer), c(M.queued), op(0x6a), g(pointer), c(M.source), op(0x6a),
    l(0), c(2), op(0x6c, 0xfc, 10, 0, 0),
    g(pointer), l(0), c(2), op(0x6c, 0x6a), c(0), op(0x3b, 1), uleb(M.queued),
    g(pointer), c(1), store(M.status),
    c(COMMAND), sg(pending), c(1), op(0x0b));
}

export function whisperDrain(pending: number, pointer: number, enabled: number, sender: number, gate: WhisperGate): Uint8Array {
  return concat(g(pending), c(COMMAND), op(0x46, 0x04, 0x40),
    c(0), sg(pending), g(enabled), op(0x04, 0x40),
    authorize(pointer, gate, 1), g(pointer), load(M.status), c(4), op(0x47, 0x04, 0x40, 0x0f, 0x0b),
    g(pointer), c(2), store(M.status),
    g(pointer), c(M.queued), op(0x6a), c(0), op(0x10), uleb(sender),
    op(0x0b, 0x0f, 0x0b));
}
