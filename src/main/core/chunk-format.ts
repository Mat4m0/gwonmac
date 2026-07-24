import { createHash } from "node:crypto";
import { gunzip } from "node:zlib";
import { AppError } from "../../shared/errors.js";
import { HASH_ALGOS } from "./access-key.js";
import type { CompressionMode } from "./manifest.js";

export function parseContentHash(value: unknown): string {
  if (typeof value !== "string" || !HASH_ALGOS[value.length]) {
    throw new AppError(
      "hash_format",
      `unsupported chunk hash: ${String(value)}`,
    );
  }
  const normalized = value.toLowerCase();
  if (!/^[a-f0-9]+$/.test(normalized)) {
    throw new AppError(
      "hash_format",
      `unsupported chunk hash: ${String(value)}`,
    );
  }
  return normalized;
}

export function isContentHash(value: string): boolean {
  try {
    return parseContentHash(value) === value;
  } catch {
    return false;
  }
}

export function verifyChunkHash(hash: string, data: Uint8Array): void {
  const normalized = parseContentHash(hash);
  const algorithm = HASH_ALGOS[normalized.length]!;
  const actual = createHash(algorithm).update(data).digest("hex");
  if (actual !== normalized) {
    throw new AppError("hash_mismatch", `hash mismatch on chunk ${normalized}`);
  }
}

export function encodedChunkLimit(
  expectedLength: number,
  compression: CompressionMode,
): number {
  if (!Number.isSafeInteger(expectedLength) || expectedLength <= 0) {
    throw new AppError("chunk_length", "expected chunk length must be positive");
  }
  return compression === "none"
    ? expectedLength
    : expectedLength + Math.max(64 * 1024, Math.ceil(expectedLength / 16));
}

export async function decodeChunk(
  data: Uint8Array,
  compression: CompressionMode,
  expectedLength: number,
): Promise<Uint8Array> {
  if (!Number.isSafeInteger(expectedLength) || expectedLength <= 0) {
    throw new AppError("chunk_length", "expected chunk length must be positive");
  }
  if (compression === "none") {
    if (data.byteLength !== expectedLength) {
      throw new AppError(
        "chunk_length",
        `chunk length ${data.byteLength}, expected ${expectedLength}`,
      );
    }
    return data;
  }
  const decoded = await new Promise<Buffer>((resolve, reject) => {
    gunzip(data, { maxOutputLength: expectedLength }, (error, result) => {
      if (error) {
        reject(new AppError("chunk_decode", "invalid compressed chunk", { cause: error }));
      } else {
        resolve(result);
      }
    });
  });
  if (decoded.byteLength !== expectedLength) {
    throw new AppError(
      "chunk_length",
      `chunk length ${decoded.byteLength}, expected ${expectedLength}`,
    );
  }
  return decoded;
}
