import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import type {
  DiagnosticReport,
  DiagnosticSummary,
} from "../shared/diagnostics.js";
import type {
  CaptureMetadata,
  LogRecord,
} from "./diagnostic-recorder.js";

export interface PreviousSessionExport {
  sessionId: string;
  text: string;
  firstSequenceNumber: number;
  lastSequenceNumber: number;
  finalEventName: string;
  abnormalReason: string;
  errorCount: number;
  warningCount: number;
}

function parseLogRecords(text: string): LogRecord[] {
  const records: LogRecord[] = [];
  for (const line of text.split("\n")) {
    if (!line) continue;
    try {
      const record = JSON.parse(line) as LogRecord;
      if (
        Number.isSafeInteger(record.seq) &&
        typeof record.name === "string" &&
        typeof record.level === "string" &&
        typeof record.subsystem === "string"
      ) {
        records.push(record);
      }
    } catch {
      // A killed process can leave one incomplete final JSONL record.
    }
  }
  return records.sort((left, right) => left.seq - right.seq);
}

export async function previousAbnormalSession(
  directory: string,
  currentSessionId: string,
): Promise<PreviousSessionExport | null> {
  const groups = new Map<string, { files: string[]; newestMtime: number }>();
  for (const name of await readdir(directory).catch(() => [] as string[])) {
    const match = /^session-([0-9a-f-]{36})(?:-\d+)?\.jsonl$/i.exec(name);
    const sessionId = match?.[1];
    if (!sessionId || sessionId === currentSessionId) continue;
    const file = path.join(directory, name);
    const mtime = (await stat(file).catch(() => null))?.mtimeMs;
    if (mtime === undefined) continue;
    const group = groups.get(sessionId) ?? { files: [], newestMtime: 0 };
    group.files.push(file);
    group.newestMtime = Math.max(group.newestMtime, mtime);
    groups.set(sessionId, group);
  }
  const latest = [...groups.entries()].sort(
    (left, right) => right[1].newestMtime - left[1].newestMtime,
  )[0];
  if (!latest) return null;
  const records = parseLogRecords(
    (
      await Promise.all(
        latest[1].files.map((file) =>
          readFile(file, "utf8").catch(() => ""),
        ),
      )
    ).join("\n"),
  );
  const final = records.at(-1);
  if (!final) return null;
  const abnormal = [...records].reverse().find(
    (record) =>
      record.name === "app.uncaughtException" ||
      record.name === "uncaught.exception" ||
      record.name === "uncaught exception" ||
      record.name === "quit.cleanupFailed" ||
      (record.name === "renderer.processGone" && record.level === "error"),
  );
  if (final.name === "quit.cleanupCompleted" && !abnormal) return null;
  return {
    sessionId: latest[0],
    text: records.map((record) => JSON.stringify(record)).join("\n"),
    firstSequenceNumber: records[0]?.seq ?? 0,
    lastSequenceNumber: final.seq,
    finalEventName: final.name,
    abnormalReason: abnormal?.name ?? final.name,
    errorCount: records.filter((record) => record.level === "error").length,
    warningCount: records.filter((record) => record.level === "warn").length,
  };
}

export function buildDiagnosticReport({
  summary,
  eventsText,
  previous,
  capture,
  profilerContaminated,
  sessionId,
  captureLevel,
}: {
  summary: DiagnosticSummary;
  eventsText: string;
  previous: PreviousSessionExport | null;
  capture: { metadata: CaptureMetadata } | null;
  profilerContaminated: boolean;
  sessionId: string;
  captureLevel: 0 | 1 | 2;
}): DiagnosticReport {
  const records = parseLogRecords(eventsText);
  const errors = records.filter((record) => record.level === "error");
  const startupStages = [
    "startup.complete",
    "frame.firstSubmit",
    "runtime.initialized",
    "wasm.instantiate.end",
    "renderer.loaded",
    "electronReady",
  ];
  const startupStage =
    startupStages.find(
      (name) => Number(summary.latest[`milestone.${name}Us`]) > 0,
    ) ?? "diagnostics.started";
  return {
    formatVersion: 1,
    generatedAt: new Date().toISOString(),
    currentSession: {
      sessionId,
      startupStage,
      errorCount: errors.length,
      warningCount: records.filter((record) => record.level === "warn").length,
      lastError: errors.length
        ? {
            subsystem: errors.at(-1)!.subsystem,
            name: errors.at(-1)!.name,
          }
        : null,
      droppedEvents: summary.droppedEvents,
    },
    previousSession: previous
      ? {
          sessionId: previous.sessionId,
          cleanShutdown: false,
          finalEventName: previous.finalEventName,
          abnormalReason: previous.abnormalReason,
          errorCount: previous.errorCount,
          warningCount: previous.warningCount,
        }
      : null,
    capture: {
      level: captureLevel,
      profilerContaminated,
      stopReason: capture?.metadata.stopReason ?? null,
      visibility:
        summary.latest["renderer.visible"] === true
          ? "visible"
          : summary.latest["renderer.visible"] === false
            ? "hidden"
            : "unknown",
    },
    performance: {
      frameP95Us:
        summary.histograms["renderer.visibleSubmitInterval"]?.p95Us ?? 0,
      snapshotP95Us: summary.histograms["snapshot.rendererRead"]?.p95Us ?? 0,
      socketSyncP95Us:
        summary.histograms["socket.rendererSync"]?.p95Us ?? 0,
    },
  };
}
