/**
 * Settings projection for the automatic complete-game download.
 * ClientRuntime owns execution and state; this module only renders its
 * progress and sends explicit Pause/Resume commands.
 */
import type {
  CacheInfo,
  DownloadActivity,
  DownloadProgress,
  FullDownloadState,
} from "../shared/contracts.js";
import { describeDownloadFailure } from "./failure-messages.js";
import { EtaDisplay } from "./progress-display.js";

type FeedbackTone = "neutral" | "progress" | "success" | "warning" | "error";

type GameDataDependencies = Readonly<{
  feedback: (message?: string, tone?: FeedbackTone, resetAfter?: number) => void;
}>;

export type GameDataController = Readonly<{
  refresh: () => Promise<CacheInfo>;
  renderSettings: () => void;
}>;

const size = (bytes: number) => bytes >= 1_073_741_824
  ? `${(bytes / 1_073_741_824).toFixed(2)} GB`
  : `${(bytes / 1_048_576).toFixed(bytes < 10_485_760 ? 1 : 0)} MB`;

function downloadState(progress: DownloadProgress | null): FullDownloadState | null {
  if (!progress || progress.phase === "error") return null;
  if (progress.fullDownload) return progress.fullDownload;
  return progress.phase === "image" ? { status: "running" } : null;
}

export function bindGameDataController(
  document: Document,
  dependencies: GameDataDependencies,
): GameDataController {
  const byId = (id: string) => {
    const element = document.getElementById(id);
    if (!element) throw new Error(`missing renderer element: ${id}`);
    return element;
  };
  const settingsDownload = byId("settings-download-full") as HTMLButtonElement;
  const settingsCache = byId("settings-cache");
  const settingsDataNote = byId("settings-data-note");
  const settingsProgress = byId("settings-progress");
  const settingsProgressFill = byId("settings-progress-fill");

  let cache: CacheInfo | null = null;
  let progress: DownloadProgress | null = null;
  let shownEtaMinutes: number | null = null;
  const etaMinutes = new EtaDisplay();

  function activeProgress(): DownloadActivity | null {
    return progress?.phase === "image" ? progress : null;
  }

  function totalBytes(): number {
    return activeProgress()?.total || cache?.totalBytes || 0;
  }

  function receivedBytes(): number {
    return activeProgress()?.received ?? cache?.bytes ?? 0;
  }

  function complete(): boolean {
    const total = totalBytes();
    return total > 0 && receivedBytes() >= total;
  }

  function cacheStatus(): string {
    const total = totalBytes();
    const received = receivedBytes();
    if (!total) return "Game data is still preparing…";
    if (complete()) return `Complete game ready · ${size(received)} downloaded`;
    return `${size(received)} of ${size(total)} downloaded`;
  }

  function renderSettings(): void {
    const state = downloadState(progress);
    const running = activeProgress();
    const total = totalBytes();
    const received = receivedBytes();
    const ready = complete() || state?.status === "complete";
    settingsProgress.hidden = !total || ready;
    if (total && !ready) {
      settingsProgressFill.style.width = `${Math.min(1, received / total) * 100}%`;
    }

    if (state?.status === "failed") {
      settingsCache.textContent = describeDownloadFailure(
        state.errorCode,
        cache && cache.fullDownloadShortfall > 0
          ? { shortfall: size(cache.fullDownloadShortfall) }
          : undefined,
      );
      settingsDataNote.textContent = "Downloaded data is safe. Resume when you are ready to try again.";
    } else if (ready) {
      settingsCache.textContent = cacheStatus();
      settingsDataNote.textContent = "Future launches only download game updates and repair damaged data.";
    } else if (state?.status === "stopping") {
      settingsCache.textContent = `Pausing · ${cacheStatus()}`;
      settingsDataNote.textContent = "Verified data is being preserved.";
    } else if (state?.status === "running" && running) {
      const rate = running.bytesPerSecond > 0
        ? ` · ${size(running.bytesPerSecond)}/s avg`
        : "";
      const eta = shownEtaMinutes !== null
        ? ` · about ${shownEtaMinutes} min left`
        : "";
      settingsCache.textContent = running.total
        ? `Downloading · ${size(received)} of ${size(total)}${rate}${eta}`
        : `Starting download · ${cacheStatus()}`;
      settingsDataNote.textContent = "You can keep playing or close the app and continue later.";
    } else if (total) {
      settingsCache.textContent = `Download paused · ${cacheStatus()}`;
      settingsDataNote.textContent = "Resume to continue downloading the complete game.";
    } else {
      settingsCache.textContent = cacheStatus();
      settingsDataNote.textContent = "The download starts automatically when the game data is ready.";
    }

    settingsDownload.hidden = ready;
    settingsDownload.disabled = !total || state?.status === "stopping";
    settingsDownload.textContent = state?.status === "stopping"
      ? "Pausing…"
      : state?.status === "running" ? "Pause Download" : "Resume Download";
  }

  async function refresh(): Promise<CacheInfo> {
    const [nextCache, nextProgress] = await Promise.all([
      window.gwNative.cache.info(),
      window.gwNative.progress.current(),
    ]);
    cache = nextCache;
    progress = nextProgress;
    if (nextProgress.phase === "image") {
      shownEtaMinutes = etaMinutes.update(nextProgress.secondsRemaining);
    }
    renderSettings();
    return nextCache;
  }

  settingsDownload.addEventListener("click", () => {
    dependencies.feedback();
    const state = downloadState(progress);
    const action = state?.status === "running"
      ? window.gwNative.cache.stopDownload()
      : window.gwNative.cache.downloadAll().then(() => undefined);
    void action.catch(() => {
      dependencies.feedback(
        state?.status === "running"
          ? "The download could not be paused. Check your connection and try again."
          : "The download could not be resumed. Check your connection and try again.",
        "error",
      );
    });
  });

  window.gwNative.progress.onChange((next) => {
    progress = next;
    if (next.phase === "image") {
      shownEtaMinutes = etaMinutes.update(next.secondsRemaining);
      renderSettings();
      return;
    }
    void refresh().catch(() => renderSettings());
  });
  void window.gwNative.progress.current().then((next) => {
    progress = next;
    renderSettings();
  }).catch(() => {});

  return { refresh, renderSettings };
}
