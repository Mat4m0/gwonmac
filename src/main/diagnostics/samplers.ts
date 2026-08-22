/**
 * What this process observes about the machine it runs on: the main process's
 * own CPU and memory, Chromium's per-process metrics, event-loop delay, the
 * power and thermal state, and the fixed environment description an export
 * carries.
 *
 * None of it is a capture: sampling runs for the whole session at one interval
 * so a report covers the launch that produced it, and the detailed sample is a
 * multiple of that interval rather than a second timer.
 */
import { arch, cpus, platform, release, totalmem } from "node:os";
import { monitorEventLoopDelay, performance } from "node:perf_hooks";
import { app, powerMonitor, screen } from "electron";
import { runtimeVersions } from "./flight-recorder.js";
import { logEvent, recorder } from "./recorder.js";
import { asAppVersion } from "./schema-fields.js";
import { windowRegistry } from "../window-registry.js";

const SAMPLE_INTERVAL_MS = 1_000;
const PROCESS_SAMPLE_INTERVAL = 5;

let environment: Record<string, unknown> = {};
let sampler: ReturnType<typeof setInterval> | null = null;
let sampleNumber = 0;
let previousMainCpu = process.cpuUsage();
let previousMainCpuTimestampUs = 0;
const eventLoop = monitorEventLoopDelay({ resolution: 5 });
let previousEventLoopUtilization = performance.eventLoopUtilization();
let eventLoopWindowStartedUs = 0;

export function sampleProcesses(): void {
  sampleNumber += 1;
  const detailedSample =
    sampleNumber % PROCESS_SAMPLE_INTERVAL === 0;
  const timestampUs = recorder.timestampUs();
  const currentCpu = process.cpuUsage();
  const cpu = {
    user: currentCpu.user - previousMainCpu.user,
    system: currentCpu.system - previousMainCpu.system,
  };
  previousMainCpu = currentCpu;
  const elapsedUs = timestampUs - previousMainCpuTimestampUs;
  previousMainCpuTimestampUs = timestampUs;
  const mainCpuPercent = elapsedUs
    ? ((cpu.user + cpu.system) / elapsedUs) * 100
    : 0;
  const own = process.memoryUsage();
  recorder.count("process.main.cpuPercentOneCoreSum", mainCpuPercent);
  recorder.count("process.main.cpuSamples");
  recorder.setLatest("process.main.cpuPercentOneCore", mainCpuPercent);
  recorder.setLatest("main.rssBytes", own.rss);
  recorder.setPeak("main.peakRssBytes", own.rss);
  recorder.setLatest("main.heapUsedBytes", own.heapUsed);
  recorder.setLatest("main.externalBytes", own.external);
  recorder.setLatest("main.arrayBuffersBytes", own.arrayBuffers);
  recorder.setPeak("main.peakExternalBytes", own.external);
  recorder.setPeak("main.peakArrayBuffersBytes", own.arrayBuffers);
  if (detailedSample) {
    logEvent({ k: "process.main",
      cpuPercentOneCore: mainCpuPercent,
      rssBytes: own.rss,
      heapUsedBytes: own.heapUsed,
      heapTotalBytes: own.heapTotal,
      externalBytes: own.external,
      arrayBuffersBytes: own.arrayBuffers,
    });
  }

  if (!detailedSample) return;
  const aggregates = new Map<
    string,
    { cpuPercent: number; rssBytes: number; ownerId?: number }
  >();
  for (const metric of app.getAppMetrics()) {
    const prefix = `process.${metric.type.toLowerCase()}`;
    const ownerId = metric.type === "Tab"
      ? windowRegistry.diagnosticOwnerForProcessId(metric.pid) ?? undefined
      : undefined;
    // An unregistered renderer must not become global evidence in every
    // account's report.
    if (metric.type === "Tab" && ownerId === undefined) continue;
    recorder.setLatest(
      `${prefix}.cpuPercentElectron`,
      metric.cpu.percentCPUUsage,
      ownerId,
    );
    recorder.setLatest(
      `${prefix}.rssBytes`,
      metric.memory.workingSetSize * 1_024,
      ownerId,
    );
    logEvent({ k: "process.chromium",
      pid: metric.pid,
      cpuPercentElectron: metric.cpu.percentCPUUsage,
      idleWakeupsPerSecond: metric.cpu.idleWakeupsPerSecond,
      rssBytes: metric.memory.workingSetSize * 1_024,
      privateBytes: (metric.memory.privateBytes ?? 0) * 1_024,
      sandboxed: metric.sandboxed ?? false,
    }, ownerId);
    const aggregateKey = `${prefix}:${ownerId ?? "global"}`;
    const aggregate = aggregates.get(aggregateKey) ?? {
      cpuPercent: 0,
      rssBytes: 0,
      ...(ownerId === undefined ? {} : { ownerId }),
    };
    aggregate.cpuPercent += metric.cpu.percentCPUUsage;
    aggregate.rssBytes += metric.memory.workingSetSize * 1_024;
    aggregates.set(aggregateKey, aggregate);
  }
  for (const [key, aggregate] of aggregates) {
    const prefix = key.slice(0, key.lastIndexOf(":"));
    recorder.count(
      `${prefix}.cpuPercentElectronSum`,
      aggregate.cpuPercent,
      aggregate.ownerId,
    );
    recorder.count(`${prefix}.cpuSamples`, 1, aggregate.ownerId);
    recorder.setLatest(
      `${prefix}.cpuPercentElectron`,
      aggregate.cpuPercent,
      aggregate.ownerId,
    );
    recorder.setLatest(`${prefix}.rssBytes`, aggregate.rssBytes, aggregate.ownerId);
    recorder.setPeak(`${prefix}.peakRssBytes`, aggregate.rssBytes, aggregate.ownerId);
  }
}

function sampleEventLoop(): void {
  const sampledAtUs = recorder.timestampUs();
  if (
    sampledAtUs - eventLoopWindowStartedUs <
    PROCESS_SAMPLE_INTERVAL * SAMPLE_INTERVAL_MS * 1_000
  ) {
    return;
  }
  const meanUs = Number.isFinite(eventLoop.mean) ? eventLoop.mean / 1_000 : 0;
  const p95Us = eventLoop.percentile(95) / 1_000;
  const p99Us = eventLoop.percentile(99) / 1_000;
  const maxUs = eventLoop.max / 1_000;
  recorder.setLatest("main.eventLoopMeanUs", Math.round(meanUs));
  recorder.setLatest("main.eventLoopP95Us", Math.round(p95Us));
  recorder.setLatest("main.eventLoopP99Us", Math.round(p99Us));
  recorder.setLatest("main.eventLoopMaxUs", Math.round(maxUs));
  recorder.observe("main.eventLoopMean", meanUs);
  recorder.observe("main.eventLoopP95", p95Us);
  recorder.observe("main.eventLoopP99", p99Us);
  recorder.observe("main.eventLoopMax", maxUs);
  const currentUtilization = performance.eventLoopUtilization();
  const utilization = performance.eventLoopUtilization(
    currentUtilization,
    previousEventLoopUtilization,
  );
  previousEventLoopUtilization = currentUtilization;
  recorder.setLatest("main.eventLoopUtilization", utilization.utilization);
  logEvent({ k: "eventLoop.sample",
    windowMs: Math.round((sampledAtUs - eventLoopWindowStartedUs) / 1_000),
    resolutionMs: 5,
    meanUs: Math.round(meanUs),
    p95Us: Math.round(p95Us),
    p99Us: Math.round(p99Us),
    maxUs: Math.round(maxUs),
    utilization: utilization.utilization,
  });
  eventLoop.reset();
  eventLoopWindowStartedUs = sampledAtUs;
}

/**
 * Delay and utilization are both differences against the last window, so a
 * capture that begins mid-window would otherwise attribute the idle time
 * before it to itself.
 */
export function resetEventLoopWindow(): void {
  eventLoop.reset();
  previousEventLoopUtilization = performance.eventLoopUtilization();
  eventLoopWindowStartedUs = recorder.timestampUs();
}

/** The fixed description of this machine, as an export carries it. */
export function environmentSnapshot(): Record<string, unknown> {
  return environment;
}

/**
 * Sampled at export, not at ready: the GPU process does not exist when the
 * recorder starts, so Chromium answers with pre-initialization defaults that
 * read as software rendering. If the process has since died, "disabled" is
 * then the truth, and that is exactly what the reader needs.
 */
export async function gpuEnvironment(): Promise<Record<string, unknown>> {
  return {
    featureStatus: app.getGPUFeatureStatus(),
    info: await app.getGPUInfo("basic").catch(() => null),
  };
}

export function startSampling(): void {
  eventLoop.enable();
  resetEventLoopWindow();
  previousMainCpu = process.cpuUsage();
  previousMainCpuTimestampUs = recorder.timestampUs();
  recorder.setLatest("milestone.electronReadyUs", recorder.timestampUs());
  const display = screen.getPrimaryDisplay();
  environment = {
    platform: platform(),
    osRelease: release(),
    architecture: arch(),
    cpuModel: cpus()[0]?.model ?? "unknown",
    logicalCpuCount: cpus().length,
    totalMemoryBytes: totalmem(),
    primaryDisplay: {
      width: display.size.width,
      height: display.size.height,
      scaleFactor: display.scaleFactor,
      refreshRateHz: display.displayFrequency,
      internal: display.internal,
    },
    appVersion: app.getVersion(),
    versions: runtimeVersions(),
    startedAt: recorder.startedWall,
  };
  logEvent({ k: "diagnostics.started", appVersion: asAppVersion(app.getVersion()) });
  recorder.setLatest("system.thermalState", powerMonitor.getCurrentThermalState());
  recorder.setLatest("system.onBattery", powerMonitor.isOnBatteryPower());
  powerMonitor.on("on-battery", () => {
    recorder.setLatest("system.onBattery", true);
    logEvent({ k: "power.onBattery" });
  });
  powerMonitor.on("on-ac", () => {
    recorder.setLatest("system.onBattery", false);
    logEvent({ k: "power.onAc" });
  });
  powerMonitor.on("suspend", () => logEvent({ k: "power.suspend" }));
  powerMonitor.on("resume", () => logEvent({ k: "power.resume" }));
  powerMonitor.on("thermal-state-change", ({ state }) => {
    recorder.setLatest("system.thermalState", state);
    logEvent({
      k:
        state === "serious" || state === "critical"
          ? "thermal.pressure"
          : "thermal.changed",
      state,
    });
  });
  powerMonitor.on("speed-limit-change", ({ limit }) => {
    recorder.setLatest("system.cpuSpeedLimitPercent", limit);
    logEvent({
      k: limit < 100 ? "cpuSpeedLimit.reduced" : "cpuSpeedLimit.restored",
      limit,
    });
  });
  sampler = setInterval(() => {
    sampleProcesses();
    sampleEventLoop();
  }, SAMPLE_INTERVAL_MS);
}

export function stopSampling(): void {
  if (sampler) clearInterval(sampler);
  sampler = null;
  eventLoop.disable();
}
