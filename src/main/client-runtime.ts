import { net } from "electron";
import type {
  ClientCompatibility,
  ClientCompatibilityState,
  DownloadProgress,
  PrefetchProgress,
  SnapshotMetadata,
} from "../shared/contracts.js";
import { errorCode } from "../shared/errors.js";
import { INITIAL_PROGRESS } from "../shared/progress.js";
import {
  certifyClientBuild,
  toolboxMayLoad,
} from "./client-certification.js";
import {
  ACCESS_KEY,
  PATCH_REQUEST_TIMEOUT_MS,
  PATCH_ROOT,
  SNAPSHOT,
  UA,
} from "./core/access-key.js";
import {
  ActiveClientSlot,
  type ActiveClient,
} from "./core/active-client.js";
import { pruneUnreferencedChunks } from "./core/chunk-cache.js";
import { encodedChunkLimit } from "./core/chunk-format.js";
import { ChunkStore } from "./core/chunk-store.js";
import {
  confirmClientCandidate,
  readRejectedClient,
  restoreUnconfirmedClient,
} from "./core/client-compatibility.js";
import { sha256File } from "./core/derived-wasm.js";
import type { Manifest } from "./core/manifest.js";
import { Mutex } from "./core/mutex.js";
import { PatchClient } from "./core/patch-client.js";
import {
  fetchPatchBytes,
  readBoundedResponse,
  type PatchFetch,
} from "./core/patch-transport.js";
import { clientArtifactPath, clientManifestPath } from "./core/paths.js";
import {
  migrateLegacyPublishedClientManifest,
  verifyPublishedClientArtifacts,
} from "./core/published-client.js";
import { fullDownloadFailureMessage } from "./core/recovery.js";
import { buildSnapshotMetadata } from "./core/snapshot.js";
import { prepareTemplateSaveClient } from "./core/template-save-client.js";
import {
  prepareToolboxClient,
  type PreparedToolboxClient,
} from "./core/toolbox-client.js";
import { TOOLBOX_TRANSFORM_ABI } from "./core/toolbox-transform.js";
import {
  count,
  gauge,
  log,
  logEvent,
  observe,
  peakGauge,
  span,
} from "./diagnostics.js";
import { type Digest, isDigest } from "./diagnostics/schema.js";
import type { GamePaths } from "./paths.js";

export type { ActiveClient } from "./core/active-client.js";

/**
 * Client fingerprints are parsed as 64-hex where they are read, so this only
 * types the crossing into the diagnostics schema. It fails closed to `null`
 * rather than throwing: a broken invariant must not take down an update.
 */
function digestOrNull(value: string | null | undefined): Digest | null {
  return typeof value === "string" && isDigest(value) ? value : null;
}

interface ClientRuntimeOptions {
  paths: GamePaths;
  hostVersion: string;
  cachedOnly: boolean;
  offlineShell: boolean;
  toolboxEnabled: boolean;
  onProgress: (progress: DownloadProgress) => void;
  onPrefetch: (progress: PrefetchProgress) => void;
}

export class ClientRuntime {
  private readonly activeSlot = new ActiveClientSlot();
  /** Held by every operation that moves a generation directory. */
  private readonly generationLock = new Mutex();
  private progressValue: DownloadProgress = { ...INITIAL_PROGRESS };
  private saveTouchedTimer: ReturnType<typeof setInterval> | null = null;
  private initialResidencyRecorded = false;
  /**
   * The store the download is actually driving, kept beside its promise. After
   * a generation swap it is no longer `activeSlot.current.store`, and stopping
   * the current one would stop the new client's prefetch instead.
   */
  private fullDownload: { store: ChunkStore; promise: Promise<boolean> } | null =
    null;
  private gameUpdate: Promise<void> | null = null;
  /**
   * Which of the three certification states this session is in. Set once per
   * generation, where the module it describes is chosen; `null` until a client
   * has been activated.
   */
  private compatibilityValue: ClientCompatibility | null = null;
  private candidateFrameReady = false;
  private candidateSocketReady = false;
  private candidateConfirmation: Promise<void> | null = null;

  constructor(private readonly options: ClientRuntimeOptions) {}

  get active(): ActiveClient | null {
    return this.activeSlot.current;
  }

  get compatibility(): ClientCompatibility | null {
    return this.compatibilityValue;
  }

  get progress(): DownloadProgress {
    return this.progressValue;
  }

  get isDownloading(): boolean {
    return this.fullDownload !== null;
  }

  private publishProgress(next: DownloadProgress): void {
    this.progressValue = next;
    this.options.onProgress(next);
  }

  private cdnChunkFetcher(compression: "none" | "gzip") {
    const headers = {
      "X-Access-Key": ACCESS_KEY,
      "User-Agent": UA,
      "Accept-Encoding": "identity",
    };
    const patchFetch: PatchFetch = async (url, init) => {
      const request: RequestInit = {
        redirect: "manual",
        signal: AbortSignal.timeout(PATCH_REQUEST_TIMEOUT_MS),
      };
      if (init?.headers) request.headers = init.headers;
      const response = await net.fetch(url, request);
      return {
        status: response.status,
        body: await readBoundedResponse(response, init?.maxBytes ?? 1),
      };
    };
    return async (hash: string, expectedLength: number) =>
      fetchPatchBytes({
        fetch: patchFetch,
        url: `${PATCH_ROOT}/${hash}.bin`,
        headers,
        maxBytes: encodedChunkLimit(expectedLength, compression),
        onAttempt: (durationMs) =>
          observe("cache.networkWire", durationMs * 1_000),
      });
  }

  private createStore(
    size: number,
    chunkSize: number,
    chunkHashes: string[],
    compression: "none" | "gzip",
  ): ChunkStore {
    return new ChunkStore({
      chunksDir: this.options.paths.chunks,
      size,
      chunkSize,
      chunkHashes,
      compression,
      bootListPath: this.options.paths.bootChunks,
      fetch: this.options.cachedOnly
        ? async () => {
            throw new Error("cached live probe cannot download missing chunks");
          }
        : this.cdnChunkFetcher(compression),
      metrics: { count, observe, gauge, peak: peakGauge },
    });
  }

  /**
   * The template-save client is the floor every launch lands on. Opting out
   * comes straight here, and an opted-in launch falls back here whenever the
   * Toolbox module cannot be produced, so an uncertified build or a failed
   * transform costs the cursor and nothing else.
   *
   * `null` means no derived module exists — the build is uncertified, or the
   * transform could not run — so this launch serves ArenaNet's own.
   */
  private async templateSaveWasm(
    officialWasm: string,
    officialSha256: string,
    certified: boolean,
  ): Promise<string | null> {
    try {
      const wasmPath = await prepareTemplateSaveClient(
        officialWasm,
        officialSha256,
        this.options.paths.compatibility,
      );
      log(
        "wasm",
        certified ? "info" : "warn",
        certified
          ? "wasm.templateSavePrepared"
          : "wasm.templateSaveUnsupported",
      );
      return certified ? wasmPath : null;
    } catch (error) {
      log("wasm", "warn", "wasm.templateSavePrepareFailed", {
        code: errorCode(error),
      });
      return null;
    }
  }

  private async selectClientWasm(): Promise<{
    wasmPath: string;
    build: PreparedToolboxClient["build"];
  }> {
    const officialWasm = clientArtifactPath(
      this.options.paths.artifacts,
      "Gw.jspi.wasm",
    );
    let officialSha256: string;
    try {
      officialSha256 = await sha256File(officialWasm);
    } catch (error) {
      // Nothing can be certified without the hash, so nothing is transformed.
      this.compatibilityValue = null;
      gauge("wasm.templateSaveCompatible", false);
      gauge("toolbox.supportedBuild", false);
      log("wasm", "warn", "wasm.clientHashUnavailable", {
        code: errorCode(error),
      });
      return { wasmPath: officialWasm, build: null };
    }

    const certification = certifyClientBuild(officialSha256);
    // The two transforms are independent rewrites of the same official module,
    // so the Toolbox one is layered on top of the template-save client rather
    // than replacing it. Opting in must never cost template save/load.
    const templateSaveWasm = await this.templateSaveWasm(
      officialWasm,
      officialSha256,
      certification.state !== "uncertified",
    );
    // A certified build whose transform failed to run is degraded exactly as
    // far as an uncertified one, and says so rather than claiming its label.
    const state: ClientCompatibilityState =
      templateSaveWasm === null ? "uncertified" : certification.state;
    this.compatibilityValue = {
      state,
      clientSha256: officialSha256,
      toolboxRequested: this.options.toolboxEnabled,
    };
    gauge("client.buildCertification", state);
    gauge("wasm.templateSaveCompatible", state !== "uncertified");

    if (this.options.toolboxEnabled && toolboxMayLoad(state)) {
      try {
        const prepared = await prepareToolboxClient(
          templateSaveWasm ?? officialWasm,
          this.options.paths.toolbox,
        );
        if (prepared.build) {
          gauge("toolbox.supportedBuild", true);
          log("wasm", "info", "toolbox.clientPrepared", {
            buildId: prepared.build.buildId,
            transformAbi: TOOLBOX_TRANSFORM_ABI,
          });
          return { wasmPath: prepared.wasmPath, build: prepared.build };
        }
        log("wasm", "info", "toolbox.unsupportedBuild");
      } catch (error) {
        log("wasm", "warn", "toolbox.prepareFailed", {
          code: errorCode(error),
        });
      }
    } else if (this.options.toolboxEnabled) {
      // The hard rule: an uncertified module never reaches the transform, so
      // the setting is not consulted a second time further down.
      log("wasm", "info", "toolbox.uncertifiedClientBlocked");
    }
    gauge("toolbox.supportedBuild", false);
    return { wasmPath: templateSaveWasm ?? officialWasm, build: null };
  }

  private async snapshotFor(store: ChunkStore): Promise<SnapshotMetadata> {
    const residentIndices = await store.residentIndices();
    const meta = buildSnapshotMetadata({
      size: store.size,
      chunkSize: store.chunkSize,
      chunkHashes: store.hashes,
      residentIndices,
    });
    const residentBytes = residentIndices.reduce(
      (total, index) => total + store.chunkByteLength(index),
      0,
    );
    gauge("cache.residentChunks", residentIndices.length);
    gauge("cache.residentBytes", residentBytes);
    gauge("cache.totalChunks", store.hashes.length);
    gauge("cache.totalBytes", store.size);
    if (!this.initialResidencyRecorded) {
      gauge("cache.initialResidentChunks", residentIndices.length);
      gauge("cache.initialResidentBytes", residentBytes);
      this.initialResidencyRecorded = true;
    }
    return meta;
  }

  private async activateStore(store: ChunkStore): Promise<ActiveClient> {
    this.initialResidencyRecorded = false;
    const [snapshotMeta, toolbox] = await Promise.all([
      this.snapshotFor(store),
      this.selectClientWasm(),
    ]);
    const previous = this.activeSlot.current;
    const active: ActiveClient = this.activeSlot.publish({
      artifactsDir: this.options.paths.artifacts,
      store,
      snapshotMeta,
      wasmPath: toolbox.wasmPath,
      toolboxBuild: toolbox.build,
    });
    this.candidateFrameReady = false;
    this.candidateSocketReady = false;
    if (this.saveTouchedTimer) clearInterval(this.saveTouchedTimer);
    this.saveTouchedTimer = setInterval(() => {
      if (this.activeSlot.current?.generation !== active.generation) return;
      void active.store.saveTouched().catch(() => undefined);
    }, 5_000);
    if (previous && previous.store !== store) {
      previous.store.stop();
      void previous.store.saveTouched().catch(() => undefined);
    }
    return active;
  }

  private async activateManifest(manifest: Manifest): Promise<ActiveClient> {
    const entry = manifest.entry(SNAPSHOT);
    if (!entry) throw new Error("client manifest has no snapshot");
    return this.activateStore(
      this.createStore(
        entry.size,
        manifest.chunkSize,
        entry.chunkHashes,
        manifest.compression,
      ),
    );
  }

  private async activatePublishedClient(): Promise<ActiveClient> {
    const value = await migrateLegacyPublishedClientManifest(
      this.options.paths.artifacts,
    );
    if (!value) throw new Error("no published client is available");
    if (
      (await verifyPublishedClientArtifacts(
        this.options.paths.artifacts,
        value,
      )) !== true
    ) {
      throw new Error("last published client failed integrity verification");
    }
    return this.activateStore(
      this.createStore(
        value.size,
        value.chunkSize,
        value.chunkHashes,
        value.compressionMode,
      ),
    );
  }

  private async refreshSnapshot(generation: number): Promise<void> {
    const active = this.activeSlot.current;
    if (!active || active.generation !== generation) return;
    const snapshotMeta = await this.snapshotFor(active.store);
    this.activeSlot.replaceSnapshot(generation, snapshotMeta);
  }

  private async pruneChunkCache(): Promise<void> {
    try {
      const removed = await pruneUnreferencedChunks({
        chunksDir: this.options.paths.chunks,
        currentManifest: clientManifestPath(this.options.paths.artifacts),
        previousManifest: clientManifestPath(
          this.options.paths.previousArtifacts,
        ),
      });
      if (removed.files > 0) {
        log("cache", "info", "cache.staleChunksRemoved", {
          files: removed.files,
          bytes: removed.bytes,
        });
      }
    } catch (error) {
      logEvent({
        k: "cache.staleChunkCleanupSkipped",
        code: errorCode(error),
      });
    }
  }

  private clientReady(active: ActiveClient, notice?: string): void {
    this.publishProgress({
      ...INITIAL_PROGRESS,
      phase: "ready",
      label: "Starting Guild Wars",
      ...(notice ? { notice } : {}),
    });
    void active.store
      .prefetch((progress) => {
        if (this.activeSlot.current?.generation === active.generation) {
          this.options.onPrefetch(progress);
        }
      })
      .then(() => this.refreshSnapshot(active.generation))
      .catch((error) =>
        logEvent({ k: "prefetch.failed", code: errorCode(error) }),
      );
  }

  private async activatePublishedAndReady(notice?: string): Promise<void> {
    const active = await this.activatePublishedClient();
    await this.pruneChunkCache();
    this.clientReady(active, notice);
  }

  private async runUpdate(): Promise<void> {
    if (this.options.offlineShell) {
      this.publishProgress({
        ...INITIAL_PROGRESS,
        phase: "ready",
        label: "Ready (offline shell)",
      });
      return;
    }
    if (this.options.cachedOnly) {
      try {
        await this.activatePublishedAndReady(
          "Live probe is using the existing cached client.",
        );
        gauge("update.usingCachedClient", true);
      } catch {
        this.publishProgress({
          ...INITIAL_PROGRESS,
          phase: "error",
          label: "Cached live probe blocked",
          error:
            "The cached client is incomplete. No ArenaNet update was started.",
        });
      }
      return;
    }

    const patchClient = new PatchClient({
      artifactsDir: this.options.paths.artifacts,
      chunksDir: this.options.paths.chunks,
      onProgress: (progress) => this.publishProgress(progress),
    });
    const updateSpan = span("update", "clientUpdate");
    try {
      const rollback = await restoreUnconfirmedClient({
        artifacts: this.options.paths.artifacts,
        rejectedPath: this.options.paths.rejectedClient,
        hostVersion: this.options.hostVersion,
      });
      if (rollback) {
        logEvent({
          k: "client.candidateRolledBack",
          fingerprint: digestOrNull(rollback.fingerprint),
        });
      }
      try {
        const migrated = await migrateLegacyPublishedClientManifest(
          this.options.paths.artifacts,
        );
        if (migrated) {
          logEvent({
            k: "client.integrityMetadataReady",
            fingerprint: digestOrNull(migrated.clientFingerprint),
          });
        }
      } catch (error) {
        logEvent({
          k: "client.integrityMigrationSkipped",
          code: errorCode(error),
        });
      }
      const blockedFingerprint = await readRejectedClient(
        this.options.paths.rejectedClient,
        this.options.hostVersion,
      );
      const result = await patchClient.update({ blockedFingerprint });
      if (result.blocked) {
        await this.activatePublishedAndReady(
          "A newer game client did not start successfully, so the last working client is being used.",
        );
        gauge("update.usingCachedClient", true);
        updateSpan.end(
          {
            status: "rejectedCandidateSkipped",
            fingerprint: result.fingerprint,
          },
          "warn",
        );
        return;
      }
      const active = await this.activateManifest(result.manifest);
      await this.pruneChunkCache();
      this.clientReady(active);
      updateSpan.end({
        status: result.candidate ? "candidate" : "ready",
        fingerprint: result.fingerprint,
      });
    } catch (error) {
      // Identify the failure by code, so comparing sessions does not depend on
      // matching English prose — and so no prose reaches the export.
      const code = errorCode(error);
      try {
        await this.activatePublishedAndReady(
          "The game client update failed, so the previous client was restored.",
        );
        logEvent({ k: "patch.updateFallback", code });
        gauge("update.usingCachedClient", true);
        updateSpan.end({ status: "cachedFallback", code }, "warn");
        return;
      } catch (fallbackError) {
        logEvent({
          k: "patch.updateFailed",
          code,
          fallbackCode: errorCode(fallbackError),
        });
      }
      updateSpan.end({ status: "error", code }, "error");
      this.publishProgress({
        ...INITIAL_PROGRESS,
        phase: "error",
        label: "Update failed",
        error:
          "ArenaNet is unavailable and no previous game client could be restored.",
      });
    }
  }

  requestUpdate(): Promise<void> {
    if (this.gameUpdate) return this.gameUpdate;
    this.publishProgress({
      ...INITIAL_PROGRESS,
      phase: "starting",
      label: "Checking the game client",
    });
    const operation = this.generationLock
      .run(() => this.runUpdate())
      .finally(() => {
        if (this.gameUpdate === operation) this.gameUpdate = null;
      });
    this.gameUpdate = operation;
    return operation;
  }

  async retryUpdate(): Promise<void> {
    await this.requestUpdate();
    if (this.progressValue.phase === "error") {
      throw new Error(
        this.progressValue.error ?? "The game client could not be prepared.",
      );
    }
  }

  downloadAll(): Promise<boolean> {
    if (this.fullDownload) return this.fullDownload.promise;
    const active = this.activeSlot.current;
    if (!active) {
      return Promise.reject(
        new Error("The game files are not ready yet. Try again in a moment."),
      );
    }
    active.store.resume();
    log("cache", "info", "fullDownload.started");
    this.publishProgress({
      ...INITIAL_PROGRESS,
      phase: "image",
      label: "Downloading full game",
    });
    let lastProgressLogAt = 0;
    const promise = active.store
      .downloadAll({
        onProgress: (value) => {
          if (this.activeSlot.current?.generation !== active.generation) return;
          this.publishProgress({
            phase: "image",
            label: "Downloading full game",
            received: value.received,
            total: value.total,
            bytesPerSecond: value.bytesPerSecond,
            secondsRemaining: value.secondsRemaining,
            error: null,
          });
          const now = Date.now();
          if (now - lastProgressLogAt >= 5_000) {
            lastProgressLogAt = now;
            log("cache", "info", "fullDownload.progress", {
              received: value.received,
              total: value.total,
              bytesPerSecond: value.bytesPerSecond,
              secondsRemaining: value.secondsRemaining,
            });
          }
        },
      })
      .then(async (complete) => {
        await this.refreshSnapshot(active.generation);
        log(
          "cache",
          "info",
          complete ? "fullDownload.completed" : "fullDownload.stopped",
        );
        if (this.activeSlot.current?.generation === active.generation) {
          this.publishProgress({
            ...INITIAL_PROGRESS,
            phase: "ready",
            label: complete ? "Full game downloaded" : "Download stopped",
          });
        }
        return complete;
      })
      .catch((error) => {
        logEvent({ k: "fullDownload.failed", code: errorCode(error) });
        if (this.activeSlot.current?.generation === active.generation) {
          this.publishProgress({
            ...INITIAL_PROGRESS,
            phase: "ready",
            label: "Download paused",
          });
        }
        throw new Error(fullDownloadFailureMessage(error), { cause: error });
      })
      .finally(() => {
        this.fullDownload = null;
      });
    this.fullDownload = { store: active.store, promise };
    return promise;
  }

  stopDownload(): void {
    const download = this.fullDownload;
    if (!download) return;
    log("cache", "info", "fullDownload.stopRequested");
    download.store.stop();
  }

  noteSocketOpen(): void {
    this.candidateSocketReady = true;
    void this.confirmCandidateIfReady().catch((error) => {
      logEvent({
        k: "client.candidatePromotionFailed",
        code: errorCode(error),
      });
    });
  }

  async noteFramePresented(): Promise<void> {
    this.candidateFrameReady = true;
    await this.confirmCandidateIfReady();
  }

  private confirmCandidateIfReady(): Promise<void> {
    if (!this.candidateFrameReady || !this.candidateSocketReady) {
      return Promise.resolve();
    }
    if (this.candidateConfirmation) return this.candidateConfirmation;
    this.candidateConfirmation = this.generationLock
      .run(async () => {
        const fingerprint = await confirmClientCandidate({
          artifacts: this.options.paths.artifacts,
          rejectedPath: this.options.paths.rejectedClient,
        });
        this.candidateFrameReady = false;
        this.candidateSocketReady = false;
        if (fingerprint) {
          await this.pruneChunkCache();
          logEvent({
            k: "client.candidatePromoted",
            fingerprint: digestOrNull(fingerprint),
          });
        }
      })
      .finally(() => {
        this.candidateConfirmation = null;
      });
    return this.candidateConfirmation;
  }

  recoverRendererCrash(): Promise<void> {
    return this.generationLock.run(async () => {
      const rollback = await restoreUnconfirmedClient({
        artifacts: this.options.paths.artifacts,
        rejectedPath: this.options.paths.rejectedClient,
        hostVersion: this.options.hostVersion,
      });
      if (!rollback) return;
      await this.activatePublishedAndReady();
      logEvent({
        k: "client.candidateRolledBackAfterRendererCrash",
        fingerprint: digestOrNull(rollback.fingerprint),
      });
    });
  }

  async shutdown(): Promise<void> {
    if (this.saveTouchedTimer) clearInterval(this.saveTouchedTimer);
    this.saveTouchedTimer = null;
    const active = this.activeSlot.current;
    active?.store.stop();
    await active?.store.saveTouched().catch(() => undefined);
  }
}
