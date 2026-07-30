import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  DownloadDetailLine,
  DownloadRateAverage,
  EtaDisplay,
  longRunningTaskFeedback,
  secondsRemaining,
} from "../../src/shared/progress.ts";

describe("download progress", () => {
  it("warms up, then smooths bursty chunk completion rates", () => {
    const mb = 1_000_000;
    const average = new DownloadRateAverage(0, 0);

    assert.equal(average.update(8 * mb, 1_000), 0);
    assert.equal(average.update(10 * mb, 2_000), 5 * mb);

    // A completion milliseconds after the last is deferred, not read as a
    // 100 MB/s spike; its bytes fold into the next accepted sample.
    assert.equal(average.update(20 * mb, 2_100), 5 * mb);

    const afterBurst = average.update(21 * mb, 3_100);
    assert(afterBurst > 5 * mb);
    assert(afterBurst < 8 * mb);

    const afterSlowSample = average.update(21.5 * mb, 4_600);
    assert(afterSlowSample < afterBurst);
    assert(afterSlowSample > 4 * mb);
    assert.equal(
      Math.round(secondsRemaining(21.5 * mb, 43 * mb, afterSlowSample)!),
      Math.round((21.5 * mb) / afterSlowSample),
    );
  });

  it("moves the displayed minutes only at the hysteresis edges", () => {
    const eta = new EtaDisplay();
    assert.equal(eta.update(null), null);
    assert.equal(eta.update(345), 6);

    // Six minutes holds while the estimate stays inside (270, 390]: jitter
    // around either minute boundary cannot flip the display, and the shown
    // value is never more than half a minute beyond a true boundary.
    assert.equal(eta.update(390), 6);
    assert.equal(eta.update(271), 6);

    // Half a minute past a boundary commits the true minute exactly.
    assert.equal(eta.update(269), 5);
    assert.equal(eta.update(211), 5);
    assert.equal(eta.update(209), 4);

    // A genuine change re-anchors in one step instead of lagging through
    // intermediate minutes.
    assert.equal(eta.update(700), 12);

    // Small estimates floor at one minute; a lost estimate clears the state
    // so the next download starts fresh.
    assert.equal(eta.update(5), 1);
    assert.equal(eta.update(null), null);
    assert.equal(eta.update(345), 6);
  });

  it("throttles the detail line but renders clearing events immediately", () => {
    const line = new DownloadDetailLine();
    const base = {
      received: 100e6,
      total: 1e9,
      bytesPerSecond: 2e6,
      secondsRemaining: 450,
    };
    assert.equal(
      line.update(base, 0),
      "100 MB of 1.00 GB · 2.0 MB/s avg · 8 min remaining",
    );

    // Numeric churn within the same second keeps the shown line.
    assert.equal(
      line.update(
        { ...base, received: 150e6, bytesPerSecond: 2.4e6, secondsRemaining: 430 },
        500,
      ),
      "100 MB of 1.00 GB · 2.0 MB/s avg · 8 min remaining",
    );

    // A second later the line follows the numbers again.
    assert.equal(
      line.update(
        { ...base, received: 200e6, bytesPerSecond: 2.4e6, secondsRemaining: 380 },
        1_200,
      ),
      "200 MB of 1.00 GB · 2.4 MB/s avg · 7 min remaining",
    );

    // The zeroing event PatchClient emits before assembling a file bypasses
    // the throttle: it is the last event before a silent stretch, and
    // holding it back would freeze the old speed on screen throughout.
    assert.equal(
      line.update(
        { ...base, received: 200e6, bytesPerSecond: 0, secondsRemaining: null },
        1_400,
      ),
      "200 MB of 1.00 GB",
    );

    // The next numeric event restarts both the readout and the ETA state.
    assert.equal(
      line.update({ ...base, received: 220e6, secondsRemaining: 380 }, 2_500),
      "220 MB of 1.00 GB · 2.0 MB/s avg · 7 min remaining",
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
