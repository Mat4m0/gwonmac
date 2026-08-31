/**
 * The diagnostics ZIP: what goes in it, which tier of protection covers each
 * document, and the staging that makes the archive appear whole or not at all.
 *
 * Nothing is written before the detector has passed over the event log, and
 * the log is written byte for byte as the detector saw it — a reader can
 * reproduce the manifest's counts from the file in the archive.
 */
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import {
  chmod,
  copyFile,
  mkdir,
  open,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { app, dialog, type BrowserWindow } from "electron";
import type {
  AppSettings,
  RuntimeDiagnosticState,
  VisualProblemManifest,
} from "../../shared/contracts.js";
import type { CartographyEvidenceReport } from "../../shared/cartography-evidence.js";
import {
  VISUAL_CAPTURE_STAGES,
  type VisualCaptureFailure,
  type VisualCaptureStage,
} from "../../shared/visual-capture.js";
import { gamePaths } from "../paths.js";
import { windowRegistry } from "../window-registry.js";
import { LEGACY_PRIMARY_PROFILE_ID } from "../../shared/multiple-accounts.js";
import {
  completedTracePath,
  exportedCaptureLevel,
  stopDiagnosticCaptureForWindow,
} from "./capture.js";
import { inspectEventLog, type RedactionResult } from "./detector.js";
import { runtimeVersions } from "./flight-recorder.js";
import { recorder } from "./recorder.js";
import { graphicsSnapshot } from "./renderer.js";
import { buildDiagnosticReport, previousAbnormalSession } from "./report.js";
import { environmentSnapshot, gpuEnvironment } from "./samplers.js";
import {
  redactDiagnosticText as redactText,
  redactTraceStream,
} from "./text-scan.js";
import type { VisualCaptureEvidence } from "../visual-capture.js";

const execFileAsync = promisify(execFile);

type VisualProblemExportBase = Pick<
  VisualProblemManifest,
  "rendererOutcome" | "gameWindowCount"
>;

export type VisualProblemExport = VisualProblemExportBase & (
  | { screenshotRequested: false; evidence?: never }
  | {
      screenshotRequested: true;
      evidence: VisualCaptureEvidence | null;
      failureReason?: "capture-failed" | "timed-out" | "unsupported";
    }
);

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
    diagnosticOwnerId: number;
    includePreviousSession: boolean;
    electronVersions: Record<string, string>;
    settings: AppSettings;
    runtimeState?: RuntimeDiagnosticState;
    visualProblem?: VisualProblemExport;
    cartographyEvidence?: Readonly<{
      report: CartographyEvidenceReport;
      preview: Uint8Array | null;
      summary: string;
    }>;
  },
): Promise<string> {
  if (
    extras.visualProblem
    && extras.visualProblem.screenshotRequested !== true
    && "evidence" in extras.visualProblem
    && extras.visualProblem.evidence
  ) {
    throw new Error("visual capture evidence requires explicit consent");
  }
  await recorder.flush();
  const dir = gamePaths().diagnostics;
  const staging = path.join(dir, `export-${randomUUID()}`);
  const zipPath = /\.zip$/i.test(targetPath) ? targetPath : `${targetPath}.zip`;
  const zipPart = path.join(
    path.dirname(zipPath),
    `.${path.basename(zipPath)}.${randomUUID()}.part`,
  );
  await mkdir(staging, { recursive: true, mode: 0o700 });
  try {
    const capture = recorder.captureResult(extras.diagnosticOwnerId);
    const captureLevel = exportedCaptureLevel(extras.diagnosticOwnerId);
    // The main report keeps the complete safe session around a capture. The
    // capture's narrower measurements remain in capture-summary.json, while its
    // metadata, frames, and trace retain their own exact lifetime below.
    const summary = recorder.summaryForOwner(
      extras.diagnosticOwnerId,
      captureLevel,
    );
    const exportedEvents = await recorder.exportedEvents(
      extras.diagnosticOwnerId,
    );
    const previous = extras.includePreviousSession
      ? await previousAbnormalSession(dir, recorder.sessionId)
      : null;
    // The detector runs before anything is written, and it throws. An
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
    if (extras.runtimeState) files.push("runtime-state.json");
    if (extras.cartographyEvidence) {
      files.push("cartography-report.json");
      files.push("cartography-summary.txt");
      if (extras.cartographyEvidence.preview !== null) {
        files.push("cartography-preview.png");
      }
    }
    if (previous) files.push("previous-events.jsonl");
    if (capture) files.push("capture-summary.json");
    const visualEvidence = extras.visualProblem?.screenshotRequested
      ? extras.visualProblem.evidence
      : null;
    const visualImages = visualEvidence?.images ?? {};
    const missingVisualStages: Partial<
      Record<VisualCaptureStage, VisualCaptureFailure>
    > = {};
    if (extras.visualProblem?.screenshotRequested) {
      for (const stage of VISUAL_CAPTURE_STAGES) {
        if (!visualImages[stage]) {
          missingVisualStages[stage] = visualEvidence?.missing[stage]
            ?? extras.visualProblem.failureReason
            ?? "capture-failed";
        }
      }
    }
    for (const stage of VISUAL_CAPTURE_STAGES) {
      if (visualImages[stage]?.byteLength) files.push(`visual-${stage}.png`);
    }
    if (extras.visualProblem?.screenshotRequested) {
      files.push("visual-capture.json");
    }
    const framePath = recorder.framePath(extras.diagnosticOwnerId);
    if (framePath) {
      await copyFile(framePath, path.join(staging, "frames.bin"));
      files.push("frames.bin");
    }
    let traceBytesScanned = 0;
    const rawTrace = completedTracePath(extras.diagnosticOwnerId);
    if (rawTrace) {
      traceBytesScanned = await sanitizeTraceFile(
        rawTrace,
        path.join(staging, "chromium-trace.json"),
      );
      files.push("chromium-trace.json");
    }
    const manifest = {
      // 3 adds synchronized, original-resolution visual stages and their
      // frame/dimension metadata. Version 2 remains readable by the tools.
      formatVersion: extras.visualProblem ? 3 : 2,
      applicationVersion: extras.appVersion,
      sessionId: recorder.sessionId,
      captureLevel,
      exportedAt: new Date().toISOString(),
      droppedEventCount: summary.droppedEvents,
      includedFiles: files,
      // What was checked, not a self-awarded verdict. A reader can reproduce
      // both counts by running the same closed schema over events.jsonl.
      redaction: { ...inspection, traceBytesScanned } satisfies RedactionResult,
      profilerContaminated: files.includes("chromium-trace.json"),
      ...(extras.visualProblem
        ? {
            visualProblem: {
              rendererOutcome: extras.visualProblem.rendererOutcome,
              gameWindowCount: extras.visualProblem.gameWindowCount,
              screenshotRequested: extras.visualProblem.screenshotRequested,
              includedStages: VISUAL_CAPTURE_STAGES
                .filter((stage) => files.includes(`visual-${stage}.png`)),
              missingStages: missingVisualStages,
              screenshotPrivacy: "player-consented-unscanned",
            } satisfies VisualProblemManifest,
          }
        : {}),
      ...(extras.cartographyEvidence
        ? {
            cartographyEvidence: {
              formatVersion: extras.cartographyEvidence.report.formatVersion,
              contentSha256: extras.cartographyEvidence.report.contentSha256,
              previewIncluded: extras.cartographyEvidence.preview !== null,
            },
          }
        : {}),
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
      captureLevel,
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
          ...environmentSnapshot(),
          gpu: await gpuEnvironment(),
          graphics: capture?.graphics
            ?? graphicsSnapshot(extras.diagnosticOwnerId),
          electronVersions: extras.electronVersions,
          gameWindowCount: extras.visualProblem?.gameWindowCount
            ?? windowRegistry.gameWindows().length,
        },
        null,
        2,
      ),
      "settings-redacted.json": JSON.stringify(extras.settings, null, 2),
      ...(extras.runtimeState
        ? { "runtime-state.json": JSON.stringify(extras.runtimeState, null, 2) }
        : {}),
      ...(extras.cartographyEvidence
        ? {
            "cartography-report.json": JSON.stringify(
              extras.cartographyEvidence.report,
              null,
              2,
            ),
            "cartography-summary.txt": extras.cartographyEvidence.summary,
          }
        : {}),
      ...(extras.visualProblem?.screenshotRequested
        ? {
            "visual-capture.json": JSON.stringify({
              metadata: visualEvidence?.metadata ?? null,
              dimensions: visualEvidence?.dimensions ?? {},
              missing: missingVisualStages,
            }, null, 2),
          }
        : {}),
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
    for (const [stage, image] of Object.entries(visualImages)) {
      if (!image?.byteLength) continue;
      const file = path.join(staging, `visual-${stage}.png`);
      await writeFile(file, image, { mode: 0o600 });
      await chmod(file, 0o600);
    }
    if (extras.cartographyEvidence?.preview !== null
      && extras.cartographyEvidence?.preview.byteLength) {
      const file = path.join(staging, "cartography-preview.png");
      await writeFile(file, extras.cartographyEvidence.preview, { mode: 0o600 });
      await chmod(file, 0o600);
    }
    await execFileAsync("ditto", ["-c", "-k", "--sequesterRsrc", staging, zipPart]);
    await chmod(zipPart, 0o600);
    await rename(zipPart, zipPath);
    // The trace deliberately survives the export. The exported capture level
    // stays at 2 for the rest of the session, so discarding here would make a
    // second export declare Level 2 with no trace and fail its own validation.
    // Quit and the launch sweep are what bound it.
    return zipPath;
  } finally {
    await rm(staging, { recursive: true, force: true });
    await rm(zipPart, { force: true });
  }
}

export async function exportDiagnosticsForWindow(
  win: BrowserWindow,
  readSettings: () => Promise<AppSettings>,
  options: {
    visualProblem?: VisualProblemExport;
    runtimeState?: RuntimeDiagnosticState;
    cartographyEvidence?: Readonly<{
      report: CartographyEvidenceReport;
      preview: Uint8Array | null;
      summary: string;
    }>;
  } = {},
): Promise<string> {
  // `captureLevel` remains zero while reset and recorder setup are in flight.
  // The owner-bound stop also waits that starting operation, so export cannot
  // race it by trying to infer the complete lifecycle from the public level.
  await stopDiagnosticCaptureForWindow(win, "export");
  // The report has always been a PKZIP archive; `.zip` is the name that lets
  // GitHub accept it as an attachment without a Finder round-trip.
  const { canceled, filePath } = await dialog.showSaveDialog(win, {
    title: options.visualProblem
      ? "Save Visual Corruption Report"
      : options.cartographyEvidence
        ? "Export Cartography Evidence"
        : "Export Diagnostics",
    defaultPath: options.visualProblem
      ? "guild-wars-visual-corruption.zip"
      : options.cartographyEvidence
        ? "guild-wars-cartography-evidence.zip"
      : "guild-wars-diagnostics.zip",
    filters: [{ name: "Guild Wars diagnostics", extensions: ["zip"] }],
  });
  if (canceled || !filePath) return "";
  const context = windowRegistry.contextForWebContents(win.webContents.id);
  const diagnosticOwnerId = windowRegistry.diagnosticOwnerForWindow(win);
  if (diagnosticOwnerId === null) {
    throw new Error("diagnostics export requires an account owner");
  }
  return exportDiagnosticsZip(filePath, {
    appVersion: app.getVersion(),
    diagnosticOwnerId,
    includePreviousSession:
      context?.role === "game"
      && context.profileId === LEGACY_PRIMARY_PROFILE_ID,
    electronVersions: runtimeVersions(),
    settings: await readSettings(),
    ...(options.runtimeState ? { runtimeState: options.runtimeState } : {}),
    ...options,
  });
}
