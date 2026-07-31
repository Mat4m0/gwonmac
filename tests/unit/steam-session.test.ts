import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type {
  NativeKeychain,
  SecretSlot,
} from "../../src/main/core/native-keychain.js";
import type { SteamRefusalReason } from "../../src/shared/contracts.js";
import {
  parseSteamSession,
  refreshSteamExpiry,
  resolveSteamToken,
  STEAM_TOKEN_LIFETIME_MS,
  SteamSessionCoordinator,
  SteamSessionStore,
  steamTokenOutcome,
  type SteamSessionReader,
  type StoredSteamSession,
} from "../../src/main/core/steam-session.js";
import { AppError } from "../../src/shared/errors.js";

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

function storeIn(): { keychain: FakeKeychain; store: SteamSessionStore } {
  const keychain = new FakeKeychain();
  return { keychain, store: new SteamSessionStore(keychain) };
}

const TOKEN = "0123456789abcdef0123456789abcdef";

describe("the Steam session store", () => {
  it("round-trips the fixed Steam slot and clears it", async () => {
    const { keychain, store } = storeIn();
    const session = { token: TOKEN, expiry: 1_800_000_000_000 };

    assert.equal(await store.load(), null);
    await store.save(session);
    assert.deepEqual(await store.load(), session);

    assert.equal(keychain.values.has("arenaNetCredentials"), false);

    await store.clear();
    assert.equal(await store.load(), null);
  });

  it("keeps a record whose expiry the account service has not supplied", async () => {
    // An acquired token is stored before any server expiry is known. `null`
    // is that state, and it must survive the round-trip rather than being read
    // back as a token that expired at the epoch.
    const { store } = storeIn();
    await store.save({ token: TOKEN, expiry: null });
    assert.deepEqual(await store.load(), { token: TOKEN, expiry: null });
  });

  it("reports an absent store as absent, not as a failure", async () => {
    const { store } = storeIn();
    assert.equal(await store.load(), null);
  });

  it("maps native failure to the Steam session vocabulary", async () => {
    const { keychain, store } = storeIn();
    keychain.failure = new Error("injected native failure");
    await assert.rejects(
      store.save({ token: TOKEN, expiry: null }),
      (error: unknown) =>
        error instanceof AppError && error.code === "steam_session_unavailable",
    );
  });

  it("refuses invalid bytes without destroying them", async () => {
    // The token is the only thing standing between the player and a Steam
    // prompt. A read that fails because encryption was momentarily unavailable
    // must not throw away a credential that still works.
    const { keychain, store } = storeIn();
    keychain.values.set("steamSession", Buffer.from([0xff]));
    await assert.rejects(
      store.load(),
      (error: unknown) => error instanceof AppError && error.code === "steam_session_corrupt",
    );
    assert.ok(
      keychain.values.has("steamSession"),
      "a failed read must not delete the stored token",
    );
  });

  it("rejects an invalid record before replacing a stored one", async () => {
    const { keychain, store } = storeIn();
    await store.save({ token: TOKEN, expiry: null });
    const before = Buffer.from(keychain.values.get("steamSession")!);
    await assert.rejects(
      store.save({ token: "", expiry: null }),
      (error: unknown) => error instanceof AppError && error.code === "steam_session_corrupt",
    );
    assert.deepEqual(keychain.values.get("steamSession"), before);
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
 * different outcomes and launch behavior turns on which one happens.
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

type AcquireAnswer = { token: string | null; refusal?: SteamRefusalReason };

/** An acquisition that records whether it was reached at all. */
function fakeAcquire(
  token: string | null,
  refusal?: SteamRefusalReason,
): (() => Promise<AcquireAnswer>) & {
  readonly calls: number;
} {
  let calls = 0;
  const acquire = async (): Promise<AcquireAnswer> => {
    calls += 1;
    return { token, ...(refusal ? { refusal } : {}) };
  };
  return Object.defineProperty(acquire, "calls", {
    get: () => calls,
  }) as (() => Promise<AcquireAnswer>) & { readonly calls: number };
}

const NOW = 1_800_000_000_000;
const FRESH = "0123456789abcdef0123456789abcdef";
const ACQUIRED = "fedcba9876543210fedcba9876543210";

describe("deciding which Steam token to vend", () => {
  it("replays a stored token that has not expired, without opening a window", async () => {
    // A relaunch reaches the game with no Steam prompt.
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
    // This is the launch-time request: it must never put a
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
    // The button click is what may open a window.
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

  it("replaces a locally valid token on an explicit request", async () => {
    const store = fakeStore({ token: FRESH, expiry: NOW + 1_000 });
    const acquire = fakeAcquire(ACQUIRED);

    const resolution = await resolveSteamToken(store, {
      silent: false,
      acquire,
      now: NOW,
    });

    assert.equal(resolution.token, ACQUIRED);
    assert.equal(acquire.calls, 1);
    assert.equal(store.clears, 1);
    assert.deepEqual(store.held, {
      token: ACQUIRED,
      expiry: NOW + STEAM_TOKEN_LIFETIME_MS,
    });
  });

  it("does not replay a rejected token when explicit reauthentication is cancelled", async () => {
    const store = fakeStore({ token: FRESH, expiry: NOW + 1_000 });

    const resolution = await resolveSteamToken(store, {
      silent: false,
      acquire: fakeAcquire(null),
      now: NOW,
    });

    assert.equal(resolution.token, null);
    assert.equal(store.held, null);
    assert.equal(store.clears, 1);
  });

  it("refuses an implausibly long token instead of handing it to the client", async () => {
    // Persistence would reject it, but a failed store is tolerated by design —
    // so without a check here the token would still reach the client and be
    // copied into wasm memory.
    const store = fakeStore(null);
    const resolution = await resolveSteamToken(store, {
      silent: false,
      acquire: fakeAcquire("x".repeat(4097)),
      now: NOW,
    });
    assert.equal(resolution.token, null);
    assert.deepEqual(resolution.notes, [
      { note: "acquireFailed", code: "steam_session_corrupt" },
    ]);
    assert.equal(store.held, null);
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

  it("carries the sign-in refusal reason through to the caller", async () => {
    // The reason is what lets the renderer explain a failed sign-in instead
    // of silently redrawing the login screen.
    const store = fakeStore(null);
    const refused = await resolveSteamToken(store, {
      silent: false,
      acquire: fakeAcquire(null, "no-token"),
      now: NOW,
    });
    assert.equal(refused.token, null);
    assert.equal(refused.refusal, "no-token");

    // A throwing acquisition and an implausible token both read as "failed".
    const threw = await resolveSteamToken(store, {
      silent: false,
      acquire: () => Promise.reject(new Error("window construction failed")),
      now: NOW,
    });
    assert.equal(threw.refusal, "failed");
    const oversized = await resolveSteamToken(store, {
      silent: false,
      acquire: fakeAcquire("x".repeat(4097)),
      now: NOW,
    });
    assert.equal(oversized.refusal, "failed");

    // A silent probe with nothing stored is a normal launch, not a refusal.
    const silent = await resolveSteamToken(store, {
      silent: true,
      acquire: fakeAcquire(null),
      now: NOW,
    });
    assert.equal(silent.token, null);
    assert.equal(silent.refusal, undefined);

    // A vended token never carries one.
    const vended = await resolveSteamToken(store, {
      silent: false,
      acquire: fakeAcquire(ACQUIRED),
      now: NOW,
    });
    assert.equal(vended.token, ACQUIRED);
    assert.equal(vended.refusal, undefined);
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
    // Encryption can be momentarily unavailable, and deleting
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
    // Both notes: a window opened *and* the write failed. `acquired` records
    // where the token came from, so a diagnostics reader can still tell this
    // from a token replayed off disk.
    assert.deepEqual(resolution.notes, [
      { note: "acquired" },
      { note: "storeFailed", code: "steam_session_unavailable" },
    ]);
  });
});

describe("keeping its promise never to throw", () => {
  it("reports an acquisition that threw instead of letting it escape", async () => {
    // `resolveSteamToken` is documented as never throwing, and the IPC handler
    // is written against that. A window that fails to construct — a parent
    // destroyed mid-request during quit — must not surface as a rejected IPC
    // call with no diagnostic behind it.
    const store = fakeStore(null);
    const resolution = await resolveSteamToken(store, {
      silent: false,
      acquire: () => {
        throw new AppError("not_ready", "the parent window is gone");
      },
      now: NOW,
    });

    assert.equal(resolution.token, null);
    assert.deepEqual(resolution.notes, [
      { note: "acquireFailed", code: "not_ready" },
    ]);
    assert.equal(store.held, null);
  });

  it("reports an acquisition that rejected asynchronously", async () => {
    const store = fakeStore(null);
    const resolution = await resolveSteamToken(store, {
      silent: false,
      acquire: async () => {
        await Promise.resolve();
        throw new Error("something Electron did");
      },
      now: NOW,
    });
    assert.equal(resolution.token, null);
    assert.deepEqual(resolution.notes, [{ note: "acquireFailed", code: "unknown" }]);
  });
});

describe("ordering complete Steam session operations", () => {
  it("makes clear final when acquisition was already in flight", async () => {
    const store = fakeStore(null);
    const steam = new SteamSessionCoordinator(store);
    let finishAcquire!: (answer: AcquireAnswer) => void;
    const acquired = new Promise<AcquireAnswer>((resolve) => {
      finishAcquire = resolve;
    });

    const resolution = steam.resolve({
      silent: false,
      acquire: () => acquired,
      now: NOW,
    });
    await Promise.resolve();
    const cleared = steam.clear();

    finishAcquire({ token: ACQUIRED });
    assert.equal((await resolution).token, ACQUIRED);
    await cleared;
    assert.equal(store.held, null);
  });

  it("makes clear final when storeback was already in flight", async () => {
    let held: StoredSteamSession | null = { token: FRESH, expiry: NOW + 1_000 };
    let finishLoad!: (value: StoredSteamSession | null) => void;
    const loaded = new Promise<StoredSteamSession | null>((resolve) => {
      finishLoad = resolve;
    });
    const store: SteamSessionReader = {
      load: () => loaded,
      save: async (value) => {
        held = parseSteamSession(value);
      },
      clear: async () => {
        held = null;
      },
    };
    const steam = new SteamSessionCoordinator(store);

    const refreshed = steam.refresh(FRESH, Date.now() + 60_000);
    await Promise.resolve();
    const cleared = steam.clear();
    finishLoad(held);

    assert.equal(await refreshed, "refreshed");
    await cleared;
    assert.equal(held, null);
  });

  it("does not let an older storeback overwrite a newer resolution", async () => {
    let held: StoredSteamSession | null = { token: FRESH, expiry: NOW - 1 };
    let finishFirstLoad!: (value: StoredSteamSession | null) => void;
    const firstLoad = new Promise<StoredSteamSession | null>((resolve) => {
      finishFirstLoad = resolve;
    });
    let loads = 0;
    const store: SteamSessionReader = {
      load: () => {
        loads += 1;
        return loads === 1 ? firstLoad : Promise.resolve(held);
      },
      save: async (value) => {
        held = parseSteamSession(value);
      },
      clear: async () => {
        held = null;
      },
    };
    const steam = new SteamSessionCoordinator(store);

    const refreshed = steam.refresh(FRESH, Date.now() + 60_000);
    await Promise.resolve();
    const resolution = steam.resolve({
      silent: false,
      acquire: fakeAcquire(ACQUIRED),
      now: NOW,
    });
    finishFirstLoad(held);

    assert.equal(await refreshed, "refreshed");
    assert.equal((await resolution).token, ACQUIRED);
    assert.equal(held?.token, ACQUIRED);
  });

  it("continues after a queued operation rejects", async () => {
    let clears = 0;
    const steam = new SteamSessionCoordinator({
      load: async () => null,
      save: async () => undefined,
      clear: async () => {
        clears += 1;
        if (clears === 1) throw new Error("transient unlink failure");
      },
    });

    await assert.rejects(steam.clear(), /transient unlink failure/u);
    await steam.clear();
    assert.equal(clears, 2);
  });

  it("lets quit wait for the last queued secret write", async () => {
    let finishSave!: () => void;
    const saved = new Promise<void>((resolve) => {
      finishSave = resolve;
    });
    const steam = new SteamSessionCoordinator({
      load: async () => ({ token: FRESH, expiry: NOW + 1_000 }),
      save: () => saved,
      clear: async () => undefined,
    });

    const refresh = steam.refresh(FRESH, Date.now() + 60_000);
    let settled = false;
    const drain = steam.settled().then(() => {
      settled = true;
    });
    await Promise.resolve();
    assert.equal(settled, false);
    finishSave();
    await Promise.all([refresh, drain]);
    assert.equal(settled, true);
  });

  it("coalesces concurrent interactive resolutions", async () => {
    const store = fakeStore(null);
    const steam = new SteamSessionCoordinator(store);
    let finishAcquire!: (answer: AcquireAnswer) => void;
    let calls = 0;
    const acquired = new Promise<AcquireAnswer>((resolve) => {
      finishAcquire = resolve;
    });
    const acquire = (): Promise<AcquireAnswer> => {
      calls += 1;
      return acquired;
    };

    const first = steam.resolve({ silent: false, acquire, now: NOW });
    const second = steam.resolve({ silent: false, acquire, now: NOW });
    finishAcquire({ token: ACQUIRED });

    assert.deepEqual(await first, await second);
    assert.equal(calls, 1);
  });
});

describe("how a resolution reads in diagnostics", () => {
  it("separates a replayed token from a freshly acquired one", () => {
    assert.equal(steamTokenOutcome({ token: FRESH, notes: [] }), "vended");
    assert.equal(
      steamTokenOutcome({ token: ACQUIRED, notes: [{ note: "acquired" }] }),
      "acquired",
    );
    assert.equal(steamTokenOutcome({ token: null, notes: [] }), "absent");
  });

  it("still calls it acquired when only persisting the token failed", () => {
    // A window opened and a token was obtained; only the save failed. Reporting
    // that as `vended` would point whoever reads a "Steam asks me to sign in
    // every launch" export at the store instead of at the failed write. This is
    // the note pair `resolveSteamToken` actually produces on that path.
    assert.equal(
      steamTokenOutcome({
        token: ACQUIRED,
        notes: [
          { note: "acquired" },
          { note: "storeFailed", code: "steam_session_unavailable" },
        ],
      }),
      "acquired",
    );
  });

  it("calls a failed acquisition absent, not acquired", () => {
    assert.equal(
      steamTokenOutcome({
        token: null,
        notes: [{ note: "acquireFailed", code: "unknown" }],
      }),
      "absent",
    );
  });

  it("reads an expired-then-replaced token as acquired", () => {
    assert.equal(
      steamTokenOutcome({
        token: ACQUIRED,
        notes: [{ note: "expired" }, { note: "acquired" }],
      }),
      "acquired",
    );
  });
});

describe("the client handing a token back", () => {
  it("refreshes the expiry of the token it already holds", async () => {
    const store = fakeStore({ token: FRESH, expiry: NOW });
    const outcome = await refreshSteamExpiry(store, FRESH, NOW + 5000);
    assert.equal(outcome, "refreshed");
    assert.deepEqual(store.held, { token: FRESH, expiry: NOW + 5000 });
  });

  it("refuses an expiry that has already passed", async () => {
    // The storeback only runs after the account service accepted the token, so
    // a past expiry contradicts itself. Writing one would make the next launch
    // read the record as expired and *delete* it, costing the player a sign-in
    // they were told was once-per-machine. `new Date(0)` is the likely accident;
    // the same call is reachable from the renderer, which is the abuse.
    const store = fakeStore({ token: FRESH, expiry: NOW });
    for (const past of [0, -1, 1, Date.now() - 1_000]) {
      assert.equal(await refreshSteamExpiry(store, FRESH, past), "ignored", String(past));
      assert.deepEqual(store.held, { token: FRESH, expiry: NOW });
    }
  });

  it("still accepts an expiry in the future", async () => {
    const store = fakeStore({ token: FRESH, expiry: NOW });
    const future = NOW + 60_000;
    assert.equal(await refreshSteamExpiry(store, FRESH, future, NOW), "refreshed");
    assert.deepEqual(store.held, { token: FRESH, expiry: future });
  });

  it("never extends persistence beyond the OAuth lifetime", async () => {
    for (const supplied of [
      NOW + STEAM_TOKEN_LIFETIME_MS + 1,
      Number.MAX_SAFE_INTEGER,
      Number.MAX_VALUE,
    ]) {
      const store = fakeStore({ token: FRESH, expiry: NOW + 1 });
      assert.equal(
        await refreshSteamExpiry(store, FRESH, supplied, NOW),
        "refreshed",
      );
      assert.deepEqual(store.held, {
        token: FRESH,
        expiry: NOW + STEAM_TOKEN_LIFETIME_MS,
      });
    }
  });

  it("keeps an expiry exactly at the maximum boundary", async () => {
    const store = fakeStore({ token: FRESH, expiry: NOW + 1 });
    const maximum = NOW + STEAM_TOKEN_LIFETIME_MS;
    assert.equal(
      await refreshSteamExpiry(store, FRESH, maximum, NOW),
      "refreshed",
    );
    assert.deepEqual(store.held, { token: FRESH, expiry: maximum });
  });

  it("rejects an expiry at the current instant", async () => {
    const store = fakeStore({ token: FRESH, expiry: NOW + 1 });
    assert.equal(await refreshSteamExpiry(store, FRESH, NOW, NOW), "ignored");
    assert.deepEqual(store.held, { token: FRESH, expiry: NOW + 1 });
  });

  it("refuses to turn a known expiry back into an unknown one", async () => {
    // Writing `null` over the flow's own one-year lifetime would leave a record
    // that never self-expires, so the app would keep replaying a dead token
    // rather than asking the player to sign in again.
    const store = fakeStore({ token: FRESH, expiry: NOW + 60_000 });
    assert.equal(await refreshSteamExpiry(store, FRESH, null), "ignored");
    assert.deepEqual(store.held, { token: FRESH, expiry: NOW + 60_000 });
  });

  it("accepts no-expiry-yet when none is known either way", async () => {
    const store = fakeStore({ token: FRESH, expiry: null });
    assert.equal(await refreshSteamExpiry(store, FRESH, null), "refreshed");
    assert.deepEqual(store.held, { token: FRESH, expiry: null });
  });

  it("ignores a storeback that is not the token it holds", async () => {
    // The client's storeback has never been observed carrying the Steam
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
