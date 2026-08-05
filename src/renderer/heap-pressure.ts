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
  windowsMs?: readonly number[];
  /** No slope is measured from a sample older than this. See DEFAULTS. */
  warmupMs?: number;
  lowMinutes?: number;
  criticalMinutes?: number;
  blindLowBytes?: number;
  blindCriticalBytes?: number;
  hardCriticalBytes?: number;
  minRateBytesPerMinute?: number;
}

export interface HeapPressureWatch {
  sample(bytes: number, atMs: number): HeapPressureReading;
}

const MIB = 1_048_576;

/**
 * Two trailing windows, and the steepest wins. The short one catches a session
 * that has started spending heavily; the long one stops a lull inside that
 * spending from erasing a rate we just measured. There is no session-average
 * window: under a steepest-wins rule it could only ever win by keeping an
 * hour-old burst alive forever.
 *
 * Five minutes is the floor for the short one, not two. Loading a zone
 * allocates a couple of hundred MiB in seconds, which over two minutes reads
 * as thousands of MiB an hour — and since the level never falls, one map
 * change would have latched a warning for the rest of the session. Five
 * minutes dilutes a single load to something a real trend can still beat, and
 * costs nothing that matters: the fastest session we have measured took half
 * an hour to fill, so being told at minute ten instead of minute eight
 * changes nothing a player would do.
 */
const DEFAULTS = {
  windowsMs: [5 * 60_000, 15 * 60_000] as readonly number[],
  /**
   * Nothing measured before this counts as a baseline. Starting the client is
   * the heaviest allocating a session ever does — observed at roughly
   * 4,500 MiB/h against a steady-state 555 — so a window whose base sits in
   * the ramp reads a startup as a session with a quarter of an hour to live,
   * and every player would be warned a minute after logging in.
   *
   * Samples from the ramp are still recorded; they are just never the point a
   * slope is measured from. The cost is that the first estimate arrives about
   * seven minutes in, and until then the byte floors are what warn.
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
  const longestWindowMs = Math.max(...policy.windowsMs);
  const history: { atMs: number; bytes: number }[] = [];
  let raised: HeapPressureLevel = 'none';
  let pending: HeapPressureLevel = 'none';
  let streak = 0;

  return {
    sample(bytes, atMs) {
      const previous = history.at(-1);
      // A repeated or backwards timestamp would divide by zero or by a
      // negative; the sample is dropped rather than allowed to produce a rate.
      if (!previous || atMs > previous.atMs) history.push({ atMs, bytes });
      while (history.length > 1 && history[0]!.atMs < atMs - longestWindowMs * 2) {
        history.shift();
      }

      let bytesPerMinute: number | null = null;
      for (const windowMs of policy.windowsMs) {
        // A window with no sample old enough is not usable, and one whose base
        // is still inside the startup ramp is worse than unusable — it reports
        // the cost of launching the game as the cost of playing it.
        // Extrapolating either is how a young session invents a rate it never
        // saw.
        const base = [...history]
          .reverse()
          .find((entry) =>
            entry.atMs <= atMs - windowMs && entry.atMs >= policy.warmupMs);
        if (!base) continue;
        const elapsed = (atMs - base.atMs) / 60_000;
        if (elapsed <= 0) continue;
        const slope = Math.max(0, (bytes - base.bytes) / elapsed);
        bytesPerMinute = Math.max(bytesPerMinute ?? 0, slope);
      }
      if (
        bytesPerMinute !== null
        && bytesPerMinute < policy.minRateBytesPerMinute
      ) {
        bytesPerMinute = null;
      }

      const headroom = capBytes > 0 ? Math.max(0, capBytes - bytes) : null;
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
