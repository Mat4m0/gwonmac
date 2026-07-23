import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CredentialsStore, type SafeStorageApi } from "../../src/main/core/credentials.js";
import { AppError } from "../../src/shared/errors.js";

function fakeStorage(): SafeStorageApi {
  return {
    isEncryptionAvailable: () => true,
    encryptString: (value) =>
      Buffer.from([...value].reverse().join(""), "utf8"),
    decryptString: (value) => {
      return [...value.toString("utf8")].reverse().join("");
    },
  };
}

describe("credentials", () => {
  it("round-trips encrypted owner-only credentials and clears them", async () => {
    const dir = await mkdtemp(join(tmpdir(), "gw-credentials-"));
    const path = join(dir, "credentials.bin");
    const store = new CredentialsStore(path, fakeStorage());
    const credentials = { username: "player@example.test", password: "secret" };

    assert.equal(await store.load(), null);
    await store.save(credentials);
    assert.deepEqual(await store.load(), credentials);

    const raw = await readFile(path);
    assert.equal(raw.includes(Buffer.from(credentials.username)), false);
    assert.equal(raw.includes(Buffer.from(credentials.password)), false);
    assert.equal((await stat(path)).mode & 0o777, 0o600);

    await store.clear();
    assert.equal(await store.load(), null);
  });

  it("rejects unavailable encryption and unreadable ciphertext", async () => {
    const dir = await mkdtemp(join(tmpdir(), "gw-credentials-"));
    const path = join(dir, "credentials.bin");
    const unavailable = new CredentialsStore(path, {
      ...fakeStorage(),
      isEncryptionAvailable: () => false,
    });
    await assert.rejects(
      unavailable.save({ username: "u", password: "p" }),
      (error: unknown) =>
        error instanceof AppError && error.code === "credentials_unavailable",
    );

    const writer = new CredentialsStore(path, fakeStorage());
    await writer.save({ username: "u", password: "p" });
    const wrongKey = new CredentialsStore(path, {
      ...fakeStorage(),
      decryptString: () => {
        throw new Error("wrong key");
      },
    });
    await assert.rejects(
      wrongKey.load(),
      (error: unknown) =>
        error instanceof AppError && error.code === "credentials_corrupt",
    );
  });
});
