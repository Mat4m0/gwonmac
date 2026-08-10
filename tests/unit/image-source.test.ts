// Behaviour tests for the snapshot image source extracted from harness.ts in
// Every assertion drives the real module: the scheduler runs, the cache
// evicts, and the ranges are assembled from bytes a fake transport returns.
// Nothing here reads source text.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createImageSource } from "../../src/renderer/image-source.js";

const turn = () => new Promise<void>((resolve) => setImmediate(resolve));

/** Deterministic snapshot content, so an assembled range can be checked byte for byte. */
const snapshotByte = (offset: number) => (offset * 7 + 11) & 0xff;
const snapshotBytes = (start: number, length: number) =>
  Uint8Array.from({ length }, (_, i) => snapshotByte(start + i));

type Priority = "demand" | "prefetch";

interface Request {
  start: number;
  length: number;
  priority: Priority;
  settled: boolean;
  resolve(bytes: Uint8Array): void;
  reject(error: unknown): void;
}

/**
 * A transport whose every range read is held until the test releases it, so
 * the eight-request ceiling and the queue order are observable.
 */
function fakeTransport(
  bytesFor: (start: number, length: number) => Uint8Array = snapshotBytes,
) {
  const requests: Request[] = [];
  let auto = false;

  const serve = (request: Request) => {
    request.settled = true;
    request.resolve(bytesFor(request.start, request.length));
  };

  return {
    requests,
    fetchRange: (start: number, length: number, priority: Priority) =>
      new Promise<Uint8Array>((resolve, reject) => {
        const request: Request = {
          start,
          length,
          priority,
          settled: false,
          resolve,
          reject,
        };
        requests.push(request);
        if (auto) serve(request);
      }),
    serveImmediately() {
      auto = true;
      for (const request of requests) if (!request.settled) serve(request);
    },
    serve(index: number) {
      serve(requests[index]!);
    },
    fail(index: number, message: string, code?: string) {
      const request = requests[index]!;
      request.settled = true;
      const error = new Error(message);
      if (code) (error as Error & { gwCode?: string }).gwCode = code;
      request.reject(error);
    },
    issued: () => requests.map((r) => ({ start: r.start, priority: r.priority })),
  };
}

function fakeDiagnostics() {
  const events: string[] = [];
  return {
    events,
    api: {
      cache: (source: "memory" | "native" | "coalesced") => {
        events.push(`cache:${source}`);
      },
      scheduler: (event: "eviction" | "promotion") => {
        events.push(`scheduler:${event}`);
      },
      snapshot: (durationUs: number, bytes: number, source: "memory" | "native") => {
        events.push(`snapshot:${source}:${bytes}`);
      },
    },
    count: (name: string) => events.filter((event) => event === name).length,
  };
}

function makeSource(options: {
  size: number;
  chunkSize: number;
  chunkHashes?: string[];
  residentBits?: Uint8Array;
  heapBytes?: number;
  bytesFor?: (start: number, length: number) => Uint8Array;
}) {
  const transport = fakeTransport(options.bytesFor);
  const diagnostics = fakeDiagnostics();
  const heap = new Uint8Array(options.heapBytes ?? 512);
  const logged: string[] = [];
  const source = createImageSource({
    metadata: {
      size: options.size,
      chunkSize: options.chunkSize,
      chunkHashes: options.chunkHashes ?? [],
      residentBits: options.residentBits ?? new Uint8Array(0),
    },
    fetchRange: transport.fetchRange,
    writeBytes: (data, address) => heap.set(data, address),
    diagnostics: diagnostics.api,
    log: (...values) => logged.push(values.map(String).join(" ")),
  });
  const handle = source.image.open("Gw.snapshot");
  return { source, image: source.image, transport, diagnostics, heap, handle, logged };
}

describe("renderer image source", () => {
  it("answers fileSize synchronously, before any read, and only for open snapshot handles", () => {
    const { source, image, transport, handle } = makeSource({
      size: 4_294_967_296,
      chunkSize: 262_144,
    });

    // No await: the client contract calls this on the synchronous path.
    assert.equal(image.fileSize(handle), 4_294_967_296);
    assert.equal(transport.requests.length, 0);
    assert.equal(source.state().pendingChunks, 0);

    // Only the snapshot is backed; a handle for anything else makes the client
    // allocate 4.2 GB for a small ini file.
    assert.equal(image.open("Gw.snapshot"), 2);
    assert.equal(image.open("/game/data/Gw.snapshot"), 3);
    assert.equal(image.open("ChatFilter.ini"), 0);
    assert.equal(image.fileSize(0), 0);
    assert.equal(image.fileSize(99), 0);

    image.close(handle);
    assert.equal(image.fileSize(handle), 0);
  });

  it("coalesces concurrent reads of the same range into one fetch", async () => {
    const { image, source, transport, diagnostics, heap, handle } = makeSource({
      size: 256,
      chunkSize: 64,
    });

    const first = image.readAsync(handle, 0, null, 0, 32);
    // The byte-identical range, and an overlapping one: both wait on the fetch
    // the first read started rather than starting one of their own.
    const same = image.readAsync(handle, 0, null, 256, 32);
    const overlapping = image.readAsync(handle, 8, null, 128, 16);
    await turn();

    assert.equal(transport.requests.length, 1);
    assert.deepEqual(transport.issued(), [{ start: 0, priority: "demand" }]);

    transport.serve(0);
    await Promise.all([first, same, overlapping]);

    assert.deepEqual(heap.subarray(0, 32), snapshotBytes(0, 32));
    assert.deepEqual(heap.subarray(256, 288), snapshotBytes(0, 32));
    assert.deepEqual(heap.subarray(128, 144), snapshotBytes(8, 16));
    assert.equal(diagnostics.count("cache:coalesced"), 2);
    assert.equal(source.stats().coalesced, 2);
    assert.equal(source.stats().fromNative, 1);
    assert.equal(source.stats().reads, 3);
    source.stop();
  });

  it("batches adjacent queued demand chunks without fetching across a gap", async () => {
    const { image, source, transport, heap, handle } = makeSource({
      size: 64 * 5,
      chunkSize: 64,
    });

    const first = image.readAsync(handle, 0, null, 0, 16);
    const adjacent = image.readAsync(handle, 64, null, 64, 16);
    const afterGap = image.readAsync(handle, 3 * 64, null, 128, 16);
    await turn();

    assert.equal(transport.requests.length, 2);
    assert.deepEqual(
      transport.requests.map(({ start, length, priority }) => ({
        start,
        length,
        priority,
      })),
      [
        { start: 0, length: 128, priority: "demand" },
        { start: 3 * 64, length: 64, priority: "demand" },
      ],
    );
    assert.equal(source.state().activeDemand, 3, "the ceiling counts chunks");

    transport.serveImmediately();
    await Promise.all([first, adjacent, afterGap]);
    assert.deepEqual(heap.subarray(0, 16), snapshotBytes(0, 16));
    assert.deepEqual(heap.subarray(64, 80), snapshotBytes(64, 16));
    assert.deepEqual(heap.subarray(128, 144), snapshotBytes(3 * 64, 16));
    assert.equal(source.stats().fromNative, 3);
    source.stop();
  });

  it("counts batched demand chunks toward the shared eight-chunk ceiling", async () => {
    const { image, source, transport, handle } = makeSource({
      size: 64 * 16,
      chunkSize: 64,
    });

    // All work is queued in one turn. Demand overtakes prefetch, and its six
    // adjacent chunks share one range request while still consuming six slots.
    // Prefetch fills what remains minus the reserved demand slot.
    for (let chunk = 0; chunk < 4; chunk++) {
      void image.cacheAsync(handle, chunk * 64, 1, () => {}).catch(() => {});
    }
    const reads = Array.from({ length: 6 }, (_, n) =>
      image.readAsync(handle, (4 + n) * 64, null, 0, 16));
    await turn();

    assert.equal(transport.requests.length, 2);
    assert.deepEqual(
      {
        start: transport.requests[0]!.start,
        length: transport.requests[0]!.length,
        priority: transport.requests[0]!.priority,
      },
      { start: 4 * 64, length: 6 * 64, priority: "demand" },
    );
    assert.deepEqual(source.state(), {
      memoryCacheBytes: 0,
      memoryCacheChunks: 0,
      pendingChunks: 10,
      activeDemand: 6,
      activePrefetch: 1,
      queuedDemand: 0,
      queuedPrefetch: 3,
    });

    // Completing one range releases all six logical demand slots. The queued
    // prefetch chunks can then start, but total active chunks never exceeds 8.
    transport.serve(0);
    await turn();
    assert.equal(transport.requests.length, 5);
    assert.equal(source.state().activeDemand, 0);
    assert.equal(source.state().activePrefetch, 4);
    assert.equal(source.state().queuedPrefetch, 0);

    transport.serveImmediately();
    await Promise.all(reads);
    source.stop();
  });

  it("coalesces a demand read onto an already active prefetch instead of promoting it", async () => {
    const { image, source, transport, diagnostics, heap, handle } = makeSource({
      size: 64 * 4,
      chunkSize: 64,
    });

    const prefetch = image.cacheAsync(handle, 0, 1, () => {});
    await turn();
    assert.deepEqual(transport.issued(), [{ start: 0, priority: "prefetch" }]);

    // The request has already been issued at prefetch priority, so there is
    // nothing left to promote: the read joins it rather than re-fetching.
    const demand = image.readAsync(handle, 16, null, 0, 8);
    await turn();

    assert.equal(transport.requests.length, 1, "no second request for the same chunk");
    assert.equal(diagnostics.count("scheduler:promotion"), 0);
    assert.equal(diagnostics.count("cache:coalesced"), 1);
    assert.equal(source.state().activePrefetch, 1);
    assert.equal(source.state().activeDemand, 0);

    transport.serve(0);
    await Promise.all([prefetch, demand]);
    assert.deepEqual(heap.subarray(0, 8), snapshotBytes(16, 8));
    source.stop();
  });

  it("runs one multi-chunk cacheAsync seven-wide, keeping the demand slot free", async () => {
    const { image, source, transport } = makeSource({ size: 64 * 12, chunkSize: 64 });

    const progress: number[] = [];
    const prefetch = image.cacheAsync(1, 0, 64 * 12, (bytes) => {
      progress.push(bytes);
    });
    await turn();

    assert.equal(transport.requests.length, 7);
    assert.deepEqual(source.state(), {
      memoryCacheBytes: 0,
      memoryCacheChunks: 0,
      pendingChunks: 12,
      activeDemand: 0,
      activePrefetch: 7,
      queuedDemand: 0,
      queuedPrefetch: 5,
    });

    transport.serve(0);
    await turn();

    assert.equal(transport.requests.length, 8);
    assert.equal(source.state().activePrefetch, 7);
    assert.equal(source.state().queuedPrefetch, 4);
    transport.serveImmediately();
    await prefetch;
    assert.equal(progress.length, 12);
    assert.equal(progress.reduce((sum, bytes) => sum + bytes, 0), 64 * 12);
    source.stop();
  });

  it("runs demand work before queued prefetch, and promotes the queued chunk a read needs", async () => {
    const { image, source, transport, diagnostics, handle } = makeSource({
      size: 64 * 16,
      chunkSize: 64,
    });

    // Ten prefetches: seven occupy their capped slots, three wait behind them.
    for (let chunk = 0; chunk < 10; chunk++) {
      void image.cacheAsync(handle, chunk * 64, 1, () => {}).catch(() => {});
    }
    await turn();
    assert.equal(transport.requests.length, 7);
    assert.equal(source.state().queuedPrefetch, 3);

    // A demand read for a chunk that is already queued promotes that task
    // rather than issuing a second request for it — and the reserved slot
    // starts it immediately, mid-burst, without waiting for a prefetch round
    // trip to finish.
    const promoted = image.readAsync(handle, 9 * 64, null, 0, 16);
    // A demand read for a chunk nobody asked for joins the demand queue behind it.
    const fresh = image.readAsync(handle, 10 * 64, null, 64, 16);
    await turn();

    assert.equal(diagnostics.count("scheduler:promotion"), 1);
    assert.equal(transport.requests.length, 8, "the reserved slot took the promoted read");
    assert.deepEqual(source.state(), {
      memoryCacheBytes: 0,
      memoryCacheChunks: 0,
      pendingChunks: 11,
      activeDemand: 1,
      activePrefetch: 7,
      queuedDemand: 1,
      queuedPrefetch: 2,
    });

    transport.serve(0);
    await turn();
    transport.serve(1);
    await turn();
    transport.serve(2);
    await turn();
    transport.serve(3);
    await turn();

    assert.deepEqual(transport.issued().slice(7), [
      { start: 9 * 64, priority: "demand" },
      { start: 10 * 64, priority: "demand" },
      { start: 7 * 64, priority: "prefetch" },
      { start: 8 * 64, priority: "prefetch" },
    ]);

    transport.serveImmediately();
    await Promise.all([promoted, fresh]);
    source.stop();
  });

  it("releases the slot a failed fetch held, and reports the failure until a retry succeeds", async () => {
    const { image, source, transport, heap, handle } = makeSource({
      size: 128,
      chunkSize: 64,
    });

    const failing = image.readAsync(handle, 0, null, 0, 16);
    await turn();
    transport.fail(0, "Game data download failed (HTTP 503).", "chunk_offline");
    await assert.rejects(failing, /HTTP 503/);
    await turn();

    // The code the response was tagged with is reported; the prose is not.
    assert.equal(source.lastErrorCode(), "chunk_offline");
    assert.equal(source.state().activeDemand, 0);
    assert.equal(source.state().pendingChunks, 0);

    const retry = image.readAsync(handle, 0, null, 0, 16);
    await turn();
    assert.equal(transport.requests.length, 2, "the retry got a slot");
    transport.serve(1);
    await retry;
    assert.deepEqual(heap.subarray(0, 16), snapshotBytes(0, 16));
    source.stop();
  });

  it("releases every slot after a batched failure", async () => {
    const { image, source, transport, heap, handle } = makeSource({
      size: 64 * 12,
      chunkSize: 64,
    });

    // Twelve demand reads: eight in flight, four behind them.
    const reads = Array.from({ length: 12 }, (_, chunk) =>
      image.readAsync(handle, chunk * 64, null, 0, 16));
    await turn();
    assert.equal(transport.requests.length, 1);
    assert.equal(transport.requests[0]!.length, 8 * 64);
    assert.equal(source.state().queuedDemand, 4);

    // One failed range rejects its eight affected chunks and releases all
    // eight logical slots, allowing the remaining batch to run.
    transport.fail(0, "Game data download failed (HTTP 503).");
    const failed = await Promise.allSettled(reads.slice(0, 8));
    assert.ok(failed.every((result) => result.status === "rejected"));
    await turn();

    assert.equal(transport.requests.length, 2, "the queued chunks got the freed slots");
    assert.equal(transport.requests[1]!.start, 8 * 64);
    assert.equal(transport.requests[1]!.length, 4 * 64);
    assert.equal(source.state().activeDemand, 4);
    assert.equal(source.state().queuedDemand, 0);
    // A failure with no tagged code reports null rather than leaking prose.
    assert.equal(source.lastErrorCode(), null);

    transport.serveImmediately();
    await Promise.all(reads.slice(8));
    assert.deepEqual(heap.subarray(0, 16), snapshotBytes(11 * 64, 16));
    source.stop();
  });

  it("rejects every affected chunk when a batched response is truncated", async () => {
    const { image, source, transport, handle } = makeSource({
      size: 128,
      chunkSize: 64,
      bytesFor: (start, length) => snapshotBytes(start, length - 1),
    });

    const reads = [
      image.readAsync(handle, 0, null, 0, 16),
      image.readAsync(handle, 64, null, 64, 16),
    ];
    await turn();
    assert.equal(transport.requests.length, 1);

    transport.serve(0);
    await assert.rejects(Promise.all(reads), /received 127/);
    await turn();
    assert.equal(source.state().activeDemand, 0);
    assert.equal(source.state().pendingChunks, 0);
    source.stop();
  });

  it("assembles a range across a chunk boundary and into the short final chunk", async () => {
    // 40 bytes over 16-byte chunks: the last chunk holds 8.
    const { image, source, transport, heap, handle } = makeSource({
      size: 40,
      chunkSize: 16,
    });
    transport.serveImmediately();

    await image.readAsync(handle, 12, null, 0, 20);
    assert.deepEqual(heap.subarray(0, 20), snapshotBytes(12, 20));
    assert.deepEqual(transport.issued(), [{ start: 0, priority: "demand" }]);
    assert.equal(transport.requests[0]!.length, 32);

    // Into the tail: chunk 1 is already resident, chunk 2 is 8 bytes long.
    await image.readAsync(handle, 30, null, 64, 10);
    assert.deepEqual(heap.subarray(64, 74), snapshotBytes(30, 10));
    assert.equal(transport.requests.length, 2);
    assert.deepEqual(
      { start: transport.requests[1]!.start, length: transport.requests[1]!.length },
      { start: 32, length: 8 },
    );

    // Wholly inside one cached chunk: no transport at all.
    await image.readAsync(handle, 20, null, 128, 4);
    assert.deepEqual(heap.subarray(128, 132), snapshotBytes(20, 4));
    assert.equal(transport.requests.length, 2);
    assert.equal(source.stats().reads, 3);
    assert.ok(source.stats().fromMemory >= 1);
    source.stop();
  });

  it("evicts the least recently used chunk at the 256 MiB budget", async () => {
    const MIB = 1024 * 1024;
    // One backing allocation: the eviction accounting reads lengths, not bytes.
    const backing = new Uint8Array(64 * MIB);
    const { image, source, transport, diagnostics } = makeSource({
      size: 64 * MIB * 6,
      chunkSize: 64 * MIB,
      bytesFor: (_start, length) => backing.subarray(0, length),
    });
    transport.serveImmediately();

    const prefetch = (chunk: number) =>
      image.cacheAsync(1, chunk * 64 * MIB, 1, () => {});
    for (const chunk of [0, 1, 2, 3]) await prefetch(chunk);

    assert.equal(source.state().memoryCacheBytes, 256 * MIB);
    assert.equal(source.state().memoryCacheChunks, 4);
    assert.equal(diagnostics.count("scheduler:eviction"), 0, "256 MiB is not over budget");
    assert.equal(transport.requests.length, 4);

    // Re-reading chunk 0 is a cache hit that moves it to the LRU tail, so the
    // next eviction must take chunk 1 rather than chunk 0.
    await prefetch(0);
    assert.equal(transport.requests.length, 4, "a hit issues no request");

    await prefetch(4);
    assert.equal(diagnostics.count("scheduler:eviction"), 1);
    assert.equal(source.state().memoryCacheBytes, 256 * MIB);
    assert.equal(source.state().memoryCacheChunks, 4);
    assert.equal(image.isCached(1, 1 * 64 * MIB, 1), 0, "chunk 1 was least recently used");
    assert.equal(image.isCached(1, 0, 1), 1);
    assert.equal(image.isCached(1, 4 * 64 * MIB, 1), 1);
    source.stop();
  });

  it("counts native residency in isCached, which memory eviction does not erase", async () => {
    const chunkHashes = ["hash-0", "hash-1", "hash-2", "hash-3"];
    // residentBits is a bitmap over chunk indices: chunk 2 only.
    const { image, source, transport, handle } = makeSource({
      size: 64 * 4,
      chunkSize: 64,
      chunkHashes,
      residentBits: Uint8Array.of(0b0000_0100),
    });
    transport.serveImmediately();

    assert.equal(image.isCached(handle, 2 * 64, 1), 1, "resident before any read");
    assert.equal(image.isCached(handle, 0, 1), 0);
    assert.equal(transport.requests.length, 0, "isCached does no I/O");
    assert.equal(source.stats().residentHashes, 1);

    await image.readAsync(handle, 0, null, 0, 8);
    assert.equal(image.isCached(handle, 0, 1), 1);
    assert.equal(source.stats().residentHashes, 2, "a fetched chunk became resident");

    assert.equal(source.evictMemory(), 1);
    assert.equal(source.state().memoryCacheBytes, 0);
    assert.equal(image.isCached(handle, 0, 1), 1, "native residency survives eviction");
    assert.equal(image.isCached(handle, 64, 1), 0, "chunk 1 is neither cached nor resident");
    // A range that spans a resident and a missing chunk is not cached.
    assert.equal(image.isCached(handle, 0, 128), 0);
    source.stop();
  });

  it("stops background work at unload and fails what was still queued", async () => {
    const { image, source, transport, handle } = makeSource({
      size: 64 * 12,
      chunkSize: 64,
    });

    const prefetches = Array.from({ length: 10 }, (_, chunk) =>
      image.cacheAsync(handle, chunk * 64, 1, () => {}));
    await turn();
    assert.equal(source.state().queuedPrefetch, 3);

    source.stop();
    await assert.rejects(prefetches[7]!, /background download stopped/);
    await assert.rejects(prefetches[8]!, /background download stopped/);
    await assert.rejects(prefetches[9]!, /background download stopped/);
    assert.equal(source.state().queuedPrefetch, 0);

    // A prefetch requested after unload is refused the moment it reaches the
    // front of the queue, and never becomes a request.
    const late = image.cacheAsync(handle, 11 * 64, 1, () => {});
    transport.serve(0);
    await assert.rejects(late, /background download stopped/);
    assert.equal(transport.requests.length, 7);

    for (const pending of prefetches.slice(0, 7)) void pending.catch(() => {});
  });
});
