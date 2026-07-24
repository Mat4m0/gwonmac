import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { pruneUnreferencedChunks } from "../../src/main/core/chunk-cache.js";

const currentHash = "a".repeat(32);
const previousHash = "b".repeat(40);
const staleHash = "c".repeat(64);

function manifest(hash: string): string {
  return JSON.stringify({
    compressionMode: "none",
    chunkSize: 4,
    snapshot: "Gw.snapshot",
    size: 4,
    chunkHashes: [hash],
  });
}

async function exists(target: string): Promise<boolean> {
  return stat(target).then(
    () => true,
    () => false,
  );
}

describe("chunk cache pruning", () => {
  it("preserves current and rollback data and removes only stale hashes", async () => {
    const root = await mkdtemp(join(tmpdir(), "gw-chunk-prune-"));
    const chunksDir = join(root, "chunks");
    const currentManifest = join(root, "artifacts", "manifest.json");
    const previousManifest = join(root, "artifacts.previous", "manifest.json");
    await mkdir(chunksDir, { recursive: true });
    await mkdir(join(root, "artifacts"), { recursive: true });
    await mkdir(join(root, "artifacts.previous"), { recursive: true });
    await writeFile(currentManifest, manifest(currentHash));
    await writeFile(previousManifest, manifest(previousHash));
    await writeFile(join(chunksDir, currentHash), "aaaa");
    await writeFile(join(chunksDir, previousHash), "bbbb");
    await writeFile(join(chunksDir, staleHash), "stale");
    await writeFile(join(chunksDir, "notes"), "unknown");

    assert.deepEqual(
      await pruneUnreferencedChunks({
        chunksDir,
        currentManifest,
        previousManifest,
      }),
      { files: 1, bytes: 5 },
    );
    assert.equal(await exists(join(chunksDir, currentHash)), true);
    assert.equal(await exists(join(chunksDir, previousHash)), true);
    assert.equal(await exists(join(chunksDir, staleHash)), false);
    assert.equal(await readFile(join(chunksDir, "notes"), "utf8"), "unknown");
  });

  it("fails closed when the current or rollback manifest is corrupt", async () => {
    const root = await mkdtemp(join(tmpdir(), "gw-chunk-prune-invalid-"));
    const chunksDir = join(root, "chunks");
    const currentManifest = join(root, "current.json");
    const previousManifest = join(root, "previous.json");
    await mkdir(chunksDir);
    await writeFile(join(chunksDir, staleHash), "stale");
    await writeFile(currentManifest, manifest(currentHash));
    await writeFile(previousManifest, "{broken");

    await assert.rejects(() =>
      pruneUnreferencedChunks({
        chunksDir,
        currentManifest,
        previousManifest,
      }),
    );
    assert.equal(await exists(join(chunksDir, staleHash)), true);
  });
});
