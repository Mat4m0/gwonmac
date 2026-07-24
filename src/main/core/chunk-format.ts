import { createHash } from "node:crypto";
import { promisify } from "node:util";
import { gunzip } from "node:zlib";
import { AppError } from "../../shared/errors.js";
import { HASH_ALGOS } from "./access-key.js";
import type { CompressionMode } from "./manifest.js";

const gunzipAsync = promisify(gunzip);

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

export async function decodeChunk(
  data: Uint8Array,
  compression: CompressionMode,
): Promise<Uint8Array> {
  return compression === "gzip" ? gunzipAsync(data) : data;
}
