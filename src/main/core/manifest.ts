/**
 * The parser for an ArenaNet patch manifest, which is treated as hostile input.
 *
 * Every bound here — name length, reserved names, directory and file counts,
 * total chunk references, chunk size — exists because flat `parentIndex`-linked
 * lists arrive over the network and are turned into filesystem-shaped paths. A
 * name carrying a separator or a NUL, a parent cycle, a duplicate path, a chunk
 * count that disagrees with the declared size, or one hash claiming two lengths
 * is a refusal and never something to normalise: a manifest that parses here is
 * one whose paths may be joined onto a real directory.
 *
 * Construction either yields a fully validated manifest or throws. There is no
 * partially trusted intermediate state for a caller to observe.
 */
import { AppError } from "../../shared/errors.js";
import { parseContentHash } from "./chunk-format.js";

const MAX_CHUNK_SIZE = 16 * 1024 * 1024;
const MAX_DIRECTORIES = 4_096;
const MAX_FILES = 4_096;
const MAX_CHUNK_REFERENCES = 1_000_000;
const MAX_NAME_LENGTH = 255;
const RESERVED_NAMES = new Set([".", "..", "__proto__", "prototype", "constructor"]);

export type CompressionMode = "none" | "gzip";

export interface ManifestFileEntry {
  name: string;
  size: number;
  chunkHashes: string[];
  parentIndex?: number;
}

export interface ManifestDirectory {
  name: string;
  parentIndex?: number;
}

export interface RawManifest {
  compressionMode: string;
  chunkSize: number;
  directories?: ManifestDirectory[];
  files?: ManifestFileEntry[];
}

export class Manifest {
  readonly compression: CompressionMode;
  readonly chunkSize: number;
  readonly files: Record<string, ManifestFileEntry>;

  constructor(value: unknown) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new AppError("manifest_format", "manifest must be an object");
    }
    const raw = value as RawManifest;
    if (raw.compressionMode !== "none" && raw.compressionMode !== "gzip") {
      throw new AppError(
        "bad_compression",
        `unsupported compression: ${JSON.stringify(raw.compressionMode)}`,
      );
    }
    this.compression = raw.compressionMode;
    this.chunkSize = raw.chunkSize;
    if (
      !Number.isSafeInteger(this.chunkSize) ||
      this.chunkSize <= 0 ||
      this.chunkSize > MAX_CHUNK_SIZE
    ) {
      throw new AppError("bad_chunk_size", `bad chunkSize: ${JSON.stringify(this.chunkSize)}`);
    }

    // directories[] / files[] are flat lists linked by parentIndex; a falsy
    // parentIndex (including 0) means the root, matching the client.
    const dirs = raw.directories ?? [];
    const files = raw.files ?? [];
    if (!Array.isArray(dirs) || dirs.length > MAX_DIRECTORIES) {
      throw new AppError("manifest_directories", "invalid directory list");
    }
    if (!Array.isArray(files) || files.length > MAX_FILES) {
      throw new AppError("manifest_files", "invalid file list");
    }

    const validateName = (value: unknown, kind: string): string => {
      if (
        typeof value !== "string" ||
        value.length === 0 ||
        value.length > MAX_NAME_LENGTH ||
        value.includes("/") ||
        value.includes("\\") ||
        value.includes("\0") ||
        RESERVED_NAMES.has(value)
      ) {
        throw new AppError("manifest_name", `invalid ${kind} name`);
      }
      return value;
    };
    // The live service omits the field on flat entries by sending null, not by
    // leaving it out. Rejecting that stopped every client update from applying.
    const validateParent = (value: unknown, kind: string): number => {
      if (value === undefined || value === null) return 0;
      if (!Number.isSafeInteger(value) || (value as number) < 0 || (value as number) >= dirs.length) {
        throw new AppError(
          "manifest_parent",
          `invalid ${kind} parent index ${JSON.stringify(value)} of ${dirs.length}`,
        );
      }
      return value as number;
    };

    const paths: Array<string | undefined> = new Array(dirs.length);
    const visiting = new Uint8Array(dirs.length);
    const resolveDirectory = (index: number): string => {
      const known = paths[index];
      if (known !== undefined) return known;
      if (visiting[index] === 1) {
        throw new AppError("manifest_cycle", "directory parent cycle");
      }
      const directory = dirs[index];
      if (!directory || typeof directory !== "object" || Array.isArray(directory)) {
        throw new AppError("manifest_directories", "invalid directory entry");
      }
      visiting[index] = 1;
      const name = validateName(directory.name, "directory");
      const parent = validateParent(directory.parentIndex, "directory");
      const path = parent ? `${resolveDirectory(parent)}/${name}` : name;
      visiting[index] = 2;
      paths[index] = path;
      return path;
    };
    for (let i = 0; i < dirs.length; i++) {
      resolveDirectory(i);
    }
    if (new Set(paths).size !== paths.length) {
      throw new AppError("manifest_duplicate", "duplicate directory path");
    }

    const parsedFiles: Record<string, ManifestFileEntry> = Object.create(null);
    const hashLengths = new Map<string, number>();
    let chunkReferences = 0;
    for (const f of files) {
      if (!f || typeof f !== "object" || Array.isArray(f)) {
        throw new AppError("manifest_files", "invalid file entry");
      }
      const name = validateName(f.name, "file");
      const p = validateParent(f.parentIndex, "file");
      const path = p ? `${paths[p]}/${name}` : name;
      if (Object.hasOwn(parsedFiles, path)) {
        throw new AppError("manifest_duplicate", `duplicate manifest path ${path}`);
      }
      if (!Number.isSafeInteger(f.size) || f.size <= 0) {
        throw new AppError("manifest_size", `invalid size for ${path}`);
      }
      if (!Array.isArray(f.chunkHashes)) {
        throw new AppError("chunk_count", `invalid chunk list for ${path}`);
      }
      const expected = Math.ceil(f.size / this.chunkSize);
      if (f.chunkHashes.length !== expected) {
        throw new AppError("chunk_count", `chunk count mismatch for ${path}`);
      }
      chunkReferences += expected;
      if (chunkReferences > MAX_CHUNK_REFERENCES) {
        throw new AppError("manifest_chunks", "too many chunk references");
      }
      const chunkHashes = f.chunkHashes.map(parseContentHash);
      for (let i = 0; i < chunkHashes.length; i++) {
        const hash = chunkHashes[i]!;
        const length = Math.min(this.chunkSize, f.size - i * this.chunkSize);
        const previous = hashLengths.get(hash);
        if (previous !== undefined && previous !== length) {
          throw new AppError("chunk_length", `chunk ${hash} has conflicting lengths`);
        }
        hashLengths.set(hash, length);
      }
      const parsed: ManifestFileEntry = {
        name,
        size: f.size,
        chunkHashes,
      };
      if (p) parsed.parentIndex = p;
      parsedFiles[path] = parsed;
    }
    this.files = parsedFiles;
  }

  find(basename: string): string | null {
    for (const p of Object.keys(this.files)) {
      const base = p.split("/").pop();
      if (base === basename) return p;
    }
    return null;
  }

  entry(basename: string): ManifestFileEntry | null {
    const path = this.find(basename);
    return path ? this.files[path]! : null;
  }

  requireUniqueBasenames(basenames: readonly string[]): void {
    for (const basename of basenames) {
      let matches = 0;
      for (const path of Object.keys(this.files)) {
        if (path.split("/").pop() === basename) matches += 1;
      }
      if (matches !== 1) {
        throw new AppError(
          "manifest_required",
          `manifest must contain exactly one ${basename}`,
        );
      }
    }
  }
}
