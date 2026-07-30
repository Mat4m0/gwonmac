import type {
  DownloadActivity,
  DownloadProgress,
  PrefetchProgress,
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

export const EMPTY_PREFETCH: PrefetchProgress = {
  completedChunks: 0,
  totalChunks: 0,
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

/**
 * The stable minutes-remaining readout behind "6 min remaining". The
 * estimate derives from the already-smoothed rate, so its residual jitter is
 * a few percent — but near a minute boundary that still flips a ceil()ed
 * display back and forth on every progress event. The shown minute covers
 * ((m − 1) · 60, m · 60] and moves only once the estimate leaves that band by
 * half a minute; jitter cannot cross the band, a genuine change re-anchors
 * in one step, and no second smoothing layer adds lag.
 */
export class EtaDisplay {
  private shownMinutes: number | null = null;

  update(secondsRemaining: number | null): number | null {
    if (secondsRemaining === null || !Number.isFinite(secondsRemaining)) {
      this.shownMinutes = null;
      return null;
    }
    const shown = this.shownMinutes;
    if (
      shown === null ||
      secondsRemaining > shown * 60 + 30 ||
      secondsRemaining < (shown - 1) * 60 - 30
    ) {
      this.shownMinutes = Math.max(1, Math.ceil(secondsRemaining / 60));
    }
    return this.shownMinutes;
  }
}

const bytesText = (n: number) =>
  n >= 1e9
    ? (n / 1e9).toFixed(2) + " GB"
    : (n / 1e6).toFixed(n < 1e7 ? 1 : 0) + " MB";

/**
 * The loading screen's "112 MB of 3.2 GB · 0.9 MB/s avg · 6 min remaining"
 * line. Progress arrives on every chunk completion, in bursts, and a line
 * rewritten that often flickers, so numeric churn commits at most once a
 * second. An event that clears the rate or the estimate renders immediately:
 * PatchClient emits one right before file assembly, a stretch with no
 * further events, and throttling it would freeze the old speed on screen for
 * the whole stretch.
 */
export class DownloadDetailLine {
  private readonly eta = new EtaDisplay();
  private shownAtMs = 0;
  private shown = "";

  update(
    p: Pick<
      DownloadActivity,
      "received" | "total" | "bytesPerSecond" | "secondsRemaining"
    >,
    nowMs = Date.now(),
  ): string {
    const minutes = this.eta.update(p.secondsRemaining);
    const clearing = p.bytesPerSecond <= 0 || minutes === null;
    if (this.shown && !clearing && nowMs - this.shownAtMs < 1_000) {
      return this.shown;
    }
    this.shownAtMs = nowMs;
    this.shown = [
      p.total ? `${bytesText(p.received)} of ${bytesText(p.total)}` : "",
      p.bytesPerSecond > 0
        ? `${(p.bytesPerSecond / 1e6).toFixed(1)} MB/s avg`
        : "",
      minutes !== null ? `${minutes} min remaining` : "",
    ]
      .filter(Boolean)
      .join(" · ");
    return this.shown;
  }
}
