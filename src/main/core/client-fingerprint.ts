import { createHash } from "node:crypto";
import { asDigest, type Digest } from "../../shared/digest.js";

export interface FingerprintedClientFile {
  readonly name: string;
  readonly size: number;
  readonly chunkHashes: readonly string[];
}

/**
 * Canonical identity of one complete published client generation.
 *
 * Both a freshly downloaded manifest and a legacy manifest being sealed pass
 * through this function. Sorting here makes file order irrelevant; callers do
 * not get a second serialization or hashing policy.
 */
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
