/**
 * Narrows the launch-fixed preload at the optional Tools import boundary.
 * Core cannot import this module because only Tools modules reference it.
 */
import type { ToolsGwNativeApi } from "../shared/contracts.js";

export function requireToolsApi(): ToolsGwNativeApi {
  if (
    !window.gwNative.init.enhancementSelection.tools
    || !("trade" in window.gwNative)
  ) {
    throw new Error("Tools API is unavailable in a Core launch");
  }
  return window.gwNative;
}
