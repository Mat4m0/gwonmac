/**
 * How long the client has left before its heap fills, and which warning that
 * earns. The unit is time, not bytes remaining: the same 256 MiB of headroom
 * was half an hour of open-world play and about two minutes inside a
 * texture-dense mission, and a player has no way to tell those apart from a
 * sentence that names neither.
 *
 * It owns the rate estimate and the threshold policy. It owns no DOM, no
 * timer, and not one word the player reads — the harness drives it and
 * `failure-messages.ts` says it. It also imports nothing from `../shared/`:
 * the client's compiled-in cap arrives as an argument, because a second
 * importer of the canonical contract disturbs the packaged proof that the
 * Enhancement runtime is what requested it.
 *
 * What it measures is a staircase, not a slope. `Module.HEAPU8.buffer` is the
 * memory the runtime has *reserved*, and WebAssembly reserves it in discrete
 * jumps — Emscripten's glue grows by a fifth of the current size, capped at
 * 96 MiB, so a session spending 555 MiB an hour takes one step roughly every
 * ten minutes and is perfectly flat in between. That shape decides the whole
 * design below, and getting it wrong is not subtle: a fixed five-minute
 * window contains either no step or one, and reports 0 or 1,152 MiB an hour
 * for a session actually spending 555.
 */

export type HeapPressureLevel = 'none' | 'low' | 'critical';

export interface HeapPressureReading {
  /** Monotonic within a client run: once critical, always critical. */
  level: HeapPressureLevel;
  /** Hedged and display-ready; null when no rate could be measured. */
  minutes: number | null;
  /** Unhedged, for the log line. Null when unmeasurable. */
  bytesPerMinute: number | null;
  bytes: number;
  /** Which rule raised the level. For the log; the copy never branches on it. */
  raisedBy: 'time' | 'bytes' | null;
}

export interface HeapPressurePolicy {
  /** Shortest step-to-step span a rate may be measured over. See DEFAULTS. */
  minSpanMs?: number;
  /** No step counts until this long after the client first allocated. */
  warmupMs?: number;
  lowMinutes?: number;
  criticalMinutes?: number;
  blindLowBytes?: number;
  blindCriticalBytes?: number;
  hardCriticalBytes?: number;
  minRateBytesPerMinute?: number;
  /** How many consecutive readings must agree before a level is raised. */
  confirmations?: number;
}

export interface HeapPressureWatch {
  sample(bytes: number, atMs: number): HeapPressureReading;
}

const MIB = 1_048_576;

const DEFAULTS = {
  /**
   * Both ends of a measurement sit on a growth step, and they must be at
   * least this far apart.
   *
   * Step-to-step is what makes the estimate stand still. Measuring from a
   * step to *now* puts a whole tread in the denominator and none of its rise
   * in the numerator, so the figure sags between steps and jumps back when
   * the next one lands — a third of its own value, every ten minutes, on a
   * session whose rate never changed. Measuring step to step reads the same
   * number wherever in the tread the sample falls.
   *
   * The span is what tells a burst from a trend, and ten minutes is bought
   * rather than guessed. Loading a zone reserves a couple of hundred MiB in
   * seconds; a sustained 3,500 MiB an hour reserves about the same amount
   * over ten minutes. Inside a window shorter than that the two are the same
   * measurement, and the level never falls, so getting it wrong is permanent.
   * Simulated against the sessions we have measured — a 300 MiB zone load at
   * minute 30 of an ordinary 555 MiB/h session:
   *
   *     span   what the load makes the warning say
   *      4 m   "about 20 minutes of play left", 77 minutes truly left
   *      8 m   escalates to critical with 30 minutes truly left
   *     10 m   nothing; the real warning arrives on time at minute 95
   *
   * The cost is paid by the fastest sessions. A mission spending 3,500 MiB an
   * hour dies around minute 23, and nothing can be said about it until minute
   * 18 — five minutes of warning where an eight-minute span would have given
   * eight. That is the worse error to accept, and it is accepted knowingly:
   * the alternative mis-warns every player who walks into a large zone, every
   * time, and leaves the warning up for the hour afterwards. The byte floors
   * below are the backstop for the fast case.
   *
   * There is no shorter honest answer. Ten minutes into a mission, a
   * ten-minute-old zone load and a sustained spend look alike in every
   * window; a "is it still going?" test costs exactly the latency it saves.
   */
  minSpanMs: 10 * 60_000,
  /**
   * Measured from the client's first allocation, not from page load.
   *
   * Starting the client is the heaviest allocating a session ever does —
   * observed at roughly 4,500 MiB/h against a steady-state 555 — so a
   * measurement anchored inside that ramp reads a startup as a session with a
   * quarter of an hour to live, and every player is warned a minute after
   * logging in. Anchoring the exclusion to page load instead looks equivalent
   * and is not: the page is open through the client download, so a slow first
   * run boots after the warm-up has already expired and the ramp is measured
   * as ordinary play.
   */
  warmupMs: 5 * 60_000,
  lowMinutes: 20,
  criticalMinutes: 5,
  // The bytes the shipped build warned on, kept for when time is unmeasurable.
  blindLowBytes: 256 * MIB,
  blindCriticalBytes: 128 * MIB,
  // The never-silent backstop: this much headroom is critical whatever any
  // estimate claims. It has to sit *below* where the time rule fires in an
  // ordinary session or it pre-empts it — at the measured 555 MiB/h the five
  // minute rule fires at about 46 MiB, and a 64 MiB floor took the warning
  // over at seven minutes, which is the defect this module exists to remove.
  hardCriticalBytes: 32 * MIB,
  minRateBytesPerMinute: MIB,
  /**
   * How many consecutive readings must agree before the level is raised. The
   * level never falls, so a single unlucky sample would be permanent — this is
   * what makes "we measured it twice" the price of a warning that cannot be
   * taken back. The hard byte floor is exempt: at that point the heap really
   * is nearly full and there is nothing left to corroborate.
   */
  confirmations: 2,
};

const RANK: Record<HeapPressureLevel, number> = {
  none: 0,
  low: 1,
  critical: 2,
};

/**
 * Round the estimate the way the sentence reads it: to five minutes once
 * there is a quarter of an hour to spend, to the minute when there is not.
 *
 * Nearest, not down. At the moment the twenty-minute rule fires the estimate
 * sits just under twenty, and flooring would print "about 15 minutes" —
 * understating by a quarter exactly when the number is supposed to sound
 * deliberate. Rounding up costs at most two and a half minutes against an
 * estimate already built to run early, and the sentence says "about".
 */
export function hedgeMinutes(minutes: number): number {
  if (!Number.isFinite(minutes) || minutes <= 0) return 0;
  return minutes >= 10 ? Math.round(minutes / 5) * 5 : Math.round(minutes);
}

export function createHeapPressureWatch(
  options: { capBytes: number } & HeapPressurePolicy,
): HeapPressureWatch {
  const policy = { ...DEFAULTS, ...options };
  const capBytes = options.capBytes;
  /** Growth steps, oldest first; `bytes` is the heap the step arrived at. */
  const steps: { atMs: number; bytes: number; grewBy: number }[] = [];
  let previousBytes: number | null = null;
  let previousAtMs = -Infinity;
  /** When the client first held any memory — the clock the warm-up runs on. */
  let allocatingSinceMs: number | null = null;
  let raised: HeapPressureLevel = 'none';
  let pending: HeapPressureLevel = 'none';
  let streak = 0;

  return {
    sample(bytes, atMs) {
      // A repeated or backwards timestamp would divide by zero or by a
      // negative; the sample is dropped rather than allowed to produce a rate.
      if (atMs > previousAtMs) {
        if (allocatingSinceMs === null && bytes > 0) allocatingSinceMs = atMs;
        const settled =
          allocatingSinceMs !== null
          && atMs >= allocatingSinceMs + policy.warmupMs;
        if (settled && previousBytes !== null && bytes > previousBytes) {
          steps.push({ atMs, bytes, grewBy: bytes - previousBytes });
          // Only the newest step old enough to be a base is ever read again,
          // so everything before it goes. Pruning against the newest *step*
          // rather than against now is what keeps the base from being thrown
          // away during a plateau, when nothing newer can replace it.
          const oldestUseful = atMs - policy.minSpanMs;
          while (steps.length > 2 && steps[1]!.atMs <= oldestUseful) {
            steps.shift();
          }
        }
        previousBytes = bytes;
        previousAtMs = atMs;
      }

      let bytesPerMinute: number | null = null;
      const last = steps.at(-1);
      let baseIndex = -1;
      if (last) {
        const cutoff = last.atMs - policy.minSpanMs;
        for (let i = steps.length - 1; i >= 0; i -= 1) {
          if (steps[i]!.atMs <= cutoff) {
            baseIndex = i;
            break;
          }
        }
      }
      const base = baseIndex >= 0 ? steps[baseIndex] : undefined;
      if (last && base) {
        const spanMs = last.atMs - base.atMs;
        // How long the heap has stood still since the last step. On a regular
        // staircase this only ever climbs to one tread's width and resets, so
        // it changes nothing; past that width it is evidence the spending has
        // slowed, and it stretches the denominator rather than leaving a stale
        // rate in place for a player who has walked back into town.
        const meanStepMs = spanMs / (steps.length - 1 - baseIndex);
        const overdueMs = Math.max(0, atMs - last.atMs - meanStepMs);
        const minutes = (spanMs + overdueMs) / 60_000;
        if (minutes > 0) {
          bytesPerMinute = Math.max(0, (last.bytes - base.bytes) / minutes);
        }
      }
      if (
        bytesPerMinute !== null
        && bytesPerMinute < policy.minRateBytesPerMinute
      ) {
        bytesPerMinute = null;
      }

      // What the client has actually filled, as against what it has reserved
      // for itself. Growth fires when a request no longer fits, so at the
      // instant of a step the filled bytes are what the reserve was *before*
      // it, and between steps they climb at the rate just measured. Taking
      // headroom off the reserve instead makes every step look like ten
      // minutes of play disappearing at once: the figure sits still for a
      // tread and then lurches, and it reads a session as a third shorter
      // than it is. The error here is one allocation request, not one step.
      let filled = bytes;
      if (last && bytesPerMinute !== null) {
        const spentSinceStep = (bytesPerMinute * (atMs - last.atMs)) / 60_000;
        filled = Math.min(bytes, bytes - last.grewBy + spentSinceStep);
      }
      const headroom = capBytes > 0 ? Math.max(0, capBytes - filled) : null;
      const rawMinutes =
        headroom !== null && bytesPerMinute !== null && bytesPerMinute > 0
          ? headroom / bytesPerMinute
          : null;

      let fromTime: HeapPressureLevel = 'none';
      if (rawMinutes !== null) {
        if (rawMinutes <= policy.criticalMinutes) fromTime = 'critical';
        else if (rawMinutes <= policy.lowMinutes) fromTime = 'low';
      }

      let fromBytes: HeapPressureLevel = 'none';
      if (headroom !== null) {
        if (headroom <= policy.hardCriticalBytes) fromBytes = 'critical';
        else if (rawMinutes === null) {
          // Only while time is unmeasurable. Left unconditional, the 128 MiB
          // floor is nearly fourteen minutes at the measured open-world rate —
          // it would pre-empt the five-minute rule every session and rebuild
          // the defect this module exists to remove.
          if (headroom <= policy.blindCriticalBytes) fromBytes = 'critical';
          else if (headroom <= policy.blindLowBytes) fromBytes = 'low';
        }
      }

      const proposed = RANK[fromTime] >= RANK[fromBytes] ? fromTime : fromBytes;
      let raisedBy: 'time' | 'bytes' | null = null;
      if (RANK[proposed] > RANK[raised]) {
        streak = proposed === pending ? streak + 1 : 1;
        pending = proposed;
        // The floor answers for itself; everything else is corroborated first,
        // because a level that cannot fall must not be set by one sample.
        const forced = headroom !== null && headroom <= policy.hardCriticalBytes;
        if (forced || streak >= policy.confirmations) {
          raised = proposed;
          raisedBy = RANK[fromTime] >= RANK[fromBytes] ? 'time' : 'bytes';
        }
      } else {
        streak = 0;
        pending = 'none';
      }

      return {
        level: raised,
        minutes: rawMinutes === null ? null : hedgeMinutes(rawMinutes),
        bytesPerMinute,
        bytes,
        raisedBy,
      };
    },
  };
}
