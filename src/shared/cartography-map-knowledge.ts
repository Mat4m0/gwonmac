/**
 * Defines the bounded map-knowledge records exchanged between Cartography and
 * main. Main owns persistence; the renderer owns display-time aggregation.
 */
import { CARTOGRAPHY_REACHABILITY_MAX_CELLS } from
  "./cartography-reachability-kernel-contract.js";
import { isDigest } from "./digest.js";

export const CARTOGRAPHY_MAP_KNOWLEDGE_LIMIT = 2_048;

export type CartographyMapKnowledge = Readonly<{
  kernelSha256: string;
  mapId: number;
  continent: number;
  width: number;
  height: number;
  revealRadius: 1 | 3;
  words: readonly number[];
}>;

function uint(value: unknown, maximum: number): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0 && Number(value) <= maximum;
}

/** Refuse oversized, malformed, or covertly padded bitsets at the IPC boundary. */
export function parseCartographyMapKnowledge(value: unknown): CartographyMapKnowledge {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("cartography map knowledge must be an object");
  }
  const source = value as Record<string, unknown>;
  const { kernelSha256, mapId, continent, width, height, revealRadius, words } = source;
  if (!isDigest(kernelSha256)) {
    throw new Error("cartography map knowledge has an invalid kernel identity");
  }
  if (!uint(mapId, 2_000) || mapId === 0) {
    throw new Error("cartography map knowledge has an invalid map id");
  }
  if (!uint(continent, 5)) {
    throw new Error("cartography map knowledge has an invalid continent");
  }
  if (!uint(width, 8_192) || width === 0 || !uint(height, 8_192) || height === 0) {
    throw new Error("cartography map knowledge has invalid dimensions");
  }
  const cells = width * height;
  if (!Number.isSafeInteger(cells) || cells > CARTOGRAPHY_REACHABILITY_MAX_CELLS) {
    throw new Error("cartography map knowledge is too large");
  }
  if (revealRadius !== 1 && revealRadius !== 3) {
    throw new Error("cartography map knowledge has an invalid reveal radius");
  }
  const wordCount = Math.ceil(cells / 32);
  if (!Array.isArray(words) || words.length !== wordCount || words.some(
    (word) => !uint(word, 0xffff_ffff),
  )) {
    throw new Error("cartography map knowledge has invalid words");
  }
  const usedBits = cells % 32;
  if (usedBits !== 0 && ((words.at(-1)! >>> usedBits) !== 0)) {
    throw new Error("cartography map knowledge has nonzero padding");
  }
  const unknown = Object.keys(source).filter((key) => ![
    "kernelSha256", "mapId", "continent", "width", "height", "revealRadius", "words",
  ].includes(key));
  if (unknown.length > 0) {
    throw new Error(`cartography map knowledge has unknown fields: ${unknown.join(", ")}`);
  }
  return Object.freeze({
    kernelSha256,
    mapId,
    continent,
    width,
    height,
    revealRadius,
    words: Object.freeze([...words] as number[]),
  });
}
