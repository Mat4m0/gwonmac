/**
 * Type-only declaration for the isolated Vue launcher document.
 * Runtime ownership stays in the generated launcher preload.
 */
import type { LauncherNativeApi } from "../shared/launcher-contracts.js";

declare global {
  interface Window {
    launcherNative: LauncherNativeApi;
  }
}

export {};
