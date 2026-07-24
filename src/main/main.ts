import { app, dialog, net, session } from "electron";
import { mkdir, rm, stat } from "node:fs/promises";
import path from "node:path";
import {
  EXTERNAL_URLS,
  DEFAULT_SETTINGS,
  IPC,
  type AppSettings,
  type AppSettingsPatch,
  type DownloadProgress,
  type PrefetchProgress,
  type SnapshotMetadata,
} from "../shared/contracts.js";
import { EMPTY_PREFETCH, INITIAL_PROGRESS } from "../shared/progress.js";
import {
  ACCESS_KEY,
  COMMON_ARTIFACTS,
  JSPI_ARTIFACTS,
  PATCH_REQUEST_TIMEOUT_MS,
  PATCH_ROOT,
  SNAPSHOT,
  UA,
} from "./core/access-key.js";
import { readPublishedClientManifest } from "./core/published-client.js";
import { ChunkStore } from "./core/chunk-store.js";
import type { Manifest } from "./core/manifest.js";
import { PatchClient } from "./core/patch-client.js";
import { fetchPatchBytes, type PatchFetch } from "./core/patch-transport.js";
import { loadSettings, saveSettings } from "./core/settings.js";
import { SocketManager } from "./core/sockets.js";
import { buildSnapshotMetadata } from "./core/snapshot.js";
import {
  count,
  exportDiagnosticsForWindow,
  gauge,
  log,
  markPerformanceProblem,
  observe,
  peakGauge,
  setDiagnosticCaptureStoppedHandler,
  span,
  startDiagnosticCapture,
  startDiagnostics,
  stopDiagnosticCapture,
  stopDiagnostics,
} from "./diagnostics.js";
import { emitSocketEvent, registerIpcHandlers } from "./ipc.js";
import {
  enableSandboxBeforeReady,
  onAppQuit,
  runQuitCleanup,
  wireLifecycle,
} from "./lifecycle.js";
import { gamePaths } from "./paths.js";
import { installGwProtocolHandler, registerGwScheme, setProtocolDeps } from "./protocol.js";
import {
  createMainWindow,
  exportProblemReport,
  flushWindowState,
  getMainWindow,
  prepareWindowState,
  resetGameInput,
  type WindowHost,
  updateLongRunningTaskFeedback,
} from "./window.js";

// Ad-hoc builds have no stable code identity, so Chromium's profile encryption
// repeatedly asks for access to "<app> Safe Storage". The mock provider avoids
// that OS prompt. The same provider encrypts the owner-only saved-login file;
// this is intentionally weaker than a signed app's stable Keychain identity.
if (process.platform === "darwin") {
  app.commandLine.appendSwitch("use-mock-keychain");
}

enableSandboxBeforeReady();
registerGwScheme();
wireLifecycle();

let progress: DownloadProgress = { ...INITIAL_PROGRESS };
const prefetch: PrefetchProgress = { ...EMPTY_PREFETCH };

let chunkStore: ChunkStore | null = null;
let snapshotMeta: SnapshotMetadata | null = null;
let saveTouchedTimer: ReturnType<typeof setInterval> | null = null;
let initialResidencyRecorded = false;
let fullDownload: Promise<boolean> | null = null;
let settingsWrite: Promise<void> = Promise.resolve();

function updateAppSettings(patch: AppSettingsPatch): Promise<AppSettings> {
  const operation = settingsWrite.then(async () => {
    const settingsPath = gamePaths().settings;
    const current = await loadSettings(settingsPath);
    return saveSettings(settingsPath, { ...current, ...patch });
  });
  settingsWrite = operation.then(
    () => undefined,
    () => undefined,
  );
  return operation;
}

function resetAppSettings(): Promise<AppSettings> {
  const operation = settingsWrite.then(() =>
    saveSettings(gamePaths().settings, { ...DEFAULT_SETTINGS }),
  );
  settingsWrite = operation.then(
    () => undefined,
    () => undefined,
  );
  return operation;
}

const sockets = new SocketManager(
  (ownerId, event) => {
    if (event.type !== "data") {
      log("socket", "info", `socket.${event.type}`, {
        socketId: event.socketId,
        ...(event.type === "close" ? { reason: event.reason } : {}),
        ...(event.type === "error" ? { message: event.message } : {}),
      });
    }
    emitSocketEvent(ownerId, event);
  },
  { count, observe, gauge, peakGauge },
);

function setProgress(next: DownloadProgress): void {
  progress = next;
  updateLongRunningTaskFeedback(next);
  sendToRenderer(IPC.progressEvent, next);
}

function setPrefetch(next: PrefetchProgress): void {
  prefetch.completedChunks = next.completedChunks;
  prefetch.totalChunks = next.totalChunks;
  sendToRenderer(IPC.prefetchEvent, { ...prefetch });
}

function sendToRenderer(channel: string, value: unknown): void {
  const win = getMainWindow();
  if (!win || win.isDestroyed() || win.webContents.isDestroyed()) return;
  win.webContents.send(channel, value);
}

async function ensureDirs(): Promise<void> {
  const paths = gamePaths();
  await mkdir(paths.game, { recursive: true });
  await mkdir(paths.chunks, { recursive: true });
  await mkdir(paths.diagnostics, { recursive: true });
}

async function clearBrowserCookies(phase: "startup" | "quit"): Promise<void> {
  try {
    await session.defaultSession.clearStorageData({ storages: ["cookies"] });
    log("app", "info", `browserCookies.cleared.${phase}`);
  } catch (error) {
    log("app", "warn", `browserCookies.clearFailed.${phase}`, {
      message: error instanceof Error ? error.message : String(error),
    });
  }
}

async function applyPendingCacheClear(): Promise<void> {
  const paths = gamePaths();
  try {
    await stat(paths.cacheClearRequest);
  } catch {
    return;
  }
  await rm(paths.chunks, { recursive: true, force: true });
  await rm(paths.bootChunks, { force: true });
  await rm(paths.cacheClearRequest, { force: true });
  log("cache", "info", "cache.clearedAtStartup");
}

function cdnChunkFetcher(): (hash: string) => Promise<Uint8Array> {
  const headers = {
    "X-Access-Key": ACCESS_KEY,
    "User-Agent": UA,
    "Accept-Encoding": "identity",
  };
  const patchFetch: PatchFetch = async (url, init) => {
    const request: RequestInit = {
      signal: AbortSignal.timeout(PATCH_REQUEST_TIMEOUT_MS),
    };
    if (init?.headers) request.headers = init.headers;
    const response = await net.fetch(url, request);
    return {
      status: response.status,
      body: new Uint8Array(await response.arrayBuffer()),
    };
  };
  return async (hash) => {
    const url = `${PATCH_ROOT}/${hash}.bin`;
    return fetchPatchBytes({
      fetch: patchFetch,
      url,
      headers,
      onAttempt: (durationMs) => observe("cache.networkWire", durationMs * 1_000),
    });
  };
}

async function refreshSnapshotMeta(): Promise<void> {
  if (!chunkStore) {
    snapshotMeta = null;
    return;
  }
  const residentIndices = await chunkStore.residentIndices();
  snapshotMeta = buildSnapshotMetadata({
    size: chunkStore.size,
    chunkSize: chunkStore.chunkSize,
    chunkHashes: chunkStore.hashes,
    residentIndices,
  });
  const residentBytes = residentIndices.reduce(
    (total, index) => total + chunkStore!.chunkByteLength(index),
    0,
  );
  gauge("cache.residentChunks", residentIndices.length);
  gauge("cache.residentBytes", residentBytes);
  gauge("cache.totalChunks", chunkStore.hashes.length);
  gauge("cache.totalBytes", chunkStore.size);
  if (!initialResidencyRecorded) {
    gauge("cache.initialResidentChunks", residentIndices.length);
    gauge("cache.initialResidentBytes", residentBytes);
    initialResidencyRecorded = true;
  }
}

async function attachChunkStore(
  manifest: Manifest,
  chunksDir: string,
  bootChunks: string,
): Promise<void> {
  const entry = manifest.entry(SNAPSHOT);
  if (!entry) {
    log("update", "warn", "manifest.snapshotMissing");
    chunkStore = null;
    snapshotMeta = null;
    return;
  }
  await installChunkStore(
    entry.size,
    manifest.chunkSize,
    entry.chunkHashes,
    manifest.compression,
    chunksDir,
    bootChunks,
  );
}

async function installChunkStore(
  size: number,
  chunkSize: number,
  chunkHashes: string[],
  compression: "none" | "gzip",
  chunksDir: string,
  bootChunks: string,
): Promise<void> {
  chunkStore = new ChunkStore({
    chunksDir,
    size,
    chunkSize,
    chunkHashes,
    compression,
    bootListPath: bootChunks,
    fetch: cdnChunkFetcher(),
    metrics: { count, observe, gauge, peak: peakGauge },
  });
  initialResidencyRecorded = false;
  await refreshSnapshotMeta();

  if (saveTouchedTimer) clearInterval(saveTouchedTimer);
  saveTouchedTimer = setInterval(() => {
    void chunkStore?.saveTouched().catch(() => undefined);
  }, 5000);
}

async function attachLastPublishedClient(): Promise<void> {
  const paths = gamePaths();
  for (const name of [...JSPI_ARTIFACTS, ...COMMON_ARTIFACTS]) {
    const file = await stat(path.join(paths.artifacts, name));
    if (!file.isFile() || file.size <= 0) {
      throw new Error(`last published client is missing ${name}`);
    }
  }
  const value = await readPublishedClientManifest(
    path.join(paths.artifacts, "manifest.json"),
  );
  await installChunkStore(
    value.size,
    value.chunkSize,
    value.chunkHashes,
    value.compressionMode,
    paths.chunks,
    paths.bootChunks,
  );
}

async function afterClientReady(notice?: string): Promise<void> {
  if (!chunkStore) return;
  setProgress({
    ...INITIAL_PROGRESS,
    phase: "ready",
    label: "Starting Guild Wars",
    ...(notice ? { notice } : {}),
  });

  // Boot working-set prefetch runs after the client is free to start.
  void chunkStore
    .prefetch((p) => setPrefetch(p))
    .then(() => refreshSnapshotMeta())
    .catch((err) =>
      log("cache", "warn", "prefetch.failed", {
        message: err instanceof Error ? err.message : String(err),
      }),
    );
}

function downloadFullGame(): Promise<boolean> {
  if (fullDownload) return fullDownload;
  const store = chunkStore;
  if (!store) {
    return Promise.reject(
      new Error("The game files are not ready yet. Try again in a moment."),
    );
  }
  store.resume();
  log("cache", "info", "fullDownload.started");
  setProgress({
    ...INITIAL_PROGRESS,
    phase: "image",
    label: "Downloading full game",
  });
  let lastProgressLogAt = 0;
  fullDownload = store
    .downloadAll({
      onProgress: (value) => {
        setProgress({
          phase: "image",
          label: "Downloading full game",
          received: value.received,
          total: value.total,
          bytesPerSecond: value.bytesPerSecond,
          secondsRemaining: value.secondsRemaining,
          error: null,
        });
        const now = Date.now();
        if (now - lastProgressLogAt >= 5_000) {
          lastProgressLogAt = now;
          log("cache", "info", "fullDownload.progress", {
            received: value.received,
            total: value.total,
            bytesPerSecond: value.bytesPerSecond,
            secondsRemaining: value.secondsRemaining,
          });
        }
      },
    })
    .then(async (complete) => {
      await refreshSnapshotMeta();
      log(
        "cache",
        "info",
        complete ? "fullDownload.completed" : "fullDownload.stopped",
      );
      setProgress({
        ...INITIAL_PROGRESS,
        phase: "ready",
        label: complete ? "Full game downloaded" : "Download stopped",
      });
      return complete;
    })
    .catch((error) => {
      log("cache", "error", "fullDownload.failed", {
        code:
          error instanceof Error && "code" in error
            ? String(error.code)
            : "unknown",
        message: error instanceof Error ? error.message : String(error),
      });
      let cause: unknown = error;
      let diskSpaceFailure = false;
      while (cause instanceof Error) {
        const code = "code" in cause ? String(cause.code) : "";
        if (code === "disk_full" || code === "ENOSPC" || code === "EDQUOT") {
          diskSpaceFailure = true;
          break;
        }
        cause = cause.cause;
      }
      const message = diskSpaceFailure
        ? "There is not enough free disk space to download the full game."
        : "The download could not continue. Check your connection, then choose Resume Download.";
      setProgress({
        ...INITIAL_PROGRESS,
        phase: "ready",
        label: "Download paused",
      });
      throw new Error(message, { cause: error });
    })
    .finally(() => {
      fullDownload = null;
    });
  return fullDownload;
}

async function startGameUpdate(): Promise<void> {
  // Offline shell tests skip ArenaNet contact entirely.
  if (process.env.GW_OFFLINE_SHELL === "1") {
    setProgress({
      ...INITIAL_PROGRESS,
      phase: "ready",
      label: "Ready (offline shell)",
    });
    return;
  }
  const paths = gamePaths();
  const patchClient = new PatchClient({
    artifactsDir: paths.artifacts,
    chunksDir: paths.chunks,
    onProgress: (p) => {
      setProgress(p);
    },
  });
  const updateSpan = span("update", "clientUpdate");
  try {
    const manifest = await patchClient.update();
    await attachChunkStore(manifest, paths.chunks, paths.bootChunks);
    await afterClientReady();
    updateSpan.end({ status: "ready" });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    try {
      await attachLastPublishedClient();
      log("update", "warn", "patch.updateFallback", {
        message,
      });
      gauge("update.usingCachedClient", true);
      await afterClientReady(
        "The game client update failed, so the previous client was restored.",
      );
      updateSpan.end({ status: "cachedFallback", message }, "warn");
      return;
    } catch (fallbackError) {
      log("update", "error", "patch.updateFailed", {
        message,
        fallback:
          fallbackError instanceof Error
            ? fallbackError.message
            : String(fallbackError),
      });
    }
    updateSpan.end({ status: "error", message }, "error");
    setProgress({
      ...INITIAL_PROGRESS,
      phase: "error",
      label: "Update failed",
      error:
        "ArenaNet is unavailable and no previous game client could be restored.",
    });
  }
}

function buildWindowHost(): WindowHost {
  return {
    sockets,
    getProgress: () => progress,
    getSettings: () => loadSettings(gamePaths().settings),
    updateSettings: updateAppSettings,
    exportDiagnostics: async () => {
      const win = getMainWindow();
      return win ? exportDiagnosticsForWindow(win) : "";
    },
    markPerformanceProblem,
    startCapture: startDiagnosticCapture,
    stopCapture: stopDiagnosticCapture,
    reloadGame: (win) => {
      sockets.closeAll(win.webContents.id);
      void win.loadURL("gw://app/");
    },
  };
}

app.whenReady().then(async () => {
  app.setAboutPanelOptions({
    applicationName: "Guild Wars",
    applicationVersion: app.getVersion(),
    version: app.getVersion(),
    copyright:
      "Independent GPL-3.0 project · Guild Wars © 2005–2026 ArenaNet, Inc.",
    credits:
      "Mat4m0/gwonmac · QT Friz Quad © 1992 QualiType (SIL OFL 1.1) · Not affiliated with ArenaNet or NCSoft.",
    website: EXTERNAL_URLS.github,
  });
  await applyPendingCacheClear();
  await ensureDirs();
  await startDiagnostics();
  await clearBrowserCookies("startup");
  log("app", "info", "electron.ready");
  await loadSettings(gamePaths().settings, async (backupPath) => {
    log("settings", "error", "settings.corruptRecovered", {
      backup: path.basename(backupPath),
    });
    await dialog.showMessageBox({
      type: "warning",
      buttons: ["Continue"],
      message: "Settings were reset",
      detail:
        "The settings file was corrupt. Defaults were restored and a diagnostic copy was preserved.",
    });
  });
  await prepareWindowState();
  setProtocolDeps({
    getChunkStore: () => chunkStore,
    getSnapshotMeta: () => snapshotMeta,
  });
  installGwProtocolHandler();
  log("protocol", "info", "protocol.installed");

  registerIpcHandlers({
    sockets,
    getProgress: () => progress,
    getChunkStore: () => chunkStore,
    getSettings: () => loadSettings(gamePaths().settings),
    updateSettings: updateAppSettings,
    resetSettings: resetAppSettings,
    downloadFullGame,
    stopFullDownload: () => {
      if (!fullDownload) return;
      log("cache", "info", "fullDownload.stopRequested");
      chunkStore?.stop();
    },
  });

  onAppQuit(async () => {
    await flushWindowState();
    sockets.closeAll();
    chunkStore?.stop();
    updateLongRunningTaskFeedback({
      ...INITIAL_PROGRESS,
      phase: "ready",
      label: "Quitting",
    });
    if (saveTouchedTimer) clearInterval(saveTouchedTimer);
    await chunkStore?.saveTouched().catch(() => undefined);
    await clearBrowserCookies("quit");
    await stopDiagnostics();
  });

  createMainWindow(buildWindowHost());
  setDiagnosticCaptureStoppedHandler(async () => {
    const win = getMainWindow();
    if (!win || win.isDestroyed()) return;
    await resetGameInput(win);
    const { response } = await dialog.showMessageBox(win, {
      type: "info",
      buttons: ["Export Now…", "Later"],
      defaultId: 0,
      cancelId: 1,
      message: "Performance capture finished",
      detail: "Export it now while the capture context is fresh.",
    });
    if (response === 0) {
      await exportProblemReport(win, () => exportDiagnosticsForWindow(win));
    }
  });
  log("app", "info", "window.created");
  setProgress({
    ...INITIAL_PROGRESS,
    phase: "starting",
    label: "Checking the game client",
  });
  void startGameUpdate();

  app.on("activate", () => {
    if (!getMainWindow()) createMainWindow(buildWindowHost());
  });
  app.on("child-process-gone", (_event, details) => {
    log("app", "error", "childProcess.gone", {
      type: details.type,
      reason: details.reason,
      exitCode: details.exitCode,
      serviceName: details.serviceName ?? null,
      name: details.name ?? null,
    });
  });
});

let fatalExitStarted = false;

process.on("uncaughtException", (err) => {
  if (fatalExitStarted) return;
  fatalExitStarted = true;
  log("app", "error", "app.uncaughtException", { message: err.message });
  dialog.showErrorBox(
    "Guild Wars stopped unexpectedly",
    "A fatal application error occurred. After reopening, choose Help → Report a Problem.",
  );
  void runQuitCleanup().finally(() => app.exit(1));
});

process.on("unhandledRejection", (reason) => {
  log("app", "error", "app.unhandledRejection", {
    message: reason instanceof Error ? reason.message : String(reason),
  });
});
