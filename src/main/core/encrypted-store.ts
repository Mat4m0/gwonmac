import { readFile, unlink } from "node:fs/promises";
import { AppError } from "../../shared/errors.js";
import { writeAtomic } from "./atomic-file.js";

export interface SafeStorageApi {
  isEncryptionAvailable(): boolean;
  encryptString(value: string): Buffer;
  decryptString(value: Buffer): string;
}

/**
 * What one kind of secret knows about itself: its shape and its failure
 * vocabulary. Everything else about storing it is identical, which is why the
 * store below is generic and this is the only thing that varies.
 *
 * Each secret owns its own error codes rather than sharing one pair. A
 * diagnostic that says a credential failed to decrypt when it was actually the
 * Steam token would send a reader to the wrong file.
 */
export interface EncryptedSecret<T> {
  /**
   * The one shape check, run on both the value handed in and the value read
   * back off disk. It throws its own `AppError`, so a rejected payload is
   * reported in the secret's own vocabulary.
   */
  parse(value: unknown): T;
  /** `safeStorage` cannot encrypt or decrypt at all on this machine. */
  unavailable(): AppError;
  /** Ciphertext exists but will not decrypt into a valid record. */
  undecryptable(): AppError;
}

/**
 * One secret, one owner-only encrypted file.
 *
 * This is the mechanism saved credentials have always used, lifted out so the
 * Steam session can have the same guarantees without a second copy of it:
 * `safeStorage` encryption, an atomic write at mode `0600`, and a validator run
 * on both directions of the boundary. The type parameter and the injected
 * `EncryptedSecret` are what let two different records share it while keeping
 * their own shape rules — notably, `parseCredentials` stays exactly the rule it
 * was.
 *
 * Electron-free by construction: `safeStorage` arrives as `SafeStorageApi`, so
 * `src/main/core/**` keeps its no-Electron boundary and a test can execute the
 * whole thing with a reversible stand-in.
 */
export class EncryptedJsonStore<T> {
  private readonly path: string;
  private readonly storage: SafeStorageApi;
  private readonly secret: EncryptedSecret<T>;

  constructor(path: string, storage: SafeStorageApi, secret: EncryptedSecret<T>) {
    this.path = path;
    this.storage = storage;
    this.secret = secret;
  }

  async load(): Promise<T | null> {
    let ciphertext: Buffer;
    try {
      ciphertext = await readFile(this.path);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
    if (!this.storage.isEncryptionAvailable()) {
      throw this.secret.unavailable();
    }
    try {
      return this.secret.parse(JSON.parse(this.storage.decryptString(ciphertext)));
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw this.secret.undecryptable();
    }
  }

  /**
   * Validate first, then write. A payload that fails the shape check must
   * leave whatever is already stored untouched — the stored copy is the one
   * that still works.
   */
  async save(value: unknown): Promise<void> {
    const cleaned = this.secret.parse(value);
    if (!this.storage.isEncryptionAvailable()) {
      throw this.secret.unavailable();
    }
    const ciphertext = this.storage.encryptString(JSON.stringify(cleaned));
    await writeAtomic(this.path, ciphertext, 0o600);
  }

  async clear(): Promise<void> {
    try {
      await unlink(this.path);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
}
