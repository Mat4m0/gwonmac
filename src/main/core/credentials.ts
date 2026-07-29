import type { StoredCredentials } from "../../shared/contracts.js";
import { AppError } from "../../shared/errors.js";
import {
  EncryptedJsonStore,
  type EncryptedSecret,
  type SafeStorageApi,
} from "./encrypted-store.js";

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

const CREDENTIALS: EncryptedSecret<StoredCredentials> = {
  parse: parseCredentials,
  unavailable: () =>
    new AppError("credentials_unavailable", "credential encryption is unavailable"),
  undecryptable: () =>
    new AppError("credentials_corrupt", "saved credentials cannot be decrypted"),
};

/**
 * The saved login's one encrypted owner-only file.
 *
 * The encrypt / atomic-write / validate-both-ways mechanism moved to
 * `EncryptedJsonStore` when the Steam session needed the same guarantees.
 * Nothing about this store's behaviour moved with it: the shape rule above and
 * the two error codes are unchanged, which is what
 * `tests/unit/credentials.test.ts` proves.
 */
export class CredentialsStore extends EncryptedJsonStore<StoredCredentials> {
  constructor(path: string, storage: SafeStorageApi) {
    super(path, storage, CREDENTIALS);
  }
}
