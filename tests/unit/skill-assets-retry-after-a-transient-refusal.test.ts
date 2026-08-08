import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import type { ChunkStore } from "../../src/main/core/chunk-store.js";
import { SkillAssets } from "../../src/main/core/skill-catalogue.js";

test("catalogue and icon refusals are retryable without restarting", async (context) => {
  const root = await mkdtemp(path.join(tmpdir(), "gwonmac-skill-retry-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const hashes = ["archive-generation"];
  const store = {
    hashes,
    readRange: async () => { throw new Error("not resident yet"); },
  } as unknown as ChunkStore;
  const assets = new SkillAssets({
    store,
    wasmPath: path.join(root, "client-not-resident.wasm"),
    decoderPath: path.join(root, "decoder"),
    cacheRoot: root,
  });

  assert.deepEqual(await assets.catalogue(), { ok: false, reason: "client-unreadable" });

  const cache = path.join(
    root,
    createHash("sha256").update(hashes.join("")).digest("hex").slice(0, 32),
  );
  await mkdir(cache, { recursive: true });
  await writeFile(path.join(cache, "catalogue.json"), JSON.stringify({
    version: 3,
    skills: [{ id: 42, name: "Recovered skill" }],
    icons: {},
  }));
  const recovered = await assets.catalogue();
  assert.equal(recovered.ok, true);
  assert.equal(recovered.ok ? recovered.skills[0]?.name : null, "Recovered skill");

  assert.equal(await assets.icon(42), null);
  await mkdir(path.join(cache, "icons"), { recursive: true });
  await writeFile(path.join(cache, "icons", "42.bmp"), Buffer.from("recovered-icon"));
  assert.equal((await assets.icon(42))?.toString(), "recovered-icon");
});
