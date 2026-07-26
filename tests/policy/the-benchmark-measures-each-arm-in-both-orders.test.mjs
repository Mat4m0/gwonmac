// P7.10 — the live benchmark's order bias, executed rather than described.
//
// The old schedule measured the disabled arm first and the enabled arm second,
// every time. This drives the real scheduler from
// `scripts/toolbox-live/benchmark.mjs` against a session double whose two arms
// cost exactly the same and whose frame time drifts upward over the run, and
// shows the two things that matter: the old shape reports that drift as Toolbox
// overhead, and the mirrored one does not. It also drives the acceptance gate
// in `scripts/toolbox-live/scenarios.mjs` over the record the scheduler
// produces, so the gate and the benchmark cannot drift apart in shape.
//
// Nothing here needs a build, a game, or a page.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  balancedOrder,
  BENCHMARK_ARMS,
  compareArms,
  isBalancedOrder,
  mergeFrames,
  runBalancedBenchmark,
  summarizeFrames,
} from "../../scripts/toolbox-live/benchmark.mjs";
import { SCENARIOS } from "../../scripts/toolbox-live/scenarios.mjs";

const OFF = BENCHMARK_ARMS.dispatcherOff;
const ON = BENCHMARK_ARMS.observerOn;

/**
 * A session whose frame time rises by `driftMsPerPhase` with every phase that
 * has already run, and whose arms are otherwise identical: `armCostMs` is the
 * real cost of the arm, and it is zero unless a test asks for one.
 *
 * Every call is recorded, so the sequence the scheduler ran can be asserted
 * rather than assumed.
 */
function driftingSession({ driftMsPerPhase = 0, armCostMs = {} } = {}) {
  const calls = [];
  let phase = 0;
  let current = null;
  /** The frame samples one phase of `arm` produces when it runs at `at`. */
  const samplesFor = (arm, at) =>
    Array.from(
      { length: 200 },
      () => 16 + (driftMsPerPhase * at) + (armCostMs[arm] ?? 0),
    );
  return {
    calls,
    samplesFor,
    effects: {
      select: async (arm, index, of) => {
        calls.push({ call: "select", arm, index, of });
        current = arm;
      },
      // Records its arguments: an arm-dependent warm-up is the asymmetry the
      // old shape had, and the scheduler must not be able to reintroduce one.
      warmUp: async (...args) => {
        calls.push({ call: "warmUp", args });
      },
      measure: async (...args) => {
        calls.push({ call: "measure", args, arm: current });
        const samples = samplesFor(current, phase);
        phase += 1;
        return {
          samples,
          ticks: current === ON ? 2_000 : 0,
          metrics: { taskMs: 100, scriptMs: 10 },
          heapUsedMiB: 42,
        };
      },
    },
  };
}

describe("the benchmark measures each arm in both orders", () => {
  it("mirrors the arms so every arm sits at the same mean position", () => {
    assert.deepEqual(balancedOrder([OFF, ON]), [OFF, ON, ON, OFF]);
    assert.deepEqual(balancedOrder(["a", "b", "c"]), [
      "a", "b", "c", "c", "b", "a",
    ]);
    const positions = (order, arm) =>
      order.flatMap((entry, index) => (entry === arm ? [index] : []));
    const order = balancedOrder([OFF, ON]);
    const mean = (values) =>
      values.reduce((total, value) => total + value, 0) / values.length;
    assert.equal(mean(positions(order, OFF)), mean(positions(order, ON)));

    assert.throws(() => balancedOrder([OFF]), /at least two arms/u);
    assert.throws(() => balancedOrder([OFF, OFF]), /distinct/u);
  });

  it("recognises a biased order for what it is", () => {
    assert.equal(isBalancedOrder([OFF, ON, ON, OFF]), true);
    assert.equal(isBalancedOrder(["a", "b", "c", "c", "b", "a"]), true);
    // The shape this task exists to remove.
    assert.equal(isBalancedOrder([OFF, ON]), false);
    // Every arm twice, but both of one arm's phases in the same half.
    assert.equal(isBalancedOrder([OFF, OFF, ON, ON]), false);
    assert.equal(isBalancedOrder([OFF, ON, ON]), false);
    assert.equal(isBalancedOrder("off,on,on,off"), false);
    assert.equal(isBalancedOrder(undefined), false);
  });

  it("warms every phase the same way and records the order it ran", async () => {
    const session = driftingSession();
    const result = await runBalancedBenchmark([OFF, ON], session.effects);

    assert.deepEqual(result.order, [OFF, ON, ON, OFF]);
    assert.equal(isBalancedOrder(result.order), true);
    assert.deepEqual(
      session.calls.map((entry) => entry.call),
      [
        "select", "warmUp", "measure",
        "select", "warmUp", "measure",
        "select", "warmUp", "measure",
        "select", "warmUp", "measure",
      ],
    );
    // The warm-up is handed nothing, so it cannot differ between arms.
    for (const entry of session.calls.filter((call) => call.call === "warmUp")) {
      assert.deepEqual(entry.args, []);
    }
    for (const entry of session.calls.filter((call) => call.call === "measure")) {
      assert.deepEqual(entry.args, []);
    }
    // Each arm is measured in each half, and says which phases were its own.
    assert.deepEqual(result.arms[OFF].phases, [1, 4]);
    assert.deepEqual(result.arms[ON].phases, [2, 3]);
    assert.deepEqual(
      result.phases.map((phase) => [phase.phase, phase.arm]),
      [[1, OFF], [2, ON], [3, ON], [4, OFF]],
    );
    // Per-phase deltas add up into the arm.
    assert.deepEqual(result.arms[OFF].metrics, { taskMs: 200, scriptMs: 20 });
    assert.equal(result.arms[OFF].ticks, 0);
    assert.equal(result.arms[ON].ticks, 4_000);
    assert.equal(result.arms[OFF].frames.count, 400);
  });

  it("reports no regression for a drift the old order would have blamed on the Toolbox", async () => {
    // 1 ms per phase of pure drift, and two arms that cost exactly the same.
    const session = driftingSession({ driftMsPerPhase: 1 });
    const result = await runBalancedBenchmark([OFF, ON], session.effects);
    const balanced = compareArms(result.arms, OFF, ON);

    // The old schedule: one phase of each, disabled first. Same arithmetic,
    // same session, no Toolbox cost anywhere in it.
    const biased = compareArms(
      {
        [OFF]: { frames: mergeFrames([summarizeFrames(session.samplesFor(OFF, 0))]) },
        [ON]: { frames: mergeFrames([summarizeFrames(session.samplesFor(ON, 1))]) },
      },
      OFF,
      ON,
    );
    assert.ok(
      biased.p95RegressionPercent > 6,
      `the biased order should report the drift, reported ${biased.p95RegressionPercent}%`,
    );
    assert.equal(biased.p95DeltaMs, 1);

    assert.equal(balanced.p95RegressionPercent, 0);
    assert.equal(balanced.p99RegressionPercent, 0);
    assert.equal(balanced.p95DeltaMs, 0);
    // Both arms drift to the same place: 16, 17, 18, 19 ms over four phases.
    assert.equal(result.arms[OFF].frames.p95Ms, 17.5);
    assert.equal(result.arms[ON].frames.p95Ms, 17.5);
  });

  it("still reports a real cost the arm actually has", async () => {
    const session = driftingSession({
      driftMsPerPhase: 1,
      armCostMs: { [ON]: 2 },
    });
    const result = await runBalancedBenchmark([OFF, ON], session.effects);
    const comparison = compareArms(result.arms, OFF, ON);
    // The drift cancels, the 2 ms does not.
    assert.equal(comparison.p95DeltaMs, 2);
    assert.ok(comparison.p95RegressionPercent > 11);
  });

  it("refuses a phase that measured nothing", async () => {
    const session = driftingSession();
    await assert.rejects(
      runBalancedBenchmark([OFF, ON], {
        ...session.effects,
        measure: async () => ({
          samples: [],
          ticks: 0,
          metrics: {},
          heapUsedMiB: 0,
        }),
      }),
      /recorded no frame samples/u,
    );
  });

  it("averages an arm's phases instead of pooling their samples", () => {
    // Pooling is the intuitive aggregation and it is the wrong one here: the
    // pooled p95 of two phases at different levels lands in the upper phase,
    // so it carries the drift the mirror was supposed to cancel.
    const low = summarizeFrames(Array.from({ length: 200 }, () => 16));
    const high = summarizeFrames(Array.from({ length: 200 }, () => 20));
    assert.equal(mergeFrames([low, high]).p95Ms, 18);
    assert.equal(mergeFrames([low, high]).count, 400);
    assert.equal(mergeFrames([low, high]).maxMs, 20);
    assert.equal(
      summarizeFrames([
        ...Array.from({ length: 200 }, () => 16),
        ...Array.from({ length: 200 }, () => 20),
      ]).p95Ms,
      20,
    );
    assert.throws(() => mergeFrames([]), /measured no phase/u);
  });
});

describe("the performance acceptance gate reads the record the benchmark writes", () => {
  const validate = SCENARIOS.performance.validate;

  /** A run that passes, built the way the benchmark builds one. */
  async function passingEvidence(overrides = {}) {
    const session = driftingSession();
    const result = await runBalancedBenchmark([OFF, ON], session.effects);
    // 200 samples per phase in the double; the budget wants 2 500 per arm.
    for (const arm of [OFF, ON]) result.arms[arm].frames.count = 3_600;
    result.arms[ON].ticks = 2_600;
    return {
      evidence: {
        ...result,
        comparison: compareArms(result.arms, OFF, ON),
        ...overrides,
      },
    };
  }

  it("accepts the record a mirrored run produces", async () => {
    validate(await passingEvidence());
  });

  it("refuses a run that measured each arm once", async () => {
    const passing = await passingEvidence();
    assert.throws(
      () => validate({ evidence: { ...passing.evidence, order: [OFF, ON] } }),
      /biased order/u,
    );
  });

  it("refuses a record whose arms it cannot find", async () => {
    // The shape before this task: baseline/hooked, not named arms. A gate that
    // still read those would pass anything.
    assert.throws(
      () => validate({
        evidence: {
          baseline: { count: 3_600, ticks: 0, p95Ms: 16 },
          hooked: { count: 3_600, ticks: 2_600, p95Ms: 16 },
          p95RegressionPercent: 0,
          p99RegressionPercent: 0,
        },
      }),
      /no comparable arms/u,
    );
    assert.throws(() => validate({}), /no comparable arms/u);
  });

  it("keeps every budget the two-phase gate held", async () => {
    const budgetBreaches = [
      (evidence) => { evidence.arms[OFF].frames.count = 2_499; },
      (evidence) => { evidence.arms[ON].frames.count = 2_499; },
      // A disconnected benchmark: the dispatcher was off, yet ticks arrived.
      (evidence) => { evidence.arms[OFF].ticks = 1; },
      (evidence) => { evidence.arms[ON].ticks = 2_499; },
      // Both tails have to corroborate a regression, and the absolute movement
      // is its own limit.
      (evidence) => {
        evidence.comparison.p95RegressionPercent = 2.1;
        evidence.comparison.p99RegressionPercent = 2.1;
      },
      (evidence) => { evidence.comparison.p95DeltaMs = 1.1; },
    ];
    for (const breach of budgetBreaches) {
      const record = await passingEvidence();
      breach(record.evidence);
      assert.throws(() => validate(record), /acceptance budget/u);
    }

    // One tail alone is normal outpost variance, not a regression.
    const oneTail = await passingEvidence();
    oneTail.evidence.comparison.p95RegressionPercent = 2.1;
    validate(oneTail);
  });
});
