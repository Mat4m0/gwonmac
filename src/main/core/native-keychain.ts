export const SECRET_SLOTS = ["arenaNetCredentials", "steamSession"] as const;

export type SecretSlot = (typeof SECRET_SLOTS)[number];

export interface NativeKeychain {
  load(slot: SecretSlot): Promise<Buffer | null>;
  save(slot: SecretSlot, value: Buffer): Promise<void>;
  clear(slot: SecretSlot): Promise<void>;
}

/**
 * The deliberately non-persistent secret provider for development, ad-hoc
 * packages, and packaged smoke tests. Those builds do not have the official
 * signing identity and must never claim its Keychain items.
 */
export class VolatileNativeKeychain implements NativeKeychain {
  private readonly values = new Map<SecretSlot, Buffer>();

  async load(slot: SecretSlot): Promise<Buffer | null> {
    const value = this.values.get(slot);
    return value ? Buffer.from(value) : null;
  }

  async save(slot: SecretSlot, value: Buffer): Promise<void> {
    const previous = this.values.get(slot);
    previous?.fill(0);
    this.values.set(slot, Buffer.from(value));
  }

  async clear(slot: SecretSlot): Promise<void> {
    const previous = this.values.get(slot);
    previous?.fill(0);
    this.values.delete(slot);
  }
}

export const NATIVE_KEYCHAIN_ERROR_CODES = [
  "interaction_not_allowed",
  "missing_entitlement",
  "unavailable",
] as const;

export type NativeKeychainErrorCode =
  (typeof NATIVE_KEYCHAIN_ERROR_CODES)[number];

export function nativeKeychainErrorCode(
  error: unknown,
): NativeKeychainErrorCode | null {
  if (!(error instanceof Error) || !("code" in error)) return null;
  return (
    NATIVE_KEYCHAIN_ERROR_CODES.find((code) => error.code === code) ?? null
  );
}
