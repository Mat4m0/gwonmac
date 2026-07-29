import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { readDiagnosticZip } from "../../main/core/diagnostic-zip.js";
import {
  inspectEventLog,
  type RedactionResult,
} from "../../main/diagnostics/detector.js";
import type {
  DiagnosticReport,
  DiagnosticSummary,
} from "../../shared/diagnostics.js";
export type { DiagnosticReport } from "../../shared/diagnostics.js";
export type { RedactionResult } from "../../main/diagnostics/detector.js";

interface ManifestFields {
  applicationVersion: string;
  sessionId: string;
  captureLevel: 0 | 1 | 2;
  exportedAt: string;
  droppedEventCount: number;
  includedFiles: string[];
  profilerContaminated: boolean;
  eventLog?: {
    completeFromStart: boolean;
    firstSequenceNumber: number;
    lastSequenceNumber: number;
    firstTimestampUs: number;
    lastTimestampUs: number;
  };
  previousSession?: {
    sessionId: string;
    cleanShutdown: false;
    firstSequenceNumber: number;
    lastSequenceNumber: number;
    finalEventName: string;
    abnormalReason: string;
  };
  capture?: {
    startMonotonicUs: number;
    endMonotonicUs: number;
    stopReason: string;
    firstSequenceNumber?: number;
    lastSequenceNumber?: number;
  };
  frameSchema?: {
    format: "GWFRAME1";
    encoding: "little-endian float64";
    stride: 7;
    fields: string[];
  };
}

/**
 * The alpha's export. One explicit legacy read path: it declares
 * `histograms.json` (a strict subset of `summary.json`) and asserts redaction
 * with a literal nothing can reproduce. Both are why there is a format 2.
 */
export type LegacyCaptureManifest = ManifestFields & {
  formatVersion: 1;
  redaction: "passed";
};

export type CurrentCaptureManifest = ManifestFields & {
  formatVersion: 2;
  redaction: RedactionResult;
};

export type CaptureManifest = LegacyCaptureManifest | CurrentCaptureManifest;

export interface Capture {
  manifest: CaptureManifest;
  summary: DiagnosticSummary;
  captureSummary?: DiagnosticSummary;
  report?: DiagnosticReport;
  environment: Record<string, unknown>;
  /** `events.jsonl` verbatim, so the detector can be re-run over it. */
  eventLog?: string;
  frames?: FrameAnalysis;
  frameError?: string;
}

export interface FrameAnalysis {
  records: number;
  visibleRecords: number;
  intervals: number;
  fps: number;
  p50Us: number;
  p95Us: number;
  p99Us: number;
  maxUs: number;
  stallsOver33Ms: number;
  stallsOver50Ms: number;
  stallsOver100Ms: number;
  visibility: "visible" | "hidden" | "mixed" | "unknown";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function isDiagnosticReport(value: unknown): value is DiagnosticReport {
  if (!isRecord(value) || value.formatVersion !== 1) return false;
  const current = value.currentSession;
  const previous = value.previousSession;
  const capture = value.capture;
  const performance = value.performance;
  const count = (item: unknown) => Number.isSafeInteger(item) && Number(item) >= 0;
  const duration = (item: unknown) =>
    typeof item === "number" && Number.isFinite(item) && item >= 0;
  return (
    typeof value.generatedAt === "string" &&
    isRecord(current) &&
    typeof current.sessionId === "string" &&
    typeof current.startupStage === "string" &&
    count(current.errorCount) &&
    count(current.warningCount) &&
    count(current.droppedEvents) &&
    (current.lastError === null ||
      (isRecord(current.lastError) &&
        typeof current.lastError.subsystem === "string" &&
        typeof current.lastError.name === "string")) &&
    (previous === null ||
      (isRecord(previous) &&
        typeof previous.sessionId === "string" &&
        previous.cleanShutdown === false &&
        typeof previous.finalEventName === "string" &&
        typeof previous.abnormalReason === "string" &&
        count(previous.errorCount) &&
        count(previous.warningCount))) &&
    isRecord(capture) &&
    (capture.level === 0 || capture.level === 1 || capture.level === 2) &&
    typeof capture.profilerContaminated === "boolean" &&
    (capture.stopReason === null || typeof capture.stopReason === "string") &&
    typeof capture.visibility === "string" &&
    isRecord(performance) &&
    duration(performance.frameP95Us) &&
    duration(performance.snapshotP95Us) &&
    duration(performance.socketSyncP95Us)
  );
}

async function parseJson<T>(file: string): Promise<T> {
  return JSON.parse(await readFile(file, "utf8")) as T;
}

function percentile(sorted: number[], fraction: number): number {
  if (!sorted.length) return 0;
  return sorted[Math.ceil(sorted.length * fraction) - 1] ?? 0;
}

export function analyzeFrames(bytes: Uint8Array): FrameAnalysis {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const format = new TextDecoder("ascii").decode(bytes.subarray(0, 8));
  if (bytes.byteLength < 16 || format !== "GWFRAME1") {
    throw new Error("frames.bin header is invalid");
  }
  const stride = view.getUint32(8, true);
  if (stride !== 7 || (bytes.byteLength - 16) % (stride * 8) !== 0) {
    throw new Error("frames.bin stride or length is invalid");
  }
  const records = (bytes.byteLength - 16) / (stride * 8);
  const intervals: number[] = [];
  let visibleRecords = 0;
  let hiddenRecords = 0;
  let previousVisibleTimestamp = 0;
  for (let record = 0; record < records; record++) {
    const base = 16 + record * stride * 8;
    const timestampUs = view.getFloat64(base, true);
    const visible = view.getFloat64(base + 6 * 8, true) !== 0;
    if (!visible) {
      hiddenRecords += 1;
      previousVisibleTimestamp = 0;
      continue;
    }
    visibleRecords += 1;
    if (previousVisibleTimestamp && timestampUs >= previousVisibleTimestamp) {
      intervals.push(timestampUs - previousVisibleTimestamp);
    }
    previousVisibleTimestamp = timestampUs;
  }
  const sorted = [...intervals].sort((a, b) => a - b);
  const totalUs = intervals.reduce((total, value) => total + value, 0);
  return {
    records,
    visibleRecords,
    intervals: intervals.length,
    fps: totalUs ? (intervals.length * 1_000_000) / totalUs : 0,
    p50Us: percentile(sorted, 0.5),
    p95Us: percentile(sorted, 0.95),
    p99Us: percentile(sorted, 0.99),
    maxUs: sorted.at(-1) ?? 0,
    stallsOver33Ms: intervals.filter((value) => value > 33_333).length,
    stallsOver50Ms: intervals.filter((value) => value > 50_000).length,
    stallsOver100Ms: intervals.filter((value) => value > 100_000).length,
    visibility:
      visibleRecords && hiddenRecords
        ? "mixed"
        : visibleRecords
          ? "visible"
          : hiddenRecords
            ? "hidden"
            : "unknown",
  };
}

export async function withCapture<T>(
  capturePath: string,
  action: (capture: Capture, root: string) => T | Promise<T>,
): Promise<T> {
  const root = await mkdtemp(path.join(tmpdir(), "gwdiag-"));
  try {
    await readDiagnosticZip(capturePath, root);
    const capture: Capture = {
      manifest: await parseJson(path.join(root, "manifest.json")),
      summary: await parseJson(path.join(root, "summary.json")),
      environment: await parseJson(path.join(root, "environment.json")),
    };
    if (capture.manifest.includedFiles.includes("events.jsonl")) {
      capture.eventLog = await readFile(path.join(root, "events.jsonl"), "utf8");
    }
    if (capture.manifest.includedFiles.includes("report.json")) {
      capture.report = await parseJson(path.join(root, "report.json"));
    }
    if (capture.manifest.includedFiles.includes("capture-summary.json")) {
      capture.captureSummary = await parseJson(
        path.join(root, "capture-summary.json"),
      );
    }
    if (capture.manifest.includedFiles.includes("frames.bin")) {
      try {
        capture.frames = analyzeFrames(
          new Uint8Array(await readFile(path.join(root, "frames.bin"))),
        );
      } catch (error) {
        capture.frameError =
          error instanceof Error ? error.message : String(error);
      }
    }
    return await action(capture, root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

/**
 * Reproduces the exporter's detector run. The manifest states what was
 * checked; this checks the same file and refuses to agree unless it gets the
 * same answer. It calls the schema detector, never the pattern redactor — a
 * validator that used the redactor as its oracle could only confirm the
 * redactor agreed with itself.
 */
function redactionErrors(capture: Capture): string[] {
  const manifest = capture.manifest;
  if (manifest.formatVersion === 1) {
    return manifest.redaction === "passed" ? [] : ["redaction did not pass"];
  }
  const claimed = manifest.redaction;
  if (capture.eventLog === undefined) {
    return ["events.jsonl is missing, so the export cannot be re-checked"];
  }
  let observed;
  try {
    observed = inspectEventLog(capture.eventLog);
  } catch (error) {
    return [
      `events.jsonl is not exportable: ${
        error instanceof Error ? error.message : "unknown failure"
      }`,
    ];
  }
  const errors: string[] = [];
  if (observed.records !== claimed.records) {
    errors.push(
      `manifest claims ${claimed.records} event records, events.jsonl has ${observed.records}`,
    );
  }
  if (observed.schemaChecked !== claimed.schemaChecked) {
    errors.push(
      `manifest claims ${claimed.schemaChecked} schema-checked records, events.jsonl has ${observed.schemaChecked}`,
    );
  }
  if (
    claimed.traceBytesScanned > 0 !==
    capture.manifest.includedFiles.includes("chromium-trace.json")
  ) {
    errors.push("trace scan and included files disagree");
  }
  return errors;
}

export function validateCapture(capture: Capture): string[] {
  const errors: string[] = [];
  if (capture.manifest.formatVersion !== 1 && capture.manifest.formatVersion !== 2) {
    errors.push("unsupported formatVersion");
  }
  if (!capture.manifest.sessionId) errors.push("manifest sessionId is missing");
  if (capture.manifest.sessionId !== capture.summary.sessionId) {
    errors.push("manifest and summary sessionId differ");
  }
  errors.push(...redactionErrors(capture));
  if (
    capture.manifest.includedFiles.includes("frames.bin") &&
    (capture.manifest.frameSchema?.format !== "GWFRAME1" ||
      capture.manifest.frameSchema.stride !== 7)
  ) {
    errors.push("frames.bin schema is missing or unsupported");
  }
  if (capture.frameError) errors.push(capture.frameError);
  if (
    capture.manifest.includedFiles.includes("capture-summary.json") &&
    !capture.captureSummary
  ) {
    errors.push("capture-summary.json could not be read");
  }
  const report = isDiagnosticReport(capture.report) ? capture.report : null;
  if (
    capture.manifest.includedFiles.includes("report.json") &&
    !report
  ) {
    errors.push("report.json could not be read");
  }
  if (
    report &&
    report.currentSession.sessionId !== capture.manifest.sessionId
  ) {
    errors.push("manifest and report sessionId differ");
  }
  if (
    report &&
    (report.capture.level !== capture.manifest.captureLevel ||
      report.capture.profilerContaminated !== capture.manifest.profilerContaminated)
  ) {
    errors.push("manifest and report capture metadata differ");
  }
  if (
    report &&
    Boolean(report.previousSession) !== Boolean(capture.manifest.previousSession)
  ) {
    errors.push("manifest and report previous-session metadata differ");
  }
  if (
    report?.previousSession &&
    capture.manifest.previousSession &&
    report.previousSession.sessionId !== capture.manifest.previousSession.sessionId
  ) {
    errors.push("manifest and report previous sessionId differ");
  }
  if (
    Boolean(capture.manifest.previousSession) !==
    capture.manifest.includedFiles.includes("previous-events.jsonl")
  ) {
    errors.push("previous-session declaration is inconsistent");
  }
  if (
    capture.captureSummary &&
    capture.captureSummary.sessionId !== capture.manifest.sessionId
  ) {
    errors.push("manifest and capture summary sessionId differ");
  }
  if (
    capture.captureSummary &&
    capture.captureSummary.captureLevel !== capture.manifest.captureLevel
  ) {
    errors.push("manifest and capture summary level differ");
  }
  const eventLog = capture.manifest.eventLog;
  const window = capture.manifest.capture;
  if (
    eventLog &&
    window?.firstSequenceNumber !== undefined &&
    window.lastSequenceNumber !== undefined &&
    (window.firstSequenceNumber < eventLog.firstSequenceNumber ||
      window.lastSequenceNumber > eventLog.lastSequenceNumber ||
      window.firstSequenceNumber > window.lastSequenceNumber)
  ) {
    errors.push("capture sequence bounds fall outside the exported event log");
  }
  // `histograms.json` was a strict subset of `summary.json` and is gone from
  // format 2. It stays required for format 1, because an alpha export that
  // omitted it really was incomplete.
  for (const file of [
    "manifest.json",
    "summary.json",
    "events.jsonl",
    ...(capture.manifest.formatVersion === 1 ? ["histograms.json"] : []),
    "environment.json",
    "settings-redacted.json",
  ]) {
    if (!capture.manifest.includedFiles.includes(file)) {
      errors.push(`manifest does not declare ${file}`);
    }
  }
  if (
    capture.manifest.captureLevel === 2 &&
    !capture.manifest.includedFiles.includes("chromium-trace.json")
  ) {
    // A failed startRecording or stopRecording drops the trace silently while
    // the manifest still claims Level 2, so the export looks complete.
    errors.push("Level 2 capture has no Chromium trace");
  }
  if (capture.summary.droppedEvents > 0) {
    errors.push(`${capture.summary.droppedEvents} flight-recorder events were dropped`);
  }
  const graphics = capture.environment.graphics as
    | { hardwareAcceleration?: boolean; jspi?: boolean }
    | undefined;
  if (graphics?.jspi === false) errors.push("JSPI was not active");
  if (graphics?.hardwareAcceleration === false) errors.push("hardware acceleration was not active");
  return errors;
}

export function comparisonWarnings(before: Capture, after: Capture): string[] {
  const warnings: string[] = [];
  if (before.manifest.sessionId === after.manifest.sessionId) {
    warnings.push("both exports come from the same session");
  }
  const beforeWindow = before.manifest.capture;
  const afterWindow = after.manifest.capture;
  if (
    before.manifest.sessionId === after.manifest.sessionId &&
    beforeWindow &&
    afterWindow &&
    beforeWindow.startMonotonicUs < afterWindow.endMonotonicUs &&
    afterWindow.startMonotonicUs < beforeWindow.endMonotonicUs
  ) {
    warnings.push("capture windows overlap");
  }
  if (
    (before.manifest.captureLevel === 0) !==
    (after.manifest.captureLevel === 0)
  ) {
    warnings.push("Level 0 is being compared with a Level 1/2 capture");
  }
  const visibility = (capture: Capture) =>
    capture.frames?.visibility ??
    (capture.summary.latest["renderer.visible"] === true
      ? "visible"
      : capture.summary.latest["renderer.visible"] === false
        ? "hidden"
        : "unknown");
  const beforeVisibility = visibility(before);
  const afterVisibility = visibility(after);
  if (beforeVisibility !== afterVisibility) {
    warnings.push(
      `visibility differs (${beforeVisibility} vs ${afterVisibility})`,
    );
  }
  if (
    before.manifest.profilerContaminated ||
    after.manifest.profilerContaminated
  ) {
    warnings.push("a Chromium trace is profiler-contaminated");
  }
  return warnings;
}

export function numberAt(object: Record<string, unknown>, pathParts: string[]): number {
  let value: unknown = object;
  for (const key of pathParts) {
    if (!value || typeof value !== "object") return 0;
    value = (value as Record<string, unknown>)[key];
  }
  return typeof value === "number" ? value : 0;
}
