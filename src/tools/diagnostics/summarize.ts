import { resolve } from "node:path";
import { withCapture, validateCapture } from "./common.js";

const input = process.argv[2];
if (!input) {
  console.error("usage: pnpm diagnostics:summarize <capture.gwdiag>");
  process.exitCode = 2;
} else {
  await withCapture(resolve(input), (capture) => {
    const { summary, manifest } = capture;
    const performanceSummary = capture.captureSummary ?? summary;
    const warnings = validateCapture(capture);
    const h = performanceSummary.histograms;
    const c = performanceSummary.counters;
    const milliseconds = (value = 0) => `${(value / 1_000).toFixed(2)} ms`;
    const ratio = (hit: number, total: number) =>
      total ? `${((hit / total) * 100).toFixed(1)}%` : "n/a";
    const multiple = (value: number, base: number) =>
      base ? `${(value / base).toFixed(1)}x` : "n/a";
    const average = (sum: string, samples: string) =>
      (c[sum] ?? 0) / Math.max(1, c[samples] ?? 0);
    const cacheTotal =
      (c["cache.memoryHits"] ?? 0) +
      (c["cache.nativeHits"] ?? 0);

    console.log(`Session       ${manifest.sessionId}`);
    console.log(`App           ${manifest.applicationVersion}`);
    console.log(`Client build  ${String(summary.latest["client.buildId"] ?? "unknown")}`);
    console.log(`Capture       level ${manifest.captureLevel}`);
    console.log(
      `Trace impact  ${manifest.profilerContaminated ? "profiler-contaminated" : "clean"}`,
    );
    console.log(
      `Duration      ${(performanceSummary.uptimeMs / 1000).toFixed(1)} s` +
        (capture.captureSummary ? " (selected capture window)" : " (session)"),
    );
    console.log(`Validity      ${warnings.length ? "SUSPECT" : "valid"}`);
    for (const warning of warnings) console.log(`  - ${warning}`);
    console.log("");
    if (capture.report) {
      console.log("Health");
      console.log(`  startup stage    ${capture.report.currentSession.startupStage}`);
      console.log(
        `  errors / warnings ${capture.report.currentSession.errorCount} / ` +
          `${capture.report.currentSession.warningCount}`,
      );
      console.log(
        `  previous session ${
          capture.report.previousSession
            ? `abnormal: ${capture.report.previousSession.abnormalReason}`
            : "no abnormal session retained"
        }`,
      );
      console.log(
        `  dropped records  ${capture.report.currentSession.droppedEvents}`,
      );
      console.log("");
    }
    const milestone = (name: string) =>
      milliseconds(Number(summary.latest[`milestone.${name}Us`]) || 0);
    const instantiateUs =
      (Number(summary.latest["milestone.wasm.instantiate.endUs"]) || 0) -
      (Number(summary.latest["milestone.wasm.instantiate.beginUs"]) || 0);
    console.log("Startup");
    console.log(`  Electron ready    ${milestone("electronReady")}`);
    console.log(`  renderer loaded   ${milestone("renderer.loaded")}`);
    console.log(`  WASM instantiate  ${milliseconds(Math.max(0, instantiateUs))}`);
    console.log(`  runtime ready     ${milestone("runtime.initialized")}`);
    console.log(`  first frame       ${milestone("frame.firstSubmit")}`);
    console.log(`  startup complete  ${milestone("startup.complete")}`);
    console.log("");
    console.log("Frames");
    if (capture.frames) {
      console.log(
        `  visible exact p50/p95/p99 ${milliseconds(capture.frames.p50Us)} / ` +
          `${milliseconds(capture.frames.p95Us)} / ${milliseconds(capture.frames.p99Us)}`,
      );
      console.log(
        `  visible FPS       ${capture.frames.fps.toFixed(1)} ` +
          `(${capture.frames.intervals} intervals)`,
      );
      console.log(
        `  stalls >33/50/100 ms ${capture.frames.stallsOver33Ms} / ` +
          `${capture.frames.stallsOver50Ms} / ${capture.frames.stallsOver100Ms}; ` +
          `longest ${milliseconds(capture.frames.maxUs)}`,
      );
    } else {
      const submitted =
        h["renderer.visibleSubmitInterval"] ??
        h["renderer.submitInterval"];
      console.log(`  visible submit p50/p95/p99 ${milliseconds(submitted?.p50Us)} / ${milliseconds(submitted?.p95Us)} / ${milliseconds(submitted?.p99Us)}`);
    }
    console.log(`  rAF p50/p95/p99  ${milliseconds(h["renderer.rafInterval"]?.p50Us)} / ${milliseconds(h["renderer.rafInterval"]?.p95Us)} / ${milliseconds(h["renderer.rafInterval"]?.p99Us)}`);
    console.log(`  swap p95/max     ${milliseconds(h["renderer.swap"]?.p95Us)} / ${milliseconds(h["renderer.swap"]?.maxUs)}`);
    console.log(`  bitmap out/present p95 ${milliseconds(h["renderer.bitmapOut"]?.p95Us)} / ${milliseconds(h["renderer.bitmapPresent"]?.p95Us)}`);
    console.log(`  >33 ms intervals ${c["renderer.rafOver33"] ?? 0}`);
    console.log("");
    console.log("Snapshot");
    console.log(`  initial cache     ${summary.latest["cache.initialResidentChunks"] ?? 0} / ${summary.latest["cache.totalChunks"] ?? 0} chunks`);
    console.log(`  reads / bytes    ${c["snapshot.reads"] ?? 0} / ${c["snapshot.bytes"] ?? 0}`);
    console.log(`  read p95/max     ${milliseconds(h["snapshot.rendererRead"]?.p95Us)} / ${milliseconds(h["snapshot.rendererRead"]?.maxUs)}`);
    console.log(`  memory hit ratio ${ratio(c["cache.memoryHits"] ?? 0, cacheTotal)}`);
    console.log(`  disk p95         ${milliseconds(h["cache.diskRead"]?.p95Us)}`);
    console.log(
      `  demand queue p95 ${milliseconds(
        h["cache.demandQueueWait"]?.p95Us ?? h["cache.queueWait"]?.p95Us,
      )}`,
    );
    console.log(
      `  network wire p95 ${milliseconds(
        h["cache.networkWire"]?.p95Us ?? h["cache.networkFetch"]?.p95Us,
      )}`,
    );
    console.log("");
    console.log("Socket");
    const socketPayload = c["socket.rendererPayloadBytes"] ?? 0;
    const sourceBacking = c["socket.rendererSourceBackingBytes"] ?? 0;
    const compactBytes = c["socket.rendererCompactBytes"] ?? 0;
    const ipcPayload = c["socket.ipcPayloadBytes"] ?? 0;
    const ipcBacking = c["socket.ipcBackingBytes"] ?? 0;
    console.log(
      `  sends / bytes    ${c["socket.rendererSendCalls"] ?? 0} / ${socketPayload}`,
    );
    console.log(
      `  source / compact ${sourceBacking} / ${compactBytes} bytes ` +
        `(${multiple(sourceBacking, socketPayload)} source-to-payload)`,
    );
    console.log(
      `  IPC payload/backing ${ipcPayload} / ${ipcBacking} bytes ` +
        `(${multiple(ipcBacking, ipcPayload)} backing-to-payload)`,
    );
    console.log(
      `  bridge sync p95/max ${milliseconds(h["socket.rendererSync"]?.p95Us)} / ` +
        `${milliseconds(h["socket.rendererSync"]?.maxUs)}`,
    );
    console.log(
      `  settle p95/max  ${milliseconds(h["socket.rendererSettle"]?.p95Us)} / ` +
        `${milliseconds(h["socket.rendererSettle"]?.maxUs)}`,
    );
    console.log(
      `  TCP write p95/max ${milliseconds(h["socket.writeCallback"]?.p95Us)} / ` +
        `${milliseconds(h["socket.writeCallback"]?.maxUs)}`,
    );
    if (ipcPayload && ipcBacking > ipcPayload * 4) {
      console.log("  WARNING: IPC backing-buffer amplification detected");
    }
    console.log("");
    console.log("Host");
    const cpuAverage = (newName: string, oldName: string, samples: string) =>
      average(c[newName] === undefined ? oldName : newName, samples);
    console.log(`  main CPU (one core) ${cpuAverage("process.main.cpuPercentOneCoreSum", "process.main.cpuPercentSum", "process.main.cpuSamples").toFixed(1)}%`);
    console.log(`  renderer CPU (Electron) ${cpuAverage("process.tab.cpuPercentElectronSum", "process.tab.cpuPercentSum", "process.tab.cpuSamples").toFixed(1)}%`);
    console.log(`  GPU CPU (Electron) ${cpuAverage("process.gpu.cpuPercentElectronSum", "process.gpu.cpuPercentSum", "process.gpu.cpuSamples").toFixed(1)}%`);
    console.log(`  event-loop p99   ${milliseconds(Number(summary.latest["main.eventLoopP99Us"]) || 0)}`);
    console.log(`  main RSS peak    ${((Number(summary.latest["main.peakRssBytes"]) || 0) / 1048576).toFixed(0)} MB`);
    console.log(`  renderer RSS peak ${((Number(summary.latest["process.tab.peakRssBytes"]) || 0) / 1048576).toFixed(0)} MB`);
    console.log(`  GPU RSS peak     ${((Number(summary.latest["process.gpu.peakRssBytes"]) || 0) / 1048576).toFixed(0)} MB`);
  });
}
