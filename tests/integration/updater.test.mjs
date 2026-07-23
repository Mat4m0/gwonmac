import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import { PatchClient } from "../../build/main/core/patch-client.js";
import { isProxyRoute, resolveProxyHost } from "../../build/main/core/proxy-routes.js";
import { parseRangeHeader } from "../../build/main/core/ranges.js";

function md5(data) {
  return createHash("md5").update(data).digest("hex");
}

describe("integration: patch updater", () => {
  const cleanup = [];
  after(async () => {
    for (const d of cleanup) await rm(d, { recursive: true, force: true });
  });

  it("publishes JSPI artifacts from a local fixture and skips unchanged", async () => {
    const root = await mkdtemp(join(tmpdir(), "gw-patch-"));
    cleanup.push(root);
    const artifacts = join(root, "artifacts");
    const chunks = join(root, "chunks");

    const js = Buffer.from("/* jspi glue */");
    const wasm = Buffer.from("wasm-bytes-here!!");
    const ver = Buffer.from('{"build":1}');
    const files = {
      "Gw.jspi.js": js,
      "Gw.jspi.wasm": wasm,
      "version.json": ver,
    };
    const chunkSize = 16;
    const manifestFiles = [];
    const store = new Map();

    for (const [name, body] of Object.entries(files)) {
      const hashes = [];
      for (let off = 0; off < body.length; off += chunkSize) {
        const piece = body.subarray(off, off + chunkSize);
        const h = md5(piece);
        hashes.push(h);
        store.set(h, Buffer.from(piece));
      }
      manifestFiles.push({ name, size: body.length, chunkHashes: hashes });
    }
    const snap = Buffer.alloc(8, 5);
    const snapHash = md5(snap);
    store.set(snapHash, snap);
    manifestFiles.push({
      name: "Gw.snapshot",
      size: snap.length,
      chunkHashes: [snapHash],
    });

    const manifest = {
      compressionMode: "none",
      chunkSize,
      directories: [],
      files: manifestFiles,
    };

    const rootUrl = "https://fixture.invalid";
    const fetchFixture = async (url) => {
      const pathname = new URL(url).pathname;
      if (pathname === "/manifest.json") {
        return { status: 200, body: new TextEncoder().encode(JSON.stringify(manifest)) };
      }
      const match = /^\/([0-9a-f]+)\.bin$/.exec(pathname);
      const body = match ? store.get(match[1]) : undefined;
      return body
        ? { status: 200, body: new Uint8Array(body) }
        : { status: 404, body: new Uint8Array() };
    };

    const client = new PatchClient({
      artifactsDir: artifacts,
      chunksDir: chunks,
      patchRoot: rootUrl,
      fetch: fetchFixture,
    });

    await client.update();
    assert.equal((await readFile(join(artifacts, "Gw.jspi.js"))).toString(), js.toString());
    assert.equal((await stat(join(artifacts, "Gw.jspi.wasm"))).size, wasm.length);
    assert.ok(await readFile(join(artifacts, "snapshot-metadata.json"), "utf8"));

    let fetches = 0;
    const client2 = new PatchClient({
      artifactsDir: artifacts,
      chunksDir: chunks,
      patchRoot: rootUrl,
      fetch: async (url) => {
        fetches += 1;
        return fetchFixture(url);
      },
    });
    await client2.update();
    assert.equal(fetches, 1);

    // Startup restores the last complete directory if a swap was interrupted.
    await rename(artifacts, `${artifacts}.previous`);
    await mkdir(`${artifacts}.next`);
    await writeFile(join(`${artifacts}.next`, "incomplete"), "partial");
    const recovering = new PatchClient({
      artifactsDir: artifacts,
      chunksDir: chunks,
      patchRoot: rootUrl,
      fetch: fetchFixture,
    });
    await recovering.update();
    assert.equal((await readFile(join(artifacts, "Gw.jspi.js"))).toString(), js.toString());
    await assert.rejects(() => stat(`${artifacts}.previous`));
    await assert.rejects(() => stat(`${artifacts}.next`));

    // Same-size corruption must not fool the updater's unchanged fast path.
    await writeFile(join(artifacts, "Gw.jspi.js"), Buffer.alloc(js.length, 0x58));
    let repairFetches = 0;
    const repairing = new PatchClient({
      artifactsDir: artifacts,
      chunksDir: chunks,
      patchRoot: rootUrl,
      fetch: async (url) => {
        repairFetches += 1;
        return fetchFixture(url);
      },
    });
    await repairing.update();
    assert.equal((await readFile(join(artifacts, "Gw.jspi.js"))).toString(), js.toString());
    assert.equal(repairFetches, 1);

    // A matching filename is not proof that a content-addressed chunk is intact.
    const jsHash = manifestFiles.find((file) => file.name === "Gw.jspi.js").chunkHashes[0];
    await writeFile(join(artifacts, "Gw.jspi.js"), Buffer.alloc(js.length, 0x59));
    await writeFile(join(chunks, jsHash), Buffer.alloc(store.get(jsHash).length, 0x5a));
    let corruptChunkFetches = 0;
    const repairingChunk = new PatchClient({
      artifactsDir: artifacts,
      chunksDir: chunks,
      patchRoot: rootUrl,
      fetch: async (url) => {
        corruptChunkFetches += 1;
        return fetchFixture(url);
      },
    });
    await repairingChunk.update();
    assert.equal((await readFile(join(artifacts, "Gw.jspi.js"))).toString(), js.toString());
    assert.equal(corruptChunkFetches, 2);

    // No member of a new client set is published until every member is complete.
    const nextJs = Buffer.from("new-jspi-glue");
    const nextWasm = Buffer.from("new-wasm-missing");
    const nextJsHash = md5(nextJs);
    const nextWasmHash = md5(nextWasm);
    store.set(nextJsHash, nextJs);
    const jsEntry = manifestFiles.find((file) => file.name === "Gw.jspi.js");
    const wasmEntry = manifestFiles.find((file) => file.name === "Gw.jspi.wasm");
    jsEntry.size = nextJs.length;
    jsEntry.chunkHashes = [nextJsHash];
    wasmEntry.size = nextWasm.length;
    wasmEntry.chunkHashes = [nextWasmHash];
    const beforeWasm = await readFile(join(artifacts, "Gw.jspi.wasm"));
    const interrupted = new PatchClient({
      artifactsDir: artifacts,
      chunksDir: chunks,
      patchRoot: rootUrl,
      fetch: fetchFixture,
    });
    await assert.rejects(
      () => interrupted.update(),
      (error) => error?.status === 404,
    );
    assert.equal((await readFile(join(artifacts, "Gw.jspi.js"))).toString(), js.toString());
    assert.deepEqual(await readFile(join(artifacts, "Gw.jspi.wasm")), beforeWasm);
    await assert.rejects(() => stat(`${artifacts}.next`));
  });

  it("keeps the previous client when an update fails", async () => {
    const root = await mkdtemp(join(tmpdir(), "gw-preserve-"));
    cleanup.push(root);
    const artifacts = join(root, "artifacts");
    const chunks = join(root, "chunks");
    await mkdir(artifacts, { recursive: true });
    await mkdir(chunks, { recursive: true });
    await writeFile(join(artifacts, "Gw.jspi.js"), "OLD");

    // 404 is fatal and not retried, so this stays fast offline.
    const client = new PatchClient({
      artifactsDir: artifacts,
      chunksDir: chunks,
      patchRoot: "http://127.0.0.1:9",
      fetch: async () => ({ status: 404, body: new Uint8Array() }),
    });
    await assert.rejects(() => client.update());
    assert.equal(await readFile(join(artifacts, "Gw.jspi.js"), "utf8"), "OLD");
  });
});

describe("integration: proxy and ranges", () => {
  it("resolves only explicit proxy routes", () => {
    assert.equal(resolveProxyHost("webgate"), "webgate.ncplatform.net");
    assert.equal(isProxyRoute("account"), true);
    assert.throws(() => resolveProxyHost("evil"), /unknown/);
  });

  it("parses byte ranges for virtual snapshot reads", () => {
    assert.equal(parseRangeHeader(null, 1000), null);
    const r = parseRangeHeader("bytes=0-99", 1000);
    assert.ok(r && typeof r === "object");
    assert.equal(r.start, 0);
    assert.equal(r.end, 99);
  });
});
