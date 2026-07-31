import type { StoredCredentials } from "../../shared/contracts.js";
import { AppError } from "../../shared/errors.js";
import type { NativeKeychain } from "./native-keychain.js";
import { KeychainJsonStore, type KeychainSecret } from "./keychain-store.js";

/**
 * The one credential shape check. Called on two different inputs: whatever the
 * renderer sent, at the IPC boundary, and whatever was on disk, after
 * decryption. Exported so the boundary uses this rule rather than a second one.
 */
export function parseCredentials(value: unknown): StoredCredentials {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    typeof (value as StoredCredentials).username !== "string" ||
    typeof (value as StoredCredentials).password !== "string"
  ) {
    throw new AppError("credentials_corrupt", "saved credentials are invalid");
  }
  const { username, password } = value as StoredCredentials;
  if (username.length > 4096 || password.length > 4096) {
    throw new AppError("credentials_corrupt", "saved credentials are invalid");
  }
  return { username, password };
}

const CREDENTIALS: KeychainSecret<StoredCredentials> = {
  parse: parseCredentials,
  unavailable: () =>
    new AppError("credentials_unavailable", "saved credentials are unavailable"),
  corrupt: () =>
    new AppError("credentials_corrupt", "saved credentials are invalid"),
};

/** The ArenaNet saved login's fixed Data Protection Keychain item. */
export class CredentialsStore extends KeychainJsonStore<StoredCredentials> {
  constructor(keychain: NativeKeychain) {
    super("arenaNetCredentials", keychain, CREDENTIALS);
  }
}
