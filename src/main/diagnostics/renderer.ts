/**
 * Everything the renderer reports, translated into recorder state.
 *
 * The renderer measures the frame loop, the game's reads and sockets, and its
 * own milestones; main owns the recorder. This is the one place the two meet,
 * so a renderer-reported value cannot reach the recorder by another route and
 * arrive under a different name.
 */
import {
  type GraphicsDiagnostics,
} from "../../shared/contracts.js";
import {
  isEnhancementCapabilityProfile,
} from "../../shared/enhancement-contracts.js";
import {
  RENDERER_HISTOGRAMS,
  type RendererFrameBatch,
  type RendererHistogramMetric,
  type RendererMetrics,
  type RendererMilestone,
  type RendererMilestoneFields,
  type RendererMilestoneFieldsByName,
  type TextureMemorySnapshot,
  type WasmMemoryProbeStatus,
} from "../../shared/diagnostics.js";
import {
  captureOwnsDiagnosticOwner,
  captureOwnsWebContents,
} from "./capture.js";
import { logEvent, recordEvent, recorder } from "./recorder.js";
import { asRendererFingerprint } from "./schema-fields.js";

interface RendererDiagnosticState {
  clockOffsetUs: number;
  clockSynchronized: boolean;
  /** The last heap size this renderer reported; a smaller value means reload. */
  lastWasmHeapBytes: number;
}

const rendererStates = new Map<number, RendererDiagnosticState>();

function recordTextureSnapshot(
  fields: TextureMemorySnapshot,
  ownerId: number,
): void {
  recorder.setLatest("wasm.textures.live", fields.liveTextures, ownerId);
  recorder.setLatest("wasm.textures.tracked", fields.trackedTextures, ownerId);
  recorder.setLatest("wasm.textures.knownBytes", fields.knownTextureBytes, ownerId);
  recorder.setLatest("wasm.textures.uploadBytes", fields.textureUploadBytes, ownerId);
  recorder.setLatest(
    "wasm.textures.unknownAllocations",
    fields.unknownTextureAllocations,
    ownerId,
  );
  recorder.setLatest(
    "wasm.textures.trackingSaturated",
    fields.textureTrackingSaturated,
    ownerId,
  );
  recorder.setPeak("wasm.textures.peakLive", fields.liveTextures, ownerId);
  recorder.setPeak("wasm.textures.peakKnownBytes", fields.knownTextureBytes, ownerId);
}

function stateFor(ownerId: number): RendererDiagnosticState {
  let state = rendererStates.get(ownerId);
  if (!state) {
    state = {
      clockOffsetUs: 0,
      clockSynchronized: false,
      lastWasmHeapBytes: 0,
    };
    rendererStates.set(ownerId, state);
  }
  return state;
}

/** The renderer's graphics description, as an export carries it. */
export function graphicsSnapshot(ownerId?: number): GraphicsDiagnostics | null {
  return recorder.graphics(ownerId);
}

/** Reset state that belongs to one renderer document, not its account. */
export function resetRendererDiagnostics(ownerId: number): void {
  rendererStates.delete(ownerId);
  recorder.clearGraphics(ownerId);
}

/** Release all process-local evidence after permanent profile deletion. */
export function forgetRendererDiagnosticsOwner(ownerId: number): void {
  rendererStates.delete(ownerId);
  recorder.forgetOwner(ownerId);
}

export function recordGraphics(
  ownerId: number,
  value: GraphicsDiagnostics,
): void {
  recorder.setGraphics(ownerId, value);
  recorder.setLatest("graphics.renderer", value.renderer, ownerId);
  recorder.setLatest(
    "graphics.hardwareAcceleration",
    value.hardwareAcceleration,
    ownerId,
  );
  recorder.setLatest("graphics.canvasWidth", value.canvasWidth, ownerId);
  recorder.setLatest("graphics.canvasHeight", value.canvasHeight, ownerId);
  recorder.setLatest("graphics.offscreenWidth", value.offscreenWidth, ownerId);
  recorder.setLatest("graphics.offscreenHeight", value.offscreenHeight, ownerId);
  recorder.setLatest(
    "graphics.drawingBufferWidth",
    value.drawingBufferWidth,
    ownerId,
  );
  recorder.setLatest(
    "graphics.drawingBufferHeight",
    value.drawingBufferHeight,
    ownerId,
  );
  recorder.setLatest("graphics.antialias", value.antialias, ownerId);
  recorder.setLatest("graphics.samples", value.samples, ownerId);
  logEvent({
    k: "graphics.detected",
    jspi: value.jspi,
    hardwareAcceleration: value.hardwareAcceleration,
    canvasWidth: value.canvasWidth,
    canvasHeight: value.canvasHeight,
    offscreenWidth: value.offscreenWidth,
    offscreenHeight: value.offscreenHeight,
    drawingBufferWidth: value.drawingBufferWidth,
    drawingBufferHeight: value.drawingBufferHeight,
    devicePixelRatio: value.devicePixelRatio,
    renderScale: value.renderScale,
    antialias: value.antialias,
    samples: value.samples,
  }, ownerId);
}

/**
 * Where each renderer histogram lands in the recorder's namespace, which is
 * organised by subsystem rather than by the reporting side. Exhaustive by
 * type: a new renderer histogram does not compile without a home here.
 */
const RENDERER_HISTOGRAM_NAMES: Record<RendererHistogramMetric, string> = {
  raf: "renderer.rafInterval",
  swap: "renderer.swap",
  submitInterval: "renderer.submitInterval",
  visibleSubmitInterval: "renderer.visibleSubmitInterval",
  hiddenSubmitInterval: "renderer.hiddenSubmitInterval",
  bitmapOut: "renderer.bitmapOut",
  bitmapPresent: "renderer.bitmapPresent",
  snapshot: "snapshot.rendererRead",
  socketSync: "socket.rendererSync",
  socketSettle: "socket.rendererSettle",
  inputToSubmit: "renderer.inputToSubmit",
};

export function recordRendererMetrics(
  ownerId: number,
  value: RendererMetrics,
): void {
  const state = stateFor(ownerId);
  recorder.count("renderer.raf", value.rafCount, ownerId);
  recorder.count("renderer.rafOver33", value.rafOver33, ownerId);
  recorder.count("renderer.rafOver50", value.rafOver50, ownerId);
  recorder.count("renderer.swaps", value.swapCount, ownerId);
  recorder.count(
    "renderer.presentationFailures",
    value.presentationFailures,
    ownerId,
  );
  recorder.count("snapshot.reads", value.snapshotReads, ownerId);
  recorder.count("snapshot.bytes", value.snapshotBytes, ownerId);
  recorder.count("snapshot.readsFromMemory", value.snapshotMemoryReads, ownerId);
  recorder.count("cache.memoryHits", value.memoryHits, ownerId);
  recorder.count("cache.nativeHits", value.nativeHits, ownerId);
  recorder.count("cache.coalesced", value.coalesced, ownerId);
  recorder.count("gl.programQueryHits", value.glProgramQueryHits, ownerId);
  recorder.count("gl.programQueryMisses", value.glProgramQueryMisses, ownerId);
  recorder.count("socket.rendererSendCalls", value.socketSendCalls, ownerId);
  recorder.count("socket.rendererPayloadBytes", value.socketPayloadBytes, ownerId);
  recorder.setPeak(
    "socket.rendererPeakSourceBackingBytes",
    value.socketSourceBackingMaxBytes,
    ownerId,
  );
  recorder.count("socket.rendererCompactBytes", value.socketCompactBytes, ownerId);
  recorder.count("socket.rendererSettles", value.socketSettles, ownerId);
  recorder.count("diagnostics.rendererDropped", value.droppedRecords, ownerId);
  if (value.wasmHeapBytes > 0) {
    recorder.setLatest("renderer.wasmHeapBytes", value.wasmHeapBytes, ownerId);
    recorder.setPeak("renderer.peakWasmHeapBytes", value.wasmHeapBytes, ownerId);
    // Growth is discrete and rare (the glue steps geometrically toward its
    // cap), so every observed rise between flushes becomes one event — steps
    // inside one flush window coalesce. Read with the socket.open map
    // transitions around it, the sequence answers whether a session leaked
    // steadily or stepped up on zone loads — the question a heap-cap abort
    // asks. A decrease is a reloaded client, not a shrink: baseline only.
    if (value.wasmHeapBytes > state.lastWasmHeapBytes) {
      logEvent({
        k: "wasm.heapGrew",
        fromBytes: state.lastWasmHeapBytes,
        toBytes: value.wasmHeapBytes,
      }, ownerId);
    }
    state.lastWasmHeapBytes = value.wasmHeapBytes;
  }
  for (const event of value.rendererEvents) {
    recorder.count(`renderer.event.${event.name}`, 1, ownerId);
    const fingerprint = event.fingerprint
      ? asRendererFingerprint(event.fingerprint)
      : null;
    switch (event.name) {
      case "renderer.windowError":
      case "renderer.unhandledRejection":
      case "graphics.contextLost":
      case "graphics.contextRestored":
      case "graphics.presentationFailed":
      case "client.glueLoadFailed":
      case "filesystem.persistenceFailed":
      case "audio.resumeFailed":
      case "pointerLock.failed":
      case "snapshot.readFailed":
      case "graphics.programCacheSaturated":
      case "clipboard.copied":
      case "clipboard.writeFailed":
        recordEvent(
          { k: event.name, fingerprint },
          { timestampUs: Math.round(event.timestampUs) },
          ownerId,
        );
        break;
    }
  }
  for (const { name } of RENDERER_HISTOGRAMS) {
    recorder.mergeHistogram(
      RENDERER_HISTOGRAM_NAMES[name],
      value[name],
      ownerId,
    );
  }
  recorder.setLatest("renderer.visible", value.visible, ownerId);
  recorder.setLatest("renderer.focused", value.focused, ownerId);
  recorder.setLatest(
    "renderer.memoryCacheBytes",
    value.memoryCacheBytes,
    ownerId,
  );
  recorder.setLatest(
    "renderer.memoryCacheChunks",
    value.memoryCacheChunks,
    ownerId,
  );
  recorder.setLatest("renderer.pendingChunks", value.pendingChunks, ownerId);
  recorder.setLatest("snapshot.activeDemand", value.activeDemand, ownerId);
  recorder.setLatest("snapshot.activePrefetch", value.activePrefetch, ownerId);
  recorder.setLatest("snapshot.queuedDemand", value.queuedDemand, ownerId);
  recorder.setLatest("snapshot.queuedPrefetch", value.queuedPrefetch, ownerId);
  recorder.setPeak(
    "renderer.peakMemoryCacheBytes",
    value.memoryCacheBytes,
    ownerId,
  );
  recorder.setPeak("renderer.peakPendingChunks", value.pendingChunks, ownerId);
  recorder.setPeak(
    "snapshot.peakQueueDepth",
    value.queuedDemand + value.queuedPrefetch,
    ownerId,
  );
  recorder.count("cache.evictions", value.cacheEvictions, ownerId);
  recorder.count("snapshot.queuePromotions", value.queuePromotions, ownerId);
  recorder.setLatest(
    "renderer.submittedFps",
    value.intervalMs
      ? Math.round(
          ((value.swapCount - value.presentationFailures) * 1_000) /
            value.intervalMs,
        )
      : 0,
    ownerId,
  );
  if (captureOwnsDiagnosticOwner(ownerId)) {
    for (let index = 0; index < value.socketSendEvents.length; index += 7) {
      recordEvent(
        {
          k: "socket.rendererSend",
          syncUs: Math.round(value.socketSendEvents[index + 1]!),
          settleUs: Math.round(value.socketSendEvents[index + 2]!),
          payloadBytes: value.socketSendEvents[index + 3]!,
          sourceBackingBytes: value.socketSendEvents[index + 4]!,
          compactBytes: value.socketSendEvents[index + 5]!,
          status: value.socketSendEvents[index + 6] ? "sent" : "failed",
        },
        { timestampUs: Math.round(value.socketSendEvents[index]!) },
        ownerId,
      );
    }
    logEvent({ k: "renderer.metrics",
      visible: value.visible,
      intervalMs: Math.round(value.intervalMs),
      rafCount: value.rafCount,
      rafMaxUs: Math.round(value.raf.maxUs),
      swapCount: value.swapCount,
      presentationFailures: value.presentationFailures,
      swapMaxUs: Math.round(value.swap.maxUs),
      submitIntervalMaxUs: Math.round(value.submitInterval.maxUs),
      snapshotReads: value.snapshotReads,
      snapshotBytes: value.snapshotBytes,
      snapshotMaxUs: Math.round(value.snapshot.maxUs),
      inputToSubmitCount: value.inputToSubmitCount,
      inputToSubmitMaxUs: Math.round(value.inputToSubmit.maxUs),
      memoryCacheBytes: value.memoryCacheBytes,
      memoryCacheChunks: value.memoryCacheChunks,
      pendingChunks: value.pendingChunks,
      activeDemand: value.activeDemand,
      activePrefetch: value.activePrefetch,
      queuedDemand: value.queuedDemand,
      queuedPrefetch: value.queuedPrefetch,
      socketSendCalls: value.socketSendCalls,
      socketPayloadBytes: value.socketPayloadBytes,
      socketSourceBackingMaxBytes: value.socketSourceBackingMaxBytes,
      socketCompactBytes: value.socketCompactBytes,
      socketSyncMaxUs: Math.round(value.socketSync.maxUs),
      socketSettles: value.socketSettles,
      socketSettleMaxUs: Math.round(value.socketSettle.maxUs),
      droppedRecords: value.droppedRecords,
    }, ownerId);
  }
}

export async function recordRendererFrames(
  webContentsId: number,
  ownerId: number,
  value: RendererFrameBatch,
): Promise<void> {
  if (!captureOwnsWebContents(webContentsId)) return;
  await recorder.appendFrames(value, ownerId);
}

export function recordClockOffset(
  ownerId: number,
  offsetUs: number,
  rttUs: number,
): void {
  const state = stateFor(ownerId);
  state.clockOffsetUs = offsetUs;
  state.clockSynchronized = true;
  recorder.setLatest("renderer.clockOffsetUs", Math.round(offsetUs), ownerId);
  recorder.setLatest("renderer.clockRttUs", Math.round(rttUs), ownerId);
  logEvent({ k: "clock.synchronized",
    offsetUs: Math.round(offsetUs),
    rttUs: Math.round(rttUs),
  }, ownerId);
}

export function recordRendererMilestone(
  ownerId: number,
  name: RendererMilestone,
  rendererTimestampUs: number,
  fields?: RendererMilestoneFields,
): void {
  const state = stateFor(ownerId);
  const timestampUs = state.clockSynchronized
    ? Math.max(0, Math.round(rendererTimestampUs + state.clockOffsetUs))
    : recorder.timestampUs();
  recorder.setLatest(`milestone.${name}Us`, timestampUs, ownerId);
  if (name === "build.info" && fields && "programId" in fields) {
    recorder.setLatest("client.programId", fields.programId, ownerId);
    recorder.setLatest("client.buildId", fields.buildId, ownerId);
  }
  if (name === "relog.inputSettled") {
    if (!fields || !("stage" in fields)) return;
    recordEvent(
      {
        k: "relog.inputSettled",
        clockSynchronized: state.clockSynchronized,
        stage: fields.stage,
        outcome: fields.outcome,
      },
      { timestampUs },
      ownerId,
    );
    return;
  }
  if (name === "relog.preGameProbe") {
    if (!fields || !("mask" in fields)) return;
    recordEvent(
      {
        k: "relog.preGameProbe",
        clockSynchronized: state.clockSynchronized,
        state: fields.state,
        mask: fields.mask,
      },
      { timestampUs },
      ownerId,
    );
    return;
  }
  if (name === "relog.finished") {
    if (!fields || !("outcome" in fields)) return;
    const relogFields = fields as RendererMilestoneFieldsByName["relog.finished"];
    recordEvent(
      {
        k: "relog.finished",
        clockSynchronized: state.clockSynchronized,
        outcome: relogFields.outcome,
      },
      { timestampUs },
      ownerId,
    );
    return;
  }
  if (name === "relog.skipped") {
    if (!fields || !("reason" in fields)) return;
    recordEvent({ k: "relog.skipped", reason: fields.reason }, { timestampUs }, ownerId);
    return;
  }
  if (name === "enhancement.consumerSignal") {
    if (!fields || !("consumer" in fields)) return;
    recordEvent({
      k: "enhancement.consumerSignal",
      consumer: fields.consumer,
      signal: fields.signal,
    }, { timestampUs }, ownerId);
    return;
  }
  if (name === "wasm.abort") {
    // IPC validation guarantees these fields for this name; a call without
    // them is unreachable and recording a reasonless abort would be a lie.
    if (!fields || !("reasonKind" in fields)) return;
    // The run-scoped crash tally the loading overlay reads back through
    // diagnostics.current() to decide first-crash vs repeated-crash copy.
    // The renderer records one crash per client launch, so this counts
    // launches that crashed, not abort re-entries.
    recorder.count("wasm.crashes", 1, ownerId);
    recordEvent(
      {
        k: "wasm.abort",
        clockSynchronized: state.clockSynchronized,
        reasonKind: fields.reasonKind,
        fingerprint: asRendererFingerprint(fields.fingerprint),
        heapBytes: fields.heapBytes,
      },
      { timestampUs },
      ownerId,
    );
    return;
  }
  if (name === "wasm.exit") {
    if (!fields || !("code" in fields)) return;
    recorder.count("wasm.crashes", 1, ownerId);
    recordEvent(
      {
        k: "wasm.exit",
        clockSynchronized: state.clockSynchronized,
        code: fields.code,
        heapBytes: fields.heapBytes,
      },
      { timestampUs },
      ownerId,
    );
    return;
  }
  if (name === "wasm.memoryProbe") {
    if (!fields || !("status" in fields)) return;
    recorder.setLatest("wasm.memoryProbe.status", fields.status, ownerId);
    recordEvent(
      {
        k: "wasm.memoryProbe",
        clockSynchronized: state.clockSynchronized,
        status: fields.status as WasmMemoryProbeStatus,
      },
      { timestampUs },
      ownerId,
    );
    return;
  }
  if (name === "wasm.growthRequested") {
    if (!fields || !("requestedBytes" in fields)) return;
    recorder.count("wasm.growthRequests", 1, ownerId);
    recorder.count(`wasm.growthRequests.${fields.outcome}`, 1, ownerId);
    recorder.setLatest("wasm.growth.outcome", fields.outcome, ownerId);
    recorder.setLatest(
      "wasm.growth.stackFingerprint",
      fields.stackFingerprint,
      ownerId,
    );
    recorder.setLatest(
      "wasm.growth.requestedBytes",
      fields.requestedBytes,
      ownerId,
    );
    recorder.setLatest("wasm.growth.beforeBytes", fields.beforeBytes, ownerId);
    recorder.setLatest("wasm.growth.afterBytes", fields.afterBytes, ownerId);
    recorder.setLatest("wasm.growth.stackDepth", fields.stackDepth, ownerId);
    recorder.setLatest(
      "wasm.growth.frame0Function",
      fields.frame0Function,
      ownerId,
    );
    recorder.setLatest("wasm.growth.frame0Offset", fields.frame0Offset, ownerId);
    recorder.setLatest(
      "wasm.growth.frame1Function",
      fields.frame1Function,
      ownerId,
    );
    recorder.setLatest("wasm.growth.frame1Offset", fields.frame1Offset, ownerId);
    recordTextureSnapshot(fields, ownerId);
    recordEvent(
      {
        k: "wasm.growthRequested",
        clockSynchronized: state.clockSynchronized,
        ...fields,
        stackFingerprint: asRendererFingerprint(fields.stackFingerprint),
      },
      { timestampUs },
      ownerId,
    );
    return;
  }
  if (name === "graphics.visualProblem") {
    if (!fields || !("contextLost" in fields)) return;
    recordTextureSnapshot(fields, ownerId);
    recorder.setLatest(
      "graphics.webglContextAvailableAtVisualProblem",
      fields.webglContextAvailable,
      ownerId,
    );
    recorder.setLatest("graphics.contextLostAtVisualProblem", fields.contextLost, ownerId);
    recorder.setLatest("graphics.visualProblemWasmHeapBytes", fields.wasmHeapBytes, ownerId);
    recorder.setLatest(
      "graphics.programProbeInstalledAtVisualProblem",
      fields.programProbeInstalled,
      ownerId,
    );
    recorder.setLatest("graphics.visualProblemLivePrograms", fields.livePrograms, ownerId);
    recorder.setLatest(
      "graphics.visualProblemProgramPassThroughQueries",
      fields.programPassThroughQueries,
      ownerId,
    );
    recordEvent(
      {
        k: "graphics.visualProblem",
        clockSynchronized: state.clockSynchronized,
        ...fields,
      },
      { timestampUs },
      ownerId,
    );
    return;
  }
  if (name === "enhancement.installed") {
    if (!fields || !("capabilityProfile" in fields)) return;
    // IPC validated the shape; membership in the closed profile vocabulary is
    // this recorder's gate. An unknown profile is dropped, not recorded.
    const profile = fields.capabilityProfile;
    if (!isEnhancementCapabilityProfile(profile)) return;
    recordEvent(
      {
        k: "enhancement.installed",
        clockSynchronized: state.clockSynchronized,
        companionAbi: fields.companionAbi,
        installation: fields.installation,
        capabilityProfile: profile,
      },
      { timestampUs },
      ownerId,
    );
    return;
  }
  if (name === "enhancement.uninstalled") {
    if (!fields || !("installation" in fields) || "capabilityProfile" in fields) {
      return;
    }
    recordEvent(
      {
        k: "enhancement.uninstalled",
        clockSynchronized: state.clockSynchronized,
        installation: fields.installation,
      },
      { timestampUs },
      ownerId,
    );
    return;
  }
  recordEvent(
    { k: name, clockSynchronized: state.clockSynchronized },
    { timestampUs },
    ownerId,
  );
}
