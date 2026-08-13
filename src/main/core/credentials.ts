/**
 * The ArenaNet saved login: its shape rule and its one Keychain slot.
 *
 * `parseCredentials` is what the IPC boundary runs on whatever the renderer
 * sent and what runs again on whatever came back out of the Keychain, so a
 * value becomes `StoredCredentials` exactly one way. It is written for this
 * payload alone and must not be widened to admit another secret's shape; the
 * Steam token supplies its own validator to the same `KeychainJsonStore`.
 *
 * Neither field may reach a log, a diagnostic export, browser storage or a
 * profile file. This module hands them to the Keychain and to the caller that
 * asked, and nowhere else.
 */
import type { StoredCredentials } from "../../shared/contracts.js";
import { AppError } from "../../shared/errors.js";
import type { NativeKeychain, SecretSlot } from "./native-keychain.js";
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
  constructor(
    keychain: NativeKeychain,
    slot: SecretSlot = "arenaNetCredentials",
  ) {
    super(slot, keychain, CREDENTIALS);
  }
}
