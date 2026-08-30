/**
 * Loads the Windows-only known-folder and Credential Manager boundary.
 * The raw addon accepts only closed identities and slots; this module binds
 * one distribution identity to the existing NativeKeychain contract.
 */
import { createRequire } from "node:module";
import path from "node:path";
import type { SecretSlot, NativeKeychain } from "./core/native-keychain.js";
import type { BundleLayout } from "./core/paths.js";
import {
  DISTRIBUTION_CHANNEL_CONFIG,
  type DistributionChannel,
} from "../shared/distribution-channel.js";

interface WindowsNativeHost {
  localAppData(): string;
  currentExecutableTrusted(): boolean;
  load(identity: string, slot: SecretSlot): Promise<Buffer | null>;
  save(identity: string, slot: SecretSlot, value: Buffer): Promise<void>;
  clear(identity: string, slot: SecretSlot): Promise<void>;
}

export function windowsNativeHostPath(layout: BundleLayout): string {
  const root = layout.packaged
    ? path.win32.join(layout.resourcesPath, "app.asar.unpacked")
    : layout.appPath;
  return path.win32.join(root, "build/native/windows-host.node");
}

function isWindowsNativeHost(value: unknown): value is WindowsNativeHost {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<Record<keyof WindowsNativeHost, unknown>>;
  return (
    typeof candidate.localAppData === "function"
    && typeof candidate.currentExecutableTrusted === "function"
    && typeof candidate.load === "function"
    && typeof candidate.save === "function"
    && typeof candidate.clear === "function"
  );
}

export function windowsExecutableTrusted(host: WindowsNativeHost): boolean {
  return host.currentExecutableTrusted();
}

export function loadWindowsNativeHost(layout: BundleLayout): WindowsNativeHost {
  const loaded: unknown = createRequire(import.meta.url)(
    windowsNativeHostPath(layout),
  );
  if (!isWindowsNativeHost(loaded)) {
    throw new TypeError("Windows native host module has an invalid shape");
  }
  return loaded;
}

export class WindowsCredentialKeychain implements NativeKeychain {
  readonly #identity: string;
  readonly #host: WindowsNativeHost;

  constructor(
    host: WindowsNativeHost,
    channel: DistributionChannel,
  ) {
    this.#host = host;
    this.#identity = DISTRIBUTION_CHANNEL_CONFIG[channel].bundleId;
  }

  load(slot: SecretSlot): Promise<Buffer | null> {
    return this.#host.load(this.#identity, slot);
  }

  save(slot: SecretSlot, value: Buffer): Promise<void> {
    return this.#host.save(this.#identity, slot, value);
  }

  clear(slot: SecretSlot): Promise<void> {
    return this.#host.clear(this.#identity, slot);
  }
}
