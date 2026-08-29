/**
 * What every diagnostics ZIP reader needs: unpacking one into a temporary
 * directory, parsing its documents, and the validation each command runs
 * before it prints a number. The current UI writes `.zip`; the same readers
 * retain the legacy `.gwdiag` filename because the archive format did not
 * change.
 *
 * A capture is opened here and nowhere else, so the tools cannot disagree about
 * what a valid archive is, and the temporary directory is removed even when the
 * caller throws. Validation is separate from reading on purpose: a capture with
 * warnings is still readable, and a command decides for itself whether to
 * refuse or to print them alongside its output.
 *
 * These are developer tools. They read exports; nothing here produces one, and
 * nothing here reaches into a running application.
 */
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import {
  inspectEventLog,
  type RedactionResult,
} from "../../main/diagnostics/detector.js";
import type {
  DiagnosticReport,
  DiagnosticSummary,
} from "../../shared/diagnostics.js";
import {
  DIAGNOSTIC_PROFILES,
  RENDERER_COMMAND_OUTCOMES,
  type RuntimeDiagnosticState,
  type VisualProblemManifest,
} from "../../shared/contracts.js";
import {
  ENHANCEMENT_CAPABILITY_FIELDS,
  ENHANCEMENT_PROGRAMS,
  isEnhancementCapabilityProfile,
} from "../../shared/enhancement-contracts.js";
import { LOCAL_FEATURE_INVARIANTS } from
  "../../main/certification/local-client-verification-contract.js";
import {
  VISUAL_CAPTURE_FAILURES,
  VISUAL_CAPTURE_STAGES,
  type VisualCaptureFailure,
  type VisualCaptureMetadata,
  type VisualCaptureStage,
} from "../../shared/visual-capture.js";
export type { DiagnosticReport } from "../../shared/diagnostics.js";
export type { RedactionResult } from "../../main/diagnostics/detector.js";

const execFileAsync = promisify(execFile);

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
  visualProblem?: VisualProblemManifest | LegacyVisualProblemManifest;
}

interface LegacyVisualProblemManifest {
  rendererOutcome: VisualProblemManifest["rendererOutcome"];
  gameWindowCount: number;
  screenshotRequested: boolean;
  screenshotIncluded: boolean;
  screenshotPrivacy: "player-consented-unscanned";
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
  formatVersion: 2 | 3;
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
  visualProblemScreenshot?: Uint8Array;
  visualStages?: Partial<Record<VisualCaptureStage, Uint8Array>>;
  visualCapture?: unknown;
  runtimeState?: unknown;
}

export interface VisualCaptureDocument {
    metadata: VisualCaptureMetadata | null;
    dimensions: Partial<Record<VisualCaptureStage, { width: number; height: number }>>;
    missing: Partial<Record<VisualCaptureStage, VisualCaptureFailure>>;
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

const featureInvariants = new Set<string>(
  Object.values(LOCAL_FEATURE_INVARIANTS).flat(),
);

function isEnhancementVerification(value: unknown): boolean {
  if (!isRecord(value)) return false;
  const profile = (candidate: unknown) =>
    candidate === null || isEnhancementCapabilityProfile(candidate);
  const failureStage = value.preparationFailureStage;
  if (
    !profile(value.requestedProfile)
    || !profile(value.effectiveProfile)
    || !(failureStage === null
      || failureStage === "template-save"
      || failureStage === "enhancement"
      || failureStage === "cartography"
      || failureStage === "native-double-click")
  ) return false;
  if (value.featureVerdicts === null) return true;
  const featureVerdicts = value.featureVerdicts;
  if (!isRecord(featureVerdicts)) return false;
  if (
    Object.keys(featureVerdicts).length !== ENHANCEMENT_CAPABILITY_FIELDS.length
  ) return false;
  return ENHANCEMENT_CAPABILITY_FIELDS.every((feature) => {
    const verdict = featureVerdicts[feature];
    if (!isRecord(verdict)) return false;
    if (!(verdict.invariant === null
      || (typeof verdict.invariant === "string"
        && featureInvariants.has(verdict.invariant)))) return false;
    if (!(verdict.candidates === null
      || (Number.isSafeInteger(verdict.candidates)
        && Number(verdict.candidates) >= 0))) return false;
    if (verdict.status === "off" || verdict.status === "proved") {
      return verdict.invariant === null && verdict.candidates === null;
    }
    if (verdict.status === "changed") {
      return verdict.invariant !== null && verdict.candidates === null;
    }
    return verdict.status === "ambiguous"
      && verdict.invariant !== null
      && verdict.candidates !== null;
  });
}

export function isRuntimeDiagnosticState(
  value: unknown,
): value is RuntimeDiagnosticState {
  if (!isRecord(value)) return false;
  const requestedCapabilities = value.enhancementCapabilitiesRequested;
  if (
    !DIAGNOSTIC_PROFILES.includes(
      value.diagnosticProfile as RuntimeDiagnosticState["diagnosticProfile"],
    )
    || !ENHANCEMENT_PROGRAMS.includes(
      value.enhancementProgram as RuntimeDiagnosticState["enhancementProgram"],
    )
    || typeof value.extendedMemoryRequested !== "boolean"
    || !isRecord(requestedCapabilities)
    || Object.keys(requestedCapabilities).length
      !== ENHANCEMENT_CAPABILITY_FIELDS.length
    || !ENHANCEMENT_CAPABILITY_FIELDS.every((feature) =>
      typeof requestedCapabilities[feature] === "boolean")
  ) return false;
  if (value.status === "preparing") return true;
  return value.status === "active"
    && Number.isSafeInteger(value.generation)
    && (value.presentationPath === "direct-canvas"
      || value.presentationPath === "offscreen-imagebitmap")
    && (value.artifactKind === "official" || value.artifactKind === "derived")
    && isRecord(value.extendedMemoryEffective)
    && (value.enhancementFeaturesEffective === null
      || isRecord(value.enhancementFeaturesEffective))
    && isEnhancementVerification(value.enhancementVerification)
    && isRecord(value.transforms)
    && isRecord(value.observers)
    && isRecord(value.snapshot);
}

function isVisualCaptureDocument(value: unknown): value is VisualCaptureDocument {
  if (!isRecord(value) || !isRecord(value.dimensions) || !isRecord(value.missing)) {
    return false;
  }
  if (value.metadata !== null && !isRecord(value.metadata)) return false;
  return Object.entries(value.dimensions).every(([stage, dimensions]) =>
    VISUAL_CAPTURE_STAGES.includes(stage as VisualCaptureStage)
    && isRecord(dimensions)
    && Number.isSafeInteger(dimensions.width)
    && Number(dimensions.width) > 0
    && Number.isSafeInteger(dimensions.height)
    && Number(dimensions.height) > 0)
    && Object.entries(value.missing).every(([stage, reason]) =>
      VISUAL_CAPTURE_STAGES.includes(stage as VisualCaptureStage)
      && VISUAL_CAPTURE_FAILURES.includes(reason as VisualCaptureFailure));
}

function isVisualProblemManifest(
  value: unknown,
): value is NonNullable<ManifestFields["visualProblem"]> {
  if (!isRecord(value)) return false;
  const base = typeof value.rendererOutcome === "string"
    && RENDERER_COMMAND_OUTCOMES.includes(
      value.rendererOutcome as VisualProblemManifest["rendererOutcome"],
    )
    && Number.isSafeInteger(value.gameWindowCount)
    && Number(value.gameWindowCount) >= 1
    && typeof value.screenshotRequested === "boolean"
    && value.screenshotPrivacy === "player-consented-unscanned";
  if (!base) return false;
  if (typeof value.screenshotIncluded === "boolean") return true;
  return Array.isArray(value.includedStages)
    && new Set(value.includedStages).size === value.includedStages.length
    && value.includedStages.every((stage) =>
      typeof stage === "string"
      && VISUAL_CAPTURE_STAGES.includes(
        stage as (typeof VISUAL_CAPTURE_STAGES)[number],
      ))
    && isRecord(value.missingStages)
    && Object.entries(value.missingStages).every(([stage, reason]) =>
      VISUAL_CAPTURE_STAGES.includes(stage as (typeof VISUAL_CAPTURE_STAGES)[number])
      && VISUAL_CAPTURE_FAILURES.includes(reason as (typeof VISUAL_CAPTURE_FAILURES)[number]));
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
    await execFileAsync("ditto", ["-x", "-k", capturePath, root]);
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
    try {
      capture.visualProblemScreenshot = new Uint8Array(
        await readFile(path.join(root, "visual-problem.png")),
      );
    } catch (error) {
      if (!isRecord(error) || error.code !== "ENOENT") throw error;
    }
    for (const stage of VISUAL_CAPTURE_STAGES) {
      const name = `visual-${stage}.png`;
      try {
        capture.visualStages ??= {};
        capture.visualStages[stage] = new Uint8Array(
          await readFile(path.join(root, name)),
        );
      } catch (error) {
        if (!isRecord(error) || error.code !== "ENOENT") throw error;
      }
    }
    if (capture.manifest.includedFiles.includes("visual-capture.json")) {
      capture.visualCapture = await parseJson(path.join(root, "visual-capture.json"));
    }
    if (capture.manifest.includedFiles.includes("runtime-state.json")) {
      capture.runtimeState = await parseJson(path.join(root, "runtime-state.json"));
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
  if (
    capture.manifest.formatVersion !== 1
    && capture.manifest.formatVersion !== 2
    && capture.manifest.formatVersion !== 3
  ) {
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
  const visualProblemValue = capture.manifest.visualProblem;
  const visualProblem = isVisualProblemManifest(visualProblemValue)
    ? visualProblemValue
    : undefined;
  if (visualProblemValue !== undefined && !visualProblem) {
    errors.push("visual-problem manifest declaration is invalid");
  }
  if (capture.manifest.formatVersion === 3 && !visualProblem) {
    errors.push("format 3 requires a visual-problem manifest declaration");
  }
  const visualCapture = isVisualCaptureDocument(capture.visualCapture)
    ? capture.visualCapture
    : null;
  const screenshotDeclared = capture.manifest.includedFiles.includes(
    "visual-problem.png",
  );
  const screenshotPresent = capture.visualProblemScreenshot !== undefined;
  if (screenshotDeclared !== screenshotPresent) {
    errors.push("visual-problem screenshot file presence is inconsistent");
  }
  if (screenshotDeclared && !visualProblem) {
    errors.push("visual-problem screenshot has no manifest declaration");
  }
  if (visualProblem && "screenshotIncluded" in visualProblem) {
    if (visualProblem.screenshotIncluded !== screenshotDeclared) {
      errors.push("visual-problem screenshot declaration is inconsistent");
    }
    if (
      visualProblem.screenshotIncluded
      && visualProblem.screenshotRequested !== true
    ) {
      errors.push("visual-problem screenshot was included without consent");
    }
  }
  if (visualProblem && "includedStages" in visualProblem) {
    for (const stage of visualProblem.includedStages) {
      if (!capture.manifest.includedFiles.includes(`visual-${stage}.png`)) {
        errors.push(`visual ${stage} declaration is inconsistent`);
      }
    }
    if (!visualProblem.screenshotRequested && visualProblem.includedStages.length) {
      errors.push("visual images were included without consent");
    }
    for (const stage of VISUAL_CAPTURE_STAGES) {
      const present = capture.visualStages?.[stage];
      const declared = visualProblem.includedStages.includes(stage);
      if (Boolean(present) !== declared) {
        errors.push(`visual ${stage} file presence is inconsistent`);
      }
      if (present) {
        const signature = [137, 80, 78, 71, 13, 10, 26, 10];
        if (signature.some((byte, index) => present[index] !== byte)) {
          errors.push(`visual ${stage} image is not a PNG`);
        }
      }
      if (declared && stage in visualProblem.missingStages) {
        errors.push(`visual ${stage} cannot be both included and missing`);
      }
      if (
        visualProblem.screenshotRequested
        && !declared
        && !(stage in visualProblem.missingStages)
      ) {
        errors.push(`visual ${stage} is neither included nor marked missing`);
      }
    }
    const captureDocumentDeclared = capture.manifest.includedFiles.includes(
      "visual-capture.json",
    );
    if (visualProblem.screenshotRequested !== captureDocumentDeclared) {
      errors.push("visual-capture.json declaration is inconsistent");
    }
    if (captureDocumentDeclared && !visualCapture) {
      errors.push("visual-capture.json could not be read");
    }
    for (const stage of VISUAL_CAPTURE_STAGES) {
      if (
        visualCapture
        && visualCapture.missing[stage]
          !== visualProblem.missingStages[stage]
      ) {
        errors.push(`visual ${stage} missing reason differs from the manifest`);
      }
      const png = capture.visualStages?.[stage];
      const recorded = visualCapture?.dimensions[stage];
      if (png && visualCapture && !recorded) {
        errors.push(`visual ${stage} has no recorded dimensions`);
      }
      if (!png && recorded) {
        errors.push(`visual ${stage} records dimensions without an image`);
      }
      if (!png || !recorded || png.byteLength < 24) continue;
      const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
      if (
        view.getUint32(16) !== recorded.width
        || view.getUint32(20) !== recorded.height
      ) {
        errors.push(`visual ${stage} recorded dimensions differ from its PNG`);
      }
    }
  }
  if (
    capture.manifest.formatVersion === 3
    && capture.manifest.visualProblem
    && !capture.manifest.includedFiles.includes("runtime-state.json")
  ) {
    errors.push("visual report has no runtime-state.json");
  }
  if (
    capture.manifest.includedFiles.includes("runtime-state.json")
    && !isRuntimeDiagnosticState(capture.runtimeState)
  ) {
    errors.push("runtime-state.json could not be read");
  }
  if (capture.visualProblemScreenshot !== undefined) {
    const png = capture.visualProblemScreenshot;
    const signature = [137, 80, 78, 71, 13, 10, 26, 10];
    if (signature.some((byte, index) => png[index] !== byte)) {
      errors.push("visual-problem screenshot is not a PNG");
    }
  }
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
