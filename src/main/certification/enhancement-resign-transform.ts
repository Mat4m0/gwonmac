/**
 * Owns the argument-free Resign mailbox and fixed UTF-16 native chat call.
 * Text lives only on the game stack; the renderer cannot supply a command.
 */
import { concat, sleb, uleb } from "../core/wasm-binary.js";

const RESIGN_COMMAND = -6;
const op = (...bytes: number[]) => Uint8Array.of(...bytes);
const constant = (value: number) => concat(op(0x41), sleb(value));
const get = (index: number) => concat(op(0x23), uleb(index));
const set = (index: number) => concat(op(0x24), uleb(index));

export function resignConfigure(pending: number, enabled: number): Uint8Array {
  return concat(uleb(0), op(0x20, 0, 0x45, 0x45), set(enabled),
    get(enabled), op(0x45, 0x04, 0x40),
    get(pending), constant(RESIGN_COMMAND), op(0x46, 0x04, 0x40),
    constant(0), set(pending), op(0x0b, 0x0b), constant(1), op(0x0b));
}

export function resignEnqueue(pending: number, enabled: number): Uint8Array {
  return concat(uleb(0), get(enabled), op(0x45), get(pending), op(0x45, 0x45, 0x72, 0x04, 0x40),
    constant(0), op(0x0f, 0x0b), constant(RESIGN_COMMAND), set(pending), constant(1), op(0x0b));
}

export function resignExecute(sender: number): Uint8Array {
  const units = [0x002f, 0x0072, 0x0065, 0x0073, 0x0069, 0x0067, 0x006e, 0];
  return concat(uleb(1), uleb(1), op(0x7f),
    // The certified native sender and editor use the same stack global zero.
    get(0), constant(16), op(0x6b, 0x22, 0), set(0),
    ...[0, 2, 4, 6].map((i) => concat(op(0x20, 0),
      constant(units[i]! | (units[i + 1]! << 16)), op(0x36, 2), uleb(i * 2))),
    op(0x20, 0), constant(0), op(0x10), uleb(sender),
    op(0x20, 0), constant(16), op(0x6a), set(0), op(0x0b));
}

export function resignDrain(pending: number, enabled: number, execute: number): Uint8Array {
  return concat(get(pending), constant(RESIGN_COMMAND), op(0x46, 0x04, 0x40),
    constant(0), set(pending), get(enabled), op(0x04, 0x40, 0x10), uleb(execute),
    op(0x0b, 0x0f, 0x0b));
}
