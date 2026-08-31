/**
 * Owns the Flatpak Secret portal boundary and profile-scoped encrypted store.
 * Portal failures remain closed; this module never writes unencrypted secrets.
 */
import {
  createCipheriv,
  createDecipheriv,
  hkdfSync,
  randomBytes,
} from "node:crypto";
import { spawn } from "node:child_process";
import { readFile, unlink } from "node:fs/promises";
import path from "node:path";
import { writeAtomic } from "./core/atomic-file.js";
import type { NativeKeychain, SecretSlot } from "./core/native-keychain.js";
import { unpackedPath, type BundleLayout } from "./core/paths.js";

const PORTAL_PROTOCOL = Buffer.from("GWSPv1\0\0", "ascii");
const STORE_MAGIC = Buffer.from("GWKSv1\0\0", "ascii");
const MAX_PORTAL_OUTPUT = 16 * 1024;

export interface LinuxPortalSecret {
  readonly token: string;
  readonly secret: Buffer;
}

export type LinuxPortalSecretProvider = () => Promise<LinuxPortalSecret>;

export function linuxSecretPortalPath(layout: BundleLayout): string {
  return unpackedPath(layout, "build/native/gw-secret-portal");
}

function portalRequest(token: string): Buffer {
  const encoded = Buffer.from(token, "utf8");
  if (encoded.byteLength > 4096) throw new Error("Secret portal token is too large");
  const request = Buffer.allocUnsafe(4 + encoded.byteLength);
  request.writeUInt32BE(encoded.byteLength, 0);
  encoded.copy(request, 4);
  encoded.fill(0);
  return request;
}

export async function retrieveLinuxPortalSecret(
  executable: string,
  token: string,
): Promise<LinuxPortalSecret> {
  const request = portalRequest(token);
  return new Promise((resolve, reject) => {
    const child = spawn(executable, [], {
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let outputBytes = 0;
    let errorBytes = 0;
    let spawnError: Error | null = null;
    child.once("error", (error) => {
      spawnError = error;
    });
    child.stdout.on("data", (chunk: Buffer) => {
      outputBytes += chunk.byteLength;
      if (outputBytes > MAX_PORTAL_OUTPUT) child.kill();
      else stdout.push(Buffer.from(chunk));
    });
    child.stderr.on("data", (chunk: Buffer) => {
      if (errorBytes >= 4096) return;
      const retained = chunk.subarray(0, 4096 - errorBytes);
      errorBytes += retained.byteLength;
      stderr.push(Buffer.from(retained));
    });
    child.once("close", (code) => {
      request.fill(0);
      if (spawnError !== null) {
        reject(spawnError);
        return;
      }
      if (code !== 0 || outputBytes > MAX_PORTAL_OUTPUT) {
        const detail = Buffer.concat(stderr).toString("utf8").trim();
        reject(new Error(detail || "Secret portal unavailable"));
        return;
      }
      const output = Buffer.concat(stdout);
      try {
        if (output.byteLength < 16 || !output.subarray(0, 8).equals(PORTAL_PROTOCOL)) {
          throw new Error("Secret portal returned an invalid response");
        }
        const tokenLength = output.readUInt32BE(8);
        const secretLength = output.readUInt32BE(12);
        if (
          tokenLength > 4096
          || secretLength < 16
          || secretLength > 4096
          || 16 + tokenLength + secretLength !== output.byteLength
        ) throw new Error("Secret portal returned invalid lengths");
        const nextToken = output.subarray(16, 16 + tokenLength).toString("utf8");
        const secret = Buffer.from(output.subarray(16 + tokenLength));
        output.fill(0);
        resolve({ token: nextToken, secret });
      } catch (error) {
        output.fill(0);
        reject(error);
      }
    });
    child.stdin.end(request);
  });
}

export function linuxPortalSecretProvider(input: {
  readonly executable: string;
  readonly tokenPath: string;
}): LinuxPortalSecretProvider {
  return async () => {
    const previousToken = await readFile(input.tokenPath, "utf8").catch(
      (error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT") return "";
        throw error;
      },
    );
    const result = await retrieveLinuxPortalSecret(
      input.executable,
      previousToken,
    );
    if (result.token !== "" && result.token !== previousToken) {
      await writeAtomic(input.tokenPath, result.token, 0o600);
    }
    return result;
  };
}

interface EncryptedDocument {
  readonly nonce: Buffer;
  readonly tag: Buffer;
  readonly ciphertext: Buffer;
}

function decodeDocument(value: Buffer): EncryptedDocument {
  if (value.byteLength < 36 || !value.subarray(0, 8).equals(STORE_MAGIC)) {
    throw new Error("Saved login is corrupt");
  }
  return {
    nonce: value.subarray(8, 20),
    tag: value.subarray(20, 36),
    ciphertext: value.subarray(36),
  };
}

/** Encrypted per-slot documents, rooted only inside the Flatpak sandbox. */
export class LinuxPortalKeychain implements NativeKeychain {
  readonly #identity: string;
  readonly #root: string;
  readonly #provideSecret: LinuxPortalSecretProvider;
  #key: Promise<Buffer> | null = null;

  constructor(input: {
    readonly identity: string;
    readonly root: string;
    readonly provideSecret: LinuxPortalSecretProvider;
  }) {
    this.#identity = input.identity;
    this.#root = input.root;
    this.#provideSecret = input.provideSecret;
  }

  #slotPath(slot: SecretSlot): string {
    return path.join(this.#root, `${slot}.secret`);
  }

  #aad(slot: SecretSlot): Buffer {
    return Buffer.from(`gwonmac-linux-keychain-v1\0${this.#identity}\0${slot}`, "utf8");
  }

  #encryptionKey(): Promise<Buffer> {
    this.#key ??= this.#provideSecret().then(({ secret }) => {
      try {
        return Buffer.from(hkdfSync(
          "sha256",
          secret,
          Buffer.from(this.#identity, "utf8"),
          Buffer.from("gwonmac/linux-portal-keychain/v1", "utf8"),
          32,
        ));
      } finally {
        secret.fill(0);
      }
    }).catch((error: unknown) => {
      this.#key = null;
      throw error;
    });
    return this.#key;
  }

  async load(slot: SecretSlot): Promise<Buffer | null> {
    let document: Buffer;
    try {
      document = await readFile(this.#slotPath(slot));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
    const { nonce, tag, ciphertext } = decodeDocument(document);
    const key = await this.#encryptionKey();
    try {
      const decipher = createDecipheriv("aes-256-gcm", key, nonce);
      decipher.setAAD(this.#aad(slot));
      decipher.setAuthTag(tag);
      return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    } catch {
      throw new Error("Saved login could not be decrypted");
    } finally {
      document.fill(0);
    }
  }

  async save(slot: SecretSlot, value: Buffer): Promise<void> {
    const key = await this.#encryptionKey();
    const nonce = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", key, nonce);
    cipher.setAAD(this.#aad(slot));
    const ciphertext = Buffer.concat([cipher.update(value), cipher.final()]);
    const document = Buffer.concat([STORE_MAGIC, nonce, cipher.getAuthTag(), ciphertext]);
    try {
      await writeAtomic(this.#slotPath(slot), document, 0o600);
    } finally {
      document.fill(0);
    }
  }

  async clear(slot: SecretSlot): Promise<void> {
    await unlink(this.#slotPath(slot)).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== "ENOENT") throw error;
    });
  }
}
