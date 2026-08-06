/**
 * The client's own localized text: which archive files hold it, and how one
 * shard of 1,024 records is read.
 *
 * A skill record carries string *ids*, not text. An id divides into a file and
 * a record within it, and which archive file holds language `n`'s shard `m` is
 * an 18 × 99 table in the client's static data — found here by its full shape,
 * for the same reason `skill-table.ts` finds the skill table by shape: the
 * address is build-specific and a partial match is worse than none.
 *
 * This is where skill names and descriptions come from, so the client is the
 * authority on both. Nothing is transcribed and nothing can drift from the
 * build the player is running.
 *
 * Records come in two forms. Raw UTF-16 records decode here; ArenaNet's
 * compact, context-keyed records need external context and stay `null` rather
 * than being guessed — they share a shard with the records that do decode, and
 * must not invalidate them.
 */
import {
  readSleb,
  readUleb,
  sectionById,
  splitSections,
} from "./wasm-binary.js";

const LANGUAGES = 18;
const FILES_PER_LANGUAGE = 99;
const STRINGS_PER_FILE = 1_024;
const RAW_RANGE_BITS = 16;
const STRING_HEADER_BYTES = 6;

type Segment = Readonly<{ address: number; bytes: Uint8Array }>;

function staticSegments(wasm: Uint8Array): readonly Segment[] {
  const bytes = sectionById(splitSections(wasm), 11);
  const cursor = { offset: 0 };
  const count = readUleb(bytes, cursor);
  const result: Segment[] = [];
  for (let index = 0; index < count; index++) {
    if (readUleb(bytes, cursor) !== 0 || bytes[cursor.offset++] !== 0x41) {
      throw new Error("unsupported client static-data segment");
    }
    const address = readSleb(bytes, cursor);
    if (address < 0 || bytes[cursor.offset++] !== 0x0b) {
      throw new Error("invalid client static-data address");
    }
    const size = readUleb(bytes, cursor);
    const end = cursor.offset + size;
    if (end > bytes.byteLength) throw new Error("truncated client static data");
    result.push({ address, bytes: bytes.slice(cursor.offset, end) });
    cursor.offset = end;
  }
  if (cursor.offset !== bytes.byteLength) throw new Error("malformed client static data");
  return result;
}

function readAt(segments: readonly Segment[], address: number, size: number): Uint8Array | null {
  for (const segment of segments) {
    const offset = address - segment.address;
    if (offset >= 0 && offset + size <= segment.bytes.byteLength) {
      return segment.bytes.subarray(offset, offset + size);
    }
  }
  return null;
}

function fileIdAt(
  segments: readonly Segment[],
  table: Uint8Array,
  index: number,
): number | null {
  const pointer = new DataView(
    table.buffer,
    table.byteOffset + index * 4,
    4,
  ).getUint32(0, true);
  if (pointer === 0) return 0;
  const hash = readAt(segments, pointer, 6);
  if (!hash) return null;
  const view = new DataView(hash.buffer, hash.byteOffset, hash.byteLength);
  const low = view.getUint16(0, true);
  const high = view.getUint16(2, true);
  if (low <= 0xff || high <= 0xff || view.getUint16(4, true) !== 0) return null;
  return low - 0x100 + (high - 0x100) * 0xff00 + 1;
}

/** Finds the client-owned 18 × 99 language-file hash table by its full shape. */
export function findLanguageFileIds(wasm: Uint8Array): readonly (readonly number[])[] | null {
  const segments = staticSegments(wasm);
  const bytesNeeded = LANGUAGES * FILES_PER_LANGUAGE * 4;
  for (const segment of segments) {
    for (let offset = 0; offset + bytesNeeded <= segment.bytes.byteLength; offset += 4) {
      const table = segment.bytes.subarray(offset, offset + bytesNeeded);
      const first = fileIdAt(segments, table, 0);
      if (first === null || first === 0) continue;
      const ids: number[][] = [];
      let valid = true;
      for (let language = 0; language < LANGUAGES && valid; language++) {
        const row: number[] = [];
        for (let file = 0; file < FILES_PER_LANGUAGE; file++) {
          const id = fileIdAt(
            segments,
            table,
            language * FILES_PER_LANGUAGE + file,
          );
          // English is the runtime source used by the catalogue and is
          // complete. Other rows contain nulls where ArenaNet did not publish
          // a shard for that language; those holes are part of the table.
          if (id === null || (id === 0 && language === 0)) {
            valid = false;
            break;
          }
          row.push(id);
        }
        ids.push(row);
      }
      if (valid) return ids;
    }
  }
  return null;
}

function decodeStringRecord(
  bytes: Uint8Array,
  offset: number,
  size: number,
): string | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const baseCharacter = view.getUint16(offset + 2, true);
  const rangeBits = bytes[offset + 4]!;
  if (bytes[offset + 5] !== 0) throw new Error("invalid language string padding");
  const payload = bytes.subarray(offset + STRING_HEADER_BYTES, offset + size);
  if (baseCharacter === 0 && rangeBits === RAW_RANGE_BITS) {
    if (payload.byteLength % 2 !== 0) {
      throw new Error("invalid UTF-16 language string");
    }
    return new TextDecoder("utf-16le").decode(payload).replace(/\0+$/u, "");
  }
  // Other records use ArenaNet's compact, context-keyed representation.
  // Skill description ids point to raw UTF-16 records; unrelated compact
  // records can share the same shard and must not invalidate those records.
  if (baseCharacter === 0 || rangeBits < 1 || rangeBits > 16) {
    throw new Error("invalid compact language string header");
  }
  return null;
}

/**
 * Walks the bounded 1,024-record shard and decodes its context-free records.
 * Compact records remain null because decoding them requires external context.
 */
export function parseStringShard(bytes: Uint8Array): readonly (string | null)[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const strings: (string | null)[] = [];
  let offset = 0;
  while (strings.length < STRINGS_PER_FILE) {
    if (offset + STRING_HEADER_BYTES > bytes.byteLength) {
      throw new Error("truncated language shard");
    }
    const size = view.getUint16(offset, true);
    if (
      size < STRING_HEADER_BYTES
      || offset + size > bytes.byteLength
    ) {
      throw new Error("invalid language string record");
    }
    strings.push(decodeStringRecord(bytes, offset, size));
    offset += size;
  }
  return strings;
}

export function stringShardIndex(stringId: number): { file: number; record: number } {
  if (!Number.isSafeInteger(stringId) || stringId < 0) {
    throw new Error("invalid client string id");
  }
  return {
    file: Math.floor(stringId / STRINGS_PER_FILE),
    record: stringId % STRINGS_PER_FILE,
  };
}

export function formatSkillDescription(
  text: string,
  values: readonly [string, string, string],
): string {
  return text
    .replaceAll("%str1%", values[0])
    .replaceAll("%str2%", values[1])
    .replaceAll("%str3%", values[2])
    .replaceAll("%%", "%")
    .replaceAll("[s]", "s")
    .trim();
}
