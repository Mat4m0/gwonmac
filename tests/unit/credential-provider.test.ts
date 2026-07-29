import assert from "node:assert/strict";
import { test } from "node:test";
import type { SafeStorage } from "electron";
import { createCredentialProvider } from "../../src/main/credential-provider.js";

function storage(overrides: Record<string, unknown> = {}): SafeStorage {
  return {
    getSelectedStorageBackend: () => "gnome_libsecret",
    isEncryptionAvailable: () => true,
    isAsyncEncryptionAvailable: async () => true,
    encryptString: (plaintext: string) => Buffer.from(plaintext),
    decryptString: (ciphertext: Buffer) => ciphertext.toString("utf8"),
    encryptStringAsync: async (plaintext: string) => Buffer.from(plaintext),
    decryptStringAsync: async (ciphertext: Buffer) => ({
      result: ciphertext.toString("utf8"),
      shouldReEncrypt: true,
    }),
    setUsePlainTextEncryption: () => {},
    ...overrides,
  } as SafeStorage;
}

test("macOS preview keeps the legacy mock provider migration", async () => {
  let syncCalls = 0;
  const provider = createCredentialProvider("darwin", storage({
    encryptString: () => {
      syncCalls += 1;
      return Buffer.alloc(0);
    },
    decryptString: () => {
      syncCalls += 1;
      return "";
    },
  }));
  assert.equal(provider.protection, "mac-preview-mock-v1");
  assert.equal(provider.acceptsLegacyRawCiphertext, true);
  assert.equal(await provider.available(), true);
  assert.equal(
    (await provider.decrypt(Buffer.from("plain"))).shouldReEncrypt,
    true,
  );
  assert.equal(syncCalls, 0);
});

test("Windows uses the asynchronous OS safe-storage contract", async () => {
  let syncCalls = 0;
  const provider = createCredentialProvider("win32", storage({
    encryptString: () => {
      syncCalls += 1;
      return Buffer.alloc(0);
    },
    decryptString: () => {
      syncCalls += 1;
      return "";
    },
  }));
  assert.equal(provider.protection, "os-safe-storage-v1");
  assert.equal(provider.acceptsLegacyRawCiphertext, false);
  assert.equal(await provider.available(), true);
  assert.equal(
    (await provider.decrypt(Buffer.from("plain"))).shouldReEncrypt,
    true,
  );
  assert.deepEqual(await provider.encrypt("plain"), Buffer.from("plain"));
  assert.equal(syncCalls, 0);
});

test("Linux accepts inspected keyrings and refuses basic, unknown, or locked storage", async () => {
  for (const backend of [
    "gnome_libsecret",
    "kwallet",
    "kwallet5",
    "kwallet6",
  ]) {
    const provider = createCredentialProvider("linux", storage({
      getSelectedStorageBackend: () => backend,
    }));
    assert.equal(provider.protection, "linux-keyring-v1");
    assert.equal(await provider.available(), true);
  }
  for (const backend of ["basic_text", "unknown"]) {
    const provider = createCredentialProvider("linux", storage({
      getSelectedStorageBackend: () => backend,
    }));
    assert.equal(await provider.available(), false);
  }
  assert.equal(
    await createCredentialProvider("linux", storage({
      isEncryptionAvailable: () => false,
    })).available(),
    false,
  );
});

test("credential providers reject unsupported process platforms", () => {
  assert.throws(
    () => createCredentialProvider("freebsd", storage()),
    /unsupported credential platform/u,
  );
});
