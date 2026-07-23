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

export function rateBytesPerSecond(
  received: number,
  startedAtMs: number,
  nowMs = Date.now(),
  minElapsedMs = 500,
): number {
  const elapsedMs = nowMs - startedAtMs;
  if (elapsedMs < minElapsedMs || received <= 0) return 0;
  return received / (elapsedMs / 1000);
}

/** Alias used by core patch/chunk services. */
export function bytesPerSecond(
  received: number,
  startedAtMs: number,
  nowMs = Date.now(),
  minElapsedMs = 500,
): number {
  return rateBytesPerSecond(received, startedAtMs, nowMs, minElapsedMs);
}

export function secondsRemaining(
  received: number,
  total: number,
  bytesPerSecond: number,
): number | null {
  if (total <= 0 || bytesPerSecond <= 0 || received >= total) return null;
  return (total - received) / bytesPerSecond;
}

export function withProgressRates(
  value: Omit<DownloadProgress, "bytesPerSecond" | "secondsRemaining"> & {
    bytesPerSecond?: number;
    secondsRemaining?: number | null;
  },
  startedAtMs: number,
  nowMs = Date.now(),
): DownloadProgress {
  const bytesPerSecond =
    value.bytesPerSecond ?? rateBytesPerSecond(value.received, startedAtMs, nowMs);
  return {
    ...value,
    bytesPerSecond,
    secondsRemaining:
      value.secondsRemaining ??
      secondsRemaining(value.received, value.total, bytesPerSecond),
  };
}
