/**
 * Defines the one shared scratch-memory layout for native move payloads and
 * in-flight destination claims.
 */
export const QUICK_ITEM_MOVE_PAYLOAD_BYTES = 28;
export const QUICK_ITEM_MOVE_PROMPT = Object.freeze({
  item: QUICK_ITEM_MOVE_PAYLOAD_BYTES,
  sourceKey: QUICK_ITEM_MOVE_PAYLOAD_BYTES + 4,
  quantity: QUICK_ITEM_MOVE_PAYLOAD_BYTES + 8,
  direction: QUICK_ITEM_MOVE_PAYLOAD_BYTES + 12,
});
export const QUICK_ITEM_MOVE_RESERVATION_OFFSET = QUICK_ITEM_MOVE_PROMPT.direction + 4;
export const QUICK_ITEM_MOVE_RESERVATION_COUNT = 64;
// Each claim tracks the expected endpoints of one pending native move.
export const QUICK_ITEM_MOVE_RESERVATION = Object.freeze({
  source: 0, remaining: 4, destination: 8, expected: 12, started: 16, sourceKey: 20,
});
export const QUICK_ITEM_MOVE_RESERVATION_BYTES = QUICK_ITEM_MOVE_RESERVATION.sourceKey + 4;
export const QUICK_ITEM_MOVE_SCRATCH_BYTES = QUICK_ITEM_MOVE_RESERVATION_OFFSET
  + QUICK_ITEM_MOVE_RESERVATION_COUNT * QUICK_ITEM_MOVE_RESERVATION_BYTES;
