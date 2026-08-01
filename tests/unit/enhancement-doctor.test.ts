import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { fingerprintClientGeneration } from "../../src/main/core/client-fingerprint.js";
import { inspectEnhancementWorkspace } from "../../src/tools/enhancement-doctor.js";

describe("Enhancement workspace doctor", () => {
  it("fails closed for a missing profile", async () => {
    const profile = await mkdtemp(path.join(tmpdir(), "gw-doctor-missing-"));
    const report = await inspectEnhancementWorkspace(profile);
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
    const artifactEntries = Object.entries(artifactData).map(
      ([name, contents]) => ({
        name,
        size: Buffer.byteLength(contents),
        chunkHashes: Array.from(
          { length: Math.ceil(Buffer.byteLength(contents) / 4) },
          (_, index) =>
            createHash("md5")
              .update(Buffer.from(contents).subarray(index * 4, index * 4 + 4))
              .digest("hex"),
        ),
      }),
    );
    await writeFile(
      path.join(artifacts, "manifest.json"),
      JSON.stringify({
        compressionMode: "none",
        snapshot: "Gw.snapshot",
        size: 6,
        chunkSize: 4,
        chunkHashes: [firstHash, secondHash],
        clientFingerprint: fingerprintClientGeneration({
          compression: "none",
          chunkSize: 4,
          files: [
            ...artifactEntries,
            {
              name: "Gw.snapshot",
              size: 6,
              chunkHashes: [firstHash, secondHash],
            },
          ],
        }),
        artifacts: artifactEntries,
      }),
    );
    await writeFile(path.join(chunks, firstHash), "data");

    const report = await inspectEnhancementWorkspace(profile);
    assert.equal(report.profile, "ready");
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

  it("reports the profile's own Enhancement settings without writing to them", async () => {
    // P4.7 — an observation-tier live run enables nothing, so this setting is
    // the only thing that installs the Enhancement for it.
    const profile = await mkdtemp(path.join(tmpdir(), "gw-doctor-cursor-"));
    const settings = path.join(profile, "settings.json");

    const initial = await inspectEnhancementWorkspace(profile);
    assert.equal(initial.nativeCursor, true);

    // The retired targetReadout field in a legacy profile is ignored, not an
    // error, and the values beside it are still read.
    await writeFile(
      settings,
      JSON.stringify({ nativeCursor: false, targetReadout: true }),
    );
    const selected = await inspectEnhancementWorkspace(profile);
    assert.equal(selected.nativeCursor, false);

    // loadSettings() renames a corrupt file aside and writes a backup. A doctor
    // reads the profile it is asked about and leaves it exactly as it found it.
    await writeFile(settings, "{ not json");
    const defaults = await inspectEnhancementWorkspace(profile);
    assert.equal(defaults.nativeCursor, true);
    assert.equal(await readFile(settings, "utf8"), "{ not json");
    assert.deepEqual(await readdir(profile), ["settings.json"]);
  });
});
