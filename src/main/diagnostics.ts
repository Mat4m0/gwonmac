import { randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import {
  chmod,
  copyFile,
  mkdir,
  open,
  readdir,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { arch, cpus, platform, release, totalmem } from "node:os";
import path from "node:path";
import { monitorEventLoopDelay, performance } from "node:perf_hooks";
import {
  app,
  contentTracing,
  dialog,
  powerMonitor,
  screen,
  type BrowserWindow,
} from "electron";
import type {
  AppSettings,
  GraphicsDiagnostics,
  RendererCommand,
} from "../shared/contracts.js";
import { errorCode, type ErrorCode } from "../shared/errors.js";
import type {
  DiagnosticSummary,
  RendererFrameBatch,
  RendererMilestone,
  RendererMilestoneFields,
  RendererMetrics,
} from "../shared/diagnostics.js";
import { gamePaths } from "./paths.js";
import {
  NATIVE_CAPABILITY_UNKNOWN,
  NATIVE_CAPABILITY_UNAVAILABLE,
  nativePowerCapabilities,
  readNativeCapability,
} from "./core/power-capabilities.js";
import { loadSettings } from "./core/settings.js";
import { writeDiagnosticZip } from "./core/diagnostic-zip.js";
import type { ProxyRoute } from "./core/proxy-routes.js";
import { sendRendererCommand } from "./renderer-commands.js";
import {
  FlightRecorder,
  runtimeVersions as versions,
  type CaptureMetadata,
} from "./diagnostic-recorder.js";
import {
  buildDiagnosticReport,
  previousAbnormalSession,
} from "./diagnostic-report.js";
import {
  inspectEventLog,
  type RedactionResult,
} from "./diagnostics/detector.js";
import {
  asAppVersion,
  asRendererFingerprint,
  type DiagnosticEvent,
} from "./diagnostics/schema.js";
import type { Digest } from "../shared/digest.js";
import {
  redactDiagnosticText as redactText,
  redactTraceStream,
} from "./diagnostics/text-scan.js";

const SAMPLE_INTERVAL_MS = 1_000;
const PROCESS_SAMPLE_INTERVAL = 5;

const recorder = new FlightRecorder();
let graphics: GraphicsDiagnostics | null = null;
let environment: Record<string, unknown> = {};
let captureLevel: 0 | 1 | 2 = 0;
let recordedCaptureLevel: 0 | 1 | 2 = 0;
let sampler: ReturnType<typeof setInterval> | null = null;
let sampleNumber = 0;
let tracePath = "";
let lastTracePath = "";

let traceGuard: ReturnType<typeof setInterval> | null = null;
let captureTimer: ReturnType<typeof setTimeout> | null = null;
let captureStopPromise: Promise<void> | null = null;
let captureStartPromise: Promise<void> | null = null;
let rendererClockOffsetUs = 0;
let rendererClockSynchronized = false;
let previousMainCpu = process.cpuUsage();
let previousMainCpuTimestampUs = 0;
const eventLoop = monitorEventLoopDelay({ resolution: 5 });
let previousEventLoopUtilization = performance.eventLoopUtilization();
let eventLoopWindowStartedUs = 0;
let captureStoppedHandler: (() => void | Promise<void>) | null = null;
let captureTarget: BrowserWindow | null = null;
let captureTargetLost: (() => void) | null = null;

/**
 * The renderer half of a capture. `level` crosses as a number inside a typed
 * event rather than spliced into a string of JavaScript, and the target window
 * is chosen by the same trust test the inbound direction uses.
 */
const rendererCaptureCommand = (
  target: BrowserWindow | null,
  command: Extract<RendererCommand, { type: "diagnostics.capture" }>,
): Promise<void> =>
  sendRendererCommand(target, command).then((outcome) => {
    if (outcome !== "completed") {
      logEvent({
        k: "renderer.commandIncomplete",
        action: command.action,
        outcome,
      });
    }
  });

/**
 * The only way to record an event that carries information about a failure.
 * The event owns its name, subsystem, level and fields, so two producers of
 * one event cannot disagree, and no field of one can hold free text.
 */
interface EventDetail {
  durationUs?: number;
  traceId?: string;
  spanId?: string;
  timestampUs?: number;
}

function recordEvent(event: DiagnosticEvent, detail: EventDetail = {}): void {
  recorder.record(event, detail);
}

/** The only public event-recording API. */
export function logEvent(event: DiagnosticEvent): void {
  recordEvent(event);
}

export function count(name: string, delta = 1): void {
  recorder.count(name, delta);
}

export function observe(name: string, durationUs: number): void {
  recorder.observe(name, durationUs);
}

export function gauge(
  name: string,
  value: string | number | boolean | null,
): void {
  recorder.setLatest(name, value);
}

export function peakGauge(name: string, value: number): void {
  recorder.setPeak(name, value);
}

export function markPerformanceProblem(target: BrowserWindow): void {
  logEvent({ k: "performance.problemMarked" });
  void rendererCaptureCommand(target, {
    type: "diagnostics.capture",
    action: "problem-marked",
  });
}

export function setDiagnosticCaptureStoppedHandler(
  handler: (() => void | Promise<void>) | null,
): void {
  captureStoppedHandler = handler;
}

export interface ClosedDiagnosticSpan<End> {
  readonly traceId: string;
  readonly spanId: string;
  end(outcome: End): number;
}

function closedSpan<End>(
  begin: DiagnosticEvent,
  finish: (outcome: End) => DiagnosticEvent,
  histogram: string,
  recordEvents = true,
): ClosedDiagnosticSpan<End> {
  const started = recorder.timestampUs();
  const traceId = randomUUID();
  const spanId = randomUUID();
  if (recordEvents) recordEvent(begin, { traceId, spanId });
  let ended = false;
  return {
    traceId,
    spanId,
    end(outcome) {
      if (ended) return 0;
      ended = true;
      const durationUs = recorder.timestampUs() - started;
      recorder.observe(histogram, durationUs);
      if (recordEvents || durationUs >= 50_000) {
        recordEvent(finish(outcome), { durationUs, traceId, spanId });
      }
      return durationUs;
    },
  };
}

export function startDnsResolveSpan(): ClosedDiagnosticSpan<
  | { status: "ok"; code: null }
  | { status: "error"; code: ErrorCode }
> {
  return closedSpan(
    { k: "dns.resolve.begin" },
    (outcome) => ({ k: "dns.resolve.end", ...outcome }),
    "dns.resolve",
  );
}

export type ClientUpdateSpanOutcome =
  | {
      status: "rejectedCandidateSkipped" | "candidate" | "ready";
      code: null;
      fingerprint: Digest | null;
    }
  | {
      status: "cachedFallback" | "error";
      code: ErrorCode;
      fingerprint: null;
    }
  | {
      status: "cancelled";
      code: null;
      fingerprint: null;
    };

export function startClientUpdateSpan(): ClosedDiagnosticSpan<ClientUpdateSpanOutcome> {
  return closedSpan(
    { k: "update.clientUpdate.begin" },
    (outcome) => ({ k: "update.clientUpdate.end", ...outcome }),
    "update.clientUpdate",
  );
}

export interface SnapshotReadSpanStart {
  offsetBytes: number;
  requestedBytes: number;
  priority: "demand" | "prefetch";
}

export type SnapshotReadSpanOutcome =
  | { returnedBytes: number; status: 206; code: null }
  | { returnedBytes: 0; status: 503; code: ErrorCode };

export function startSnapshotReadSpan(
  start: SnapshotReadSpanStart,
): ClosedDiagnosticSpan<SnapshotReadSpanOutcome> {
  return closedSpan(
    { k: "snapshot.read.begin", ...start },
    (outcome) => ({ k: "snapshot.read.end", ...start, ...outcome }),
    "snapshot.read",
    captureLevel > 0,
  );
}

export interface ProxyRequestSpanStart {
  route: ProxyRoute;
  method: "GET" | "POST" | "PUT";
}

export type ProxyRequestSpanOutcome =
  | { status: number; reason: null; code: null }
  | { status: 413; reason: "bodyTooLarge"; code: null }
  | { status: 502; reason: "redirectEscape"; code: null }
  | { status: 502; reason: null; code: ErrorCode };

export function startProxyRequestSpan(
  start: ProxyRequestSpanStart,
): ClosedDiagnosticSpan<ProxyRequestSpanOutcome> {
  return closedSpan(
    { k: "proxy.request.begin", ...start },
    (outcome) => ({ k: "proxy.request.end", ...start, ...outcome }),
    "proxy.request",
  );
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
  recorder.mergeHistogram(
    "renderer.rafInterval",
    value.rafHistogram,
    value.rafTotalUs,
    value.rafMinUs,
    value.rafMaxUs,
  );
  if (value.swapCount) {
    recorder.mergeHistogram(
      "renderer.swap",
      value.swapHistogram,
      value.swapTotalUs,
      value.swapMinUs,
      value.swapMaxUs,
    );
    recorder.mergeHistogram(
      "renderer.bitmapOut",
      value.bitmapOutHistogram,
      value.bitmapOutTotalUs,
      value.bitmapOutMinUs,
      value.bitmapOutMaxUs,
    );
    recorder.mergeHistogram(
      "renderer.bitmapPresent",
      value.bitmapPresentHistogram,
      value.bitmapPresentTotalUs,
      value.bitmapPresentMinUs,
      value.bitmapPresentMaxUs,
    );
  }
  recorder.mergeHistogram(
    "renderer.submitInterval",
    value.submitIntervalHistogram,
    value.submitIntervalTotalUs,
    value.submitIntervalMinUs,
    value.submitIntervalMaxUs,
  );
  recorder.mergeHistogram(
    "renderer.visibleSubmitInterval",
    value.visibleSubmitIntervalHistogram,
    value.visibleSubmitIntervalTotalUs,
    value.visibleSubmitIntervalMinUs,
    value.visibleSubmitIntervalMaxUs,
  );
  recorder.mergeHistogram(
    "renderer.hiddenSubmitInterval",
    value.hiddenSubmitIntervalHistogram,
    value.hiddenSubmitIntervalTotalUs,
    value.hiddenSubmitIntervalMinUs,
    value.hiddenSubmitIntervalMaxUs,
  );
  recorder.mergeHistogram(
    "snapshot.rendererRead",
    value.snapshotHistogram,
    value.snapshotTotalUs,
    value.snapshotMinUs,
    value.snapshotMaxUs,
  );
  recorder.mergeHistogram(
    "socket.rendererSync",
    value.socketSyncHistogram,
    value.socketSyncTotalUs,
    value.socketSyncMinUs,
    value.socketSyncMaxUs,
  );
  recorder.mergeHistogram(
    "socket.rendererSettle",
    value.socketSettleHistogram,
    value.socketSettleTotalUs,
    value.socketSettleMinUs,
    value.socketSettleMaxUs,
  );
  recorder.mergeHistogram(
    "renderer.inputToSubmit",
    value.inputToSubmitHistogram,
    value.inputToSubmitTotalUs,
    value.inputToSubmitMinUs,
    value.inputToSubmitMaxUs,
  );
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
  if (captureLevel > 0) {
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
      rafMaxUs: Math.round(value.rafMaxUs),
      swapCount: value.swapCount,
      presentationFailures: value.presentationFailures,
      swapMaxUs: Math.round(value.swapMaxUs),
      submitIntervalMaxUs: Math.round(value.submitIntervalMaxUs),
      snapshotReads: value.snapshotReads,
      snapshotBytes: value.snapshotBytes,
      snapshotMaxUs: Math.round(value.snapshotMaxUs),
      inputToSubmitCount: value.inputToSubmitCount,
      inputToSubmitMaxUs: Math.round(value.inputToSubmitMaxUs),
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
      socketSyncMaxUs: Math.round(value.socketSyncMaxUs),
      socketSettles: value.socketSettles,
      socketSettleMaxUs: Math.round(value.socketSettleMaxUs),
      droppedRecords: value.droppedRecords,
    });
  }
}

export async function recordRendererFrames(value: RendererFrameBatch): Promise<void> {
  if (captureLevel === 0) return;
  await recorder.appendFrames(value);
}

export function diagnosticSummary(): DiagnosticSummary {
  return recorder.summary(captureLevel);
}

export function diagnosticTimestampUs(): number {
  return recorder.timestampUs();
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
  if (name === "build.info" && fields) {
    recorder.setLatest("client.programId", fields.programId);
    recorder.setLatest("client.buildId", fields.buildId);
  }
  recordEvent(
    { k: name, clockSynchronized: rendererClockSynchronized },
    { timestampUs },
  );
}

async function stopTrace(): Promise<boolean> {
  if (!tracePath) return false;
  if (traceGuard) clearInterval(traceGuard);
  traceGuard = null;
  const target = tracePath;
  try {
    await contentTracing.stopRecording(target);
    tracePath = "";
    lastTracePath = target;
    // Size is the first thing anyone asks after an export goes wrong.
    const bytes = await stat(target).then((info) => info.size, () => 0);
    recorder.setLatest("capture.traceBytes", bytes);
    logEvent({ k: "chromiumTrace.stopped", bytes });
    return true;
  } catch (err) {
    logEvent({ k: "chromiumTrace.stopFailed", code: errorCode(err) });
    // A failed stop cannot produce a trustworthy Chromium trace. Delete the
    // exact target now, but retain it in `tracePath` if deletion itself fails
    // so quit or the next capture can retry instead of orphaning it.
    try {
      await rm(target, { force: true });
      tracePath = "";
    } catch {
      // The target remains tracked. A new capture refuses to replace it until
      // `discardTrace` can remove it.
    }
    return false;
  }
}

export function startDiagnosticCapture(
  target: BrowserWindow,
  level: 1 | 2,
): Promise<void> {
  if (captureLevel !== 0 || captureStopPromise || captureStartPromise) {
    return Promise.reject(new Error("a diagnostics capture is already active"));
  }
  if (
    target.isDestroyed()
    || target.webContents.isDestroyed()
    || target.webContents.isCrashed()
  ) {
    return Promise.reject(new Error("diagnostics target is unavailable"));
  }
  captureTarget = target;
  const targetLost = (): void => {
    void stopDiagnosticCapture("target-lost");
  };
  captureTargetLost = targetLost;
  target.webContents.once("destroyed", targetLost);
  target.webContents.once("render-process-gone", targetLost);
  const operation = (async () => {
    // Beginning a capture replaces the previous capture result. Its raw trace
    // must be deleted first; clearing only the pointer would orphan a file that
    // can contain Chromium process data.
    await discardTrace();
    await rendererCaptureCommand(target, {
      type: "diagnostics.capture",
      action: "reset",
    });
    await recorder.beginCapture();
    eventLoop.reset();
    previousEventLoopUtilization = performance.eventLoopUtilization();
    eventLoopWindowStartedUs = recorder.timestampUs();
    captureLevel = level;
    await rendererCaptureCommand(target, {
      type: "diagnostics.capture",
      action: "started",
      level,
    });
    captureTimer = setTimeout(() => {
      void stopDiagnosticCapture("automatic");
    }, 120_000);
    logEvent({ k: "capture.started", level });
    recordedCaptureLevel = level;
    if (level !== 2) return;

    try {
      const available = new Set(await contentTracing.getCategories());
      const wanted = [
        "electron",
        "blink",
        "blink.user_timing",
        "cc",
        "gpu",
        "viz",
        "net",
        "v8",
        "disabled-by-default-v8.cpu_profiler",
      ];
      const included = wanted.filter((category) => available.has(category));
      tracePath = path.join(
        gamePaths().diagnostics,
        `chromium-${recorder.sessionId}.json`,
      );
      await contentTracing.startRecording({
        included_categories: included,
        recording_mode: "record-until-full",
        trace_buffer_size_in_kb: 256 * 1024,
        enable_argument_filter: true,
      });
      traceGuard = setInterval(() => {
        void contentTracing.getTraceBufferUsage().then((usage) => {
          if (usage.percentage >= 0.8) {
            void stopDiagnosticCapture("buffer-full");
          }
        });
      }, 1_000);
    } catch (error) {
      if (captureTimer) clearTimeout(captureTimer);
      captureTimer = null;
      captureLevel = 0;
      await rendererCaptureCommand(target, {
        type: "diagnostics.capture",
        action: "stopped",
      });
      // `startRecording` may have created the target before rejecting. Remove
      // it by the tracked exact path; if cleanup itself fails, keep the pointer
      // so shutdown or the next capture can retry.
      await discardTrace().catch(() => undefined);
      recordedCaptureLevel = 0;
      recorder.cancelCapture();
      logEvent({ k: "chromiumTrace.startFailed", code: errorCode(error) });
      throw error;
    }
  })();
  captureStartPromise = operation.finally(() => {
    captureStartPromise = null;
    if (captureLevel === 0) {
      target.webContents.off("destroyed", targetLost);
      target.webContents.off("render-process-gone", targetLost);
      if (captureTarget === target) captureTarget = null;
      if (captureTargetLost === targetLost) captureTargetLost = null;
    }
  });
  return captureStartPromise;
}

export function stopDiagnosticCapture(
  reason: CaptureMetadata["stopReason"] = "manual",
): Promise<void> {
  if (captureStopPromise) return captureStopPromise;
  if (captureStartPromise) {
    return captureStartPromise.then(
      () => stopDiagnosticCapture(reason),
      () => undefined,
    );
  }
  if (captureLevel === 0) return Promise.resolve();
  const stoppedLevel = captureLevel;
  const target = captureTarget;
  captureStopPromise = (async () => {
    if (captureTimer) clearTimeout(captureTimer);
    captureTimer = null;
    await rendererCaptureCommand(target, {
      type: "diagnostics.capture",
      action: "flush",
    });
    const traceCompleted = await stopTrace();
    const completedLevel =
      stoppedLevel === 2 && !traceCompleted ? 1 : stoppedLevel;
    recordedCaptureLevel = completedLevel;
    logEvent({ k: "capture.stopped",
      level: completedLevel,
      reason,
    });
    recorder.endCapture(completedLevel, reason);
    captureLevel = 0;
    await rendererCaptureCommand(target, {
        type: "diagnostics.capture",
        action: "stopped",
      });
    if (
      captureStoppedHandler &&
      (reason === "manual" ||
        reason === "automatic" ||
        reason === "buffer-full")
    ) {
      queueMicrotask(() => void captureStoppedHandler?.());
    }
  })().finally(() => {
    captureStopPromise = null;
    if (target && captureTargetLost) {
      target.webContents.off("destroyed", captureTargetLost);
      target.webContents.off("render-process-gone", captureTargetLost);
    }
    captureTarget = null;
    captureTargetLost = null;
  });
  return captureStopPromise;
}

function sampleProcesses(): void {
  sampleNumber += 1;
  const detailedSample =
    sampleNumber % PROCESS_SAMPLE_INTERVAL === 0;
  const timestampUs = recorder.timestampUs();
  const currentCpu = process.cpuUsage();
  const cpu = {
    user: currentCpu.user - previousMainCpu.user,
    system: currentCpu.system - previousMainCpu.system,
  };
  previousMainCpu = currentCpu;
  const elapsedUs = timestampUs - previousMainCpuTimestampUs;
  previousMainCpuTimestampUs = timestampUs;
  const mainCpuPercent = elapsedUs
    ? ((cpu.user + cpu.system) / elapsedUs) * 100
    : 0;
  const own = process.memoryUsage();
  recorder.count("process.main.cpuPercentOneCoreSum", mainCpuPercent);
  recorder.count("process.main.cpuSamples");
  recorder.setLatest("process.main.cpuPercentOneCore", mainCpuPercent);
  recorder.setLatest("main.rssBytes", own.rss);
  recorder.setPeak("main.peakRssBytes", own.rss);
  recorder.setLatest("main.heapUsedBytes", own.heapUsed);
  recorder.setLatest("main.externalBytes", own.external);
  recorder.setLatest("main.arrayBuffersBytes", own.arrayBuffers);
  recorder.setPeak("main.peakExternalBytes", own.external);
  recorder.setPeak("main.peakArrayBuffersBytes", own.arrayBuffers);
  if (detailedSample) {
    logEvent({ k: "process.main",
      cpuPercentOneCore: mainCpuPercent,
      rssBytes: own.rss,
      heapUsedBytes: own.heapUsed,
      heapTotalBytes: own.heapTotal,
      externalBytes: own.external,
      arrayBuffersBytes: own.arrayBuffers,
    });
  }

  if (!detailedSample) return;
  const aggregates = new Map<string, { cpuPercent: number; rssBytes: number }>();
  for (const metric of app.getAppMetrics()) {
    const prefix = `process.${metric.type.toLowerCase()}`;
    recorder.setLatest(
      `${prefix}.cpuPercentElectron`,
      metric.cpu.percentCPUUsage,
    );
    recorder.setLatest(`${prefix}.rssBytes`, metric.memory.workingSetSize * 1_024);
    logEvent({ k: "process.chromium",
      pid: metric.pid,
      cpuPercentElectron: metric.cpu.percentCPUUsage,
      idleWakeupsPerSecond: metric.cpu.idleWakeupsPerSecond,
      rssBytes: metric.memory.workingSetSize * 1_024,
      privateBytes: (metric.memory.privateBytes ?? 0) * 1_024,
      sandboxed: metric.sandboxed ?? false,
    });
    const aggregate = aggregates.get(prefix) ?? { cpuPercent: 0, rssBytes: 0 };
    aggregate.cpuPercent += metric.cpu.percentCPUUsage;
    aggregate.rssBytes += metric.memory.workingSetSize * 1_024;
    aggregates.set(prefix, aggregate);
  }
  for (const [prefix, aggregate] of aggregates) {
    recorder.count(`${prefix}.cpuPercentElectronSum`, aggregate.cpuPercent);
    recorder.count(`${prefix}.cpuSamples`);
    recorder.setLatest(`${prefix}.cpuPercentElectron`, aggregate.cpuPercent);
    recorder.setLatest(`${prefix}.rssBytes`, aggregate.rssBytes);
    recorder.setPeak(`${prefix}.peakRssBytes`, aggregate.rssBytes);
  }
}

function sampleEventLoop(): void {
  const sampledAtUs = recorder.timestampUs();
  if (
    sampledAtUs - eventLoopWindowStartedUs <
    PROCESS_SAMPLE_INTERVAL * SAMPLE_INTERVAL_MS * 1_000
  ) {
    return;
  }
  const meanUs = Number.isFinite(eventLoop.mean) ? eventLoop.mean / 1_000 : 0;
  const p95Us = eventLoop.percentile(95) / 1_000;
  const p99Us = eventLoop.percentile(99) / 1_000;
  const maxUs = eventLoop.max / 1_000;
  recorder.setLatest("main.eventLoopMeanUs", Math.round(meanUs));
  recorder.setLatest("main.eventLoopP95Us", Math.round(p95Us));
  recorder.setLatest("main.eventLoopP99Us", Math.round(p99Us));
  recorder.setLatest("main.eventLoopMaxUs", Math.round(maxUs));
  recorder.observe("main.eventLoopMean", meanUs);
  recorder.observe("main.eventLoopP95", p95Us);
  recorder.observe("main.eventLoopP99", p99Us);
  recorder.observe("main.eventLoopMax", maxUs);
  const currentUtilization = performance.eventLoopUtilization();
  const utilization = performance.eventLoopUtilization(
    currentUtilization,
    previousEventLoopUtilization,
  );
  previousEventLoopUtilization = currentUtilization;
  recorder.setLatest("main.eventLoopUtilization", utilization.utilization);
  logEvent({ k: "eventLoop.sample",
    windowMs: Math.round((sampledAtUs - eventLoopWindowStartedUs) / 1_000),
    resolutionMs: 5,
    meanUs: Math.round(meanUs),
    p95Us: Math.round(p95Us),
    p99Us: Math.round(p99Us),
    maxUs: Math.round(maxUs),
    utilization: utilization.utilization,
  });
  eventLoop.reset();
  eventLoopWindowStartedUs = sampledAtUs;
}

/**
 * The recorder owns the diagnostics directory outright, and the only entries
 * that must outlive a launch are earlier sessions' JSONL. A whitelist is the
 * rule: prefix matching missed Chromium's `.<bundle-id>.XXXXXX` atomic-write
 * temporaries, which left a truncated 111 MB trace behind for days.
 */
function staleDiagnosticEntries(names: string[]): string[] {
  return names.filter((name) => !/^session-.+\.jsonl$/.test(name));
}

/**
 * Sampled at export, not at ready: the GPU process does not exist when the
 * recorder starts, so Chromium answers with pre-initialization defaults that
 * read as software rendering. If the process has since died, "disabled" is
 * then the truth, and that is exactly what the reader needs.
 */
async function gpuEnvironment(): Promise<Record<string, unknown>> {
  return {
    featureStatus: app.getGPUFeatureStatus(),
    info: await app.getGPUInfo("basic").catch(() => null),
  };
}

export async function startDiagnostics(): Promise<void> {
  const diagnosticsDir = gamePaths().diagnostics;
  const staleCaptures = staleDiagnosticEntries(
    await readdir(diagnosticsDir).catch(() => []),
  ).map((name) => path.join(diagnosticsDir, name));
  await Promise.all(
    staleCaptures.map((file) => rm(file, { recursive: true, force: true })),
  );
  eventLoop.enable();
  previousEventLoopUtilization = performance.eventLoopUtilization();
  eventLoopWindowStartedUs = recorder.timestampUs();
  previousMainCpu = process.cpuUsage();
  previousMainCpuTimestampUs = recorder.timestampUs();
  recorder.setLatest("milestone.electronReadyUs", recorder.timestampUs());
  const display = screen.getPrimaryDisplay();
  environment = {
    platform: platform(),
    osRelease: release(),
    architecture: arch(),
    cpuModel: cpus()[0]?.model ?? "unknown",
    logicalCpuCount: cpus().length,
    totalMemoryBytes: totalmem(),
    primaryDisplay: {
      width: display.size.width,
      height: display.size.height,
      scaleFactor: display.scaleFactor,
      refreshRateHz: display.displayFrequency,
      internal: display.internal,
    },
    appVersion: app.getVersion(),
    versions: versions(),
    startedAt: recorder.startedWall,
  };
  logEvent({ k: "diagnostics.started", appVersion: asAppVersion(app.getVersion()) });
  const powerCapabilities = nativePowerCapabilities(process.platform);
  recorder.setLatest(
    "system.thermalState",
    readNativeCapability(
      powerCapabilities.thermalState,
      () => powerMonitor.getCurrentThermalState(),
    ),
  );
  recorder.setLatest(
    "system.onBattery",
    readNativeCapability(
      powerCapabilities.batteryState,
      () => powerMonitor.isOnBatteryPower(),
    ),
  );
  recorder.setLatest(
    "system.cpuSpeedLimitPercent",
    powerCapabilities.cpuSpeedLimitEvents
      ? NATIVE_CAPABILITY_UNKNOWN
      : NATIVE_CAPABILITY_UNAVAILABLE,
  );
  if (powerCapabilities.batteryEvents) {
    powerMonitor.on("on-battery", () => {
      recorder.setLatest("system.onBattery", true);
      logEvent({ k: "power.onBattery" });
    });
    powerMonitor.on("on-ac", () => {
      recorder.setLatest("system.onBattery", false);
      logEvent({ k: "power.onAc" });
    });
  }
  powerMonitor.on("suspend", () => logEvent({ k: "power.suspend" }));
  powerMonitor.on("resume", () => logEvent({ k: "power.resume" }));
  if (powerCapabilities.thermalState) {
    powerMonitor.on("thermal-state-change", ({ state }) => {
      recorder.setLatest("system.thermalState", state);
      logEvent({
        k:
          state === "serious" || state === "critical"
            ? "thermal.pressure"
            : "thermal.changed",
        state,
      });
    });
  }
  if (powerCapabilities.cpuSpeedLimitEvents) {
    powerMonitor.on("speed-limit-change", ({ limit }) => {
      recorder.setLatest("system.cpuSpeedLimitPercent", limit);
      logEvent({
        k: limit < 100 ? "cpuSpeedLimit.reduced" : "cpuSpeedLimit.restored",
        limit,
      });
    });
  }
  sampler = setInterval(() => {
    sampleProcesses();
    sampleEventLoop();
  }, SAMPLE_INTERVAL_MS);
}

/**
 * A Level 2 trace is tens to hundreds of megabytes. Remove it by the exact
 * path we hold — never a glob, and never anything a session still needs.
 */
async function discardTrace(): Promise<void> {
  const targets = [...new Set([tracePath, lastTracePath].filter(Boolean))];
  for (const target of targets) {
    // Clear a pointer only after its exact target is gone. In particular,
    // starting another Level 2 capture must not overwrite the only reference
    // to a partial target left by a failed stop.
    await rm(target, { force: true });
    if (tracePath === target) tracePath = "";
    if (lastTracePath === target) lastTracePath = "";
  }
}

export async function stopDiagnostics(): Promise<void> {
  if (sampler) clearInterval(sampler);
  sampler = null;
  eventLoop.disable();
  await stopDiagnosticCapture("shutdown");
  await recorder.flush();
  // A session that is never exported still bounds itself at quit rather than
  // waiting for the next launch to sweep.
  await discardTrace();
}

export async function flushDiagnostics(): Promise<void> {
  await recorder.flush();
}

/**
 * The Chromium trace is the one document nobody here authored, so it is the
 * one a pattern scanner is the right tool for. `redactTraceStream` owns the
 * chunk boundary — the place a streaming redactor leaks — and this owns the
 * files. It returns the bytes it scanned, because the manifest states what
 * was covered rather than asserting a verdict about it.
 */
async function sanitizeTraceFile(
  source: string,
  target: string,
): Promise<number> {
  const input: AsyncIterable<string> = createReadStream(source, {
    encoding: "utf8",
    highWaterMark: 1024 * 1024,
  });
  const output = await open(target, "w", 0o600);
  let scanned = 0;
  async function* counted(): AsyncGenerator<string> {
    for await (const chunk of input) {
      scanned += Buffer.byteLength(chunk);
      yield chunk;
    }
  }
  try {
    for await (const text of redactTraceStream(counted())) {
      await output.write(text);
    }
  } finally {
    await output.close();
  }
  return scanned;
}

export async function exportDiagnosticsZip(
  targetPath: string,
  extras: {
    appVersion: string;
    electronVersions: Record<string, string>;
    settings: AppSettings;
  },
): Promise<string> {
  if (captureLevel !== 0) await stopDiagnosticCapture("export");
  await recorder.flush();
  const dir = gamePaths().diagnostics;
  const staging = path.join(dir, `export-${randomUUID()}`);
  const zipPath = /\.(gwdiag|zip)$/i.test(targetPath) ? targetPath : `${targetPath}.gwdiag`;
  const zipPart = path.join(
    path.dirname(zipPath),
    `.${path.basename(zipPath)}.${randomUUID()}.part`,
  );
  await mkdir(staging, { recursive: true, mode: 0o700 });
  try {
    const summary = recorder.summary(recordedCaptureLevel);
    const exportedEvents = await recorder.exportedEvents();
    const capture = recorder.captureResult();
    const previous = await previousAbnormalSession(dir, recorder.sessionId);
    // P2.4 — the detector runs before anything is written, and it throws. An
    // event this build cannot account for stops the export rather than being
    // scrubbed on the way out.
    const inspection = inspectEventLog(exportedEvents.text);
    const files: string[] = [
      "manifest.json",
      "report.json",
      "summary.json",
      "events.jsonl",
      "environment.json",
      "settings-redacted.json",
    ];
    if (previous) files.push("previous-events.jsonl");
    if (capture) files.push("capture-summary.json");
    const framePath = recorder.framePath();
    if (framePath) {
      await copyFile(framePath, path.join(staging, "frames.bin"));
      files.push("frames.bin");
    }
    let traceBytesScanned = 0;
    if (lastTracePath) {
      traceBytesScanned = await sanitizeTraceFile(
        lastTracePath,
        path.join(staging, "chromium-trace.json"),
      );
      files.push("chromium-trace.json");
    }
    const manifest = {
      // 2 — `histograms.json` is gone (it duplicated `summary.json`) and
      // `redaction` is the detector's result rather than the word "passed".
      formatVersion: 2,
      applicationVersion: extras.appVersion,
      sessionId: recorder.sessionId,
      captureLevel: recordedCaptureLevel,
      exportedAt: new Date().toISOString(),
      droppedEventCount: summary.droppedEvents,
      includedFiles: files,
      // What was checked, not a self-awarded verdict. A reader can reproduce
      // both counts by running the same closed schema over events.jsonl.
      redaction: { ...inspection, traceBytesScanned } satisfies RedactionResult,
      profilerContaminated: files.includes("chromium-trace.json"),
      eventLog: {
        completeFromStart: exportedEvents.completeFromStart,
        firstSequenceNumber: exportedEvents.firstSeq,
        lastSequenceNumber: exportedEvents.lastSeq,
        firstTimestampUs: exportedEvents.firstTimestampUs,
        lastTimestampUs: exportedEvents.lastTimestampUs,
      },
      ...(previous
        ? {
            previousSession: {
              sessionId: previous.sessionId,
              cleanShutdown: false,
              firstSequenceNumber: previous.firstSequenceNumber,
              lastSequenceNumber: previous.lastSequenceNumber,
              finalEventName: previous.finalEventName,
              abnormalReason: previous.abnormalReason,
            },
          }
        : {}),
      ...(capture
        ? {
            capture: {
              startMonotonicUs: capture.metadata.startedUs,
              endMonotonicUs: capture.metadata.endedUs,
              stopReason: capture.metadata.stopReason,
              firstSequenceNumber: capture.metadata.firstSequenceNumber,
              lastSequenceNumber: capture.metadata.lastSequenceNumber,
            },
          }
        : {}),
      ...(framePath
        ? {
            frameSchema: {
              format: "GWFRAME1",
              encoding: "little-endian float64",
              stride: 7,
              fields: [
                "timestampUs",
                "swapUs",
                "bitmapOutUs",
                "bitmapPresentUs",
                "canvasWidth",
                "canvasHeight",
                "visible",
              ],
            },
          }
        : {}),
    };
    const report = buildDiagnosticReport({
      summary,
      eventsText: exportedEvents.text,
      previous,
      capture,
      profilerContaminated: files.includes("chromium-trace.json"),
      sessionId: recorder.sessionId,
      captureLevel: recordedCaptureLevel,
    });
    // The event log is written byte for byte as the detector inspected it.
    // Redacting it afterwards would mean the file in the export is not the
    // file that was checked, and a reader could not reproduce the manifest's
    // numbers.
    const certified: Record<string, string> = {
      "events.jsonl": exportedEvents.text,
    };
    // Everything else is a summary whose leaves come from OS and Chromium
    // APIs, or a previous session written by a build whose schema we do not
    // control. The pattern scanner is the only tool that applies to those,
    // and it stays until they are schema'd too: dropping it to satisfy
    // "redactText for the trace only" would be a privacy regression rather
    // than a simplification.
    const patternScanned: Record<string, string> = {
      "manifest.json": JSON.stringify(manifest, null, 2),
      "report.json": JSON.stringify(report, null, 2),
      "summary.json": JSON.stringify(summary, null, 2),
      ...(previous ? { "previous-events.jsonl": previous.text } : {}),
      "environment.json": JSON.stringify(
        {
          ...environment,
          gpu: await gpuEnvironment(),
          graphics,
          electronVersions: extras.electronVersions,
        },
        null,
        2,
      ),
      "settings-redacted.json": JSON.stringify(extras.settings, null, 2),
      ...(capture
        ? {
            "capture-summary.json": JSON.stringify(capture.summary, null, 2),
          }
        : {}),
    };
    const documents: Record<string, string> = {
      ...certified,
      ...Object.fromEntries(
        Object.entries(patternScanned).map(([name, text]) => [
          name,
          redactText(text),
        ]),
      ),
    };
    for (const [name, text] of Object.entries(documents)) {
      const file = path.join(staging, name);
      await writeFile(file, text, { mode: 0o600 });
      await chmod(file, 0o600);
    }
    await writeDiagnosticZip(staging, zipPart);
    await chmod(zipPart, 0o600);
    await rename(zipPart, zipPath);
    // The trace deliberately survives the export. `recordedCaptureLevel` stays
    // at 2 for the rest of the session, so discarding here would make a second
    // export declare Level 2 with no trace and fail its own validation. Quit
    // and the launch sweep are what bound it.
    return zipPath;
  } finally {
    await rm(staging, { recursive: true, force: true });
    await rm(zipPart, { force: true });
  }
}

export async function exportDiagnosticsForWindow(win: BrowserWindow): Promise<string> {
  const { canceled, filePath } = await dialog.showSaveDialog(win, {
    title: "Export Diagnostics",
    defaultPath: "guild-wars-diagnostics.gwdiag",
    filters: [{ name: "Guild Wars diagnostics", extensions: ["gwdiag"] }],
  });
  if (canceled || !filePath) return "";
  return exportDiagnosticsZip(filePath, {
    appVersion: app.getVersion(),
    electronVersions: versions(),
    settings: await loadSettings(gamePaths().settings),
  });
}
