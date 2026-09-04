/**
 * Owns strict decoding and timer projection for the bounded controlled-player effect region.
 * It publishes no pointers and rejects incomplete or inconsistent snapshots.
 */
import { COMPANION_ABI } from "../shared/companion-abi.js";

export const COMPANION_PLAYER_EFFECT_BYTES = COMPANION_ABI.playerEffects.bytes;
const EFFECT_MAGIC = 0x46455747;
const READY = 1;
const LOADING = 2;
const MAX_EFFECTS = 64;
const MAX_DURATION_MS = 2_592_000_000;

export function readCompanionPlayerEffects(buffer: ArrayBuffer, pointer: number) {
  if (!(buffer instanceof ArrayBuffer) || !Number.isInteger(pointer) || pointer < 0
    || pointer + COMPANION_PLAYER_EFFECT_BYTES > buffer.byteLength) {
    return Object.freeze({ status: "waiting", reason: "memory" } as const);
  }
  const view = new DataView(buffer, pointer, COMPANION_PLAYER_EFFECT_BYTES);
  const first = view.getUint32(8, true);
  if (first & 1) return Object.freeze({ status: "waiting", reason: "writing" } as const);
  const magic = view.getUint32(0, true);
  const abi = view.getUint16(4, true);
  const bytes = view.getUint16(6, true);
  const flags = view.getUint32(12, true);
  const generation = view.getUint32(16, true);
  const gameTimer = view.getUint32(20, true);
  const count = view.getUint32(24, true);
  const playerAgentId = view.getUint32(28, true);
  const outcome = view.getUint32(32, true);
  if (count > MAX_EFFECTS) return Object.freeze({ status: "waiting", reason: "corrupt" } as const);
  const effects = Object.freeze(Array.from({ length: count }, (_, index) => {
    const at = 36 + index * 24;
    return Object.freeze({
      effectId: view.getUint32(at, true),
      skillId: view.getUint32(at + 4, true),
      attributeLevel: view.getUint32(at + 8, true),
      maintainerAgentId: view.getUint32(at + 12, true),
      durationMs: view.getUint32(at + 16, true),
      appliedAtGameMs: view.getUint32(at + 20, true),
    });
  }));
  const second = view.getUint32(8, true);
  if (magic !== EFFECT_MAGIC || abi !== COMPANION_ABI.playerEffects.abi
    || bytes !== COMPANION_PLAYER_EFFECT_BYTES || first !== second || second & 1
    || flags & ~(READY | LOADING) || flags === (READY | LOADING)) {
    return Object.freeze({ status: "waiting", reason: "snapshot" } as const);
  }
  if (flags & LOADING) {
    return count === 0 && playerAgentId === 0 && outcome === 0
      ? Object.freeze({ status: "waiting", reason: "loading" } as const)
      : Object.freeze({ status: "waiting", reason: "corrupt" } as const);
  }
  if (!(flags & READY)) {
    if (count !== 0 || playerAgentId !== 0) {
      return Object.freeze({ status: "waiting", reason: "corrupt" } as const);
    }
    const outcomeCode = outcome & 0xff;
    const reason = ({
          1: "game-state",
          2: "policy-layout",
          3: "player-agent",
          4: "context-table",
          5: "world-context",
          6: "outer-header",
          7: "outer-array",
          8: "player-row",
          9: "effects-header",
          10: "overflow",
          11: "effect-record",
          12: "inactive",
        } as const)[outcomeCode as 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12];
    if (reason === "inactive") return Object.freeze({
      status: "waiting" as const,
      reason,
      activeFeatures: outcome >>> 8,
    });
    return reason
      ? Object.freeze({ status: "waiting" as const, reason })
      : Object.freeze({ status: "waiting" as const, reason: "unreconciled" as const,
          sequence: second, generation, gameTimer, outcome });
  }
  if (outcome !== 0 || playerAgentId === 0 || effects.some((effect) => effect.effectId === 0
    || effect.skillId === 0 || effect.attributeLevel > 30
    || effect.durationMs > MAX_DURATION_MS)) {
    return Object.freeze({ status: "waiting", reason: "corrupt" } as const);
  }
  return Object.freeze({ status: "ready" as const, sequence: second, generation,
    gameTimer, playerAgentId, effects });
}

export type CompanionPlayerEffectState = ReturnType<typeof readCompanionPlayerEffects>
  | Readonly<{ status: "waiting"; reason: "stale" | "inactive"; activeFeatures?: number }>;

export function remainingEffectMs(gameTimer: number, appliedAt: number, durationMs: number): number | null {
  if (durationMs === 0) return null;
  const elapsed = (gameTimer - appliedAt) >>> 0;
  return elapsed >= durationMs ? 0 : durationMs - elapsed;
}

export function formatEffectTimer(remainingMs: number): string {
  if (remainingMs > 99_000) return `${Math.ceil(remainingMs / 60_000)}m`;
  if (remainingMs >= 3_000) return String(Math.ceil(remainingMs / 1_000));
  return (Math.ceil(remainingMs / 100) / 10).toFixed(1);
}
