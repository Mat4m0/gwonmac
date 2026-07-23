import { resolve } from "node:path";
import type { Capture } from "./common.js";
import {
  comparisonWarnings,
  withCapture,
  validateCapture,
} from "./common.js";

const [beforePath, afterPath] = process.argv.slice(2);
if (!beforePath || !afterPath) {
  console.error("usage: pnpm diagnostics:compare <before.gwdiag> <after.gwdiag>");
  process.exitCode = 2;
} else {
  await withCapture(resolve(beforePath), async (before) => {
    await withCapture(resolve(afterPath), (after) => compare(before, after));
  });
}

function compare(before: Capture, after: Capture): void {
  const warnings = [...validateCapture(before), ...validateCapture(after)];
  const beforePerformance = before.captureSummary ?? before.summary;
  const afterPerformance = after.captureSummary ?? after.summary;
  warnings.push(...comparisonWarnings(before, after));
  for (const [label, summary] of [
    ["baseline", beforePerformance],
    ["candidate", afterPerformance],
  ] as const) {
    const payload = summary.counters["socket.ipcPayloadBytes"] ?? 0;
    const backing = summary.counters["socket.ipcBackingBytes"] ?? 0;
    if (payload && backing > payload * 4) {
      warnings.push(`${label} has socket IPC backing-buffer amplification`);
    }
  }
  const bGraphics = before.environment.graphics as Record<string, unknown> | undefined;
  const aGraphics = after.environment.graphics as Record<string, unknown> | undefined;
  const bDisplay = before.environment.primaryDisplay as
    | Record<string, unknown>
    | undefined;
  const aDisplay = after.environment.primaryDisplay as
    | Record<string, unknown>
    | undefined;
  const compatibility = [
    ["architecture", before.environment.architecture, after.environment.architecture],
    ["CPU", before.environment.cpuModel, after.environment.cpuModel],
    [
      "logical CPU count",
      before.environment.logicalCpuCount,
      after.environment.logicalCpuCount,
    ],
    ["display width", bDisplay?.width, aDisplay?.width],
    ["display height", bDisplay?.height, aDisplay?.height],
    ["display refresh", bDisplay?.refreshRateHz, aDisplay?.refreshRateHz],
    ["OS", before.environment.osRelease, after.environment.osRelease],
    ["app", before.manifest.applicationVersion, after.manifest.applicationVersion],
    [
      "client build",
      before.summary.latest["client.buildId"],
      after.summary.latest["client.buildId"],
    ],
    ["renderer", bGraphics?.renderer, aGraphics?.renderer],
    [
      "hardware acceleration",
      bGraphics?.hardwareAcceleration,
      aGraphics?.hardwareAcceleration,
    ],
    ["render scale", bGraphics?.renderScale, aGraphics?.renderScale],
    [
      "device pixel ratio",
      bGraphics?.devicePixelRatio,
      aGraphics?.devicePixelRatio,
    ],
    ["canvas width", bGraphics?.canvasWidth, aGraphics?.canvasWidth],
    ["canvas height", bGraphics?.canvasHeight, aGraphics?.canvasHeight],
    ["capture level", before.manifest.captureLevel, after.manifest.captureLevel],
    [
      "thermal state",
      before.summary.latest["system.thermalState"],
      after.summary.latest["system.thermalState"],
    ],
    [
      "power source",
      before.summary.latest["system.onBattery"],
      after.summary.latest["system.onBattery"],
    ],
    [
      "initial cached chunks",
      before.summary.latest["cache.initialResidentChunks"],
      after.summary.latest["cache.initialResidentChunks"],
    ],
  ] as const;
  for (const [name, baseline, candidate] of compatibility) {
    if (baseline !== candidate) warnings.push(`${name} differs (${String(baseline)} vs ${String(candidate)})`);
  }
  if (warnings.length) {
    console.log("Comparison is suspect:");
    for (const warning of warnings) console.log(`  - ${warning}`);
    console.log("");
  }

  const histogramMetric = (
    label: string,
    histogram: string,
    field: "p95Us" | "p99Us",
  ) => ({
    label,
    before: beforePerformance.histograms[histogram]?.[field] ?? 0,
    after: afterPerformance.histograms[histogram]?.[field] ?? 0,
  });
  const metrics = [
    {
      label: "submit p95",
      before:
        before.frames?.p95Us ??
        beforePerformance.histograms["renderer.visibleSubmitInterval"]?.p95Us ??
        beforePerformance.histograms["renderer.submitInterval"]?.p95Us ??
        0,
      after:
        after.frames?.p95Us ??
        afterPerformance.histograms["renderer.visibleSubmitInterval"]?.p95Us ??
        afterPerformance.histograms["renderer.submitInterval"]?.p95Us ??
        0,
    },
    {
      label: "submit p99",
      before:
        before.frames?.p99Us ??
        beforePerformance.histograms["renderer.visibleSubmitInterval"]?.p99Us ??
        beforePerformance.histograms["renderer.submitInterval"]?.p99Us ??
        0,
      after:
        after.frames?.p99Us ??
        afterPerformance.histograms["renderer.visibleSubmitInterval"]?.p99Us ??
        afterPerformance.histograms["renderer.submitInterval"]?.p99Us ??
        0,
    },
    histogramMetric("rAF p95", "renderer.rafInterval", "p95Us"),
    histogramMetric("rAF p99", "renderer.rafInterval", "p99Us"),
    histogramMetric("swap p95", "renderer.swap", "p95Us"),
    histogramMetric("bitmap-out p95", "renderer.bitmapOut", "p95Us"),
    histogramMetric("bitmap-present p95", "renderer.bitmapPresent", "p95Us"),
    histogramMetric("snapshot p95", "snapshot.rendererRead", "p95Us"),
    histogramMetric("socket sync p95", "socket.rendererSync", "p95Us"),
    histogramMetric("socket settle p95", "socket.rendererSettle", "p95Us"),
    histogramMetric("socket write p95", "socket.writeCallback", "p95Us"),
    histogramMetric("disk-read p95", "cache.diskRead", "p95Us"),
    {
      label: "demand-queue p95",
      before:
        beforePerformance.histograms["cache.demandQueueWait"]?.p95Us ??
        beforePerformance.histograms["cache.queueWait"]?.p95Us ??
        0,
      after:
        afterPerformance.histograms["cache.demandQueueWait"]?.p95Us ??
        afterPerformance.histograms["cache.queueWait"]?.p95Us ??
        0,
    },
    {
      label: "network-wire p95",
      before:
        beforePerformance.histograms["cache.networkWire"]?.p95Us ??
        beforePerformance.histograms["cache.networkFetch"]?.p95Us ??
        0,
      after:
        afterPerformance.histograms["cache.networkWire"]?.p95Us ??
        afterPerformance.histograms["cache.networkFetch"]?.p95Us ??
        0,
    },
    {
      label: "event-loop p99",
      before: Number(beforePerformance.latest["main.eventLoopP99Us"]) || 0,
      after: Number(afterPerformance.latest["main.eventLoopP99Us"]) || 0,
    },
    {
      label: "first frame",
      before: Number(before.summary.latest["milestone.frame.firstSubmitUs"]) || 0,
      after: Number(after.summary.latest["milestone.frame.firstSubmitUs"]) || 0,
    },
    {
      label: "startup complete",
      before: Number(before.summary.latest["milestone.startup.completeUs"]) || 0,
      after: Number(after.summary.latest["milestone.startup.completeUs"]) || 0,
    },
  ];
  console.log("Metric                 before       after       change");
  for (const { label, before: baseline, after: candidate } of metrics) {
    const percent = baseline ? ((candidate - baseline) / baseline) * 100 : 0;
    console.log(
      `${label.padEnd(20)} ${(baseline / 1000).toFixed(2).padStart(8)} ms ` +
        `${(candidate / 1000).toFixed(2).padStart(8)} ms ${percent.toFixed(1).padStart(8)}%`,
    );
  }
  console.log("\nSocket bytes             before       after");
  for (const [label, metric] of [
    ["logical payload", "socket.rendererPayloadBytes"],
    ["source backing", "socket.rendererSourceBackingBytes"],
    ["compact payload", "socket.rendererCompactBytes"],
    ["IPC payload", "socket.ipcPayloadBytes"],
    ["IPC backing", "socket.ipcBackingBytes"],
  ] as const) {
    console.log(
      `${label.padEnd(20)} ${String(beforePerformance.counters[metric] ?? 0).padStart(11)} ` +
        `${String(afterPerformance.counters[metric] ?? 0).padStart(11)}`,
    );
  }
  const cpuAverage = (
    capture: Capture,
    prefix: string,
    normalization: "OneCore" | "Electron",
  ) => {
    const summary = capture.captureSummary ?? capture.summary;
    const next = `${prefix}.cpuPercent${normalization}Sum`;
    return (
      (summary.counters[next] ??
        summary.counters[`${prefix}.cpuPercentSum`] ??
        0) /
      Math.max(1, summary.counters[`${prefix}.cpuSamples`] ?? 0)
    );
  };
  console.log("\nCPU average             before       after       change");
  for (const [label, prefix, normalization] of [
    ["main (one core)", "process.main", "OneCore"],
    ["renderer (Electron)", "process.tab", "Electron"],
    ["GPU (Electron)", "process.gpu", "Electron"],
  ] as const) {
    const baseline = cpuAverage(before, prefix, normalization);
    const candidate = cpuAverage(after, prefix, normalization);
    const percent = baseline ? ((candidate - baseline) / baseline) * 100 : 0;
    console.log(
      `${label.padEnd(20)} ${baseline.toFixed(1).padStart(8)}% ` +
        `${candidate.toFixed(1).padStart(8)}% ${percent.toFixed(1).padStart(8)}%`,
    );
  }
  console.log("\nSingle-run differences below natural variance are not proof of improvement.");
}
