/**
 * Decodes the bounded skill-slot records published by the companion kernel.
 * Skill geometry is independent from key labels so every skill-bar
 * presentation can consume the same certified, fail-closed projection.
 */
import { COMPANION_ABI } from "../shared/companion-abi.js";

export const COMPANION_SKILL_SLOT_ABI = COMPANION_ABI.skillSlots.abi;
export const COMPANION_SKILL_SLOT_BYTES = COMPANION_ABI.skillSlots.bytes;

const SKILL_SLOT_MAGIC = 0x534b5747;
const SKILL_SLOT_READY = 1;

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
  const viewportWidth = view.getFloat32(20, true);
  const viewportHeight = view.getFloat32(24, true);
  const slots = Object.freeze(Array.from({ length: 8 }, (_, index) => {
    const at = 28 + index * 16;
    return Object.freeze({
      left: view.getFloat32(at, true),
      bottom: view.getFloat32(at + 4, true),
      right: view.getFloat32(at + 8, true),
      top: view.getFloat32(at + 12, true),
    });
  }));
  const secondSequence = view.getUint32(8, true);
  if (
    magic !== SKILL_SLOT_MAGIC
    || abi !== COMPANION_SKILL_SLOT_ABI
    || bytes !== COMPANION_SKILL_SLOT_BYTES
    || firstSequence !== secondSequence
    || (secondSequence & 1) !== 0
    || (flags & ~SKILL_SLOT_READY) !== 0
  ) return Object.freeze({ status: "waiting", reason: "snapshot" } as const);
  if ((flags & SKILL_SLOT_READY) === 0) {
    return Object.freeze({ status: "waiting", reason: "frame" } as const);
  }
  const finite = (value: number) => Number.isFinite(value) && Math.abs(value) <= 32_768;
  if (
    frameId === 0
    || !finite(viewportWidth)
    || !finite(viewportHeight)
    || viewportWidth <= 0
    || viewportHeight <= 0
    || slots.some(({ left, bottom, right, top }) =>
      ![left, bottom, right, top].every(finite)
      || left < 0 || bottom < 0 || right <= left || top <= bottom
      || right > viewportWidth || top > viewportHeight)
  ) return Object.freeze({ status: "waiting", reason: "corrupt" } as const);
  return Object.freeze({
    status: "ready" as const,
    sequence: secondSequence,
    frameId,
    viewportWidth,
    viewportHeight,
    slots,
  });
}

export type CompanionSkillSlotState =
  | ReturnType<typeof readCompanionSkillSlots>
  | Readonly<{ status: "waiting"; reason: "stale" }>;

export const COMPANION_SKILL_COOLDOWN_ABI = COMPANION_ABI.skillCooldowns.abi;
export const COMPANION_SKILL_COOLDOWN_BYTES = COMPANION_ABI.skillCooldowns.bytes;

const SKILL_COOLDOWN_MAGIC = 0x53435747;
const SKILL_COOLDOWN_FLAGS = Object.freeze({ ready: 1, loading: 2 });
const MAX_SKILL_RECHARGE_MS = 1_800_000;

/** Decode one all-or-nothing player recharge publication. */
export function readCompanionSkillCooldowns(buffer: ArrayBuffer, pointer: number) {
  if (
    !(buffer instanceof ArrayBuffer)
    || !Number.isInteger(pointer)
    || pointer < 0
    || pointer + COMPANION_SKILL_COOLDOWN_BYTES > buffer.byteLength
  ) return Object.freeze({ status: "waiting", reason: "memory" } as const);
  const view = new DataView(buffer, pointer, COMPANION_SKILL_COOLDOWN_BYTES);
  const firstSequence = view.getUint32(8, true);
  if ((firstSequence & 1) !== 0) {
    return Object.freeze({ status: "waiting", reason: "writing" } as const);
  }
  const magic = view.getUint32(0, true);
  const abi = view.getUint16(4, true);
  const bytes = view.getUint16(6, true);
  const flags = view.getUint32(12, true);
  const generation = view.getUint32(16, true);
  const gameTimer = view.getUint32(20, true);
  const playerAgentId = view.getUint32(24, true);
  const rechargeTimestamps = Object.freeze(Array.from(
    { length: 8 },
    (_, index) => view.getUint32(28 + index * 4, true),
  ));
  const secondSequence = view.getUint32(8, true);
  if (
    magic !== SKILL_COOLDOWN_MAGIC
    || abi !== COMPANION_SKILL_COOLDOWN_ABI
    || bytes !== COMPANION_SKILL_COOLDOWN_BYTES
    || firstSequence !== secondSequence
    || (secondSequence & 1) !== 0
    || (flags & ~(SKILL_COOLDOWN_FLAGS.ready | SKILL_COOLDOWN_FLAGS.loading)) !== 0
    || flags === (SKILL_COOLDOWN_FLAGS.ready | SKILL_COOLDOWN_FLAGS.loading)
  ) return Object.freeze({ status: "waiting", reason: "snapshot" } as const);
  if ((flags & SKILL_COOLDOWN_FLAGS.loading) !== 0) {
    if (gameTimer !== 0 || playerAgentId !== 0 || rechargeTimestamps.some(Boolean)) {
      return Object.freeze({ status: "waiting", reason: "corrupt" } as const);
    }
    return Object.freeze({ status: "waiting", reason: "loading" } as const);
  }
  if ((flags & SKILL_COOLDOWN_FLAGS.ready) === 0) {
    if (gameTimer !== 0 || playerAgentId !== 0 || rechargeTimestamps.some(Boolean)) {
      return Object.freeze({ status: "waiting", reason: "corrupt" } as const);
    }
    return Object.freeze({ status: "waiting", reason: "game" } as const);
  }
  if (
    playerAgentId === 0
    || rechargeTimestamps.some((timestamp) =>
      timestamp !== 0 && (timestamp - gameTimer) >>> 0 > MAX_SKILL_RECHARGE_MS)
  ) return Object.freeze({ status: "waiting", reason: "corrupt" } as const);
  return Object.freeze({
    status: "ready" as const,
    sequence: secondSequence,
    generation,
    gameTimer,
    playerAgentId,
    rechargeTimestamps,
  });
}

export type CompanionSkillCooldownState =
  | ReturnType<typeof readCompanionSkillCooldowns>
  | Readonly<{ status: "waiting"; reason: "stale" }>;
