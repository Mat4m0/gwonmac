import { createRequire } from "node:module";
import path from "node:path";
import type { NativeKeychain } from "./core/native-keychain.js";

export interface NativeKeychainLayout {
  readonly packaged: boolean;
  readonly appPath: string;
  readonly resourcesPath: string;
}

export function nativeKeychainPath(layout: NativeKeychainLayout): string {
  return layout.packaged
    ? path.join(
        layout.resourcesPath,
        "app.asar.unpacked",
        "build/native/keychain.node",
      )
    : path.join(layout.appPath, "build/native/keychain.node");
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
