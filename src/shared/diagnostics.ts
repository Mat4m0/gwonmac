/**
 * The vocabulary main and the renderer share when they talk about measurements:
 * levels, subsystems, histogram buckets, the renderer's metrics and milestones,
 * and the summary and report shapes an export carries.
 *
 * Every one of them is a closed union. A renderer failure crosses IPC as an
 * allow-listed name plus non-text fingerprints, never as console output, and a
 * metric that is not named here has no way to reach the recorder at all.
 *
 * The bucket boundaries are part of the contract, not a tuning constant: two
 * sessions can only be compared if their histograms were bucketed identically,
 * so changing them makes existing exports incomparable rather than merely
 * differently shaped.
 */
export type DiagnosticLevel = "debug" | "info" | "warn" | "error";

export type DiagnosticSubsystem =
  | "app"
  | "update"
  | "cache"
  | "protocol"
  | "snapshot"
  | "renderer"
  | "wasm"
  | "graphics"
  | "dns"
  | "socket"
  | "proxy"
  | "settings"
  | "credentials"
  | "steam"
  | "filesystem"
  | "release";

export type DiagnosticScalar = string | number | boolean | null;
export type DiagnosticFields = Record<string, DiagnosticScalar>;

export const RENDERER_EVENT_NAMES = [
  "renderer.windowError",
  "renderer.unhandledRejection",
  "graphics.contextLost",
  "graphics.contextRestored",
  "graphics.presentationFailed",
  "client.glueLoadFailed",
  "filesystem.persistenceFailed",
  "audio.resumeFailed",
  "pointerLock.failed",
  "snapshot.readFailed",
  "graphics.programCacheSaturated",
  "clipboard.copied",
  "clipboard.writeFailed",
] as const;

export type RendererEventName = (typeof RENDERER_EVENT_NAMES)[number];

export interface RendererDiagnosticEvent {
  timestampUs: number;
  name: RendererEventName;
  fingerprint?: string;
}

export const DIAGNOSTIC_BUCKETS_US = [
  100,
  250,
  500,
  1_000,
  2_000,
  4_000,
  8_000,
  12_000,
  16_667,
  25_000,
  33_333,
  50_000,
  100_000,
  250_000,
  500_000,
  1_000_000,
  5_000_000,
  Number.MAX_SAFE_INTEGER,
] as const;

/** One bucket per `DIAGNOSTIC_BUCKETS_US` limit, with the extremes and the sum
 * the buckets are too coarse to recover. The observation count is not here: it
 * is the bucket total, and it is also a counter of its own that other metrics
 * are expressed against. */
export interface DiagnosticHistogram {
  buckets: number[];
  totalUs: number;
  minUs: number;
  maxUs: number;
}

/**
 * The plain counters. The public type and the boundary predicate both derive
 * from this list, so a field cannot be declared without also being validated.
 */
const RENDERER_NUMERIC_METRICS = [
  "intervalMs",
  "rafCount",
  "rafOver33",
  "rafOver50",
  "swapCount",
  "presentationFailures",
  "submitIntervalCount",
  "visibleSubmitIntervalCount",
  "hiddenSubmitIntervalCount",
  "snapshotReads",
  "snapshotBytes",
  "snapshotMemoryReads",
  "memoryHits",
  "nativeHits",
  "coalesced",
  "glProgramQueryHits",
  "glProgramQueryMisses",
  "memoryCacheBytes",
  "memoryCacheChunks",
  "pendingChunks",
  "activeDemand",
  "activePrefetch",
  "queuedDemand",
  "queuedPrefetch",
  "cacheEvictions",
  "queuePromotions",
  "socketSendCalls",
  "socketPayloadBytes",
  "socketSourceBackingMaxBytes",
  "socketCompactBytes",
  "socketSettles",
  "inputToSubmitCount",
  "droppedRecords",
  // The WASM linear-memory size at flush time. It only ever grows within one
  // client run (the glue caps it at 2 GiB), so the sequence of changes is the
  // whole heap-growth story a memory-exhaustion triage needs.
  "wasmHeapBytes",
] as const;

type RendererNumericMetric = (typeof RENDERER_NUMERIC_METRICS)[number];

/**
 * Every histogram the renderer reports, against the counter its buckets must
 * add up to. The counter is not always `${name}Count`: bitmapOut and
 * bitmapPresent are measured once per swap, and snapshot, socketSync and
 * socketSettle each ride a counter of their own. This is the one list a new
 * histogram is added to.
 */
export const RENDERER_HISTOGRAMS = [
  { name: "raf", countKey: "rafCount" },
  { name: "swap", countKey: "swapCount" },
  { name: "submitInterval", countKey: "submitIntervalCount" },
  { name: "visibleSubmitInterval", countKey: "visibleSubmitIntervalCount" },
  { name: "hiddenSubmitInterval", countKey: "hiddenSubmitIntervalCount" },
  { name: "bitmapOut", countKey: "swapCount" },
  { name: "bitmapPresent", countKey: "swapCount" },
  { name: "snapshot", countKey: "snapshotReads" },
  { name: "socketSync", countKey: "socketSendCalls" },
  { name: "socketSettle", countKey: "socketSettles" },
  { name: "inputToSubmit", countKey: "inputToSubmitCount" },
] as const satisfies readonly {
  name: string;
  countKey: RendererNumericMetric;
}[];

export type RendererHistogramMetric =
  (typeof RENDERER_HISTOGRAMS)[number]["name"];

const RENDERER_METRIC_KEYS: ReadonlySet<string> = new Set<string>([
  ...RENDERER_NUMERIC_METRICS,
  ...RENDERER_HISTOGRAMS.map((histogram) => histogram.name),
  "visible",
  "focused",
  "rendererEvents",
  "socketSendEvents",
]);

export type RendererMetrics = Record<RendererNumericMetric, number> &
  Record<RendererHistogramMetric, DiagnosticHistogram> & {
    visible: boolean;
    /** Window focus, which `visible` cannot report: an unfocused or occluded
     * macOS window stops being composited while `document.hidden` stays false. */
    focused: boolean;
    rendererEvents: RendererDiagnosticEvent[];
    socketSendEvents: number[];
  };

export interface RendererFrameBatch {
  stride: 7;
  data: number[];
}

export const RENDERER_MILESTONES = [
  "renderer.loaded",
  "relog.intentClaimed",
  "relog.savedCredentialsLoaded",
  "relog.loginSubmitted",
  "relog.tokenRequested",
  "relog.tokenAccepted",
  "relog.characterSubmitted",
  "relog.preGameProbe",
  "relog.inputSettled",
  "relog.skipped",
  "relog.finished",
  "wasm.instantiate.begin",
  "wasm.instantiate.end",
  "wasm.streamingFallback",
  "runtime.initialized",
  "frame.firstSubmit",
  "startup.complete",
  "build.info",
  "snapshot.fatalRead",
  "wasm.abort",
  "wasm.exit",
  "wasm.memoryProbe",
  "wasm.growthRequested",
  "graphics.visualProblem",
  // The renderer half of the Enhancement story: whether our code was actually
  // live in the game's call path. Main records that a transformed module was
  // *prepared*; only these say the hook was installed, refused, or withdrawn —
  // the first question a wasm.abort triage asks.
  "enhancement.installed",
  "enhancement.consumerSignal",
  "enhancement.skillGeometryState",
  "enhancement.installFailed",
  "enhancement.uninstalled",
] as const;

export type RendererMilestone = (typeof RENDERER_MILESTONES)[number];

export const ENHANCEMENT_OBSERVER_CONSUMERS = [
  "cursor",
  "region",
  "target",
  "party",
  "skill-geometry",
  "cooldowns",
] as const;
export type EnhancementObserverConsumer =
  (typeof ENHANCEMENT_OBSERVER_CONSUMERS)[number];

export const SKILL_GEOMETRY_WAIT_REASONS = [
  "memory",
  "writing",
  "snapshot",
  "corrupt",
  "stale",
  "inactive",
  "invalid-input",
  "frame-table",
  "parent-missing",
  "parent-hidden",
  "slot-missing",
  "slot-ambiguous",
  "slot-relation",
  "slot-hidden",
  "viewport-invalid",
  "slot-nonfinite",
  "slot-order",
  "slot-outside-viewport",
  "viewport-mismatch",
] as const;
export type SkillGeometryWaitReason =
  (typeof SKILL_GEOMETRY_WAIT_REASONS)[number];

export const RELOG_INPUT_STAGES = ["login", "character", "reconnect"] as const;
export type RelogInputStage = (typeof RELOG_INPUT_STAGES)[number];

export const RELOG_INPUT_OUTCOMES = [
  "sent",
  "physical",
  "progressed",
  "unfocused",
  "cancelled",
] as const;
export type RelogInputOutcome = (typeof RELOG_INPUT_OUTCOMES)[number];

export const RELOG_TERMINAL_OUTCOMES = [
  "restored",
  "outpost",
  "timed-out",
] as const;
export type RelogTerminalOutcome = (typeof RELOG_TERMINAL_OUTCOMES)[number];

export const RELOG_SKIP_REASONS = [
  "disabled",
  "saved-login-unavailable",
  "pre-game-controls-unavailable",
  "intent-expired",
] as const;
export type RelogSkipReason = (typeof RELOG_SKIP_REASONS)[number];

/**
 * The closed vocabulary a WASM abort collapses into before crossing IPC. The
 * Emscripten abort argument is prose and never leaves the renderer; each kind
 * names a distinct native failure shape, so the export can say *what class* of
 * operation died without carrying text.
 */
export const WASM_ABORT_REASON_KINDS = [
  "assertion",
  "indirectCall",
  "memoryBounds",
  "unreachable",
  "stackOverflow",
  "oom",
  "nativeAbort",
  "unspecified",
  "other",
] as const;
export type WasmAbortReasonKind = (typeof WASM_ABORT_REASON_KINDS)[number];

export const WASM_GROWTH_OUTCOMES = [
  "grown",
  "unchanged",
  "refused",
  "threw",
] as const;
export type WasmGrowthOutcome = (typeof WASM_GROWTH_OUTCOMES)[number];

export const WASM_MEMORY_PROBE_STATUSES = [
  "installed",
  "resizeImportMissing",
] as const;
export type WasmMemoryProbeStatus =
  (typeof WASM_MEMORY_PROBE_STATUSES)[number];

/** Bounded texture counters only. No texture identity or pixels escape. */
export type TextureMemorySnapshot = {
  generatedTextures: number;
  deletedTextures: number;
  liveTextures: number;
  trackedTextures: number;
  knownTextureBytes: number;
  textureUploadBytes: number;
  unknownTextureAllocations: number;
  textureTrackingSaturated: boolean;
};

export type GraphicsVisualProblemFields = TextureMemorySnapshot & {
  textureProbeInstalled: boolean;
  wasmHeapBytes: number;
  webglContextAvailable: boolean;
  contextLost: boolean;
  canvasWidth: number;
  canvasHeight: number;
  offscreenWidth: number;
  offscreenHeight: number;
  drawingBufferWidth: number;
  drawingBufferHeight: number;
  programProbeInstalled: boolean;
  livePrograms: number;
  programPassThroughQueries: number;
};

export interface RendererMilestoneFieldsByName {
  "relog.preGameProbe": {
    state: "unknown" | "character-select" | "reconnect" | "loading";
    mask: number;
  };
  "relog.inputSettled": {
    stage: RelogInputStage;
    outcome: RelogInputOutcome;
  };
  "relog.finished": { outcome: RelogTerminalOutcome };
  "relog.skipped": { reason: RelogSkipReason };
  "build.info": { programId: string | number; buildId: string | number };
  /**
   * `heapBytes` is the WASM linear-memory size at the moment of death. The
   * glue caps the heap at 2 GiB, so a crash recorded at that cap is memory
   * exhaustion whatever prose the abort carried.
   */
  "wasm.abort": {
    reasonKind: WasmAbortReasonKind;
    fingerprint: string;
    heapBytes: number;
  };
  /** A non-zero client exit: the other way the running game dies. */
  "wasm.exit": { code: number; heapBytes: number };
  /** Whether this build can observe the official client's resize boundary. */
  "wasm.memoryProbe": { status: WasmMemoryProbeStatus };
  /**
   * One call through the client's imported heap-growth boundary. Four bounded
   * numeric WASM frames preserve attribution without exporting stack prose;
   * texture fields are aggregate lifetime evidence at the same instant.
   */
  "wasm.growthRequested": TextureMemorySnapshot & {
    requestedBytes: number;
    beforeBytes: number;
    afterBytes: number;
    outcome: WasmGrowthOutcome;
    stackFingerprint: string;
    stackDepth: number;
    frame0Function: number;
    frame0Offset: number;
    frame1Function: number;
    frame1Offset: number;
    frame2Function: number;
    frame2Offset: number;
    frame3Function: number;
    frame3Offset: number;
  };
  "graphics.visualProblem": GraphicsVisualProblemFields;
  /**
   * The hook went live. `capabilityProfile` is the closed profile vocabulary
   * from contracts — typed as string here because contracts imports this file;
   * the recorder's schema enforces membership.
   */
  "enhancement.installed": {
    companionAbi: number;
    installation: number;
    capabilityProfile: string;
  };
  "enhancement.consumerSignal": {
    consumer: EnhancementObserverConsumer;
    signal: "installed" | "first-observation";
  };
  "enhancement.skillGeometryState": {
    state: "waiting" | "ready";
    reason: SkillGeometryWaitReason | null;
    candidates: number | null;
  };
  "enhancement.uninstalled": { installation: number };
}
export type RendererMilestoneFields =
  RendererMilestoneFieldsByName[keyof RendererMilestoneFieldsByName];

export interface DiagnosticHistogramSummary {
  count: number;
  minUs: number;
  maxUs: number;
  meanUs: number;
  p50Us: number;
  p95Us: number;
  p99Us: number;
}

export interface DiagnosticSummary {
  sessionId: string;
  uptimeMs: number;
  captureLevel: 0 | 1 | 2;
  droppedEvents: number;
  counters: Record<string, number>;
  histograms: Record<string, DiagnosticHistogramSummary>;
  latest: DiagnosticFields;
}

export interface DiagnosticReport {
  formatVersion: 1;
  generatedAt: string;
  currentSession: {
    sessionId: string;
    startupStage: string;
    errorCount: number;
    warningCount: number;
    lastError: { subsystem: string; name: string } | null;
    droppedEvents: number;
  };
  previousSession: {
    sessionId: string;
    cleanShutdown: false;
    finalEventName: string;
    abnormalReason: string;
    errorCount: number;
    warningCount: number;
  } | null;
  capture: {
    level: 0 | 1 | 2;
    profilerContaminated: boolean;
    stopReason: string | null;
    visibility: string;
  };
  performance: {
    frameP95Us: number;
    snapshotP95Us: number;
    socketSyncP95Us: number;
  };
}

function isHistogram(value: unknown): value is DiagnosticHistogram {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  const elapsed = (item: unknown) =>
    typeof item === "number" &&
    Number.isFinite(item) &&
    item >= 0 &&
    item <= Number.MAX_SAFE_INTEGER;
  return (
    Object.keys(record).length === 4 &&
    Array.isArray(record.buckets) &&
    record.buckets.length === DIAGNOSTIC_BUCKETS_US.length &&
    record.buckets.every(
      (count) => Number.isSafeInteger(count) && (count as number) >= 0,
    ) &&
    elapsed(record.totalUs) &&
    elapsed(record.minUs) &&
    elapsed(record.maxUs)
  );
}

/** Every declared field present and within its own bounds. Relationships
 * between fields are `isConsistent`'s job, which this narrowing lets it state
 * against the contract instead of against an untyped record. */
function hasRendererMetricShape(value: unknown): value is RendererMetrics {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  if (!(
    Object.keys(record).every((key) => RENDERER_METRIC_KEYS.has(key)) &&
    typeof record.visible === "boolean" &&
    typeof record.focused === "boolean" &&
    RENDERER_NUMERIC_METRICS.every(
      (key) =>
        typeof record[key] === "number" &&
        Number.isFinite(record[key]) &&
        (record[key] as number) >= 0 &&
        (record[key] as number) <= Number.MAX_SAFE_INTEGER,
    ) &&
    RENDERER_HISTOGRAMS.every((histogram) => isHistogram(record[histogram.name]))
  )) {
    return false;
  }
  if (
    !Array.isArray(record.rendererEvents) ||
    record.rendererEvents.length > 64 ||
    !record.rendererEvents.every((event) => {
      if (!event || typeof event !== "object" || Array.isArray(event))
        return false;
      const item = event as Record<string, unknown>;
      return (
        typeof item.timestampUs === "number" &&
        Number.isFinite(item.timestampUs) &&
        item.timestampUs >= 0 &&
        item.timestampUs <= Number.MAX_SAFE_INTEGER &&
        typeof item.name === "string" &&
        RENDERER_EVENT_NAMES.includes(item.name as RendererEventName) &&
        (item.fingerprint === undefined ||
          (typeof item.fingerprint === "string" &&
            /^[0-9a-f]{8}$/.test(item.fingerprint)))
      );
    })
  ) {
    return false;
  }
  return (
    Array.isArray(record.socketSendEvents) &&
    record.socketSendEvents.length <= 7 * 256 &&
    record.socketSendEvents.length % 7 === 0 &&
    record.socketSendEvents.every(
      (item, index) =>
        typeof item === "number" &&
        Number.isFinite(item) &&
        item >= 0 &&
        item <= Number.MAX_SAFE_INTEGER &&
        (index % 7 !== 6 || item === 0 || item === 1),
    )
  );
}

/** What one field implies about another. */
function isConsistent(metrics: RendererMetrics): boolean {
  const counters: readonly RendererNumericMetric[] = [
    "rafCount",
    "rafOver33",
    "rafOver50",
    "swapCount",
    "snapshotReads",
    "snapshotBytes",
    "snapshotMemoryReads",
    "memoryHits",
    "nativeHits",
    "coalesced",
    "glProgramQueryHits",
    "glProgramQueryMisses",
    "memoryCacheBytes",
    "memoryCacheChunks",
    "pendingChunks",
    "activeDemand",
    "activePrefetch",
    "queuedDemand",
    "queuedPrefetch",
    "cacheEvictions",
    "queuePromotions",
    "socketSendCalls",
    "socketPayloadBytes",
    "socketSourceBackingMaxBytes",
    "socketCompactBytes",
    "socketSettles",
    "inputToSubmitCount",
    "droppedRecords",
    "wasmHeapBytes",
  ];
  const bounded = ({ name, countKey }: (typeof RENDERER_HISTOGRAMS)[number]) => {
    const count = metrics[countKey];
    const { buckets, totalUs, minUs, maxUs } = metrics[name];
    return (
      Number.isSafeInteger(count) &&
      buckets.reduce((sum, value) => sum + value, 0) === count &&
      (count === 0
        ? totalUs === 0 && minUs === 0 && maxUs === 0
        : minUs <= maxUs &&
          totalUs >= minUs * count &&
          totalUs <= maxUs * count)
    );
  };
  return (
    metrics.socketCompactBytes === metrics.socketPayloadBytes &&
    metrics.socketSendEvents.every((_item, index, events) => {
      if (index % 7 !== 0) return true;
      return (
        events[index + 4]! >= events[index + 3]! &&
        events[index + 5] === events[index + 3]
      );
    }) &&
    RENDERER_HISTOGRAMS.every(bounded) &&
    metrics.visibleSubmitIntervalCount + metrics.hiddenSubmitIntervalCount ===
      metrics.submitIntervalCount &&
    counters.every((key) => Number.isSafeInteger(metrics[key])) &&
    metrics.rafOver50 <= metrics.rafOver33 &&
    metrics.rafOver33 <= metrics.rafCount &&
    metrics.snapshotMemoryReads <= metrics.snapshotReads &&
    metrics.presentationFailures <= metrics.swapCount
  );
}

export function isRendererMetrics(value: unknown): value is RendererMetrics {
  return hasRendererMetricShape(value) && isConsistent(value);
}

export function isRendererFrameBatch(
  value: unknown,
): value is RendererFrameBatch {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const batch = value as { stride?: unknown; data?: unknown };
  return (
    batch.stride === 7 &&
    Array.isArray(batch.data) &&
    batch.data.length <= 20_000 &&
    batch.data.length % batch.stride === 0 &&
    batch.data.every(
      (item) => typeof item === "number" && Number.isFinite(item),
    ) &&
    batch.data.every((item, index) => {
      const column = index % 7;
      if (column <= 3) return item >= 0 && item <= Number.MAX_SAFE_INTEGER;
      if (column === 4 || column === 5) return item >= 0 && item <= 32_768;
      return item === 0 || item === 1;
    })
  );
}
