import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { compileTpf, TexturePackManager } from "../../src/main/core/texture-pack-manager.js";
import { decodeDds } from "../../src/main/core/dds.js";
import { readTpf, TpfError } from "../../src/main/core/tpf.js";
import { tinyTpf, tinyTpfMappings } from "../helpers/tpf-fixture.js";

test("reads and compiles a bounded legacy TPF", () => {
  const mappings = readTpf(tinyTpf());
  assert.equal(mappings.length, 1);
  assert.equal(mappings[0]?.target, 0x12345678);
  const compiled = compileTpf(tinyTpf());
  assert.equal(compiled.manifest.sourceSha256.length, 64);
  assert.deepEqual(compiled.manifest.entries, [{
    target: 0x12345678,
    width: 1,
    height: 1,
    offset: 0,
    length: 4,
  }]);
  assert.deepEqual([...compiled.textures], [1, 2, 3, 255]);
});

test("refuses a renamed non-TPF before parsing archive content", () => {
  assert.throws(() => readTpf(new Uint8Array(22)), (error) =>
    error instanceof TpfError && error.code === "not_tpf");
});

test("decodes one referenced archive image only once", () => {
  const mappings = readTpf(tinyTpfMappings([0x11111111, 0x22222222]));
  assert.equal(mappings.length, 2);
  assert.strictEqual(mappings[0]?.bytes, mappings[1]?.bytes);
});

test("bounds a compressed DDS mip count before walking the chain", () => {
  const dds = new Uint8Array(136);
  const view = new DataView(dds.buffer);
  view.setUint32(0, 0x20534444, true);
  view.setUint32(4, 124, true);
  view.setUint32(12, 4, true);
  view.setUint32(16, 4, true);
  view.setUint32(28, 0xffff_ffff, true);
  view.setUint32(76, 32, true);
  view.setUint32(80, 4, true);
  dds.set(new TextEncoder().encode("DXT1"), 84);
  assert.throws(() => decodeDds(dds), /mip count/u);
});

test("imports, deduplicates, selects, reloads, and removes a managed pack", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "gwonmac-tpf-test-"));
  const source = path.join(root, "Warm UI.tpf");
  await writeFile(source, tinyTpf());
  const paths = {
    root: path.join(root, "texture-packs"),
    selection: path.join(root, "texture-packs", "selection.json"),
    packs: path.join(root, "texture-packs", "packs"),
    staging: path.join(root, "texture-packs", "staging"),
  };
  let changes = 0;
  const manager = new TexturePackManager(paths, () => { changes += 1; });
  await manager.initialise();
  const imported = await manager.importFile(source);
  assert.equal(imported.status, "imported");
  if (imported.status !== "imported") return;
  assert.equal((await manager.importFile(source)).status, "duplicate");
  await manager.select(imported.packId);
  assert.equal(await manager.acquireCurrentGeneration(), imported.packId);
  assert.equal(JSON.parse(Buffer.from((await manager.runtimeAsset(imported.packId, "manifest.json"))!).toString("utf8")).entries.length, 1);
  assert.deepEqual([...await readFile(path.join(paths.packs, imported.packId, "source.tpf"))], [...tinyTpf()]);
  await manager.remove(imported.packId);
  assert.deepEqual(manager.snapshot(), { selectedPackId: null, packs: [] });
  assert.ok(changes >= 3);
  assert.ok(await manager.runtimeAsset(imported.packId, "textures.rgba"), "open-window lease survives removal");
  await manager.releaseGeneration(imported.packId);
  assert.equal(await manager.runtimeAsset(imported.packId, "textures.rgba"), null);
});

test("discovers an atomically published pack directory and rebuilds its derived runtime", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "gwonmac-tpf-recovery-"));
  const source = path.join(root, "Recovered.tpf");
  await writeFile(source, tinyTpf());
  const paths = {
    root: path.join(root, "texture-packs"),
    selection: path.join(root, "texture-packs", "selection.json"),
    packs: path.join(root, "texture-packs", "packs"),
    staging: path.join(root, "texture-packs", "staging"),
  };
  const first = new TexturePackManager(paths, () => undefined);
  await first.initialise();
  const imported = await first.importFile(source);
  assert.equal(imported.status, "imported");
  if (imported.status !== "imported") return;

  const recovered = new TexturePackManager(paths, () => undefined);
  await recovered.initialise();

  assert.equal(recovered.snapshot().packs[0]?.id, imported.packId);
  assert.equal(recovered.snapshot().packs[0]?.name, "Recovered");
  await writeFile(
    path.join(paths.packs, imported.packId, "compiled", "1", "manifest.json"),
    `${JSON.stringify({ formatVersion: 1, sourceSha256: "0".repeat(64), bytes: 4, entries: [] })}\n`,
  );
  await recovered.select(imported.packId);
  assert.equal(await recovered.acquireCurrentGeneration(), imported.packId);
  assert.deepEqual(
    [...await readFile(path.join(paths.packs, imported.packId, "compiled", "1", "textures.rgba"))],
    [1, 2, 3, 255],
  );
});
