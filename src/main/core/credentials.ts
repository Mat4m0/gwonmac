import {
  open,
  unlink,
} from "node:fs/promises";
import type {
  CredentialRead,
  StoredCredentials,
} from "../../shared/contracts.js";
import { AppError } from "../../shared/errors.js";
import { writeAtomic } from "./atomic-file.js";

export const CREDENTIAL_PROTECTIONS = [
  "mac-preview-mock-v1",
  "os-safe-storage-v1",
  "linux-keyring-v1",
] as const;

export type CredentialProtection = (typeof CREDENTIAL_PROTECTIONS)[number];

export interface CredentialProvider {
  readonly protection: CredentialProtection;
  readonly acceptsLegacyRawCiphertext: boolean;
  available(): Promise<boolean>;
  encrypt(plaintext: string): Promise<Buffer>;
  decrypt(ciphertext: Buffer): Promise<{
    readonly plaintext: string;
    readonly shouldReEncrypt: boolean;
  }>;
}

export interface CredentialEnvelopeV1 {
  readonly formatVersion: 1;
  readonly protection: CredentialProtection;
  readonly ciphertext: string;
}

const MAX_CREDENTIAL_FILE_BYTES = 32 * 1024;
const MAX_CIPHERTEXT_BYTES = 16 * 1024;
const MAX_CREDENTIAL_FIELD_LENGTH = 4096;
const MAX_PLAINTEXT_BYTES = 9 * 1024;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * The one credential shape check. Called on two different inputs: whatever the
 * renderer sent, at the IPC boundary, and whatever was on disk, after
 * decryption. Exported so the boundary uses this rule rather than a second one.
 */
export function parseCredentials(value: unknown): StoredCredentials {
  if (
    !isRecord(value)
    || Object.keys(value).sort().join("\0") !== "password\0username"
    || typeof value.username !== "string"
    || typeof value.password !== "string"
    || value.username.length > MAX_CREDENTIAL_FIELD_LENGTH
    || value.password.length > MAX_CREDENTIAL_FIELD_LENGTH
  ) {
    throw new AppError("credentials_corrupt", "saved credentials are invalid");
  }
  return { username: value.username, password: value.password };
}

export function parseCredentialEnvelope(value: unknown): CredentialEnvelopeV1 {
  if (
    !isRecord(value)
    || value.formatVersion !== 1
    || Object.keys(value).sort().join("\0")
      !== "ciphertext\0formatVersion\0protection"
    || typeof value.protection !== "string"
    || !CREDENTIAL_PROTECTIONS.includes(
      value.protection as CredentialProtection,
    )
    || typeof value.ciphertext !== "string"
    || value.ciphertext.length === 0
    || value.ciphertext.length > Math.ceil(MAX_CIPHERTEXT_BYTES / 3) * 4
    || value.ciphertext.length % 4 !== 0
    || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u
      .test(value.ciphertext)
  ) {
    throw new AppError(
      "credentials_envelope_corrupt",
      "saved credential envelope is invalid",
    );
  }
  const ciphertext = Buffer.from(value.ciphertext, "base64");
  if (
    ciphertext.byteLength > MAX_CIPHERTEXT_BYTES
    || ciphertext.toString("base64") !== value.ciphertext
  ) {
    throw new AppError(
      "credentials_envelope_corrupt",
      "saved credential envelope is invalid",
    );
  }
  return Object.freeze({
    formatVersion: 1,
    protection: value.protection as CredentialProtection,
    ciphertext: value.ciphertext,
  });
}

async function readBounded(path: string): Promise<Buffer | null> {
  let handle;
  try {
    handle = await open(path, "r");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw new AppError("credentials_io", "saved credentials cannot be read", {
      cause: error,
    });
  }
  try {
    if ((await handle.stat()).size > MAX_CREDENTIAL_FILE_BYTES) {
      throw new AppError(
        "credentials_envelope_corrupt",
        "saved credential file is too large",
      );
    }
    const bytes = await handle.readFile();
    if (bytes.byteLength > MAX_CREDENTIAL_FILE_BYTES) {
      throw new AppError(
        "credentials_envelope_corrupt",
        "saved credential file is too large",
      );
    }
    await handle.close();
    return bytes;
  } catch (error) {
    await handle.close().catch(() => {});
    if (error instanceof AppError) throw error;
    throw new AppError("credentials_io", "saved credentials cannot be read", {
      cause: error,
    });
  }
}

function decodeStoredFile(bytes: Buffer):
  | { readonly kind: "envelope"; readonly value: CredentialEnvelopeV1 }
  | { readonly kind: "legacy"; readonly ciphertext: Buffer } {
  const text = bytes.toString("utf8");
  if (text.trimStart().startsWith("{")) {
    try {
      return {
        kind: "envelope",
        value: parseCredentialEnvelope(JSON.parse(text)),
      };
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError(
        "credentials_envelope_corrupt",
        "saved credential envelope is invalid",
      );
    }
  }
  if (
    bytes.byteLength === 0
    || bytes.byteLength > MAX_CIPHERTEXT_BYTES
  ) {
    throw new AppError(
      "credentials_envelope_corrupt",
      "legacy credential ciphertext is invalid",
    );
  }
  return { kind: "legacy", ciphertext: bytes };
}

export class CredentialsStore {
  private readonly path: string;
  private readonly provider: CredentialProvider;
  private readonly writeEnvelope: typeof writeAtomic;

  constructor(
    path: string,
    provider: CredentialProvider,
    writeEnvelope: typeof writeAtomic = writeAtomic,
  ) {
    this.path = path;
    this.provider = provider;
    this.writeEnvelope = writeEnvelope;
  }

  async load(): Promise<CredentialRead> {
    const bytes = await readBounded(this.path);
    if (bytes === null) return { state: "absent" };
    const stored = decodeStoredFile(bytes);
    if (
      stored.kind === "envelope"
      && stored.value.protection !== this.provider.protection
    ) {
      throw new AppError(
        "credentials_wrong_provider",
        "saved credentials use a different protection provider",
      );
    }
    if (
      stored.kind === "legacy"
      && !this.provider.acceptsLegacyRawCiphertext
    ) {
      throw new AppError(
        "credentials_wrong_provider",
        "legacy credentials use a different protection provider",
      );
    }
    if (!(await this.providerAvailable())) {
      return { state: "temporarily-unavailable" };
    }
    const ciphertext = stored.kind === "envelope"
      ? Buffer.from(stored.value.ciphertext, "base64")
      : stored.ciphertext;
    let decrypted: Awaited<ReturnType<CredentialProvider["decrypt"]>>;
    try {
      decrypted = await this.provider.decrypt(ciphertext);
    } catch (error) {
      throw new AppError(
        "credentials_decrypt_failed",
        "saved credentials cannot be decrypted",
        { cause: error },
      );
    }
    let credentials: StoredCredentials;
    try {
      if (Buffer.byteLength(decrypted.plaintext) > MAX_PLAINTEXT_BYTES) {
        throw new AppError(
          "credentials_corrupt",
          "decrypted credentials are too large",
        );
      }
      credentials = parseCredentials(JSON.parse(decrypted.plaintext));
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError(
        "credentials_corrupt",
        "decrypted credentials are invalid",
      );
    }
    if (stored.kind === "legacy" || decrypted.shouldReEncrypt) {
      await this.publish(credentials);
    }
    return { state: "available", credentials };
  }

  async save(value: unknown): Promise<void> {
    await this.publish(parseCredentials(value));
  }

  private async publish(credentials: StoredCredentials): Promise<void> {
    if (!(await this.providerAvailable())) {
      throw new AppError(
        "credentials_unavailable",
        "credential encryption is unavailable",
      );
    }
    let ciphertext: Buffer;
    try {
      ciphertext = await this.provider.encrypt(JSON.stringify(credentials));
    } catch (error) {
      throw new AppError(
        "credentials_unavailable",
        "credential encryption failed",
        { cause: error },
      );
    }
    if (
      ciphertext.byteLength === 0
      || ciphertext.byteLength > MAX_CIPHERTEXT_BYTES
    ) {
      throw new AppError(
        "credentials_unavailable",
        "credential encryption returned invalid ciphertext",
      );
    }
    const envelope: CredentialEnvelopeV1 = {
      formatVersion: 1,
      protection: this.provider.protection,
      ciphertext: ciphertext.toString("base64"),
    };
    try {
      await this.writeEnvelope(
        this.path,
        `${JSON.stringify(envelope)}\n`,
        0o600,
      );
    } catch (error) {
      throw new AppError("credentials_io", "saved credentials cannot be written", {
        cause: error,
      });
    }
  }

  private async providerAvailable(): Promise<boolean> {
    try {
      return await this.provider.available();
    } catch {
      return false;
    }
  }

  async clear(): Promise<void> {
    try {
      await unlink(this.path);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
      throw new AppError("credentials_io", "saved credentials cannot be removed", {
        cause: error,
      });
    }
  }
}
