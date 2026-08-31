/**
 * Finding and loading gwonmac's Darwin-only native host addon.
 *
 * A packaged build resolves it inside `app.asar.unpacked` because a `.node`
 * binary cannot load from within an archive. The boundary is shape-checked so
 * a stale or mismatched addon fails before it can own secrets or native input.
 */
import { createRequire } from "node:module";
import type { NativeKeychain } from "./core/native-keychain.js";
import { unpackedPath, type BundleLayout } from "./core/paths.js";

export interface NativeInputMonitor {
  /**
   * Observe app-local key releases owned by a Command chord. Returning true
   * consumes that release only while Command remains down, after the renderer
   * owns its replacement.
   */
  monitorCommandKeyUps(handler: (keyCode: number) => boolean): () => void;
}

export type DarwinNativeHost = NativeKeychain & NativeInputMonitor;

export type NativeHostLayout = BundleLayout;

export function nativeHostPath(layout: NativeHostLayout): string {
  return unpackedPath(layout, "build/native/host.node");
}

function isDarwinNativeHost(value: unknown): value is DarwinNativeHost {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<Record<keyof DarwinNativeHost, unknown>>;
  return (
    typeof candidate.load === "function" &&
    typeof candidate.save === "function" &&
    typeof candidate.clear === "function" &&
    typeof candidate.monitorCommandKeyUps === "function"
  );
}

export function loadDarwinNativeHost(
  layout: NativeHostLayout,
): DarwinNativeHost {
  const loaded: unknown = createRequire(import.meta.url)(nativeHostPath(layout));
  if (!isDarwinNativeHost(loaded)) {
    throw new TypeError("native host module has an invalid shape");
  }
  return loaded;
}
