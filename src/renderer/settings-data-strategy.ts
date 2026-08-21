/**
 * Settings data-strategy controller.
 * Owns source selection, cache/download progress, and launcher presentation.
 */
import type {
  AppSettings,
  CacheInfo,
  DownloadActivity,
  RendererSettingsPatch,
} from "../shared/contracts.js";
import type { RendererMilestone } from "../shared/diagnostics.js";
import { EtaDisplay } from "./progress-display.js";

type FeedbackTone = "neutral" | "progress" | "success" | "warning" | "error";

type DataStrategyDependencies = Readonly<{
  loadSettings: () => Promise<AppSettings>;
  persistSettings: (patch: RendererSettingsPatch) => Promise<AppSettings>;
  feedback: (message?: string, tone?: FeedbackTone, resetAfter?: number) => void;
  milestone: (name: RendererMilestone) => void;
  dialogOpen: () => boolean;
}>;

export type SettingsDataStrategy = Readonly<{
  refresh: () => Promise<CacheInfo>;
  renderSettings: (settings: AppSettings) => void;
  saveSelectedStrategy: () => Promise<void>;
  resolve: (snapshotBytes: number) => Promise<void>;
}>;

const size = (bytes: number) => bytes >= 1_073_741_824
  ? `${(bytes / 1_073_741_824).toFixed(2)} GB`
  : `${(bytes / 1_048_576).toFixed(bytes < 10_485_760 ? 1 : 0)} MB`;

export function bindSettingsDataStrategy(
  document: Document,
  dependencies: DataStrategyDependencies,
): SettingsDataStrategy {
  const byId = (id: string) => {
    const element = document.getElementById(id);
    if (!element) throw new Error(`missing renderer element: ${id}`);
    return element;
  };
  const form = byId("settings-form") as HTMLFormElement;
  const dialog = byId("settings-dialog") as HTMLDialogElement;
  const settingsDownload = byId("settings-download-full") as HTMLButtonElement;
  const settingsCache = byId("settings-cache");
  const settingsDataNote = byId("settings-data-note");
  const settingsProgress = byId("settings-progress");
  const settingsProgressFill = byId("settings-progress-fill");
  const dataChoice = byId("data-choice");
  const dataChoiceQuick = byId("data-choice-quick") as HTMLButtonElement;
  const dataChoiceFull = byId("data-choice-full") as HTMLButtonElement;
  const dataChoiceFullSize = byId("data-choice-full-size");
  const dataChoiceError = byId("data-choice-error");
  const dataDownload = byId("data-download");
  const dataDownloadStatus = byId("data-download-status");
  const dataDownloadDetail = byId("data-download-detail");
  const dataDownloadFill = byId("data-download-fill");
  const dataDownloadToggle = byId("data-download-toggle") as HTMLButtonElement;
  const dataDownloadPlay = byId("data-download-play") as HTMLButtonElement;
  const dataDownloadQuick = byId("data-download-quick") as HTMLButtonElement;
  const choiceAutoUpdates = byId("data-choice-auto-updates") as HTMLInputElement;

  let settings: AppSettings | null = null;
  let cache: CacheInfo | null = null;
  let fullDownload: Promise<boolean> | null = null;
  let phase: "idle" | "running" | "stopping" = "idle";
  let progress: DownloadActivity | null = null;
  let shownEtaMinutes: number | null = null;
  let downloadError = "";
  let launcherResolve: (() => void) | null = null;
  let launcherTotalBytes = 0;
  const etaMinutes = new EtaDisplay();
  const downloadActive = () => phase === "running" || phase === "stopping";

  function complete(value = cache): boolean {
    return !!value?.totalBytes && value.bytes >= value.totalBytes;
  }

  function cacheStatus(value: CacheInfo | null): string {
    if (!value?.totalBytes) return "Game data is still preparing…";
    if (complete(value)) return `Full game ready · ${size(value.bytes)} downloaded`;
    return `${size(value.bytes)} of ${size(value.totalBytes)} downloaded`;
  }

  function selectedStrategy(): "quick" | "full" | null {
    const selected = form.querySelector<HTMLInputElement>(
      'input[name="dataStrategy"]:checked',
    );
    return selected?.value === "quick" || selected?.value === "full"
      ? selected.value
      : null;
  }

  function renderSettingsData(value = cache): void {
    cache = value;
    settingsCache.textContent = cacheStatus(value);
    const strategy = settings?.dataStrategy ?? selectedStrategy();
    settingsDownload.hidden = strategy !== "full";
    const showBar = strategy === "full" && !!value?.totalBytes && !complete(value);
    settingsProgress.hidden = !showBar;
    if (showBar) {
      settingsProgressFill.style.width = `${Math.min(1, (value.bytes || 0) / value.totalBytes) * 100}%`;
    }

    if (strategy === null) {
      settingsDataNote.textContent = "Choose a mode here, or use the launcher choice on the next start.";
    } else if (strategy === "quick") {
      settingsDataNote.textContent = "Guild Wars will start normally and download areas when needed.";
    } else if (complete(value)) {
      settingsDataNote.textContent = "The full game is available locally. Future launches start normally.";
    } else {
      settingsDataNote.textContent = "The remaining data will download before Guild Wars starts next time.";
    }

    if (strategy !== "full") return;
    if (complete(value)) {
      settingsDownload.hidden = true;
    } else if (phase === "stopping") {
      settingsDownload.textContent = "Stopping Download…";
      settingsDownload.disabled = true;
    } else if (phase === "running") {
      settingsDownload.textContent = "Pause Download";
      settingsDownload.disabled = false;
    } else if (!value?.totalBytes) {
      settingsDownload.textContent = "Start Downloading Now";
      settingsDownload.disabled = true;
    } else {
      settingsDownload.textContent = "Start Downloading Now";
      settingsDownload.disabled = false;
    }
  }

  function renderLauncherDownload(value = cache, error = downloadError): void {
    cache = value;
    const total = value?.totalBytes || launcherTotalBytes;
    const received = value?.bytes || 0;
    const isComplete = total > 0 && received >= total;
    const ready = isComplete && !error;
    dataDownloadFill.style.width = `${(total > 0 ? Math.min(1, received / total) : 0) * 100}%`;

    if (error) {
      dataDownloadStatus.textContent = error;
      dataDownloadDetail.textContent = "Verified data is safe. Choose Resume Download to try again.";
    } else if (isComplete) {
      dataDownloadStatus.textContent = `Full game ready · ${size(received)} downloaded`;
      dataDownloadDetail.textContent = "Guild Wars will not start until you choose Play Guild Wars.";
    } else if (phase === "stopping") {
      dataDownloadStatus.textContent = `Pausing · ${cacheStatus(value)}`;
      dataDownloadDetail.textContent = "Verified data is being preserved.";
    } else if (phase === "running") {
      const rate = progress && progress.bytesPerSecond > 0
        ? ` · ${size(progress.bytesPerSecond)}/s avg`
        : "";
      const eta = progress && shownEtaMinutes !== null
        ? ` · about ${shownEtaMinutes} min left`
        : "";
      dataDownloadStatus.textContent = progress?.total
        ? `Downloading · ${size(received)} of ${size(total)}${rate}${eta}`
        : `Starting download · ${cacheStatus(value)}`;
      dataDownloadDetail.textContent = "Guild Wars has not started. You can pause or close the launcher and continue later.";
    } else {
      dataDownloadStatus.textContent = `Download paused · ${cacheStatus(value)}`;
      dataDownloadDetail.textContent = "You can resume now or close the launcher and continue later.";
    }

    dataDownloadToggle.hidden = ready;
    dataDownloadToggle.disabled = phase === "stopping";
    dataDownloadToggle.textContent = phase === "stopping"
      ? "Pausing…"
      : phase === "running" ? "Pause Download" : "Resume Download";
    dataDownloadPlay.textContent = ready ? "Play Guild Wars" : "Play While Downloading";
    dataDownloadQuick.hidden = ready;
  }

  async function refresh(): Promise<CacheInfo> {
    const value = await window.gwNative.cache.info();
    cache = value;
    renderSettingsData(value);
    if (!dataDownload.hidden) renderLauncherDownload(value);
    return value;
  }

  function startFullDownload(): Promise<boolean> {
    if (fullDownload) return fullDownload;
    downloadError = "";
    phase = "running";
    progress = null;
    renderSettingsData();
    if (!dataDownload.hidden) renderLauncherDownload();
    fullDownload = window.gwNative.cache.downloadAll()
      .then(async (outcome) => {
        downloadError = "";
        const value = await window.gwNative.cache.info();
        if (outcome.status === "failed") {
          const { describeDownloadFailure } = await import("./failure-messages.js");
          downloadError = describeDownloadFailure(
            outcome.errorCode,
            value.fullDownloadShortfall > 0
              ? { shortfall: size(value.fullDownloadShortfall) }
              : undefined,
          );
        }
        cache = value;
        renderSettingsData(value);
        if (!dataDownload.hidden) renderLauncherDownload(value);
        if (downloadError) {
          if (dependencies.dialogOpen()) dependencies.feedback(downloadError, "error");
          return false;
        }
        if (outcome.status === "stopped" && dependencies.dialogOpen()) {
          settingsCache.textContent = `Download paused · ${cacheStatus(value)}`;
        }
        return outcome.status === "complete";
      })
      .catch(() => {
        downloadError = "The full game download could not continue.";
        if (dependencies.dialogOpen()) dependencies.feedback(downloadError, "error");
        if (!dataDownload.hidden) renderLauncherDownload(cache, downloadError);
        return false;
      })
      .finally(async () => {
        phase = "idle";
        progress = null;
        fullDownload = null;
        await refresh().catch(() => {
          renderSettingsData(null);
          if (!dataDownload.hidden) {
            renderLauncherDownload(null, "The download status is unavailable.");
          }
        });
      });
    return fullDownload;
  }

  async function stopFullDownload(): Promise<void> {
    if (phase !== "running") return;
    phase = "stopping";
    renderSettingsData();
    if (!dataDownload.hidden) renderLauncherDownload();
    try {
      await window.gwNative.cache.stopDownload();
    } catch {
      phase = "running";
      dependencies.feedback("The download could not be paused. Check your connection and try again.", "error");
      renderSettingsData();
      if (!dataDownload.hidden) renderLauncherDownload(cache, "The download could not be paused.");
    }
  }

  function releaseGameBoot(reason: RendererMilestone): void {
    if (!launcherResolve) return;
    dataChoice.hidden = true;
    dataDownload.hidden = true;
    dependencies.milestone(reason);
    dependencies.milestone("launcher.bootReleased");
    const resolve = launcherResolve;
    launcherResolve = null;
    resolve();
  }

  function showChoice(value: CacheInfo, total: number): void {
    cache = value;
    launcherTotalBytes = total;
    const remaining = Math.max(0, total - (value.bytes || 0));
    choiceAutoUpdates.checked = settings?.autoCheckUpdates ?? true;
    const shortfall = value.fullDownloadShortfall || 0;
    dataChoiceFull.disabled = shortfall > 0;
    if (remaining <= 0) {
      dataChoiceFullSize.textContent = "The full game is already downloaded.";
    } else if (shortfall > 0) {
      dataChoiceFullSize.textContent = `Needs ${size(remaining)} — this disk has ${size(Math.max(0, value.freeBytes))} free. Free at least ${size(shortfall)} more.`;
    } else {
      const free = value.freeBytes >= 0 ? ` · ${size(value.freeBytes)} free on this Mac` : "";
      dataChoiceFullSize.textContent = `Download ${size(remaining)} first${free}. You can play while it downloads.`;
    }
    dataChoiceError.hidden = true;
    dataDownload.hidden = true;
    dataChoice.hidden = false;
    dependencies.milestone("launcher.choiceShown");
  }

  function showFullDownload(value: CacheInfo, total: number): void {
    cache = value;
    launcherTotalBytes = total;
    dataChoice.hidden = true;
    dataDownload.hidden = false;
    renderLauncherDownload(value);
    if (!complete({ ...value, totalBytes: total })) void startFullDownload();
  }

  async function resolve(snapshotBytes: number): Promise<void> {
    try {
      const [saved, value] = await Promise.all([
        dependencies.loadSettings(),
        window.gwNative.cache.info(),
      ]);
      settings = saved;
      const total = value.totalBytes || snapshotBytes;
      const resolved = { ...value, totalBytes: total };
      cache = resolved;
      launcherTotalBytes = total;
      if (!Number.isFinite(total) || total <= 0) return;
      if (saved.dataStrategy === "quick") return;
      if (saved.dataStrategy === "full" && value.bytes >= total && await startFullDownload()) {
        return;
      }
      return new Promise((done) => {
        launcherResolve = done;
        if (saved.dataStrategy === "full") showFullDownload(resolved, total);
        else showChoice(resolved, total);
      });
    } catch {
      window.gwLoading?.fail("Launcher settings could not be loaded.");
      return new Promise(() => {});
    }
  }

  function showChoiceError(): void {
    dataChoiceError.textContent = "Your choice could not be saved. Please try again.";
    dataChoiceError.hidden = false;
  }

  dataChoiceQuick.addEventListener("click", async () => {
    dataChoiceQuick.disabled = true;
    dataChoiceFull.disabled = true;
    dataChoiceError.hidden = true;
    try {
      settings = await dependencies.persistSettings({
        dataStrategy: "quick",
        autoCheckUpdates: choiceAutoUpdates.checked,
      });
      releaseGameBoot("launcher.quickSelected");
    } catch {
      showChoiceError();
    } finally {
      dataChoiceQuick.disabled = false;
      dataChoiceFull.disabled = false;
    }
  });

  dataChoiceFull.addEventListener("click", async () => {
    dataChoiceQuick.disabled = true;
    dataChoiceFull.disabled = true;
    dataChoiceError.hidden = true;
    try {
      settings = await dependencies.persistSettings({
        dataStrategy: "full",
        autoCheckUpdates: choiceAutoUpdates.checked,
      });
      if (!cache) throw new Error("download status is not ready");
      dependencies.milestone("launcher.fullSelected");
      showFullDownload(cache, launcherTotalBytes);
    } catch {
      showChoiceError();
    } finally {
      dataChoiceQuick.disabled = false;
      dataChoiceFull.disabled = false;
    }
  });

  dataDownloadToggle.addEventListener("click", () => {
    if (downloadActive()) void stopFullDownload();
    else void startFullDownload();
  });
  dataDownloadPlay.addEventListener("click", () => {
    if (!complete()) void startFullDownload();
    releaseGameBoot("launcher.playNowSelected");
  });
  dataDownloadQuick.addEventListener("click", async () => {
    dataDownloadQuick.disabled = true;
    try {
      if (downloadActive()) await stopFullDownload();
      settings = await dependencies.persistSettings({ dataStrategy: "quick" });
      releaseGameBoot("launcher.quickSelected");
    } catch {
      renderLauncherDownload(cache, "Quick Start could not be saved.");
    } finally {
      dataDownloadQuick.disabled = false;
    }
  });

  settingsDownload.addEventListener("click", () => {
    dependencies.feedback();
    if (downloadActive()) void stopFullDownload();
    else void startFullDownload();
  });

  window.gwNative.progress.onChange((next) => {
    if (next.phase === "ready" && !downloadActive()) {
      void refresh().catch(() => {});
      return;
    }
    if (next.phase !== "image" || !fullDownload || phase !== "running") return;
    progress = next;
    shownEtaMinutes = etaMinutes.update(next.secondsRemaining);
    const value = {
      chunks: cache?.chunks ?? 0,
      totalChunks: cache?.totalChunks ?? 0,
      bytes: Number.isFinite(next.received)
        ? Math.max(next.received, cache?.bytes || 0)
        : cache?.bytes || 0,
      totalBytes: next.total || cache?.totalBytes || launcherTotalBytes || 0,
      freeBytes: cache?.freeBytes ?? -1,
      fullDownloadShortfall: cache?.fullDownloadShortfall ?? 0,
    };
    cache = value;
    renderSettingsData(value);
    renderLauncherDownload(value);
    if (dialog.open) {
      settingsCache.textContent = next.total
        ? dataDownloadStatus.textContent
        : "Preparing full game download…";
    }
  });

  window.gwNative.progress.onPrefetch((next) => {
    if (
      !dialog.open
      || downloadActive()
      || !next?.totalChunks
      || next.completedChunks >= next.totalChunks
    ) return;
    settingsCache.textContent = "Caching recently used areas in the background…";
  });

  function renderSettings(saved: AppSettings): void {
    settings = saved;
    for (const radio of form.querySelectorAll<HTMLInputElement>('input[name="dataStrategy"]')) {
      radio.checked = radio.value === saved.dataStrategy;
    }
    renderSettingsData();
  }

  async function saveSelectedStrategy(): Promise<void> {
    const next = selectedStrategy();
    dependencies.feedback("Saving…", "progress");
    try {
      settings = await dependencies.persistSettings({ dataStrategy: next });
      if (next === "quick" && downloadActive()) await stopFullDownload();
      renderSettingsData();
      dependencies.feedback(
        next === "full"
          ? "Saved. Full Game will download before Guild Wars starts next time."
          : "Saved. Quick Start will be used next time; downloaded data is kept.",
        "success",
        4500,
      );
    } catch {
      settings = await dependencies.loadSettings().catch(() => null);
      if (settings) renderSettings(settings);
      else {
        for (const radio of form.querySelectorAll<HTMLInputElement>('input[name="dataStrategy"]')) {
          radio.checked = false;
        }
      }
      dependencies.feedback(
        settings
          ? "Close and reopen Settings to confirm which download mode is active before retrying."
          : "GWonMac could not confirm the active download mode. Close and reopen Settings before retrying.",
        "error",
      );
    }
  }

  return { refresh, renderSettings, saveSelectedStrategy, resolve };
}
