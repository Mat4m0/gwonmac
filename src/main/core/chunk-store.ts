import { createHash } from "node:crypto";
import { readFile, readdir, stat, statfs, unlink } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { gunzip } from "node:zlib";
import type { PrefetchProgress } from "../../shared/contracts.js";
import { AppError } from "../../shared/errors.js";
import { bytesPerSecond, secondsRemaining } from "../../shared/progress.js";
import { HASH_ALGOS, PREFETCH_JOBS } from "./access-key.js";
import { writeAtomicInDir, writeAtomicJson } from "./atomic-file.js";
import type { CompressionMode } from "./manifest.js";
import { packResidentBits } from "./snapshot.js";

const FREE_MARGIN = 512 * 1024 * 1024;
const gunzipAsync = promisify(gunzip);

export type ChunkBytesFetcher = (hash: string) => Promise<Uint8Array>;

export interface ChunkStoreOptions {
  chunksDir: string;
  size: number;
  chunkSize: number;
  chunkHashes: string[];
  compression?: CompressionMode;
  fetch?: ChunkBytesFetcher | null;
  bootListPath?: string;
  metrics?: ChunkStoreMetrics;
}

export interface ChunkStoreMetrics {
  count(name: string, delta?: number): void;
  observe(name: string, durationUs: number): void;
  gauge?(name: string, value: number): void;
  peak?(name: string, value: number): void;
}

export type ChunkPriority = "demand" | "prefetch";

interface FetchTask {
  hash: string;
  expectedLength: number;
  priority: ChunkPriority;
  queuedAt: number;
  resolve: (data: Uint8Array) => void;
  reject: (error: unknown) => void;
}

export interface DownloadAllProgress {
  received: number;
  total: number;
  bytesPerSecond: number;
  secondsRemaining: number | null;
}

function verifyHash(hash: string, data: Uint8Array): void {
  const algo = HASH_ALGOS[hash.length];
  if (!algo) throw new AppError("hash_format", `unsupported chunk hash: ${hash}`);
  const dig = createHash(algo).update(data).digest("hex");
  if (dig !== hash.toLowerCase()) {
    throw new AppError("hash_mismatch", `hash mismatch on chunk ${hash}`);
  }
}

async function decodeChunk(
  data: Uint8Array,
  compression: CompressionMode,
): Promise<Uint8Array> {
  return compression === "gzip" ? gunzipAsync(data) : data;
}

async function mapPool<T>(
  items: T[],
  jobs: number,
  fn: (item: T) => Promise<void>,
  stopped: () => boolean = () => false,
): Promise<void> {
  let next = 0;
  const workers = Array.from({ length: Math.min(jobs, items.length) || 0 }, async () => {
    while (true) {
      if (stopped()) return;
      const i = next++;
      if (i >= items.length) return;
      await fn(items[i]!);
    }
  });
  await Promise.all(workers);
}

export class ChunkStore {
  readonly size: number;
  readonly chunkSize: number;
  readonly hashes: string[];
  readonly chunksDir: string;
  readonly compression: CompressionMode;
  readonly bootListPath: string;

  private readonly fetchFn: ChunkBytesFetcher | null;
  private readonly metrics: ChunkStoreMetrics | null;
  private readonly inflight = new Map<string, Promise<Uint8Array>>();
  private readonly residentHashes = new Set<string>();
  private readonly verifiedHashes = new Set<string>();
  private readonly hashResidency = new Map<string, { chunks: number; bytes: number }>();
  private readonly demandQueue: FetchTask[] = [];
  private readonly prefetchQueue: FetchTask[] = [];
  private readonly demandedHashes = new Set<string>();
  private readonly stoppedPrefetchHashes = new Set<string>();
  private activeDemand = 0;
  private activePrefetch = 0;
  private activeNetworkBytes = 0;
  private residentChunkCount = 0;
  private residentByteCount = 0;
  private residentReady: Promise<void> | null = null;
  private readonly touched = new Set<number>();
  private touchedDirty = false;
  private stopFlag = false;
  fetched = 0;

  constructor(opts: ChunkStoreOptions) {
    this.size = opts.size;
    this.chunkSize = opts.chunkSize;
    this.hashes = opts.chunkHashes;
    this.chunksDir = opts.chunksDir;
    this.compression = opts.compression ?? "none";
    this.fetchFn = opts.fetch ?? null;
    this.metrics = opts.metrics ?? null;
    this.bootListPath = opts.bootListPath ?? join(opts.chunksDir, "boot-chunks.json");
    for (const [index, hash] of this.hashes.entries()) {
      const current = this.hashResidency.get(hash) ?? { chunks: 0, bytes: 0 };
      current.chunks += 1;
      current.bytes += this.chunkByteLength(index);
      this.hashResidency.set(hash, current);
    }
  }

  chunkPath(hash: string): string {
    return join(this.chunksDir, hash);
  }

  chunkByteLength(index: number): number {
    return Math.min(this.chunkSize, this.size - index * this.chunkSize);
  }

  async isResidentHash(hash: string): Promise<boolean> {
    await this.initializeResidency();
    return this.residentHashes.has(hash);
  }

  async isResident(index: number): Promise<boolean> {
    const h = this.hashes[index];
    if (!h) return false;
    return this.isResidentHash(h);
  }

  async residentIndices(): Promise<number[]> {
    await this.initializeResidency();
    return this.hashes.flatMap((hash, index) =>
      this.residentHashes.has(hash) ? [index] : [],
    );
  }

  async residentBits(): Promise<Uint8Array> {
    return packResidentBits(this.hashes.length, await this.residentIndices());
  }

  async initializeResidency(): Promise<void> {
    if (!this.residentReady) {
      this.residentReady = readdir(this.chunksDir)
        .then((names) => {
          const wanted = new Set(this.hashes);
          for (const name of names) {
            if (wanted.has(name)) this.markResident(name);
          }
        })
        .catch((err: NodeJS.ErrnoException) => {
          if (err.code !== "ENOENT") throw err;
        });
    }
    await this.residentReady;
  }

  stop(): void {
    this.stopFlag = true;
    const stopped = new AppError("download_stopped", "background download stopped");
    for (const task of this.prefetchQueue.splice(0)) {
      this.stoppedPrefetchHashes.add(task.hash);
      task.reject(stopped);
    }
    this.updateQueueMetrics();
  }

  resume(): void {
    this.stopFlag = false;
  }

  get stopped(): boolean {
    return this.stopFlag;
  }

  /** One shared promise per content hash; rejected promises are dropped so retries work. */
  ensureHash(
    hash: string,
    expectedLength?: number,
    priority: ChunkPriority = "demand",
  ): Promise<Uint8Array> {
    if (priority === "demand") this.demandedHashes.add(hash);
    const existing = this.inflight.get(hash);
    if (
      priority === "demand" &&
      this.stoppedPrefetchHashes.delete(hash) &&
      existing
    ) {
      this.inflight.delete(hash);
      return this.ensureHash(hash, expectedLength, priority);
    }
    if (existing) {
      this.metrics?.count("cache.coalesced");
      if (priority === "demand") this.promoteFetch(hash);
      return existing;
    }

    const work = this.ensureHashInner(hash, expectedLength, priority).finally(
      () => {
        if (this.inflight.get(hash) === work) {
          this.inflight.delete(hash);
          this.demandedHashes.delete(hash);
        }
      },
    );
    this.inflight.set(hash, work);
    return work;
  }

  private async ensureHashInner(
    hash: string,
    expectedLength: number | undefined,
    priority: ChunkPriority,
  ): Promise<Uint8Array> {
    const path = this.chunkPath(hash);
    try {
      const st = await stat(path);
      if (st.isFile()) {
        if (expectedLength !== undefined && st.size !== expectedLength) {
          this.unmarkResident(hash);
          this.verifiedHashes.delete(hash);
          await unlink(path);
        } else {
          const readStarted = performance.now();
          const data = await readFile(path);
          this.metrics?.observe(
            "cache.diskRead",
            (performance.now() - readStarted) * 1_000,
          );
          this.metrics?.count("cache.diskBytes", data.byteLength);
          if (!this.verifiedHashes.has(hash)) {
            const verifyStarted = performance.now();
            verifyHash(hash, data);
            this.metrics?.observe(
              "cache.verify",
              (performance.now() - verifyStarted) * 1_000,
            );
            this.verifiedHashes.add(hash);
          }
          this.markResident(hash);
          this.metrics?.count("cache.diskHits");
          return data;
        }
      } else {
        this.unmarkResident(hash);
        this.verifiedHashes.delete(hash);
      }
    } catch (error) {
      this.unmarkResident(hash);
      this.verifiedHashes.delete(hash);
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        this.metrics?.count("cache.corruptChunks");
        await unlink(path).catch(() => undefined);
      }
    }
    if (!this.fetchFn) {
      throw new AppError("chunk_offline", `chunk ${hash} not cached, and offline`);
    }
    const scheduledPriority = this.demandedHashes.has(hash) ? "demand" : priority;
    const raw = await this.scheduleFetch(
      hash,
      expectedLength ?? 0,
      scheduledPriority,
    );
    this.metrics?.count("cache.networkFetches");
    this.metrics?.count("cache.networkBytes", raw.byteLength);
    const decodeStarted = performance.now();
    const data = await decodeChunk(raw, this.compression);
    this.metrics?.observe("cache.decode", (performance.now() - decodeStarted) * 1_000);
    const hashStarted = performance.now();
    verifyHash(hash, data);
    this.metrics?.observe("cache.hash", (performance.now() - hashStarted) * 1_000);
    if (expectedLength !== undefined && data.byteLength !== expectedLength) {
      throw new AppError(
        "chunk_length",
        `chunk ${hash} length ${data.byteLength}, expected ${expectedLength}`,
      );
    }
    const writeStarted = performance.now();
    await writeAtomicInDir(this.chunksDir, hash, data);
    this.metrics?.observe("cache.write", (performance.now() - writeStarted) * 1_000);
    this.markResident(hash);
    this.verifiedHashes.add(hash);
    this.fetched += 1;
    return data;
  }

  ensureChunk(
    index: number,
    priority: ChunkPriority = "demand",
  ): Promise<Uint8Array> {
    const hash = this.hashes[index];
    if (!hash) throw new AppError("chunk_index", `chunk index ${index} out of range`);
    return this.ensureHash(hash, this.chunkByteLength(index), priority);
  }

  async readRange(
    offset: number,
    length: number,
    priority: ChunkPriority = "demand",
  ): Promise<Uint8Array> {
    if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(length)) {
      throw new AppError("bad_range", "offset and length must be safe integers");
    }
    if (offset < 0 || length <= 0) {
      throw new AppError("bad_range", "offset must be >= 0 and length > 0");
    }
    if (offset + length > this.size) {
      throw new AppError("bad_range", "read exceeds snapshot size");
    }

    const first = Math.floor(offset / this.chunkSize);
    const last = Math.floor((offset + length - 1) / this.chunkSize);
    const indices = Array.from({ length: last - first + 1 }, (_, n) => first + n);
    for (const i of indices) {
      if (!this.touched.has(i)) {
        this.touched.add(i);
        this.touchedDirty = true;
      }
    }
    const chunks = await Promise.all(indices.map((i) => this.ensureChunk(i, priority)));

    if (first === last) {
      const data = chunks[0]!;
      const start = offset - first * this.chunkSize;
      return data.subarray(start, start + length);
    }

    const out = new Uint8Array(length);
    let pos = offset;
    let wrote = 0;
    for (const data of chunks) {
      const i = Math.floor(pos / this.chunkSize);
      const off = pos - i * this.chunkSize;
      const take = Math.min(length - wrote, data.length - off);
      out.set(data.subarray(off, off + take), wrote);
      pos += take;
      wrote += take;
    }
    return out;
  }

  private markResident(hash: string): void {
    if (this.residentHashes.has(hash)) return;
    this.residentHashes.add(hash);
    const added = this.hashResidency.get(hash);
    if (added) {
      this.residentChunkCount += added.chunks;
      this.residentByteCount += added.bytes;
      this.metrics?.gauge?.("cache.residentChunks", this.residentChunkCount);
      this.metrics?.gauge?.("cache.residentBytes", this.residentByteCount);
    }
  }

  private unmarkResident(hash: string): void {
    if (!this.residentHashes.delete(hash)) return;
    const removed = this.hashResidency.get(hash);
    if (removed) {
      this.residentChunkCount -= removed.chunks;
      this.residentByteCount -= removed.bytes;
      this.metrics?.gauge?.("cache.residentChunks", this.residentChunkCount);
      this.metrics?.gauge?.("cache.residentBytes", this.residentByteCount);
    }
  }

  private scheduleFetch(
    hash: string,
    expectedLength: number,
    priority: ChunkPriority,
  ): Promise<Uint8Array> {
    return new Promise((resolve, reject) => {
      const task: FetchTask = {
        hash,
        expectedLength,
        priority,
        queuedAt: performance.now(),
        resolve,
        reject,
      };
      (priority === "demand" ? this.demandQueue : this.prefetchQueue).push(task);
      this.updateQueueMetrics();
      this.drainFetchQueue();
    });
  }

  private promoteFetch(hash: string): void {
    const index = this.prefetchQueue.findIndex((task) => task.hash === hash);
    if (index < 0) return;
    const [task] = this.prefetchQueue.splice(index, 1);
    task!.priority = "demand";
    this.demandQueue.push(task!);
    this.metrics?.count("cache.queuePromotions");
    this.updateQueueMetrics();
  }

  private drainFetchQueue(): void {
    while (this.activeDemand + this.activePrefetch < PREFETCH_JOBS) {
      const task = this.demandQueue.shift() ?? this.prefetchQueue.shift();
      if (!task) break;
      if (task.priority === "prefetch" && this.stopFlag) {
        task.reject(new AppError("download_stopped", "background download stopped"));
        continue;
      }
      if (task.priority === "demand") this.activeDemand += 1;
      else this.activePrefetch += 1;
      this.activeNetworkBytes += task.expectedLength;
      this.metrics?.observe(
        "cache.queueWait",
        (performance.now() - task.queuedAt) * 1_000,
      );
      this.metrics?.observe(
        `cache.${task.priority}QueueWait`,
        (performance.now() - task.queuedAt) * 1_000,
      );
      this.updateQueueMetrics();
      void this.fetchFn!(task.hash)
        .then(task.resolve, task.reject)
        .finally(() => {
          if (task.priority === "demand") this.activeDemand -= 1;
          else this.activePrefetch -= 1;
          this.activeNetworkBytes -= task.expectedLength;
          this.updateQueueMetrics();
          this.drainFetchQueue();
        });
    }
  }

  private updateQueueMetrics(): void {
    const queueDepth = this.demandQueue.length + this.prefetchQueue.length;
    this.metrics?.gauge?.("snapshot.native.activeDemand", this.activeDemand);
    this.metrics?.gauge?.("snapshot.native.activePrefetch", this.activePrefetch);
    this.metrics?.gauge?.("snapshot.native.queuedDemand", this.demandQueue.length);
    this.metrics?.gauge?.("snapshot.native.queuedPrefetch", this.prefetchQueue.length);
    this.metrics?.gauge?.("snapshot.native.inFlightBytes", this.activeNetworkBytes);
    this.metrics?.peak?.("snapshot.native.peakQueueDepth", queueDepth);
  }

  get touchedIndices(): ReadonlySet<number> {
    return this.touched;
  }

  async saveTouched(): Promise<void> {
    if (!this.touchedDirty) return;
    let known = new Set<number>();
    try {
      const raw = JSON.parse(await readFile(this.bootListPath, "utf8")) as { chunks?: number[] };
      known = new Set(raw.chunks ?? []);
    } catch {
      // first write
    }
    const merged = [...new Set([...known, ...this.touched])].sort((a, b) => a - b);
    const prev = [...known].sort((a, b) => a - b);
    if (JSON.stringify(merged) !== JSON.stringify(prev)) {
      await writeAtomicJson(this.bootListPath, {
        chunkSize: this.chunkSize,
        count: this.hashes.length,
        chunks: merged,
      });
    }
    this.touchedDirty = false;
  }

  async prefetch(
    onProgress?: (p: PrefetchProgress) => void,
    jobs = PREFETCH_JOBS,
  ): Promise<void> {
    if (!this.fetchFn) return;
    let want: number[];
    try {
      const raw = JSON.parse(await readFile(this.bootListPath, "utf8")) as { chunks?: number[] };
      want = raw.chunks ?? [];
    } catch {
      return;
    }
    const todo: number[] = [];
    for (const i of want) {
      if (i < this.hashes.length && !(await this.isResident(i))) todo.push(i);
    }
    if (!todo.length) return;

    let done = 0;
    const total = todo.length;
    onProgress?.({ completedChunks: 0, totalChunks: total });
    await mapPool(
      todo,
      jobs,
      async (i) => {
        try {
          await this.ensureChunk(i, "prefetch");
        } catch {
          // game will ask again; prefetch miss is not fatal
        }
        done += 1;
        if (done % 8 === 0 || done === total) {
          onProgress?.({ completedChunks: done, totalChunks: total });
        }
      },
      () => this.stopFlag,
    );
    onProgress?.({
      completedChunks: this.stopFlag ? done : total,
      totalChunks: total,
    });
  }

  async downloadAll(opts: {
    onProgress?: (p: DownloadAllProgress) => void;
    jobs?: number;
    freeBytes?: () => Promise<number>;
  } = {}): Promise<boolean> {
    const jobs = opts.jobs ?? PREFETCH_JOBS;
    this.stopFlag = false;
    const todo: number[] = [];
    for (let i = 0; i < this.hashes.length; i++) {
      if (!(await this.isResident(i))) todo.push(i);
    }
    const total = this.size;

    if (!todo.length) {
      opts.onProgress?.({
        received: total,
        total,
        bytesPerSecond: 0,
        secondsRemaining: null,
      });
      return true;
    }

    const need = todo.reduce((n, i) => n + this.chunkByteLength(i), 0);
    const missingHashes = new Set<string>();
    const diskNeed = todo.reduce((bytes, index) => {
      const hash = this.hashes[index]!;
      if (missingHashes.has(hash)) return bytes;
      missingHashes.add(hash);
      return bytes + this.chunkByteLength(index);
    }, 0);
    let got = total - need;
    let free: number;
    if (opts.freeBytes) {
      free = await opts.freeBytes();
    } else {
      const fsStat = await statfs(this.chunksDir);
      free = Number(fsStat.bavail) * Number(fsStat.bsize);
    }
    if (free < diskNeed + FREE_MARGIN) {
      throw new AppError(
        "disk_full",
        `Not enough disk space: ${diskNeed} bytes needed, ${free} free.`,
      );
    }

    const started = Date.now();
    const baseline = got;
    let failed = 0;

    await mapPool(
      todo,
      jobs,
      async (i) => {
        const size = this.chunkByteLength(i);
        try {
          await this.ensureChunk(i, "prefetch");
        } catch {
          failed += 1;
          return;
        }
        got += size;
        const received = Math.min(got, total);
        const rate = bytesPerSecond(received - baseline, started);
        opts.onProgress?.({
          received,
          total,
          bytesPerSecond: rate,
          secondsRemaining: secondsRemaining(received, total, rate),
        });
      },
      () => this.stopFlag,
    );

    if (this.stopFlag) return false;
    if (failed) {
      throw new AppError(
        "download_partial",
        `${failed} chunks could not be downloaded. Restart to retry.`,
      );
    }
    return true;
  }
}
