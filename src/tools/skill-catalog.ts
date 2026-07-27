// Extract the skill catalogue from an installed client.
//
//   pnpm build && node build/tools/skill-catalog.js [--out <file>]
//
// Reads the profile's own game data — the client binary for the skill table,
// the archive for what each icon resolves to — and writes one JSON document
// mapping every skill to its icon.
//
// ## What this produces, and what it deliberately does not
//
// It produces **facts**: skill ids, professions, attributes, elite flags, and
// the archive file id of each icon. Those are data about the format, the same
// category as the hero table, and they are what the build library needs to stop
// calling everything "New build" and to mark elites.
//
// It does **not** produce pixels. Decoding an icon needs three more layers —
// GWDat decompression, then ATEX decompression, then DXT — and none of them are
// written yet. Every icon in this catalogue is *addressable*; none is decoded.
// `plans/tools/hero-builds/evidence/skill-icons-archive.md` has the measurements.
//
// Nothing here ships in the app and nothing it writes is committed: the output
// is derived from a player's own installation, and `AGENTS.md` is explicit that
// downloaded game data stays out of the repository.
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  fileIdIndex,
  findStream,
  parseArchiveHeader,
  readFileTable,
  type ReadAt,
} from "../main/core/gw-archive.js";
import { findSkillTable, type SkillRecord } from "../main/core/skill-table.js";

interface SnapshotMetadata {
  chunkSize: number;
  chunkHashes: string[];
}

/**
 * Assemble archive reads from the content-addressed chunk store.
 *
 * `compressionMode: "none"` in the manifest is what makes this a plain
 * concatenation: chunk *i* is bytes `[i × chunkSize, …)` with no transform. A
 * build that ever compresses chunks has to change this.
 */
function chunkReader(gameDir: string, meta: SnapshotMetadata): ReadAt {
  const size = meta.chunkSize;
  const cache = new Map<number, Buffer>();
  const chunk = (index: number): Buffer => {
    let bytes = cache.get(index);
    if (!bytes) {
      // Bounded: the table alone is 4 MB and a whole-archive cache is 4 GB.
      if (cache.size > 64) cache.clear();
      bytes = readFileSync(path.join(gameDir, "chunks", meta.chunkHashes[index]!));
      cache.set(index, bytes);
    }
    return bytes;
  };
  return (offset, length) => {
    const out = Buffer.alloc(length);
    let done = 0;
    while (done < length) {
      const absolute = offset + done;
      const index = Math.floor(absolute / size);
      const within = absolute % size;
      const source = chunk(index);
      const take = Math.min(length - done, size - within);
      source.copy(out, done, within, within + take);
      done += take;
    }
    return out;
  };
}

export interface CatalogEntry extends SkillRecord {
  /** Whether the icon's file id resolves to a stream in this archive. */
  readonly iconResolved: boolean;
  /** Compressed bytes on disk, or 0 when unresolved. */
  readonly iconStoredBytes: number;
  /** What the payload declares it decompresses to — the last u32 of the file. */
  readonly iconDecodedBytes: number;
}

export interface Catalog {
  /** The client build this was read from. A catalogue is only true for one. */
  readonly clientFingerprint: string;
  readonly skillTableOffset: number;
  readonly skills: readonly CatalogEntry[];
}

export function buildCatalog(gameDir: string): Catalog {
  const artifacts = path.join(gameDir, "artifacts");
  const meta = JSON.parse(
    readFileSync(path.join(artifacts, "snapshot-metadata.json"), "utf8"),
  ) as SnapshotMetadata;
  const manifest = JSON.parse(
    readFileSync(path.join(artifacts, "manifest.json"), "utf8"),
  ) as { compressionMode: string; clientFingerprint: string };
  if (manifest.compressionMode !== "none") {
    throw new Error(
      `chunk store is ${manifest.compressionMode}-compressed; ` +
        "the reader assumes a plain concatenation",
    );
  }

  const binary = readFileSync(path.join(artifacts, "Gw.jspi.wasm"));
  const table = findSkillTable(binary);
  if (!table) throw new Error("no skill table found in this client build");

  const read = chunkReader(gameDir, meta);
  const files = readFileTable(read, parseArchiveHeader(read));
  const index = fileIdIndex(read, files);

  const skills = table.skills.map((skill): CatalogEntry => {
    if (skill.iconFileId === 0) {
      return { ...skill, iconResolved: false, iconStoredBytes: 0, iconDecodedBytes: 0 };
    }
    const slot = findStream(files, index, skill.iconFileId);
    if (!slot) {
      return { ...skill, iconResolved: false, iconStoredBytes: 0, iconDecodedBytes: 0 };
    }
    // The declared decompressed size is the final u32 of the compressed
    // payload. Recorded here because it is free and it is the first thing a
    // decoder has to agree with.
    const tail = read(slot.offset + slot.size - 4, 4);
    return {
      ...skill,
      iconResolved: true,
      iconStoredBytes: slot.size,
      iconDecodedBytes: new DataView(
        tail.buffer,
        tail.byteOffset,
        tail.byteLength,
      ).getUint32(0, true),
    };
  });

  return {
    clientFingerprint:
      manifest.clientFingerprint ??
      createHash("sha256").update(binary).digest("hex"),
    skillTableOffset: table.at,
    skills,
  };
}

function main(): void {
  const args = process.argv.slice(2);
  const outAt = args.indexOf("--out");
  const gameDir =
    process.env.GW_GAME_DIR ??
    path.join(
      process.env.HOME ?? "",
      "Library/Application Support/Guild Wars/game",
    );

  const catalog = buildCatalog(gameDir);
  const withIcon = catalog.skills.filter((s) => s.iconResolved).length;
  const elites = catalog.skills.filter((s) => s.elite).length;

  console.log(`client        ${catalog.clientFingerprint.slice(0, 16)}…`);
  console.log(`skill table   +${catalog.skillTableOffset}`);
  console.log(`skills        ${catalog.skills.length}`);
  console.log(`icons resolved ${withIcon}`);
  console.log(`elites        ${elites}`);

  if (outAt >= 0 && args[outAt + 1]) {
    writeFileSync(args[outAt + 1]!, JSON.stringify(catalog, null, 1));
    console.log(`wrote         ${args[outAt + 1]}`);
  }
}

if (process.argv[1] && import.meta.url.endsWith(path.basename(process.argv[1]))) {
  main();
}
