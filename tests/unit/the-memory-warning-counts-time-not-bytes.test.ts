// The estimator, driven over the two sessions that were actually measured on
// 2026-08-04. The shipped build warned on bytes remaining, which meant the same
// sentence bought half an hour in the open world and about two minutes inside a
// mission — the second row here is the whole reason this module exists.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  createHeapPressureWatch,
  hedgeMinutes,
  type HeapPressureLevel,
  type HeapPressureReading,
} from "../../src/renderer/heap-pressure.js";

const MIB = 1_048_576;
const CAP = 2048 * MIB;
const TICK_MS = 15_000;

/**
 * A session at a constant rate, sampled on the watcher's own 15-second tick.
 * Returns the reading at which each level was first raised, which is the only
 * thing the player ever experiences.
 */
function play(mibPerHour: number, startMib = 300, capBytes = CAP) {
  const watch = createHeapPressureWatch({ capBytes });
  const first = new Map<HeapPressureLevel, { atMinutes: number; reading: HeapPressureReading }>();
  let atMs = 0;
  for (let step = 0; step < 4 * 60 * 4; step += 1) {
    const minutes = atMs / 60_000;
    const bytes = (startMib + (mibPerHour / 60) * minutes) * MIB;
    if (bytes >= capBytes) break;
    const reading = watch.sample(bytes, atMs);
    if (!first.has(reading.level)) {
      first.set(reading.level, { atMinutes: minutes, reading });
    }
    atMs += TICK_MS;
  }
  return first;
}

describe("the memory warning counts time, not bytes", () => {
  it("warns an open-world session with the headroom it claims", () => {
    // 555 MiB/h, measured over 2 h 16 m. The cap arrives at about 3 h 09 m.
    const run = play(555);
    const low = run.get("low");
    const critical = run.get("critical");
    assert.ok(low && critical);

    assert.ok(
      low.reading.minutes !== null && low.reading.minutes >= 15 && low.reading.minutes <= 20,
      `low claimed ${low.reading.minutes} minutes`,
    );
    assert.ok(
      critical.reading.minutes !== null && critical.reading.minutes <= 5,
      `critical claimed ${critical.reading.minutes} minutes`,
    );
    // The claim has to be true, not just present: the remaining headroom at
    // the measured rate must be near the number the player was shown.
    const remaining = (CAP - critical.reading.bytes) / MIB / (555 / 60);
    assert.ok(remaining > 3 && remaining < 9, `${remaining} real minutes left`);
    assert.equal(critical.reading.raisedBy, "time");
  });

  it("gives a texture-dense mission the same warning, not two minutes", () => {
    // The Eye of the North report: the cap in about half an hour. Under the
    // shipped byte thresholds this player got "low" with three minutes left
    // and "critical" with ninety seconds — and crashed anyway.
    const run = play(3_500);
    const low = run.get("low");
    const critical = run.get("critical");
    assert.ok(low && critical);

    assert.ok(low.atMinutes < 15, `low arrived at ${low.atMinutes} min`);
    const lowHeadroomMib = (CAP - low.reading.bytes) / MIB;
    assert.ok(
      lowHeadroomMib > 256,
      `${lowHeadroomMib} MiB left — the shipped rule would not have fired yet`,
    );

    // What the shipped build could not do: leave real minutes on the clock.
    const remaining = (CAP - critical.reading.bytes) / MIB / (3_500 / 60);
    assert.ok(remaining > 3, `${remaining} real minutes left at critical`);
  });

  it("does not read the cost of starting the game as the cost of playing it", () => {
    // Observed on a real launch: 734 MiB and climbing at ~4,500 MiB/h less
    // than three minutes in, against a steady-state 555 MiB/h. Measured from
    // inside that ramp the session looks a quarter of an hour from death, and
    // the warning fired at 36% of the cap — every player, every login.
    const watch = createHeapPressureWatch({ capBytes: CAP });
    let atMs = 0;
    let last = watch.sample(0, atMs);
    for (let minute = 0; minute <= 4; minute += 0.25) {
      atMs = minute * 60_000;
      last = watch.sample(Math.min(760, 260 * minute + 40) * MIB, atMs);
      assert.equal(
        last.level,
        "none",
        `warned ${minute} minutes in, at ${Math.round(last.bytes / MIB)} MiB`,
      );
      assert.equal(last.minutes, null, "claimed a figure measured from startup");
    }

    // Once the ramp is behind it, ordinary play is read as ordinary play.
    const settledAt = atMs;
    for (let minute = 5; minute <= 30; minute += 0.25) {
      atMs = minute * 60_000;
      const mib = 760 + (555 / 60) * (minute - settledAt / 60_000);
      last = watch.sample(mib * MIB, atMs);
    }
    assert.equal(last.level, "none", "still quiet with two hours of headroom");
    assert.ok(
      last.bytesPerMinute !== null
        && Math.round((last.bytesPerMinute * 60) / MIB) === 555,
      `read ${Math.round(((last.bytesPerMinute ?? 0) * 60) / MIB)} MiB/h`,
    );
  });

  it("falls back to bytes only while there is no rate to read", () => {
    // A page that opens already near the cap has no history to slope, so the
    // shipped thresholds are what still warns it.
    const watch = createHeapPressureWatch({ capBytes: CAP });
    const cold = watch.sample(CAP - 100 * MIB, 0);
    assert.equal(cold.level, "critical");
    assert.equal(cold.minutes, null, "no number was measured, so none is offered");
    assert.equal(cold.raisedBy, "bytes");
  });

  it("keeps warning a stalled heap that is nearly full", () => {
    // A player idling in an outpost at 1.8 GiB has a near-zero recent rate, so
    // the time rule goes quiet. Bytes are what is left to speak. The heap is
    // flat from the first sample on purpose: a step into it would be a real
    // burst, and reading that as imminent would be correct.
    const watch = createHeapPressureWatch({ capBytes: CAP });
    let atMs = 0;
    let last = watch.sample(1_820 * MIB, atMs);
    for (let i = 0; i < 80; i += 1) {
      atMs += TICK_MS;
      last = watch.sample(1_820 * MIB, atMs);
    }
    assert.equal(last.minutes, null, "a flat heap has no time to give");
    assert.equal(last.level, "low");
  });

  it("never lowers a warning it has already raised", () => {
    const watch = createHeapPressureWatch({ capBytes: CAP });
    let atMs = 0;
    // Climb hard into critical.
    for (let i = 0; i < 40; i += 1) {
      watch.sample((300 + i * 45) * MIB, atMs);
      atMs += TICK_MS;
    }
    // Then stop allocating entirely for twenty minutes.
    let last = watch.sample(2_000 * MIB, atMs);
    assert.equal(last.level, "critical");
    for (let i = 0; i < 80; i += 1) {
      atMs += TICK_MS;
      last = watch.sample(2_000 * MIB, atMs);
    }
    assert.equal(last.level, "critical", "the heap did not shrink, so nor does the warning");
  });

  it("rounds the estimate without ever flattering it by much", () => {
    assert.equal(hedgeMinutes(19.7), 20);
    assert.equal(hedgeMinutes(12), 10);
    assert.equal(hedgeMinutes(4.4), 4);
    assert.equal(hedgeMinutes(0.2), 0);
    assert.equal(hedgeMinutes(-5), 0);
    for (let m = 0; m <= 180; m += 0.1) {
      assert.ok(
        hedgeMinutes(m) <= m + 2.5,
        `hedge(${m}) = ${hedgeMinutes(m)} overstates by more than 2.5`,
      );
    }
  });

  it("produces no NaN, no infinity and no negative minutes", () => {
    for (const capBytes of [0, CAP]) {
      const watch = createHeapPressureWatch({ capBytes });
      for (const [bytes, atMs] of [
        [300 * MIB, 0],
        [400 * MIB, 0], // same instant
        [500 * MIB, -1_000], // backwards
        [4_000 * MIB, 60_000], // past the cap
        [4_000 * MIB, 200_000],
      ] as const) {
        const reading = watch.sample(bytes, atMs);
        for (const value of [reading.minutes, reading.bytesPerMinute]) {
          assert.ok(value === null || Number.isFinite(value), String(value));
        }
        assert.ok((reading.minutes ?? 0) >= 0);
      }
    }
  });
});
