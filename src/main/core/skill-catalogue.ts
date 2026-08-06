/**
 * The skill catalogue and icons the build editor authors against, decoded out
 * of the player's own Guild Wars installation.
 *
 * Three sources, all local. Mechanics — profession, attribute, elite, costs,
 * recharge — come from the client binary via `skill-table.ts`. Names and
 * description text come from the archive's language shards via
 * `skill-strings.ts`. Icons come from the archive as DXTL textures. The
 * archive's own compression and texture codec are the vendored decoder in
 * `src/native/gw-dat/`, which is spawned per asset.
 *
 * ## Nothing is redistributed and nothing is extracted twice
 *
 * No ArenaNet content ships with this application; every byte here is read from
 * files the player already has, the same stance `THIRD-PARTY-NOTICES.md` takes
 * for the game cursor. What is decoded is then cached under a directory keyed
 * by the archive's identity, so the cost is paid once and a new ArenaNet build
 * starts a new cache rather than serving the last build's art.
 *
 * The catalogue is built eagerly — it is one pass over ~67 shards, and the
 * editor cannot show a skill list without it. Icons are decoded lazily, on the
 * request that first asks for one, because a player who never opens the picker
 * should not pay for 3,439 of them.
 */

import { mkdir, readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { spawn } from "node:child_process";
import { sweepOrphans, writeAtomic } from "./atomic-file.js";
import type { ChunkStore } from "./chunk-store.js";
import {
  fileIdIndex,
  findStream,
  parseArchiveHeader,
  parseSlot,
  readFileTable,
  type FileTable,
} from "./gw-archive.js";
import { ATTRIBUTE_BY_ID } from "../../shared/builds/heroes.js";
import { isKnownEquippableSkill } from "./equippable-skills.js";
import {
  findLanguageFileIds,
  formatSkillDescription,
  parseStringShard,
  stringShardIndex,
} from "./skill-strings.js";
import { findSkillTable, type SkillRecord } from "./skill-table.js";

const PROFESSION = new Map<number, string>([
  [1, "W"], [2, "R"], [3, "Mo"], [4, "N"], [5, "Me"],
  [6, "E"], [7, "A"], [8, "Rt"], [9, "P"], [10, "D"],
]);

/**
 * Title ids below Codex are the account title tracks used by player-only PvE
 * skills. This is the same boundary the game's own team-build catalogue uses.
 */
const CODEX_TITLE_ID = 41;

/** Bounds on what the helper may hand back, applied before anything is read. */
const MAX_ICON_BYTES = 256 * 256 * 4 + 8;
const MAX_SHARD_BYTES = 1024 * 1024 + 8;
const MAX_STREAM_BYTES = 1024 * 1024;
const HELPER_TIMEOUT_MS = 5_000;
const MAX_ICON_DIMENSION = 256;

export interface SkillFacts {
  readonly id: number;
  readonly name: string;
  readonly profession: string | null;
  readonly elite: boolean;
  readonly availability: "pve" | "player-only-pve" | "pvp" | "not-equippable";
  readonly attribute: string | null;
  readonly energyCost: number;
  readonly adrenalineCost: number;
  readonly healthCost: number;
  readonly overcast: number;
  readonly activationSeconds: number;
  readonly aftercastSeconds: number;
  readonly rechargeSeconds: number;
  readonly description: string | null;
  readonly hasIcon: boolean;
}

/**
 * Why a client yielded no catalogue. All three are recoverable and none is a
 * defect: a client can be mid-download, the archive can be unreachable, and a
 * future ArenaNet build could in principle reshape the table past recognition.
 */
export type CatalogueRefusal =
  | "client-unreadable"
  | "table-not-found"
  | "archive-unreadable";

export type CatalogueRead =
  | { readonly ok: true; readonly skills: readonly SkillFacts[] }
  | { readonly ok: false; readonly reason: CatalogueRefusal };

export function skillAvailability(
  skill: Pick<SkillRecord, "id" | "playable" | "pvp" | "pve" | "title">,
): SkillFacts["availability"] {
  if (skill.pvp) return "pvp";
  if (!skill.playable) return "not-equippable";
  if (skill.pve && skill.title < CODEX_TITLE_ID) return "player-only-pve";
  if (skill.pve || isKnownEquippableSkill(skill.id)) return "pve";
  return "not-equippable";
}

/** The three run-scaled values a description interpolates, as printed ranges. */
function descriptionValues(
  skill: SkillRecord,
): readonly [string, string, string] {
  const range = (low: number, high: number) =>
    low === high ? String(low) : `${low}–${high}`;
  return [
    range(skill.scale0, skill.scale15),
    range(skill.bonusScale0, skill.bonusScale15),
    range(skill.duration0, skill.duration15),
  ];
}

/**
 * The helper's icon output — `GWIC`, width, height, then BGRA rows top-down —
 * as a 32-bit BMP, which is bottom-up and already stores pixels B,G,R,A.
 *
 * The decoder labels RGB565's low five bits `r`, but BC1 stores those bits as
 * blue, so its stream is B,G,R,A despite the name. Preserve that order rather
 * than performing the ordinary RGBA-to-BGRA swap.
 */
export function decodedIconToBmp(decoded: Uint8Array): Buffer {
  if (
    decoded.length < 8
    || String.fromCharCode(...decoded.subarray(0, 4)) !== "GWIC"
  ) {
    throw new Error("the archive decoder returned an invalid icon header");
  }
  const view = new DataView(
    decoded.buffer,
    decoded.byteOffset,
    decoded.byteLength,
  );
  const width = view.getUint16(4, true);
  const height = view.getUint16(6, true);
  const pixels = decoded.subarray(8);
  if (
    width <= 0 || height <= 0
    || width > MAX_ICON_DIMENSION || height > MAX_ICON_DIMENSION
    || pixels.length !== width * height * 4
  ) {
    throw new Error("the archive decoder returned invalid icon dimensions");
  }
  const bmp = Buffer.alloc(54 + pixels.length);
  bmp.write("BM", 0, "ascii");
  bmp.writeUInt32LE(bmp.length, 2);
  bmp.writeUInt32LE(54, 10);
  bmp.writeUInt32LE(40, 14);
  bmp.writeInt32LE(width, 18);
  bmp.writeInt32LE(height, 22);
  bmp.writeUInt16LE(1, 26);
  bmp.writeUInt16LE(32, 28);
  bmp.writeUInt32LE(pixels.length, 34);
  for (let y = 0; y < height; y++) {
    const source = y * width * 4;
    const target = 54 + (height - y - 1) * width * 4;
    Buffer.from(pixels.buffer, pixels.byteOffset + source, width * 4)
      .copy(bmp, target);
  }
  return bmp;
}

/** The helper's decompress-only output — `GWDB`, length, then the payload. */
export function decodedShard(decoded: Uint8Array): Buffer {
  if (
    decoded.length < 8
    || String.fromCharCode(...decoded.subarray(0, 4)) !== "GWDB"
  ) {
    throw new Error("the archive decoder returned an invalid shard header");
  }
  const length = new DataView(
    decoded.buffer,
    decoded.byteOffset + 4,
    4,
  ).getUint32(0, true);
  if (length > MAX_STREAM_BYTES || decoded.byteLength !== length + 8) {
    throw new Error("the archive decoder returned an invalid shard length");
  }
  return Buffer.from(decoded.subarray(8));
}

function runDecoder(
  executable: string,
  input: Uint8Array,
  options: {
    readonly args: readonly string[];
    readonly maxOutput: number;
    parse(output: Uint8Array): Buffer;
  },
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, options.args, {
      stdio: ["pipe", "pipe", "ignore"],
      windowsHide: true,
    });
    const chunks: Buffer[] = [];
    let length = 0;
    let settled = false;
    const fail = (error: Error) => {
      if (settled) return;
      settled = true;
      child.kill();
      reject(error);
    };
    const timer = setTimeout(
      () => fail(new Error("the archive decoder timed out")),
      HELPER_TIMEOUT_MS,
    );
    child.stdout.on("data", (chunk: Buffer) => {
      length += chunk.length;
      if (length > options.maxOutput) {
        fail(new Error("the archive decoder exceeded its output bound"));
      } else {
        chunks.push(chunk);
      }
    });
    child.on("error", fail);
    child.on("close", (code) => {
      clearTimeout(timer);
      if (settled) return;
      settled = true;
      if (code !== 0) {
        reject(new Error("the archive decoder refused the local asset"));
        return;
      }
      try {
        resolve(options.parse(Buffer.concat(chunks, length)));
      } catch (error) {
        reject(error);
      }
    });
    child.stdin.end(input);
  });
}

export interface SkillAssetSource {
  readonly store: ChunkStore;
  readonly wasmPath: string;
  readonly decoderPath: string;
  /** Root for every cache; this class owns the per-archive directory inside. */
  readonly cacheRoot: string;
}

interface Archive {
  readonly files: FileTable;
  readonly index: ReadonlyMap<number, number>;
}

/**
 * Bumped when the cached shape changes. An older file is then simply not
 * recognised and the assets are decoded again, which is why nothing here needs
 * a migration.
 */
const CACHE_VERSION = 1;

/** What one archive yields: the catalogue, plus where each icon lives in it. */
interface Extracted {
  readonly version: number;
  readonly skills: readonly SkillFacts[];
  /** Skill id to archive file id, only for skills whose icon was located. */
  readonly icons: Readonly<Record<number, number>>;
}

/**
 * A cache file is data this process wrote, but it is still read back as
 * unknown: a truncated or hand-edited file must decode again rather than reach
 * the editor as a catalogue of `undefined`.
 */
function readExtracted(value: unknown): Extracted | null {
  if (typeof value !== "object" || value === null) return null;
  const candidate = value as Partial<Extracted>;
  if (
    candidate.version !== CACHE_VERSION
    || !Array.isArray(candidate.skills)
    || candidate.skills.length === 0
    || typeof candidate.icons !== "object"
    || candidate.icons === null
  ) {
    return null;
  }
  const first: unknown = candidate.skills[0];
  if (
    typeof first !== "object" || first === null
    || typeof (first as SkillFacts).name !== "string"
    || typeof (first as SkillFacts).hasIcon !== "boolean"
  ) {
    return null;
  }
  return candidate as Extracted;
}

/**
 * Icons and text out of one client installation, decoded once and then read
 * from disk.
 */
export class SkillAssets {
  private readonly source: SkillAssetSource;
  private extractValue: Promise<Extracted | CatalogueRefusal> | null = null;
  private cacheDirValue: string | null = null;
  private readonly swept = new Set<string>();
  private archiveValue: Promise<Archive> | null = null;
  private readonly icons = new Map<number, Promise<Buffer | null>>();

  constructor(source: SkillAssetSource) {
    this.source = source;
  }

  /**
   * Where this archive's decoded assets live.
   *
   * Keyed by the chunk hashes rather than by a path: those identify the
   * archive's contents exactly, so a re-download to a different location reuses
   * the cache and an ArenaNet patch cannot.
   */
  private cacheDir(): string {
    this.cacheDirValue ??= path.join(
      this.source.cacheRoot,
      createHash("sha256")
        .update(this.source.store.hashes.join(""))
        .digest("hex")
        .slice(0, 32),
    );
    return this.cacheDirValue;
  }

  /**
   * Create a cache directory and collect any temporary file a previous run
   * abandoned between write and rename.
   *
   * This cache carries its own recovery because it is nested: the boot-time
   * sweep in `documentDirectories` walks a fixed list of directories and does
   * not descend, so nothing else would ever collect these.
   */
  private async prepare(dir: string): Promise<void> {
    await mkdir(dir, { recursive: true });
    if (this.swept.has(dir)) return;
    this.swept.add(dir);
    await sweepOrphans(dir);
  }

  private async openArchive(): Promise<Archive> {
    this.archiveValue ??= (async () => {
      const { store } = this.source;
      const headerBytes = await store.readRange(0, 32);
      const header = parseArchiveHeader(() => headerBytes);
      const tableBytes = await store.readRange(
        header.tableOffset,
        header.tableSize,
      );
      const files = readFileTable(
        (offset, length) =>
          tableBytes.subarray(
            offset - header.tableOffset,
            offset - header.tableOffset + length,
          ),
        header,
      );
      const slot = parseSlot(files.bytes, 2);
      const indexBytes = await store.readRange(slot.offset, slot.size);
      const index = fileIdIndex(
        (offset, length) =>
          indexBytes.subarray(
            offset - slot.offset,
            offset - slot.offset + length,
          ),
        files,
      );
      return { files, index };
    })();
    return this.archiveValue;
  }

  /** Every localized string the catalogue needs, by string id. */
  private async readStrings(
    wasm: Uint8Array,
    archive: Archive,
    wanted: ReadonlySet<number>,
  ): Promise<ReadonlyMap<number, string>> {
    const english = findLanguageFileIds(wasm)?.[0];
    const result = new Map<number, string>();
    if (!english) return result;
    const shards = new Set<number>();
    for (const id of wanted) {
      const { file } = stringShardIndex(id);
      if (file < english.length) shards.add(file);
    }
    for (const file of shards) {
      const fileId = english[file];
      if (fileId === undefined) continue;
      const stream = findStream(archive.files, archive.index, fileId);
      if (!stream?.compressed || stream.size > MAX_STREAM_BYTES) continue;
      let records: readonly (string | null)[];
      try {
        const compressed = await this.source.store.readRange(
          stream.offset,
          stream.size,
        );
        records = parseStringShard(
          await runDecoder(this.source.decoderPath, compressed, {
            args: ["--raw"],
            maxOutput: MAX_SHARD_BYTES,
            parse: decodedShard,
          }),
        );
      } catch {
        // One unreadable shard costs its own strings, not the catalogue.
        continue;
      }
      for (const id of wanted) {
        const at = stringShardIndex(id);
        if (at.file !== file) continue;
        const text = records[at.record];
        if (text) result.set(id, text);
      }
    }
    return result;
  }

  private async buildCatalogue(): Promise<Extracted | CatalogueRefusal> {
    let wasm: Buffer;
    try {
      wasm = await readFile(this.source.wasmPath);
    } catch {
      return "client-unreadable";
    }
    const table = findSkillTable(wasm);
    if (!table) return "table-not-found";

    let archive: Archive;
    try {
      archive = await this.openArchive();
    } catch {
      return "archive-unreadable";
    }

    const wanted = new Set<number>();
    for (const skill of table.skills) {
      if (skill.nameStringId !== 0) wanted.add(skill.nameStringId);
      if (skill.descriptionStringId !== 0) wanted.add(skill.descriptionStringId);
    }
    const strings = await this.readStrings(wasm, archive, wanted);

    const icons: Record<number, number> = {};
    const skills = table.skills.map((skill) => {
      const stream = skill.iconFileId === 0
        ? null
        : findStream(archive.files, archive.index, skill.iconFileId);
      if (stream) icons[skill.id] = skill.iconFileId;
      const description = strings.get(skill.descriptionStringId);
      return {
        id: skill.id,
        // The client's own spelling, apostrophes and all. Only a record with
        // no name at all falls back, and those are not equippable anyway.
        name: strings.get(skill.nameStringId) ?? `Skill ${skill.id}`,
        profession: PROFESSION.get(skill.profession) ?? null,
        elite: skill.elite,
        availability: skillAvailability(skill),
        attribute: ATTRIBUTE_BY_ID.get(skill.attribute) ?? null,
        energyCost: skill.energyCost,
        adrenalineCost: skill.adrenalineCost,
        healthCost: skill.healthCost,
        overcast: skill.overcast,
        activationSeconds: skill.activationSeconds,
        aftercastSeconds: skill.aftercastSeconds,
        rechargeSeconds: skill.rechargeSeconds,
        description: description
          ? formatSkillDescription(description, descriptionValues(skill))
          : null,
        hasIcon: stream !== null,
      } satisfies SkillFacts;
    });
    return { version: CACHE_VERSION, skills, icons };
  }

  /**
   * Everything extracted from this archive, from the on-disk cache when it has
   * been read before and from the archive itself otherwise.
   *
   * The icon file ids are cached with the catalogue rather than recomputed,
   * so a cache hit never has to re-read the client binary to serve an icon.
   */
  private extract(): Promise<Extracted | CatalogueRefusal> {
    this.extractValue ??= (async () => {
      const file = path.join(this.cacheDir(), "catalogue.json");
      try {
        const cached = readExtracted(JSON.parse(await readFile(file, "utf8")));
        if (cached) return cached;
      } catch {
        // No cache, or one this build cannot use. Decode it again.
      }
      const extracted = await this.buildCatalogue();
      if (typeof extracted !== "string") {
        try {
          await this.prepare(this.cacheDir());
          await writeAtomic(file, Buffer.from(JSON.stringify(extracted)));
        } catch {
          // A cache that cannot be written costs speed, never correctness.
        }
      }
      return extracted;
    })();
    return this.extractValue;
  }

  async catalogue(): Promise<CatalogueRead> {
    const extracted = await this.extract();
    return typeof extracted === "string"
      ? { ok: false, reason: extracted }
      : { ok: true, skills: extracted.skills };
  }

  /**
   * One skill's icon as a BMP, decoded on first request and cached on disk
   * thereafter. `null` means the archive has no icon for that skill.
   */
  icon(skillId: number): Promise<Buffer | null> {
    const existing = this.icons.get(skillId);
    if (existing) return existing;
    const request = this.decodeIcon(skillId).catch(() => null);
    this.icons.set(skillId, request);
    return request;
  }

  private async decodeIcon(skillId: number): Promise<Buffer | null> {
    const file = path.join(this.cacheDir(), "icons", `${skillId}.bmp`);
    try {
      return await readFile(file);
    } catch {
      // Not decoded yet.
    }
    const extracted = await this.extract();
    if (typeof extracted === "string") return null;
    const fileId = extracted.icons[skillId];
    if (fileId === undefined) return null;
    const archive = await this.openArchive();
    const stream = findStream(archive.files, archive.index, fileId);
    if (!stream?.compressed || stream.size > MAX_STREAM_BYTES) return null;
    const compressed = await this.source.store.readRange(
      stream.offset,
      stream.size,
    );
    const bmp = await runDecoder(this.source.decoderPath, compressed, {
      args: [],
      maxOutput: MAX_ICON_BYTES,
      parse: decodedIconToBmp,
    });
    try {
      await this.prepare(path.dirname(file));
      await writeAtomic(file, bmp);
    } catch {
      // Serving it matters; keeping it is an optimisation.
    }
    return bmp;
  }
}
