import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it, after } from "node:test";
import { ChunkStore } from "../../src/main/core/chunk-store.ts";

const CHUNK = 4096;

function hashOf(data: Uint8Array): string {
  return createHash("md5").update(data).digest("hex");
}

async function waitFor(
  condition: () => boolean,
  message: string,
  timeoutMs = 2_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!condition() && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  assert.equal(condition(), true, message);
}

describe("chunk-store", () => {
  let dir = "";
  const cleanup: string[] = [];

  after(async () => {
    for (const d of cleanup) await rm(d, { recursive: true, force: true });
  });

  async function freshDir(): Promise<string> {
    dir = await mkdtemp(join(tmpdir(), "gw-chunks-"));
    cleanup.push(dir);
    return dir;
  }

  it("coalesces concurrent fetches of the same hash", async () => {
    const root = await freshDir();
    let fetches = 0;
    const payload = Buffer.alloc(CHUNK, 7);
    const h = hashOf(payload);
    const store = new ChunkStore({
      chunksDir: root,
      size: CHUNK * 2,
      chunkSize: CHUNK,
      chunkHashes: [h, h],
      fetch: async () => {
        fetches += 1;
        await new Promise((r) => setTimeout(r, 20));
        return new Uint8Array(payload);
      },
    });
    await Promise.all([store.ensureChunk(0), store.ensureChunk(0), store.ensureChunk(1)]);
    assert.equal(fetches, 1);
    assert.equal((await readFile(join(root, h))).length, CHUNK);
  });

  it("reads across chunk boundaries and short final chunks", async () => {
    const root = await freshDir();
    const a = Buffer.alloc(CHUNK, 1);
    const b = Buffer.alloc(100, 2);
    const ha = hashOf(a);
    const hb = hashOf(b);
    const store = new ChunkStore({
      chunksDir: root,
      size: CHUNK + 100,
      chunkSize: CHUNK,
      chunkHashes: [ha, hb],
      fetch: async (hash) => new Uint8Array(hash === ha ? a : b),
    });
    const got = await store.readRange(CHUNK - 4, 8);
    assert.equal(got.length, 8);
    assert.deepEqual([...got.subarray(0, 4)], [1, 1, 1, 1]);
    assert.deepEqual([...got.subarray(4)], [2, 2, 2, 2]);
  });

  it("rejects hash mismatches without publishing", async () => {
    const root = await freshDir();
    const good = Buffer.alloc(CHUNK, 3);
    const h = hashOf(good);
    const store = new ChunkStore({
      chunksDir: root,
      size: CHUNK,
      chunkSize: CHUNK,
      chunkHashes: [h],
      fetch: async () => new Uint8Array(Buffer.alloc(CHUNK, 9)),
    });
    await assert.rejects(() => store.ensureChunk(0), /hash mismatch/);
    await assert.rejects(() => readFile(join(root, h)));
  });

  it("replaces a corrupt resident chunk before returning it", async () => {
    const root = await freshDir();
    const good = Buffer.alloc(CHUNK, 4);
    const h = hashOf(good);
    await writeFile(join(root, h), Buffer.alloc(CHUNK, 8));
    let fetches = 0;
    const store = new ChunkStore({
      chunksDir: root,
      size: CHUNK,
      chunkSize: CHUNK,
      chunkHashes: [h],
      fetch: async () => {
        fetches += 1;
        return new Uint8Array(good);
      },
    });
    assert.deepEqual(await store.readRange(0, CHUNK), new Uint8Array(good));
    assert.equal(fetches, 1);
  });

  it("verifies and repairs resident chunks before full-download completion", async () => {
    const root = await freshDir();
    const good = Buffer.alloc(CHUNK, 4);
    const hash = hashOf(good);
    await writeFile(join(root, hash), Buffer.alloc(CHUNK, 8));
    let fetches = 0;
    const store = new ChunkStore({
      chunksDir: root,
      size: CHUNK,
      chunkSize: CHUNK,
      chunkHashes: [hash],
      fetch: async () => {
        fetches += 1;
        return new Uint8Array(good);
      },
    });

    assert.equal(
      await store.downloadAll({ freeBytes: async () => 2 * 1024 ** 3 }),
      true,
    );
    assert.equal(fetches, 1);
    assert.deepEqual(await readFile(join(root, hash)), good);
  });

  it("allows pause and sleep to interrupt resident-cache verification", async () => {
    const root = await freshDir();
    const payloads = Array.from({ length: 4 }, (_, index) =>
      Buffer.alloc(CHUNK * 256, index + 70),
    );
    const hashes = payloads.map(hashOf);
    await Promise.all(
      payloads.map((payload, index) =>
        writeFile(join(root, hashes[index]!), payload),
      ),
    );
    const store = new ChunkStore({
      chunksDir: root,
      size: payloads.reduce((total, payload) => total + payload.length, 0),
      chunkSize: payloads[0]!.length,
      chunkHashes: hashes,
      fetch: async () => {
        throw new Error("resident verification must not fetch");
      },
    });

    const download = store.downloadAll({
      jobs: 1,
      freeBytes: async () => 2 * 1024 ** 3,
    });
    setImmediate(() => store.stop());
    assert.equal(await download, false);
  });

  it("merges boot working set and never shrinks it", async () => {
    const root = await freshDir();
    const boot = join(root, "boot-chunks.json");
    const a = Buffer.alloc(CHUNK, 1);
    const ha = hashOf(a);
    const store = new ChunkStore({
      chunksDir: root,
      size: CHUNK * 3,
      chunkSize: CHUNK,
      chunkHashes: [ha, ha, ha],
      bootListPath: boot,
      fetch: async () => new Uint8Array(a),
    });
    await store.readRange(0, 10);
    await store.saveTouched();
    const first = JSON.parse(await readFile(boot, "utf8")) as { chunks: number[] };
    assert.deepEqual(first.chunks, [0]);

    const store2 = new ChunkStore({
      chunksDir: root,
      size: CHUNK * 3,
      chunkSize: CHUNK,
      chunkHashes: [ha, ha, ha],
      bootListPath: boot,
      fetch: async () => new Uint8Array(a),
    });
    await store2.readRange(CHUNK * 2, 10);
    await store2.saveTouched();
    const second = JSON.parse(await readFile(boot, "utf8")) as { chunks: number[] };
    assert.deepEqual(second.chunks, [0, 2]);
  });

  it("full-image resume downloads only missing hashes", async () => {
    const root = await freshDir();
    const payloads = [Buffer.alloc(CHUNK, 1), Buffer.alloc(CHUNK, 2), Buffer.alloc(100, 3)];
    const hashes = payloads.map(hashOf);
    const fetched = new Set<string>();
    const store = new ChunkStore({
      chunksDir: root,
      size: CHUNK * 2 + 100,
      chunkSize: CHUNK,
      chunkHashes: hashes,
      fetch: async (hash) => {
        fetched.add(hash);
        const i = hashes.indexOf(hash);
        return new Uint8Array(payloads[i]!);
      },
    });
    await store.ensureChunk(0);
    fetched.clear();
    const ok = await store.downloadAll({ freeBytes: async () => 10 * 1024 * 1024 * 1024 });
    assert.equal(ok, true);
    assert.equal(fetched.has(hashes[0]!), false);
    assert.equal(fetched.has(hashes[1]!), true);
    assert.equal(fetched.has(hashes[2]!), true);
  });

  it("fails before downloading when the full image does not fit", async () => {
    const root = await freshDir();
    const payload = Buffer.alloc(CHUNK, 11);
    const hash = hashOf(payload);
    let fetches = 0;
    const store = new ChunkStore({
      chunksDir: root,
      size: CHUNK,
      chunkSize: CHUNK,
      chunkHashes: [hash],
      fetch: async () => {
        fetches += 1;
        return new Uint8Array(payload);
      },
    });

    await assert.rejects(
      () => store.downloadAll({ freeBytes: async () => 0 }),
      (error) =>
        error instanceof Error &&
        "code" in error &&
        error.code === "disk_full",
    );
    assert.equal(fetches, 0);
  });

  it("fails fast and preserves fatal local download errors", async () => {
    const root = await freshDir();
    const payloads = Array.from({ length: 3 }, (_, index) =>
      Buffer.alloc(CHUNK, index + 20),
    );
    const hashes = payloads.map(hashOf);
    let fetches = 0;
    const diskError = Object.assign(new Error("disk filled during write"), {
      code: "ENOSPC",
    });
    const store = new ChunkStore({
      chunksDir: root,
      size: CHUNK * payloads.length,
      chunkSize: CHUNK,
      chunkHashes: hashes,
      fetch: async () => {
        fetches += 1;
        throw diskError;
      },
    });

    await assert.rejects(
      () =>
        store.downloadAll({
          jobs: 1,
          freeBytes: async () => 10 * 1024 * 1024 * 1024,
        }),
      (error) => error === diskError,
    );
    assert.equal(fetches, 1);
  });

  it("bounds exhausted network work and resumes with verified chunks", async () => {
    const root = await freshDir();
    const payloads = Array.from({ length: 10 }, (_, index) =>
      Buffer.alloc(CHUNK, index + 30),
    );
    const hashes = payloads.map(hashOf);
    let failedFetches = 0;
    const unavailable = new ChunkStore({
      chunksDir: root,
      size: CHUNK * payloads.length,
      chunkSize: CHUNK,
      chunkHashes: hashes,
      fetch: async () => {
        failedFetches += 1;
        throw new Error("offline");
      },
    });

    await assert.rejects(() =>
      unavailable.downloadAll({
        jobs: 3,
        freeBytes: async () => 10 * 1024 * 1024 * 1024,
      }),
    );
    assert.ok(failedFetches > 0);
    assert.ok(failedFetches <= 3);

    const resumed = new ChunkStore({
      chunksDir: root,
      size: CHUNK * payloads.length,
      chunkSize: CHUNK,
      chunkHashes: hashes,
      fetch: async (hash) =>
        new Uint8Array(payloads[hashes.indexOf(hash)]!),
    });
    assert.equal(
      await resumed.downloadAll({
        jobs: 3,
        freeBytes: async () => 10 * 1024 * 1024 * 1024,
      }),
      true,
    );
  });

  it("preserves completed chunks when a full download is stopped and resumed", async () => {
    const root = await freshDir();
    const payloads = Array.from({ length: 3 }, (_, index) =>
      Buffer.alloc(CHUNK, index + 60),
    );
    const hashes = payloads.map(hashOf);
    const fetches: string[] = [];
    const store = new ChunkStore({
      chunksDir: root,
      size: CHUNK * payloads.length,
      chunkSize: CHUNK,
      chunkHashes: hashes,
      fetch: async (hash) => {
        fetches.push(hash);
        return new Uint8Array(payloads[hashes.indexOf(hash)]!);
      },
    });

    const stopped = await store.downloadAll({
      jobs: 1,
      freeBytes: async () => 10 * 1024 * 1024 * 1024,
      onProgress: () => store.stop(),
    });
    assert.equal(stopped, false);
    assert.deepEqual(fetches, [hashes[0]]);

    store.resume();
    const completed = await store.downloadAll({
      jobs: 1,
      freeBytes: async () => 10 * 1024 * 1024 * 1024,
    });
    assert.equal(completed, true);
    assert.deepEqual(fetches, hashes);
  });

  it("caps native fetches at eight and promotes queued demand", async () => {
    const root = await freshDir();
    const payloads = Array.from({ length: 10 }, (_, index) =>
      Buffer.alloc(CHUNK, index + 1),
    );
    const hashes = payloads.map(hashOf);
    const started: string[] = [];
    const releases = new Map<string, () => void>();
    let active = 0;
    let peak = 0;
    const store = new ChunkStore({
      chunksDir: root,
      size: CHUNK * payloads.length,
      chunkSize: CHUNK,
      chunkHashes: hashes,
      fetch: (hash) =>
        new Promise((resolve) => {
          started.push(hash);
          active += 1;
          peak = Math.max(peak, active);
          releases.set(hash, () => {
            active -= 1;
            resolve(new Uint8Array(payloads[hashes.indexOf(hash)]!));
          });
        }),
    });
    const work = hashes.map((_hash, index) =>
      store.ensureChunk(index, "prefetch"),
    );
    await waitFor(() => started.length === 8, "eight fetches did not start");
    assert.equal(started.length, 8);
    const demand = store.ensureChunk(9, "demand");
    const activeHash = started[0]!;
    const firstRelease = releases.get(activeHash)!;
    releases.delete(activeHash);
    firstRelease();
    await waitFor(
      () => started[8] === hashes[9],
      "demand did not start before queued prefetch",
    );
    assert.equal(started[8], hashes[9]);
    while (started.length < hashes.length || active > 0) {
      for (const hash of [...started]) {
        const release = releases.get(hash);
        if (release) {
          releases.delete(hash);
          release();
        }
      }
      await new Promise((resolve) => setImmediate(resolve));
    }
    await Promise.all([...work, demand]);
    assert.equal(peak, 8);
  });

  it("serves fetched and first-process resident bytes without a second read", async () => {
    const root = await freshDir();
    const payload = Buffer.alloc(CHUNK, 6);
    const hash = hashOf(payload);
    const observed: string[] = [];
    const fetched = new Uint8Array(payload);
    const store = new ChunkStore({
      chunksDir: root,
      size: CHUNK,
      chunkSize: CHUNK,
      chunkHashes: [hash],
      fetch: async () => fetched,
      metrics: {
        count: () => undefined,
        observe: (name) => observed.push(name),
      },
    });
    const first = await store.readRange(0, CHUNK);
    assert.equal(first.buffer, fetched.buffer);
    assert.equal(observed.filter((name) => name === "cache.diskRead").length, 0);

    observed.length = 0;
    const restarted = new ChunkStore({
      chunksDir: root,
      size: CHUNK,
      chunkSize: CHUNK,
      chunkHashes: [hash],
      fetch: null,
      metrics: {
        count: () => undefined,
        observe: (name) => observed.push(name),
      },
    });
    assert.deepEqual(
      [...(await restarted.readRange(0, CHUNK))],
      [...fetched],
    );
    assert.equal(observed.filter((name) => name === "cache.diskRead").length, 1);
    assert.equal(observed.filter((name) => name === "cache.verify").length, 1);
  });

  it("releases a failed slot and allows the same chunk to retry", async () => {
    const root = await freshDir();
    const payloads = Array.from({ length: 9 }, (_, index) =>
      Buffer.alloc(CHUNK, index + 20),
    );
    const hashes = payloads.map(hashOf);
    let failedOnce = false;
    const started: string[] = [];
    const store = new ChunkStore({
      chunksDir: root,
      size: CHUNK * payloads.length,
      chunkSize: CHUNK,
      chunkHashes: hashes,
      fetch: async (hash) => {
        started.push(hash);
        if (hash === hashes[0] && !failedOnce) {
          failedOnce = true;
          throw new Error("temporary");
        }
        return new Uint8Array(payloads[hashes.indexOf(hash)]!);
      },
    });
    const results = await Promise.allSettled(
      hashes.map((_hash, index) => store.ensureChunk(index, "prefetch")),
    );
    assert.equal(results[0]!.status, "rejected");
    assert.equal(started.includes(hashes[8]!), true);
    assert.deepEqual(
      [...(await store.ensureChunk(0, "demand"))],
      [...payloads[0]!],
    );
    assert.equal(
      started.filter((hash) => hash === hashes[0]).length,
      2,
    );
  });

  it("stops queued background work while allowing new demand", async () => {
    const root = await freshDir();
    const payloads = Array.from({ length: 9 }, (_, index) =>
      Buffer.alloc(CHUNK, index + 40),
    );
    const hashes = payloads.map(hashOf);
    const started: string[] = [];
    const releases = new Map<string, () => void>();
    const store = new ChunkStore({
      chunksDir: root,
      size: CHUNK * payloads.length,
      chunkSize: CHUNK,
      chunkHashes: hashes,
      fetch: (hash) =>
        new Promise((resolve) => {
          started.push(hash);
          releases.set(hash, () =>
            resolve(new Uint8Array(payloads[hashes.indexOf(hash)]!)),
          );
        }),
    });
    const background = hashes.map((_hash, index) =>
      store.ensureChunk(index, "prefetch"),
    );
    const settledBackground = Promise.allSettled(background);
    await waitFor(() => started.length === 8, "eight fetches did not start");
    assert.equal(started.length, 8);
    const stoppedIndex = hashes.findIndex((hash) => !started.includes(hash));
    assert.notEqual(stoppedIndex, -1);
    store.stop();
    const demand = store.ensureChunk(stoppedIndex, "demand");
    const activeHash = started[0]!;
    const firstRelease = releases.get(activeHash)!;
    releases.delete(activeHash);
    firstRelease();
    await waitFor(
      () => started.includes(hashes[stoppedIndex]!),
      "demand did not start after stopping queued prefetch",
    );
    assert.equal(started.includes(hashes[stoppedIndex]!), true);
    for (const release of releases.values()) release();
    await demand;
    const results = await settledBackground;
    assert.equal(results[stoppedIndex]!.status, "rejected");
  });
});
