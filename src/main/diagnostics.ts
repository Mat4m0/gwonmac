import { execFile } from "node:child_process";
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
import { promisify } from "node:util";
import {
  app,
  contentTracing,
  crashReporter,
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
import { errorCode } from "../shared/errors.js";
import type {
  DiagnosticFields,
  DiagnosticLevel,
  DiagnosticSubsystem,
  DiagnosticSummary,
  RendererFrameBatch,
  RendererMilestone,
  RendererMilestoneFields,
  RendererMetrics,
} from "../shared/diagnostics.js";
import { gamePaths } from "./paths.js";
import { loadSettings } from "./core/settings.js";
import {
  canonicalRendererWindow,
  sendRendererCommand,
} from "./renderer-commands.js";
import {
  FlightRecorder,
  runtimeVersions as versions,
  type CaptureMetadata,
  type Span,
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
  diagnosticEventRecord,
  type DiagnosticEvent,
} from "./diagnostics/schema.js";
import {
  redactDiagnosticText as redactText,
  redactTraceStream,
} from "./diagnostics/text-scan.js";

const execFileAsync = promisify(execFile);
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

/**
 * The renderer half of a capture. `level` crosses as a number inside a typed
 * event rather than spliced into a string of JavaScript, and the target window
 * is chosen by the same trust test the inbound direction uses.
 */
const rendererCaptureCommand = (
  command: Extract<RendererCommand, { type: "diagnostics.capture" }>,
): Promise<void> => sendRendererCommand(canonicalRendererWindow(), command);

/**
 * The only way to record an event that carries information about a failure.
 * The event owns its name, subsystem, level and fields, so two producers of
 * one event cannot disagree, and no field of one can hold free text.
 */
export function logEvent(event: DiagnosticEvent): void {
  const record = diagnosticEventRecord(event);
  recorder.event(record.subsystem, record.level, record.name, record.fields);
}

/**
 * Milestones and counters that carry no payload beyond values this process
 * chose itself. Events join the closed schema above as they are converted;
 * nothing that quotes an error, a path or a host may use this.
 */
export function log(
  subsystem: DiagnosticSubsystem,
  level: DiagnosticLevel,
  message: string,
  fields?: DiagnosticFields,
): void {
  recorder.event(subsystem, level, message, fields);
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

export function markPerformanceProblem(): void {
  recorder.event("renderer", "info", "performance.problemMarked");
  void rendererCaptureCommand({
    type: "diagnostics.capture",
    action: "problem-marked",
  });
}

export function setDiagnosticCaptureStoppedHandler(
  handler: (() => void | Promise<void>) | null,
): void {
  captureStoppedHandler = handler;
}

export function span(
  subsystem: DiagnosticSubsystem,
  name: string,
  fields?: DiagnosticFields,
  parentSpanId?: string,
  traceId?: string,
): Span {
  return recorder.span(
    subsystem,
    name,
    fields,
    parentSpanId,
    traceId,
    subsystem !== "snapshot" || captureLevel > 0,
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
  recorder.event("graphics", "info", "graphics.detected", {
    webglVersion: value.webglVersion,
    renderer: value.renderer,
    vendor: value.vendor,
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
    const subsystem = event.name.startsWith("graphics.") ? "graphics" : "renderer";
    const level =
      event.name === "graphics.contextRestored"
        ? "info"
        : event.name === "audio.resumeFailed" ||
            event.name === "pointerLock.failed"
          ? "warn"
          : "error";
    recorder.count(`renderer.event.${event.name}`);
    recorder.event(
      subsystem,
      level,
      event.name,
      event.fingerprint ? { fingerprint: event.fingerprint } : undefined,
      { timestampUs: Math.round(event.timestampUs) },
    );
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
      recorder.event(
        "socket",
        "debug",
        "socket.rendererSend",
        {
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
    recorder.event("renderer", "debug", "renderer.metrics", {
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
  recorder.event("renderer", "debug", "clock.synchronized", {
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
  recorder.event(
    "renderer",
    "info",
    name,
    { clockSynchronized: rendererClockSynchronized, ...fields },
    { timestampUs },
  );
}

async function stopTrace(): Promise<void> {
  if (!tracePath) return;
  if (traceGuard) clearInterval(traceGuard);
  traceGuard = null;
  const target = tracePath;
  tracePath = "";
  try {
    await contentTracing.stopRecording(target);
    lastTracePath = target;
    // Size is the first thing anyone asks after an export goes wrong.
    const bytes = await stat(target).then((info) => info.size, () => 0);
    recorder.setLatest("capture.traceBytes", bytes);
    recorder.event("app", "info", "chromiumTrace.stopped", { bytes });
  } catch (err) {
    logEvent({ k: "chromiumTrace.stopFailed", code: errorCode(err) });
  }
}

export function startDiagnosticCapture(level: 1 | 2): Promise<void> {
  if (captureLevel !== 0 || captureStopPromise || captureStartPromise) {
    return Promise.reject(new Error("a diagnostics capture is already active"));
  }
  const operation = (async () => {
    await rendererCaptureCommand({ type: "diagnostics.capture", action: "reset" });
    await recorder.beginCapture();
    eventLoop.reset();
    previousEventLoopUtilization = performance.eventLoopUtilization();
    eventLoopWindowStartedUs = recorder.timestampUs();
    lastTracePath = "";
    captureLevel = level;
    await rendererCaptureCommand({
      type: "diagnostics.capture",
      action: "started",
      level,
    });
    captureTimer = setTimeout(() => {
      void stopDiagnosticCapture("automatic");
    }, 120_000);
    recorder.event("app", "info", "capture.started", { level });
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
      await rendererCaptureCommand({
        type: "diagnostics.capture",
        action: "stopped",
      });
      tracePath = "";
      recordedCaptureLevel = 0;
      recorder.cancelCapture();
      logEvent({ k: "chromiumTrace.startFailed", code: errorCode(error) });
      throw error;
    }
  })();
  captureStartPromise = operation.finally(() => {
    captureStartPromise = null;
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
  captureStopPromise = (async () => {
    if (captureTimer) clearTimeout(captureTimer);
    captureTimer = null;
    await rendererCaptureCommand({ type: "diagnostics.capture", action: "flush" });
    await stopTrace();
    recorder.event("app", "info", "capture.stopped", {
      level: stoppedLevel,
      reason,
    });
    recorder.endCapture(stoppedLevel, reason);
    captureLevel = 0;
    await rendererCaptureCommand({
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
    recorder.event("app", "debug", "process.main", {
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
    recorder.event("app", "debug", "process.chromium", {
      type: metric.type,
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
  recorder.event("app", "debug", "eventLoop.sample", {
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
  crashReporter.start({ uploadToServer: false, compress: true });
  const diagnosticsDir = gamePaths().diagnostics;
  const staleCaptures = staleDiagnosticEntries(
    await readdir(diagnosticsDir).catch(() => []),
  ).map((name) => path.join(diagnosticsDir, name));
  await Promise.all(
    staleCaptures.map((file) => rm(file, { recursive: true, force: true })),
  );
  const crashDir = app.getPath("crashDumps");
  const crashFiles = (await readdir(crashDir).catch(() => []))
    .filter((name) => name.endsWith(".dmp"))
    .map((name) => path.join(crashDir, name));
  const datedCrashFiles = await Promise.all(
    crashFiles.map(async (file) => ({ file, mtime: (await stat(file)).mtimeMs })),
  );
  datedCrashFiles.sort((a, b) => b.mtime - a.mtime);
  await Promise.all(datedCrashFiles.slice(3).map(({ file }) => rm(file, { force: true })));
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
  recorder.event("app", "info", "diagnostics.started", {
    sessionId: recorder.sessionId,
    appVersion: app.getVersion(),
    platform: platform(),
    architecture: arch(),
  });
  recorder.setLatest("system.thermalState", powerMonitor.getCurrentThermalState());
  recorder.setLatest("system.onBattery", powerMonitor.isOnBatteryPower());
  powerMonitor.on("on-battery", () => {
    recorder.setLatest("system.onBattery", true);
    recorder.event("app", "warn", "power.onBattery");
  });
  powerMonitor.on("on-ac", () => {
    recorder.setLatest("system.onBattery", false);
    recorder.event("app", "info", "power.onAc");
  });
  powerMonitor.on("suspend", () => recorder.event("app", "warn", "power.suspend"));
  powerMonitor.on("resume", () => recorder.event("app", "info", "power.resume"));
  powerMonitor.on("thermal-state-change", ({ state }) => {
    recorder.setLatest("system.thermalState", state);
    recorder.event("app", state === "serious" || state === "critical" ? "warn" : "info", "thermal.changed", { state });
  });
  powerMonitor.on("speed-limit-change", ({ limit }) => {
    recorder.setLatest("system.cpuSpeedLimitPercent", limit);
    recorder.event("app", limit < 100 ? "warn" : "info", "cpuSpeedLimit.changed", { limit });
  });
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
  if (!lastTracePath) return;
  const target = lastTracePath;
  lastTracePath = "";
  await rm(target, { force: true }).catch(() => undefined);
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
      // What was checked, not a verdict about it. `openFields` is the residue
      // the closed schema has not absorbed yet, and a reader can hold the
      // export to these numbers by re-running the detector over events.jsonl.
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
    await execFileAsync("ditto", ["-c", "-k", "--sequesterRsrc", staging, zipPart]);
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
