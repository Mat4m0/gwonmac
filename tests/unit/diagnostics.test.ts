import assert from "node:assert/strict";
import { describe, it } from "node:test";
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
    rafCount: 120,
    rafTotalUs: 2_000_000,
    rafMinUs: 16_000,
    rafMaxUs: 17_000,
    rafOver16: 4,
    rafOver33: 0,
    rafOver50: 0,
    swapCount: 120,
    swapTotalUs: 12_000,
    swapMinUs: 50,
    swapMaxUs: 300,
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
    memoryHits: 1,
    nativeHits: 1,
    coalesced: 0,
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
    socketSourceBackingBytes: 64 * 1024 * 1024,
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

describe("capture validation", () => {
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
