import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { inspectToolboxWorkspace } from "../../src/tools/toolbox-doctor.js";

describe("Toolbox workspace doctor", () => {
  it("fails closed for a missing profile", async () => {
    const profile = await mkdtemp(path.join(tmpdir(), "gw-doctor-missing-"));
    const report = await inspectToolboxWorkspace(profile);
    assert.equal(report.profile, "missing");
    assert.equal(report.artifacts.ready, false);
    assert.equal(report.artifacts.integrity, "invalid");
    assert.equal(report.readyForCachedLive, false);
  });

  it("reports snapshot residency without reading chunk contents", async () => {
    const profile = await mkdtemp(path.join(tmpdir(), "gw-doctor-resident-"));
    const game = path.join(profile, "game");
    const artifacts = path.join(game, "artifacts");
    const chunks = path.join(game, "chunks");
    await mkdir(artifacts, { recursive: true });
    await mkdir(chunks, { recursive: true });
    await writeFile(path.join(profile, "credentials.bin"), "encrypted");
    const artifactData = {
      "Gw.jspi.js": "glue",
      "Gw.jspi.wasm": "unsupported",
      "version.json": "{}",
    };
    for (const [name, contents] of Object.entries(artifactData)) {
      await writeFile(path.join(artifacts, name), contents);
    }
    const firstHash = "a".repeat(32);
    const secondHash = "b".repeat(32);
    await writeFile(
      path.join(artifacts, "manifest.json"),
      JSON.stringify({
        compressionMode: "none",
        snapshot: "Gw.snapshot",
        size: 6,
        chunkSize: 4,
        chunkHashes: [firstHash, secondHash],
        clientFingerprint: "c".repeat(64),
        artifacts: Object.entries(artifactData).map(([name, contents]) => ({
          name,
          size: Buffer.byteLength(contents),
          chunkHashes: Array.from(
            { length: Math.ceil(Buffer.byteLength(contents) / 4) },
            (_, index) =>
              createHash("md5")
                .update(Buffer.from(contents).subarray(index * 4, index * 4 + 4))
                .digest("hex"),
          ),
        })),
      }),
    );
    await writeFile(path.join(chunks, firstHash), "data");

    const report = await inspectToolboxWorkspace(profile);
    assert.equal(report.profile, "ready");
    assert.equal(report.credentials, "saved");
    assert.equal(report.artifacts.ready, true);
    assert.equal(report.artifacts.integrity, "verified");
    assert.deepEqual(report.snapshot, {
      totalBytes: 6,
      residentBytes: 4,
      totalChunks: 2,
      residentChunks: 1,
      complete: false,
      evidence: "presence-only",
    });
    assert.equal(report.client.supported, false);
    assert.equal(report.readyForCachedLive, false);
  });
});
