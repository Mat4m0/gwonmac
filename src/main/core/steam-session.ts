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

/** The Steam token's one persistent home (R6, R23). */
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
  | { note: "storeFailed"; code: ErrorCode };

export interface SteamResolution {
  token: string | null;
  notes: SteamResolutionNote[];
}

export interface SteamResolutionOptions {
  /**
   * Whether this is the client's launch-time probe. A silent request may only
   * read what is already stored — it must never put a Steam window in front of
   * a player who did not ask for one (R4).
   */
  silent: boolean;
  /** Runs the sign-in flow. Resolves to `null` when it did not complete. */
  acquire: () => Promise<string | null>;
  now?: number;
}

/**
 * Which token to vend: the stored one while it is still good, otherwise a newly
 * acquired one, otherwise none (KTD4). There is no third source — no
 * environment variable seeds this at any tier (KD4, R23).
 *
 * Nothing here throws. A player whose stored token is expired, revoked, or
 * unreadable belongs back at the login screen with both sign-in buttons on it,
 * not looking at a launch that died because a file would not decrypt (R8).
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

  if (stored) {
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

  const acquired = await options.acquire();
  if (!acquired) return { token: null, notes };

  try {
    await store.save({ token: acquired, expiry: now + STEAM_TOKEN_LIFETIME_MS });
    notes.push({ note: "acquired" });
  } catch (error) {
    // The token still authenticates this session; all that is lost is not
    // having to sign in again next launch.
    notes.push({ note: "storeFailed", code: errorCode(error) });
  }
  return { token: acquired, notes };
}

export type SteamStorebackOutcome = "refreshed" | "ignored" | "failed";

/**
 * Take the expiry the account service supplied through the client's storeback,
 * and only for the token already held (KTD5, R9).
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
): Promise<SteamStorebackOutcome> {
  let stored: StoredSteamSession | null;
  try {
    stored = await store.load();
  } catch {
    return "failed";
  }
  if (!stored || !token || token !== stored.token) return "ignored";
  try {
    await store.save({ token: stored.token, expiry });
    return "refreshed";
  } catch {
    return "failed";
  }
}
