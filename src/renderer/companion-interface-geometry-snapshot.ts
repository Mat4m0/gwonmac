/**
 * Decodes the Core-owned interface-frame region. The kernel publishes skill
 * slots and the chat input together because both come from the same certified
 * Guild Wars frame table; consumers may use either projection independently.
 */
import {
  COMPANION_ABI,
  SKILL_GEOMETRY_NATIVE_REASONS,
} from "../shared/companion-abi.js";

export const COMPANION_SKILL_SLOT_ABI = COMPANION_ABI.skillSlots.abi;
export const COMPANION_SKILL_SLOT_BYTES = COMPANION_ABI.skillSlots.bytes;

const SKILL_SLOT_MAGIC = 0x534b5747;
const SKILL_SLOT_READY = 1;
const CHAT_INPUT_READY = 1 << 1;

/** Decode the bounded frame projection; presentation remains app-owned. */
export function readCompanionSkillSlots(buffer: ArrayBuffer, pointer: number) {
  if (
    !(buffer instanceof ArrayBuffer)
    || !Number.isInteger(pointer)
    || pointer < 0
    || pointer + COMPANION_SKILL_SLOT_BYTES > buffer.byteLength
  ) return Object.freeze({ status: "waiting", reason: "memory" } as const);
  const view = new DataView(buffer, pointer, COMPANION_SKILL_SLOT_BYTES);
  const firstSequence = view.getUint32(8, true);
  if ((firstSequence & 1) !== 0) {
    return Object.freeze({ status: "waiting", reason: "writing" } as const);
  }
  const magic = view.getUint32(0, true);
  const abi = view.getUint16(4, true);
  const bytes = view.getUint16(6, true);
  const flags = view.getUint32(12, true);
  const frameId = view.getUint32(16, true);
  const outcome = view.getUint32(20, true);
  const candidateCount = view.getUint32(24, true);
  const viewportWidth = view.getFloat32(28, true);
  const viewportHeight = view.getFloat32(32, true);
  const slots = Object.freeze(Array.from({ length: 8 }, (_, index) => {
    const at = 36 + index * 16;
    return Object.freeze({
      left: view.getFloat32(at, true),
      bottom: view.getFloat32(at + 4, true),
      right: view.getFloat32(at + 8, true),
      top: view.getFloat32(at + 12, true),
    });
  }));
  const chatFrameId = view.getUint32(164, true);
  const chatOutcome = view.getUint32(168, true);
  const chatInput = Object.freeze({
    left: view.getFloat32(172, true),
    bottom: view.getFloat32(176, true),
    right: view.getFloat32(180, true),
    top: view.getFloat32(184, true),
  });
  const secondSequence = view.getUint32(8, true);
  if (
    magic !== SKILL_SLOT_MAGIC
    || abi !== COMPANION_SKILL_SLOT_ABI
    || bytes !== COMPANION_SKILL_SLOT_BYTES
    || firstSequence !== secondSequence
    || (secondSequence & 1) !== 0
    || (flags & ~(SKILL_SLOT_READY | CHAT_INPUT_READY)) !== 0
  ) return Object.freeze({ status: "waiting", reason: "snapshot" } as const);
  if ((flags & (SKILL_SLOT_READY | CHAT_INPUT_READY)) === 0) {
    const reason = SKILL_GEOMETRY_NATIVE_REASONS[
      outcome as keyof typeof SKILL_GEOMETRY_NATIVE_REASONS
    ];
    if (
      reason === undefined
      || (reason === "slot-ambiguous"
        ? candidateCount < 2 || candidateCount > 16_384
        : candidateCount !== 0)
    ) {
      return Object.freeze({ status: "waiting", reason: "snapshot" } as const);
    }
    return reason === "slot-ambiguous"
      ? Object.freeze({ status: "waiting" as const, reason, candidateCount })
      : Object.freeze({ status: "waiting" as const, reason });
  }
  const finite = (value: number) => Number.isFinite(value) && Math.abs(value) <= 32_768;
  const validRect = (
    { left, bottom, right, top }: typeof chatInput,
    width: number,
    height: number,
  ) =>
    [left, bottom, right, top].every(finite)
    && right > left && top > bottom
    && right > 0 && top > 0
    && left < width && bottom < height;
  const skillReady = (flags & SKILL_SLOT_READY) !== 0;
  const chatReady = (flags & CHAT_INPUT_READY) !== 0;
  const validRefusal = (value: number, candidates: number) => {
    const reason = SKILL_GEOMETRY_NATIVE_REASONS[
      value as keyof typeof SKILL_GEOMETRY_NATIVE_REASONS
    ];
    return reason !== undefined && (reason === "slot-ambiguous"
      ? candidates >= 2 && candidates <= 16_384
      : candidates === 0);
  };
  if (
    !skillReady
    || outcome !== 0
    || frameId === 0
    || candidateCount !== 0
    || !finite(viewportWidth)
    || !finite(viewportHeight)
    || viewportWidth <= 0
    || viewportHeight <= 0
    || slots.some((slot) => !validRect(slot, viewportWidth, viewportHeight))
    || (chatReady
      ? chatOutcome !== 0 || chatFrameId === 0
        || !validRect(chatInput, viewportWidth, viewportHeight)
      : !validRefusal(chatOutcome, 0)
        || chatFrameId !== 0
        || Object.values(chatInput).some((value) => value !== 0))
  ) return Object.freeze({ status: "waiting", reason: "corrupt" } as const);
  return Object.freeze({
    status: "ready" as const,
    sequence: secondSequence,
    frameId,
    chatFrameId,
    viewportWidth,
    viewportHeight,
    slots,
    chatInput: chatReady ? chatInput : null,
  });
}

export type CompanionSkillSlotState =
  | ReturnType<typeof readCompanionSkillSlots>
  | Readonly<{ status: "waiting"; reason: "stale" }>;

/** Ignore heartbeat-only sequence changes while preserving moved-frame updates. */
export function sameCompanionSkillSlotGeometry(
  previous: CompanionSkillSlotState,
  next: CompanionSkillSlotState,
): boolean {
  if (previous.status !== "ready" || next.status !== "ready") return false;
  type Rect = Readonly<{ left: number; bottom: number; right: number; top: number }>;
  const sameRect = (left: Rect | null, right: Rect | null) => left === null
    ? right === null
    : right !== null
      && left.left === right.left
      && left.bottom === right.bottom
      && left.right === right.right
      && left.top === right.top;
  const sameSlots = previous.slots.every((slot, index) => {
    const candidate = next.slots[index];
    return candidate !== undefined
      && slot.left === candidate.left
      && slot.bottom === candidate.bottom
      && slot.right === candidate.right
      && slot.top === candidate.top;
  });
  return previous.frameId === next.frameId
    && previous.viewportWidth === next.viewportWidth
    && previous.viewportHeight === next.viewportHeight
    && previous.chatFrameId === next.chatFrameId
    && sameRect(previous.chatInput, next.chatInput)
    && sameSlots;
}
