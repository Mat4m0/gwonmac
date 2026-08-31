import type { AppUpdateState, CacheInfo, DownloadActivity } from "@shared/contracts";
import type { LauncherProfileSummary, LauncherReadiness } from "@shared/launcher-contracts";

export function profileStatus(profile: LauncherProfileSummary): string {
  switch (profile.state) {
    case "queued": return "Waiting for game files";
    case "opening": return "Opening";
    case "checking": return "Checking the game window";
    case "running": return "Open";
    case "failed": return profileFailure(profile.failure);
    case "ready": return "Ready";
  }
}

function profileFailure(failure: LauncherProfileSummary["failure"]): string {
  switch (failure) {
    case "profile-preparation": return "Account files could not be prepared";
    case "window-startup": return "Game window did not open";
    case "client-validation": return "Game client check failed";
    case "renderer-crash": return "Game window closed unexpectedly";
    default: return "Could not open this account";
  }
}

export function launchLabel(profiles: readonly LauncherProfileSummary[], readiness: LauncherReadiness): string {
  if (readiness.state === "repair-required") return "Open Game Files";
  if (profiles.some((profile) => profile.state === "queued")) return "Cancel waiting";
  if (profiles.some((profile) => profile.state === "checking")) {
    return profiles.length === 1 ? "Checking game window…" : "Checking game windows…";
  }
  if (profiles.some((profile) => profile.state === "opening")) {
    return profiles.length === 1 ? "Opening account…" : "Opening accounts…";
  }
  const closed = profiles.filter((profile) => profile.state !== "running");
  if (closed.length === 0) return profiles.length === 1 ? "Show" : "Accounts are open";
  return closed.length === 1 ? "Play" : `Open ${closed.length} accounts`;
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 MB";
  const units = ["B", "KB", "MB", "GB", "TB"] as const;
  const unit = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / 1024 ** unit;
  return `${value >= 10 || unit < 2 ? value.toFixed(0) : value.toFixed(1)} ${units[unit]}`;
}

export function formatProgress(progress: DownloadActivity): string {
  const amount = progress.total > 0
    ? `${formatBytes(progress.received)} of ${formatBytes(progress.total)}`
    : formatBytes(progress.received);
  const speed = progress.bytesPerSecond > 0 ? ` · ${formatBytes(progress.bytesPerSecond)}/s` : "";
  const eta = progress.secondsRemaining === null ? "" : ` · ${formatDuration(progress.secondsRemaining)} left`;
  return `${amount}${speed}${eta}`;
}

function formatDuration(seconds: number): string {
  if (seconds < 60) return "less than a minute";
  const minutes = Math.ceil(seconds / 60);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return remainder === 0 ? `${hours} hr` : `${hours} hr ${remainder} min`;
}

export function cacheSummary(info: CacheInfo): string {
  if (info.totalBytes <= 0) return `${formatBytes(info.bytes)} verified`;
  return `${formatBytes(info.bytes)} of ${formatBytes(info.totalBytes)} verified`;
}

export function updateStatus(update: AppUpdateState): { title: string; detail: string } {
  switch (update.phase) {
    case "checking": return { title: "Checking for updates…", detail: `Installed version ${update.currentVersion}` };
    case "up-to-date": return { title: "Guild Wars Reforged is up to date", detail: `Version ${update.currentVersion}` };
    case "downloading": return { title: `Downloading version ${update.latestVersion}…`, detail: `Installed version ${update.currentVersion}` };
    case "ready": return { title: `Version ${update.latestVersion} is ready`, detail: "Restart when you are finished playing." };
    case "manual-stable-return": return { title: "Stable requires a manual download", detail: `Stable version ${update.stableVersion}` };
    case "failed": return { title: "Could not check for updates", detail: "Try again when you are online." };
    case "idle": return { title: "Application updates", detail: `Installed version ${update.currentVersion}` };
  }
}
