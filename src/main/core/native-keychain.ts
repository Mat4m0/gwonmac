/**
 * The interface every persistent secret talks to, and the closed set of slots
 * it may name.
 *
 * `SecretSlot` is a union rather than a string, so a new persistent secret is a
 * deliberate edit here instead of an ad-hoc item appearing in a player's
 * Keychain. `VolatileNativeKeychain` is the implementation for builds with no
 * provisioned signing identity: secrets live in memory and are lost at quit.
 * It is not a fallback an entitled build may drop to, and no file, encrypted
 * blob or mock-Keychain implementation stands beside it as one.
 */
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
