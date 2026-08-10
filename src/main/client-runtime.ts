/**
 * The client generation state machine: look for an update, download it, decide
 * what the resulting build may be transformed into, and publish exactly one
 * active client.
 *
 * `clientReady` is the only thing in the application permitted to publish
 * progress `phase: "ready"`. That phase means the main process has an active
 * client, which nothing outside this runtime can know; published early, the
 * renderer reads snapshot metadata before a client exists, sees size 0, and
 * streams the whole game over the network.
 *
 * Every operation that moves a generation directory holds one lock for the
 * whole of its work. Update, candidate confirmation and crash rollback all
 * rename the same trees, and two of them interleaving at an await lets one
 * rename away a tree the other is still reading.
 *
 * Certification is consumed, not re-derived: the runtime asks once which state
 * a build is in and carries that one answer through preparation. Compiled facts
 * answer known builds; the isolated verifier may derive an exact structural
 * answer for an unknown one. A build neither path certifies is served untouched.
 */
import { net } from "electron";
import {
  type ClientCompatibility,
  type ClientHealthToken,
  type ExtendedMemoryRuntimeStatus,
  type DownloadProgress,
  type FullDownloadOutcome,
  type NoticeCode,
  type PrefetchProgress,
  type SnapshotMetadata,
} from "../shared/contracts.js";
import {
  enhancementCapabilitiesRequested,
  ENHANCEMENT_TRANSFORM_ABI,
  type EnhancementCapabilities,
} from "../shared/enhancement-contracts.js";
import { isDigest, type Digest } from "../shared/digest.js";
import { AppError, NotReadyError, errorCode } from "../shared/errors.js";
import { INITIAL_PROGRESS } from "../shared/progress.js";
import {
  certificationFromLocalVerification,
  certifyClientBuild,
} from "./certification/client-certification.js";
import {
  PATCH_REQUEST_HEADERS,
  PATCH_REQUEST_TIMEOUT_MS,
  PATCH_ROOT,
  SNAPSHOT,
} from "./core/access-key.js";
import {
  ActiveClientSlot,
  type ActiveClient,
} from "./active-client.js";
import { pruneUnreferencedChunks } from "./core/chunk-cache.js";
import { encodedChunkLimit } from "./core/chunk-format.js";
import { ChunkStore } from "./core/chunk-store.js";
import { prepareClientModule } from "./certification/client-module.js";
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
  createBoundedPatchFetch,
  fetchPatchBytes,
  type PatchFetch,
} from "./core/patch-transport.js";
import { clientArtifactPath, clientManifestPath } from "./core/paths.js";
import {
  migrateLegacyPublishedClientManifest,
  verifyPublishedClientArtifacts,
} from "./core/published-client.js";
import { buildSnapshotMetadata } from "./core/snapshot.js";
import {
  count,
  gauge,
  logEvent,
  observe,
  peakGauge,
  startClientUpdateSpan,
} from "./diagnostics.js";
import type { GamePaths } from "./paths.js";
import { verifyClientLocally } from "./certification/local-client-verifier-host.js";
import { extendedMemoryRuntimeStatus } from "./extended-memory-runtime.js";

export type { ActiveClient } from "./active-client.js";

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
  enhancementCapabilities: EnhancementCapabilities;
  extendedMemoryEnabled: boolean;
  onProgress: (progress: DownloadProgress) => void;
  onPrefetch: (progress: PrefetchProgress) => void;
}

export class ClientRuntime {
  private readonly activeSlot = new ActiveClientSlot();
  /**
   * Held by every operation that moves a generation directory. `update`,
   * candidate confirmation and crash rollback all rename `artifacts`,
   * `artifacts.previous` and `artifacts.failed`, and two of them interleaving
   * at an `await` lets one observe — or rename away — a tree the other had
   * half moved. The full download stays outside it.
   */
  private readonly generationLock = new Mutex();
  private progressValue: DownloadProgress = { ...INITIAL_PROGRESS };
  private saveTouchedTimer: ReturnType<typeof setInterval> | null = null;
  private initialResidencyRecorded = false;
  /**
   * The store the download is actually driving, kept beside its promise. After
   * a generation swap it is no longer `activeSlot.current.store`, and stopping
   * the current one would stop the new client's prefetch instead.
   */
  private fullDownload: {
    store: ChunkStore;
    promise: Promise<FullDownloadOutcome>;
  } | null = null;
  private gameUpdate: Promise<void> | null = null;
  private gameUpdateAbort: AbortController | null = null;
  /**
   * Which of the three certification states this session is in. Set once per
   * generation, where the module it describes is chosen; `null` until a client
   * has been activated.
   */
  private compatibilityValue: ClientCompatibility | null = null;
  private extendedMemoryValue: ExtendedMemoryRuntimeStatus | null = null;
  /** Exact candidate identity captured by a renderer before it loads glue. */
  private candidateHealthToken: ClientHealthToken | null = null;
  private readonly patchFetch: PatchFetch;

  constructor(private readonly options: ClientRuntimeOptions) {
    this.patchFetch = createBoundedPatchFetch(
      (url, init) => net.fetch(url, init),
      PATCH_REQUEST_TIMEOUT_MS,
    );
  }

  get active(): ActiveClient | null {
    return this.activeSlot.current;
  }

  get compatibility(): ClientCompatibility | null {
    return this.compatibilityValue;
  }

  get healthToken(): ClientHealthToken | null {
    return this.candidateHealthToken;
  }

  get extendedMemory(): ExtendedMemoryRuntimeStatus | null {
    return this.extendedMemoryValue;
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
    return async (hash: string, expectedLength: number) =>
      fetchPatchBytes({
        fetch: this.patchFetch,
        url: `${PATCH_ROOT}/${hash}.bin`,
        headers: PATCH_REQUEST_HEADERS,
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

  private async selectClientWasm(): Promise<{
    wasmPath: string;
    jsPath: string;
    build: ActiveClient["enhancementBuild"];
  }> {
    this.extendedMemoryValue = null;
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
      gauge("enhancement.supportedBuild", false);
      logEvent({ k: "wasm.clientHashUnavailable",
        code: errorCode(error),
      });
      this.extendedMemoryValue = extendedMemoryRuntimeStatus(
        this.options.extendedMemoryEnabled
          ? { status: "unavailable", reason: "unsupported-client" }
          : { status: "disabled" },
      );
      return {
        wasmPath: officialWasm,
        jsPath: clientArtifactPath(this.options.paths.artifacts, "Gw.jspi.js"),
        build: null,
      };
    }

    let certification = certifyClientBuild(officialSha256);
    if (certification.state === "uncertified") {
      const local = await verifyClientLocally({
        officialWasmPath: officialWasm,
        officialSha256,
        cachePath: this.options.paths.localClientVerification,
      });
      if (local) {
        certification = certificationFromLocalVerification(local.result);
        logEvent({
          k: "wasm.localVerificationCompleted",
          source: local.source,
          certification: certification.state,
        });
      } else {
        logEvent({ k: "wasm.localVerificationUnavailable" });
      }
    }
    const prepared = await prepareClientModule({
      officialWasmPath: officialWasm,
      officialJsPath: clientArtifactPath(this.options.paths.artifacts, "Gw.jspi.js"),
      officialSha256,
      certification,
      enhancementCapabilities: this.options.enhancementCapabilities,
      compatibilityCacheRoot: this.options.paths.compatibility,
      enhancementCacheRoot: this.options.paths.enhancements,
      nativeDoubleClickCacheRoot: this.options.paths.nativeDoubleClick,
      extendedMemoryCacheRoot: this.options.paths.extendedMemory,
      extendedMemoryEnabled: this.options.extendedMemoryEnabled,
    });
    const state = prepared.state;
    this.compatibilityValue = {
      state,
      clientSha256: officialSha256,
      enhancementActive: prepared.enhancementBuild !== null,
    };
    gauge("client.buildCertification", state);
    gauge("wasm.templateSaveCompatible", state !== "uncertified");

    if (prepared.failure?.stage === "template-save") {
      logEvent({ k: "wasm.templateSavePrepareFailed",
        code: errorCode(prepared.failure.error),
      });
    } else {
      logEvent({
        k: state === "uncertified"
          ? "wasm.templateSaveUnsupported"
          : "wasm.templateSavePrepared",
      });
    }

    if (prepared.failure?.stage === "enhancement") {
      logEvent({ k: "enhancement.prepareFailed",
        code: errorCode(prepared.failure.error),
      });
    }
    if (prepared.enhancementBuild) {
      logEvent({ k: "enhancement.clientPrepared",
        buildId: prepared.enhancementBuild.buildId,
        transformAbi: ENHANCEMENT_TRANSFORM_ABI,
      });
    } else if (
      enhancementCapabilitiesRequested(this.options.enhancementCapabilities)
      && state !== "certified"
    ) {
      logEvent({ k: "enhancement.uncertifiedClientBlocked" });
    }
    gauge("enhancement.supportedBuild", prepared.enhancementBuild !== null);
    this.extendedMemoryValue = extendedMemoryRuntimeStatus(prepared.extendedMemory);
    const extendedCap = this.extendedMemoryValue.effectiveCapBytes;
    const fallbackReason = this.extendedMemoryValue.fallbackReason;
    gauge("wasm.extendedMemoryMode", prepared.extendedMemory.status);
    gauge("wasm.heapCapBytes", extendedCap);
    logEvent({
      k: "wasm.extendedMemory",
      mode: prepared.extendedMemory.status,
      requested: this.options.extendedMemoryEnabled,
      profile: prepared.extendedMemory.status === "active"
        ? prepared.extendedMemory.profile
        : "none",
      capBytes: extendedCap,
      fallbackReason: fallbackReason ?? "none",
    });
    if (
      prepared.extendedMemory.status === "unavailable"
      && prepared.extendedMemory.reason === "preparation-failed"
    ) {
      logEvent({
        k: "wasm.extendedMemoryPrepareFailed",
        code: errorCode(prepared.extendedMemory.error),
      });
    }
    return {
      wasmPath: prepared.wasmPath,
      jsPath: prepared.jsPath,
      build: prepared.enhancementBuild,
    };
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

  private async activateStore(
    store: ChunkStore,
    candidateFingerprint: string | null = null,
  ): Promise<ActiveClient> {
    this.initialResidencyRecorded = false;
    const [snapshotMeta, enhancement] = await Promise.all([
      this.snapshotFor(store),
      this.selectClientWasm(),
    ]);
    const previous = this.activeSlot.current;
    const active: ActiveClient = this.activeSlot.publish({
      artifactsDir: this.options.paths.artifacts,
      store,
      snapshotMeta,
      wasmPath: enhancement.wasmPath,
      jsPath: enhancement.jsPath,
      enhancementBuild: enhancement.build,
    });
    this.candidateHealthToken = candidateFingerprint
      ? Object.freeze({
          generation: active.generation,
          fingerprint: candidateFingerprint,
        })
      : null;
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

  private async activateManifest(
    manifest: Manifest,
    candidateFingerprint: string | null = null,
  ): Promise<ActiveClient> {
    const entry = manifest.entry(SNAPSHOT);
    if (!entry) throw new Error("client manifest has no snapshot");
    return this.activateStore(
      this.createStore(
        entry.size,
        manifest.chunkSize,
        entry.chunkHashes,
        manifest.compression,
      ),
      candidateFingerprint,
    );
  }

  private async activatePublishedClient(): Promise<ActiveClient> {
    const value = await migrateLegacyPublishedClientManifest(
      this.options.paths.artifacts,
    );
    // Both failures are shown to a user, so both carry a code: the renderer
    // has a sentence for each, and "unknown" would have collapsed them into
    // the generic one.
    if (!value) throw new NotReadyError("no published client is available");
    if (
      (await verifyPublishedClientArtifacts(
        this.options.paths.artifacts,
        value,
      )) !== true
    ) {
      throw new AppError(
        "artifact_unverified",
        "last published client failed integrity verification",
      );
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
        logEvent({ k: "cache.staleChunksRemoved",
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

  private publishReadyProgress(noticeCode?: NoticeCode): void {
    this.publishProgress({
      ...INITIAL_PROGRESS,
      phase: "ready",
      label: "Starting Guild Wars",
      ...(noticeCode ? { noticeCode } : {}),
    });
  }

  private clientReady(active: ActiveClient, noticeCode?: NoticeCode): void {
    this.publishReadyProgress(noticeCode);
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

  private async activatePublishedAndReady(noticeCode?: NoticeCode): Promise<void> {
    const active = await this.activatePublishedClient();
    await this.pruneChunkCache();
    this.clientReady(active, noticeCode);
  }

  private async runUpdate(signal: AbortSignal): Promise<void> {
    if (signal.aborted) return;
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
        await this.activatePublishedAndReady("cached-live-probe");
        gauge("update.usingCachedClient", true);
      } catch (error) {
        this.publishProgress({ phase: "error", errorCode: errorCode(error) });
      }
      return;
    }

    const patchClient = new PatchClient({
      artifactsDir: this.options.paths.artifacts,
      chunksDir: this.options.paths.chunks,
      fetch: this.patchFetch,
      onProgress: (progress) => this.publishProgress(progress),
    });
    const updateSpan = startClientUpdateSpan();
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
      const result = await patchClient.update({ blockedFingerprint, signal });
      signal.throwIfAborted();
      if (result.blocked) {
        await this.activatePublishedAndReady("rejected-candidate-fallback");
        gauge("update.usingCachedClient", true);
        updateSpan.end({
          status: "rejectedCandidateSkipped",
          code: null,
          fingerprint: digestOrNull(result.fingerprint),
        });
        return;
      }
      const active = await this.activateManifest(
        result.manifest,
        result.candidate ? result.fingerprint : null,
      );
      await this.pruneChunkCache();
      this.clientReady(active);
      updateSpan.end({
        status: result.candidate ? "candidate" : "ready",
        code: null,
        fingerprint: digestOrNull(result.fingerprint),
      });
    } catch (error) {
      // Identify the failure by code, so comparing sessions does not depend on
      // matching English prose — and so no prose reaches the export.
      if (signal.aborted) {
        updateSpan.end({
          status: "cancelled",
          code: null,
          fingerprint: null,
        });
        return;
      }
      const code = errorCode(error);
      try {
        // An offline machine is not a failed update: the fallback is the app
        // working as designed, and the notice should say so.
        await this.activatePublishedAndReady(
          code === "net_offline"
            ? "offline-using-cached-client"
            : "update-failed-previous-restored",
        );
        logEvent({ k: "patch.updateFallback", code });
        gauge("update.usingCachedClient", true);
        updateSpan.end({
          status: "cachedFallback",
          code,
          fingerprint: null,
        });
        return;
      } catch (fallbackError) {
        logEvent({
          k: "patch.updateFailed",
          code,
          fallbackCode: errorCode(fallbackError),
        });
      }
      updateSpan.end({ status: "error", code, fingerprint: null });
      this.publishProgress({ phase: "error", errorCode: code });
    }
  }

  requestUpdate(): Promise<void> {
    if (this.gameUpdate) return this.gameUpdate;
    this.publishProgress({
      ...INITIAL_PROGRESS,
      phase: "starting",
      label: "Checking the game client",
    });
    const controller = new AbortController();
    this.gameUpdateAbort = controller;
    const operation = this.generationLock
      .run(() => this.runUpdate(controller.signal))
      .finally(() => {
        if (this.gameUpdate === operation) {
          this.gameUpdate = null;
          this.gameUpdateAbort = null;
        }
      });
    this.gameUpdate = operation;
    return operation;
  }

  /**
   * Resolves with the outcome; it does not reject. A rejection crosses IPC as
   * Electron's flattened message, so a rejected promise could only have
   * carried prose — which is how the sentence for a failed download came to be
   * written in the main process at all.
   */
  downloadAll(): Promise<FullDownloadOutcome> {
    if (this.fullDownload) return this.fullDownload.promise;
    const active = this.activeSlot.current;
    if (!active) {
      return Promise.resolve({ status: "failed", errorCode: "not_ready" });
    }
    active.store.resume();
    logEvent({ k: "fullDownload.started" });
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
          });
          const now = Date.now();
          if (now - lastProgressLogAt >= 5_000) {
            lastProgressLogAt = now;
            logEvent({ k: "fullDownload.progress",
              received: value.received,
              total: value.total,
              bytesPerSecond: value.bytesPerSecond,
              secondsRemaining: value.secondsRemaining,
            });
          }
        },
      })
      .then(async (complete): Promise<FullDownloadOutcome> => {
        await this.refreshSnapshot(active.generation);
        logEvent({
          k: complete ? "fullDownload.completed" : "fullDownload.stopped",
        });
        if (this.activeSlot.current?.generation === active.generation) {
          this.publishProgress({
            ...INITIAL_PROGRESS,
            phase: "ready",
            label: complete ? "Full game downloaded" : "Download stopped",
          });
        }
        return { status: complete ? "complete" : "stopped" };
      })
      .catch((error): FullDownloadOutcome => {
        const code = errorCode(error);
        logEvent({ k: "fullDownload.failed", code });
        if (this.activeSlot.current?.generation === active.generation) {
          this.publishProgress({
            ...INITIAL_PROGRESS,
            phase: "ready",
            label: "Download paused",
          });
        }
        return { status: "failed", errorCode: code };
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
    logEvent({ k: "fullDownload.stopRequested" });
    download.store.stop();
  }

  confirmCandidateHealthy(token: ClientHealthToken): Promise<void> {
    return this.generationLock.run(async () => {
      const expected = this.candidateHealthToken;
      if (
        !expected ||
        token.generation !== expected.generation ||
        token.fingerprint !== expected.fingerprint ||
        this.activeSlot.current?.generation !== expected.generation
      ) {
        return;
      }
      const fingerprint = await confirmClientCandidate({
        artifacts: this.options.paths.artifacts,
        rejectedPath: this.options.paths.rejectedClient,
        expectedFingerprint: expected.fingerprint,
      });
      if (this.candidateHealthToken === expected) {
        this.candidateHealthToken = null;
      }
      if (fingerprint) {
        await this.pruneChunkCache();
        logEvent({
          k: "client.candidatePromoted",
          fingerprint: digestOrNull(fingerprint),
        });
      }
    });
  }

  recoverRendererCrash(): Promise<void> {
    const updateController = this.gameUpdateAbort;
    const interruptedUpdate =
      updateController !== null && !updateController.signal.aborted;
    updateController?.abort(
      new Error("game client update interrupted for renderer recovery"),
    );
    return this.generationLock.run(async () => {
      const rollback = await restoreUnconfirmedClient({
        artifacts: this.options.paths.artifacts,
        rejectedPath: this.options.paths.rejectedClient,
        hostVersion: this.options.hostVersion,
      });
      if (!rollback) {
        if (interruptedUpdate) {
          const active = this.activeSlot.current;
          if (active) {
            this.publishReadyProgress("interrupted-update-retryable");
            return;
          }
          try {
            await this.activatePublishedAndReady("interrupted-update-retryable");
          } catch (error) {
            this.publishProgress({
              phase: "error",
              errorCode: errorCode(error),
            });
          }
        }
        return;
      }
      await this.activatePublishedAndReady();
      logEvent({
        k: "client.candidateRolledBackAfterRendererCrash",
        fingerprint: digestOrNull(rollback.fingerprint),
      });
    });
  }

  async shutdown(): Promise<void> {
    const update = this.gameUpdate;
    this.gameUpdateAbort?.abort(
      new Error("game client update interrupted for application shutdown"),
    );
    await update?.catch(() => undefined);
    if (this.saveTouchedTimer) clearInterval(this.saveTouchedTimer);
    this.saveTouchedTimer = null;
    const active = this.activeSlot.current;
    active?.store.stop();
    await active?.store.saveTouched().catch(() => undefined);
  }
}
