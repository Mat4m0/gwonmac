import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { SafeStorageApi } from "../../src/main/core/encrypted-store.js";
import {
  parseSteamSession,
  refreshSteamExpiry,
  resolveSteamToken,
  STEAM_TOKEN_LIFETIME_MS,
  SteamSessionStore,
  type SteamSessionReader,
  type StoredSteamSession,
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

/**
 * A store standing in for the encrypted file, so token resolution can be
 * exercised without Electron. It validates on save exactly as the real one
 * does, and it counts clears — because "treated as absent" and "deleted" are
 * different outcomes and R8 turns on which one happens.
 */
function fakeStore(
  initial: StoredSteamSession | null,
  failure?: AppError,
): SteamSessionReader & {
  readonly held: StoredSteamSession | null;
  readonly clears: number;
} {
  let held = initial;
  let clears = 0;
  return {
    load: async () => {
      if (failure) throw failure;
      return held;
    },
    save: async (value: unknown) => {
      held = parseSteamSession(value);
    },
    clear: async () => {
      clears += 1;
      held = null;
    },
    get held() {
      return held;
    },
    get clears() {
      return clears;
    },
  };
}

/** An acquisition that records whether it was reached at all. */
function fakeAcquire(token: string | null): (() => Promise<string | null>) & {
  readonly calls: number;
} {
  let calls = 0;
  const acquire = async (): Promise<string | null> => {
    calls += 1;
    return token;
  };
  return Object.defineProperty(acquire, "calls", {
    get: () => calls,
  }) as (() => Promise<string | null>) & { readonly calls: number };
}

const NOW = 1_800_000_000_000;
const FRESH = "0123456789abcdef0123456789abcdef";
const ACQUIRED = "fedcba9876543210fedcba9876543210";

describe("deciding which Steam token to vend", () => {
  it("replays a stored token that has not expired, without opening a window", async () => {
    // Covers AE5: a relaunch reaches the game with no Steam prompt.
    const store = fakeStore({ token: FRESH, expiry: NOW + 1000 });
    const acquire = fakeAcquire(ACQUIRED);

    const resolution = await resolveSteamToken(store, {
      silent: true,
      acquire,
      now: NOW,
    });

    assert.equal(resolution.token, FRESH);
    assert.equal(acquire.calls, 0, "acquisition must not run when a token works");
    assert.deepEqual(resolution.notes, []);
  });

  it("replays a stored token whose expiry is not known yet", async () => {
    const store = fakeStore({ token: FRESH, expiry: null });
    const resolution = await resolveSteamToken(store, {
      silent: true,
      acquire: fakeAcquire(null),
      now: NOW,
    });
    assert.equal(resolution.token, FRESH);
  });

  it("answers a silent request with nothing rather than opening a window", async () => {
    // Covers AE1 / R4. This is the launch-time request: it must never put a
    // Steam window in front of a player who did not ask for one.
    const store = fakeStore(null);
    const acquire = fakeAcquire(ACQUIRED);

    const resolution = await resolveSteamToken(store, {
      silent: true,
      acquire,
      now: NOW,
    });

    assert.equal(resolution.token, null);
    assert.equal(acquire.calls, 0, "a silent request must not acquire");
    assert.equal(store.held, null);
  });

  it("acquires on a non-silent request and stores what it got", async () => {
    // Covers R5: the button click is what may open a window.
    const store = fakeStore(null);
    const acquire = fakeAcquire(ACQUIRED);

    const resolution = await resolveSteamToken(store, {
      silent: false,
      acquire,
      now: NOW,
    });

    assert.equal(resolution.token, ACQUIRED);
    assert.equal(acquire.calls, 1);
    assert.deepEqual(store.held, {
      token: ACQUIRED,
      expiry: NOW + STEAM_TOKEN_LIFETIME_MS,
    });
    assert.deepEqual(resolution.notes, [{ note: "acquired" }]);
  });

  it("reports a sign-in that did not complete without storing anything", async () => {
    const store = fakeStore(null);
    const resolution = await resolveSteamToken(store, {
      silent: false,
      acquire: fakeAcquire(null),
      now: NOW,
    });
    assert.equal(resolution.token, null);
    assert.equal(store.held, null);
  });

  it("treats an expired token as absent and discards it", async () => {
    const store = fakeStore({ token: FRESH, expiry: NOW - 1 });
    const acquire = fakeAcquire(ACQUIRED);

    const silent = await resolveSteamToken(store, {
      silent: true,
      acquire,
      now: NOW,
    });

    assert.equal(silent.token, null);
    assert.equal(acquire.calls, 0);
    assert.equal(store.clears, 1, "an expired token is useless and is discarded");
    assert.deepEqual(silent.notes, [{ note: "expired" }]);
  });

  it("re-acquires when the expired token is met with a real request", async () => {
    const store = fakeStore({ token: FRESH, expiry: NOW - 1 });
    const acquire = fakeAcquire(ACQUIRED);

    const resolution = await resolveSteamToken(store, {
      silent: false,
      acquire,
      now: NOW,
    });

    assert.equal(resolution.token, ACQUIRED);
    assert.equal(acquire.calls, 1);
    assert.deepEqual(store.held, {
      token: ACQUIRED,
      expiry: NOW + STEAM_TOKEN_LIFETIME_MS,
    });
  });

  it("treats an unreadable store as absent and keeps the file", async () => {
    // Covers AE6 / R8. Encryption can be momentarily unavailable, and deleting
    // on that would throw away a credential that still works. The launch must
    // survive it, and the file must not.
    const failure = new AppError("steam_session_corrupt", "unreadable");
    const store = fakeStore({ token: FRESH, expiry: null }, failure);

    const resolution = await resolveSteamToken(store, {
      silent: true,
      acquire: fakeAcquire(null),
      now: NOW,
    });

    assert.equal(resolution.token, null);
    assert.equal(store.clears, 0, "a failed read must not delete the token");
    assert.deepEqual(resolution.notes, [
      { note: "loadFailed", code: "steam_session_corrupt" },
    ]);
  });

  it("still vends an acquired token when storing it fails", async () => {
    // Losing persistence costs the player a prompt next launch; failing the
    // request would cost them this login.
    const store: SteamSessionReader = {
      load: async () => null,
      save: async () => {
        throw new AppError("steam_session_unavailable", "no encryption");
      },
      clear: async () => undefined,
    };

    const resolution = await resolveSteamToken(store, {
      silent: false,
      acquire: fakeAcquire(ACQUIRED),
      now: NOW,
    });

    assert.equal(resolution.token, ACQUIRED);
    assert.deepEqual(resolution.notes, [
      { note: "storeFailed", code: "steam_session_unavailable" },
    ]);
  });
});

describe("the client handing a token back", () => {
  it("refreshes the expiry of the token it already holds", async () => {
    const store = fakeStore({ token: FRESH, expiry: NOW });
    const outcome = await refreshSteamExpiry(store, FRESH, NOW + 5000);
    assert.equal(outcome, "refreshed");
    assert.deepEqual(store.held, { token: FRESH, expiry: NOW + 5000 });
  });

  it("ignores a storeback that is not the token it holds", async () => {
    // KTD5. The client's storeback has never been observed carrying the Steam
    // token itself, and persisting a session-resume token in its place would
    // overwrite a working credential with one that fails at the login screen.
    const store = fakeStore({ token: FRESH, expiry: NOW });
    for (const other of ["", "some-other-value", ACQUIRED]) {
      assert.equal(await refreshSteamExpiry(store, other, NOW + 5000), "ignored");
      assert.deepEqual(store.held, { token: FRESH, expiry: NOW });
    }
  });

  it("ignores a storeback when nothing is stored at all", async () => {
    const store = fakeStore(null);
    assert.equal(await refreshSteamExpiry(store, FRESH, NOW), "ignored");
    assert.equal(store.held, null);
  });

  it("reports a refresh it could not write", async () => {
    const store: SteamSessionReader = {
      load: async () => ({ token: FRESH, expiry: NOW }),
      save: async () => {
        throw new AppError("steam_session_unavailable", "no encryption");
      },
      clear: async () => undefined,
    };
    assert.equal(await refreshSteamExpiry(store, FRESH, NOW + 1), "failed");
  });

  it("reports an unreadable store rather than overwriting it", async () => {
    const store = fakeStore(
      { token: FRESH, expiry: NOW },
      new AppError("steam_session_corrupt", "unreadable"),
    );
    assert.equal(await refreshSteamExpiry(store, FRESH, NOW + 1), "failed");
    assert.deepEqual(store.held, { token: FRESH, expiry: NOW });
  });
});
