import { AUTOMATION_COMMAND } from "../../build/shared/automation.js";
import {
  BENCHMARK_ARMS,
  compareArms,
  runBalancedBenchmark,
} from "./benchmark.mjs";

// Every phase is warmed for the same time and measured for the same time; the
// schedule that uses them is in benchmark.mjs. Two phases per arm at 30 s keep
// the per-arm sample floor the acceptance budget in scenarios.mjs asks for.
const WARMUP_MS = 5_000;
const MEASURE_MS = 30_000;

async function readMetrics(cdp) {
  const { metrics } = await cdp.send("Performance.getMetrics");
  return Object.fromEntries(metrics.map(({ name, value }) => [name, value]));
}

/** What moved during one phase. Deltas only, so the arm totals are sums. */
function metricDeltas(before, after) {
  const durationMs = (name) =>
    Number((((after[name] ?? 0) - (before[name] ?? 0)) * 1_000).toFixed(3));
  return {
    taskMs: durationMs("TaskDuration"),
    scriptMs: durationMs("ScriptDuration"),
    layoutMs: durationMs("LayoutDuration"),
    styleMs: durationMs("RecalcStyleDuration"),
    jsHeapDeltaKiB: Number(
      (((after.JSHeapUsedSize ?? 0) - (before.JSHeapUsedSize ?? 0)) / 1_024)
        .toFixed(3),
    ),
  };
}

const heapUsedMiB = (metrics) =>
  Number(((metrics.JSHeapUsedSize ?? 0) / (1024 ** 2)).toFixed(3));

async function setCapture(page, sendAutomationCommand, enabled) {
  await sendAutomationCommand(
    enabled
      ? AUTOMATION_COMMAND.startLevel1Capture
      : AUTOMATION_COMMAND.stopCapture,
  );
  await page.waitForFunction(
    async (expected) =>
      (await window.gwNative.diagnostics.current()).captureLevel === expected,
    enabled ? 1 : 0,
    { timeout: 5_000, polling: 50 },
  );
}

/** One measured window: the same work whichever arm the session is in. */
async function measurePhase(page, cdp, sendAutomationCommand) {
  const tickBefore = await page.evaluate(() => window.gwToolboxState.tickCount);
  const metricsBefore = await readMetrics(cdp);
  await setCapture(page, sendAutomationCommand, true);
  let samples;
  try {
    samples = await page.evaluate(
      (durationMs) => new Promise((resolve) => {
        const values = [];
        const started = performance.now();
        let previous = 0;
        const frame = (now) => {
          if (previous) values.push(now - previous);
          previous = now;
          if (now - started >= durationMs) resolve(values);
          else window.requestAnimationFrame(frame);
        };
        window.requestAnimationFrame(frame);
      }),
      MEASURE_MS,
    );
  } finally {
    await setCapture(page, sendAutomationCommand, false);
  }
  const metricsAfter = await readMetrics(cdp);
  const tickAfter = await page.evaluate(() => window.gwToolboxState.tickCount);
  return {
    samples,
    ticks: tickAfter >= tickBefore
      ? tickAfter - tickBefore
      : tickAfter + (2 ** 32 - tickBefore),
    metrics: metricDeltas(metricsBefore, metricsAfter),
    heapUsedMiB: heapUsedMiB(metricsAfter),
  };
}

export async function runPerformanceScenario(page, cdp, sendAutomationCommand) {
  try {
    const benchmark = await runBalancedBenchmark(
      [BENCHMARK_ARMS.dispatcherOff, BENCHMARK_ARMS.observerOn],
      {
        select: async (arm, phase, phases) => {
          console.log(JSON.stringify({
            checkpoint: "benchmark-phase",
            phase,
            of: phases,
            arm,
          }));
          await page.evaluate((enabled) => {
            window.gwToolboxRuntime.setHookEnabledForBenchmark(enabled);
          }, arm === BENCHMARK_ARMS.observerOn);
        },
        warmUp: () => page.waitForTimeout(WARMUP_MS),
        measure: () => measurePhase(page, cdp, sendAutomationCommand),
      },
    );
    return {
      warmupSecondsPerPhase: WARMUP_MS / 1_000,
      measuredSecondsPerPhase: MEASURE_MS / 1_000,
      ...benchmark,
      comparison: compareArms(
        benchmark.arms,
        BENCHMARK_ARMS.dispatcherOff,
        BENCHMARK_ARMS.observerOn,
      ),
    };
  } finally {
    await page.evaluate(() => {
      window.gwToolboxRuntime.setHookEnabledForBenchmark(true);
    });
  }
}
