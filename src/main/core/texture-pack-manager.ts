/**
 * Owns imported TPF bytes, atomic pack directories, global selection, and
 * per-window generation leases. No source path leaves this owner.
 */
import { createHash, randomBytes } from "node:crypto";
import { constants } from "node:fs";
import { access, mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { PNG } from "pngjs";
import {
  parseTexturePackRuntimeManifest,
  type TexturePackImportResult,
  type TexturePackRuntimeManifest,
  type TexturePackSnapshot,
  type TexturePackSummary,
} from "../../shared/texture-packs.js";
import { writeAtomicJson } from "./atomic-file.js";
import { decodeDds, type DecodedTexture } from "./dds.js";
import { Mutex } from "./mutex.js";
import { readTpf, TpfError } from "./tpf.js";

const MAX_SOURCE_BYTES = 256 * 1024 * 1024;
const MAX_TEXTURE_BYTES = 64 * 1024 * 1024;
const MAX_COMPILED_BYTES = 256 * 1024 * 1024;
const FILE_MODE = 0o600;
const DIRECTORY_MODE = 0o700;

interface Selection {
  readonly formatVersion: 1;
  readonly selectedPackId: string | null;
}

export interface TexturePackPaths {
  readonly root: string;
  readonly selection: string;
  readonly packs: string;
  readonly staging: string;
}

function packId(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{32}$/u.test(value);
}

function digest(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{64}$/u.test(value);
}

function parseSummary(value: unknown): TexturePackSummary {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("texture pack is invalid");
  const source = value as Record<string, unknown>;
  if (!packId(source.id) || typeof source.name !== "string" || source.name.length === 0 || source.name.length > 100
    || !Number.isSafeInteger(source.sourceBytes) || (source.sourceBytes as number) <= 0
    || !Number.isSafeInteger(source.compiledBytes) || (source.compiledBytes as number) <= 0
    || !Number.isSafeInteger(source.mappings) || (source.mappings as number) <= 0
    || typeof source.importedAt !== "string" || !Number.isFinite(Date.parse(source.importedAt))
    || !digest(source.sourceSha256) || (source.status !== "ready" && source.status !== "missing-source")) {
    throw new Error("texture pack metadata is invalid");
  }
  return source as unknown as TexturePackSummary;
}

function parseSelection(value: unknown): Selection {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("texture pack selection is invalid");
  const source = value as Record<string, unknown>;
  if (source.formatVersion !== 1 || (source.selectedPackId !== null && !packId(source.selectedPackId))) {
    throw new Error("texture pack selection is invalid");
  }
  return { formatVersion: 1, selectedPackId: source.selectedPackId as string | null };
}

function displayName(filePath: string): string {
  const base = [...path.basename(filePath, path.extname(filePath))]
    .filter((character) => character.charCodeAt(0) >= 32 && character.charCodeAt(0) !== 127)
    .join("")
    .trim();
  return (base || "Texture pack").slice(0, 100);
}

function decodePng(bytes: Uint8Array): DecodedTexture {
  if (bytes.byteLength < 24 || bytes[0] !== 0x89 || bytes[1] !== 0x50 || bytes[2] !== 0x4e || bytes[3] !== 0x47) {
    throw new Error("PNG header is invalid");
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const width = view.getUint32(16, false);
  const height = view.getUint32(20, false);
  if (width === 0 || height === 0 || width > 4096 || height > 4096 || width * height * 4 > MAX_TEXTURE_BYTES) {
    throw new Error("PNG dimensions are outside the supported range");
  }
  const decoded = PNG.sync.read(Buffer.from(bytes), { skipRescale: true });
  if (decoded.width !== width || decoded.height !== height || decoded.data.byteLength !== width * height * 4) {
    throw new Error("PNG decoded dimensions are inconsistent");
  }
  return { width, height, rgba: new Uint8Array(decoded.data) };
}

function decodeImage(name: string, bytes: Uint8Array): DecodedTexture {
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_TEXTURE_BYTES) {
    throw new TpfError("limit_exceeded", "texture is outside the safety limit");
  }
  try {
    if (name.toLowerCase().endsWith(".dds")) return decodeDds(bytes);
    if (name.toLowerCase().endsWith(".png")) return decodePng(bytes);
  } catch (error) {
    if (error instanceof TpfError) throw error;
    const message = error instanceof Error ? error.message : "texture cannot be decoded";
    if (message.includes("dimensions")) throw new TpfError("unsupported_dimensions", message);
    throw new TpfError("unsupported_image", message);
  }
  throw new TpfError("unsupported_image", "only DDS and PNG texture entries are supported");
}

export function compileTpf(source: Uint8Array): Readonly<{
  manifest: TexturePackRuntimeManifest;
  textures: Uint8Array;
}> {
  const mappings = readTpf(source);
  const entries: TexturePackRuntimeManifest["entries"][number][] = [];
  const parts: Uint8Array[] = [];
  let offset = 0;
  for (const mapping of mappings) {
    const texture = decodeImage(mapping.name, mapping.bytes);
    const rgbaOffset = offset;
    if (offset + texture.rgba.byteLength > MAX_COMPILED_BYTES) {
      throw new TpfError("limit_exceeded", "compiled texture pack is too large");
    }
    parts.push(texture.rgba);
    offset += texture.rgba.byteLength;
    const compressed = texture.compressed ? {
      mode: texture.compressed.mode,
      levels: texture.compressed.levels.map((bytes) => {
        const positioned = { offset, length: bytes.byteLength };
        if (offset + bytes.byteLength > MAX_COMPILED_BYTES) {
          throw new TpfError("limit_exceeded", "compiled texture pack is too large");
        }
        parts.push(bytes);
        offset += bytes.byteLength;
        return positioned;
      }),
    } : undefined;
    entries.push({
      target: mapping.target,
      width: texture.width,
      height: texture.height,
      offset: rgbaOffset,
      length: texture.rgba.byteLength,
      ...(compressed ? { compressed } : {}),
    });
  }
  const textures = new Uint8Array(offset);
  let cursor = 0;
  for (const part of parts) {
    textures.set(part, cursor);
    cursor += part.byteLength;
  }
  return {
    manifest: {
      formatVersion: 1,
      sourceSha256: createHash("sha256").update(source).digest("hex"),
      bytes: textures.byteLength,
      entries,
    },
    textures,
  };
}

function failure(error: unknown): TexturePackImportResult {
  if (error instanceof TpfError) return { status: "failed", reason: error.code };
  const code = (error as NodeJS.ErrnoException | undefined)?.code;
  if (code === "ENOSPC") return { status: "failed", reason: "disk_full" };
  if (code === "EACCES" || code === "EPERM") return { status: "failed", reason: "permission_denied" };
  return { status: "failed", reason: "unknown" };
}

export class TexturePackManager {
  private selection: Selection = { formatVersion: 1, selectedPackId: null };
  private packs: readonly TexturePackSummary[] = [];
  private readonly leases = new Map<string, number>();
  private readonly retired = new Map<string, string>();
  private readonly lock = new Mutex();
  readonly paths: TexturePackPaths;
  private readonly changed: () => void;

  constructor(
    paths: TexturePackPaths,
    changed: () => void,
  ) {
    this.paths = paths;
    this.changed = changed;
  }

  async initialise(): Promise<void> {
    await rm(this.paths.staging, { recursive: true, force: true });
    await Promise.all([
      mkdir(this.paths.root, { recursive: true, mode: DIRECTORY_MODE }),
      mkdir(this.paths.packs, { recursive: true, mode: DIRECTORY_MODE }),
      mkdir(this.paths.staging, { recursive: true, mode: DIRECTORY_MODE }),
    ]);
    try {
      this.selection = parseSelection(JSON.parse((await readFile(this.paths.selection)).toString("utf8")) as unknown);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        await rename(this.paths.selection, `${this.paths.selection}.corrupt-${Date.now()}`).catch(() => undefined);
      }
      await this.saveSelection(null);
    }
    const discovered: TexturePackSummary[] = [];
    for (const entry of await readdir(this.paths.packs, { withFileTypes: true })) {
      if (!entry.isDirectory() || !packId(entry.name)) continue;
      try {
        const directory = path.join(this.paths.packs, entry.name);
        const metadata = parseSummary(JSON.parse((await readFile(path.join(directory, "metadata.json"))).toString("utf8")) as unknown);
        if (metadata.id !== entry.name) continue;
        const status = await this.sourceExists(directory) ? "ready" as const : "missing-source" as const;
        discovered.push({ ...metadata, status });
      } catch {
        // A user-modified directory is not an installed pack.
      }
    }
    this.packs = discovered.sort((left, right) => left.importedAt.localeCompare(right.importedAt));
    if (!this.packs.some((pack) => pack.id === this.selection.selectedPackId && pack.status === "ready")) {
      await this.saveSelection(null);
    }
  }

  snapshot(): TexturePackSnapshot {
    return { selectedPackId: this.selection.selectedPackId, packs: this.packs };
  }

  async importFile(filePath: string): Promise<TexturePackImportResult> {
    return this.lock.run(async () => {
      try {
        if (path.extname(filePath).toLowerCase() !== ".tpf") return { status: "failed", reason: "not_tpf" };
        const info = await stat(filePath);
        if (!info.isFile() || info.size === 0 || info.size > MAX_SOURCE_BYTES) return { status: "failed", reason: "limit_exceeded" };
        const source = await readFile(filePath);
        const sourceSha256 = createHash("sha256").update(source).digest("hex");
        const duplicate = this.packs.find((pack) => pack.sourceSha256 === sourceSha256);
        if (duplicate) return { status: "duplicate", packId: duplicate.id };
        const compiled = compileTpf(source);
        const id = randomBytes(16).toString("hex");
        const summary: TexturePackSummary = {
          id,
          name: displayName(filePath),
          sourceBytes: source.byteLength,
          compiledBytes: compiled.textures.byteLength,
          mappings: compiled.manifest.entries.length,
          importedAt: new Date().toISOString(),
          sourceSha256,
          status: "ready",
        };
        const staged = path.join(this.paths.staging, id);
        const compiledDirectory = path.join(staged, "compiled", "1");
        await mkdir(compiledDirectory, { recursive: true, mode: DIRECTORY_MODE });
        await Promise.all([
          writeFile(path.join(staged, "source.tpf"), source, { mode: FILE_MODE }),
          writeFile(path.join(staged, "metadata.json"), `${JSON.stringify(summary, null, 2)}\n`, { mode: FILE_MODE }),
          writeFile(path.join(compiledDirectory, "manifest.json"), `${JSON.stringify(compiled.manifest)}\n`, { mode: FILE_MODE }),
          writeFile(path.join(compiledDirectory, "textures.rgba"), compiled.textures, { mode: FILE_MODE }),
        ]);
        await rename(staged, this.packDirectory(id));
        this.packs = [...this.packs, summary];
        this.changed();
        return { status: "imported", packId: id };
      } catch (error) {
        return failure(error);
      }
    });
  }

  async select(id: string | null): Promise<void> {
    await this.lock.run(async () => {
      if (id !== null) await this.ensureRuntime(id);
      await this.saveSelection(id);
      this.changed();
    });
  }

  async remove(id: string): Promise<void> {
    await this.lock.run(async () => {
      if (!this.packs.some((pack) => pack.id === id)) throw new Error("Texture pack is not installed");
      const directory = this.packDirectory(id);
      if ((this.leases.get(id) ?? 0) > 0) {
        const retired = path.join(this.paths.staging, `retired-${id}`);
        await rename(directory, retired);
        this.retired.set(id, retired);
      } else {
        await rm(directory, { recursive: true, force: true });
      }
      this.packs = this.packs.filter((pack) => pack.id !== id);
      if (this.selection.selectedPackId === id) {
        this.selection = { formatVersion: 1, selectedPackId: null };
        await writeAtomicJson(this.paths.selection, this.selection, FILE_MODE);
      }
      this.changed();
    });
  }

  async acquireCurrentGeneration(): Promise<string | null> {
    return this.lock.run(async () => {
      const id = this.selection.selectedPackId;
      if (!id) return null;
      try {
        await this.ensureRuntime(id);
        this.leases.set(id, (this.leases.get(id) ?? 0) + 1);
        return id;
      } catch {
        await this.saveSelection(null);
        this.changed();
        return null;
      }
    });
  }

  async releaseGeneration(id: string): Promise<void> {
    await this.lock.run(async () => {
      const remaining = (this.leases.get(id) ?? 0) - 1;
      if (remaining > 0) {
        this.leases.set(id, remaining);
        return;
      }
      this.leases.delete(id);
      const retired = this.retired.get(id);
      if (!retired) return;
      this.retired.delete(id);
      await rm(retired, { recursive: true, force: true });
    });
  }

  async runtimeAsset(id: string, asset: "manifest.json" | "textures.rgba"): Promise<Uint8Array | null> {
    if (!packId(id) || (this.leases.get(id) ?? 0) === 0) return null;
    const root = this.retired.get(id) ?? this.packDirectory(id);
    try {
      return await readFile(path.join(root, "compiled", "1", asset));
    } catch {
      return null;
    }
  }

  private packDirectory(id: string): string {
    return path.join(this.paths.packs, id);
  }

  private async sourceExists(directory: string): Promise<boolean> {
    try {
      await access(path.join(directory, "source.tpf"), constants.R_OK);
      return true;
    } catch {
      return false;
    }
  }

  private async ensureRuntime(id: string): Promise<void> {
    const summary = this.packs.find((pack) => pack.id === id);
    if (!summary || summary.status !== "ready") throw new Error("Texture pack is unavailable");
    if ((this.leases.get(id) ?? 0) > 0) return;
    const directory = this.packDirectory(id);
    const source = await readFile(path.join(directory, "source.tpf"));
    if (createHash("sha256").update(source).digest("hex") !== summary.sourceSha256) {
      throw new Error("managed texture pack source does not match its checksum");
    }
    const compiledDirectory = path.join(directory, "compiled", "1");
    try {
      const [manifestBytes, textures] = await Promise.all([
        readFile(path.join(compiledDirectory, "manifest.json")),
        readFile(path.join(compiledDirectory, "textures.rgba")),
      ]);
      const manifest = parseTexturePackRuntimeManifest(
        JSON.parse(manifestBytes.toString("utf8")) as unknown,
        textures.byteLength,
      );
      if (manifest.sourceSha256 !== summary.sourceSha256) throw new Error("compiled source checksum is stale");
      return;
    } catch {
      const compiled = compileTpf(source);
      const next = path.join(directory, `compiled-next-${randomBytes(8).toString("hex")}`);
      const previous = path.join(directory, `compiled-old-${randomBytes(8).toString("hex")}`);
      await mkdir(next, { recursive: true, mode: DIRECTORY_MODE });
      await Promise.all([
        writeFile(path.join(next, "manifest.json"), `${JSON.stringify(compiled.manifest)}\n`, { mode: FILE_MODE }),
        writeFile(path.join(next, "textures.rgba"), compiled.textures, { mode: FILE_MODE }),
      ]);
      await rename(compiledDirectory, previous).catch((error: NodeJS.ErrnoException) => {
        if (error.code !== "ENOENT") throw error;
      });
      await mkdir(path.dirname(compiledDirectory), { recursive: true, mode: DIRECTORY_MODE });
      await rename(next, compiledDirectory);
      await rm(previous, { recursive: true, force: true });
    }
  }

  private async saveSelection(selectedPackId: string | null): Promise<void> {
    const next: Selection = { formatVersion: 1, selectedPackId };
    await writeAtomicJson(this.paths.selection, next, FILE_MODE);
    this.selection = next;
  }
}
