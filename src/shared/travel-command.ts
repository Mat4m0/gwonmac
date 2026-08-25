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
  | Readonly<{ status: "ready"; mapId: number }>;

export function travelGameState(value: unknown): TravelGameState {
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    const input = value as Record<string, unknown>;
    if (input.status === "ready" && Number.isSafeInteger(input.mapId)) {
      return Object.freeze({ status: "ready", mapId: Number(input.mapId) });
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
