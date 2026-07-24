import { readdir, readFile, stat, unlink } from "node:fs/promises";
import { join } from "node:path";
import { mapPool } from "./async-pool.js";
import { parsePublishedClientManifest } from "./published-client.js";

const CONTENT_HASH = /^[a-f0-9]{32}(?:[a-f0-9]{8}|[a-f0-9]{32})?$/;

export interface ChunkPruneResult {
  files: number;
  bytes: number;
}

async function referencedHashes(
  manifestPath: string,
  optional: boolean,
): Promise<string[] | null> {
  try {
    return parsePublishedClientManifest(
      JSON.parse(await readFile(manifestPath, "utf8")),
    ).chunkHashes;
  } catch (error) {
    if (
      optional &&
      error instanceof Error &&
      "code" in error &&
      error.code === "ENOENT"
    ) {
      return null;
    }
    throw error;
  }
}

/**
 * Remove only content-addressed chunk files that neither the current client
 * nor its rollback generation references. Unknown files and directories are
 * deliberately left alone.
 */
export async function pruneUnreferencedChunks(options: {
  chunksDir: string;
  currentManifest: string;
  previousManifest?: string;
  jobs?: number;
}): Promise<ChunkPruneResult> {
  const current = await referencedHashes(options.currentManifest, false);
  const previous = options.previousManifest
    ? await referencedHashes(options.previousManifest, true)
    : null;
  const keep = new Set([...(current ?? []), ...(previous ?? [])]);
  const entries = await readdir(options.chunksDir, { withFileTypes: true }).catch(
    (error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return [];
      throw error;
    },
  );
  const stale = entries.filter(
    (entry) => entry.isFile() && CONTENT_HASH.test(entry.name) && !keep.has(entry.name),
  );
  let files = 0;
  let bytes = 0;
  await mapPool(stale, options.jobs ?? 8, async (entry) => {
    const target = join(options.chunksDir, entry.name);
    const size = await stat(target).then(
      (value) => value.size,
      () => 0,
    );
    try {
      await unlink(target);
      files += 1;
      bytes += size;
    } catch (error) {
      if (
        !(error instanceof Error) ||
        !("code" in error) ||
        error.code !== "ENOENT"
      ) {
        throw error;
      }
    }
  });
  return { files, bytes };
}
