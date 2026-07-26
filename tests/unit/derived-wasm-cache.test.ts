import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import {
  type DerivedWasmCache,
  inspectDerivedWasmCache,
  prepareDerivedWasm,
} from "../../src/main/core/derived-wasm.js";
import { prepareTemplateSaveClient } from "../../src/main/core/template-save-client.js";
import { prepareToolboxClient } from "../../src/main/core/toolbox-client.js";

const scratchDirs: string[] = [];

after(async () => {
  for (const dir of scratchDirs) await rm(dir, { recursive: true, force: true });
});

async function scratch(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "gw-derived-"));
  scratchDirs.push(dir);
  return dir;
}

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/** A base module on disk, plus the hash the caller is expected to key it by. */
async function baseModule(
  root: string,
  name: string,
  body: string,
): Promise<{ path: string; sha256: string }> {
  const bytes = Buffer.from(body);
  const filePath = join(root, name);
  await writeFile(filePath, bytes);
  return { path: filePath, sha256: sha256(bytes) };
}

/** The transform stands in for a WASM rewrite and counts its own runs. */
function countingTransform(suffix: string): {
  run: (base: Uint8Array) => Uint8Array;
  runs: number;
} {
  const state = {
    runs: 0,
    run: (base: Uint8Array): Uint8Array => {
      state.runs += 1;
      return Buffer.concat([Buffer.from(base), Buffer.from(suffix)]);
    },
  };
  return state;
}

function cacheFor(
  inputSha256: string,
  cacheRoot: string,
  overrides: Partial<DerivedWasmCache> = {},
): DerivedWasmCache {
  return {
    inputSha256,
    cacheRoot,
    transformAbi: 1,
    buildFingerprint: "fingerprint-1",
    expectedOutputSha256: null,
    ...overrides,
  };
}

describe("derived wasm cache", () => {
  it("publishes once and reuses the published module", async () => {
    const root = await scratch();
    const base = await baseModule(root, "official.wasm", "official-bytes");
    const cacheRoot = join(root, "cache");
    const transform = countingTransform("-derived");

    const cache = cacheFor(base.sha256, cacheRoot);
    const first = await prepareDerivedWasm(base.path, cache, transform.run);
    const second = await prepareDerivedWasm(base.path, cache, transform.run);

    assert.equal(second, first);
    assert.equal(transform.runs, 1, "the second launch re-ran the transform");
    assert.equal(
      await readFile(first, "utf8"),
      "official-bytes-derived",
    );
    assert.equal(await inspectDerivedWasmCache(cache), "valid");
  });

  it("keeps only the current input, so an update cannot leak a directory", async () => {
    const root = await scratch();
    const cacheRoot = join(root, "cache");
    const transform = countingTransform("-derived");
    const old = await baseModule(root, "old.wasm", "old-client");
    const fresh = await baseModule(root, "new.wasm", "new-client");

    await prepareDerivedWasm(
      old.path,
      cacheFor(old.sha256, cacheRoot),
      transform.run,
    );
    assert.deepEqual(await readdir(cacheRoot), [old.sha256]);

    await prepareDerivedWasm(
      fresh.path,
      cacheFor(fresh.sha256, cacheRoot),
      transform.run,
    );

    assert.deepEqual(
      await readdir(cacheRoot),
      [fresh.sha256],
      "the superseded client's derived module was left behind",
    );
  });

  it("keeps only the current transform ABI", async () => {
    const root = await scratch();
    const cacheRoot = join(root, "cache");
    const base = await baseModule(root, "official.wasm", "official-bytes");
    const transform = countingTransform("-derived");

    await prepareDerivedWasm(
      base.path,
      cacheFor(base.sha256, cacheRoot, { transformAbi: 1 }),
      transform.run,
    );
    await prepareDerivedWasm(
      base.path,
      cacheFor(base.sha256, cacheRoot, { transformAbi: 2 }),
      transform.run,
    );

    assert.deepEqual(await readdir(join(cacheRoot, base.sha256)), ["2"]);
    assert.equal(transform.runs, 2);
  });

  it("rebuilds when the certified build entry changes", async () => {
    const root = await scratch();
    const cacheRoot = join(root, "cache");
    const base = await baseModule(root, "official.wasm", "official-bytes");
    const first = countingTransform("-v1");
    const second = countingTransform("-v2");

    await prepareDerivedWasm(
      base.path,
      cacheFor(base.sha256, cacheRoot, { buildFingerprint: "fingerprint-1" }),
      first.run,
    );
    const rebuilt = await prepareDerivedWasm(
      base.path,
      cacheFor(base.sha256, cacheRoot, { buildFingerprint: "fingerprint-2" }),
      second.run,
    );

    assert.equal(await readFile(rebuilt, "utf8"), "official-bytes-v2");
    assert.equal(second.runs, 1);
  });

  it("rejects a cached module whose bytes were altered after publication", async () => {
    const root = await scratch();
    const cacheRoot = join(root, "cache");
    const base = await baseModule(root, "official.wasm", "official-bytes");
    const transform = countingTransform("-derived");
    const cache = cacheFor(base.sha256, cacheRoot);

    const wasmPath = await prepareDerivedWasm(base.path, cache, transform.run);
    await writeFile(wasmPath, "tampered");
    assert.equal(await inspectDerivedWasmCache(cache), "missing-or-invalid");

    await prepareDerivedWasm(base.path, cache, transform.run);

    assert.equal(transform.runs, 2, "the altered module was served from cache");
    assert.equal(await readFile(wasmPath, "utf8"), "official-bytes-derived");
  });

  it("will not let cache metadata certify a module the pinned hash rejects", async () => {
    const root = await scratch();
    const cacheRoot = join(root, "cache");
    const base = await baseModule(root, "official.wasm", "official-bytes");
    const transform = countingTransform("-derived");
    const pinned = sha256(Buffer.from("official-bytes-derived"));
    const cache = cacheFor(base.sha256, cacheRoot, {
      expectedOutputSha256: pinned,
    });

    // A cache an attacker could write in full: the module and the metadata
    // agree with each other and with the input, and only the hash compiled
    // into the binary disagrees.
    const cacheDir = join(cacheRoot, base.sha256, "1");
    await mkdir(cacheDir, { recursive: true });
    const planted = Buffer.from("official-bytes-hostile");
    await writeFile(join(cacheDir, "Gw.jspi.wasm"), planted);
    await writeFile(
      join(cacheDir, "metadata.json"),
      JSON.stringify({
        inputSha256: base.sha256,
        transformAbi: 1,
        buildFingerprint: "fingerprint-1",
        outputSha256: sha256(planted),
      }),
    );

    assert.equal(await inspectDerivedWasmCache(cache), "missing-or-invalid");
    const wasmPath = await prepareDerivedWasm(base.path, cache, transform.run);

    assert.equal(await readFile(wasmPath, "utf8"), "official-bytes-derived");
    assert.equal(transform.runs, 1);
  });

  it("publishes nothing when the output misses the pinned hash", async () => {
    const root = await scratch();
    const cacheRoot = join(root, "cache");
    const base = await baseModule(root, "official.wasm", "official-bytes");
    const cache = cacheFor(base.sha256, cacheRoot, {
      expectedOutputSha256: sha256(Buffer.from("something-else")),
    });

    await assert.rejects(
      prepareDerivedWasm(base.path, cache, countingTransform("-derived").run),
      /unexpected output/,
    );
    await assert.rejects(readdir(cacheRoot), { code: "ENOENT" });
  });

  it("keeps the last good module when a rebuild's transform throws", async () => {
    const root = await scratch();
    const cacheRoot = join(root, "cache");
    const old = await baseModule(root, "old.wasm", "old-client");
    const fresh = await baseModule(root, "new.wasm", "new-client");
    const good = countingTransform("-derived");

    const published = await prepareDerivedWasm(
      old.path,
      cacheFor(old.sha256, cacheRoot),
      good.run,
    );

    await assert.rejects(
      prepareDerivedWasm(fresh.path, cacheFor(fresh.sha256, cacheRoot), () => {
        throw new Error("unsupported build");
      }),
      /unsupported build/,
    );

    assert.equal(
      await readFile(published, "utf8"),
      "old-client-derived",
      "a failed transform destroyed the module the last good build published",
    );
    assert.equal(
      await inspectDerivedWasmCache(cacheFor(old.sha256, cacheRoot)),
      "valid",
    );
  });
});

describe("derived wasm clients on an uncertified build", () => {
  it("prepareToolboxClient returns the base module and drops its cache", async () => {
    const root = await scratch();
    const base = await baseModule(root, "base.wasm", "not-a-certified-client");
    const cacheRoot = join(root, "toolbox");
    await mkdir(join(cacheRoot, "stale-input", "3"), { recursive: true });
    await writeFile(join(cacheRoot, "stale-input", "3", "Gw.jspi.wasm"), "old");

    const prepared = await prepareToolboxClient(base.path, cacheRoot);

    assert.deepEqual(prepared, { wasmPath: base.path, build: null });
    await assert.rejects(readdir(cacheRoot), { code: "ENOENT" });
  });

  it("prepareTemplateSaveClient returns the official module and drops its cache", async () => {
    const root = await scratch();
    const base = await baseModule(root, "official.wasm", "not-a-certified-client");
    const cacheRoot = join(root, "compatibility");
    await mkdir(join(cacheRoot, "stale-input", "2"), { recursive: true });
    await writeFile(join(cacheRoot, "stale-input", "2", "Gw.jspi.wasm"), "old");

    const prepared = await prepareTemplateSaveClient(
      base.path,
      base.sha256,
      cacheRoot,
    );

    assert.equal(prepared, base.path);
    await assert.rejects(readdir(cacheRoot), { code: "ENOENT" });
  });
});
