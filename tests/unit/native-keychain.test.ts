import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  SECRET_SLOTS,
  type NativeKeychain,
  type SecretSlot,
} from "../../src/main/core/native-keychain.js";
import { nativeKeychainPath } from "../../src/main/native-keychain.js";

class FakeNativeKeychain implements NativeKeychain {
  readonly #items = new Map<SecretSlot, Buffer>();

  async load(slot: SecretSlot): Promise<Buffer | null> {
    const value = this.#items.get(slot);
    return value === undefined ? null : Buffer.from(value);
  }

  async save(slot: SecretSlot, value: Buffer): Promise<void> {
    this.#items.set(slot, Buffer.from(value));
  }

  async clear(slot: SecretSlot): Promise<void> {
    this.#items.delete(slot);
  }
}

describe("native Keychain boundary", () => {
  it("has exactly the two product-owned slots", () => {
    assert.deepEqual(SECRET_SLOTS, ["arenaNetCredentials", "steamSession"]);
  });

  it("resolves the one development and one packaged binary path", () => {
    assert.equal(
      nativeKeychainPath({
        packaged: false,
        appPath: "/checkout",
        resourcesPath: "/ignored",
      }),
      "/checkout/build/native/keychain.node",
    );
    assert.equal(
      nativeKeychainPath({
        packaged: true,
        appPath: "/ignored",
        resourcesPath: "/App/Contents/Resources",
      }),
      "/App/Contents/Resources/app.asar.unpacked/build/native/keychain.node",
    );
  });

  it("accepts an asynchronous in-memory fake without another interface", async () => {
    const fake: NativeKeychain = new FakeNativeKeychain();
    assert.equal(await fake.load("steamSession"), null);
    await fake.save("steamSession", Buffer.from("synthetic"));
    assert.deepEqual(await fake.load("steamSession"), Buffer.from("synthetic"));
    await fake.clear("steamSession");
    assert.equal(await fake.load("steamSession"), null);
  });
});
