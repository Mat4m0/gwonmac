import { createHash } from "node:crypto";
import { promisify } from "node:util";
import { gunzip } from "node:zlib";
import { AppError } from "../../shared/errors.js";
import { HASH_ALGOS } from "./access-key.js";
import type { CompressionMode } from "./manifest.js";

const gunzipAsync = promisify(gunzip);

export function verifyChunkHash(hash: string, data: Uint8Array): void {
  const algorithm = HASH_ALGOS[hash.length];
  if (!algorithm) {
    throw new AppError("hash_format", `unsupported chunk hash: ${hash}`);
  }
  const actual = createHash(algorithm).update(data).digest("hex");
  if (actual !== hash.toLowerCase()) {
    throw new AppError("hash_mismatch", `hash mismatch on chunk ${hash}`);
  }
}

export async function decodeChunk(
  data: Uint8Array,
  compression: CompressionMode,
): Promise<Uint8Array> {
  return compression === "gzip" ? gunzipAsync(data) : data;
}
