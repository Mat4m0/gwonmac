/**
 * Renderer-side owner of the one certified local Xunlai action.
 * It initializes the fixed DataWindow payload and exposes one guarded command.
 */
import type { StorageCommand } from "../shared/storage-command.js";

const DATA_WINDOW_WORDS = 3;

/** Header-stripped StoC DataWindow payload: agent, type, data. */
export const STORAGE_DATA_WINDOW_BYTES =
  DATA_WINDOW_WORDS * Uint32Array.BYTES_PER_ELEMENT;

export type EnhancementStorageOpen = () => number;
export type EnhancementStorageConfigure = (
  payloadPointer: number,
  enabled: number,
) => number;

export function initializeStorageDataWindow(
  memory: WebAssembly.Memory,
  payloadPointer: number,
): void {
  new Uint32Array(memory.buffer, payloadPointer, DATA_WINDOW_WORDS).set([0, 0, 3]);
}

export function createStorageCommand(
  send: EnhancementStorageOpen,
  unavailable: () => string | null,
): StorageCommand {
  return Object.freeze({
    open() {
      const refusal = unavailable();
      if (refusal !== null) throw new Error(refusal);
      if (send() !== 1) throw new Error("Guild Wars command queue is busy");
    },
    unavailable,
  });
}
