/**
 * Decodes the optional Tools cooldown region published by the kernel.
 * Core interface geometry deliberately lives in its own dependency graph.
 */
import { COMPANION_ABI } from "../shared/companion-abi.js";
import { MAX_SKILL_COOLDOWN_MS } from "../shared/skill-cooldowns.js";

export const COMPANION_SKILL_COOLDOWN_ABI = COMPANION_ABI.skillCooldowns.abi;
export const COMPANION_SKILL_COOLDOWN_BYTES = COMPANION_ABI.skillCooldowns.bytes;

const SKILL_COOLDOWN_MAGIC = 0x53435747;
const SKILL_COOLDOWN_FLAGS = Object.freeze({ ready: 1, loading: 2 });

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
      timestamp !== 0 && (timestamp - gameTimer) >>> 0 > MAX_SKILL_COOLDOWN_MS)
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
