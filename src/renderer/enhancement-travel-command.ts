/**
 * Renderer-side adapter for the certified four-scalar travel export.
 * District names stay in the host; only reviewed numbers reach WebAssembly.
 */
import type { TravelCommand } from "../shared/travel-command.js";
import {
  travelDistrict,
  type TravelRequest,
} from "../shared/travel.js";

export const TRAVEL_PAYLOAD_BYTES = 4 * Uint32Array.BYTES_PER_ELEMENT;

export type EnhancementTravelEnqueue = (
  mapId: number,
  region: number,
  language: number,
  districtNumber: number,
) => number;

export type EnhancementTravelConfigure = (
  payloadPointer: number,
  enabled: number,
) => number;

export function createTravelCommand(
  send: EnhancementTravelEnqueue,
  unavailable: () => string | null,
): TravelCommand {
  return Object.freeze({
    travel(request: TravelRequest) {
      const refusal = unavailable();
      if (refusal !== null) throw new Error(refusal);
      const district = travelDistrict(request.district);
      if (
        send(
          request.mapId,
          district.region,
          district.language,
          request.districtNumber,
        ) !== 1
      ) {
        throw new Error("Guild Wars command queue is busy");
      }
    },
    unavailable,
  });
}
