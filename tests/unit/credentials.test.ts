import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtemp,
  readFile,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  CredentialsStore,
  parseCredentialEnvelope,
  type CredentialProvider,
} from "../../src/main/core/credentials.js";
import { AppError } from "../../src/shared/errors.js";

const credentials = {
  username: "player@example.test",
  password: "secret",
};

function fakeProvider(
  overrides: Partial<CredentialProvider> = {},
): CredentialProvider {
  return {
    protection: "mac-preview-mock-v1",
    acceptsLegacyRawCiphertext: true,
    available: async () => true,
    encrypt: async (value) =>
      Buffer.from([...value].reverse().join(""), "utf8"),
    decrypt: async (value) => ({
      plaintext: [...value.toString("utf8")].reverse().join(""),
      shouldReEncrypt: false,
    }),
    ...overrides,
  };
}

async function fixture(): Promise<{
  readonly file: string;
  readonly root: string;
}> {
  const root = await mkdtemp(join(tmpdir(), "gw-credentials-"));
  return { file: join(root, "credentials.bin"), root };
}

describe("credentials", () => {
  it("round-trips a versioned owner-only envelope and clears it", async () => {
    const { file } = await fixture();
    const store = new CredentialsStore(file, fakeProvider());

    assert.deepEqual(await store.load(), { state: "absent" });
    await store.save(credentials);
    assert.deepEqual(await store.load(), {
      state: "available",
      credentials,
    });

    const raw = await readFile(file);
    const envelope = parseCredentialEnvelope(JSON.parse(raw.toString("utf8")));
    assert.equal(envelope.formatVersion, 1);
    assert.equal(envelope.protection, "mac-preview-mock-v1");
    assert.equal(raw.includes(Buffer.from(credentials.username)), false);
    assert.equal(raw.includes(Buffer.from(credentials.password)), false);
    if (process.platform !== "win32") {
      assert.equal((await stat(file)).mode & 0o777, 0o600);
    }

    await store.clear();
    assert.deepEqual(await store.load(), { state: "absent" });
  });

  it("migrates raw preview ciphertext only after one successful decrypt", async () => {
    const { file } = await fixture();
    const provider = fakeProvider();
    const plaintext = JSON.stringify(credentials);
    await writeFile(file, await provider.encrypt(plaintext));
    let decrypts = 0;
    const store = new CredentialsStore(file, fakeProvider({
      decrypt: async (ciphertext) => {
        decrypts += 1;
        return provider.decrypt(ciphertext);
      },
    }));

    assert.deepEqual(await store.load(), {
      state: "available",
      credentials,
    });
    assert.equal(decrypts, 1);
    assert.equal(
      parseCredentialEnvelope(
        JSON.parse(await readFile(file, "utf8")),
      ).protection,
      "mac-preview-mock-v1",
    );
  });

  it("rewrites rotated ciphertext from the returned plaintext", async () => {
    const { file } = await fixture();
    const initial = new CredentialsStore(file, fakeProvider());
    await initial.save(credentials);
    let decrypts = 0;
    let encrypts = 0;
    const rotating = new CredentialsStore(file, fakeProvider({
      decrypt: async () => {
        decrypts += 1;
        return {
          plaintext: JSON.stringify(credentials),
          shouldReEncrypt: true,
        };
      },
      encrypt: async (plaintext) => {
        encrypts += 1;
        return Buffer.from(`rotated:${plaintext}`);
      },
    }));

    assert.deepEqual(await rotating.load(), {
      state: "available",
      credentials,
    });
    assert.equal(decrypts, 1);
    assert.equal(encrypts, 1);
    const envelope = parseCredentialEnvelope(
      JSON.parse(await readFile(file, "utf8")),
    );
    assert.match(
      Buffer.from(envelope.ciphertext, "base64").toString("utf8"),
      /^rotated:/u,
    );
  });

  it("preserves ciphertext while its provider is temporarily unavailable", async () => {
    const { file } = await fixture();
    const writer = new CredentialsStore(file, fakeProvider());
    await writer.save(credentials);
    const before = await readFile(file);
    const unavailable = new CredentialsStore(file, fakeProvider({
      available: async () => false,
    }));

    assert.deepEqual(await unavailable.load(), {
      state: "temporarily-unavailable",
    });
    await assert.rejects(
      unavailable.save(credentials),
      (error: unknown) =>
        error instanceof AppError && error.code === "credentials_unavailable",
    );
    assert.deepEqual(await readFile(file), before);
  });

  it("distinguishes envelope, provider, ciphertext, and plaintext failures", async () => {
    const { file } = await fixture();
    const writer = new CredentialsStore(file, fakeProvider());
    await writer.save(credentials);
    const before = await readFile(file);

    await assert.rejects(
      new CredentialsStore(file, fakeProvider({
        protection: "linux-keyring-v1",
        acceptsLegacyRawCiphertext: false,
      })).load(),
      (error: unknown) =>
        error instanceof AppError
        && error.code === "credentials_wrong_provider",
    );
    await assert.rejects(
      new CredentialsStore(file, fakeProvider({
        decrypt: async () => {
          throw new Error("wrong key");
        },
      })).load(),
      (error: unknown) =>
        error instanceof AppError
        && error.code === "credentials_decrypt_failed",
    );
    assert.deepEqual(await readFile(file), before);

    await writeFile(file, '{"formatVersion":1}');
    await assert.rejects(
      writer.load(),
      (error: unknown) =>
        error instanceof AppError
        && error.code === "credentials_envelope_corrupt",
    );

    const invalidPlaintext = new CredentialsStore(file, fakeProvider({
      decrypt: async () => ({
        plaintext: '{"username":"u","password":42}',
        shouldReEncrypt: false,
      }),
    }));
    await writeFile(
      file,
      JSON.stringify({
        formatVersion: 1,
        protection: "mac-preview-mock-v1",
        ciphertext: Buffer.from("ciphertext").toString("base64"),
      }),
    );
    await assert.rejects(
      invalidPlaintext.load(),
      (error: unknown) =>
        error instanceof AppError && error.code === "credentials_corrupt",
    );
  });

  it("bounds files before decrypting or decoding their ciphertext", async () => {
    const { file } = await fixture();
    let decrypts = 0;
    const store = new CredentialsStore(file, fakeProvider({
      decrypt: async () => {
        decrypts += 1;
        throw new Error("must not run");
      },
    }));
    await writeFile(file, Buffer.alloc(32 * 1024 + 1, 0x58));

    await assert.rejects(
      store.load(),
      (error: unknown) =>
        error instanceof AppError
        && error.code === "credentials_envelope_corrupt",
    );
    assert.equal(decrypts, 0);
  });

  it("never replaces prior ciphertext after invalid input or write failure", async () => {
    const { file } = await fixture();
    const store = new CredentialsStore(file, fakeProvider());
    await store.save(credentials);
    const before = await readFile(file);

    await assert.rejects(
      store.save({ username: credentials.username, password: 42 }),
      (error: unknown) =>
        error instanceof AppError && error.code === "credentials_corrupt",
    );
    const failedWriter = new CredentialsStore(
      file,
      fakeProvider(),
      async () => {
        throw new Error("disk unavailable");
      },
    );
    await assert.rejects(
      failedWriter.save({ username: "new", password: "new" }),
      (error: unknown) =>
        error instanceof AppError && error.code === "credentials_io",
    );
    assert.deepEqual(await readFile(file), before);
  });
});
