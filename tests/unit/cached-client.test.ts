import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { seedCachedClient } from "../helpers/cached-client.js";

test("seeds split-platform chunks in the explicit cache root", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "gwonmac-cached-client-"));
  const artifacts = path.join(root, "cache", "game", "artifacts");
  const chunks = path.join(root, "cache", "game", "chunks");
  const userData = path.join(root, "sessions");

  try {
    await seedCachedClient({ artifacts, chunks, userData });
    const manifest = JSON.parse(
      await readFile(path.join(artifacts, "manifest.json"), "utf8"),
    ) as { chunkHashes: string[]; clientFingerprint: string };

    assert.match(manifest.clientFingerprint, /^[a-f0-9]{64}$/u);
    assert.deepEqual(
      await readFile(path.join(chunks, manifest.chunkHashes[0]!)),
      Buffer.of(0),
    );
    await assert.rejects(
      () => readFile(path.join(userData, "game", "chunks", manifest.chunkHashes[0]!)),
      { code: "ENOENT" },
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
