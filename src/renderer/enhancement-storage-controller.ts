/**
 * Lifecycle owner for storage availability, policy synchronization, and disposal.
 * The installer forwards settings and observations here instead of duplicating state.
 */
import type { ToolboxObservation } from "../shared/builds/live-party.js";
import type { StorageCommand } from "../shared/storage-command.js";
import {
  createStorageCommand,
  initializeStorageDataWindow,
  STORAGE_DATA_WINDOW_BYTES,
  type EnhancementStorageConfigure,
  type EnhancementStorageOpen,
} from "./enhancement-storage-command.js";

export { initializeStorageDataWindow, STORAGE_DATA_WINDOW_BYTES };

type PlayRegion = "pve" | "pvp" | "unknown";

export interface StorageAvailability {
  readonly enabled: boolean;
  readonly playRegion: PlayRegion;
  readonly observation: ToolboxObservation | null;
}

export interface StorageController {
  readonly command: StorageCommand;
  update(availability: StorageAvailability): void;
  dispose(): void;
}

function unavailableReason(
  active: boolean,
  availability: StorageAvailability,
): string | null {
  if (!active) return "Enhancement installation is no longer active";
  if (!availability.enabled) return "Xunlai storage is turned off in Settings";
  if (availability.playRegion !== "pve") return "Storage is available in PvE outposts";
  const observed = availability.observation;
  if (observed?.status !== "ready" || observed.party?.status !== "ready") {
    return "Storage is waiting for the current party";
  }
  if (observed.party.playRegion !== "pve" || observed.party.inOutpost !== true) {
    return "Storage is available in PvE outposts";
  }
  return null;
}

/** Owns the complete storage command policy, event, and Wasm configuration lifecycle. */
export function createStorageController(
  open: EnhancementStorageOpen,
  configure: EnhancementStorageConfigure,
  payloadPointer: number,
): StorageController {
  let active = true;
  let availability: StorageAvailability = {
    enabled: false,
    playRegion: "unknown",
    observation: null,
  };
  let configuredEnabled: boolean | null = null;
  const unavailable = () => unavailableReason(active, availability);
  const command = createStorageCommand(open, unavailable);
  const sync = () => {
    const enabled = unavailable() === null;
    if (enabled === configuredEnabled) return;
    configure(payloadPointer, enabled ? 1 : 0);
    configuredEnabled = enabled;
  };
  const onCommand = (event: Event) => {
    if (!(event instanceof CustomEvent)) return;
    event.preventDefault();
    try {
      command.open();
    } catch (error) {
      if (event.detail !== null && typeof event.detail === "object") {
        (event.detail as { error?: unknown }).error = error;
      }
    }
  };
  window.addEventListener("gw:storage-open", onCommand);
  sync();

  return Object.freeze({
    command,
    update(next: StorageAvailability) {
      availability = next;
      sync();
    },
    dispose() {
      if (!active) return;
      active = false;
      window.removeEventListener("gw:storage-open", onCommand);
      configure(0, 0);
    },
  });
}
