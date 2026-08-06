/**
 * Finding and loading the native Keychain addon, kept apart from every rule
 * about what a secret is.
 *
 * A packaged build resolves it inside `app.asar.unpacked` because a `.node`
 * binary cannot be loaded from within an archive. What comes back is
 * shape-checked before it is returned, so a missing, stale or mismatched addon
 * fails here with a type error instead of at the first attempt to read a
 * player's saved password.
 */
import { createRequire } from "node:module";
import type { NativeKeychain } from "./core/native-keychain.js";
import { unpackedPath, type BundleLayout } from "./core/paths.js";

export type NativeKeychainLayout = BundleLayout;

export function nativeKeychainPath(layout: NativeKeychainLayout): string {
  return unpackedPath(layout, "build/native/keychain.node");
}

function isNativeKeychain(value: unknown): value is NativeKeychain {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<Record<keyof NativeKeychain, unknown>>;
  return (
    typeof candidate.load === "function" &&
    typeof candidate.save === "function" &&
    typeof candidate.clear === "function"
  );
}

export function loadNativeKeychain(
  layout: NativeKeychainLayout,
): NativeKeychain {
  const loaded: unknown = createRequire(import.meta.url)(
    nativeKeychainPath(layout),
  );
  if (!isNativeKeychain(loaded)) {
    throw new TypeError("native Keychain module has an invalid shape");
  }
  return loaded;
}
