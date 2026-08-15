/**
 * The client generation state machine: look for an update, download it, decide
 * what the resulting build may be transformed into, and publish exactly one
 * active client.
 *
 * `publishReadyProgress` is the only thing in the application permitted to
 * publish progress `phase: "ready"`. That phase means the main process has the
 * exact active client generation, which nothing outside this runtime can know;
 * published early, the renderer reads snapshot metadata before a client exists,
 * sees size 0, and streams the whole game over the network.
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
  type DownloadActivity,
  type DownloadFailure,
  type ExtendedMemoryRuntimeStatus,
  type OptionalFeatureStatus,
  type DownloadProgress,
  type FullDownloadOutcome,
  type NoticeCode,
  type PrefetchProgress,
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
  clearRejectedClient,
  confirmClientCandidate,
  readClientCandidate,
  readRejectedClient,
  rejectClientCandidate,
  restoreInvalidClientCandidate,
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
import { supportedEnhancementCapabilities } from "./certification/enhancement-builds.js";

export type { ActiveClient } from "./active-client.js";

/**
 * Client fingerprints are parsed as 64-hex where they are read, so this only
 * types the crossing into the diagnostics schema. It fails closed to `null`
 * rather than throwing: a broken invariant must not take down an update.
 */
function digestOrNull(value: string | null | undefined): Digest | null {
  return typeof value === "string" && isDigest(value) ? value : null;
}

function optionalFeatureStatus(
  requested: boolean,
  effective: boolean,
  supported: boolean,
  preparationFailed: boolean,
): OptionalFeatureStatus {
  if (!requested) return { status: "off" };
  if (effective) return { status: "available" };
  return {
    status: "unavailable",
    reason: supported && preparationFailed
      ? "preparation-failed"
      : "game-update",
  };
}

interface ClientRuntimeOptions {
  paths: GamePaths;
  hostVersion: string;
  cachedOnly: boolean;
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
  /** Exact candidate identity captured by a renderer before it loads glue. */
  private candidateHealthToken: ClientHealthToken | null = null;
  private readonly rendererFailedFeatures = new Set<
    Exclude<keyof ClientCompatibility["features"], "gameFileSaving">
  >();
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
    const compatibility = this.activeSlot.current?.compatibility ?? null;
    if (!compatibility || this.rendererFailedFeatures.size === 0) {
      return compatibility;
    }
    const effectiveStatus = <
      Feature extends Exclude<keyof ClientCompatibility["features"], "gameFileSaving">,
    >(feature: Feature): ClientCompatibility["features"][Feature] =>
      this.rendererFailedFeatures.has(feature)
        ? { status: "unavailable", reason: "preparation-failed" }
        : compatibility.features[feature];
    return Object.freeze({
      ...compatibility,
      features: Object.freeze({
        gameFileSaving: compatibility.features.gameFileSaving,
        nativeCursor: effectiveStatus("nativeCursor"),
        targetObservation: effectiveStatus("targetObservation"),
        partyObservation: effectiveStatus("partyObservation"),
        teamApply: effectiveStatus("teamApply"),
      }),
    });
  }

  recordRendererFeatureFailure(
    features: readonly Exclude<keyof ClientCompatibility["features"], "gameFileSaving">[],
  ): void {
    for (const feature of features) {
      if (this.activeSlot.current?.compatibility?.features[feature].status === "available") {
        this.rendererFailedFeatures.add(feature);
      }
    }
  }

  get healthToken(): ClientHealthToken | null {
    return this.candidateHealthToken;
  }

  get extendedMemory(): ExtendedMemoryRuntimeStatus | null {
    return this.activeSlot.current?.extendedMemory ?? null;
  }

  get progress(): DownloadProgress {
    return this.progressValue;
  }

  get isDownloading(): boolean {
    return this.fullDownload !== null;
  }

  private commitProgress(next: DownloadProgress): void {
    if (next.phase === "ready" && !this.activeSlot.current) {
      throw new NotReadyError("ready progress requires an active client");
    }
    this.progressValue = next;
    this.options.onProgress(next);
  }

  private publishProgress(
    next: DownloadFailure | (DownloadActivity & {
      phase: Exclude<DownloadActivity["phase"], "ready">;
    }),
  ): void {
    this.commitProgress(next);
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
    compatibility: ClientCompatibility | null;
    extendedMemory: ExtendedMemoryRuntimeStatus;
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
      gauge("wasm.templateSaveCompatible", false);
      gauge("enhancement.supportedBuild", false);
      logEvent({ k: "wasm.clientHashUnavailable",
        code: errorCode(error),
      });
      const extendedMemory = extendedMemoryRuntimeStatus(
        this.options.extendedMemoryEnabled
          ? { status: "unavailable", reason: "unsupported-client" }
          : { status: "disabled" },
      );
      return {
        wasmPath: officialWasm,
        jsPath: clientArtifactPath(this.options.paths.artifacts, "Gw.jspi.js"),
        compatibility: null,
        extendedMemory,
      };
    }

    let certification = certifyClientBuild(officialSha256);
    if (
      certification.templateSaveBuild === null
      || (
        certification.enhancementBuild === null
        && this.options.enhancementCapabilities.nativeCursor
      )
    ) {
      const local = await verifyClientLocally({
        officialWasmPath: officialWasm,
        officialSha256,
      });
      if (local) {
        certification = certificationFromLocalVerification(local);
        logEvent({ k: "wasm.localVerificationCompleted" });
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
    const preparationFailed = prepared.failure?.stage === "enhancement";
    const supported = prepared.enhancementBuild
      ? supportedEnhancementCapabilities(prepared.enhancementBuild)
      : {
          nativeCursor: false,
          targetObservation: false,
          partyObservation: false,
          commands: false,
        };
    const requested = prepared.requestedCapabilities;
    const effective = prepared.effectiveCapabilities;
    const compatibility: ClientCompatibility = {
      clientSha256: officialSha256,
      features: {
        gameFileSaving: prepared.gameFileSaving,
        nativeCursor: optionalFeatureStatus(
          requested.nativeCursor,
          effective.nativeCursor,
          supported.nativeCursor,
          preparationFailed,
        ),
        targetObservation: optionalFeatureStatus(
          requested.targetObservation,
          effective.targetObservation,
          supported.targetObservation,
          preparationFailed,
        ),
        partyObservation: optionalFeatureStatus(
          requested.partyObservation,
          effective.partyObservation,
          supported.partyObservation,
          preparationFailed,
        ),
        teamApply: optionalFeatureStatus(
          requested.commands,
          effective.commands,
          supported.commands,
          preparationFailed,
        ),
      },
    };
    gauge("wasm.templateSaveCompatible", prepared.gameFileSaving.status === "available");
    gauge("enhancement.effectiveCursor", effective.nativeCursor);
    gauge("enhancement.effectiveTargetObservation", effective.targetObservation);
    gauge("enhancement.effectivePartyObservation", effective.partyObservation);
    gauge("enhancement.effectiveCommands", effective.commands);

    if (prepared.failure?.stage === "template-save") {
      logEvent({ k: "wasm.templateSavePrepareFailed",
        code: errorCode(prepared.failure.error),
      });
    } else {
      logEvent({
        k: prepared.gameFileSaving.status === "unavailable"
          ? "wasm.templateSaveUnsupported"
          : "wasm.templateSavePrepared",
      });
    }

    if (prepared.failure?.stage === "enhancement") {
      logEvent({ k: "enhancement.prepareFailed",
        code: errorCode(prepared.failure.error),
      });
    }
    if (prepared.failure?.stage === "native-double-click") {
      logEvent({ k: "wasm.nativeDoubleClickPrepareFailed",
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
      && !enhancementCapabilitiesRequested(prepared.effectiveCapabilities)
    ) {
      logEvent({ k: "enhancement.uncertifiedClientBlocked" });
    }
    gauge("enhancement.supportedBuild", prepared.enhancementBuild !== null);
    const extendedMemory = extendedMemoryRuntimeStatus(prepared.extendedMemory);
    const extendedCap = extendedMemory.effectiveCapBytes;
    const fallbackReason = extendedMemory.fallbackReason;
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
      compatibility,
      extendedMemory,
    };
  }

  private async recordResidency(store: ChunkStore): Promise<void> {
    const residentIndices = await store.residentIndices();
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
  }

  private async activateStore(
    store: ChunkStore,
    candidateFingerprint: string | null = null,
  ): Promise<ActiveClient> {
    this.initialResidencyRecorded = false;
    const [enhancement] = await Promise.all([
      this.selectClientWasm(),
      this.recordResidency(store),
    ]);
    const previous = this.activeSlot.current;
    // Renderer installation failures belong to one served generation. A retry
    // or game update prepares a fresh session and must get a fresh attempt.
    this.rendererFailedFeatures.clear();
    const active: ActiveClient = this.activeSlot.publish({
      artifactsDir: this.options.paths.artifacts,
      store,
      wasmPath: enhancement.wasmPath,
      jsPath: enhancement.jsPath,
      compatibility: enhancement.compatibility,
      extendedMemory: enhancement.extendedMemory,
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
    const candidate = await readClientCandidate(this.options.paths.artifacts);
    return this.activateStore(
      this.createStore(
        value.size,
        value.chunkSize,
        value.chunkHashes,
        value.compressionMode,
      ),
      candidate.status === "pending" &&
        candidate.fingerprint === value.clientFingerprint
        ? candidate.fingerprint
        : null,
    );
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

  private publishReadyProgress(
    active: ActiveClient,
    label: string,
    noticeCode?: NoticeCode,
  ): void {
    if (this.activeSlot.current?.generation !== active.generation) {
      throw new NotReadyError("ready progress requires the active client generation");
    }
    this.commitProgress({
      ...INITIAL_PROGRESS,
      phase: "ready",
      label,
      ...(noticeCode ? { noticeCode } : {}),
    });
  }

  private clientReady(active: ActiveClient, noticeCode?: NoticeCode): void {
    this.publishReadyProgress(active, "Starting Guild Wars", noticeCode);
    void active.store
      .prefetch((progress) => {
        if (this.activeSlot.current?.generation === active.generation) {
          this.options.onPrefetch(progress);
        }
      })
      .then(() => {
        if (this.activeSlot.current?.generation !== active.generation) return;
        return this.recordResidency(active.store);
      })
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
    // The lock may have queued this operation behind recovery that activated a
    // client after requestUpdate's first check. Never rename the artifact alias
    // once any published generation can be serving from it.
    if (this.activeSlot.current) return;
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
      const installedCandidate = await readClientCandidate(
        this.options.paths.artifacts,
      );
      // A malformed marker cannot identify the candidate it protects. Prefer
      // the complete verified rollback generation. A valid pending marker is
      // deliberately preserved: closing the app is not evidence of failure.
      if (installedCandidate.status === "invalid") {
        const rollback = await restoreInvalidClientCandidate({
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
    // Once a generation is active its artifact paths may be in use by the
    // protocol handler. A patch publication renames those paths, so only the
    // initial no-client boot is allowed to run PatchClient.
    if (this.activeSlot.current) return Promise.resolve();
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

  async retryClient(relaunch: () => void): Promise<void> {
    // Retry is an explicit player decision. Clear only the small rejection
    // record; verified chunks, the rollback generation and user data remain.
    await clearRejectedClient(this.options.paths.rejectedClient);
    if (!this.activeSlot.current) return this.requestUpdate();
    this.publishProgress({
      ...INITIAL_PROGRESS,
      phase: "starting",
      label: "Restarting the game client",
    });
    try {
      relaunch();
    } catch (error) {
      this.publishProgress({ phase: "error", errorCode: errorCode(error) });
    }
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
        if (this.activeSlot.current?.generation === active.generation) {
          await this.recordResidency(active.store);
        }
        logEvent({
          k: complete ? "fullDownload.completed" : "fullDownload.stopped",
        });
        if (this.activeSlot.current?.generation === active.generation) {
          this.publishReadyProgress(
            active,
            complete ? "Full game downloaded" : "Download stopped",
          );
        }
        return { status: complete ? "complete" : "stopped" };
      })
      .catch((error): FullDownloadOutcome => {
        const code = errorCode(error);
        logEvent({ k: "fullDownload.failed", code });
        if (this.activeSlot.current?.generation === active.generation) {
          this.publishReadyProgress(active, "Download paused");
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
      const rollback = await rejectClientCandidate({
        artifacts: this.options.paths.artifacts,
        rejectedPath: this.options.paths.rejectedClient,
        hostVersion: this.options.hostVersion,
      });
      if (!rollback) {
        if (interruptedUpdate) {
          const active = this.activeSlot.current;
          if (active) {
            this.publishReadyProgress(
              active,
              "Starting Guild Wars",
              "interrupted-update-retryable",
            );
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
