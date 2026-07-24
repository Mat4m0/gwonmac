import assert from "node:assert/strict";
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
    await writeFile(path.join(artifacts, "Gw.jspi.js"), "glue");
    await writeFile(path.join(artifacts, "Gw.jspi.wasm"), "unsupported");
    await writeFile(path.join(artifacts, "version.json"), "{}");
    await writeFile(
      path.join(artifacts, "manifest.json"),
      JSON.stringify({
        size: 6,
        chunkSize: 4,
        chunkHashes: ["first", "second"],
      }),
    );
    await writeFile(path.join(chunks, "first"), "data");

    const report = await inspectToolboxWorkspace(profile);
    assert.equal(report.profile, "ready");
    assert.equal(report.credentials, "saved");
    assert.equal(report.artifacts.ready, true);
    assert.deepEqual(report.snapshot, {
      totalBytes: 6,
      residentBytes: 4,
      totalChunks: 2,
      residentChunks: 1,
      complete: false,
    });
    assert.equal(report.client.supported, false);
    assert.equal(report.readyForCachedLive, false);
  });
});
