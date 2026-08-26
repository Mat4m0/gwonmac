/**
 * Settings-screen actions whose meaning is larger than one settings-file
 * read or write.
 *
 * IPC owns sender validation and parsing. This module owns the confirmation,
 * durable boundary, and relaunch ordering: a refusal writes nothing, and once
 * a settings value or reset marker is durable, a failed relaunch cannot turn
 * that completed write into a false failure response.
 */
import { app, dialog, session, type Session } from "electron";
import type { BrowserWindow } from "electron";
import { rm, stat, writeFile } from "node:fs/promises";
import type {
  AppSettings,
  AppSettingsPatch,
  RendererSettingsPatch,
  SettingsResetOutcome,
} from "../shared/contracts.js";
import { errorCode } from "../shared/errors.js";
import { logEvent } from "./diagnostics.js";
import type { GamePaths } from "./paths.js";
import { resetGameInput } from "./renderer-commands.js";
import { resetWindowState } from "./window.js";
import { windowRegistry } from "./window-registry.js";

type RelaunchAction = "capabilityEnable" | "capabilityUnload" | "cacheClear" | "gameStorageReset";

async function confirmAction(
  win: BrowserWindow,
  copy: {
    readonly confirmLabel: string;
    readonly message: string;
    readonly detail: string;
  },
): Promise<boolean> {
  await resetGameInput(win);
  const { response } = await dialog.showMessageBox(win, {
    type: "warning",
    buttons: [copy.confirmLabel, "Cancel"],
    defaultId: 1,
    cancelId: 1,
    message: copy.message,
    detail: copy.detail,
  });
  return response === 0;
}

export async function requestToolsUnloadRestart(win: BrowserWindow): Promise<boolean> {
  if (!(await confirmAction(win, {
    confirmLabel: "Restart GWonMac",
    message: "Restart to unload Tools Beta?",
    detail:
      "This closes Guild Wars. GWonMac will reopen in Core mode without optional Tools code loaded.",
  }))) return false;
  requestRelaunch(win, "capabilityUnload");
  return true;
}

/** The durable action already succeeded; relaunch failure cannot undo it. */
function requestRelaunch(win: BrowserWindow, action: RelaunchAction): void {
  try {
    app.relaunch();
    app.quit();
  } catch (error) {
    logEvent({ k: "app.relaunchFailed", action, code: errorCode(error) });
    // Keep the successful durable result, but do not tell the player a restart
    // happened when Electron refused it. This stays native because the failure
    // occurs after the IPC result is already determined and applies equally to
    // settings, cache, and game-storage actions.
    try {
      void dialog.showMessageBox(win, {
        type: "warning",
        buttons: ["OK"],
        defaultId: 0,
        cancelId: 0,
        message: "Restart did not start",
        detail:
          "Your change is saved. Quit and reopen GWonMac to apply it.",
      }).catch(() => {});
    } catch {
      // A warning failure must not turn the already-durable action into a
      // rejected settings response.
    }
  }
}

export async function applySettingsChange(
  win: BrowserWindow,
  patch: RendererSettingsPatch,
  toolsEnabledAtLaunch: boolean,
  read: () => Promise<AppSettings>,
  write: (patch: AppSettingsPatch) => Promise<AppSettings>,
): Promise<AppSettings> {
  try {
    const previous = await read();
    const restartForCapability = patch.gwonmacTools === true
      && !toolsEnabledAtLaunch;
    if (
      restartForCapability
      && !(await confirmAction(win, {
        confirmLabel: "Enable and Restart",
        message: "Restart to enable Tools Beta?",
        detail:
          "GWonMac prepares every certified Tools capability together. Restart once to use the saved change. This closes Guild Wars if it is running.",
      }))
    ) {
      return previous;
    }
    const saved = await write(patch);
    if (restartForCapability) requestRelaunch(win, "capabilityEnable");
    return saved;
  } catch (error) {
    logEvent({ k: "settings.saveFailed", code: errorCode(error) });
    throw error;
  }
}

export async function confirmSettingsReset(
  win: BrowserWindow,
  reset: () => Promise<SettingsResetOutcome>,
): Promise<SettingsResetOutcome | null> {
  const ownerId = windowRegistry.requireDiagnosticOwnerForWindow(win);
  if (
    !(await confirmAction(win, {
      confirmLabel: "Reset GWonMac Settings",
      message: "Reset GWonMac settings?",
      detail:
        "Display, tools, Travel shortcuts, custom search phrases, window size and position, and diagnostics return to their defaults. Downloaded game data and your saved login stay untouched.",
    }))
  ) {
    return null;
  }
  try {
    const outcome = await reset();
    try {
      await resetWindowState(win);
    } catch {
      // The settings document is already durable. Window geometry is a
      // separate document and cannot roll that result back.
      logEvent({ k: "window.stateResetFailed" }, ownerId);
    }
    if (outcome.status === "complete") logEvent({ k: "settings.reset" });
    return outcome;
  } catch (error) {
    logEvent({ k: "settings.resetFailed", code: errorCode(error) });
    throw error;
  }
}

export async function requestCacheClear(
  win: BrowserWindow,
  markerPath: string,
): Promise<boolean> {
  if (
    !(await confirmAction(win, {
      confirmLabel: "Clear and Restart",
      message: "Clear downloaded game data?",
      detail:
        "The app will restart. Client files stay installed, but game data will download again.",
    }))
  ) {
    return false;
  }
  try {
    await writeFile(markerPath, "", { mode: 0o600 });
  } catch (error) {
    logEvent({ k: "cache.clearRequestFailed", code: errorCode(error) });
    throw error;
  }
  logEvent({ k: "cache.clearRequested" });
  requestRelaunch(win, "cacheClear");
  return true;
}

export async function requestGameStorageReset(
  win: BrowserWindow,
  markerPath: string,
): Promise<boolean> {
  const ownerId = windowRegistry.requireDiagnosticOwnerForWindow(win);
  if (
    !(await confirmAction(win, {
      confirmLabel: "Reset and Restart",
      message: "Reset saved Guild Wars files?",
      detail:
        "This removes local Guild Wars settings, build templates, screenshots, and chat logs. Downloaded game data and your saved login stay untouched.",
    }))
  ) {
    return false;
  }
  try {
    await writeFile(markerPath, "", { mode: 0o600 });
  } catch (error) {
    logEvent(
      { k: "filesystem.resetFailed", code: errorCode(error) },
      ownerId,
    );
    throw error;
  }
  logEvent({ k: "filesystem.resetRequested" }, ownerId);
  requestRelaunch(win, "gameStorageReset");
  return true;
}

async function pendingMarkerExists(markerPath: string): Promise<boolean> {
  try {
    await stat(markerPath);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

export async function applyPendingCacheClear(paths: GamePaths): Promise<void> {
  if (!(await pendingMarkerExists(paths.cacheClearRequest))) return;
  await rm(paths.chunks, { recursive: true, force: true });
  await rm(paths.cacheClearRequest, { force: true });
  logEvent({ k: "cache.clearedAtStartup" });
}

export async function applyPendingGameStorageReset(
  paths: GamePaths,
  diagnosticOwnerId: number,
): Promise<void> {
  await applyPendingSessionStorageReset(
    session.defaultSession,
    paths.gameStorageClearRequest,
    diagnosticOwnerId,
  );
}

export async function applyPendingSessionStorageReset(
  owner: Session,
  markerPath: string,
  diagnosticOwnerId: number,
): Promise<boolean> {
  if (!(await pendingMarkerExists(markerPath))) return false;
  // This runs before a renderer can mount IDBFS. Clearing it later would race
  // the game's auto-persist and could recreate files before quit.
  await owner.clearStorageData({
    origin: "gw://app",
    storages: ["indexdb"],
  });
  await rm(markerPath, { force: true });
  logEvent({ k: "filesystem.resetCompleted" }, diagnosticOwnerId);
  return true;
}
