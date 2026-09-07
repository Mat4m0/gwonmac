/**
 * Decodes the fixed companion whisper ring into validated renderer records;
 * it exposes no generic memory or UI-event reader.
 */
import { COMPANION_ABI } from "../shared/companion-abi.js";
import type { ObservedChatEvent } from "../shared/whispers.js";

export const COMPANION_WHISPER_ABI = COMPANION_ABI.whispers.abi;
export const COMPANION_WHISPER_BYTES = COMPANION_ABI.whispers.bytes;

const MAGIC = 0x4857_5747;
const HEADER_BYTES = 20;
const SLOT_COUNT = COMPANION_ABI.whispers.slots;
const SLOT_BYTES = 288;
const SENDER_UNITS = COMPANION_ABI.whispers.nameUnits;
const MESSAGE_UNITS = COMPANION_ABI.whispers.messageUnits;

function decodeUtf16(view: DataView, offset: number, units: number): string | null {
  const values: number[] = [];
  for (let index = 0; index < units; index += 1) {
    const value = view.getUint16(offset + index * 2, true);
    if (value === 0) return null;
    if (value >= 0xd800 && value <= 0xdbff) {
      if (index + 1 >= units) return null;
      const low = view.getUint16(offset + (index + 1) * 2, true);
      if (low < 0xdc00 || low > 0xdfff) return null;
      values.push(value, low);
      index += 1;
      continue;
    }
    if (value >= 0xdc00 && value <= 0xdfff) return null;
    values.push(value);
  }
  return String.fromCharCode(...values);
}

export function readCompanionWhispers(
  buffer: ArrayBuffer,
  pointer: number,
  previousWriteCount: number,
) {
  if (
    !(buffer instanceof ArrayBuffer)
    || !Number.isInteger(pointer)
    || pointer < 0
    || pointer + COMPANION_WHISPER_BYTES > buffer.byteLength
    || !Number.isInteger(previousWriteCount)
    || previousWriteCount < 0
  ) {
    return Object.freeze({ status: "waiting" as const, reason: "memory" as const });
  }
  const view = new DataView(buffer, pointer, COMPANION_WHISPER_BYTES);
  const firstSequence = view.getUint32(8, true);
  if ((firstSequence & 1) !== 0) {
    return Object.freeze({ status: "waiting" as const, reason: "writing" as const });
  }
  const writeCount = view.getUint32(12, true);
  const rejectedCount = view.getUint32(16, true);
  if (
    view.getUint32(0, true) !== MAGIC
    || view.getUint16(4, true) !== COMPANION_WHISPER_ABI
    || view.getUint16(6, true) !== COMPANION_WHISPER_BYTES
    || writeCount < previousWriteCount
  ) {
    return Object.freeze({ status: "waiting" as const, reason: "snapshot" as const });
  }
  const firstAvailable = Math.max(previousWriteCount + 1, writeCount - SLOT_COUNT + 1);
  const messages: ObservedChatEvent[] = [];
  for (let id = firstAvailable; id <= writeCount; id += 1) {
    const slot = HEADER_BYTES + ((id - 1) % SLOT_COUNT) * SLOT_BYTES;
    const units = view.getUint32(slot + 4, true);
    const senderUnits = units & 0xffff;
    const messageUnits = (units >>> 16) & 0x3fff;
    const participant = (units & 0x4000_0000) !== 0;
    const outgoing = (units & 0x8000_0000) !== 0;
    if (
      view.getUint32(slot, true) !== id
      || senderUnits < 1
      || senderUnits > SENDER_UNITS
      || (participant ? messageUnits !== 0 || outgoing : messageUnits < 1 || messageUnits > MESSAGE_UNITS)
    ) {
      return Object.freeze({ status: "waiting" as const, reason: "snapshot" as const });
    }
    const sender = decodeUtf16(view, slot + 8, senderUnits);
    if (sender === null) {
      return Object.freeze({ status: "waiting" as const, reason: "snapshot" as const });
    }
    if (participant) {
      messages.push(Object.freeze({ id, sender, direction: "participant" }));
      continue;
    }
    const message = decodeUtf16(view, slot + 8 + SENDER_UNITS * 2, messageUnits);
    if (message === null) {
      return Object.freeze({ status: "waiting" as const, reason: "snapshot" as const });
    }
    messages.push(Object.freeze({ id, sender, message, direction: outgoing ? "outgoing" : "incoming" }));
  }
  const secondSequence = view.getUint32(8, true);
  if (firstSequence !== secondSequence || (secondSequence & 1) !== 0) {
    return Object.freeze({ status: "waiting" as const, reason: "writing" as const });
  }
  return Object.freeze({
    status: "ready" as const,
    sequence: secondSequence,
    writeCount,
    rejectedCount,
    dropped: Math.max(0, writeCount - previousWriteCount - SLOT_COUNT),
    messages: Object.freeze(messages),
  });
}

export type CompanionWhisperState = ReturnType<typeof readCompanionWhispers>;
