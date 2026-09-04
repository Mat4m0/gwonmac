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
 * Certification is consumed, not re-derived: every launch starts without
 * transform authority, then the isolated verifier may supply one structural
 * answer carried through preparation. A build it cannot prove is served
 * untouched, including builds present in historic regression tables.
 */
import { net } from "electron";
import {
  type CacheInfo,
  type ClientCompatibility,
  type ClientHealthToken,
  type ClientSession,
  type DownloadActivity,
  type DownloadFailure,
  type ExtendedMemoryRuntimeStatus,
  type DownloadProgress,
  type DiagnosticProfile,
  type FullDownloadOutcome,
  type FullDownloadState,
  type NoticeCode,
  type RuntimeDiagnosticState,
  type SnapshotMetadata,
} from "../shared/contracts.js";
import {
  enhancementCapabilityProfile,
  enhancementCapabilitiesRequested,
  ENHANCEMENT_TRANSFORM_ABI,
  ENHANCEMENT_CAPABILITY_FIELDS,
  NO_ENHANCEMENT_CAPABILITIES,
  type EnhancementCapabilities,
  type EnhancementProgram,
} from "../shared/enhancement-contracts.js";
import { AppError, NotReadyError, errorCode } from "../shared/errors.js";
import { INITIAL_PROGRESS } from "../shared/progress.js";
import { certificationFromLocalVerification } from "./certification/client-certification.js";
import {
  PATCH_REQUEST_HEADERS,
  PATCH_REQUEST_TIMEOUT_MS,
  PATCH_ROOT,
  SNAPSHOT,
} from "./core/access-key.js";
import { ActiveClientSlot, type ActiveClient } from "./active-client.js";
import { pruneUnreferencedChunks } from "./core/chunk-cache.js";
import { readClientCacheInfo } from "./core/client-cache-info.js";
import { encodedChunkLimit } from "./core/chunk-format.js";
import { ChunkStore } from "./core/chunk-store.js";
import {
  prepareClientModule,
  type ClientCertification,
} from "./certification/client-module.js";
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
import {
  verifyCartographyLocally,
  verifyFriendObserverLocally,
  verifyClientLocally,
  verifyExtendedMemoryLocally,
  verifyNativeDoubleClickLocally,
} from "./certification/local-client-verifier-host.js";
import type {
  AnyLocalFeatureInvariant,
  LocalFeatureVerdicts,
} from "./certification/local-client-verification-contract.js";
import { extendedMemoryRuntimeStatus } from "./extended-memory-runtime.js";
import { supportedEnhancementCapabilities } from "./certification/enhancement-builds.js";
import { readClientRuntimeDiagnosticState } from "./client-runtime-diagnostics.js";
import { selectOfficialDiagnosticClient } from "./client-diagnostic-selection.js";
import {
  diagnosticDigest,
  optionalFeatureStatus,
  runtimeFeatureVerdicts,
} from "./client-runtime-values.js";

export type { ActiveClient } from "./active-client.js";

interface ClientRuntimeOptions {
  paths: GamePaths;
  hostVersion: string;
  cachedOnly: boolean;
  enhancementCapabilities: EnhancementCapabilities;
  enhancementProgram?: EnhancementProgram;
  cartographySpike?: boolean;
  extendedMemoryEnabled: boolean;
  diagnosticProfile: DiagnosticProfile;
  onProgress: (progress: DownloadProgress) => void;
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
    return this.activeSlot.current?.compatibility ?? null;
  }

  get healthToken(): ClientHealthToken | null {
    return this.candidateHealthToken;
  }

  get extendedMemory(): ExtendedMemoryRuntimeStatus | null {
    return this.activeSlot.current?.extendedMemory ?? null;
  }

  session(appVersion: string): ClientSession {
    const active = this.activeSlot.current;
    if (!active) {
      return {
        appVersion,
        compatibility: null,
        extendedMemory: null,
        healthToken: null,
      };
    }
    return {
      appVersion,
      compatibility: this.compatibility,
      extendedMemory: active.extendedMemory,
      healthToken: this.candidateHealthToken,
    };
  }

  get progress(): DownloadProgress {
    return this.progressValue;
  }

  get isDownloading(): boolean {
    return this.fullDownload !== null;
  }

  diagnosticState(): Promise<RuntimeDiagnosticState> {
    return readClientRuntimeDiagnosticState({
      active: this.activeSlot.current,
      paths: this.options.paths,
      diagnosticProfile: this.options.diagnosticProfile,
      extendedMemoryEnabled: this.options.extendedMemoryEnabled,
      enhancementCapabilities: this.options.enhancementCapabilities,
      enhancementProgram: this.options.enhancementProgram ?? "none",
    });
  }

  async snapshotMetadata(): Promise<SnapshotMetadata> {
    const store = this.activeSlot.current?.store;
    if (!store) {
      throw new NotReadyError("no active client snapshot is available");
    }
    return {
      size: store.size,
      chunkSize: store.chunkSize,
      chunkHashes: store.hashes,
      residentBits: await store.residentBits(),
    };
  }

  async cacheInfo(): Promise<CacheInfo> {
    return readClientCacheInfo(
      this.activeSlot.current?.store ?? null,
      this.options.paths.userData,
    );
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
    transforms: ActiveClient["transforms"];
    enhancementVerification: ActiveClient["enhancementVerification"];
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
        transforms: { templateSave: false, cartography: false, nativeDoubleClick: false },
        enhancementVerification: {
          requestedProfile: enhancementCapabilityProfile(this.options.enhancementCapabilities),
          effectiveProfile: null,
          preparationFailureStage: null,
          featureVerdicts: null,
        },
      };
    }

    const officialDiagnosticClient = selectOfficialDiagnosticClient({
      paths: this.options.paths,
      profile: this.options.diagnosticProfile,
      extendedMemoryEnabled: this.options.extendedMemoryEnabled,
    });
    if (officialDiagnosticClient) {
      return {
        ...officialDiagnosticClient,
        enhancementVerification: {
          requestedProfile: enhancementCapabilityProfile(this.options.enhancementCapabilities),
          effectiveProfile: null,
          preparationFailureStage: null,
          featureVerdicts: null,
        },
      };
    }

    let certification: ClientCertification = {
      templateSaveBuild: null,
      enhancementBuild: null,
    };
    const local = await verifyClientLocally({
      officialWasmPath: officialWasm,
      officialSha256,
      requestedCapabilities: this.options.enhancementCapabilities,
    });
    if (local) {
      certification = certificationFromLocalVerification(local);
      recordFeatureVerdicts(local.featureVerdicts);
      logEvent({ k: "wasm.localVerificationCompleted" });
    } else {
      logEvent({ k: "wasm.localVerificationUnavailable" });
    }
    const prepared = await prepareClientModule({
      officialWasmPath: officialWasm,
      officialJsPath: clientArtifactPath(this.options.paths.artifacts, "Gw.jspi.js"),
      officialSha256,
      certification,
      enhancementCapabilities: this.options.enhancementCapabilities,
      compatibilityCacheRoot: this.options.paths.compatibility,
      enhancementCacheRoot: this.options.paths.enhancements,
      friendObserver: {
        cacheRoot: this.options.paths.friendObserver,
        verifyLocally: verifyFriendObserverLocally,
      },
      ...(this.options.cartographySpike
        ? {
            cartographySpike: {
              cacheRoot: this.options.paths.cartographySpike,
              verifyLocally: verifyCartographyLocally,
            },
          }
        : {}),
      nativeDoubleClickCacheRoot: this.options.paths.nativeDoubleClick,
      extendedMemoryCacheRoot: this.options.paths.extendedMemory,
      extendedMemoryEnabled: this.options.extendedMemoryEnabled,
    }, verifyNativeDoubleClickLocally, verifyExtendedMemoryLocally);
    const preparationFailed = prepared.failure?.stage === "enhancement";
    const supported = prepared.enhancementBuild
      ? supportedEnhancementCapabilities(prepared.enhancementBuild)
      : NO_ENHANCEMENT_CAPABILITIES;
    const requested = prepared.requestedCapabilities;
    const effective = prepared.effectiveCapabilities;
    const compatibility: ClientCompatibility = {
      clientSha256: officialSha256,
      features: {
        gameFileSaving: prepared.gameFileSaving,
        nativeDoubleClick: prepared.nativeDoubleClick
          ? { status: "available" }
          : {
              status: "unavailable",
              reason: prepared.failure?.stage === "native-double-click"
                ? "preparation-failed"
                : "game-update",
            },
        nativeCursor: optionalFeatureStatus(
          requested.nativeCursor,
          effective.nativeCursor,
          supported.nativeCursor,
          preparationFailed,
        ),
        playRegionObservation: optionalFeatureStatus(
          requested.playRegionObservation,
          effective.playRegionObservation,
          supported.playRegionObservation,
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
          requested.teamApply,
          effective.teamApply,
          supported.teamApply,
          preparationFailed,
        ),
        travelAction: optionalFeatureStatus(
          requested.travelAction,
          effective.travelAction,
          supported.travelAction,
          preparationFailed,
        ),
        xunlaiAction: optionalFeatureStatus(
          requested.xunlaiAction,
          effective.xunlaiAction,
          supported.xunlaiAction,
          preparationFailed,
        ),
        chatAliases: optionalFeatureStatus(
          requested.chatAliases,
          effective.chatAliases,
          supported.chatAliases,
          preparationFailed,
        ),
        chatFiltering: optionalFeatureStatus(
          requested.chatFiltering,
          effective.chatFiltering,
          supported.chatFiltering,
          preparationFailed,
        ),
        skillSlotGeometry: optionalFeatureStatus(
          requested.skillSlotGeometry,
          effective.skillSlotGeometry,
          supported.skillSlotGeometry,
          preparationFailed,
        ),
        skillCooldownObservation: optionalFeatureStatus(
          requested.skillCooldownObservation,
          effective.skillCooldownObservation,
          supported.skillCooldownObservation,
          preparationFailed,
        ),
        playerEffectObservation: optionalFeatureStatus(
          requested.playerEffectObservation,
          effective.playerEffectObservation,
          supported.playerEffectObservation,
          preparationFailed,
        ),
        effectIconGeometry: optionalFeatureStatus(
          requested.effectIconGeometry,
          effective.effectIconGeometry,
          supported.effectIconGeometry,
          preparationFailed,
        ),
        preGameControls: optionalFeatureStatus(
          requested.preGameControls,
          effective.preGameControls,
          supported.preGameControls,
          preparationFailed,
        ),
        characterSwitchAction: optionalFeatureStatus(
          requested.characterSwitchAction,
          effective.characterSwitchAction,
          supported.characterSwitchAction,
          preparationFailed,
        ),
        quickItemMove: optionalFeatureStatus(
          requested.quickItemMove,
          effective.quickItemMove,
          supported.quickItemMove,
          preparationFailed,
        ),
      },
    };
    gauge("wasm.templateSaveCompatible", prepared.gameFileSaving.status === "available");
    const cartographyPrepared = prepared.cartography.status === "active";
    gauge("wasm.cartographyPrepared", cartographyPrepared);
    gauge("enhancement.effectiveCursor", effective.nativeCursor);
    gauge("enhancement.effectiveTargetObservation", effective.targetObservation);
    gauge("enhancement.effectivePartyObservation", effective.partyObservation);
    gauge("enhancement.effectiveTeamApply", effective.teamApply);
    gauge("enhancement.effectiveTravelAction", effective.travelAction);
    gauge("enhancement.effectiveXunlaiAction", effective.xunlaiAction);
    gauge("enhancement.effectiveChatAliases", effective.chatAliases);
    gauge("enhancement.effectiveChatFiltering", effective.chatFiltering);
    gauge("enhancement.effectiveQuickItemMove", effective.quickItemMove);
    gauge("enhancement.effectiveSkillSlotGeometry", effective.skillSlotGeometry);
    gauge(
      "enhancement.effectiveSkillCooldownObservation",
      effective.skillCooldownObservation,
    );

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
    if (prepared.cartography.status === "unavailable") {
      logEvent({
        k: "wasm.cartographyPrepareFailed",
        code: errorCode(prepared.cartography.error),
      });
    } else if (prepared.cartography.status === "active") {
      logEvent({ k: "wasm.cartographyPrepared" });
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
      transforms: {
        templateSave: prepared.gameFileSaving.status === "available",
        cartography: cartographyPrepared,
        nativeDoubleClick: prepared.nativeDoubleClick,
      },
      enhancementVerification: {
        requestedProfile: enhancementCapabilityProfile(requested),
        effectiveProfile: enhancementCapabilityProfile(effective),
        preparationFailureStage: prepared.failure?.stage
          ?? (local?.status === "template-refused" ? "template-save"
            : local?.status === "enhancement-refused" ? "enhancement" : null),
        featureVerdicts: runtimeFeatureVerdicts(local?.featureVerdicts ?? null),
      },
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
    clientFingerprint: string,
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
    const active: ActiveClient = this.activeSlot.publish({
      artifactsDir: this.options.paths.artifacts,
      clientFingerprint,
      store,
      wasmPath: enhancement.wasmPath,
      jsPath: enhancement.jsPath,
      compatibility: enhancement.compatibility,
      extendedMemory: enhancement.extendedMemory,
      transforms: enhancement.transforms,
      enhancementVerification: enhancement.enhancementVerification,
    });
    this.candidateHealthToken = candidateFingerprint
      ? Object.freeze({
          generation: active.generation,
          fingerprint: candidateFingerprint,
        })
      : null;
    if (previous && previous.store !== store) {
      previous.store.stop();
    }
    return active;
  }

  private async activateManifest(
    manifest: Manifest,
    clientFingerprint: string,
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
      clientFingerprint,
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
    if (!value.clientFingerprint) {
      throw new AppError("bad_manifest", "published client has no generation fingerprint");
    }
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
      value.clientFingerprint,
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
    fullDownload?: FullDownloadState,
  ): void {
    if (this.activeSlot.current?.generation !== active.generation) {
      throw new NotReadyError("ready progress requires the active client generation");
    }
    this.commitProgress({
      ...INITIAL_PROGRESS,
      phase: "ready",
      label,
      ...(noticeCode ? { noticeCode } : {}),
      ...(fullDownload ? { fullDownload } : {}),
    });
  }

  private clientReady(active: ActiveClient, noticeCode?: NoticeCode): void {
    this.publishReadyProgress(active, "Starting Guild Wars", noticeCode);
    void this.downloadAll();
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
            fingerprint: diagnosticDigest(rollback.fingerprint),
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
            fingerprint: diagnosticDigest(migrated.clientFingerprint),
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
          fingerprint: diagnosticDigest(result.fingerprint),
        });
        return;
      }
      const active = await this.activateManifest(
        result.manifest,
        result.fingerprint,
        result.candidate ? result.fingerprint : null,
      );
      await this.pruneChunkCache();
      this.clientReady(active);
      updateSpan.end({
        status: result.candidate ? "candidate" : "ready",
        code: null,
        fingerprint: diagnosticDigest(result.fingerprint),
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
      label: "Checking game files",
      fullDownload: { status: "running" },
    });
    let lastProgressLogAt = 0;
    let downloadStarted = false;
    const promise = active.store
      .downloadAll({
        onDownloadStart: ({ received, total }) => {
          downloadStarted = true;
          if (this.activeSlot.current?.generation !== active.generation) return;
          this.publishProgress({
            phase: "image",
            label: "Downloading full game",
            received,
            total,
            bytesPerSecond: 0,
            secondsRemaining: null,
            fullDownload: { status: "running" },
          });
        },
        onProgress: (value) => {
          if (this.activeSlot.current?.generation !== active.generation) return;
          this.publishProgress({
            phase: "image",
            label: downloadStarted ? "Downloading full game" : "Checking game files",
            received: value.received,
            total: value.total,
            bytesPerSecond: value.bytesPerSecond,
            secondsRemaining: value.secondsRemaining,
            fullDownload: { status: "running" },
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
          const label = !complete
            ? "Download stopped"
            : downloadStarted
              ? "Full game downloaded"
              : "Game files verified";
          this.publishReadyProgress(
            active,
            label,
            undefined,
            { status: complete ? "complete" : "paused" },
          );
        }
        return { status: complete ? "complete" : "stopped" };
      })
      .catch((error): FullDownloadOutcome => {
        const code = errorCode(error);
        logEvent({ k: "fullDownload.failed", code });
        if (this.activeSlot.current?.generation === active.generation) {
          this.publishReadyProgress(
            active,
            "Download paused",
            undefined,
            { status: "failed", errorCode: code },
          );
        }
        return { status: "failed", errorCode: code };
      })
      .finally(() => {
        this.fullDownload = null;
      });
    this.fullDownload = { store: active.store, promise };
    return promise;
  }

  async stopDownload(): Promise<void> {
    const download = this.fullDownload;
    if (!download) return;
    logEvent({ k: "fullDownload.stopRequested" });
    if (this.progressValue.phase === "image") {
      this.commitProgress({
        ...this.progressValue,
        fullDownload: { status: "stopping" },
      });
    }
    download.store.stop();
    await download.promise;
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
          fingerprint: diagnosticDigest(fingerprint),
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
        fingerprint: diagnosticDigest(rollback.fingerprint),
      });
    });
  }

  async shutdown(): Promise<void> {
    const update = this.gameUpdate;
    this.gameUpdateAbort?.abort(
      new Error("game client update interrupted for application shutdown"),
    );
    await update?.catch(() => undefined);
    const active = this.activeSlot.current;
    active?.store.stop();
  }
}

function recordFeatureVerdicts(verdicts: LocalFeatureVerdicts | null): void {
  if (!verdicts) return;
  for (const feature of ENHANCEMENT_CAPABILITY_FIELDS) {
    const verdict = verdicts[feature];
    logEvent({
      k: "enhancement.featureVerdict",
      feature,
      status: verdict.status === "not-requested" ? "off" : verdict.status,
      invariant: "invariant" in verdict
        ? verdict.invariant as AnyLocalFeatureInvariant
        : null,
      candidates: verdict.status === "ambiguous" ? verdict.candidates : null,
    });
  }
}
