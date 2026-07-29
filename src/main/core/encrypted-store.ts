import { open, unlink } from "node:fs/promises";
import { AppError } from "../../shared/errors.js";
import { writeAtomic } from "./atomic-file.js";
import type {
  CredentialProtection,
  CredentialProvider,
} from "./credentials.js";

export interface EncryptedSecret<T> {
  parse(value: unknown): T;
  unavailable(): AppError;
  undecryptable(): AppError;
}

interface EncryptedEnvelopeV1 {
  readonly formatVersion: 1;
  readonly protection: CredentialProtection;
  readonly ciphertext: string;
}

const MAX_FILE_BYTES = 32 * 1024;
const MAX_CIPHERTEXT_BYTES = 16 * 1024;

async function readBounded(path: string): Promise<Buffer | null> {
  let handle;
  try {
    handle = await open(path, "r");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
  try {
    if ((await handle.stat()).size > MAX_FILE_BYTES) {
      throw new Error("encrypted secret file is too large");
    }
    return await handle.readFile();
  } finally {
    await handle.close().catch(() => {});
  }
}

function parseEnvelope(value: unknown): EncryptedEnvelopeV1 {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("invalid encrypted secret envelope");
  }
  const source = value as Record<string, unknown>;
  if (
    source.formatVersion !== 1
    || typeof source.protection !== "string"
    || typeof source.ciphertext !== "string"
  ) {
    throw new Error("invalid encrypted secret envelope");
  }
  const ciphertext = Buffer.from(source.ciphertext, "base64");
  if (
    ciphertext.byteLength === 0
    || ciphertext.byteLength > MAX_CIPHERTEXT_BYTES
    || ciphertext.toString("base64") !== source.ciphertext
  ) {
    throw new Error("invalid encrypted secret ciphertext");
  }
  return {
    formatVersion: 1,
    protection: source.protection as CredentialProtection,
    ciphertext: source.ciphertext,
  };
}

/**
 * The shared versioned, provider-backed persistence mechanism for native
 * secrets other than the legacy credentials file.
 */
export class EncryptedJsonStore<T> {
  private readonly path: string;
  private readonly provider: CredentialProvider;
  private readonly secret: EncryptedSecret<T>;

  constructor(
    path: string,
    provider: CredentialProvider,
    secret: EncryptedSecret<T>,
  ) {
    this.path = path;
    this.provider = provider;
    this.secret = secret;
  }

  async load(): Promise<T | null> {
    const bytes = await readBounded(this.path);
    if (bytes === null) return null;
    if (!(await this.providerAvailable())) throw this.secret.unavailable();
    try {
      const envelope = parseEnvelope(JSON.parse(bytes.toString("utf8")));
      if (envelope.protection !== this.provider.protection) {
        throw new Error("encrypted secret uses another provider");
      }
      const decrypted = await this.provider.decrypt(
        Buffer.from(envelope.ciphertext, "base64"),
      );
      const value = this.secret.parse(JSON.parse(decrypted.plaintext));
      if (decrypted.shouldReEncrypt) await this.save(value);
      return value;
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw this.secret.undecryptable();
    }
  }

  async save(value: unknown): Promise<void> {
    const cleaned = this.secret.parse(value);
    if (!(await this.providerAvailable())) throw this.secret.unavailable();
    try {
      const ciphertext = await this.provider.encrypt(JSON.stringify(cleaned));
      if (
        ciphertext.byteLength === 0
        || ciphertext.byteLength > MAX_CIPHERTEXT_BYTES
      ) {
        throw new Error("invalid encrypted secret ciphertext");
      }
      const envelope: EncryptedEnvelopeV1 = {
        formatVersion: 1,
        protection: this.provider.protection,
        ciphertext: ciphertext.toString("base64"),
      };
      await writeAtomic(this.path, `${JSON.stringify(envelope)}\n`, 0o600);
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw this.secret.unavailable();
    }
  }

  async clear(): Promise<void> {
    try {
      await unlink(this.path);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }

  private async providerAvailable(): Promise<boolean> {
    try {
      return await this.provider.available();
    } catch {
      return false;
    }
  }
}
