/**
 * Canonical identity of one complete published client generation.
 *
 * The identity is the chunking parameters plus, per file, its name, size and
 * chunk hash list — never where the bytes came from, when they were fetched, or
 * the order the manifest happened to list them in. Sorting here is what makes
 * that order irrelevant. Two manifests that would produce byte-identical
 * artifacts must fingerprint the same, or update rollback and the certification
 * tables both begin lying.
 *
 * A freshly downloaded manifest and a legacy manifest being sealed both pass
 * through this one function; callers do not get a second serialization or
 * hashing policy.
 */
import { createHash } from "node:crypto";
import { asDigest, type Digest } from "../../shared/digest.js";

export interface FingerprintedClientFile {
  readonly name: string;
  readonly size: number;
  readonly chunkHashes: readonly string[];
}

export function fingerprintClientGeneration(options: {
  compression: string;
  chunkSize: number;
  files: readonly FingerprintedClientFile[];
}): Digest {
  const files = [...options.files]
    .sort((left, right) =>
      left.name < right.name ? -1 : left.name > right.name ? 1 : 0,
    )
    .map(({ name, size, chunkHashes }) => ({
      name,
      size,
      chunkHashes: [...chunkHashes],
    }));
  return asDigest(
    createHash("sha256")
      .update(
        JSON.stringify({
          compression: options.compression,
          chunkSize: options.chunkSize,
          files,
        }),
      )
      .digest("hex"),
  );
}
