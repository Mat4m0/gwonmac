function summarizeFrames(samples) {
  const sorted = [...samples].sort((left, right) => left - right);
  const at = (percentile) =>
    sorted[Math.max(0, Math.ceil(sorted.length * percentile) - 1)] ?? 0;
  const over = (milliseconds) =>
    samples.filter((sample) => sample > milliseconds).length;
  return {
    count: sorted.length,
    p50Ms: Number(at(0.5).toFixed(3)),
    p95Ms: Number(at(0.95).toFixed(3)),
    p99Ms: Number(at(0.99).toFixed(3)),
    maxMs: Number((sorted.at(-1) ?? 0).toFixed(3)),
    over20Ms: over(20),
    over33Ms: over(100 / 3),
    over50Ms: over(50),
  };
}

async function readMetrics(cdp) {
  const { metrics } = await cdp.send("Performance.getMetrics");
  return Object.fromEntries(metrics.map(({ name, value }) => [name, value]));
}

function summarizeMetrics(before, after) {
  const durationMs = (name) =>
    Number((((after[name] ?? 0) - (before[name] ?? 0)) * 1_000).toFixed(3));
  return {
    taskMs: durationMs("TaskDuration"),
    scriptMs: durationMs("ScriptDuration"),
    layoutMs: durationMs("LayoutDuration"),
    styleMs: durationMs("RecalcStyleDuration"),
    jsHeapUsedMiB: Number(((after.JSHeapUsedSize ?? 0) / (1024 ** 2)).toFixed(3)),
    jsHeapDeltaKiB: Number(
      (((after.JSHeapUsedSize ?? 0) - (before.JSHeapUsedSize ?? 0)) / 1_024)
        .toFixed(3),
    ),
  };
}

async function captureFrames(page, cdp, hookEnabled) {
  await page.evaluate((enabled) => {
    window.gwToolboxRuntime.setHookEnabledForBenchmark(enabled);
  }, hookEnabled);
  if (hookEnabled) {
    const tick = await page.evaluate(() => window.gwToolboxState.tickCount);
    await page.waitForFunction(
      (previous) => window.gwToolboxState?.tickCount > previous,
      tick,
      { timeout: 2_000, polling: 25 },
    );
  } else {
    await page.waitForTimeout(1_000);
  }
  const tickBefore = await page.evaluate(
    () => window.gwToolboxState.tickCount,
  );
  const metricsBefore = await readMetrics(cdp);
  await page.evaluate(() => window.gwNative.diagnostics.startCapture(1));
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
      60_000,
    );
  } finally {
    await page.evaluate(() => window.gwNative.diagnostics.stopCapture());
  }
  const tickAfter = await page.evaluate(
    () => window.gwToolboxState.tickCount,
  );
  const metricsAfter = await readMetrics(cdp);
  return {
    ...summarizeFrames(samples),
    ...summarizeMetrics(metricsBefore, metricsAfter),
    ticks: tickAfter >= tickBefore
      ? tickAfter - tickBefore
      : tickAfter + (2 ** 32 - tickBefore),
  };
}

export async function runPerformanceScenario(page, cdp) {
  try {
    const baseline = await captureFrames(page, cdp, false);
    const hooked = await captureFrames(page, cdp, true);
    const regressionPercent = baseline.p95Ms > 0
      ? ((hooked.p95Ms / baseline.p95Ms) - 1) * 100
      : Number.POSITIVE_INFINITY;
    const p99RegressionPercent = baseline.p99Ms > 0
      ? ((hooked.p99Ms / baseline.p99Ms) - 1) * 100
      : Number.POSITIVE_INFINITY;
    return {
      durationSecondsPerPhase: 60,
      baseline,
      hooked,
      p95RegressionPercent: Number(regressionPercent.toFixed(2)),
      p99RegressionPercent: Number(p99RegressionPercent.toFixed(2)),
    };
  } finally {
    await page.evaluate(() => {
      window.gwToolboxRuntime.setHookEnabledForBenchmark(true);
    });
  }
}
