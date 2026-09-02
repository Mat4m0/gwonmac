/**
 * Stable presentation and runtime vocabulary for player-owned TexMod packs.
 * Paths and archive contents deliberately never cross either renderer bridge.
 */

export const TEXTURE_PACK_FAILURE_CODES = [
  "not_tpf",
  "tpf_corrupt",
  "unsupported_tpf_variant",
  "unsafe_archive",
  "limit_exceeded",
  "definition_missing",
  "definition_invalid",
  "mapping_missing_image",
  "duplicate_target",
  "unsupported_hash_width",
  "unsupported_image",
  "unsupported_dimensions",
  "source_missing",
  "disk_full",
  "permission_denied",
  "cancelled",
  "unknown",
] as const;

export type TexturePackFailureCode = (typeof TEXTURE_PACK_FAILURE_CODES)[number];

export interface TexturePackSummary {
  readonly id: string;
  readonly name: string;
  readonly sourceBytes: number;
  readonly compiledBytes: number;
  readonly mappings: number;
  readonly importedAt: string;
  readonly sourceSha256: string;
  readonly status: "ready" | "missing-source";
}

export interface TexturePackSnapshot {
  readonly selectedPackId: string | null;
  readonly packs: readonly TexturePackSummary[];
}

export type TexturePackImportResult =
  | Readonly<{ status: "imported"; packId: string }>
  | Readonly<{ status: "duplicate"; packId: string }>
  | Readonly<{ status: "cancelled" }>
  | Readonly<{ status: "failed"; reason: TexturePackFailureCode }>;

export interface TexturePackRuntimeManifest {
  readonly formatVersion: 1;
  readonly sourceSha256: string;
  readonly bytes: number;
  readonly entries: readonly Readonly<{
    target: number;
    width: number;
    height: number;
    offset: number;
    length: number;
    compressed?: Readonly<{
      mode: "DXT1" | "DXT3" | "DXT5";
      levels: readonly Readonly<{ offset: number; length: number }>[];
    }>;
  }>[];
}

const PACK_ID = /^[0-9a-f]{32}$/u;
const SOURCE_DIGEST = /^[0-9a-f]{64}$/u;
const MAX_TEXTURE_ENTRIES = 1_024;
const MAX_TEXTURE_BYTES = 64 * 1024 * 1024;
const MAX_PACK_BYTES = 256 * 1024 * 1024;

export function parseTexturePackId(value: unknown): string {
  if (typeof value === "string" && PACK_ID.test(value)) return value;
  throw new Error("texture pack id is invalid");
}

function record(value: unknown, message: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(message);
  return value as Record<string, unknown>;
}

function safeInteger(value: unknown, minimum: number, maximum: number): number {
  if (!Number.isSafeInteger(value) || (value as number) < minimum || (value as number) > maximum) {
    throw new Error("texture manifest number is invalid");
  }
  return value as number;
}

/** Validates the exact manifest consumed by both the main and game renderers. */
export function parseTexturePackRuntimeManifest(
  value: unknown,
  expectedBytes?: number,
): TexturePackRuntimeManifest {
  const source = record(value, "texture manifest is invalid");
  const bytes = safeInteger(source.bytes, 1, MAX_PACK_BYTES);
  if (source.formatVersion !== 1 || typeof source.sourceSha256 !== "string"
    || !SOURCE_DIGEST.test(source.sourceSha256) || (expectedBytes !== undefined && bytes !== expectedBytes)
    || !Array.isArray(source.entries) || source.entries.length === 0
    || source.entries.length > MAX_TEXTURE_ENTRIES) {
    throw new Error("texture manifest is invalid");
  }
  const targets = new Set<number>();
  const entries = source.entries.map((value) => {
    const entry = record(value, "texture mapping is invalid");
    const target = safeInteger(entry.target, 0, 0xffff_ffff);
    const width = safeInteger(entry.width, 1, 4_096);
    const height = safeInteger(entry.height, 1, 4_096);
    const offset = safeInteger(entry.offset, 0, bytes);
    const length = safeInteger(entry.length, 1, MAX_TEXTURE_BYTES);
    if (length !== width * height * 4 || offset > bytes - length || targets.has(target)) {
      throw new Error("texture mapping is invalid");
    }
    targets.add(target);
    let compressed: TexturePackRuntimeManifest["entries"][number]["compressed"];
    if (entry.compressed !== undefined) {
      const encoded = record(entry.compressed, "compressed texture mapping is invalid");
      if ((encoded.mode !== "DXT1" && encoded.mode !== "DXT3" && encoded.mode !== "DXT5")
        || !Array.isArray(encoded.levels) || encoded.levels.length === 0
        || encoded.levels.length > Math.floor(Math.log2(Math.max(width, height))) + 1) {
        throw new Error("compressed texture mapping is invalid");
      }
      compressed = {
        mode: encoded.mode,
        levels: encoded.levels.map((value, index) => {
          const level = record(value, "compressed texture level is invalid");
          const levelOffset = safeInteger(level.offset, 0, bytes);
          const levelLength = safeInteger(level.length, 1, MAX_TEXTURE_BYTES);
          const levelWidth = Math.max(1, width >> index);
          const levelHeight = Math.max(1, height >> index);
          const blockBytes = encoded.mode === "DXT1" ? 8 : 16;
          const expectedLength = Math.ceil(levelWidth / 4) * Math.ceil(levelHeight / 4) * blockBytes;
          if (levelOffset > bytes - levelLength || levelLength !== expectedLength) {
            throw new Error("compressed texture level is invalid");
          }
          return { offset: levelOffset, length: levelLength };
        }),
      };
    }
    return { target, width, height, offset, length, ...(compressed ? { compressed } : {}) };
  });
  return { formatVersion: 1, sourceSha256: source.sourceSha256, bytes, entries };
}
