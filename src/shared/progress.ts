/**
 * The shape of download progress and the arithmetic every surface derives from
 * it: the initial value, the estimate, and the smoothed rate.
 *
 * A rate is computed once, here, so the launcher, the Dock and the diagnostics
 * gauges cannot disagree about how fast a download is going. Chunk completions
 * arrive in bursts, so the average is time-weighted and samples are committed
 * at most twice a second — an instantaneous rate over a millisecond interval is
 * an arithmetically correct number that tells the player nothing true.
 *
 * Nothing here formats a sentence or knows what a phase is called on screen.
 */
import type {
  DownloadActivity,
  DownloadProgress,
} from "./contracts.js";

/** Never a failure, so it is typed as the activity it is: spreading a
 * union would make every derived literal a union too. */
export const INITIAL_PROGRESS: DownloadActivity = {
  phase: "starting",
  label: "Checking the game client",
  received: 0,
  total: 0,
  bytesPerSecond: 0,
  secondsRemaining: null,
};

export function longRunningTaskFeedback(value: DownloadProgress): {
  preventAppSuspension: boolean;
  dockProgress: number;
} {
  if (value.phase !== "image") {
    return { preventAppSuspension: false, dockProgress: -1 };
  }
  return {
    preventAppSuspension: true,
    dockProgress:
      value.total > 0
        ? Math.min(1, Math.max(0, value.received / value.total))
        : 2,
  };
}

export function secondsRemaining(
  received: number,
  total: number,
  bytesPerSecond: number,
): number | null {
  if (total <= 0 || bytesPerSecond <= 0 || received >= total) return null;
  return (total - received) / bytesPerSecond;
}

/**
 * A time-weighted download average. Chunk completions arrive in bursts, so
 * displaying their instantaneous rate makes the number jump even when the
 * connection is steady. The warm-up avoids publishing a misleading first
 * sample; the five-second time constant then follows real changes gradually.
 * Samples commit at most twice a second: a burst of completions milliseconds
 * apart would otherwise enter the average as a series of absurd
 * chunk-per-millisecond rates instead of one honest interval.
 */
export class DownloadRateAverage {
  private readonly startedAtMs: number;
  private readonly startedBytes: number;
  private lastAtMs: number;
  private lastBytes: number;
  private average = 0;
  private readonly warmupMs: number;
  private readonly smoothingMs: number;
  private readonly minSampleMs: number;

  constructor(
    startedBytes = 0,
    startedAtMs = Date.now(),
    warmupMs = 1_500,
    smoothingMs = 5_000,
    minSampleMs = 500,
  ) {
    this.startedBytes = startedBytes;
    this.startedAtMs = startedAtMs;
    this.lastBytes = startedBytes;
    this.lastAtMs = startedAtMs;
    this.warmupMs = warmupMs;
    this.smoothingMs = smoothingMs;
    this.minSampleMs = minSampleMs;
  }

  update(received: number, nowMs = Date.now()): number {
    if (
      !Number.isFinite(received) ||
      !Number.isFinite(nowMs) ||
      received < this.lastBytes ||
      nowMs < this.lastAtMs
    ) {
      return this.average;
    }

    const elapsedMs = nowMs - this.startedAtMs;
    const intervalMs = nowMs - this.lastAtMs;
    const intervalBytes = received - this.lastBytes;
    if (intervalMs <= 0 || intervalMs < this.minSampleMs || intervalBytes <= 0) {
      // Deferred, not dropped: the bytes stay uncommitted and fold into the
      // next accepted sample's interval.
      return this.average;
    }
    this.lastAtMs = nowMs;
    this.lastBytes = received;

    if (elapsedMs < this.warmupMs) return 0;
    if (this.average === 0) {
      this.average =
        ((received - this.startedBytes) * 1_000) / Math.max(1, elapsedMs);
      return this.average;
    }
    const instantaneous = (intervalBytes * 1_000) / intervalMs;
    const weight = 1 - Math.exp(-intervalMs / this.smoothingMs);
    this.average += weight * (instantaneous - this.average);
    return this.average;
  }
}
