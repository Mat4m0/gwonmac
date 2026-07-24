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
import http from "node:http";
import { after, describe, it } from "node:test";
import { PatchClient } from "../../build/main/core/patch-client.js";
import {
  confirmClientCandidate,
  readRejectedClient,
  restoreUnconfirmedClient,
} from "../../build/main/core/client-compatibility.js";
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

    const initial = await client.update();
    assert.equal(initial.published, true);
    assert.equal(initial.candidate, false);
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

    // A changed upstream client remains a candidate until it submits a frame.
    const versionEntry = manifestFiles.find((file) => file.name === "version.json");
    const nextVersion = Buffer.from('{"build":2}');
    const nextVersionHash = md5(nextVersion);
    store.set(nextVersionHash, nextVersion);
    versionEntry.size = nextVersion.length;
    versionEntry.chunkHashes = [nextVersionHash];
    const candidate = await client2.update();
    assert.equal(candidate.candidate, true);
    assert.equal(
      (await readFile(join(artifacts, "version.json"))).toString(),
      nextVersion.toString(),
    );
    assert.ok(await stat(`${artifacts}.previous`));
    assert.ok(await stat(join(artifacts, ".candidate.json")));

    // Restart before that frame restores the working client and blocks only
    // this exact upstream fingerprint from being retried.
    const rejectedPath = join(root, "rejected-client.json");
    assert.deepEqual(
      await restoreUnconfirmedClient({
        artifacts,
        previousArtifacts: `${artifacts}.previous`,
        rejectedPath,
        hostVersion: "1.0.0",
      }),
      { fingerprint: candidate.fingerprint },
    );
    assert.equal((await readFile(join(artifacts, "version.json"))).toString(), ver.toString());
    assert.equal(
      await readRejectedClient(rejectedPath, "1.0.0"),
      candidate.fingerprint,
    );
    let blockedFetches = 0;
    const blocked = await new PatchClient({
      artifactsDir: artifacts,
      chunksDir: chunks,
      patchRoot: rootUrl,
      fetch: async (url) => {
        blockedFetches += 1;
        return fetchFixture(url);
      },
    }).update({ blockedFingerprint: candidate.fingerprint });
    assert.equal(blocked.blocked, true);
    assert.equal(blockedFetches, 1);

    // A different upstream client gets one fresh attempt and is promoted by
    // the first-frame milestone.
    const thirdVersion = Buffer.from('{"build":3}');
    const thirdVersionHash = md5(thirdVersion);
    store.set(thirdVersionHash, thirdVersion);
    versionEntry.size = thirdVersion.length;
    versionEntry.chunkHashes = [thirdVersionHash];
    const freshCandidate = await client2.update({
      blockedFingerprint: candidate.fingerprint,
    });
    assert.equal(freshCandidate.candidate, true);
    assert.equal(
      await confirmClientCandidate({
        artifacts,
        previousArtifacts: `${artifacts}.previous`,
        rejectedPath,
      }),
      freshCandidate.fingerprint,
    );
    await assert.rejects(() => stat(`${artifacts}.previous`));
    await assert.rejects(() => stat(join(artifacts, ".candidate.json")));
    assert.equal(await readRejectedClient(rejectedPath, "1.0.0"), null);

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
    const repaired = await repairing.update({
      blockedFingerprint: freshCandidate.fingerprint,
    });
    assert.equal((await readFile(join(artifacts, "Gw.jspi.js"))).toString(), js.toString());
    assert.equal(repairFetches, 1);
    assert.equal(repaired.blocked, false);
    assert.equal(repaired.candidate, false);
    await assert.rejects(() => stat(`${artifacts}.previous`));

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

  it("bounds an unresponsive ArenaNet request", async () => {
    const server = http.createServer(() => {
      // Deliberately never respond; AbortSignal must end the request.
    });
    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
    const address = server.address();
    assert(address && typeof address === "object");
    const root = await mkdtemp(join(tmpdir(), "gw-timeout-"));
    cleanup.push(root);
    const client = new PatchClient({
      artifactsDir: join(root, "artifacts"),
      chunksDir: join(root, "chunks"),
      patchRoot: `http://127.0.0.1:${address.port}`,
      requestTimeoutMs: 25,
    });

    const started = Date.now();
    try {
      await assert.rejects(() =>
        client.getBytes(`http://127.0.0.1:${address.port}/manifest.json`, 1),
      );
      assert(Date.now() - started < 1_000);
    } finally {
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    }
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
