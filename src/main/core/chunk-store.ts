/**
 * The resident chunk cache and the scheduler in front of it: what is on disk,
 * what is being fetched, and in which order.
 *
 * Concurrent readers of one content hash share a single in-flight promise, so a
 * chunk is never fetched twice at once, and every arriving chunk is hash-
 * verified before it is written — a wrong index or a corrupt response costs a
 * wasted fetch and never a wrong byte. Demand reads outrank queued prefetch and
 * the combined concurrency ceiling is ArenaNet's; do not raise it to make a
 * download feel faster.
 *
 * Local write failures that no retry can fix are separated from transport
 * faults here, because a full disk and an unreachable host need different
 * things from the player.
 */
import { readFile, readdir, stat, statfs, unlink } from "node:fs/promises";
import { join } from "node:path";
import { ARENANET_REQUEST_CEILING } from "../../shared/contracts.js";
import { AppError, type ErrorCode } from "../../shared/errors.js";
import {
  DownloadRateAverage,
  secondsRemaining,
} from "../../shared/progress.js";
import { mapPool } from "./async-pool.js";
import { writeAtomicInDir } from "./atomic-file.js";
import { decodeChunk, verifyChunkHash } from "./chunk-format.js";
import type { CompressionMode } from "./manifest.js";
import { packResidentBits } from "./snapshot.js";

/**
 * The full download must fit with this much left over. Exported so the
 * advisory `ClientRuntime.cacheInfo()` readout computes its shortfall against the
 * same number this preflight enforces.
 */
export const FREE_MARGIN = 512 * 1024 * 1024;
export type ChunkBytesFetcher = (
  hash: string,
  expectedLength: number,
) => Promise<Uint8Array>;

export interface ChunkStoreOptions {
  chunksDir: string;
  size: number;
  chunkSize: number;
  chunkHashes: string[];
  compression?: CompressionMode;
  fetch?: ChunkBytesFetcher | null;
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

function errorCode(error: unknown): string {
  return error instanceof Error && "code" in error
    ? String(error.code)
    : "";
}

/**
 * Local write failures no retry can fix, and the code each one leaves the
 * store as. A bare Node errno used to escape here, and `errorCode()` collapses
 * anything that is not an `AppError` to "unknown" — which lost the one
 * download failure with a concrete user action, in the export as well as in
 * the launcher. `disk_full` keeps its own code; the other two have no member
 * of the catalogue and say so.
 */
const FATAL_LOCAL_WRITE: Record<string, ErrorCode> = {
  ENOSPC: "disk_full",
  EDQUOT: "disk_full",
  EACCES: "unknown",
  EROFS: "unknown",
};

export class ChunkStore {
  readonly size: number;
  readonly chunkSize: number;
  readonly hashes: string[];
  readonly chunksDir: string;
  readonly compression: CompressionMode;

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

  private async verifyResident(index: number): Promise<boolean> {
    const hash = this.hashes[index];
    if (!hash || !this.residentHashes.has(hash)) return false;
    const path = this.chunkPath(hash);
    try {
      const data = await readFile(path);
      if (data.byteLength !== this.chunkByteLength(index)) {
        throw new AppError("chunk_length", `cached chunk ${hash} has invalid length`);
      }
      verifyChunkHash(hash, data);
      this.verifiedHashes.add(hash);
      return true;
    } catch {
      this.unmarkResident(hash);
      this.verifiedHashes.delete(hash);
      this.metrics?.count("cache.corruptChunks");
      await unlink(path).catch(() => undefined);
      return false;
    }
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
            verifyChunkHash(hash, data);
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
    if (expectedLength === undefined) {
      throw new AppError("chunk_length", `missing expected length for ${hash}`);
    }
    const data = await decodeChunk(raw, this.compression, expectedLength);
    this.metrics?.observe("cache.decode", (performance.now() - decodeStarted) * 1_000);
    const hashStarted = performance.now();
    verifyChunkHash(hash, data);
    this.metrics?.observe("cache.hash", (performance.now() - hashStarted) * 1_000);
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
    while (this.activeDemand + this.activePrefetch < ARENANET_REQUEST_CEILING) {
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
      void this.fetchFn!(task.hash, task.expectedLength)
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

  async downloadAll(opts: {
    onProgress?: (p: DownloadAllProgress) => void;
    jobs?: number;
    freeBytes?: () => Promise<number>;
  } = {}): Promise<boolean> {
    const jobs = opts.jobs ?? ARENANET_REQUEST_CEILING;
    this.stopFlag = false;
    await this.initializeResidency();
    const residentRepresentatives = new Map<string, number>();
    for (let index = 0; index < this.hashes.length; index++) {
      const hash = this.hashes[index]!;
      if (this.residentHashes.has(hash) && !residentRepresentatives.has(hash)) {
        residentRepresentatives.set(hash, index);
      }
    }
    await mapPool(
      [...residentRepresentatives.values()],
      jobs,
      async (index) => {
        await this.verifyResident(index);
      },
      () => this.stopFlag,
    );
    if (this.stopFlag) return false;
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
    const rateAverage = new DownloadRateAverage(baseline, started);
    let firstFailure: unknown;
    let fatalFailure: { error: unknown; code: ErrorCode } | undefined;

    await mapPool(
      todo,
      jobs,
      async (i) => {
        const size = this.chunkByteLength(i);
        try {
          await this.ensureChunk(i, "prefetch");
        } catch (error) {
          firstFailure ??= error;
          const code = FATAL_LOCAL_WRITE[errorCode(error)];
          if (code) fatalFailure ??= { error, code };
          return;
        }
        got += size;
        const received = Math.min(got, total);
        const rate = rateAverage.update(received);
        opts.onProgress?.({
          received,
          total,
          bytesPerSecond: rate,
          secondsRemaining: secondsRemaining(received, total, rate),
        });
      },
      () => this.stopFlag || firstFailure !== undefined,
    );

    if (fatalFailure) {
      throw new AppError(
        fatalFailure.code,
        "a game file could not be written to the chunk cache",
        { cause: fatalFailure.error },
      );
    }
    if (this.stopFlag) return false;
    if (firstFailure !== undefined) {
      throw new AppError(
        "download_partial",
        "The download could not continue. Resume to retry.",
        { cause: firstFailure },
      );
    }
    return true;
  }
}
