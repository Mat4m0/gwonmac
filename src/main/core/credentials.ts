import { chmod, readFile, unlink } from "node:fs/promises";
import type { StoredCredentials } from "../../shared/contracts.js";
import { AppError } from "../../shared/errors.js";
import { writeAtomic } from "./atomic-file.js";

export interface SafeStorageApi {
  isEncryptionAvailable(): boolean;
  encryptString(value: string): Buffer;
  decryptString(value: Buffer): string;
}

function parseCredentials(value: unknown): StoredCredentials {
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

export class CredentialsStore {
  private readonly path: string;
  private readonly storage: SafeStorageApi;

  constructor(
    path: string,
    storage: SafeStorageApi,
  ) {
    this.path = path;
    this.storage = storage;
  }

  async load(): Promise<StoredCredentials | null> {
    let ciphertext: Buffer;
    try {
      ciphertext = await readFile(this.path);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
    if (!this.storage.isEncryptionAvailable()) {
      throw new AppError("credentials_unavailable", "credential encryption is unavailable");
    }
    try {
      return parseCredentials(JSON.parse(this.storage.decryptString(ciphertext)));
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError("credentials_corrupt", "saved credentials cannot be decrypted");
    }
  }

  async save(value: StoredCredentials): Promise<void> {
    const cleaned = parseCredentials(value);
    if (!this.storage.isEncryptionAvailable()) {
      throw new AppError("credentials_unavailable", "credential encryption is unavailable");
    }
    const ciphertext = this.storage.encryptString(JSON.stringify(cleaned));
    await writeAtomic(this.path, ciphertext, 0o600);
    await chmod(this.path, 0o600);
  }

  async clear(): Promise<void> {
    try {
      await unlink(this.path);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
}
