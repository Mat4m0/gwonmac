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
  | "release";

export type DiagnosticScalar = string | number | boolean | null;
export type DiagnosticFields = Record<string, DiagnosticScalar>;

export const RENDERER_EVENT_NAMES = [
  "renderer.windowError",
  "renderer.unhandledRejection",
  "graphics.contextLost",
  "graphics.contextRestored",
  "client.glueLoadFailed",
  "audio.resumeFailed",
  "pointerLock.failed",
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

export interface RendererMetrics {
  intervalMs: number;
  visible: boolean;
  rafCount: number;
  rafTotalUs: number;
  rafMinUs: number;
  rafMaxUs: number;
  rafOver16: number;
  rafOver33: number;
  rafOver50: number;
  swapCount: number;
  swapTotalUs: number;
  swapMinUs: number;
  swapMaxUs: number;
  submitIntervalCount: number;
  submitIntervalTotalUs: number;
  submitIntervalMinUs: number;
  submitIntervalMaxUs: number;
  visibleSubmitIntervalCount: number;
  visibleSubmitIntervalTotalUs: number;
  visibleSubmitIntervalMinUs: number;
  visibleSubmitIntervalMaxUs: number;
  hiddenSubmitIntervalCount: number;
  hiddenSubmitIntervalTotalUs: number;
  hiddenSubmitIntervalMinUs: number;
  hiddenSubmitIntervalMaxUs: number;
  bitmapOutTotalUs: number;
  bitmapOutMinUs: number;
  bitmapOutMaxUs: number;
  bitmapPresentTotalUs: number;
  bitmapPresentMinUs: number;
  bitmapPresentMaxUs: number;
  snapshotReads: number;
  snapshotBytes: number;
  snapshotTotalUs: number;
  snapshotMinUs: number;
  snapshotMaxUs: number;
  memoryHits: number;
  nativeHits: number;
  coalesced: number;
  memoryCacheBytes: number;
  memoryCacheChunks: number;
  pendingChunks: number;
  activeDemand: number;
  activePrefetch: number;
  queuedDemand: number;
  queuedPrefetch: number;
  cacheEvictions: number;
  queuePromotions: number;
  socketSendCalls: number;
  socketPayloadBytes: number;
  socketSourceBackingBytes: number;
  socketCompactBytes: number;
  socketSyncTotalUs: number;
  socketSyncMinUs: number;
  socketSyncMaxUs: number;
  socketSettles: number;
  socketSettleTotalUs: number;
  socketSettleMinUs: number;
  socketSettleMaxUs: number;
  inputToSubmitCount: number;
  inputToSubmitTotalUs: number;
  inputToSubmitMinUs: number;
  inputToSubmitMaxUs: number;
  droppedRecords: number;
  rendererEvents: RendererDiagnosticEvent[];
  rafHistogram: number[];
  swapHistogram: number[];
  submitIntervalHistogram: number[];
  visibleSubmitIntervalHistogram: number[];
  hiddenSubmitIntervalHistogram: number[];
  bitmapOutHistogram: number[];
  bitmapPresentHistogram: number[];
  snapshotHistogram: number[];
  socketSyncHistogram: number[];
  socketSettleHistogram: number[];
  inputToSubmitHistogram: number[];
  socketSendEvents: number[];
}

export interface RendererFrameBatch {
  stride: 7;
  data: number[];
}

export const RENDERER_MILESTONES = [
  "renderer.loaded",
  "wasm.instantiate.begin",
  "wasm.instantiate.end",
  "wasm.streamingFallback",
  "runtime.initialized",
  "frame.firstSubmit",
  "startup.complete",
  "launcher.choiceShown",
  "launcher.quickSelected",
  "launcher.fullSelected",
  "launcher.playNowSelected",
  "launcher.bootReleased",
  "build.info",
  "snapshot.fatalRead",
  "wasm.abort",
] as const;

export type RendererMilestone = (typeof RENDERER_MILESTONES)[number];
export interface RendererMilestoneFields {
  programId: string | number;
  buildId: string | number;
}

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

export function isRendererMetrics(value: unknown): value is RendererMetrics {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  const numeric = [
    "intervalMs",
    "rafCount",
    "rafTotalUs",
    "rafMinUs",
    "rafMaxUs",
    "rafOver16",
    "rafOver33",
    "rafOver50",
    "swapCount",
    "swapTotalUs",
    "swapMinUs",
    "swapMaxUs",
    "submitIntervalCount",
    "submitIntervalTotalUs",
    "submitIntervalMinUs",
    "submitIntervalMaxUs",
    "visibleSubmitIntervalCount",
    "visibleSubmitIntervalTotalUs",
    "visibleSubmitIntervalMinUs",
    "visibleSubmitIntervalMaxUs",
    "hiddenSubmitIntervalCount",
    "hiddenSubmitIntervalTotalUs",
    "hiddenSubmitIntervalMinUs",
    "hiddenSubmitIntervalMaxUs",
    "bitmapOutTotalUs",
    "bitmapOutMinUs",
    "bitmapOutMaxUs",
    "bitmapPresentTotalUs",
    "bitmapPresentMinUs",
    "bitmapPresentMaxUs",
    "snapshotReads",
    "snapshotBytes",
    "snapshotTotalUs",
    "snapshotMinUs",
    "snapshotMaxUs",
    "memoryHits",
    "nativeHits",
    "coalesced",
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
    "socketSourceBackingBytes",
    "socketCompactBytes",
    "socketSyncTotalUs",
    "socketSyncMinUs",
    "socketSyncMaxUs",
    "socketSettles",
    "socketSettleTotalUs",
    "socketSettleMinUs",
    "socketSettleMaxUs",
    "inputToSubmitCount",
    "inputToSubmitTotalUs",
    "inputToSubmitMinUs",
    "inputToSubmitMaxUs",
    "droppedRecords",
  ];
  if (
    !(
      typeof record.visible === "boolean" &&
      numeric.every(
        (key) =>
          typeof record[key] === "number" &&
          Number.isFinite(record[key]) &&
          (record[key] as number) >= 0 &&
          (record[key] as number) <= Number.MAX_SAFE_INTEGER,
      ) &&
      [
        record.rafHistogram,
        record.swapHistogram,
        record.submitIntervalHistogram,
        record.visibleSubmitIntervalHistogram,
        record.hiddenSubmitIntervalHistogram,
        record.bitmapOutHistogram,
        record.bitmapPresentHistogram,
        record.snapshotHistogram,
        record.socketSyncHistogram,
        record.socketSettleHistogram,
        record.inputToSubmitHistogram,
      ].every(
        (histogram) =>
          Array.isArray(histogram) &&
          histogram.length === DIAGNOSTIC_BUCKETS_US.length &&
          histogram.every(
            (count) => Number.isSafeInteger(count) && (count as number) >= 0,
          ),
      )
    )
  ) {
    return false;
  }
  if (
    !Array.isArray(record.rendererEvents) ||
    record.rendererEvents.length > 64 ||
    !record.rendererEvents.every((event) => {
      if (!event || typeof event !== "object" || Array.isArray(event)) return false;
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
  if (
    !Array.isArray(record.socketSendEvents) ||
    record.socketSendEvents.length > 7 * 256 ||
    record.socketSendEvents.length % 7 !== 0 ||
    !record.socketSendEvents.every(
      (item, index) =>
        typeof item === "number" &&
        Number.isFinite(item) &&
        item >= 0 &&
        item <= Number.MAX_SAFE_INTEGER &&
        (index % 7 !== 6 || item === 0 || item === 1),
    )
  ) {
    return false;
  }
  if (
    record.socketCompactBytes !== record.socketPayloadBytes ||
    (record.socketSourceBackingBytes as number) <
      (record.socketPayloadBytes as number) ||
    !record.socketSendEvents.every((_item, index, events) => {
      if (index % 7 !== 0) return true;
      return events[index + 4]! >= events[index + 3]! &&
        events[index + 5] === events[index + 3];
    })
  ) {
    return false;
  }
  const bounded = (prefix: string, countKey = `${prefix}Count`): boolean => {
    const count = record[countKey] as number;
    const total = record[`${prefix}TotalUs`] as number;
    const min = record[`${prefix}MinUs`] as number;
    const max = record[`${prefix}MaxUs`] as number;
    const buckets = record[`${prefix}Histogram`] as number[];
    return (
      Number.isSafeInteger(count) &&
      buckets.reduce((sum, value) => sum + value, 0) === count &&
      (count === 0
        ? total === 0 && min === 0 && max === 0
        : min <= max && total >= min * count && total <= max * count)
    );
  };
  const counters = [
    "rafCount",
    "rafOver16",
    "rafOver33",
    "rafOver50",
    "swapCount",
    "snapshotReads",
    "snapshotBytes",
    "memoryHits",
    "nativeHits",
    "coalesced",
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
    "socketSourceBackingBytes",
    "socketCompactBytes",
    "socketSettles",
    "inputToSubmitCount",
    "droppedRecords",
  ];
  return (
    bounded("raf") &&
    bounded("swap") &&
    bounded("submitInterval") &&
    bounded("visibleSubmitInterval") &&
    bounded("hiddenSubmitInterval") &&
    (record.visibleSubmitIntervalCount as number) +
      (record.hiddenSubmitIntervalCount as number) ===
      (record.submitIntervalCount as number) &&
    bounded("bitmapOut", "swapCount") &&
    bounded("bitmapPresent", "swapCount") &&
    bounded("snapshot", "snapshotReads") &&
    bounded("socketSync", "socketSendCalls") &&
    bounded("socketSettle", "socketSettles") &&
    bounded("inputToSubmit") &&
    counters.every((key) => Number.isSafeInteger(record[key])) &&
    (record.rafOver50 as number) <= (record.rafOver33 as number) &&
    (record.rafOver33 as number) <= (record.rafOver16 as number) &&
    (record.rafOver16 as number) <= (record.rafCount as number)
  );
}

export function isRendererFrameBatch(value: unknown): value is RendererFrameBatch {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const batch = value as { stride?: unknown; data?: unknown };
  return (
    batch.stride === 7 &&
    Array.isArray(batch.data) &&
    batch.data.length <= 20_000 &&
    batch.data.length % batch.stride === 0 &&
    batch.data.every((item) => typeof item === "number" && Number.isFinite(item)) &&
    batch.data.every((item, index) => {
      const column = index % 7;
      if (column <= 3) return item >= 0 && item <= Number.MAX_SAFE_INTEGER;
      if (column === 4 || column === 5) return item >= 0 && item <= 32_768;
      return item === 0 || item === 1;
    })
  );
}
