/**
 * Aggregates persisted per-map revealable cells for the current continent and
 * reveal mode. Persisted records stay immutable and main-owned.
 */
import type { CartographyMapKnowledge } from
  "../../shared/cartography-map-knowledge.js";

export function mergeCartographyMapKnowledge(
  records: readonly CartographyMapKnowledge[],
  target: Readonly<{
    kernelSha256: string;
    continent: number;
    width: number;
    height: number;
    revealRadius: 1 | 3;
  }>,
): Uint32Array | null {
  let merged: Uint32Array | null = null;
  for (const record of records) {
    if (
      record.kernelSha256 !== target.kernelSha256
      || record.continent !== target.continent
      || record.width !== target.width
      || record.height !== target.height
      || record.revealRadius !== target.revealRadius
    ) continue;
    merged ??= new Uint32Array(record.words.length);
    record.words.forEach((word, index) => {
      merged![index] = (merged![index]! | word) >>> 0;
    });
  }
  return merged;
}

export function cartographyKnowledgeWordsFingerprint(words: Uint32Array): number {
  let value = 2_166_136_261;
  for (const word of words) {
    value = Math.imul(value ^ word, 16_777_619) >>> 0;
  }
  return value;
}
