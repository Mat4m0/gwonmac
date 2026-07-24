import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  parsePublishedClientManifest,
  verifyPublishedClientArtifacts,
} from "../../src/main/core/published-client.ts";
import { AppError } from "../../src/shared/errors.ts";

describe("published client manifest", () => {
  const valid = {
    clientFingerprint: "a".repeat(64),
    compressionMode: "gzip",
    chunkSize: 4,
    snapshot: "Gw.snapshot",
    size: 5,
    chunkHashes: ["a".repeat(32), "b".repeat(32)],
  };
  const artifactBytes = {
    "Gw.jspi.js": Buffer.from("js"),
    "Gw.jspi.wasm": Buffer.from("wasm"),
    "version.json": Buffer.from("{}"),
  };
  const artifacts = Object.entries(artifactBytes).map(([name, bytes]) => ({
    name,
    size: bytes.length,
    chunkHashes: [createHash("md5").update(bytes).digest("hex")],
  }));

  it("returns a canonical detached manifest", () => {
    const parsed = parsePublishedClientManifest(valid);
    assert.deepEqual(parsed, valid);
    assert.notEqual(parsed.chunkHashes, valid.chunkHashes);
  });

  it("verifies every persisted executable artifact", async () => {
    const root = await mkdtemp(join(tmpdir(), "gw-published-client-"));
    await mkdir(root, { recursive: true });
    for (const [name, bytes] of Object.entries(artifactBytes)) {
      await writeFile(join(root, name), bytes);
    }
    const parsed = parsePublishedClientManifest({
      ...valid,
      chunkSize: 16,
      size: 5,
      chunkHashes: ["a".repeat(32)],
      artifacts,
    });
    assert.equal(await verifyPublishedClientArtifacts(root, parsed), true);
    await writeFile(
      join(root, "Gw.jspi.wasm"),
      Buffer.alloc(artifactBytes["Gw.jspi.wasm"].length, 0),
    );
    assert.equal(await verifyPublishedClientArtifacts(root, parsed), false);
    assert.equal(
      await verifyPublishedClientArtifacts(
        root,
        parsePublishedClientManifest({
          ...valid,
          chunkSize: 16,
          size: 5,
          chunkHashes: ["a".repeat(32)],
        }),
      ),
      null,
    );
  });

  it("rejects invalid snapshot identity, dimensions, and chunk count", () => {
    assert.throws(
      () => parsePublishedClientManifest({ ...valid, snapshot: "Other.bin" }),
      AppError,
    );
    assert.throws(
      () => parsePublishedClientManifest({ ...valid, chunkSize: 0 }),
      AppError,
    );
    assert.throws(
      () => parsePublishedClientManifest({ ...valid, size: -1 }),
      AppError,
    );
    assert.throws(
      () =>
        parsePublishedClientManifest({
          ...valid,
          chunkHashes: ["a".repeat(32)],
        }),
      AppError,
    );
    assert.throws(
      () => parsePublishedClientManifest({ ...valid, clientFingerprint: "bad" }),
      AppError,
    );
    assert.throws(
      () =>
        parsePublishedClientManifest({
          ...valid,
          chunkHashes: ["../not-a-content-hash", "b".repeat(32)],
        }),
      AppError,
    );
    assert.throws(
      () =>
        parsePublishedClientManifest({
          ...valid,
          artifacts: [artifacts[0], artifacts[0], artifacts[0]],
        }),
      AppError,
    );
  });
});
