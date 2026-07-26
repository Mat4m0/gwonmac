import {
  copyFile,
  link,
  mkdir,
  open,
  readFile,
  rename,
  rm,
  stat,
} from "node:fs/promises";
import { join } from "node:path";
import type {
  DownloadActivity,
  DownloadProgress,
} from "../../shared/contracts.js";
import { AppError } from "../../shared/errors.js";
import {
  DownloadRateAverage,
  secondsRemaining,
} from "../../shared/progress.js";
import {
  ACCESS_KEY,
  CLIENT_ARTIFACTS,
  MAX_PATCH_MANIFEST_BYTES,
  PATCH_REQUEST_TIMEOUT_MS,
  PATCH_ROOT,
  PREFETCH_JOBS,
  REQUIRED_PATCH_FILES,
  SNAPSHOT,
  UA,
} from "./access-key.js";
import {
  writeAll,
  writeAtomicInDir,
  writeAtomicJson,
} from "./atomic-file.js";
import { mapPool } from "./async-pool.js";
import {
  clientFingerprint,
  clientGenerationPaths,
  markClientCandidate,
} from "./client-compatibility.js";
import {
  decodeChunk,
  encodedChunkLimit,
  verifyChunkHash,
} from "./chunk-format.js";
import { Manifest, type CompressionMode, type ManifestFileEntry } from "./manifest.js";
import {
  fetchPatchBytes,
  readBoundedResponse,
  type PatchFetch,
} from "./patch-transport.js";
import {
  clientArtifactPath,
  clientManifestPath,
  snapshotMetadataPath,
} from "./paths.js";
import {
  parsePublishedClientManifest,
  readPublishedClientManifest,
  verifyPublishedClientArtifacts,
} from "./published-client.js";
import {
  publishSnapshotIndex,
  snapshotIndexFormatReadable,
} from "./snapshot.js";

export type FetchLike = PatchFetch;

export interface PatchClientOptions {
  artifactsDir: string;
  chunksDir: string;
  patchRoot?: string;
  fetch?: FetchLike;
  jobs?: number;
  onProgress?: (p: DownloadProgress) => void;
  accessKey?: string;
  userAgent?: string;
  requestTimeoutMs?: number;
}

export interface PatchUpdateResult {
  manifest: Manifest;
  fingerprint: string;
  published: boolean;
  candidate: boolean;
  blocked: boolean;
}

function defaultFetch(requestTimeoutMs: number): FetchLike {
  return async (url, init) => {
    const req: RequestInit = {
      method: init?.method ?? "GET",
      redirect: "manual",
      signal: AbortSignal.timeout(requestTimeoutMs),
    };
    if (init?.headers) req.headers = init.headers;
    const res = await fetch(url, req);
    return {
      status: res.status,
      body: await readBoundedResponse(res, init?.maxBytes ?? MAX_PATCH_MANIFEST_BYTES),
    };
  };
}

export class PatchClient {
  private readonly artifactsDir: string;
  private readonly chunksDir: string;
  private readonly patchRoot: string;
  private readonly fetchFn: FetchLike;
  private readonly jobs: number;
  private readonly onProgress: ((p: DownloadProgress) => void) | undefined;
  private readonly headers: Record<string, string>;

  constructor(opts: PatchClientOptions) {
    this.artifactsDir = opts.artifactsDir;
    this.chunksDir = opts.chunksDir;
    this.patchRoot = opts.patchRoot ?? PATCH_ROOT;
    this.fetchFn =
      opts.fetch ?? defaultFetch(opts.requestTimeoutMs ?? PATCH_REQUEST_TIMEOUT_MS);
    this.jobs = opts.jobs ?? PREFETCH_JOBS;
    this.onProgress = opts.onProgress;
    this.headers = {
      "X-Access-Key": opts.accessKey ?? ACCESS_KEY,
      "User-Agent": opts.userAgent ?? UA,
      "Accept-Encoding": "identity",
      Connection: "keep-alive",
    };
  }

  /**
   * Download progress only. "ready" is not this class's to declare: the
   * launcher treats it as "the main process has an active client", which is
   * true only after ClientRuntime activates one. Emitting it here let the
   * renderer read snapshot metadata while there was still no active client,
   * get size 0, and silently stream the whole game over the network instead.
   */
  private emit(
    p: DownloadActivity & {
      phase: Exclude<DownloadActivity["phase"], "ready">;
    },
  ): void {
    this.onProgress?.(p);
  }

  async getBytes(
    url: string,
    options: { maxBytes: number; tries?: number },
  ): Promise<Uint8Array> {
    const request = {
      fetch: this.fetchFn,
      url,
      headers: this.headers,
      maxBytes: options.maxBytes,
    };
    return fetchPatchBytes(
      options.tries === undefined ? request : { ...request, tries: options.tries },
    );
  }

  async fetchManifest(): Promise<Manifest> {
    this.emit({
      phase: "checking",
      label: "Checking the game client",
      received: 0,
      total: 0,
      bytesPerSecond: 0,
      secondsRemaining: null,
    });
    const body = await this.getBytes(`${this.patchRoot}/manifest.json`, {
      maxBytes: MAX_PATCH_MANIFEST_BYTES,
    });
    let raw: unknown;
    try {
      raw = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(body));
    } catch (error) {
      throw new AppError("manifest_format", "invalid manifest JSON", { cause: error });
    }
    const manifest = new Manifest(raw);
    manifest.requireUniqueBasenames(REQUIRED_PATCH_FILES);
    return manifest;
  }

  private async chunkCached(hash: string, expectedLength: number): Promise<boolean> {
    const file = join(this.chunksDir, hash);
    try {
      const data = await readFile(file);
      if (data.byteLength !== expectedLength) {
        throw new AppError("chunk_length", `cached chunk ${hash} has invalid length`);
      }
      verifyChunkHash(hash, data);
      return true;
    } catch {
      await rm(file, { force: true }).catch(() => undefined);
      return false;
    }
  }

  private async storeChunk(
    hash: string,
    compression: CompressionMode,
    expectedLength: number,
  ): Promise<Uint8Array> {
    const data = await decodeChunk(
      await this.getBytes(`${this.patchRoot}/${hash}.bin`, {
        maxBytes: encodedChunkLimit(expectedLength, compression),
      }),
      compression,
      expectedLength,
    );
    verifyChunkHash(hash, data);
    await writeAtomicInDir(this.chunksDir, hash, data);
    return data;
  }

  private chunkBytes(entry: ManifestFileEntry, chunkSize: number, i: number): number {
    return Math.min(chunkSize, entry.size - i * chunkSize);
  }

  private async assembleFile(
    outPath: string,
    entry: ManifestFileEntry,
    compression: CompressionMode,
    progress: {
      got: number;
      total: number;
      rate: DownloadRateAverage;
      sizes: Map<string, number>;
    },
  ): Promise<void> {
    const hashes = entry.chunkHashes;
    const missing: string[] = [];
    for (let i = 0; i < hashes.length; i++) {
      const h = hashes[i]!;
      const expectedLength = progress.sizes.get(h);
      if (expectedLength === undefined) {
        throw new AppError("chunk_length", `missing expected length for ${h}`);
      }
      if (!(await this.chunkCached(h, expectedLength))) {
        missing.push(h);
      }
    }
    const unique = [...new Set(missing)];

    await mapPool(unique, this.jobs, async (h) => {
      const expectedLength = progress.sizes.get(h);
      if (expectedLength === undefined) {
        throw new AppError("chunk_length", `missing expected length for ${h}`);
      }
      await this.storeChunk(h, compression, expectedLength);
      progress.got += expectedLength;
      const rate = progress.rate.update(progress.got);
      this.emit({
        phase: "client",
        label: "Preparing files needed to start",
        received: progress.got,
        total: progress.total,
        bytesPerSecond: rate,
        secondsRemaining: secondsRemaining(progress.got, progress.total, rate),
      });
    });

    this.emit({
      phase: "client",
      label: "Preparing files needed to start",
      received: progress.got,
      total: progress.total,
      bytesPerSecond: 0,
      secondsRemaining: null,
    });

    const part = `${outPath}.part`;
    const file = await open(part, "w");
    try {
      // writeAll, not write: a short write here truncates the artifact and the
      // sync() below then durably commits the truncation.
      for (const h of hashes) {
        await writeAll(file, await readFile(join(this.chunksDir, h)));
      }
      await file.sync();
    } finally {
      await file.close();
    }
    await rename(part, outPath);
  }

  private async artifactMatches(
    outPath: string,
    entry: ManifestFileEntry,
    chunkSize: number,
  ): Promise<boolean> {
    let file;
    try {
      if ((await stat(outPath)).size !== entry.size) return false;
      file = await open(outPath, "r");
      for (let i = 0; i < entry.chunkHashes.length; i++) {
        const size = this.chunkBytes(entry, chunkSize, i);
        const data = Buffer.allocUnsafe(size);
        const { bytesRead } = await file.read(data, 0, size, i * chunkSize);
        if (bytesRead !== size) return false;
        const hash = entry.chunkHashes[i]!;
        verifyChunkHash(hash, data);
      }
      return true;
    } catch {
      return false;
    } finally {
      await file?.close();
    }
  }

  private async snapshotIndexesMatch(
    entry: ManifestFileEntry,
    manifest: Manifest,
  ): Promise<boolean> {
    try {
      const metadata = JSON.parse(
        await readFile(snapshotMetadataPath(this.artifactsDir), "utf8"),
      ) as Record<string, unknown>;
      const current = parsePublishedClientManifest(
        JSON.parse(
          await readFile(clientManifestPath(this.artifactsDir), "utf8"),
        ),
      );
      const hashes = JSON.stringify(entry.chunkHashes);
      const artifacts = CLIENT_ARTIFACTS.map((name) => {
        const artifact = manifest.entry(name);
        if (!artifact) throw new Error(`manifest is missing ${name}`);
        return {
          name,
          size: artifact.size,
          chunkHashes: artifact.chunkHashes,
        };
      });
      return (
        snapshotIndexFormatReadable(metadata.formatVersion) &&
        metadata.size === entry.size &&
        metadata.chunkSize === manifest.chunkSize &&
        JSON.stringify(metadata.chunkHashes) === hashes &&
        current.compressionMode === manifest.compression &&
        current.chunkSize === manifest.chunkSize &&
        current.snapshot === SNAPSHOT &&
        current.size === entry.size &&
        JSON.stringify(current.chunkHashes) === hashes &&
        current.clientFingerprint === clientFingerprint(manifest) &&
        JSON.stringify(current.artifacts) === JSON.stringify(artifacts)
      );
    } catch {
      return false;
    }
  }

  /**
   * The installed generation, read now. `valid` is not made redundant by the
   * pre-swap verification in `update()`: that proves a generation was intact
   * when it was promoted, while this is what is on disk today. It can differ
   * because the generation was promoted by an alpha build that had no such
   * gate, or because the bytes decayed since — the same reason `ChunkStore`
   * verifies on read. An unverifiable generation must not become a rollback
   * target, so `update()` keys `candidate` on this.
   */
  private async publishedGeneration(): Promise<{
    fingerprint: string | null;
    valid: boolean;
  }> {
    try {
      const manifest = parsePublishedClientManifest(
        JSON.parse(
          await readFile(clientManifestPath(this.artifactsDir), "utf8"),
        ),
      );
      return {
        fingerprint: manifest.clientFingerprint ?? null,
        valid:
          (await verifyPublishedClientArtifacts(this.artifactsDir, manifest)) ===
          true,
      };
    } catch {
      return { fingerprint: null, valid: false };
    }
  }

  private async recoverArtifactSwap(stage: string, backup: string): Promise<void> {
    let currentExists = true;
    try {
      await stat(this.artifactsDir);
    } catch {
      currentExists = false;
    }
    let backupExists = true;
    try {
      await stat(backup);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      backupExists = false;
    }
    const candidateExists =
      currentExists &&
      (await stat(clientGenerationPaths(this.artifactsDir).marker).then(
        () => true,
        () => false,
      ));
    if (backupExists && currentExists && !candidateExists) {
      await rm(backup, { recursive: true, force: true });
    } else if (backupExists && currentExists) {
      throw new AppError(
        "candidate_pending",
        "client candidate must be confirmed or rolled back before updating",
      );
    } else if (backupExists) {
      await rename(backup, this.artifactsDir);
    }
    await rm(stage, { recursive: true, force: true });
  }

  private async stageExisting(source: string, target: string): Promise<void> {
    try {
      await link(source, target);
    } catch {
      await copyFile(source, target);
    }
  }

  /** Fetch JSPI client artifacts and publish snapshot metadata; never assembles Gw.snapshot. */
  async update(options?: {
    blockedFingerprint?: string | null;
  }): Promise<PatchUpdateResult> {
    const generations = clientGenerationPaths(this.artifactsDir);
    const stage = generations.stage;
    const backup = generations.previous;
    await this.recoverArtifactSwap(stage, backup);
    await mkdir(this.chunksDir, { recursive: true });

    const mf = await this.fetchManifest();
    const fingerprint = clientFingerprint(mf);
    const previousGeneration = await this.publishedGeneration();
    if (
      fingerprint === options?.blockedFingerprint &&
      previousGeneration.valid
    ) {
      return {
        manifest: mf,
        fingerprint,
        published: false,
        candidate: false,
        blocked: true,
      };
    }
    const artifacts: {
      name: string;
      entry: ManifestFileEntry;
      current: string;
      staged: string;
      needsBuild: boolean;
    }[] = [];

    for (const name of CLIENT_ARTIFACTS) {
      const path = mf.find(name);
      if (!path) {
        throw new AppError("manifest_missing", `manifest is missing ${name}`);
      }
      const entry = mf.files[path]!;
      const current = clientArtifactPath(this.artifactsDir, name);
      artifacts.push({
        name,
        entry,
        current,
        staged: clientArtifactPath(stage, name),
        needsBuild: !(await this.artifactMatches(current, entry, mf.chunkSize)),
      });
    }
    const snapPath = mf.find(SNAPSHOT);
    if (!snapPath) {
      throw new AppError("manifest_missing", `manifest is missing ${SNAPSHOT}`);
    }
    const snapshotEntry = mf.files[snapPath]!;
    const wanted = artifacts.filter((artifact) => artifact.needsBuild);
    if (
      wanted.length === 0 &&
      (await this.snapshotIndexesMatch(snapshotEntry, mf))
    ) {
      return {
        manifest: mf,
        fingerprint,
        published: false,
        candidate: false,
        blocked: false,
      };
    }

    const sizes = new Map<string, number>();
    const missing = new Set<string>();
    let total = 0;
    for (const { entry } of wanted) {
      for (let i = 0; i < entry.chunkHashes.length; i++) {
        const h = entry.chunkHashes[i]!;
        const n = this.chunkBytes(entry, mf.chunkSize, i);
        sizes.set(h, n);
        if (!missing.has(h) && !(await this.chunkCached(h, n))) {
          missing.add(h);
          total += n;
        }
      }
    }
    const progress = {
      got: 0,
      total,
      rate: new DownloadRateAverage(),
      sizes,
    };

    if (total) {
      this.emit({
        phase: "client",
        label: "Preparing files needed to start",
        received: 0,
        total,
        bytesPerSecond: 0,
        secondsRemaining: null,
      });
    }

    let hadCurrent: boolean;
    let candidate: boolean;
    await mkdir(stage, { recursive: true });
    try {
      for (const artifact of artifacts) {
        if (artifact.needsBuild) {
          await this.assembleFile(
            artifact.staged,
            artifact.entry,
            mf.compression,
            progress,
          );
        } else {
          await this.stageExisting(artifact.current, artifact.staged);
        }
      }
      await publishSnapshotIndex(snapshotMetadataPath(stage), {
        size: snapshotEntry.size,
        chunkSize: mf.chunkSize,
        chunkHashes: snapshotEntry.chunkHashes,
      });
      const stagedManifest = clientManifestPath(stage);
      await writeAtomicJson(
        stagedManifest,
        parsePublishedClientManifest({
          clientFingerprint: fingerprint,
          artifacts: artifacts.map(({ name, entry }) => ({
            name,
            size: entry.size,
            chunkHashes: entry.chunkHashes,
          })),
          compressionMode: mf.compression,
          chunkSize: mf.chunkSize,
          snapshot: SNAPSHOT,
          size: snapshotEntry.size,
          chunkHashes: snapshotEntry.chunkHashes,
        }),
      );
      // Check the stage exactly as a later boot will read it: parse the manifest
      // back off disk and verify the artifacts against that. Assembly, hard
      // linking and rename each trust their own inputs, so this is the only step
      // that proves the bytes about to be promoted are the bytes the manifest
      // shipping beside them describes. The `finally` below removes the stage,
      // so failing here leaves the installed generation exactly as it was.
      if (
        (await verifyPublishedClientArtifacts(
          stage,
          await readPublishedClientManifest(stagedManifest),
        )) !== true
      ) {
        throw new AppError(
          "artifact_unverified",
          "staged client artifacts do not match the manifest that describes them",
        );
      }
      try {
        await stat(this.artifactsDir);
        hadCurrent = true;
      } catch {
        hadCurrent = false;
      }
      candidate =
        hadCurrent &&
        previousGeneration.valid &&
        previousGeneration.fingerprint !== fingerprint;
      if (hadCurrent) {
        if (candidate) await markClientCandidate(stage, fingerprint);
        await rm(backup, { recursive: true, force: true });
        await rename(this.artifactsDir, backup);
      }
      try {
        await rename(stage, this.artifactsDir);
      } catch (error) {
        if (hadCurrent) await rename(backup, this.artifactsDir);
        throw error;
      }
      if (hadCurrent && !candidate) {
        await rm(backup, { recursive: true, force: true });
      }
    } finally {
      await rm(stage, { recursive: true, force: true });
    }

    return {
      manifest: mf,
      fingerprint,
      published: true,
      candidate,
      blocked: false,
    };
  }
}
