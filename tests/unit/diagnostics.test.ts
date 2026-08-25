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
    rafOver33: 0,
    rafOver50: 0,
    swapCount: 120,
    presentationFailures: 0,
    submitIntervalCount: 119,
    visibleSubmitIntervalCount: 119,
    hiddenSubmitIntervalCount: 0,
    snapshotReads: 2,
    snapshotBytes: 8192,
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
    socketSettles: 1,
    inputToSubmitCount: 1,
    droppedRecords: 0,
    wasmHeapBytes: 335_544_320,
    rendererEvents: [],
    raf: {
      buckets: [0, 0, 0, 0, 0, 0, 0, 0, 120, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      totalUs: 2_000_000,
      minUs: 16_000,
      maxUs: 17_000,
    },
    swap: {
      buckets: [100, 20, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      totalUs: 12_000,
      minUs: 50,
      maxUs: 300,
    },
    submitInterval: {
      buckets: [0, 0, 0, 0, 0, 0, 0, 0, 119, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      totalUs: 1_983_333,
      minUs: 16_000,
      maxUs: 17_000,
    },
    visibleSubmitInterval: {
      buckets: [0, 0, 0, 0, 0, 0, 0, 0, 119, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      totalUs: 1_983_333,
      minUs: 16_000,
      maxUs: 17_000,
    },
    hiddenSubmitInterval: {
      buckets: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      totalUs: 0,
      minUs: 0,
      maxUs: 0,
    },
    bitmapOut: {
      buckets: [120, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      totalUs: 4_000,
      minUs: 20,
      maxUs: 50,
    },
    bitmapPresent: {
      buckets: [120, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      totalUs: 2_000,
      minUs: 10,
      maxUs: 25,
    },
    snapshot: {
      buckets: [0, 0, 0, 0, 0, 0, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      totalUs: 20_000,
      minUs: 5_000,
      maxUs: 15_000,
    },
    socketSync: {
      buckets: [1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      totalUs: 90,
      minUs: 90,
      maxUs: 90,
    },
    socketSettle: {
      buckets: [0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      totalUs: 400,
      minUs: 400,
      maxUs: 400,
    },
    inputToSubmit: {
      buckets: [0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      totalUs: 8_000,
      minUs: 8_000,
      maxUs: 8_000,
    },
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
    const nonFinite = metrics();
    nonFinite.raf.maxUs = Number.NaN;
    assert.equal(isRendererMetrics(nonFinite), false);
    assert.equal(
      isRendererMetrics({ ...metrics(), socketCompactBytes: 64 * 1024 * 1024 }),
      false,
    );
    const inconsistent = metrics();
    inconsistent.raf.buckets[0] = 1;
    assert.equal(isRendererMetrics(inconsistent), false);
    const strayField = metrics();
    assert.equal(
      isRendererMetrics({ ...strayField, raf: { ...strayField.raf, count: 120 } }),
      false,
    );
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

  it("requires explicit consent and a valid PNG for visual evidence", () => {
    const capture = currentCapture(events);
    capture.visualProblemScreenshot = new Uint8Array([
      137, 80, 78, 71, 13, 10, 26, 10,
    ]);
    assert.match(
      validateCapture(capture).join("\n"),
      /screenshot file presence is inconsistent/,
    );

    capture.manifest.includedFiles.push("visual-problem.png");
    assert.match(
      validateCapture(capture).join("\n"),
      /screenshot has no manifest declaration/,
    );

    capture.manifest.visualProblem = {
      rendererOutcome: "completed",
      gameWindowCount: 2,
      screenshotRequested: false,
      screenshotIncluded: true,
      screenshotPrivacy: "player-consented-unscanned",
    };
    assert.match(
      validateCapture(capture).join("\n"),
      /screenshot was included without consent/,
    );

    capture.manifest.visualProblem.screenshotRequested = true;
    capture.visualProblemScreenshot = new Uint8Array([1, 2, 3]);
    assert.match(
      validateCapture(capture).join("\n"),
      /screenshot is not a PNG/,
    );

    capture.visualProblemScreenshot = new Uint8Array([
      137, 80, 78, 71, 13, 10, 26, 10,
    ]);
    assert.deepEqual(validateCapture(capture), []);

    Object.defineProperty(capture.manifest, "visualProblem", {
      configurable: true,
      value: {
        rendererOutcome: "completed",
        gameWindowCount: 2,
        screenshotRequested: "false",
        screenshotIncluded: true,
        screenshotPrivacy: "player-consented-unscanned",
      },
    });
    assert.match(
      validateCapture(capture).join("\n"),
      /manifest declaration is invalid/,
    );
  });
});

function visualCapture(): Capture {
  const capture = currentCapture([]);
  const png = new Uint8Array(24);
  png.set([137, 80, 78, 71, 13, 10, 26, 10]);
  const view = new DataView(png.buffer);
  view.setUint32(16, 1);
  view.setUint32(20, 1);
  capture.manifest.formatVersion = 3;
  capture.manifest.visualProblem = {
    rendererOutcome: "completed",
    gameWindowCount: 1,
    screenshotRequested: true,
    includedStages: ["webgl", "offscreen", "canvas", "window"],
    missingStages: {},
    screenshotPrivacy: "player-consented-unscanned",
  };
  capture.manifest.includedFiles.push(
    "visual-capture.json",
    "visual-webgl.png",
    "visual-offscreen.png",
    "visual-canvas.png",
    "visual-window.png",
    "runtime-state.json",
  );
  capture.visualStages = {
    webgl: png,
    offscreen: png,
    canvas: png,
    window: png,
  };
  capture.visualCapture = {
    metadata: {},
    dimensions: {
      webgl: { width: 1, height: 1 },
      offscreen: { width: 1, height: 1 },
      canvas: { width: 1, height: 1 },
      window: { width: 1, height: 1 },
    },
    missing: {},
  };
  capture.runtimeState = {
    status: "active",
    diagnosticProfile: "official-baseline",
    extendedMemoryRequested: true,
    enhancementCapabilitiesRequested: {},
    generation: 1,
    presentationPath: "offscreen-imagebitmap",
    artifactKind: "official",
    extendedMemoryEffective: {},
    transforms: {},
    observers: {},
    snapshot: {},
  };
  return capture;
}

describe("capture validation, format 3 visual evidence", () => {
  it("accepts a complete self-consistent visual capture", () => {
    assert.deepEqual(validateCapture(visualCapture()), []);
  });

  it("requires one unique declaration and dimension record per image", () => {
    const duplicate = visualCapture();
    if (!duplicate.manifest.visualProblem
      || !("includedStages" in duplicate.manifest.visualProblem)) return;
    duplicate.manifest.visualProblem.includedStages = [
      ...duplicate.manifest.visualProblem.includedStages,
      "webgl",
    ];
    assert.match(
      validateCapture(duplicate).join("\n"),
      /visual-problem manifest declaration is invalid/,
    );

    const missingDimensions = visualCapture();
    const document = missingDimensions.visualCapture as {
      dimensions: Record<string, unknown>;
    };
    delete document.dimensions.webgl;
    assert.match(
      validateCapture(missingDimensions).join("\n"),
      /visual webgl has no recorded dimensions/,
    );
  });

  it("rejects dimension mismatches and dimensions without an image", () => {
    const mismatch = visualCapture();
    const document = mismatch.visualCapture as {
      dimensions: Record<string, { width: number; height: number }>;
    };
    document.dimensions.webgl = { width: 2, height: 1 };
    assert.match(
      validateCapture(mismatch).join("\n"),
      /recorded dimensions differ/,
    );

    const absent = visualCapture();
    delete absent.visualStages?.webgl;
    assert.match(
      validateCapture(absent).join("\n"),
      /records dimensions without an image/,
    );
  });

  it("requires valid runtime state and a visual declaration for format 3", () => {
    const missingRuntime = visualCapture();
    missingRuntime.runtimeState = undefined;
    assert.match(
      validateCapture(missingRuntime).join("\n"),
      /runtime-state\.json could not be read/,
    );

    const noVisualDeclaration = visualCapture();
    delete noVisualDeclaration.manifest.visualProblem;
    assert.match(
      validateCapture(noVisualDeclaration).join("\n"),
      /format 3 requires a visual-problem manifest declaration/,
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
