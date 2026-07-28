import { AppError } from "../../shared/errors.js";
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

const MAX_TOKEN_LENGTH = 4096;

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
