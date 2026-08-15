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
 * The catalogue is built eagerly — the editor cannot show a skill list without
 * it — and the roughly sixty language shards it needs are decoded through a
 * pool, because each one is a subprocess round-trip and sequentially they were
 * the whole cost. Icons are decoded lazily, on the request that first asks for
 * one, because a player who never opens the picker should not pay for 3,439.
 *
 * Nothing here is held longer than it is used. The catalogue records where each
 * icon's bytes are, so serving one never reopens the archive, and the 4.2 MB
 * file table and its 176,000-entry index are collected once the build returns.
 */

import { mkdir, readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { mapPool } from "./async-pool.js";
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
import {
  decodedArchiveBytes,
  runGwDatDecoder,
} from "./gw-dat-decoder.js";
import {
  ATTRIBUTE_BY_ID,
  PROFESSION_BY_ID,
} from "../../shared/builds/heroes.js";
import {
  findLanguageFileIds,
  formatSkillDescription,
  parseStringShard,
  stringShardIndex,
} from "./skill-strings.js";
import { findSkillTable, type SkillRecord } from "./skill-table.js";

/**
 * Title ids below Codex are the account title tracks used by player-only PvE
 * skills. This is the same boundary the game's own team-build catalogue uses.
 */
const CODEX_TITLE_ID = 41;

/**
 * The client's own answer to "may this go on a skill bar", from the field GWCA
 * calls `skill_equip_type` at `+h0033`.
 *
 * The table holds far more than skills: NPC attacks, item effects, minigame
 * moves and title-track bookkeeping all share it. Of 3,443 records only 1,333
 * carry this value, and the ones that do not are things like `Boss Bounty`,
 * `Hunt Point Bonus`, the 58 `Polymock` moves, and three records literally
 * named `[null]` — every one of which the editor used to offer.
 */
const EQUIPPABLE = 1;

/** Bounds on what the helper may hand back, applied before anything is read. */
const MAX_ICON_BYTES = 256 * 256 * 4 + 8;
const MAX_SHARD_BYTES = 1024 * 1024 + 8;
const MAX_STREAM_BYTES = 1024 * 1024;
/**
 * How many shard decoders run at once. This bounds local processes against
 * local cores; it is deliberately not named for a "job" or a "concurrency"
 * budget, because the only such budget this application has is
 * `ARENANET_REQUEST_CEILING` — requests in flight to ArenaNet — and nothing
 * here spends it. `the-download-schedulers-share-one-ceiling` exists to keep
 * those two from being read as the same number.
 */
const SHARD_DECODERS = 8;
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
  skill: Pick<SkillRecord, "equipType" | "playable" | "pvp" | "pve" | "title">,
): SkillFacts["availability"] {
  if (skill.equipType !== EQUIPPABLE || !skill.playable) return "not-equippable";
  if (skill.pvp) return "pvp";
  if (skill.pve && skill.title < CODEX_TITLE_ID) return "player-only-pve";
  return "pve";
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
  return decodedArchiveBytes(decoded, MAX_STREAM_BYTES, "shard");
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
const CACHE_VERSION = 3;

/**
 * Where one icon's bytes sit in the archive.
 *
 * Resolving a file id to this costs the 4.2 MB file table and an id index of
 * roughly 176,000 entries. Storing the answer means serving an icon never opens
 * the archive, so nothing holds ~12 MB of index for the life of the process.
 */
interface IconStream {
  readonly offset: number;
  readonly size: number;
}

/** What one archive yields: the catalogue, plus where each icon lives in it. */
interface Extracted {
  readonly version: number;
  readonly skills: readonly SkillFacts[];
  /** Skill id to stream location, only for skills whose icon was located. */
  readonly icons: Readonly<Record<number, IconStream>>;
}

/**
 * A cache file is data this process wrote, so this checks that it is *this*
 * version's shape and not that every element is well-formed. Probing fields on
 * one element would not make the rest sound, and the version — bumped whenever
 * the shape changes — is the mechanism that actually retires a stale file.
 *
 * The renderer validates every record it receives regardless
 * (`apps/tools/src/host.ts`), because that boundary does not trust this one.
 */
function readExtracted(value: unknown): Extracted | null {
  if (typeof value !== "object" || value === null) return null;
  const candidate = value as Partial<Extracted>;
  const usable =
    candidate.version === CACHE_VERSION
    && Array.isArray(candidate.skills)
    && candidate.skills.length > 0
    && typeof candidate.icons === "object"
    && candidate.icons !== null;
  return usable ? (candidate as Extracted) : null;
}

/**
 * Icons and text out of one client installation, decoded once and then read
 * from disk.
 */
export class SkillAssets {
  private readonly source: SkillAssetSource;
  /**
   * Where this archive's decoded assets live.
   *
   * Keyed by the chunk hashes rather than by a path: those identify the
   * archive's contents exactly, so a re-download to a different location reuses
   * the cache and an ArenaNet patch cannot. Fixed for the instance's lifetime,
   * so it is computed once here rather than memoised behind a method.
   */
  private readonly cacheDir: string;
  private extracted: Extracted | null = null;
  private extractInFlight: Promise<Extracted | CatalogueRefusal> | null = null;
  private readonly swept = new Set<string>();
  private readonly icons = new Map<number, Promise<Buffer | null>>();

  constructor(source: SkillAssetSource) {
    this.source = source;
    this.cacheDir = path.join(
      source.cacheRoot,
      createHash("sha256")
        .update(source.store.hashes.join(""))
        .digest("hex")
        .slice(0, 32),
    );
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

  /**
   * The archive's file table and id index.
   *
   * Deliberately not memoised. `buildCatalogue` is the only caller and runs at
   * most once per instance, so holding this would keep a 4.2 MB table and an
   * index of some 176,000 entries alive for the life of the process to serve
   * nothing — every later icon request reads its location out of `Extracted`.
   */
  private async openArchive(): Promise<Archive> {
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
        indexBytes.subarray(offset - slot.offset, offset - slot.offset + length),
      files,
    );
    return { files, index };
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

    // One pass to group the ids by the shard that holds them. Re-walking all
    // ~6,900 wanted ids inside the per-shard loop was the obvious shape and
    // did the same work sixty times over.
    const byShard = new Map<number, number[]>();
    for (const id of wanted) {
      const { file } = stringShardIndex(id);
      if (file >= english.length) continue;
      const ids = byShard.get(file);
      if (ids) ids.push(id);
      else byShard.set(file, [id]);
    }

    // Each shard is a subprocess round-trip, and about sixty of them run for
    // one catalogue. Sequentially that is the dominant cost of a cold build;
    // pooled it is roughly a quarter of it. Every shard writes only its own
    // ids, so they do not contend.
    await mapPool([...byShard], SHARD_DECODERS, async ([file, ids]) => {
      const fileId = english[file];
      if (fileId === undefined) return;
      const stream = findStream(archive.files, archive.index, fileId);
      if (!stream?.compressed || stream.size > MAX_STREAM_BYTES) return;
      try {
        const compressed = await this.source.store.readRange(
          stream.offset,
          stream.size,
        );
        const records = parseStringShard(
          await runGwDatDecoder(this.source.decoderPath, compressed, {
            args: ["--raw"],
            maxOutput: MAX_SHARD_BYTES,
            parse: decodedShard,
          }),
        );
        for (const id of ids) {
          const text = records[stringShardIndex(id).record];
          if (text) result.set(id, text);
        }
      } catch {
        // One unreadable shard costs its own strings, not the catalogue.
      }
    });
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

    const icons: Record<number, IconStream> = {};
    const skills = table.skills.map((skill) => {
      const found = skill.iconFileId === 0
        ? null
        : findStream(archive.files, archive.index, skill.iconFileId);
      // Compressed streams only, and bounded, so `decodeIcon` can read this
      // straight from the cache without consulting the archive again.
      const stream = found?.compressed && found.size <= MAX_STREAM_BYTES
        ? found
        : null;
      if (stream) icons[skill.id] = { offset: stream.offset, size: stream.size };
      const description = strings.get(skill.descriptionStringId);
      return {
        id: skill.id,
        // The client's own spelling, apostrophes and all. Only a record with
        // no name at all falls back, and those are not equippable anyway.
        name: strings.get(skill.nameStringId) ?? `Skill ${skill.id}`,
        profession: PROFESSION_BY_ID.get(skill.profession) ?? null,
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
    if (this.extracted) return Promise.resolve(this.extracted);
    if (this.extractInFlight) return this.extractInFlight;
    const request = (async () => {
      const file = path.join(this.cacheDir, "catalogue.json");
      try {
        const cached = readExtracted(JSON.parse(await readFile(file, "utf8")));
        if (cached) return cached;
      } catch {
        // No cache, or one this build cannot use. Decode it again.
      }
      const extracted = await this.buildCatalogue();
      if (typeof extracted !== "string") {
        try {
          await this.prepare(this.cacheDir);
          await writeAtomic(file, Buffer.from(JSON.stringify(extracted)));
        } catch {
          // A cache that cannot be written costs speed, never correctness.
        }
      }
      if (typeof extracted !== "string") this.extracted = extracted;
      return extracted;
    })().finally(() => {
      if (this.extractInFlight === request) this.extractInFlight = null;
    });
    this.extractInFlight = request;
    return request;
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
    const request = this.decodeIcon(skillId)
      .catch(() => null)
      .finally(() => {
        if (this.icons.get(skillId) === request) this.icons.delete(skillId);
      });
    this.icons.set(skillId, request);
    return request;
  }

  private async decodeIcon(skillId: number): Promise<Buffer | null> {
    const file = path.join(this.cacheDir, "icons", `${skillId}.bmp`);
    try {
      return await readFile(file);
    } catch {
      // Not decoded yet.
    }
    const extracted = await this.extract();
    if (typeof extracted === "string") return null;
    const stream = extracted.icons[skillId];
    if (stream === undefined) return null;
    const compressed = await this.source.store.readRange(
      stream.offset,
      stream.size,
    );
    const bmp = await runGwDatDecoder(this.source.decoderPath, compressed, {
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
