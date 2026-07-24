import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  clientFingerprint,
  confirmClientCandidate,
  markClientCandidate,
  readRejectedClient,
  restoreUnconfirmedClient,
} from "../../src/main/core/client-compatibility.js";
import { Manifest, type RawManifest } from "../../src/main/core/manifest.js";

function rawManifest(overrides?: Partial<RawManifest>): RawManifest {
  return {
    compressionMode: "none",
    chunkSize: 16,
    files: [
      { name: "Gw.jspi.js", size: 1, chunkHashes: ["a".repeat(32)] },
      { name: "Gw.jspi.wasm", size: 1, chunkHashes: ["b".repeat(32)] },
      { name: "version.json", size: 1, chunkHashes: ["c".repeat(32)] },
      { name: "Gw.snapshot", size: 1, chunkHashes: ["d".repeat(32)] },
    ],
    ...overrides,
  };
}

async function missing(target: string): Promise<boolean> {
  return stat(target).then(
    () => false,
    () => true,
  );
}

describe("client compatibility", () => {
  it("fingerprints only the complete executable client contract", () => {
    const first = clientFingerprint(new Manifest(rawManifest()));
    const reordered = clientFingerprint(
      new Manifest({
        ...rawManifest(),
        files: [...rawManifest().files!].reverse(),
      }),
    );
    const changed = clientFingerprint(
      new Manifest({
        ...rawManifest(),
        files: rawManifest().files!.map((entry) =>
          entry.name === "Gw.jspi.wasm"
            ? { ...entry, chunkHashes: ["e".repeat(32)] }
            : entry,
        ),
      }),
    );

    assert.match(first, /^[a-f0-9]{64}$/);
    assert.equal(reordered, first);
    assert.notEqual(changed, first);
  });

  it("restores an unconfirmed client once and records its fingerprint", async () => {
    const root = await mkdtemp(join(tmpdir(), "gw-client-rollback-"));
    const artifacts = join(root, "artifacts");
    const previousArtifacts = join(root, "artifacts.previous");
    const rejectedPath = join(root, "rejected-client.json");
    const fingerprint = clientFingerprint(new Manifest(rawManifest()));
    await mkdir(artifacts);
    await mkdir(previousArtifacts);
    await writeFile(join(artifacts, "client"), "candidate");
    await writeFile(join(previousArtifacts, "client"), "working");
    await markClientCandidate(artifacts, fingerprint);

    assert.deepEqual(
      await restoreUnconfirmedClient({
        artifacts,
        previousArtifacts,
        rejectedPath,
        hostVersion: "1.0.0",
      }),
      { fingerprint },
    );
    assert.equal(await readFile(join(artifacts, "client"), "utf8"), "working");
    assert.equal(await readRejectedClient(rejectedPath, "1.0.0"), fingerprint);
    assert.equal(await readRejectedClient(rejectedPath, "1.0.1"), null);
    assert.equal(await missing(previousArtifacts), true);
    assert.equal(
      await restoreUnconfirmedClient({
        artifacts,
        previousArtifacts,
        rejectedPath,
        hostVersion: "1.0.0",
      }),
      null,
    );
  });

  it("promotes a rendered candidate and removes rollback state", async () => {
    const root = await mkdtemp(join(tmpdir(), "gw-client-promote-"));
    const artifacts = join(root, "artifacts");
    const previousArtifacts = join(root, "artifacts.previous");
    const rejectedPath = join(root, "rejected-client.json");
    const fingerprint = clientFingerprint(new Manifest(rawManifest()));
    await mkdir(artifacts);
    await mkdir(previousArtifacts);
    await markClientCandidate(artifacts, fingerprint);
    await writeFile(
      rejectedPath,
      JSON.stringify({
        formatVersion: 1,
        fingerprint: "a".repeat(64),
        hostVersion: "1.0.0",
      }),
    );

    assert.equal(
      await confirmClientCandidate({
        artifacts,
        previousArtifacts,
        rejectedPath,
      }),
      fingerprint,
    );
    assert.equal(await missing(join(artifacts, ".candidate.json")), true);
    assert.equal(await missing(previousArtifacts), true);
    assert.equal(await missing(rejectedPath), true);
  });

  it("does not interpret unknown persisted record versions", async () => {
    const root = await mkdtemp(join(tmpdir(), "gw-client-schema-"));
    const rejectedPath = join(root, "rejected-client.json");
    await writeFile(
      rejectedPath,
      JSON.stringify({
        formatVersion: 2,
        fingerprint: "a".repeat(64),
        hostVersion: "1.0.0",
      }),
    );
    assert.equal(await readRejectedClient(rejectedPath, "1.0.0"), null);
  });

  it("prefers the previous complete client when the marker is corrupt", async () => {
    const root = await mkdtemp(join(tmpdir(), "gw-client-torn-marker-"));
    const artifacts = join(root, "artifacts");
    const previousArtifacts = join(root, "artifacts.previous");
    const rejectedPath = join(root, "rejected-client.json");
    await mkdir(artifacts);
    await mkdir(previousArtifacts);
    await writeFile(join(artifacts, "client"), "uncertain");
    await writeFile(join(artifacts, ".candidate.json"), "{torn");
    await writeFile(join(previousArtifacts, "client"), "working");

    assert.deepEqual(
      await restoreUnconfirmedClient({
        artifacts,
        previousArtifacts,
        rejectedPath,
        hostVersion: "1.0.0",
      }),
      { fingerprint: null },
    );
    assert.equal(await readFile(join(artifacts, "client"), "utf8"), "working");
    assert.equal(await missing(previousArtifacts), true);
    assert.equal(await missing(rejectedPath), true);
  });
});
