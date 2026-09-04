/**
 * Owns Travel policy and the WebAssembly configure lifecycle. The palette and
 * command share this one availability answer, so a visible action cannot be
 * enabled while its underlying export is fail-closed.
 */
import type {
  TravelCommand,
  TravelGameState,
} from "../shared/travel-command.js";
import {
  createTravelCommand,
  TRAVEL_PAYLOAD_BYTES,
  type EnhancementTravelConfigure,
  type EnhancementTravelEnqueue,
  type EnhancementGuildHallEnqueue,
} from "./enhancement-travel-command.js";

export { TRAVEL_PAYLOAD_BYTES };

export interface TravelAvailability {
  readonly enabled: boolean;
  readonly playRegion: "pve" | "pvp" | "unknown";
  readonly state: TravelGameState | null;
}

export interface TravelController {
  readonly command: TravelCommand;
  update(availability: TravelAvailability): void;
  dispose(): void;
}

function unavailableReason(
  active: boolean,
  availability: TravelAvailability,
): string | null {
  if (!active) return "Enhancement installation is no longer active";
  if (availability.playRegion === "pvp") {
    return "Travel is unavailable during PvP play";
  }
  if (!availability.enabled) return "Travel is turned off in Settings";
  if (availability.playRegion === "unknown") {
    return "Travel is waiting to confirm the current region";
  }
  if (availability.state?.status !== "ready") {
    return availability.state?.reason === "loading"
      ? "Travel is unavailable while a map is loading"
      : "Travel is waiting for Guild Wars";
  }
  return null;
}

export function createTravelController(
  enqueue: EnhancementTravelEnqueue,
  enqueueGuildHall: EnhancementGuildHallEnqueue | null,
  configure: EnhancementTravelConfigure,
  payloadPointer: number,
): TravelController {
  let active = true;
  let availability: TravelAvailability = {
    enabled: false,
    playRegion: "unknown",
    state: null,
  };
  let configuredEnabled: boolean | null = null;
  const unavailable = () => unavailableReason(active, availability);
  const command = createTravelCommand(enqueue, enqueueGuildHall, unavailable);
  const sync = () => {
    const enabled = unavailable() === null;
    if (enabled === configuredEnabled) return;
    configure(payloadPointer, enabled ? 1 : 0);
    configuredEnabled = enabled;
  };
  sync();
  return Object.freeze({
    command,
    update(next: TravelAvailability) {
      availability = next;
      sync();
    },
    dispose() {
      if (!active) return;
      active = false;
      configure(0, 0);
    },
  });
}
