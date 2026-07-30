import type { SteamRefusalReason } from "../../shared/contracts.js";
import { AppError, errorCode, type ErrorCode } from "../../shared/errors.js";
import {
  EncryptedJsonStore,
  type EncryptedSecret,
  type SafeStorageApi,
} from "./encrypted-store.js";

/**
 * The Steam OAuth access token that authenticates a Steam login, and when it
 * stops working.
 *
 * A sibling of `StoredCredentials` rather than an extension of it. The two
 * secrets get the same protection but do not have the same shape, and
 * `parseCredentials` is the validator the credential IPC boundary runs — a
 * token that had to pass through it would mean loosening a security rule for a
 * payload it was never written for.
 *
 * `expiry` is epoch milliseconds, or `null` for a record whose expiry the
 * account service has not supplied yet. A freshly acquired token is stored
 * with the OAuth flow's own lifetime; `null` is the state where even that is
 * unknown, and it means "ask the login exchange", not "already expired".
 */
export interface StoredSteamSession {
  token: string;
  expiry: number | null;
}

/**
 * Shared with the IPC boundary parser in `src/main/ipc.ts`, which caps the
 * client's storeback before it reaches this validator. One bound, named once.
 */
export const MAX_TOKEN_LENGTH = 4096;

/**
 * The one Steam session shape check, run on both the value handed in and the
 * value read back off disk — the same arrangement `parseCredentials` has.
 *
 * Deliberately permissive about the token's *content*: this is the storage
 * rule, and the observed token shape is an ArenaNet implementation detail that
 * a future build is free to change. What must not reach the store is a value
 * that cannot be replayed at all — an absent, empty, or implausibly long
 * token, or an expiry that is not a real point in time.
 */
export function parseSteamSession(value: unknown): StoredSteamSession {
  const invalid = () =>
    new AppError("steam_session_corrupt", "the stored Steam session is invalid");
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw invalid();
  }
  const { token, expiry } = value as StoredSteamSession;
  if (typeof token !== "string" || token.length === 0 || token.length > MAX_TOKEN_LENGTH) {
    throw invalid();
  }
  if (expiry !== null && !(typeof expiry === "number" && Number.isFinite(expiry))) {
    throw invalid();
  }
  return { token, expiry };
}

const STEAM_SESSION: EncryptedSecret<StoredSteamSession> = {
  parse: parseSteamSession,
  unavailable: () =>
    new AppError("steam_session_unavailable", "Steam session encryption is unavailable"),
  undecryptable: () =>
    new AppError("steam_session_corrupt", "the stored Steam session cannot be decrypted"),
};

/** The Steam token's one persistent home. */
export class SteamSessionStore extends EncryptedJsonStore<StoredSteamSession> {
  constructor(path: string, storage: SafeStorageApi) {
    super(path, storage, STEAM_SESSION);
  }
}

/** The half of the store resolution needs, so a test can supply one. */
export type SteamSessionReader = Pick<SteamSessionStore, "load" | "save" | "clear">;

/**
 * The lifetime the OAuth flow itself grants: `expiresIn = 31536000` seconds,
 * read out of the official client. A freshly acquired token is stored with this
 * rather than with nothing, so an expiry is known before the account service
 * ever supplies one.
 */
export const STEAM_TOKEN_LIFETIME_MS = 31_536_000 * 1000;

/**
 * What happened on the way to an answer, for the caller to record.
 *
 * Returned as values rather than logged here: this module is Electron-free and
 * has no business knowing what a diagnostics event is, and a test can then
 * assert on the audit trail instead of on a spy. No note carries a token.
 */
export type SteamResolutionNote =
  | { note: "loadFailed"; code: ErrorCode }
  | { note: "expired" }
  | { note: "acquired" }
  | { note: "acquireFailed"; code: ErrorCode }
  | { note: "storeFailed"; code: ErrorCode };

export interface SteamResolution {
  token: string | null;
  notes: SteamResolutionNote[];
  /**
   * Why an interactive sign-in produced no token, for the renderer's status
   * line. Absent when a token was vended or when nothing interactive ran.
   */
  refusal?: SteamRefusalReason;
}

export interface SteamResolutionOptions {
  /**
   * Whether this is the client's launch-time probe. A silent request may only
   * read what is already stored — it must never put a Steam window in front of
   * a player who did not ask for one.
   */
  silent: boolean;
  /** Runs the sign-in flow. A `null` token carries why it did not complete. */
  acquire: () => Promise<{ token: string | null; refusal?: SteamRefusalReason }>;
  now?: number;
}

/**
 * Which token to vend: the stored one while it is still good, otherwise a newly
 * acquired one, otherwise none. There is no third source — no environment
 * variable seeds this at any tier.
 *
 * Nothing here throws. A player whose stored token is expired, revoked, or
 * unreadable belongs back at the login screen with both sign-in buttons on it,
 * not looking at a launch that died because a file would not decrypt.
 */
export async function resolveSteamToken(
  store: SteamSessionReader,
  options: SteamResolutionOptions,
): Promise<SteamResolution> {
  const now = options.now ?? Date.now();
  const notes: SteamResolutionNote[] = [];

  let stored: StoredSteamSession | null = null;
  try {
    stored = await store.load();
  } catch (error) {
    // Treated as absent and deliberately *not* deleted — the same rule the
    // credential store holds itself to. A read can fail because encryption is
    // momentarily unavailable, and deleting on that would throw away a working
    // credential over a transient fault.
    notes.push({ note: "loadFailed", code: errorCode(error) });
  }

  if (stored && options.silent) {
    // `expiry: null` means no expiry is known yet, not one that already passed;
    // the login exchange is what proves such a token.
    if (stored.expiry === null || stored.expiry > now) {
      return { token: stored.token, notes };
    }
    notes.push({ note: "expired" });
    // An expired token is useless to everyone, so unlike an unreadable one it
    // is discarded rather than kept.
    await store.clear().catch(() => undefined);
  }

  if (options.silent) return { token: null, notes };

  // A non-silent request is the player choosing Steam on the login screen.
  // Replaying the same locally unexpired token here can trap a server-revoked
  // credential in a year-long loop. A readable stored token has already failed
  // to get the player past that screen, so explicit intent discards it and
  // starts a fresh OAuth flow. An unreadable record is retained until a new
  // token can replace it, preserving the transient-read-failure guarantee.
  if (stored) {
    if (stored.expiry !== null && stored.expiry <= now) {
      notes.push({ note: "expired" });
    }
    await store.clear().catch(() => undefined);
  }

  let acquired: { token: string | null; refusal?: SteamRefusalReason };
  try {
    acquired = await options.acquire();
  } catch (error) {
    // `acquire` is documented as never throwing, and this is what makes that a
    // guarantee rather than a hope: every other fallible call here is guarded,
    // and leaving this one bare would let a construction failure escape the
    // "nothing here throws" contract the IPC handler is written against.
    notes.push({ note: "acquireFailed", code: errorCode(error) });
    return { token: null, notes, refusal: "failed" };
  }
  if (!acquired.token) {
    return {
      token: null,
      notes,
      ...(acquired.refusal ? { refusal: acquired.refusal } : {}),
    };
  }
  const token = acquired.token;
  // Check the acquired token before anything is done with it. Persistence would
  // reject an implausible one, but a `storeFailed` is tolerated by design — so
  // without this an oversized token from a malformed OAuth response would fail
  // to store and still be handed to the client and copied into wasm memory.
  if (token.length > MAX_TOKEN_LENGTH) {
    notes.push({ note: "acquireFailed", code: "steam_session_corrupt" });
    return { token: null, notes, refusal: "failed" };
  }

  // Recorded before the write, because it states where the token came from, not
  // whether it was stored. A failed save then carries both notes, and a reader
  // of the export can tell "a window opened" from "a token was replayed" even
  // when persistence failed.
  notes.push({ note: "acquired" });
  try {
    await store.save({ token, expiry: now + STEAM_TOKEN_LIFETIME_MS });
  } catch (error) {
    // The token still authenticates this session; all that is lost is not
    // having to sign in again next launch.
    notes.push({ note: "storeFailed", code: errorCode(error) });
  }
  return { token, notes };
}

export type SteamTokenOutcome = "vended" | "absent" | "acquired";

/**
 * How a resolution reads in diagnostics: replayed from the store, freshly
 * signed in for, or nothing to offer.
 *
 * `acquired` records provenance rather than persistence, so a sign-in whose
 * token could not be written still reads as `acquired` — a window *did* open.
 * Calling that `vended` would tell whoever reads the export that a stored token
 * was replayed, which is the opposite of what happened and sends them looking
 * in the wrong place for a "Steam asks me to sign in every launch" report.
 */
export function steamTokenOutcome(resolution: SteamResolution): SteamTokenOutcome {
  if (!resolution.token) return "absent";
  return resolution.notes.some((note) => note.note === "acquired")
    ? "acquired"
    : "vended";
}

export type SteamStorebackOutcome = "refreshed" | "ignored" | "failed";

/**
 * Take the expiry the account service supplied through the client's storeback,
 * and only for the token already held.
 *
 * Which value the client actually passes back after a Steam token replay has
 * never been isolated: the candidates are the empty refresh token this host
 * vends, the session-resume token the account service returns, and the link
 * token itself. Only the last can be replayed next launch, so matching against
 * what is stored is the check — persisting either of the others would overwrite
 * a working credential with one that fails at the login screen. Anything else
 * is ignored and reported by outcome, never by value.
 */
export async function refreshSteamExpiry(
  store: SteamSessionReader,
  token: string,
  expiry: number | null,
  now = Date.now(),
): Promise<SteamStorebackOutcome> {
  let stored: StoredSteamSession | null;
  try {
    stored = await store.load();
  } catch {
    return "failed";
  }
  if (!stored || !token || token !== stored.token) return "ignored";
  // A storeback only happens *after* the account service accepted the token, so
  // an expiry that has already passed contradicts itself — the credential
  // demonstrably works. Persisting one would replace a year-long credential
  // with a record the next launch reads as expired and deletes, costing the
  // player the sign-in they were promised was once-per-machine. `new Date(0)`
  // is a common "no date" encoding, and the same call is reachable from the
  // renderer, so this refuses both the accident and the abuse.
  if (expiry !== null && expiry <= now) return "ignored";
  // Nor may a storeback turn a known expiry back into an unknown one. Honor the
  // expiry the account service supplies when a login returns one; `null`
  // is the absence of one, and writing it over the flow's own lifetime would
  // leave a record that never self-expires and so keeps replaying a dead token
  // instead of asking the player to sign in again.
  if (expiry === null && stored.expiry !== null) return "ignored";
  // The renderer reports what the account service supplied; it does not own
  // local retention. Never let that boundary extend the bearer token beyond
  // the one-year lifetime established by the OAuth flow itself.
  const boundedExpiry =
    expiry === null ? null : Math.min(expiry, now + STEAM_TOKEN_LIFETIME_MS);
  try {
    await store.save({ token: stored.token, expiry: boundedExpiry });
    return "refreshed";
  } catch {
    return "failed";
  }
}

/**
 * Owns ordering across complete Steam-session operations.
 *
 * Serialising individual file calls would still allow a load/save operation to
 * straddle `clear()`. The coordinator queues the whole resolution or storeback
 * transaction, so when clear returns every older operation is finished and no
 * stale write can restore the token. Interactive callers additionally share
 * the one resolution already in flight, which preserves the one-window
 * invariant without putting Electron knowledge in this module.
 */
export class SteamSessionCoordinator {
  private tail: Promise<void> = Promise.resolve();
  private interactiveResolution: Promise<SteamResolution> | null = null;
  private readonly store: SteamSessionReader;

  constructor(store: SteamSessionReader) {
    this.store = store;
  }

  resolve(options: SteamResolutionOptions): Promise<SteamResolution> {
    if (options.silent) {
      return this.enqueue(() => resolveSteamToken(this.store, options));
    }
    if (this.interactiveResolution) return this.interactiveResolution;

    const pending = this.enqueue(() => resolveSteamToken(this.store, options));
    const joined = pending.finally(() => {
      if (this.interactiveResolution === joined) {
        this.interactiveResolution = null;
      }
    });
    this.interactiveResolution = joined;
    return joined;
  }

  refresh(token: string, expiry: number | null): Promise<SteamStorebackOutcome> {
    return this.enqueue(() => refreshSteamExpiry(this.store, token, expiry));
  }

  clear(): Promise<void> {
    return this.enqueue(() => this.store.clear());
  }

  settled(): Promise<void> {
    return this.tail;
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.tail.then(operation, operation);
    this.tail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }
}
