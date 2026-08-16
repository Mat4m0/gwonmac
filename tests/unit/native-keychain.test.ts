import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  SINGLE_SECRET_SLOTS,
  multiSecretSlot,
  type NativeKeychain,
  type SecretSlot,
} from "../../src/main/core/native-keychain.js";
import { nativeHostPath } from "../../src/main/native-host.js";

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
    assert.deepEqual(SINGLE_SECRET_SLOTS, ["arenaNetCredentials", "steamSession"]);
    assert.equal(
      multiSecretSlot(
        "2d31e565-9fc8-4dde-9fd4-9d644f8283ae" as never,
        "arenaNetCredentials",
      ),
      "multi.2d31e565-9fc8-4dde-9fd4-9d644f8283ae.arenaNetCredentials",
    );
  });

  it("resolves the one development and one packaged binary path", () => {
    assert.equal(
      nativeHostPath({
        packaged: false,
        appPath: "/checkout",
        resourcesPath: "/ignored",
      }),
      "/checkout/build/native/host.node",
    );
    assert.equal(
      nativeHostPath({
        packaged: true,
        appPath: "/ignored",
        resourcesPath: "/App/Contents/Resources",
      }),
      "/App/Contents/Resources/app.asar.unpacked/build/native/host.node",
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
