/**
 * Defines the one shared scratch-memory layout for native move payloads and
 * in-flight destination claims.
 */
export const QUICK_ITEM_MOVE_PAYLOAD_BYTES = 28;
export const QUICK_ITEM_MOVE_RESERVATION_OFFSET = QUICK_ITEM_MOVE_PAYLOAD_BYTES;
export const QUICK_ITEM_MOVE_RESERVATION_COUNT = 64;
export const QUICK_ITEM_MOVE_SCRATCH_BYTES = QUICK_ITEM_MOVE_RESERVATION_OFFSET
  + QUICK_ITEM_MOVE_RESERVATION_COUNT * Uint32Array.BYTES_PER_ELEMENT;
