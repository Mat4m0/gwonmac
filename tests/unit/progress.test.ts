import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  DownloadRateAverage,
  longRunningTaskFeedback,
  secondsRemaining,
} from "../../src/shared/progress.ts";

describe("download progress", () => {
  it("warms up, then smooths bursty chunk completion rates", () => {
    const mb = 1_000_000;
    const average = new DownloadRateAverage(0, 0);

    assert.equal(average.update(8 * mb, 1_000), 0);
    assert.equal(average.update(10 * mb, 2_000), 5 * mb);

    const afterBurst = average.update(20 * mb, 2_100);
    assert(afterBurst > 5 * mb);
    assert(afterBurst < 8 * mb);

    const afterSlowSample = average.update(21 * mb, 3_100);
    assert(afterSlowSample < afterBurst);
    assert(afterSlowSample > 4 * mb);
    assert.equal(
      Math.round(secondsRemaining(21 * mb, 42 * mb, afterSlowSample)!),
      Math.round((21 * mb) / afterSlowSample),
    );
  });

  it("ignores duplicate and regressing samples instead of producing spikes", () => {
    const average = new DownloadRateAverage(0, 0, 0);
    const initial = average.update(1_000, 1_000);
    assert.equal(initial, 1_000);
    assert.equal(average.update(1_000, 1_100), initial);
    assert.equal(average.update(500, 1_200), initial);
    assert.equal(average.update(2_000, 2_000), initial);
  });

  it("drives Dock progress and sleep blocking only for a full download", () => {
    const base = {
      label: "fixture",
      bytesPerSecond: 0,
      secondsRemaining: null,
      error: null,
    };
    assert.deepEqual(
      longRunningTaskFeedback({
        ...base,
        phase: "image",
        received: 25,
        total: 100,
      }),
      { preventAppSuspension: true, dockProgress: 0.25 },
    );
    assert.deepEqual(
      longRunningTaskFeedback({
        ...base,
        phase: "image",
        received: 0,
        total: 0,
      }),
      { preventAppSuspension: true, dockProgress: 2 },
    );
    assert.deepEqual(
      longRunningTaskFeedback({
        ...base,
        phase: "ready",
        received: 0,
        total: 0,
      }),
      { preventAppSuspension: false, dockProgress: -1 },
    );
  });
});
