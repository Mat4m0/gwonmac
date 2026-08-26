/**
 * Complete host boundary for the one named travel action. It accepts a typed
 * destination request and exposes availability; no generic UI message crosses.
 */
import type { TravelRequest } from "./travel.js";

export const TRAVEL_WAITING_REASONS = [
  "game", "loading", "memory", "writing", "snapshot", "corrupt", "cursor", "stale",
] as const;
export type TravelWaitingReason = (typeof TRAVEL_WAITING_REASONS)[number];
export type TravelGameState =
  | Readonly<{ status: "waiting"; reason: TravelWaitingReason }>
  | Readonly<{
    status: "ready";
    mapId: number;
    characterKey?: string | null;
    unlockedMapWords?: readonly number[] | null;
  }>;

export const TRAVEL_UNLOCK_WORDS = 28;

export function isTravelMapUnlocked(state: TravelGameState, mapId: number): boolean | null {
  if (state.status !== "ready" || state.unlockedMapWords == null) return null;
  if (!Number.isSafeInteger(mapId) || mapId < 0) return false;
  const word = state.unlockedMapWords[Math.floor(mapId / 32)];
  return word === undefined ? false : ((word >>> (mapId % 32)) & 1) === 1;
}

export function travelGameState(value: unknown): TravelGameState {
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    const input = value as Record<string, unknown>;
    if (input.status === "ready" && Number.isSafeInteger(input.mapId)) {
      const words = input.unlockedMapWords;
      const unlockedMapWords = Array.isArray(words)
        && words.length === TRAVEL_UNLOCK_WORDS
        && words.every((word) => Number.isSafeInteger(word) && word >= 0 && word <= 0xffff_ffff)
        ? Object.freeze(words.map(Number))
        : null;
      return Object.freeze({
        status: "ready",
        mapId: Number(input.mapId),
        characterKey: typeof input.characterKey === "string"
          && /^[0-9a-f]{16}$/u.test(input.characterKey)
          ? input.characterKey
          : null,
        unlockedMapWords,
      });
    }
    if (
      input.status === "waiting"
      && typeof input.reason === "string"
      && TRAVEL_WAITING_REASONS.includes(input.reason as TravelWaitingReason)
    ) return Object.freeze({ status: "waiting", reason: input.reason as TravelWaitingReason });
  }
  return Object.freeze({ status: "waiting", reason: "game" });
}

export type TravelCommand = Readonly<{
  travel(request: TravelRequest): void;
  unavailable(): string | null;
}>;
