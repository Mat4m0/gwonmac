// P7.10 — the benchmark's schedule and its arithmetic, with no page, no CDP
// session and no build behind them, so a test can execute the order it claims
// to measure in.
//
// The shape this replaces measured the disabled arm first and the enabled arm
// second, every time, in all five recorded candidates. Anything that drifts
// over a run — a warming machine, a wandering party, a compositor that settles
// — therefore landed on the enabled arm and was reported as Toolbox overhead.
// Each arm is now measured twice, in a mirrored order, so a monotone drift
// falls equally on both arms, and the order that actually ran is part of the
// result rather than a convention the reader has to already know.

/**
 * The two arms one session can measure. **Both run the transformed module**:
 * the module is chosen in the main process at generation activation, long
 * before the renderer boots, so the official module is not reachable from the
 * session that measures these (P7.11 — see plans/refactor.md). The names say
 * which is which, so a delta between them cannot be read as the Toolbox's
 * total cost against an untransformed client.
 */
export const BENCHMARK_ARMS = Object.freeze({
  /** Hook slot 0: the game calls its original tick, the kernel never runs. */
  dispatcherOff: "transformed-dispatcher-off",
  /** Hook slot live: the kernel writes snapshots and the renderer reads them. */
  observerOn: "transformed-observer-on",
});

/**
 * The tail one phase or one arm reports.
 * @typedef {{
 *   count: number,
 *   p50Ms: number,
 *   p95Ms: number,
 *   p99Ms: number,
 *   maxMs: number,
 *   over20Ms: number,
 *   over33Ms: number,
 *   over50Ms: number,
 * }} FrameSummary
 */

/**
 * What one arm accumulates while the run proceeds. `frames` holds one summary
 * per phase rather than one merged summary, because the arm's percentiles are
 * meaned over its phases — see `mergeFrames`.
 * @typedef {{
 *   ticks: number,
 *   metrics: Record<string, number>,
 *   phases: number[],
 *   frames: FrameSummary[],
 * }} ArmTotals
 */

/**
 * One arm as the result publishes it.
 * @typedef {{
 *   frames: FrameSummary,
 *   ticks: number,
 *   metrics: Record<string, number>,
 *   phases: number[],
 * }} ArmResult
 */

/**
 * The parameter is `unknown` rather than `number` on purpose: these figures
 * arrive from a renderer over CDP, so a missing metric really can turn up here
 * as `undefined` and rounding it silently would publish `NaN` as a result.
 * @param {unknown} value
 * @param {number} digits
 * @returns {number}
 */
const roundTo = (value, digits) => {
  if (typeof value !== "number") {
    throw new TypeError(`benchmark value ${String(value)} is not a number`);
  }
  return Number.isFinite(value) ? Number(value.toFixed(digits)) : value;
};

/**
 * Frame intervals in milliseconds → the tail summary one phase reports.
 * @param {readonly number[]} samples
 * @returns {FrameSummary}
 */
export function summarizeFrames(samples) {
  const sorted = [...samples].sort((left, right) => left - right);
  /** @param {number} percentile */
  const at = (percentile) =>
    sorted[Math.max(0, Math.ceil(sorted.length * percentile) - 1)] ?? 0;
  /** @param {number} milliseconds */
  const over = (milliseconds) =>
    samples.filter((sample) => sample > milliseconds).length;
  return {
    count: sorted.length,
    p50Ms: roundTo(at(0.5), 3),
    p95Ms: roundTo(at(0.95), 3),
    p99Ms: roundTo(at(0.99), 3),
    maxMs: roundTo(sorted.at(-1) ?? 0, 3),
    over20Ms: over(20),
    over33Ms: over(100 / 3),
    over50Ms: over(50),
  };
}

/**
 * One arm's phases → the arm. The percentiles are **averaged across the arm's
 * equal-length phases**, not recomputed over their pooled samples: averaging is
 * what makes the mirrored order cancel a drift. Pooling would not — a pooled
 * percentile lands inside whichever phase's mode contains it, so two phases at
 * different levels give the arm whichever level that percentile happens to
 * fall in, and the mirror stops cancelling anything.
 * @param {readonly FrameSummary[]} summaries
 * @returns {FrameSummary}
 */
export function mergeFrames(summaries) {
  if (summaries.length === 0) throw new Error("an arm measured no phase");
  /** @param {(summary: FrameSummary) => number} pick */
  const mean = (pick) =>
    roundTo(
      summaries.reduce((total, summary) => total + pick(summary), 0)
        / summaries.length,
      3,
    );
  /** @param {(summary: FrameSummary) => number} pick */
  const sum = (pick) => summaries.reduce((total, s) => total + pick(s), 0);
  return {
    count: sum((summary) => summary.count),
    p50Ms: mean((summary) => summary.p50Ms),
    p95Ms: mean((summary) => summary.p95Ms),
    p99Ms: mean((summary) => summary.p99Ms),
    maxMs: roundTo(Math.max(...summaries.map((summary) => summary.maxMs)), 3),
    over20Ms: sum((summary) => summary.over20Ms),
    over33Ms: sum((summary) => summary.over33Ms),
    over50Ms: sum((summary) => summary.over50Ms),
  };
}

/**
 * The arms in the order they are measured: every arm once, then every arm
 * again in reverse. Each arm's two phases are symmetric about the midpoint of
 * the run, so a drift that is monotone over the run contributes the same mean
 * offset to every arm.
 * @param {readonly string[]} arms
 * @returns {string[]}
 */
export function balancedOrder(arms) {
  if (arms.length < 2) {
    throw new Error("a benchmark comparison needs at least two arms");
  }
  if (new Set(arms).size !== arms.length) {
    throw new Error("benchmark arms must be distinct");
  }
  return [...arms, ...[...arms].reverse()];
}

/**
 * Whether a recorded order is one this benchmark could have produced: mirrored,
 * with every arm measured the same number of times. The acceptance gate asks
 * this of the result it validates, so a run that measured A then B once — the
 * order-biased shape — cannot be accepted by claiming it in a field.
 *
 * The parameter is `unknown` because the gate asks this of a field read back
 * out of a result record, which may hold anything at all.
 * @param {unknown} order
 * @returns {boolean}
 */
export function isBalancedOrder(order) {
  if (!Array.isArray(order) || order.length < 4 || order.length % 2 !== 0) {
    return false;
  }
  /** @type {readonly unknown[]} */
  const measured = order;
  return measured.every(
    (arm, index) => arm === measured[measured.length - 1 - index],
  );
}

/**
 * Per-phase metric deltas → the arm's totals. Deltas add; nothing else is here.
 * @param {Record<string, number>} total
 * @param {Record<string, number>} metrics
 * @returns {Record<string, number>}
 */
function addMetrics(total, metrics) {
  /** @type {Record<string, number>} */
  const sum = { ...total };
  for (const [key, value] of Object.entries(metrics)) {
    sum[key] = roundTo((sum[key] ?? 0) + value, 3);
  }
  return sum;
}

/**
 * Runs one mirrored pass over `arms` and returns what was measured, including
 * the order it was measured in.
 *
 * The three effects are the session's, not this module's. `warmUp` **takes no
 * argument**, which is the point: an unequal warm-up is not expressible here,
 * and the shape this replaces warmed the enabled arm by waiting for a tick and
 * the disabled arm by a flat timeout.
 *
 * Everything an arm carries mirrors: the percentiles are meaned over its
 * phases and the metric deltas are summed over them. `heapUsedMiB` is an
 * **absolute** reading, so it cannot be either — summing two heap sizes is
 * meaningless and taking one phase's reading hands each arm whichever position
 * in the run its last phase happened to sit at, which is exactly the bias the
 * mirror removes. It therefore stays on the phase that measured it, where the
 * phase number says when it was read. The heap figure an arm can honestly
 * publish is the delta, and `metrics.jsHeapDeltaKiB` already sums into one.
 *
 * @param {readonly string[]} arms
 * @param {{
 *   select: (arm: string, phase: number, phases: number) => Promise<void>,
 *   warmUp: () => Promise<unknown>,
 *   measure: () => Promise<{
 *     samples: number[], ticks: number,
 *     metrics: Record<string, number>, heapUsedMiB: number,
 *   }>,
 * }} effects
 */
export async function runBalancedBenchmark(arms, { select, warmUp, measure }) {
  const order = balancedOrder(arms);
  const phases = [];
  /**
   * One accumulator per arm, holding everything that arm carries out of the
   * run. Keeping the per-phase summaries here rather than in a second map is
   * what makes each phase a single lookup, so the "the order only ever names
   * an arm we set up" invariant is stated once, below, instead of twice.
   * @type {Map<string, ArmTotals>}
   */
  const totals = new Map(
    arms.map((arm) => [arm, { ticks: 0, metrics: {}, phases: [], frames: [] }]),
  );
  for (const [index, arm] of order.entries()) {
    await select(arm, index + 1, order.length);
    await warmUp();
    const phase = await measure();
    if (!Array.isArray(phase.samples) || phase.samples.length === 0) {
      throw new Error(`phase ${index + 1} (${arm}) recorded no frame samples`);
    }
    const frames = summarizeFrames(phase.samples);
    const total = totals.get(arm);
    // `order` is `balancedOrder(arms)`, so every arm it names was set up above.
    if (!total) {
      throw new Error(`phase ${index + 1} measured an unknown arm ${arm}`);
    }
    total.ticks += phase.ticks;
    total.metrics = addMetrics(total.metrics, phase.metrics);
    total.phases.push(index + 1);
    total.frames.push(frames);
    phases.push({
      phase: index + 1,
      arm,
      frames,
      ticks: phase.ticks,
      metrics: phase.metrics,
      heapUsedMiB: phase.heapUsedMiB,
    });
  }
  /** @type {Record<string, ArmResult>} */
  const measured = {};
  for (const [arm, total] of totals) {
    measured[arm] = {
      frames: mergeFrames(total.frames),
      ticks: total.ticks,
      metrics: total.metrics,
      phases: total.phases,
    };
  }
  return { order, phases, arms: measured };
}

/**
 * The movement from one arm to another, in both tails.
 * @param {Record<string, { frames: FrameSummary }>} arms
 * @param {string} from
 * @param {string} to
 */
export function compareArms(arms, from, to) {
  const before = arms[from]?.frames;
  const after = arms[to]?.frames;
  if (!before || !after) {
    throw new Error(`benchmark measured no arm ${from} → ${to}`);
  }
  /** @param {number} start @param {number} end */
  const percent = (start, end) =>
    start > 0 ? roundTo(((end / start) - 1) * 100, 2) : Number.POSITIVE_INFINITY;
  return {
    from,
    to,
    p95RegressionPercent: percent(before.p95Ms, after.p95Ms),
    p99RegressionPercent: percent(before.p99Ms, after.p99Ms),
    p95DeltaMs: roundTo(after.p95Ms - before.p95Ms, 3),
    p99DeltaMs: roundTo(after.p99Ms - before.p99Ms, 3),
  };
}
