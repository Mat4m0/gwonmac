import type { DownloadProgress, PrefetchProgress } from "./contracts.js";

export const INITIAL_PROGRESS: DownloadProgress = {
  phase: "starting",
  label: "Checking the game client",
  received: 0,
  total: 0,
  bytesPerSecond: 0,
  secondsRemaining: null,
  error: null,
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
 */
export class DownloadRateAverage {
  private readonly startedAtMs: number;
  private readonly startedBytes: number;
  private lastAtMs: number;
  private lastBytes: number;
  private average = 0;
  private readonly warmupMs: number;
  private readonly smoothingMs: number;

  constructor(
    startedBytes = 0,
    startedAtMs = Date.now(),
    warmupMs = 1_500,
    smoothingMs = 5_000,
  ) {
    this.startedBytes = startedBytes;
    this.startedAtMs = startedAtMs;
    this.lastBytes = startedBytes;
    this.lastAtMs = startedAtMs;
    this.warmupMs = warmupMs;
    this.smoothingMs = smoothingMs;
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
    if (intervalMs <= 0 || intervalBytes <= 0) return this.average;
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
