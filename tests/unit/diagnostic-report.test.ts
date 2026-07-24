import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import {
  buildDiagnosticReport,
  previousAbnormalSession,
} from "../../src/main/diagnostic-report.ts";
import type { DiagnosticSummary } from "../../src/shared/diagnostics.ts";

function event(
  sequence: number,
  level: "info" | "warn" | "error",
  name: string,
): string {
  return JSON.stringify({
    seq: sequence,
    tsUs: sequence,
    wallTime: new Date(sequence).toISOString(),
    level,
    subsystem: "app",
    name,
  });
}

describe("diagnostic report", () => {
  it("selects the newest abnormal prior session and tolerates a torn tail", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "gw-report-"));
    const currentSessionId = randomUUID();
    const previousSessionId = randomUUID();
    try {
      await writeFile(
        path.join(directory, `session-${currentSessionId}.jsonl`),
        event(1, "info", "diagnostics.started"),
      );
      await writeFile(
        path.join(directory, `session-${previousSessionId}.jsonl`),
        [
          event(1, "info", "diagnostics.started"),
          event(2, "error", "app.uncaughtException"),
          event(3, "info", "quit.cleanupCompleted"),
          '{"seq":4',
        ].join("\n"),
      );

      assert.deepEqual(
        await previousAbnormalSession(directory, currentSessionId),
        {
          sessionId: previousSessionId,
          text: [
            event(1, "info", "diagnostics.started"),
            event(2, "error", "app.uncaughtException"),
            event(3, "info", "quit.cleanupCompleted"),
          ].join("\n"),
          firstSequenceNumber: 1,
          lastSequenceNumber: 3,
          finalEventName: "quit.cleanupCompleted",
          abnormalReason: "app.uncaughtException",
          errorCount: 1,
          warningCount: 0,
        },
      );
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("derives startup, capture, and performance fields from canonical data", () => {
    const summary: DiagnosticSummary = {
      sessionId: "summary-session",
      uptimeMs: 100,
      captureLevel: 1,
      droppedEvents: 2,
      counters: {},
      histograms: {
        "renderer.visibleSubmitInterval": {
          count: 1,
          minUs: 1,
          maxUs: 2,
          meanUs: 1,
          p50Us: 1,
          p95Us: 2,
          p99Us: 2,
        },
      },
      latest: {
        "milestone.runtime.initializedUs": 42,
        "renderer.visible": true,
      },
    };

    const report = buildDiagnosticReport({
      summary,
      eventsText: [
        event(1, "info", "diagnostics.started"),
        event(2, "error", "renderer.processGone"),
      ].join("\n"),
      previous: null,
      capture: {
        metadata: {
          startedUs: 1,
          endedUs: 2,
          stopReason: "manual",
          firstSequenceNumber: 1,
          lastSequenceNumber: 2,
        },
      },
      profilerContaminated: false,
      sessionId: "current-session",
      captureLevel: 1,
    });

    assert.equal(report.currentSession.sessionId, "current-session");
    assert.equal(report.currentSession.startupStage, "runtime.initialized");
    assert.deepEqual(report.currentSession.lastError, {
      subsystem: "app",
      name: "renderer.processGone",
    });
    assert.deepEqual(report.capture, {
      level: 1,
      profilerContaminated: false,
      stopReason: "manual",
      visibility: "visible",
    });
    assert.equal(report.performance.frameP95Us, 2);
  });
});
