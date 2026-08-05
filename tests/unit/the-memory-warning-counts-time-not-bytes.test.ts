// The estimator, driven over the two sessions that were actually measured on
// 2026-08-04. The shipped build warned on bytes remaining, which meant the same
// sentence bought half an hour in the open world and about two minutes inside a
// mission — the second row here is the whole reason this module exists.
//
// Every session below is a staircase, not a ramp, because that is what the
// runtime presents: `Module.HEAPU8.buffer` is *reserved* memory and WebAssembly
// reserves it in jumps. An earlier version of this file drove smooth linear
// growth and passed while the shipped estimator read a steady 555 MiB/h session
// as alternating between 384 and 1,152 — the test was measuring a shape no
// client produces. `simulate` below is the fix: it models the allocator, works
// out when the client really dies, and every assertion is what the player was
// told against what was true at that moment.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  createHeapPressureWatch,
  hedgeMinutes,
  type HeapPressurePolicy,
  type HeapPressureLevel,
  type HeapPressureReading,
} from "../../src/renderer/heap-pressure.js";

const MIB = 1_048_576;
const CAP = 2048 * MIB;
const TICK_MS = 15_000;
const TICK_MINUTES = TICK_MS / 60_000;

interface Tick extends HeapPressureReading {
  atMinutes: number;
  /** Minutes until this session really ends, known from the whole run. */
  trulyLeft: number;
}

interface Session {
  diesAtMinutes: number;
  ticks: readonly Tick[];
  /** The first tick at each level, which is all the player ever experiences. */
  raised: Map<HeapPressureLevel, Tick>;
}

/**
 * A session as the runtime actually presents it.
 *
 * The client fills memory smoothly and the runtime reserves it in steps:
 * Emscripten's glue grows by a fifth of the current size, capped at 96 MiB,
 * and never by less than the allocation needs. At the measured open-world rate
 * that is one step roughly every ten minutes with a flat heap in between —
 * which is the entire difficulty this module exists to handle.
 *
 * The physics run first and to the end, so the death is known before the
 * watcher is asked about it. Nothing here asserts against the watcher's own
 * arithmetic; every claim is checked against the session that really happened.
 */
function simulate(options: {
  /** MiB per hour of real spending, constant or per-minute. */
  rate: number | ((minute: number) => number);
  startMib?: number;
  /** Minutes the page is open before the client allocates anything. */
  bootAtMinutes?: number;
  /** One-off reservations — a zone load is a couple of hundred MiB in seconds. */
  loads?: readonly { atMinutes: number; mib: number }[];
  policy?: HeapPressurePolicy;
  capBytes?: number;
}): Session {
  const capBytes = options.capBytes ?? CAP;
  const boot = options.bootAtMinutes ?? 0;
  const rateAt = (minute: number) =>
    typeof options.rate === "function" ? options.rate(minute) : options.rate;

  const frames: { atMinutes: number; reservedMib: number }[] = [];
  let usedMib = 0;
  let reservedMib = 0;
  let diesAtMinutes = Infinity;
  for (let minute = 0; minute < 600; minute += TICK_MINUTES) {
    if (minute >= boot) {
      if (usedMib === 0) usedMib = options.startMib ?? 690;
      usedMib += (rateAt(minute) / 60) * TICK_MINUTES;
      for (const load of options.loads ?? []) {
        if (Math.abs(minute - load.atMinutes) < TICK_MINUTES / 2) {
          usedMib += load.mib;
        }
      }
      // The glue's own growth rule, and it repeats until the ask fits.
      while (usedMib > reservedMib) {
        reservedMib += Math.max(16, Math.min(96, reservedMib * 0.2));
      }
    }
    if (usedMib * MIB >= capBytes) {
      diesAtMinutes = minute;
      break;
    }
    frames.push({ atMinutes: minute, reservedMib });
  }

  const watch = createHeapPressureWatch({ capBytes, ...options.policy });
  const raised = new Map<HeapPressureLevel, Tick>();
  const ticks = frames.map((frame) => {
    const reading = watch.sample(frame.reservedMib * MIB, frame.atMinutes * 60_000);
    const tick: Tick = {
      ...reading,
      atMinutes: frame.atMinutes,
      trulyLeft: diesAtMinutes - frame.atMinutes,
    };
    if (!raised.has(reading.level)) raised.set(reading.level, tick);
    return tick;
  });
  return { diesAtMinutes, ticks, raised };
}

/** Every figure the player was shown, and what was true when they saw it. */
const claims = (session: Session) =>
  session.ticks.filter((tick) => tick.minutes !== null);

describe("the memory warning counts time, not bytes", () => {
  it("warns an open-world session with the headroom it claims", () => {
    // 555 MiB/h, measured over 2 h 16 m.
    const session = simulate({ rate: 555 });
    const low = session.raised.get("low");
    const critical = session.raised.get("critical");
    assert.ok(low && critical, "the session ended without warning");

    // The claim has to be true, not merely present.
    assert.ok(
      low.trulyLeft > 15 && low.trulyLeft < 26,
      `low arrived with ${low.trulyLeft.toFixed(1)} real minutes left`,
    );
    assert.ok(
      critical.trulyLeft > 3 && critical.trulyLeft < 9,
      `critical arrived with ${critical.trulyLeft.toFixed(1)} real minutes left`,
    );
    assert.equal(critical.raisedBy, "time");
  });

  it("gives a texture-dense mission a real warning, not ninety seconds", () => {
    // The Eye of the North report: the cap in about half an hour. Under the
    // shipped byte thresholds this player got "low" with three minutes left
    // and "critical" with ninety seconds — and crashed anyway.
    const session = simulate({ rate: 3_500 });
    const low = session.raised.get("low");
    assert.ok(low, "the fast session was never warned at all");
    assert.ok(
      low.trulyLeft >= 4,
      `only ${low.trulyLeft.toFixed(1)} minutes of warning`,
    );

    // What the shipped build could not do: warn while there is still headroom
    // to walk somewhere. Its 256 MiB rule fires about 3 minutes before death
    // at this rate.
    const headroomMib = (CAP - low.bytes) / MIB;
    assert.ok(
      headroomMib > 180,
      `${headroomMib.toFixed(0)} MiB left — inside the shipped rule's reach`,
    );
  });

  it("reads the rate that was actually spent, not the shape of the staircase", () => {
    // The defect this test exists for. Reserved memory moves in ~96 MiB jumps
    // about ten minutes apart at this rate, so a five-minute window contains
    // either no step or one and reports 0 or 1,152 MiB/h for a session
    // spending 555. Both ends of a measurement sit on a step for this reason.
    for (const rate of [555, 3_500]) {
      const measured = simulate({ rate })
        .ticks.map((tick) => tick.bytesPerMinute)
        .filter((value): value is number => value !== null)
        .map((value) => (value * 60) / MIB);
      assert.ok(measured.length > 0, `${rate} MiB/h was never measured at all`);
      for (const value of measured) {
        assert.ok(
          Math.abs(value - rate) / rate < 0.1,
          `read ${value.toFixed(0)} MiB/h for a session spending ${rate}`,
        );
      }
    }
  });

  it("counts down instead of standing still and lurching", () => {
    // Each step reserves about ten minutes of play at once. Read off the
    // reserve, the estimate would sit through a whole tread and then drop ten
    // minutes in one tick; the figure the player watches has to move the way
    // time does. The five-minute granularity of the wording is the floor.
    for (const rate of [555, 3_500]) {
      const shown = claims(simulate({ rate })).map((tick) => tick.minutes!);
      for (let i = 1; i < shown.length; i += 1) {
        assert.ok(
          Math.abs(shown[i]! - shown[i - 1]!) <= 5,
          `${rate} MiB/h: the figure jumped ${shown[i - 1]} → ${shown[i]}`,
        );
      }
    }
  });

  it("never names a number that is not close to true", () => {
    // The whole premise. Anywhere a figure is shown, in either session, it has
    // to be near the time that was really left — a warning nobody can check is
    // worth as much as the "running low" it replaced.
    for (const rate of [555, 3_500]) {
      for (const tick of claims(simulate({ rate }))) {
        const slack = Math.max(2.5, tick.trulyLeft * 0.35);
        assert.ok(
          Math.abs(tick.minutes! - tick.trulyLeft) <= slack,
          `${rate} MiB/h at ${tick.atMinutes} min: said ${tick.minutes}`
            + `, truly ${tick.trulyLeft.toFixed(1)}`,
        );
      }
    }
  });

  it("does not read the cost of starting the game as the cost of playing it", () => {
    // Observed on a real launch: 734 MiB and climbing at ~4,500 MiB/h less
    // than three minutes in, against a steady-state 555 MiB/h. Measured from
    // inside that ramp the session looks a quarter of an hour from death, and
    // the warning fired at 36% of the cap — every player, every login.
    const session = simulate({
      startMib: 40,
      rate: (minute) => (minute < 3 ? 15_000 : 555),
    });
    for (const tick of session.ticks) {
      if (tick.atMinutes > 60) break;
      assert.equal(
        tick.level,
        "none",
        `warned ${tick.atMinutes} min in, at ${Math.round(tick.bytes / MIB)} MiB`,
      );
    }
    // Once the ramp is behind it, ordinary play is read as ordinary play.
    const settled = claims(session).at(-1);
    assert.ok(settled?.bytesPerMinute, "the ramp silenced the whole session");
    const perHour = (settled.bytesPerMinute * 60) / MIB;
    assert.ok(
      Math.abs(perHour - 555) / 555 < 0.1,
      `read ${perHour.toFixed(0)} MiB/h after a 15,000 MiB/h launch`,
    );
  });

  it("survives a first run whose download outlasts the warm-up", () => {
    // The warm-up excludes the startup ramp, so where its clock starts decides
    // whether it works. Anchored to page load it looks equivalent and is not:
    // the page stays open through the client download, so a slow first run
    // boots after the exclusion has already expired and the ramp is measured
    // as ordinary play — 38% of the cap, "about 8 minutes of play left", two
    // hours of real headroom. The clock starts at the first allocation.
    const session = simulate({
      bootAtMinutes: 12,
      startMib: 40,
      rate: (minute) => (minute < 15 ? 15_000 : 555),
    });
    for (const tick of session.ticks) {
      if (tick.atMinutes > 70) break;
      assert.equal(
        tick.level,
        "none",
        `warned ${tick.atMinutes} min in, at ${Math.round(tick.bytes / MIB)} MiB`,
      );
    }
  });

  it("starts measuring when the player starts playing, not when they log in", () => {
    // Ten minutes parked in Kamadan, then out into the world. Nothing about
    // the idling should either warn or be averaged into what follows.
    const session = simulate({ rate: (minute) => (minute < 15 ? 0 : 555) });
    for (const tick of session.ticks) {
      if (tick.atMinutes > 40) break;
      assert.equal(tick.level, "none", `warned while idle at ${tick.atMinutes}`);
    }
    const late = claims(session).at(-1);
    assert.ok(late && Math.abs((late.bytesPerMinute! * 60) / MIB - 555) < 60);
  });

  it("does not let one map load latch a warning that cannot be taken back", () => {
    // A zone load reserves a couple of hundred MiB in seconds. Measured over a
    // window short enough it reads as thousands of MiB an hour, and since the
    // level never falls it would be permanent — this session is warned when it
    // deserves it, not thirty-eight minutes early because the player walked
    // through a door.
    const session = simulate({
      rate: 555,
      loads: [{ atMinutes: 30, mib: 300 }],
    });
    const low = session.raised.get("low");
    assert.ok(low, "the load swallowed the real warning too");
    assert.ok(
      low.trulyLeft < 26,
      `the load warned ${low.trulyLeft.toFixed(0)} minutes before it mattered`,
    );
    assert.ok(
      session.ticks.some((tick) => tick.atMinutes > 30 && tick.bytes > 1_100 * MIB),
      "the load did happen",
    );
  });

  it("falls back to bytes only while there is no rate to read", () => {
    // A page that opens already near the cap has no staircase to read, so the
    // shipped thresholds are what still warns it.
    const watch = createHeapPressureWatch({ capBytes: CAP });
    const first = watch.sample(CAP - 100 * MIB, 0);
    // Corroborated first: the level can never be taken back, so no single
    // reading sets it. One tick later is the whole cost.
    assert.equal(first.level, "none", "raised on a single reading");
    const cold = watch.sample(CAP - 100 * MIB, TICK_MS);
    assert.equal(cold.level, "critical");
    assert.equal(cold.minutes, null, "no number was measured, so none is offered");
    assert.equal(cold.raisedBy, "bytes");

    // Except at the floor, where there is nothing left to corroborate.
    const dying = createHeapPressureWatch({ capBytes: CAP });
    assert.equal(dying.sample(CAP - 8 * MIB, 0).level, "critical");
  });

  it("keeps warning a stalled heap that is nearly full", () => {
    // A player idling in an outpost at 1.8 GiB has no recent steps, so the
    // time rule has nothing to say. Bytes are what is left to speak.
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

  it("lets a rate go stale rather than believing it forever", () => {
    // Step-to-step measurement is what stops the figure sagging between steps,
    // but it also means a player who stops spending would otherwise keep the
    // last rate they earned. A tread wider than the ones it was measured over
    // is evidence, and it stretches the estimate out.
    const session = simulate({ rate: (minute) => (minute < 45 ? 555 : 0) });
    const spending = session.ticks.find((tick) => tick.atMinutes === 44)!;
    const idle = session.ticks.find((tick) => tick.atMinutes === 90);
    assert.ok(spending.bytesPerMinute !== null);
    assert.ok(
      idle === undefined
        || idle.bytesPerMinute === null
        || idle.bytesPerMinute < spending.bytesPerMinute / 4,
      "an hour of standing still still read as open-world spending",
    );
  });

  it("never lowers a warning it has already raised", () => {
    const watch = createHeapPressureWatch({ capBytes: CAP });
    let atMs = 0;
    for (let i = 0; i < 40; i += 1) {
      watch.sample((300 + i * 45) * MIB, atMs);
      atMs += TICK_MS;
    }
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
