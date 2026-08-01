import {
  ENHANCEMENT_CAPABILITY_PROFILES,
  type EnhancementCapabilityProfile,
  type GraphicsDiagnostics,
} from "../../shared/contracts.js";
import {
  RENDERER_HISTOGRAMS,
  type RendererFrameBatch,
  type RendererHistogramMetric,
  type RendererMetrics,
  type RendererMilestone,
  type RendererMilestoneFields,
} from "../../shared/diagnostics.js";
import { activeCaptureLevel } from "./capture.js";
import { logEvent, recordEvent, recorder } from "./recorder.js";
import { asRendererFingerprint } from "./schema.js";

/**
 * Everything the renderer reports, translated into recorder state.
 *
 * The renderer measures the frame loop, the game's reads and sockets, and its
 * own milestones; main owns the recorder. This is the one place the two meet,
 * so a renderer-reported value cannot reach the recorder by another route and
 * arrive under a different name.
 */

let graphics: GraphicsDiagnostics | null = null;
let rendererClockOffsetUs = 0;
let rendererClockSynchronized = false;

/** The renderer's graphics description, as an export carries it. */
export function graphicsSnapshot(): GraphicsDiagnostics | null {
  return graphics;
}

export function recordGraphics(value: GraphicsDiagnostics): void {
  graphics = value;
  recorder.setLatest("graphics.renderer", value.renderer);
  recorder.setLatest("graphics.hardwareAcceleration", value.hardwareAcceleration);
  recorder.setLatest("graphics.canvasWidth", value.canvasWidth);
  recorder.setLatest("graphics.canvasHeight", value.canvasHeight);
  recorder.setLatest("graphics.offscreenWidth", value.offscreenWidth);
  recorder.setLatest("graphics.offscreenHeight", value.offscreenHeight);
  recorder.setLatest("graphics.drawingBufferWidth", value.drawingBufferWidth);
  recorder.setLatest("graphics.drawingBufferHeight", value.drawingBufferHeight);
  recorder.setLatest("graphics.antialias", value.antialias);
  recorder.setLatest("graphics.samples", value.samples);
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
  });
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

export function recordRendererMetrics(value: RendererMetrics): void {
  recorder.count("renderer.raf", value.rafCount);
  recorder.count("renderer.rafOver33", value.rafOver33);
  recorder.count("renderer.rafOver50", value.rafOver50);
  recorder.count("renderer.swaps", value.swapCount);
  recorder.count("renderer.presentationFailures", value.presentationFailures);
  recorder.count("snapshot.reads", value.snapshotReads);
  recorder.count("snapshot.bytes", value.snapshotBytes);
  recorder.count("snapshot.readsFromMemory", value.snapshotMemoryReads);
  recorder.count("cache.memoryHits", value.memoryHits);
  recorder.count("cache.nativeHits", value.nativeHits);
  recorder.count("cache.coalesced", value.coalesced);
  recorder.count("gl.programQueryHits", value.glProgramQueryHits);
  recorder.count("gl.programQueryMisses", value.glProgramQueryMisses);
  recorder.count("socket.rendererSendCalls", value.socketSendCalls);
  recorder.count("socket.rendererPayloadBytes", value.socketPayloadBytes);
  recorder.setPeak(
    "socket.rendererPeakSourceBackingBytes",
    value.socketSourceBackingMaxBytes,
  );
  recorder.count("socket.rendererCompactBytes", value.socketCompactBytes);
  recorder.count("socket.rendererSettles", value.socketSettles);
  recorder.count("diagnostics.rendererDropped", value.droppedRecords);
  for (const event of value.rendererEvents) {
    recorder.count(`renderer.event.${event.name}`);
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
        recordEvent(
          { k: event.name, fingerprint },
          { timestampUs: Math.round(event.timestampUs) },
        );
        break;
    }
  }
  for (const { name } of RENDERER_HISTOGRAMS) {
    recorder.mergeHistogram(RENDERER_HISTOGRAM_NAMES[name], value[name]);
  }
  recorder.setLatest("renderer.visible", value.visible);
  recorder.setLatest("renderer.focused", value.focused);
  recorder.setLatest("renderer.memoryCacheBytes", value.memoryCacheBytes);
  recorder.setLatest("renderer.memoryCacheChunks", value.memoryCacheChunks);
  recorder.setLatest("renderer.pendingChunks", value.pendingChunks);
  recorder.setLatest("snapshot.activeDemand", value.activeDemand);
  recorder.setLatest("snapshot.activePrefetch", value.activePrefetch);
  recorder.setLatest("snapshot.queuedDemand", value.queuedDemand);
  recorder.setLatest("snapshot.queuedPrefetch", value.queuedPrefetch);
  recorder.setPeak("renderer.peakMemoryCacheBytes", value.memoryCacheBytes);
  recorder.setPeak("renderer.peakPendingChunks", value.pendingChunks);
  recorder.setPeak(
    "snapshot.peakQueueDepth",
    value.queuedDemand + value.queuedPrefetch,
  );
  recorder.count("cache.evictions", value.cacheEvictions);
  recorder.count("snapshot.queuePromotions", value.queuePromotions);
  recorder.setLatest(
    "renderer.submittedFps",
    value.intervalMs
      ? Math.round(
          ((value.swapCount - value.presentationFailures) * 1_000) /
            value.intervalMs,
        )
      : 0,
  );
  if (activeCaptureLevel() > 0) {
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
    });
  }
}

export async function recordRendererFrames(value: RendererFrameBatch): Promise<void> {
  if (activeCaptureLevel() === 0) return;
  await recorder.appendFrames(value);
}

export function recordClockOffset(offsetUs: number, rttUs: number): void {
  rendererClockOffsetUs = offsetUs;
  rendererClockSynchronized = true;
  recorder.setLatest("renderer.clockOffsetUs", Math.round(offsetUs));
  recorder.setLatest("renderer.clockRttUs", Math.round(rttUs));
  logEvent({ k: "clock.synchronized",
    offsetUs: Math.round(offsetUs),
    rttUs: Math.round(rttUs),
  });
}

export function recordRendererMilestone(
  name: RendererMilestone,
  rendererTimestampUs: number,
  fields?: RendererMilestoneFields,
): void {
  const timestampUs = rendererClockSynchronized
    ? Math.max(0, Math.round(rendererTimestampUs + rendererClockOffsetUs))
    : recorder.timestampUs();
  recorder.setLatest(`milestone.${name}Us`, timestampUs);
  if (name === "build.info" && fields && "programId" in fields) {
    recorder.setLatest("client.programId", fields.programId);
    recorder.setLatest("client.buildId", fields.buildId);
  }
  if (name === "wasm.abort") {
    // IPC validation guarantees these fields for this name; a call without
    // them is unreachable and recording a reasonless abort would be a lie.
    if (!fields || !("reasonKind" in fields)) return;
    // The run-scoped crash tally the loading overlay reads back through
    // diagnostics.current() to decide first-crash vs repeated-crash copy.
    // The renderer records one crash per client launch, so this counts
    // launches that crashed, not abort re-entries.
    recorder.count("wasm.crashes");
    recordEvent(
      {
        k: "wasm.abort",
        clockSynchronized: rendererClockSynchronized,
        reasonKind: fields.reasonKind,
        fingerprint: asRendererFingerprint(fields.fingerprint),
      },
      { timestampUs },
    );
    return;
  }
  if (name === "wasm.exit") {
    if (!fields || !("code" in fields)) return;
    recorder.count("wasm.crashes");
    recordEvent(
      {
        k: "wasm.exit",
        clockSynchronized: rendererClockSynchronized,
        code: fields.code,
      },
      { timestampUs },
    );
    return;
  }
  if (name === "enhancement.installed") {
    if (!fields || !("capabilityProfile" in fields)) return;
    // IPC validated the shape; membership in the closed profile vocabulary is
    // this recorder's gate. An unknown profile is dropped, not recorded.
    const profile = fields.capabilityProfile;
    if (!Object.hasOwn(ENHANCEMENT_CAPABILITY_PROFILES, profile)) return;
    recordEvent(
      {
        k: "enhancement.installed",
        clockSynchronized: rendererClockSynchronized,
        companionAbi: fields.companionAbi,
        installation: fields.installation,
        capabilityProfile: profile as EnhancementCapabilityProfile,
      },
      { timestampUs },
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
        clockSynchronized: rendererClockSynchronized,
        installation: fields.installation,
      },
      { timestampUs },
    );
    return;
  }
  recordEvent(
    { k: name, clockSynchronized: rendererClockSynchronized },
    { timestampUs },
  );
}
