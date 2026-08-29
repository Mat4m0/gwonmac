/**
 * The advisory cache projection shown by the launcher and Settings.
 * Download preflight remains the enforcement authority and remeasures capacity.
 */
import { statfs } from "node:fs/promises";
import type { CacheInfo } from "../../shared/contracts.js";
import { FREE_MARGIN, type ChunkStore } from "./chunk-store.js";

type CacheStore = Pick<
  ChunkStore,
  | "chunkByteLength"
  | "chunksDir"
  | "hashes"
  | "verifiedResidentIndices"
  | "size"
>;

export async function projectClientCacheInfo(
  store: CacheStore | null,
  freeBytes: number,
): Promise<CacheInfo> {
  if (!store) {
    return {
      bytes: 0,
      chunks: 0,
      totalBytes: 0,
      totalChunks: 0,
      freeBytes,
      fullDownloadShortfall: 0,
    };
  }
  const verified = await store.verifiedResidentIndices();
  const bytes = verified.reduce(
    (total, index) => total + store.chunkByteLength(index),
    0,
  );
  // Remaining bytes rather than the preflight's hash-deduplicated need: close
  // enough for a card, and always the pessimistic side of the two.
  const remaining = Math.max(0, store.size - bytes);
  const fullDownloadShortfall = remaining > 0 && freeBytes >= 0
    ? Math.max(0, remaining + FREE_MARGIN - freeBytes)
    : 0;
  return {
    bytes,
    chunks: verified.length,
    totalBytes: store.size,
    totalChunks: store.hashes.length,
    freeBytes,
    fullDownloadShortfall,
  };
}

export async function readClientCacheInfo(
  store: CacheStore | null,
  fallbackVolumePath: string,
): Promise<CacheInfo> {
  // An unreadable volume answers "could not be measured" instead of blocking
  // an advisory card on a measurement failure.
  let freeBytes = -1;
  try {
    const fsStat = await statfs(store?.chunksDir ?? fallbackVolumePath);
    freeBytes = Number(fsStat.bavail) * Number(fsStat.bsize);
  } catch {
    // Keep the "could not be measured" answer.
  }
  return projectClientCacheInfo(store, freeBytes);
}
