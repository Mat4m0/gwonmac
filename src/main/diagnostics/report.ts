/**
 * Reading sessions back: the one parser for a session's JSONL, and the summary
 * document an export carries.
 *
 * A process killed between a write and its newline leaves one incomplete final
 * record, and that is ordinary — it costs the reader that record and nothing
 * else. Interior corruption is not tolerated the same way. Both the current
 * session's export and the previous session's report come through the same
 * parser, so one cannot be lenient while the other throws.
 *
 * The report is derived entirely from records and counters. It quotes no
 * message text and reaches for no source outside what was already recorded.
 */
import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import type {
  DiagnosticReport,
  DiagnosticSummary,
} from "../../shared/diagnostics.js";
import type {
  CaptureMetadata,
  LogRecord,
} from "./flight-recorder.js";
import { ValidationError } from "../../shared/errors.js";

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

/**
 * The one reader of a session's JSONL. A process killed between `write` and
 * the newline leaves one incomplete final record, and that is normal: it must
 * cost the reader that record and nothing else. Both the current session's
 * export and the previous session's report come through here, so neither can
 * be tolerant while the other throws.
 */
export function parseLogRecords(text: string): LogRecord[] {
  const records: LogRecord[] = [];
  const lines = text.split("\n");
  let finalNonEmpty = -1;
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    if (lines[index]) {
      finalNonEmpty = index;
      break;
    }
  }
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]!;
    if (!line) {
      // One or more line endings after the final record are harmless. An
      // empty line before later data is interior corruption, just like an
      // invalid JSON value there; the recorder never writes blank records.
      if (index < finalNonEmpty) {
        throw new ValidationError(
          `diagnostics event log line ${index + 1} is invalid`,
        );
      }
      continue;
    }
    let valid = false;
    try {
      const record = JSON.parse(line) as LogRecord;
      if (
        Number.isSafeInteger(record.seq) &&
        typeof record.name === "string" &&
        typeof record.level === "string" &&
        typeof record.subsystem === "string"
      ) {
        records.push(record);
        valid = true;
      }
    } catch {
      // Handled below: only the final non-empty record may be torn.
    }
    if (!valid && index !== finalNonEmpty) {
      // Never quote the line: validation of a diagnostics file must not turn
      // the private value it rejected into a new error message.
      throw new ValidationError(
        `diagnostics event log line ${index + 1} is invalid`,
      );
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
  const records = (
    await Promise.all(
      latest[1].files.map(async (file) => {
        const text = await readFile(file, "utf8").catch(() => null);
        return text === null ? [] : parseLogRecords(text);
      }),
    )
  )
    .flat()
    .sort((left, right) => left.seq - right.seq);
  const final = records.at(-1);
  if (!final) return null;
  const abnormal = [...records].reverse().find(
    (record) =>
      record.name === "app.uncaughtException" ||
      record.name === "uncaught.exception" ||
      record.name === "uncaught exception" ||
      record.name === "quit.cleanupFailed" ||
      // A game-client abort or non-zero exit is a crash even when the app
      // itself then quits cleanly; without these the crashed session
      // exported as "normal".
      record.name === "wasm.abort" ||
      record.name === "wasm.exit" ||
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
