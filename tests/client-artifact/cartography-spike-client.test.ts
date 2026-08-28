/** The sealed development artifact is reproducible and cache-safe. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { prepareCartographySpike } from
  "../../src/main/certification/cartography-spike-client.js";

const sha256 = (bytes: Uint8Array): string =>
  createHash("sha256").update(bytes).digest("hex");

test("prepares and reuses the certified cartography client", async () => {
  const artifact = process.env.GW_CLIENT_WASM;
  assert.ok(artifact, "GW_CLIENT_WASM must name the retained official artifact");
  const official = new Uint8Array(await readFile(artifact));
  const inputSha256 = sha256(official);
  const cacheRoot = await mkdtemp(join(tmpdir(), "gwonmac-cartography-spike-"));
  try {
    const first = await prepareCartographySpike(artifact, inputSha256, cacheRoot);
    assert.equal(first.error, null);
    assert.notEqual(first.wasmPath, artifact);
    assert.equal(sha256(new Uint8Array(await readFile(first.wasmPath))), first.wasmSha256);

    const second = await prepareCartographySpike(artifact, inputSha256, cacheRoot);
    assert.deepEqual(second, first);
  } finally {
    await rm(cacheRoot, { recursive: true, force: true });
  }
});
