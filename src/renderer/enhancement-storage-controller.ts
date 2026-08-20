/**
 * Lifecycle owner for storage availability, policy synchronization, and disposal.
 * The installer forwards settings and the certified game snapshot here instead
 * of duplicating state.
 */
import type { StorageCommand } from "../shared/storage-command.js";
import type { CompanionSnapshot } from "./companion-snapshot.js";
import {
  createStorageCommand,
  initializeStorageDataWindow,
  STORAGE_DATA_WINDOW_BYTES,
  type EnhancementStorageConfigure,
  type EnhancementStorageOpen,
} from "./enhancement-storage-command.js";

export { initializeStorageDataWindow, STORAGE_DATA_WINDOW_BYTES };

type ReadyStorageGameState = Pick<
  Extract<CompanionSnapshot, { status: "ready" }>,
  "status" | "xunlaiAccess"
>;
type PendingStorageGameState = Pick<
  Exclude<CompanionSnapshot, { status: "ready" }>,
  "status"
>;
export type StorageGameState = ReadyStorageGameState | PendingStorageGameState;

export interface StorageAvailability {
  readonly enabled: boolean;
  readonly state: StorageGameState | null;
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
  const state = availability.state;
  if (state?.status !== "ready" || typeof state.xunlaiAccess !== "boolean") {
    return "Storage is waiting to confirm access for this character";
  }
  if (state.xunlaiAccess !== true) {
    return "This character cannot access Xunlai storage here";
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
    state: null,
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
