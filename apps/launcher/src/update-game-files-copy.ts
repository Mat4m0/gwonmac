import type { AppUpdateState } from "@shared/contracts";
import type { ErrorCode } from "@shared/errors";
import type { LauncherBackgroundDownload, LauncherReadiness } from "@shared/launcher-contracts";

export type ApplicationUpdateAction = "check" | "releases" | "restart" | "none";

export interface ApplicationUpdatePresentation {
  readonly title: string;
  readonly detail: string;
  readonly action: ApplicationUpdateAction;
  readonly actionLabel?: string;
}

export function applicationUpdatePresentation(
  update: AppUpdateState,
): ApplicationUpdatePresentation {
  switch (update.phase) {
    case "managed":
      return {
        title: "Launcher updates",
        detail: `Version ${update.currentVersion}. Updates are installed by your software center.`,
        action: "none",
      };
    case "checking":
      return {
        title: "Checking for launcher updates…",
        detail: `Installed version ${update.currentVersion}`,
        action: "none",
      };
    case "up-to-date":
      return {
        title: "The launcher is up to date",
        detail: `Version ${update.currentVersion}`,
        action: "check",
        actionLabel: "Check now",
      };
    case "downloading":
      return {
        title: `Downloading launcher version ${update.latestVersion}…`,
        detail: "You can keep using the launcher while it downloads.",
        action: "none",
      };
    case "ready":
      return {
        title: `Launcher version ${update.latestVersion} is ready`,
        detail: "Restart when you are finished playing.",
        action: "restart",
        actionLabel: "Restart and update",
      };
    case "manual-stable-return":
      return {
        title: "Stable needs a manual install",
        detail: `Download Stable version ${update.stableVersion} from Releases. Your accounts and game files stay in place.`,
        action: "releases",
        actionLabel: "Open Releases",
      };
    case "failed":
      return failedApplicationUpdate(update.currentVersion, update.reason);
    case "idle":
      return {
        title: "Launcher updates",
        detail: `Installed version ${update.currentVersion}`,
        action: "check",
        actionLabel: "Check now",
      };
  }
}

function failedApplicationUpdate(
  currentVersion: string,
  reason: Extract<AppUpdateState, { phase: "failed" }>["reason"],
): ApplicationUpdatePresentation {
  if (reason === "unsupported-build" || reason === "updater-unavailable") {
    return {
      title: "This build cannot update itself",
      detail: `Version ${currentVersion} is installed. Download a published version from Releases to update manually.`,
      action: "releases",
      actionLabel: "Open Releases",
    };
  }
  if (reason === "rate-limited") {
    return {
      title: "Update check paused",
      detail: "The update service asked us to wait. Try again in a few minutes.",
      action: "check",
      actionLabel: "Try again",
    };
  }
  if (reason === "offline" || reason === "timeout") {
    return {
      title: "Could not check for launcher updates",
      detail: "Check your internet connection, then try again.",
      action: "check",
      actionLabel: "Try again",
    };
  }
  if (reason === "download-failed") {
    return {
      title: "The launcher update did not finish",
      detail: "Your installed version is unchanged. Check again to retry the download.",
      action: "check",
      actionLabel: "Check again",
    };
  }
  return {
    title: "Could not verify launcher updates",
    detail: "The update service returned an unexpected response. Try again later.",
    action: "check",
    actionLabel: "Try again",
  };
}

const DOWNLOAD_FAILURE: Partial<Record<ErrorCode, string>> = {
  disk_full: "There is not enough free space to finish downloading. Free some space, then try again.",
  net_offline: "The download stopped because this computer is offline. Reconnect, then try again.",
  dns_timeout: "The download could not reach ArenaNet. Check your connection, then try again.",
  http_status: "ArenaNet could not serve a game file. This is usually temporary; try again in a few minutes.",
};

export function backgroundDownloadFailure(reason: ErrorCode): string {
  return DOWNLOAD_FAILURE[reason]
    ?? "The background download stopped. Verified files were kept, so you can try again without starting over.";
}

const REPAIR_REASON: Partial<Record<ErrorCode, string>> = {
  disk_full: "There is not enough free space to prepare Guild Wars. Free some space, then repair the game files.",
  net_offline: "This computer is offline and no usable game client is available. Reconnect, then repair the game files.",
  dns_timeout: "ArenaNet could not be reached. Check your connection, then repair the game files.",
  http_status: "ArenaNet could not provide the required game files. Try the repair again in a few minutes.",
  artifact_unverified: "A downloaded game file did not pass verification. Repair will download a clean copy.",
  hash_mismatch: "A downloaded game file did not pass verification. Repair will download a clean copy.",
};

export function repairReason(reason: ErrorCode): string {
  return REPAIR_REASON[reason]
    ?? "Guild Wars cannot start with the current game files. Repair will verify them and download anything missing.";
}

export function backgroundDownloadPresentation(
  download: LauncherBackgroundDownload,
): { readonly title: string; readonly detail: string } | null {
  switch (download.status) {
    case "running": {
      const percent = download.total > 0
        ? `${Math.min(100, Math.round((download.received / download.total) * 100))}% complete. `
        : "";
      return {
        title: "Downloading game files",
        detail: `${percent}You can play while this downloads.`,
      };
    }
    case "stopping":
      return { title: "Pausing game file download", detail: "You can keep playing." };
    case "paused":
      return {
        title: "Game file download paused",
        detail: "You can play now and resume the offline files when you are ready.",
      };
    case "failed":
      return { title: "Game file download stopped", detail: backgroundDownloadFailure(download.errorCode) };
    case "complete":
      return null;
  }
}

export function playableNoticePresentation(
  readiness: LauncherReadiness,
): { readonly title: string; readonly detail: string } | null {
  if (readiness.state !== "playable") return null;
  switch (readiness.notice) {
    case "rejected-candidate-fallback":
      return {
        title: "Using the previous game client",
        detail: "A newer client did not start correctly. Your existing verified client is ready to play.",
      };
    case "update-failed-previous-restored":
      return {
        title: "The game update did not finish",
        detail: "Your existing verified client is ready. The update will retry next launch.",
      };
    case "interrupted-update-retryable":
      return {
        title: "The game update will continue later",
        detail: "Your existing verified client is ready. The interrupted update will retry next launch.",
      };
    default:
      return null;
  }
}
