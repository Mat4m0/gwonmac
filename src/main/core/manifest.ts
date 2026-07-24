import { AppError } from "../../shared/errors.js";
import { parseContentHash } from "./chunk-format.js";

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

  constructor(raw: RawManifest) {
    if (raw.compressionMode !== "none" && raw.compressionMode !== "gzip") {
      throw new AppError(
        "bad_compression",
        `unsupported compression: ${JSON.stringify(raw.compressionMode)}`,
      );
    }
    this.compression = raw.compressionMode;
    this.chunkSize = raw.chunkSize;
    if (!Number.isInteger(this.chunkSize) || this.chunkSize <= 0) {
      throw new AppError("bad_chunk_size", `bad chunkSize: ${JSON.stringify(this.chunkSize)}`);
    }

    // directories[] / files[] are flat lists linked by parentIndex; a falsy
    // parentIndex (including 0) means the root, matching the client.
    const dirs = raw.directories ?? [];
    const paths: string[] = [];
    for (const d of dirs) {
      const parts = [d.name];
      let cur = d.parentIndex;
      while (cur) {
        parts.push(dirs[cur]!.name);
        cur = dirs[cur]!.parentIndex;
      }
      paths.push(parts.reverse().join("/"));
    }

    this.files = {};
    for (const f of raw.files ?? []) {
      const p = f.parentIndex;
      const path = p ? `${paths[p]}/${f.name}` : f.name;
      const expected = Math.floor((f.size + this.chunkSize - 1) / this.chunkSize);
      if (f.chunkHashes.length !== expected) {
        throw new AppError("chunk_count", `chunk count mismatch for ${path}`);
      }
      this.files[path] = {
        ...f,
        chunkHashes: f.chunkHashes.map(parseContentHash),
      };
    }
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
}
