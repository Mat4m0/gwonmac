import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { CredentialsStore } from "../../src/main/core/credentials.js";
import type {
  NativeKeychain,
  SecretSlot,
} from "../../src/main/core/native-keychain.js";
import { AppError } from "../../src/shared/errors.js";
import { parseProfileId } from "../../src/shared/multiple-accounts.js";
import { multiSecretSlot } from "../../src/main/core/native-keychain.js";

class FakeKeychain implements NativeKeychain {
  readonly values = new Map<SecretSlot, Buffer>();
  failure: Error | null = null;

  async load(slot: SecretSlot): Promise<Buffer | null> {
    if (this.failure) throw this.failure;
    const value = this.values.get(slot);
    return value ? Buffer.from(value) : null;
  }

  async save(slot: SecretSlot, value: Buffer): Promise<void> {
    if (this.failure) throw this.failure;
    this.values.set(slot, Buffer.from(value));
  }

  async clear(slot: SecretSlot): Promise<void> {
    if (this.failure) throw this.failure;
    this.values.delete(slot);
  }
}

describe("credentials", () => {
  it("round-trips the fixed credentials slot and clears it", async () => {
    const keychain = new FakeKeychain();
    const store = new CredentialsStore(keychain);
    const credentials = { username: "player@example.test", password: "secret" };

    assert.equal(await store.load(), null);
    await store.save(credentials);
    assert.deepEqual(await store.load(), credentials);
    assert.equal(keychain.values.has("steamSession"), false);

    await store.clear();
    assert.equal(await store.load(), null);
  });

  it("keeps a Multi profile out of the fixed Single slot", async () => {
    const keychain = new FakeKeychain();
    const slot = multiSecretSlot(
      parseProfileId("2d31e565-9fc8-4dde-9fd4-9d644f8283ae"),
      "arenaNetCredentials",
    );
    const store = new CredentialsStore(keychain, slot);
    await store.save({ username: "multi@example.test", password: "secret" });
    assert.equal(keychain.values.has("arenaNetCredentials"), false);
    assert.deepEqual(
      JSON.parse(keychain.values.get(slot)!.toString("utf8")),
      { username: "multi@example.test", password: "secret" },
    );
  });

  it("maps native failure to the credential vocabulary", async () => {
    const keychain = new FakeKeychain();
    keychain.failure = new Error("injected native failure");
    const store = new CredentialsStore(keychain);
    await assert.rejects(
      store.save({ username: "u", password: "p" }),
      (error: unknown) =>
        error instanceof AppError && error.code === "credentials_unavailable",
    );
  });

  it("retains unreadable Keychain bytes", async () => {
    const keychain = new FakeKeychain();
    keychain.values.set("arenaNetCredentials", Buffer.from([0xff]));
    const store = new CredentialsStore(keychain);
    await assert.rejects(
      store.load(),
      (error: unknown) =>
        error instanceof AppError && error.code === "credentials_corrupt",
    );
    assert.deepEqual(keychain.values.get("arenaNetCredentials"), Buffer.from([0xff]));
  });

  it("rejects invalid saves before replacing stored credentials", async () => {
    const keychain = new FakeKeychain();
    const store = new CredentialsStore(keychain);
    const credentials = { username: "player@example.test", password: "secret" };
    await store.save(credentials);
    const before = Buffer.from(keychain.values.get("arenaNetCredentials")!);
    await assert.rejects(
      store.save({ username: "player@example.test", password: 42 }),
      (error: unknown) =>
        error instanceof AppError && error.code === "credentials_corrupt",
    );
    assert.deepEqual(keychain.values.get("arenaNetCredentials"), before);
    assert.deepEqual(await store.load(), credentials);
  });
});
