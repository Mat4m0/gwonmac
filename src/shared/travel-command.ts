/**
 * Complete host boundary for the one named travel action. It accepts a typed
 * destination request and exposes availability; no generic UI message crosses.
 */
import type { TravelRequest } from "./travel.js";
import {
  isTravelDestinationInContext,
  type TravelContext,
} from "./travel-destinations.js";
import {
  isTravelCharacterKey,
  type TravelCharacterKey,
} from "./travel-history.js";

export const TRAVEL_WAITING_REASONS = [
  "game", "loading", "memory", "writing", "snapshot", "corrupt", "cursor", "stale",
] as const;
export type TravelWaitingReason = (typeof TRAVEL_WAITING_REASONS)[number];
export type TravelGameState =
  | Readonly<{ status: "waiting"; reason: TravelWaitingReason }>
  | Readonly<{
    status: "ready";
    mapId: number;
    travelContext: TravelContext;
    characterKey: TravelCharacterKey | null;
    unlockedMapWords: readonly number[] | null;
    guildHall: boolean;
    hasGuildHall: boolean;
  }>;

export const TRAVEL_UNLOCK_WORDS = 28;

export type TravelDestinationAvailability =
  | "available"
  | "locked"
  | "outside-context"
  | "unknown";

export function isTravelMapUnlocked(state: TravelGameState, mapId: number): boolean | null {
  if (state.status !== "ready" || state.unlockedMapWords == null) return null;
  if (!Number.isSafeInteger(mapId) || mapId < 0) return false;
  const word = state.unlockedMapWords[Math.floor(mapId / 32)];
  return word === undefined ? false : ((word >>> (mapId % 32)) & 1) === 1;
}

export function travelDestinationAvailability(
  state: TravelGameState,
  mapId: number,
): TravelDestinationAvailability {
  if (state.status !== "ready") return "unknown";
  if (!isTravelDestinationInContext(state.travelContext, mapId)) return "outside-context";
  const unlocked = isTravelMapUnlocked(state, mapId);
  return unlocked === null ? "unknown" : unlocked ? "available" : "locked";
}

export function travelContextRefusal(
  state: TravelGameState,
  mapId: number,
): string | null {
  if (travelDestinationAvailability(state, mapId) !== "outside-context") return null;
  return state.status === "ready" && state.travelContext === "pre-searing"
    ? "Only Pre-Searing destinations are available to this character."
    : "Pre-Searing destinations are unavailable after the Searing.";
}

export function travelGameState(value: unknown): TravelGameState {
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    const input = value as Record<string, unknown>;
    if (
      input.status === "ready"
      && Number.isSafeInteger(input.mapId)
      && (input.travelContext === "pre-searing" || input.travelContext === "world")
    ) {
      const words = input.unlockedMapWords;
      const unlockedMapWords = Array.isArray(words)
        && words.length === TRAVEL_UNLOCK_WORDS
        && words.every((word) => Number.isSafeInteger(word) && word >= 0 && word <= 0xffff_ffff)
        ? Object.freeze(words.map(Number))
        : null;
      return Object.freeze({
        status: "ready",
        mapId: Number(input.mapId),
        travelContext: input.travelContext,
        characterKey: isTravelCharacterKey(input.characterKey) ? input.characterKey : null,
        unlockedMapWords,
        guildHall: input.guildHall === true,
        hasGuildHall: input.hasGuildHall === true,
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
  guildHall(): void;
  guildHallUnavailable(): string | null;
  unavailable(): string | null;
}>;
