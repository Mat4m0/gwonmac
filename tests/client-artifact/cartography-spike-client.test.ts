/** The native Cartography artifact is reproducible and cache-safe. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { prepareCartographySpike } from
  "../../src/main/certification/cartography-spike-client.js";
import { verifyLocalClientBytes } from
  "../../src/main/certification/local-client-verifier.js";
import { rewriteTemplateSaveWasm } from
  "../../src/main/certification/template-save-compat.js";

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

test("prepares the sealed template-only fallback chain", async () => {
  const artifact = process.env.GW_CLIENT_WASM;
  assert.ok(artifact, "GW_CLIENT_WASM must name the retained official artifact");
  const official = new Uint8Array(await readFile(artifact));
  const templateBuild = verifyLocalClientBytes(official).templateSaveBuild;
  assert.ok(templateBuild, "the retained client must prove template compatibility");
  const template = rewriteTemplateSaveWasm(official, templateBuild);
  const root = await mkdtemp(join(tmpdir(), "gwonmac-cartography-template-"));
  const templatePath = join(root, "template.wasm");
  try {
    await writeFile(templatePath, template);
    const prepared = await prepareCartographySpike(
      templatePath,
      sha256(template),
      join(root, "cache"),
    );
    assert.equal(prepared.error, null);
    assert.equal(sha256(await readFile(prepared.wasmPath)), prepared.wasmSha256);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
