/**
 * Renderer setting changes and durable reset markers whose meaning is larger
 * than one settings-file read or write.
 *
 * IPC owns sender validation and parsing. This module owns the confirmation,
 * durable boundary, and relaunch ordering: a refusal writes nothing, and once
 * a settings value or reset marker is durable, a failed relaunch cannot turn
 * that completed write into a false failure response.
 */
import { session, type Session } from "electron";
import { readFile, rm, stat } from "node:fs/promises";
import type {
  AppSettings,
  RendererSettingsPatch,
} from "../shared/contracts.js";
import { errorCode } from "../shared/errors.js";
import { logEvent } from "./diagnostics.js";
import type { GamePaths } from "./paths.js";

export async function applySettingsChange(
  patch: RendererSettingsPatch,
  write: (patch: RendererSettingsPatch) => Promise<AppSettings>,
): Promise<AppSettings> {
  try {
    return await write(patch);
  } catch (error) {
    logEvent({ k: "settings.saveFailed", code: errorCode(error) });
    throw error;
  }
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
  const fullReset = await readFile(paths.cacheClearRequest, "utf8")
    .then((value) => value === "launcher-full-reset-v1")
    .catch(() => false);
  await rm(paths.chunks, { recursive: true, force: true });
  if (fullReset) {
    await rm(paths.artifacts, { recursive: true, force: true });
    await rm(paths.previousArtifacts, { recursive: true, force: true });
    await rm(paths.rejectedClient, { force: true });
  }
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
