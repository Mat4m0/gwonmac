/**
 * The snapshot image behind `Module.image`: metadata, a byte-budgeted LRU over
 * renderer memory, native residency, request coalescing, range assembly, and
 * the eight-request scheduler that lets a demand read overtake prefetch work.
 *
 * harness.js owned all of this until P6.2 and now owns only the wiring: the
 * HTTP range fetch, the WASM heap write, and the console helpers over stats().
 * Nothing here touches `window`, `fetch` or `Module`, which is what makes the
 * algorithms testable.
 */

// A runtime import, not a type-only one: src/main/protocol.ts serves
// build/shared/contracts.js at gw://app/shared/contracts.js for exactly this.
import {
  ARENANET_REQUEST_CEILING,
  type SnapshotMetadata,
} from '../shared/contracts.js';

// The chunk size the main process publishes; the fallback is the value the
// harness has always substituted for a metadata document without one.
const DEFAULT_CHUNK_SIZE = 262144;
// Renderer memory is disposable; native chunk residency lives in the main process.
const CHUNK_CACHE_MAX = 256 * 1024 * 1024;
// A read burst is summarised once it goes quiet, for the optional game console.
const BURST_QUIET_MS = 400;
const BURST_LOG_BYTES = 4 * 1024 * 1024;

/** How a queued chunk read ranks against the others. */
type Priority = 'demand' | 'prefetch';

/**
 * The capability the ArenaNet client calls. The client contract fixes every
 * signature, `fileSize` is synchronous, and `readAsync` takes an unused third
 * argument the generated glue still passes.
 */
type ImageCapability = {
  open(path: string): number;
  fileSize(handle: number): number;
  close(handle: number): void;
  readAsync(
    imageId: number,
    offset: number,
    _unused: unknown,
    buffer: number,
    bytes: number,
  ): Promise<void>;
  isCached(handle: number, offset: number, size: number): 0 | 1;
  cacheAsync(
    handle: number,
    offset: number,
    size: number,
    progress: (bytes: number) => void,
  ): Promise<void>;
};

type ImageStats = {
  reads: number;
  bytes: number;
  fromMemory: number;
  fromNative: number;
  coalesced: number;
  cacheBytes: number;
  cacheChunks: number;
  residentHashes: number;
};

/** The scheduler gauges the diagnostics batch carries. */
type SnapshotState = {
  memoryCacheBytes: number;
  memoryCacheChunks: number;
  pendingChunks: number;
  activeDemand: number;
  activePrefetch: number;
  queuedDemand: number;
  queuedPrefetch: number;
};

/**
 * The three counters this subsystem reports. Narrower than the renderer's
 * `RendererDiagnostics`, which `window.gwDiagnostics` satisfies structurally:
 * a module that names the whole recorder is one a test cannot fake honestly.
 */
type ImageDiagnostics = {
  cache(source: 'memory' | 'native' | 'coalesced'): void;
  scheduler(event: 'eviction' | 'promotion'): void;
  snapshot(
    durationUs: number,
    bytes: number,
    source: 'memory' | 'native',
  ): void;
  /**
   * A demand read the client was awaiting rejected. Black textures are this
   * failure's visible face; the event is what ties a capture to it.
   */
  event?(name: 'snapshot.readFailed', value?: unknown): void;
};

export type ImageSource = {
  image: ImageCapability;
  stats(): ImageStats;
  state(): SnapshotState;
  evictMemory(): number;
  lastErrorCode(): string | null;
  stop(): void;
};

type ChunkTask = {
  index: number;
  priority: Priority;
  state: 'queued' | 'active';
  promise: Promise<Uint8Array>;
  resolve: (value: Uint8Array) => void;
  reject: (reason?: unknown) => void;
};

type ImageSourceOptions = {
  metadata: SnapshotMetadata;
  fetchRange(
    start: number,
    length: number,
    priority: Priority,
  ): Promise<Uint8Array>;
  writeBytes(data: Uint8Array, address: number): void;
  diagnostics?: ImageDiagnostics;
  log(...values: unknown[]): void;
};

export function createImageSource({
  metadata,
  fetchRange,
  writeBytes,
  diagnostics,
  log,
}: ImageSourceOptions): ImageSource {
  const size = metadata.size;
  const chunkSize = metadata.chunkSize || DEFAULT_CHUNK_SIZE;
  const chunkHashes = metadata.chunkHashes || [];

  const chunkCache = new Map<number, Uint8Array>();
  let chunkCacheBytes = 0;

  // Derived from snapshot-metadata residentBits — isCached must stay synchronous.
  const residentHashes = new Set<string>();

  const stats = { reads: 0, bytes: 0, fromMemory: 0, fromNative: 0, coalesced: 0 };
  let burstBytes = 0;
  let burstTimer: ReturnType<typeof setTimeout> | null = null;
  // The code the gw://app response tagged onto the failure, or null when the
  // throw carried none. Prose never leaves this module: the renderer maps the
  // code to a reviewed sentence in failure-messages.ts.
  let lastErrorCode: string | null = null;

  const inflight = new Map<number, ChunkTask>();
  const demandQueue: ChunkTask[] = [];
  const prefetchQueue: ChunkTask[] = [];
  let activeDemand = 0;
  let activePrefetch = 0;
  let drainScheduled = false;
  let stopped = false;

  const handles = new Set<number>();
  let nextHandle = 1;

  const hashOf = (i: number) => chunkHashes[i] || '';

  function markResident(i: number) {
    const h = hashOf(i);
    if (h) residentHashes.add(h);
  }

  function applyResidentBits(bits: Uint8Array) {
    if (!bits || !bits.length) return;
    for (let i = 0; i < chunkHashes.length; i++) {
      const byte = bits[i >> 3];
      if (byte !== undefined && (byte & (1 << (i & 7)))) markResident(i);
    }
  }

  const chunkRange = (offset: number, size: number): [number, number] => [
    Math.floor(offset / chunkSize),
    Math.floor((offset + size - 1) / chunkSize),
  ];

  // Re-insert on hit to move the entry to the LRU tail.
  function cacheTouch(i: number) {
    const buf = chunkCache.get(i);
    if (buf !== undefined) { chunkCache.delete(i); chunkCache.set(i, buf); }
    return buf;
  }

  function cachePut(i: number, buf: Uint8Array) {
    if (chunkCache.has(i)) return;
    chunkCache.set(i, buf);
    chunkCacheBytes += buf.length;
    while (chunkCacheBytes > CHUNK_CACHE_MAX && chunkCache.size > 1) {
      const oldest = chunkCache.keys().next().value;
      if (oldest === undefined) break;
      const oldestBuffer = chunkCache.get(oldest);
      if (!oldestBuffer) break;
      chunkCacheBytes -= oldestBuffer.length;
      chunkCache.delete(oldest);
      diagnostics?.scheduler('eviction');
    }
  }

  function promote(task: ChunkTask) {
    if (task.priority !== 'prefetch' || task.state !== 'queued') return;
    const index = prefetchQueue.indexOf(task);
    if (index < 0) return;
    prefetchQueue.splice(index, 1);
    task.priority = 'demand';
    demandQueue.push(task);
    diagnostics?.scheduler('promotion');
  }

  function takeDemandBatch(capacity: number): ChunkTask[] {
    const first = demandQueue.shift();
    if (!first) return [];
    const tasks = [first];
    while (tasks.length < Math.min(capacity, ARENANET_REQUEST_CEILING)) {
      const nextIndex = tasks[tasks.length - 1]!.index + 1;
      const queuedIndex = demandQueue.findIndex((task) => task.index === nextIndex);
      if (queuedIndex < 0) break;
      const [next] = demandQueue.splice(queuedIndex, 1);
      tasks.push(next!);
    }
    return tasks;
  }

  function startChunkTasks(tasks: ChunkTask[]) {
    const priority = tasks[0]!.priority;
    for (const task of tasks) task.state = 'active';
    if (priority === 'demand') activeDemand += tasks.length;
    else activePrefetch += tasks.length;

    const firstIndex = tasks[0]!.index;
    const lastIndex = tasks[tasks.length - 1]!.index;
    const start = firstIndex * chunkSize;
    const end = Math.min((lastIndex + 1) * chunkSize, size);
    void fetchRange(start, end - start, priority).then((buf) => {
      if (buf.length !== end - start) {
        throw new Error(`snapshot range ${start}+${end - start}: received ${buf.length}`);
      }
      for (const task of tasks) {
        const chunkStart = task.index * chunkSize;
        const length = Math.min(chunkStart + chunkSize, size) - chunkStart;
        const offset = chunkStart - start;
        // A subarray would keep the whole batched response alive after sibling
        // chunks were evicted and make the byte-budgeted LRU undercount memory.
        const chunk = tasks.length === 1
          ? buf
          : buf.slice(offset, offset + length);
        cachePut(task.index, chunk);
        markResident(task.index);
        stats.fromNative++;
        diagnostics?.cache('native');
        task.resolve(chunk);
      }
    }).catch((error) => {
      const coded = (error as { gwCode?: unknown } | null)?.gwCode;
      lastErrorCode = typeof coded === 'string' && coded ? coded : null;
      for (const task of tasks) task.reject(error);
    }).finally(() => {
      for (const task of tasks) inflight.delete(task.index);
      if (priority === 'demand') activeDemand -= tasks.length;
      else activePrefetch -= tasks.length;
      drainChunkQueue();
    });
  }

  function drainChunkQueue() {
    while (activeDemand + activePrefetch < ARENANET_REQUEST_CEILING) {
      const capacity = ARENANET_REQUEST_CEILING - activeDemand - activePrefetch;
      const demand = takeDemandBatch(capacity);
      if (demand.length) {
        startChunkTasks(demand);
        continue;
      }
      // The last slot is demand's alone. An active request cannot be recalled
      // within the eight-request conduct ceiling, so prefetch saturating all
      // eight made a cold demand read — a tooltip icon, a fresh model — wait a
      // full round trip behind background work it is supposed to overtake.
      if (capacity <= 1) return;
      const task = prefetchQueue.shift();
      if (!task) return;
      if (stopped) {
        task.reject(new Error('background download stopped'));
        inflight.delete(task.index);
        continue;
      }
      startChunkTasks([task]);
    }
  }

  function scheduleChunkDrain() {
    if (drainScheduled) return;
    drainScheduled = true;
    queueMicrotask(() => {
      drainScheduled = false;
      drainChunkQueue();
    });
  }

  function chunkBytes(i: number, priority: Priority): Promise<Uint8Array> {
    const hit = cacheTouch(i);
    if (hit !== undefined) {
      stats.fromMemory++;
      diagnostics?.cache('memory');
      return Promise.resolve(hit);
    }

    const pending = inflight.get(i);
    if (pending) {
      stats.coalesced++;
      diagnostics?.cache('coalesced');
      if (priority === 'demand') promote(pending);
      return pending.promise;
    }

    let resolve: (value: Uint8Array) => void = () => {};
    let reject: (reason?: unknown) => void = () => {};
    const promise = new Promise<Uint8Array>((yes, no) => { resolve = yes; reject = no; });
    const task: ChunkTask = { index: i, priority, state: 'queued', promise, resolve, reject };
    inflight.set(i, task);
    (priority === 'demand' ? demandQueue : prefetchQueue).push(task);
    scheduleChunkDrain();
    return promise;
  }

  async function fetchDemandChunks(first: number, last: number) {
    return Promise.all(
      Array.from({ length: last - first + 1 }, (_, n) =>
        chunkBytes(first + n, 'demand')),
    );
  }

  async function fetchPrefetchChunks(
    first: number,
    last: number,
    progress: ((bytes: number) => void) | undefined,
  ) {
    await Promise.all(
      Array.from({ length: last - first + 1 }, (_, n) =>
        chunkBytes(first + n, 'prefetch').then((buf) => {
          if (progress) progress(buf.length);
        })),
    );
  }

  function assembleRange(
    offset: number,
    size: number,
    chunk: (index: number) => Uint8Array | undefined,
  ) {
    const [first, last] = chunkRange(offset, size);
    if (first === last) {
      const buf = chunk(first);
      if (buf === undefined) return null;
      const start = offset - first * chunkSize;
      return buf.subarray(start, start + size);
    }
    const out = new Uint8Array(size);
    let pos = offset, written = 0;
    while (written < size) {
      const i = Math.floor(pos / chunkSize);
      const buf = chunk(i);
      if (buf === undefined) return null;
      const off = pos - i * chunkSize;
      const take = Math.min(size - written, buf.length - off);
      if (take <= 0) return null;
      out.set(buf.subarray(off, off + take), written);
      written += take;
      pos += take;
    }
    return out;
  }

  // Assemble a byte range from cached chunks; null if any part is missing.
  function readFromCache(offset: number, size: number) {
    return assembleRange(offset, size, cacheTouch);
  }

  function summariseBurst(bytes: number) {
    burstBytes += bytes;
    if (burstTimer !== null) clearTimeout(burstTimer);
    burstTimer = setTimeout(() => {
      burstTimer = null;
      if (burstBytes > BURST_LOG_BYTES) {
        log(`image: completed ${(burstBytes / 1048576).toFixed(1)}MB read burst ` +
            `(mem ${stats.fromMemory}, ` +
            `native ${stats.fromNative} chunks)`);
      }
      burstBytes = 0;
    }, BURST_QUIET_MS);
  }

  applyResidentBits(metadata.residentBits);
  log('snapshot:', size, 'bytes,', chunkHashes.length,
      'chunks of', chunkSize, `(${residentHashes.size} resident)`);

  const image: ImageCapability = {
    // Only the snapshot is backed. image is a filesystem over the whole
    // manifest, so the module asks for other files (ChatFilter.ini among
    // them); handing back a handle makes fileSize answer 4.2GB for a small ini
    // and the module aborts allocating for it.
    open(path) {
      if (!/(^|[/\\])Gw\.snapshot$/i.test(path)) {
        log(`image.open ${path} -> 0 (not in the image)`);
        return 0;
      }
      const h = nextHandle++;
      handles.add(h);
      log('image.open', path, '-> handle', h);
      return h;
    },

    // Synchronous by contract, which is why the metadata is read before the
    // glue loads and this source is not constructed without it.
    fileSize(handle) {
      if (!handles.has(handle)) {
        return log('[warn] image.fileSize on unknown handle', handle), 0;
      }
      return size;
    },

    close(handle) {
      log('image.close', handle);
      handles.delete(handle);
    },

    async readAsync(imageId, offset, _unused, buffer, bytes) {
      if (!handles.has(imageId)) throw new Error('bad image handle ' + imageId);
      const started = performance.now();
      let data = readFromCache(offset, bytes);
      const source = data === null ? 'native' : 'memory';
      if (data === null) {
        const [first, last] = chunkRange(offset, bytes);
        let fetched;
        try {
          fetched = await fetchDemandChunks(first, last);
        } catch (error) {
          diagnostics?.event?.('snapshot.readFailed', error);
          throw error;
        }
        data = assembleRange(offset, bytes, (index) => fetched[index - first]);
      }
      if (data === null || data.length !== bytes) {
        const failure = new Error(
          `image read ${offset}+${bytes}: assembled ${data && data.length}`,
        );
        diagnostics?.event?.('snapshot.readFailed', failure);
        throw failure;
      }
      stats.reads++;
      stats.bytes += bytes;
      summariseBurst(bytes);

      writeBytes(data, buffer);
      diagnostics?.snapshot((performance.now() - started) * 1000, bytes, source);
    },

    // Memory plus native residency both count; eviction must not erase native.
    isCached(handle, offset, size) {
      const [first, last] = chunkRange(offset, size);
      for (let i = first; i <= last; i++) {
        if (!chunkCache.has(i) && !residentHashes.has(hashOf(i))) return 0;
      }
      return 1;
    },

    async cacheAsync(handle, offset, size, progress) {
      const [first, last] = chunkRange(offset, size);
      await fetchPrefetchChunks(first, last, (n) => {
        try { progress(n); } catch (e) { log('[cache progress]', e); }
      });
    },
  };

  return {
    image,

    stats: () => ({
      reads: stats.reads,
      bytes: stats.bytes,
      fromMemory: stats.fromMemory,
      fromNative: stats.fromNative,
      coalesced: stats.coalesced,
      cacheBytes: chunkCacheBytes,
      cacheChunks: chunkCache.size,
      residentHashes: residentHashes.size,
    }),

    state: () => ({
      memoryCacheBytes: chunkCacheBytes,
      memoryCacheChunks: chunkCache.size,
      pendingChunks: inflight.size,
      activeDemand,
      activePrefetch,
      queuedDemand: demandQueue.length,
      queuedPrefetch: prefetchQueue.length,
    }),

    evictMemory() {
      const n = chunkCache.size;
      chunkCache.clear();
      chunkCacheBytes = 0;
      return n;
    },

    lastErrorCode: () => lastErrorCode,

    // The page is going away: stop issuing background work and fail what is
    // still queued. Clearing the burst timer leaves nothing pending, which is
    // invisible at unload and is what lets a test dispose of a source.
    stop() {
      stopped = true;
      if (burstTimer !== null) { clearTimeout(burstTimer); burstTimer = null; }
      for (const task of prefetchQueue.splice(0)) {
        inflight.delete(task.index);
        task.reject(new Error('background download stopped'));
      }
    },
  };
}
