import { readFile } from "node:fs/promises";
import { AppError } from "../../shared/errors.js";
import { SNAPSHOT } from "./access-key.js";
import type { CompressionMode } from "./manifest.js";

export interface PublishedClientManifest {
  clientFingerprint?: string;
  compressionMode: CompressionMode;
  chunkSize: number;
  snapshot: typeof SNAPSHOT;
  size: number;
  chunkHashes: string[];
}

export function parsePublishedClientManifest(
  raw: unknown,
): PublishedClientManifest {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new AppError("bad_manifest", "published client manifest must be an object");
  }
  const value = raw as Record<string, unknown>;
  if (
    value.compressionMode !== "none" &&
    value.compressionMode !== "gzip"
  ) {
    throw new AppError(
      "bad_manifest",
      "published client manifest has invalid compression",
    );
  }
  if (value.snapshot !== SNAPSHOT) {
    throw new AppError(
      "bad_manifest",
      "published client manifest has invalid snapshot",
    );
  }
  if (!Number.isSafeInteger(value.chunkSize) || Number(value.chunkSize) <= 0) {
    throw new AppError(
      "bad_manifest",
      "published client manifest has invalid chunk size",
    );
  }
  if (!Number.isSafeInteger(value.size) || Number(value.size) <= 0) {
    throw new AppError(
      "bad_manifest",
      "published client manifest has invalid snapshot size",
    );
  }
  if (
    !Array.isArray(value.chunkHashes) ||
    !value.chunkHashes.every(
      (hash) => typeof hash === "string" && hash.length > 0,
    )
  ) {
    throw new AppError(
      "bad_manifest",
      "published client manifest has invalid chunk hashes",
    );
  }
  if (
    value.clientFingerprint !== undefined &&
    (typeof value.clientFingerprint !== "string" ||
      !/^[a-f0-9]{64}$/.test(value.clientFingerprint))
  ) {
    throw new AppError(
      "bad_manifest",
      "published client manifest has invalid client fingerprint",
    );
  }
  const chunkSize = Number(value.chunkSize);
  const size = Number(value.size);
  if (value.chunkHashes.length !== Math.ceil(size / chunkSize)) {
    throw new AppError(
      "bad_manifest",
      "published client manifest has invalid chunk count",
    );
  }
  return {
    ...(typeof value.clientFingerprint === "string" &&
    /^[a-f0-9]{64}$/.test(value.clientFingerprint)
      ? { clientFingerprint: value.clientFingerprint }
      : {}),
    compressionMode: value.compressionMode,
    chunkSize,
    snapshot: SNAPSHOT,
    size,
    chunkHashes: [...value.chunkHashes],
  };
}

export async function readPublishedClientManifest(
  path: string,
): Promise<PublishedClientManifest> {
  return parsePublishedClientManifest(JSON.parse(await readFile(path, "utf8")));
}
