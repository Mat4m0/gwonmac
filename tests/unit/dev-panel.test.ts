// The panel's arithmetic, executed rather than asserted about. The readout is
// the instrument a reconnect experiment is recorded against, so a number it
// prints wrong is a wrong finding — these run the real functions over the
// shapes a real session produces: a monotone climb, a reload, a stalled heap,
// and a cap the harness has not resolved yet.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  decimate,
  summarizeHeap,
  type HeapSample,
} from "../../src/renderer/dev-panel.js";

const MIB = 1_048_576;
const CAP = 2048 * MIB;

/** Minutes-since-start into the shape the panel stores. */
const at = (minutes: number, mib: number): HeapSample => ({
  atMs: minutes * 60_000,
  bytes: mib * MIB,
});

describe("the memory panel's readout", () => {
  it("reports the climb of a real session in the units the panel prints", () => {
    // The measured open-world session: 555 MiB/h from 300 MiB.
    const samples: HeapSample[] = [];
    for (let minute = 0; minute <= 120; minute += 5) {
      samples.push(at(minute, 300 + (555 / 60) * minute));
    }
    const summary = summarizeHeap(samples, CAP, 120 * 60_000);

    assert.ok(summary.runBytesPerMinute !== null);
    assert.equal(Math.round((summary.runBytesPerMinute * 60) / MIB), 555);
    assert.ok(summary.fractionOfCap !== null);
    assert.ok(summary.fractionOfCap > 0.6 && summary.fractionOfCap < 0.7);

    // Time to the cap, at that rate, from ~1410 MiB.
    assert.ok(summary.minutesToCap !== null);
    assert.ok(
      summary.minutesToCap > 60 && summary.minutesToCap < 80,
      `${summary.minutesToCap} minutes`,
    );
  });

  it("counts a growth step per rise, and treats a fall as a reloaded client", () => {
    // WASM memory never returns pages, so a smaller reading is a new client on
    // the same page — the count restarts rather than going negative.
    const summary = summarizeHeap(
      [at(0, 300), at(1, 400), at(2, 400), at(3, 500), at(4, 260), at(5, 350)],
      CAP,
      5 * 60_000,
    );
    assert.equal(summary.steps, 3);
    assert.equal(summary.lastStepBytes, 90 * MIB);
    assert.equal(summary.lastStepAtMs, 5 * 60_000);
  });

  it("says nothing rather than guessing when there is nothing to measure", () => {
    const empty = summarizeHeap([], CAP, 0);
    assert.equal(empty.runBytesPerMinute, null);
    assert.equal(empty.minutesToCap, null);
    assert.equal(empty.steps, 0);

    const one = summarizeHeap([at(0, 300)], CAP, 0);
    assert.equal(one.runBytesPerMinute, null);
    assert.equal(one.minutesToCap, null);

    // A heap that has not moved has no rate, so no estimate — not "forever".
    const flat = summarizeHeap([at(0, 900), at(10, 900), at(20, 900)], CAP, 20 * 60_000);
    assert.equal(flat.runBytesPerMinute, 0);
    assert.equal(flat.minutesToCap, null);
  });

  it("renders an unresolved cap as unknown instead of dividing by it", () => {
    // `capBytes` is 0 until the harness's deferred contract import lands, and
    // the panel can be opened before then.
    const summary = summarizeHeap([at(0, 300), at(10, 400)], 0, 10 * 60_000);
    assert.equal(summary.fractionOfCap, null);
    assert.equal(summary.minutesToCap, null);
    assert.ok(summary.runBytesPerMinute !== null, "the rate is still knowable");
    assert.equal(Number.isFinite(summary.runBytesPerMinute), true);
  });

  it("keeps the ends of the run when the ring is halved", () => {
    // The sparkline has to span the whole session, so the oldest and newest
    // samples are the two that must survive every decimation.
    const samples = Array.from({ length: 41 }, (_, i) => at(i, 300 + i));
    const halved = decimate(samples);
    assert.ok(halved.length <= 22, `${halved.length} kept`);
    assert.deepEqual(halved[0], samples[0]);
    assert.deepEqual(halved.at(-1), samples.at(-1));

    // Repeated halving stays stable and never drops below the two ends.
    let ring = samples;
    for (let round = 0; round < 8; round += 1) ring = decimate(ring);
    assert.ok(ring.length >= 2);
    assert.deepEqual(ring[0], samples[0]);
    assert.deepEqual(ring.at(-1), samples.at(-1));

    // Too short to thin is returned as it is, not emptied.
    assert.deepEqual(decimate([]), []);
    assert.deepEqual(decimate([at(0, 300)]), [at(0, 300)]);
  });

  it("produces no NaN or negative from degenerate input", () => {
    for (const samples of [
      [at(0, 300), at(0, 400)], // no elapsed time
      [at(5, 300), at(0, 400)], // out of order
      [at(0, 4000)], // already past the cap
    ]) {
      const summary = summarizeHeap(samples, CAP, 5 * 60_000);
      for (const value of [
        summary.runBytesPerMinute,
        summary.recentBytesPerMinute,
        summary.minutesToCap,
        summary.fractionOfCap,
      ]) {
        assert.ok(value === null || Number.isFinite(value), String(value));
      }
      assert.ok((summary.minutesToCap ?? 0) >= 0);
    }
  });
});
