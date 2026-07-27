import type { CDPSession, Page } from "playwright";
import { AUTOMATION_COMMAND } from "../../src/shared/automation.js";
import type { AutomationCommand } from "../../src/shared/automation.js";
import {
  BENCHMARK_ARMS,
  compareArms,
  runBalancedBenchmark,
} from "./benchmark.js";

/**
 * The session's three handles, named once. `page` and `cdp` are the live
 * Playwright objects toolbox-live.ts connected over CDP, and the command
 * channel only accepts the automation commands the main process knows —
 * a scenario cannot invent one here and discover that at run time.
 */
type SendAutomationCommand = (command: AutomationCommand) => Promise<void>;

// Every phase is warmed for the same time and measured for the same time; the
// schedule that uses them is in benchmark.ts. Two phases per arm at 30 s keep
// the per-arm sample floor the acceptance budget in scenarios.ts asks for.
const WARMUP_MS = 5_000;
const MEASURE_MS = 30_000;

async function readMetrics(cdp: CDPSession): Promise<Record<string, number>> {
  const { metrics } = await cdp.send("Performance.getMetrics");
  return Object.fromEntries(metrics.map(({ name, value }) => [name, value]));
}

/** What moved during one phase. Deltas only, so the arm totals are sums. */
function metricDeltas(
  before: Record<string, number>,
  after: Record<string, number>,
) {
  const durationMs = (name: string) =>
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

const heapUsedMiB = (metrics: Record<string, number>) =>
  Number(((metrics.JSHeapUsedSize ?? 0) / (1024 ** 2)).toFixed(3));

async function setCapture(
  page: Page,
  sendAutomationCommand: SendAutomationCommand,
  enabled: boolean,
) {
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

/**
 * The client's tick counter, read as a number or not read at all. It is the
 * only evidence a phase has that the game kept running while it measured, and
 * the counter is optional in the published state — a Toolbox that failed to
 * install still leaves a state object behind, with a reason and no counter.
 * Differencing a missing counter would report NaN ticks for the phase, which
 * no threshold rejects, so a missing counter stops the run right here.
 */
function readTickCount(page: Page): Promise<number> {
  return page.evaluate(() => {
    const ticks = window.gwToolboxState?.tickCount;
    if (typeof ticks !== "number") {
      throw new Error("Toolbox state published no tick count");
    }
    return ticks;
  });
}

/**
 * The benchmark's one lever on the renderer: the enabled arm restores the
 * kernel's table slot, the disabled arm writes slot 0 and the game calls its
 * original tick. The runtime object is assembled in toolbox.js and declared as
 * an open record, so the lever is narrowed here — and a session whose runtime
 * never published one fails with that sentence rather than quietly measuring
 * the same arm twice.
 */
function setHookEnabled(page: Page, enabled: boolean): Promise<void> {
  return page.evaluate((value) => {
    const setForBenchmark = window.gwToolboxRuntime?.setHookEnabledForBenchmark;
    if (typeof setForBenchmark !== "function") {
      throw new Error("Toolbox runtime published no benchmark hook switch");
    }
    setForBenchmark(value);
  }, enabled);
}

/**
 * Frame intervals in milliseconds over one measured window, sampled in the
 * page so the clock is the compositor's rather than the driver's.
 */
function sampleFrameIntervals(page: Page, windowMs: number): Promise<number[]> {
  return page.evaluate(
    (durationMs) =>
      new Promise<number[]>((resolve) => {
        const values: number[] = [];
        const started = performance.now();
        let previous = 0;
        const frame: FrameRequestCallback = (now) => {
          if (previous) values.push(now - previous);
          previous = now;
          if (now - started >= durationMs) resolve(values);
          else window.requestAnimationFrame(frame);
        };
        window.requestAnimationFrame(frame);
      }),
    windowMs,
  );
}

/** One measured window: the same work whichever arm the session is in. */
async function measurePhase(
  page: Page,
  cdp: CDPSession,
  sendAutomationCommand: SendAutomationCommand,
) {
  const tickBefore = await readTickCount(page);
  const metricsBefore = await readMetrics(cdp);
  await setCapture(page, sendAutomationCommand, true);
  let samples;
  try {
    samples = await sampleFrameIntervals(page, MEASURE_MS);
  } finally {
    await setCapture(page, sendAutomationCommand, false);
  }
  const metricsAfter = await readMetrics(cdp);
  const tickAfter = await readTickCount(page);
  return {
    samples,
    ticks: tickAfter >= tickBefore
      ? tickAfter - tickBefore
      : tickAfter + (2 ** 32 - tickBefore),
    metrics: metricDeltas(metricsBefore, metricsAfter),
    heapUsedMiB: heapUsedMiB(metricsAfter),
  };
}

export async function runPerformanceScenario(
  page: Page,
  cdp: CDPSession,
  sendAutomationCommand: SendAutomationCommand,
) {
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
          await setHookEnabled(page, arm === BENCHMARK_ARMS.observerOn);
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
    await setHookEnabled(page, true);
  }
}
