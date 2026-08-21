/**
 * Feature-local ownership of the Xunlai command's exports, allocation,
 * initialization, live policy, and teardown.
 */
import type { StorageCommand } from "../shared/storage-command.js";
import type {
  EnhancementStorageConfigure,
  EnhancementStorageOpen,
} from "./enhancement-storage-command.js";
import {
  createStorageController,
  initializeStorageDataWindow,
  STORAGE_DATA_WINDOW_BYTES,
  type StorageAvailability,
  type StorageController,
} from "./enhancement-storage-controller.js";

export interface StorageInstallation {
  allocate(malloc: (bytes: number) => unknown): void;
  region(): { readonly name: string; readonly pointer: number; readonly size: number; readonly align: 4 };
  initialize(memory: WebAssembly.Memory): void;
  mount(): void;
  update(availability: StorageAvailability): void;
  command(): StorageCommand | null;
  dispose(free: (pointer: number) => void): void;
}

/** Refuses a certified storage profile whose promised exports are absent. */
export function createStorageInstallation(
  exports: WebAssembly.Exports,
  enabled: boolean,
  development = false,
): StorageInstallation | null {
  if (!enabled) return null;
  const open = typeof exports.enhancement_open_storage === "function"
    ? exports.enhancement_open_storage as EnhancementStorageOpen
    : null;
  const configure = typeof exports.enhancement_configure_storage === "function"
    ? exports.enhancement_configure_storage as EnhancementStorageConfigure
    : null;
  if (open === null || configure === null) {
    throw new Error("the storage profile derived a module with no storage command");
  }

  let payloadPointer = 0;
  let controller: StorageController | null = null;
  return {
    allocate(malloc) {
      payloadPointer = Number(malloc(STORAGE_DATA_WINDOW_BYTES));
    },
    region() {
      return { name: "storage payload", pointer: payloadPointer, size: STORAGE_DATA_WINDOW_BYTES, align: 4 };
    },
    initialize(memory) {
      initializeStorageDataWindow(memory, payloadPointer);
      configure(payloadPointer, 0);
    },
    mount() {
      controller = createStorageController(open, configure, payloadPointer, development);
    },
    update(availability) {
      controller?.update(availability);
    },
    command() {
      return controller?.command ?? null;
    },
    dispose(free) {
      const failures: unknown[] = [];
      try {
        controller?.dispose();
      } catch (error) {
        failures.push(error);
      }
      controller = null;
      try {
        if (payloadPointer !== 0) free(payloadPointer);
      } catch (error) {
        failures.push(error);
      }
      payloadPointer = 0;
      if (failures.length > 0) {
        throw new AggregateError(failures, "Storage cleanup was incomplete");
      }
    },
  };
}
