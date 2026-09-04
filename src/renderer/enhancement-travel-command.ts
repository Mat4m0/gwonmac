/**
 * Renderer-side adapter for the certified map-only travel export.
 * The game-thread transform derives live region/language and uses district Any.
 */
import type { TravelCommand } from "../shared/travel-command.js";
import type { TravelRequest } from "../shared/travel.js";

export const TRAVEL_PAYLOAD_BYTES = 4 * Uint32Array.BYTES_PER_ELEMENT;

export type EnhancementTravelEnqueue = (
  mapId: number,
) => number;

export type EnhancementTravelConfigure = (
  payloadPointer: number,
  enabled: number,
) => number;

export type EnhancementTravelToggleTake = () => number;
export type EnhancementGuildHallEnqueue = () => number;

export function createTravelCommand(
  send: EnhancementTravelEnqueue,
  sendGuildHall: EnhancementGuildHallEnqueue | null,
  unavailable: () => string | null,
): TravelCommand {
  return Object.freeze({
    travel(request: TravelRequest) {
      const refusal = unavailable();
      if (refusal !== null) throw new Error(refusal);
      if (send(request.mapId) !== 1) {
        throw new Error("Guild Wars command queue is busy");
      }
    },
    guildHall() {
      const refusal = unavailable()
        ?? (sendGuildHall === null ? "Guild Hall travel is unavailable for this client" : null);
      if (refusal !== null) throw new Error(refusal);
      if (sendGuildHall === null) throw new Error("Guild Hall travel is unavailable for this client");
      if (sendGuildHall() !== 1) throw new Error("Guild Wars command queue is busy");
    },
    guildHallUnavailable() {
      return unavailable()
        ?? (sendGuildHall === null ? "Guild Hall travel is unavailable for this client" : null);
    },
    unavailable,
  });
}
