export const SECRET_SLOTS = ["arenaNetCredentials", "steamSession"] as const;

export type SecretSlot = (typeof SECRET_SLOTS)[number];

export interface NativeKeychain {
  load(slot: SecretSlot): Promise<Buffer | null>;
  save(slot: SecretSlot, value: Buffer): Promise<void>;
  clear(slot: SecretSlot): Promise<void>;
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
