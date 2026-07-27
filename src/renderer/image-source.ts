// The snapshot image behind `Module.image`: metadata, a byte-budgeted LRU over
// renderer memory, native residency, request coalescing, range assembly, and
// the eight-request scheduler that lets a demand read overtake prefetch work.
//
// harness.js owned all of this until P6.2 and now owns only the wiring: the
// HTTP range fetch, the WASM heap write, and the console helpers over stats().
// Nothing here touches `window`, `fetch` or `Module`, which is what makes the
// algorithms testable.

import type { SnapshotMetadata } from '../shared/contracts.js';

// The chunk size the main process publishes; the fallback is the value the
// harness has always substituted for a metadata document without one.
const DEFAULT_CHUNK_SIZE = 262144;
// Renderer memory is disposable; native chunk residency lives in the main process.
const CHUNK_CACHE_MAX = 256 * 1024 * 1024;
const MAX_CHUNK_REQUESTS = 8;
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
};

export type ImageSource = {
  image: ImageCapability;
  stats(): ImageStats;
  state(): SnapshotState;
  evictMemory(): number;
  lastError(): string;
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
  let lastError = '';

  const inflight = new Map<number, ChunkTask>();
  const demandQueue: ChunkTask[] = [];
  const prefetchQueue: ChunkTask[] = [];
  let activeDemand = 0;
  let activePrefetch = 0;
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

  function drainChunkQueue() {
    while (activeDemand + activePrefetch < MAX_CHUNK_REQUESTS) {
      const task = demandQueue.shift() || prefetchQueue.shift();
      if (!task) return;
      if (stopped && task.priority === 'prefetch') {
        task.reject(new Error('background download stopped'));
        inflight.delete(task.index);
        continue;
      }
      task.state = 'active';
      if (task.priority === 'demand') activeDemand++;
      else activePrefetch++;
      const start = task.index * chunkSize;
      const length = Math.min(start + chunkSize, size) - start;
      void fetchRange(start, length, task.priority).then((buf) => {
        cachePut(task.index, buf);
        markResident(task.index);
        stats.fromNative++;
        diagnostics?.cache('native');
        task.resolve(buf);
      }).catch((error) => {
        lastError = error instanceof Error ? error.message : String(error);
        task.reject(error);
      }).finally(() => {
        inflight.delete(task.index);
        if (task.priority === 'demand') activeDemand--;
        else activePrefetch--;
        drainChunkQueue();
      });
    }
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
    drainChunkQueue();
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
    for (let i = first; i <= last; i++) {
      const buf = await chunkBytes(i, 'prefetch');
      if (progress) progress(buf.length);
    }
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
        log(`image: read ${(burstBytes / 1048576).toFixed(1)}MB (mem ${stats.fromMemory}, ` +
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
        const fetched = await fetchDemandChunks(first, last);
        data = assembleRange(offset, bytes, (index) => fetched[index - first]);
      }
      if (data === null || data.length !== bytes) {
        throw new Error(`image read ${offset}+${bytes}: assembled ${data && data.length}`);
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

    lastError: () => lastError,

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
