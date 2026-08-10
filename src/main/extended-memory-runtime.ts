/**
 * Extended-memory runtime truth.
 * Projects certified module selection into the one status published to the renderer.
 */
import {
  WASM_HEAP_CAP_BYTES,
  type ExtendedMemoryRuntimeStatus,
} from "../shared/contracts.js";
import type { ExtendedMemoryMode } from "./certification/client-module.js";

/** The single projection from module selection into user-visible runtime truth. */
export function extendedMemoryRuntimeStatus(
  mode: ExtendedMemoryMode,
): ExtendedMemoryRuntimeStatus {
  switch (mode.status) {
    case "disabled":
      return {
        requestedAtLaunch: false,
        status: "standard",
        effectiveCapBytes: WASM_HEAP_CAP_BYTES,
        fallbackReason: null,
      };
    case "active":
      return {
        requestedAtLaunch: true,
        status: "active",
        effectiveCapBytes: mode.effectiveCapBytes,
        fallbackReason: null,
      };
    case "unavailable":
      return {
        requestedAtLaunch: true,
        status: "unavailable",
        effectiveCapBytes: WASM_HEAP_CAP_BYTES,
        fallbackReason: mode.reason,
      };
  }
}
