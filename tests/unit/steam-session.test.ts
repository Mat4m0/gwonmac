import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { SafeStorageApi } from "../../src/main/core/encrypted-store.js";
import {
  parseSteamSession,
  SteamSessionStore,
} from "../../src/main/core/steam-session.js";
import { AppError } from "../../src/shared/errors.js";

/** The same reversible stand-in `tests/unit/credentials.test.ts` uses. */
function fakeStorage(): SafeStorageApi {
  return {
    isEncryptionAvailable: () => true,
    encryptString: (value) => Buffer.from([...value].reverse().join(""), "utf8"),
    decryptString: (value) => [...value.toString("utf8")].reverse().join(""),
  };
}

async function storeIn(prefix: string): Promise<{ path: string; store: SteamSessionStore }> {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  const path = join(dir, "steam-session.bin");
  return { path, store: new SteamSessionStore(path, fakeStorage()) };
}

const TOKEN = "0123456789abcdef0123456789abcdef";

describe("the Steam session store", () => {
  it("round-trips an owner-only encrypted record and clears it", async () => {
    const { path, store } = await storeIn("gw-steam-store-");
    const session = { token: TOKEN, expiry: 1_800_000_000_000 };

    assert.equal(await store.load(), null);
    await store.save(session);
    assert.deepEqual(await store.load(), session);

    const raw = await readFile(path);
    assert.equal(raw.includes(Buffer.from(TOKEN)), false, "the token must not sit in the file");
    assert.equal((await stat(path)).mode & 0o777, 0o600);

    await store.clear();
    assert.equal(await store.load(), null);
  });

  it("keeps a record whose expiry the account service has not supplied", async () => {
    // R9: an acquired token is stored before any server expiry is known. `null`
    // is that state, and it must survive the round-trip rather than being read
    // back as a token that expired at the epoch.
    const { store } = await storeIn("gw-steam-null-expiry-");
    await store.save({ token: TOKEN, expiry: null });
    assert.deepEqual(await store.load(), { token: TOKEN, expiry: null });
  });

  it("reports an absent store as absent, not as a failure", async () => {
    const { store } = await storeIn("gw-steam-enoent-");
    assert.equal(await store.load(), null);
  });

  it("refuses unavailable encryption the way the credential store does", async () => {
    const dir = await mkdtemp(join(tmpdir(), "gw-steam-unavailable-"));
    const store = new SteamSessionStore(join(dir, "steam-session.bin"), {
      ...fakeStorage(),
      isEncryptionAvailable: () => false,
    });
    await assert.rejects(
      store.save({ token: TOKEN, expiry: null }),
      (error: unknown) =>
        error instanceof AppError && error.code === "steam_session_unavailable",
    );
  });

  it("refuses ciphertext it cannot read without destroying it", async () => {
    // The token is the only thing standing between the player and a Steam
    // prompt. A read that fails because encryption was momentarily unavailable
    // must not throw away a credential that still works.
    const { path, store } = await storeIn("gw-steam-corrupt-");
    await store.save({ token: TOKEN, expiry: null });
    const wrongKey = new SteamSessionStore(path, {
      ...fakeStorage(),
      decryptString: () => {
        throw new Error("wrong key");
      },
    });
    await assert.rejects(
      wrongKey.load(),
      (error: unknown) => error instanceof AppError && error.code === "steam_session_corrupt",
    );
    assert.ok(
      (await readFile(path)).byteLength > 0,
      "a failed read must not delete the stored token",
    );
  });

  it("rejects an invalid record before replacing a stored one", async () => {
    const { path, store } = await storeIn("gw-steam-reject-save-");
    await store.save({ token: TOKEN, expiry: null });
    const before = await readFile(path);
    await assert.rejects(
      store.save({ token: "", expiry: null }),
      (error: unknown) => error instanceof AppError && error.code === "steam_session_corrupt",
    );
    assert.deepEqual(await readFile(path), before);
    assert.deepEqual(await store.load(), { token: TOKEN, expiry: null });
  });
});

describe("the Steam session shape check", () => {
  it("accepts a token with a numeric expiry or none yet", () => {
    assert.deepEqual(parseSteamSession({ token: TOKEN, expiry: 1 }), {
      token: TOKEN,
      expiry: 1,
    });
    assert.deepEqual(parseSteamSession({ token: TOKEN, expiry: null }), {
      token: TOKEN,
      expiry: null,
    });
  });

  it("keeps only the two fields it models", () => {
    assert.deepEqual(parseSteamSession({ token: TOKEN, expiry: null, extra: "dropped" }), {
      token: TOKEN,
      expiry: null,
    });
  });

  it("rejects anything that cannot be replayed at a login screen", () => {
    for (const bad of [
      null,
      undefined,
      "a string",
      42,
      [],
      [{ token: TOKEN, expiry: null }],
      {}, // no token
      { expiry: null }, // still no token
      { token: "", expiry: null }, // empty token
      { token: 42, expiry: null }, // non-string token
      { token: TOKEN }, // expiry absent entirely
      { token: "x".repeat(4097), expiry: null }, // implausibly long
      { token: TOKEN, expiry: "soon" }, // non-numeric expiry
      { token: TOKEN, expiry: Number.NaN },
      { token: TOKEN, expiry: Number.POSITIVE_INFINITY },
    ]) {
      assert.throws(
        () => parseSteamSession(bad),
        (error: unknown) =>
          error instanceof AppError && error.code === "steam_session_corrupt",
        JSON.stringify(bad) ?? String(bad),
      );
    }
  });
});
