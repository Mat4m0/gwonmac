import type { SnapshotMetadata } from "../../shared/contracts.js";
import { writeAtomicJson } from "./atomic-file.js";

export function packResidentBits(count: number, resident: Iterable<number>): Uint8Array {
  const bits = new Uint8Array(Math.ceil(count / 8) || 0);
  for (const i of resident) {
    if (i < 0 || i >= count) continue;
    bits[i >> 3]! |= 1 << (i & 7);
  }
  return bits;
}

export function bitIsSet(bits: Uint8Array, index: number): boolean {
  if (index < 0) return false;
  const byte = bits[index >> 3];
  if (byte === undefined) return false;
  return (byte & (1 << (index & 7))) !== 0;
}

export function buildSnapshotMetadata(opts: {
  size: number;
  chunkSize: number;
  chunkHashes: string[];
  residentIndices: Iterable<number>;
}): SnapshotMetadata {
  return {
    size: opts.size,
    chunkSize: opts.chunkSize,
    chunkHashes: opts.chunkHashes,
    residentBits: packResidentBits(opts.chunkHashes.length, opts.residentIndices),
  };
}

const SNAPSHOT_INDEX_FORMAT = 1;

/** Wire form for snapshot-metadata.json (residentBits as base64). */
export function snapshotMetadataWire(meta: SnapshotMetadata): {
  size: number;
  chunkSize: number;
  chunkHashes: string[];
  residentBits: string;
} {
  return {
    size: meta.size,
    chunkSize: meta.chunkSize,
    chunkHashes: meta.chunkHashes,
    residentBits: Buffer.from(meta.residentBits).toString("base64"),
  };
}

export function parseResidentBitsBase64(b64: string, chunkCount: number): Uint8Array {
  const bits = new Uint8Array(Buffer.from(b64, "base64"));
  const need = Math.ceil(chunkCount / 8) || 0;
  if (bits.length === need) return bits;
  const out = new Uint8Array(need);
  out.set(bits.subarray(0, need));
  return out;
}

/**
 * Written with a format marker; read back by `PatchClient` without one, which
 * is the shape the public alpha published. Only a version this build cannot
 * read makes the installed index stale, and the cost of that is republishing
 * it — never a re-download.
 */
export function snapshotIndexFormatReadable(value: unknown): boolean {
  return value === undefined || value === SNAPSHOT_INDEX_FORMAT;
}

export async function publishSnapshotIndex(
  path: string,
  opts: { size: number; chunkSize: number; chunkHashes: string[] },
): Promise<void> {
  await writeAtomicJson(path, {
    formatVersion: SNAPSHOT_INDEX_FORMAT,
    size: opts.size,
    chunkSize: opts.chunkSize,
    chunkHashes: opts.chunkHashes,
  });
}
