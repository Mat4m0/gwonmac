import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { diagnosticEventRecord } from "../../src/main/diagnostics/schema.ts";
import type { DiagnosticEvent } from "../../src/main/diagnostics/schema.ts";
import { isRendererMetrics, type RendererMetrics } from "../../src/shared/diagnostics.ts";
import {
  analyzeFrames,
  comparisonWarnings,
  isDiagnosticReport,
  validateCapture,
  type Capture,
} from "../../src/tools/diagnostics/common.ts";

function metrics(): RendererMetrics {
  return {
    intervalMs: 2000,
    visible: true,
    focused: true,
    rafCount: 120,
    rafTotalUs: 2_000_000,
    rafMinUs: 16_000,
    rafMaxUs: 17_000,
    rafOver33: 0,
    rafOver50: 0,
    swapCount: 120,
    swapTotalUs: 12_000,
    swapMinUs: 50,
    swapMaxUs: 300,
    presentationFailures: 0,
    submitIntervalCount: 119,
    submitIntervalTotalUs: 1_983_333,
    submitIntervalMinUs: 16_000,
    submitIntervalMaxUs: 17_000,
    visibleSubmitIntervalCount: 119,
    visibleSubmitIntervalTotalUs: 1_983_333,
    visibleSubmitIntervalMinUs: 16_000,
    visibleSubmitIntervalMaxUs: 17_000,
    hiddenSubmitIntervalCount: 0,
    hiddenSubmitIntervalTotalUs: 0,
    hiddenSubmitIntervalMinUs: 0,
    hiddenSubmitIntervalMaxUs: 0,
    bitmapOutTotalUs: 4_000,
    bitmapOutMinUs: 20,
    bitmapOutMaxUs: 50,
    bitmapPresentTotalUs: 2_000,
    bitmapPresentMinUs: 10,
    bitmapPresentMaxUs: 25,
    snapshotReads: 2,
    snapshotBytes: 8192,
    snapshotTotalUs: 20_000,
    snapshotMinUs: 5_000,
    snapshotMaxUs: 15_000,
    snapshotMemoryReads: 1,
    memoryHits: 1,
    nativeHits: 1,
    coalesced: 0,
    glProgramQueryHits: 0,
    glProgramQueryMisses: 0,
    memoryCacheBytes: 1024,
    memoryCacheChunks: 1,
    pendingChunks: 0,
    activeDemand: 0,
    activePrefetch: 0,
    queuedDemand: 0,
    queuedPrefetch: 0,
    cacheEvictions: 0,
    queuePromotions: 0,
    socketSendCalls: 1,
    socketPayloadBytes: 21,
    socketSourceBackingMaxBytes: 64 * 1024 * 1024,
    socketCompactBytes: 21,
    socketSyncTotalUs: 90,
    socketSyncMinUs: 90,
    socketSyncMaxUs: 90,
    socketSettles: 1,
    socketSettleTotalUs: 400,
    socketSettleMinUs: 400,
    socketSettleMaxUs: 400,
    inputToSubmitCount: 1,
    inputToSubmitTotalUs: 8_000,
    inputToSubmitMinUs: 8_000,
    inputToSubmitMaxUs: 8_000,
    droppedRecords: 0,
    rendererEvents: [],
    rafHistogram: [0, 0, 0, 0, 0, 0, 0, 0, 120, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    swapHistogram: [100, 20, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    submitIntervalHistogram: [0, 0, 0, 0, 0, 0, 0, 0, 119, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    visibleSubmitIntervalHistogram: [0, 0, 0, 0, 0, 0, 0, 0, 119, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    hiddenSubmitIntervalHistogram: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    bitmapOutHistogram: [120, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    bitmapPresentHistogram: [120, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    snapshotHistogram: [0, 0, 0, 0, 0, 0, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    socketSyncHistogram: [1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    socketSettleHistogram: [0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    inputToSubmitHistogram: [0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    socketSendEvents: [1_000, 90, 400, 21, 64 * 1024 * 1024, 21, 1],
  };
}

describe("renderer diagnostics boundary", () => {
  it("accepts the complete bounded aggregate", () => {
    assert.equal(isRendererMetrics(metrics()), true);
    assert.equal(
      isRendererMetrics({
        ...metrics(),
        rendererEvents: [
          {
            timestampUs: 123,
            name: "graphics.contextLost",
            fingerprint: "12abcdef",
          },
        ],
      }),
      true,
    );
  });

  it("rejects missing, negative, and non-finite values", () => {
    const missing = { ...metrics() } as Partial<RendererMetrics>;
    delete missing.swapCount;
    assert.equal(isRendererMetrics(missing), false);
    assert.equal(isRendererMetrics({ ...metrics(), snapshotBytes: -1 }), false);
    assert.equal(
      isRendererMetrics({ ...metrics(), snapshotMemoryReads: 3 }),
      false,
    );
    assert.equal(isRendererMetrics({ ...metrics(), rafMaxUs: Number.NaN }), false);
    assert.equal(
      isRendererMetrics({ ...metrics(), socketCompactBytes: 64 * 1024 * 1024 }),
      false,
    );
    const inconsistent = metrics();
    inconsistent.rafHistogram[0] = 1;
    assert.equal(isRendererMetrics(inconsistent), false);
    assert.equal(
      isRendererMetrics({ ...metrics(), rafOver50: 2, rafOver33: 1 }),
      false,
    );
    assert.equal(
      isRendererMetrics({ ...metrics(), presentationFailures: 121 }),
      false,
    );
    assert.equal(
      isRendererMetrics({
        ...metrics(),
        rendererEvents: [{ timestampUs: 1, name: "unknown" }],
      }),
      false,
    );
    assert.equal(
      isRendererMetrics({
        ...metrics(),
        rendererEvents: [
          {
            timestampUs: 1,
            name: "renderer.windowError",
            fingerprint: "not-a-hash",
          },
        ],
      }),
      false,
    );
    assert.equal(
      isRendererMetrics({
        ...metrics(),
        rendererEvents: Array.from({ length: 65 }, (_, timestampUs) => ({
          timestampUs,
          name: "renderer.windowError",
        })),
      }),
      false,
    );
  });
});

describe("frame capture analysis", () => {
  it("uses exact visible intervals and resets across hidden records", () => {
    const rows = [
      [1_000, 0, 0, 0, 1, 1, 1],
      [17_000, 0, 0, 0, 1, 1, 1],
      [33_000, 0, 0, 0, 1, 1, 0],
      [1_000_000, 0, 0, 0, 1, 1, 1],
      [1_050_001, 0, 0, 0, 1, 1, 1],
    ];
    const bytes = new Uint8Array(16 + rows.length * 7 * 8);
    bytes.set(new TextEncoder().encode("GWFRAME1"));
    const view = new DataView(bytes.buffer);
    view.setUint32(8, 7, true);
    rows.flat().forEach((value, index) => {
      view.setFloat64(16 + index * 8, value, true);
    });
    const result = analyzeFrames(bytes);
    assert.equal(result.records, 5);
    assert.equal(result.visibleRecords, 4);
    assert.equal(result.intervals, 2);
    assert.equal(result.p50Us, 16_000);
    assert.equal(result.p95Us, 50_001);
    assert.equal(result.stallsOver50Ms, 1);
    assert.equal(result.visibility, "mixed");
  });
});

function eventLog(events: DiagnosticEvent[]): string {
  return events
    .map((event, index) => {
      const record = diagnosticEventRecord(event);
      return JSON.stringify({
        seq: index + 1,
        tsUs: (index + 1) * 1_000,
        wallTime: new Date((index + 1) * 1_000).toISOString(),
        level: record.level,
        subsystem: record.subsystem,
        name: record.name,
        fields: record.fields,
      });
    })
    .join("\n");
}

/** A format 2 export: no histograms.json, and a redaction result to reproduce. */
function currentCapture(events: DiagnosticEvent[]): Capture {
  return {
    manifest: {
      formatVersion: 2,
      applicationVersion: "1.0.0",
      sessionId: "session",
      captureLevel: 0,
      exportedAt: new Date(0).toISOString(),
      droppedEventCount: 0,
      includedFiles: [
        "manifest.json",
        "summary.json",
        "events.jsonl",
        "environment.json",
        "settings-redacted.json",
      ],
      redaction: {
        records: events.length,
        schemaChecked: events.length,
        traceBytesScanned: 0,
      },
      profilerContaminated: false,
    },
    summary: {
      sessionId: "session",
      uptimeMs: 1000,
      captureLevel: 0,
      droppedEvents: 0,
      counters: {},
      histograms: {},
      latest: {},
    },
    environment: {},
    eventLog: eventLog(events),
  };
}

describe("capture validation, format 2", () => {
  const events: DiagnosticEvent[] = [
    { k: "socket.close", socketId: 1, reason: "peer" },
    { k: "settings.saveFailed", code: "disk_full" },
  ];

  it("reproduces the manifest's redaction result from events.jsonl", () => {
    assert.deepEqual(validateCapture(currentCapture(events)), []);
  });

  it("refuses a manifest whose redaction result the event log does not support", () => {
    const capture = currentCapture(events);
    // The failure mode `redaction: "passed"` could never have: a manifest
    // that claims a scan wider than the file it shipped.
    assert.equal(capture.manifest.formatVersion, 2);
    if (capture.manifest.formatVersion !== 2) return;
    capture.manifest.redaction.schemaChecked = 9;
    assert.match(
      validateCapture(capture).join("\n"),
      /claims 9 schema-checked records, events\.jsonl has 2/,
    );
  });

  it("rejects an event log carrying a field the schema does not declare", () => {
    const capture = currentCapture(events);
    capture.eventLog = `${capture.eventLog}\n${JSON.stringify({
      seq: 3,
      tsUs: 3_000,
      wallTime: new Date(3_000).toISOString(),
      level: "error",
      subsystem: "app",
      name: "app.uncaughtException",
      fields: { code: "unknown", message: "ENOENT /Users/x/secret.txt" },
    })}`;
    assert.match(
      validateCapture(capture).join("\n"),
      /events\.jsonl is not exportable[\s\S]*undeclared field message/,
    );
  });

  it("does not require histograms.json, and does require the rest", () => {
    const capture = currentCapture(events);
    assert.equal(
      validateCapture(capture).join("\n").includes("histograms.json"),
      false,
    );
    capture.manifest.includedFiles = capture.manifest.includedFiles.filter(
      (file) => file !== "summary.json",
    );
    assert.match(validateCapture(capture).join("\n"), /does not declare summary\.json/);
  });

  it("refuses a trace scan the included files do not corroborate", () => {
    const capture = currentCapture(events);
    if (capture.manifest.formatVersion !== 2) return;
    capture.manifest.redaction.traceBytesScanned = 4096;
    assert.match(
      validateCapture(capture).join("\n"),
      /trace scan and included files disagree/,
    );
  });
});

// Format 1 is the alpha's export, and 117 of them are in the wild. The
// validator keeps reading it: `histograms.json` stays required there and
// `redaction: "passed"` stays the only verdict it can offer, because nothing
// in a format 1 export can reproduce more than that.
describe("capture validation, format 1", () => {
  it("accepts a complete redacted capture and rejects dropped records", () => {
    const capture: Capture = {
      manifest: {
        formatVersion: 1,
        applicationVersion: "1.0.0",
        sessionId: "session",
        captureLevel: 0,
        exportedAt: new Date(0).toISOString(),
        droppedEventCount: 0,
        includedFiles: [
          "manifest.json",
          "summary.json",
          "events.jsonl",
          "histograms.json",
          "environment.json",
          "settings-redacted.json",
        ],
        redaction: "passed",
        profilerContaminated: false,
      },
      summary: {
        sessionId: "session",
        uptimeMs: 1000,
        captureLevel: 0,
        droppedEvents: 0,
        counters: {},
        histograms: {},
        latest: {},
      },
      environment: {},
    };
    assert.deepEqual(validateCapture(capture), []);
    capture.summary.droppedEvents = 2;
    assert.match(validateCapture(capture).join("\n"), /2 flight-recorder events/);
    capture.summary.droppedEvents = 0;
    capture.manifest.includedFiles = capture.manifest.includedFiles.filter(
      (file) => file !== "histograms.json",
    );
    assert.match(
      validateCapture(capture).join("\n"),
      /does not declare histograms\.json/,
    );
  });

  it("refuses to call a Level 2 capture complete without its Chromium trace", () => {
    const capture: Capture = {
      manifest: {
        formatVersion: 1,
        applicationVersion: "1.0.0",
        sessionId: "session",
        captureLevel: 2,
        exportedAt: new Date(0).toISOString(),
        droppedEventCount: 0,
        includedFiles: [
          "manifest.json",
          "summary.json",
          "events.jsonl",
          "histograms.json",
          "environment.json",
          "settings-redacted.json",
        ],
        redaction: "passed",
        profilerContaminated: false,
      },
      summary: {
        sessionId: "session",
        uptimeMs: 1000,
        captureLevel: 2,
        droppedEvents: 0,
        counters: {},
        histograms: {},
        latest: {},
      },
      environment: {},
    };
    assert.match(
      validateCapture(capture).join("\n"),
      /Level 2 capture has no Chromium trace/,
    );
    capture.manifest.includedFiles.push("chromium-trace.json");
    assert.deepEqual(validateCapture(capture), []);
    // A capture that never asked for a trace is not missing one.
    capture.manifest.includedFiles.pop();
    capture.manifest.captureLevel = 1;
    capture.summary.captureLevel = 1;
    assert.deepEqual(validateCapture(capture), []);
  });

  it("validates the machine-readable report without requiring it in old captures", () => {
    const report = {
      formatVersion: 1,
      generatedAt: new Date(0).toISOString(),
      currentSession: {
        sessionId: "session",
        startupStage: "startup.complete",
        errorCount: 0,
        warningCount: 1,
        lastError: null,
        droppedEvents: 0,
      },
      previousSession: null,
      capture: {
        level: 1,
        profilerContaminated: false,
        stopReason: "manual",
        visibility: "visible",
      },
      performance: {
        frameP95Us: 18_000,
        snapshotP95Us: 1_000,
        socketSyncP95Us: 100,
      },
    };
    assert.equal(isDiagnosticReport(report), true);
    assert.equal(
      isDiagnosticReport({
        ...report,
        performance: { ...report.performance, frameP95Us: Number.NaN },
      }),
      false,
    );
  });

  it("warns for same-session overlapping captures and mixed levels", () => {
    const base: Capture = {
      manifest: {
        formatVersion: 1,
        applicationVersion: "1",
        sessionId: "same",
        captureLevel: 0,
        exportedAt: new Date(0).toISOString(),
        droppedEventCount: 0,
        includedFiles: [],
        redaction: "passed",
        profilerContaminated: false,
        capture: {
          startMonotonicUs: 100,
          endMonotonicUs: 300,
          stopReason: "manual",
        },
      },
      summary: {
        sessionId: "same",
        uptimeMs: 1,
        captureLevel: 0,
        droppedEvents: 0,
        counters: {},
        histograms: {},
        latest: {},
      },
      environment: {},
    };
    const candidate = structuredClone(base);
    candidate.manifest.captureLevel = 1;
    candidate.manifest.capture = {
      startMonotonicUs: 200,
      endMonotonicUs: 400,
      stopReason: "manual",
    };
    assert.match(
      comparisonWarnings(base, candidate).join("\n"),
      /same session[\s\S]*overlap[\s\S]*Level 0/,
    );
  });
});
