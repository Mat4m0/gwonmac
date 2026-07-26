import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  appendFile,
  mkdir,
  mkdtemp,
  readFile,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  migrateLegacyPublishedClientManifest,
  parsePublishedClientManifest,
  verifyPublishedClientArtifacts,
} from "../../src/main/core/published-client.ts";
import { clientFingerprint } from "../../src/main/core/client-compatibility.ts";
import { Manifest } from "../../src/main/core/manifest.ts";
import { AppError } from "../../src/shared/errors.ts";

describe("published client manifest", () => {
  const valid = {
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
  const strictFingerprint = (value: typeof valid & {
    artifacts: typeof artifacts;
  }): string =>
    clientFingerprint(
      new Manifest({
        compressionMode: value.compressionMode,
        chunkSize: value.chunkSize,
        files: [
          ...value.artifacts,
          {
            name: value.snapshot,
            size: value.size,
            chunkHashes: value.chunkHashes,
          },
        ],
      }),
    );

  it("returns a canonical detached manifest", () => {
    const parsed = parsePublishedClientManifest(valid);
    assert.deepEqual(parsed, { formatVersion: 1, ...valid });
    assert.notEqual(parsed.chunkHashes, valid.chunkHashes);
  });

  it("reads a manifest the alpha published with no format version", () => {
    // `valid` is that shape: the fields the alpha wrote, no marker. Every
    // value survives and the marker is supplied, so the next write carries it.
    assert.equal("formatVersion" in valid, false);
    const parsed = parsePublishedClientManifest(valid);
    assert.equal(parsed.formatVersion, 1);
    assert.equal(parsed.chunkSize, valid.chunkSize);
    assert.equal(parsed.size, valid.size);
    assert.deepEqual(parsed.chunkHashes, valid.chunkHashes);
  });

  it("refuses a manifest from a format this build cannot read", () => {
    assert.throws(
      () => parsePublishedClientManifest({ ...valid, formatVersion: 2 }),
      AppError,
    );
    assert.throws(
      () => parsePublishedClientManifest({ ...valid, formatVersion: "1" }),
      AppError,
    );
  });

  it("publishes the format marker when it seals a legacy generation", async () => {
    const root = await mkdtemp(join(tmpdir(), "gw-published-client-"));
    for (const [name, bytes] of Object.entries(artifactBytes)) {
      await writeFile(join(root, name), bytes);
    }
    await writeFile(
      join(root, "manifest.json"),
      JSON.stringify({ ...valid, chunkSize: 16, chunkHashes: ["a".repeat(32)] }),
    );
    const migrated = await migrateLegacyPublishedClientManifest(root);
    assert.equal(migrated?.formatVersion, 1);
    const onDisk = JSON.parse(
      await readFile(join(root, "manifest.json"), "utf8"),
    ) as Record<string, unknown>;
    assert.equal(onDisk.formatVersion, 1);
    // And the sealed file is readable by the same reader, not just by us.
    assert.deepEqual(parsePublishedClientManifest(onDisk), migrated);
  });

  it("verifies every persisted executable artifact", async () => {
    const root = await mkdtemp(join(tmpdir(), "gw-published-client-"));
    await mkdir(root, { recursive: true });
    for (const [name, bytes] of Object.entries(artifactBytes)) {
      await writeFile(join(root, name), bytes);
    }
    const strict = {
      ...valid,
      chunkSize: 16,
      size: 5,
      chunkHashes: ["a".repeat(32)],
      artifacts,
    };
    const parsed = parsePublishedClientManifest({
      ...strict,
      clientFingerprint: strictFingerprint(strict),
    });
    assert.equal(await verifyPublishedClientArtifacts(root, parsed), true);
    await appendFile(join(root, "Gw.jspi.js"), "trailing");
    assert.equal(await verifyPublishedClientArtifacts(root, parsed), false);
    await writeFile(join(root, "Gw.jspi.js"), artifactBytes["Gw.jspi.js"]);
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

  it("atomically seals a legacy generation before it can be replaced", async () => {
    const root = await mkdtemp(join(tmpdir(), "gw-published-legacy-"));
    for (const [name, bytes] of Object.entries(artifactBytes)) {
      await writeFile(join(root, name), bytes);
    }
    await writeFile(join(root, "manifest.json"), JSON.stringify({
      ...valid,
      chunkSize: 16,
      size: 5,
      chunkHashes: ["a".repeat(32)],
    }));

    const migrated = await migrateLegacyPublishedClientManifest(root);
    assert.ok(migrated?.artifacts);
    assert.match(migrated.clientFingerprint ?? "", /^[a-f0-9]{64}$/);
    assert.equal(await verifyPublishedClientArtifacts(root, migrated), true);
    assert.deepEqual(
      await migrateLegacyPublishedClientManifest(root),
      migrated,
    );

    const freshManifest = new Manifest({
      compressionMode: migrated.compressionMode,
      chunkSize: migrated.chunkSize,
      files: [
        ...migrated.artifacts,
        {
          name: migrated.snapshot,
          size: migrated.size,
          chunkHashes: migrated.chunkHashes,
        },
      ],
    });
    assert.equal(
      migrated.clientFingerprint,
      clientFingerprint(freshManifest),
      "legacy sealing and fresh publication must share one client identity",
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
          artifacts,
          clientFingerprint: "a".repeat(64),
        }),
      (error: unknown) =>
        error instanceof AppError &&
        error.code === "bad_manifest" &&
        error.message ===
          "published client fingerprint does not match its manifest",
    );
    assert.throws(
      () =>
        parsePublishedClientManifest({
          ...valid,
          clientFingerprint: "a".repeat(64),
        }),
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
