import { app, dialog, powerMonitor, session } from "electron";
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
  type ToolboxSelection,
} from "../shared/contracts.js";
import { errorCode } from "../shared/errors.js";
import { EMPTY_PREFETCH, INITIAL_PROGRESS } from "../shared/progress.js";
import { AUTOMATION_COMMAND } from "../shared/automation.js";
import { ClientRuntime } from "./client-runtime.js";
import { loadSettings, saveSettings } from "./core/settings.js";
import { SocketManager } from "./core/sockets.js";
import {
  count,
  exportDiagnosticsForWindow,
  gauge,
  logEvent,
  markPerformanceProblem,
  observe,
  peakGauge,
  setDiagnosticCaptureStoppedHandler,
  startDiagnosticCapture,
  startDiagnostics,
  stopDiagnosticCapture,
  stopDiagnostics,
} from "./diagnostics.js";
import type { AppPhase } from "./diagnostics/schema.js";
import { emitSocketEvent, registerIpcHandlers } from "./ipc.js";
import { checkForNewerRelease } from "./release-notice.js";
import {
  enableSandboxBeforeReady,
  onAppQuit,
  runQuitCleanup,
  wireLifecycle,
} from "./lifecycle.js";
import { sweepOrphanDirectories } from "./core/atomic-file.js";
import { documentDirectories } from "./core/paths.js";
import { gamePaths } from "./paths.js";
import {
  TOOLBOX_AUTOMATION_ENABLED,
  toolboxEnabledFor,
  toolboxSelectionFor,
} from "./toolbox-policy.js";
import { installGwProtocolHandler, registerGwScheme, setProtocolDeps } from "./protocol.js";
import {
  createMainWindow,
  exportProblemReport,
  flushWindowState,
  getMainWindow,
  prepareWindowState,
  RENDERER_URL,
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

const primaryInstance = app.requestSingleInstanceLock();
if (!primaryInstance) {
  app.quit();
} else {
  enableSandboxBeforeReady();
  registerGwScheme();
  wireLifecycle();
}

const prefetch: PrefetchProgress = { ...EMPTY_PREFETCH };
let settingsWrite: Promise<void> = Promise.resolve();
let secondInstanceRequested = false;
const INJECT_STARTUP_FAILURE =
  !app.isPackaged && process.env.GW_TEST_STARTUP_FAILURE === "1";

function revealMainWindow(): void {
  const win = getMainWindow();
  if (!win || win.isDestroyed()) {
    secondInstanceRequested = true;
    return;
  }
  secondInstanceRequested = false;
  app.dock?.show();
  if (win.isMinimized()) win.restore();
  if (!win.isVisible()) win.show();
  win.focus();
}

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

function buildSocketManager(): SocketManager {
  return new SocketManager(
    (ownerId, event) => {
      if (event.type === "open") {
        logEvent({ k: "socket.open", socketId: event.socketId });
      } else if (event.type === "close") {
        logEvent({
          k: "socket.close",
          socketId: event.socketId,
          reason: event.reason,
        });
      } else if (event.type === "error") {
        logEvent({
          k: "socket.error",
          socketId: event.socketId,
          code: event.code,
        });
      }
      emitSocketEvent(ownerId, event);
    },
    { count, observe, gauge, peakGauge },
    !app.isPackaged && process.env.GW_OFFLINE_SHELL === "1"
      ? (destination) => {
          if (destination !== "127.0.0.1:6112") {
            throw new Error(
              "offline socket fixture permits only 127.0.0.1:6112",
            );
          }
          return { host: "127.0.0.1", port: 6112, family: 4 };
        }
      : undefined,
  );
}

function setProgress(next: DownloadProgress): void {
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
  try {
    win.webContents.send(channel, value);
  } catch {
    // Renderer teardown can race a native progress callback.
  }
}

async function ensureDirs(): Promise<void> {
  const paths = gamePaths();
  await mkdir(paths.game, { recursive: true });
  await mkdir(paths.chunks, { recursive: true });
  await mkdir(paths.diagnostics, { recursive: true });
  // P1.2 — first open of the directories we own. A process killed between
  // write and rename leaves `<name>.<pid>.<hex>.tmp` behind, and boot is the
  // only moment at which every one of those directories is known to be idle.
  const removed = await sweepOrphanDirectories(documentDirectories(paths));
  if (removed > 0) logEvent({ k: "orphanTemps.swept", removed });
}

async function clearBrowserCookies(phase: AppPhase): Promise<void> {
  try {
    await session.defaultSession.clearStorageData({ storages: ["cookies"] });
    logEvent({ k: "browserCookies.cleared", phase });
  } catch (error) {
    logEvent({
      k: "browserCookies.clearFailed",
      phase,
      code: errorCode(error),
    });
  }
}

async function clearBrowserNetworkCache(): Promise<void> {
  try {
    // Snapshot chunks are canonical in the native content-addressed store.
    // Chromium's HTTP cache would only duplicate them and can retain stale
    // same-URL client artifacts between exact-hash updates.
    await session.defaultSession.clearCache();
    logEvent({ k: "browserCache.cleared", phase: "startup" });
  } catch (error) {
    logEvent({
      k: "browserCache.clearFailed",
      phase: "startup",
      code: errorCode(error),
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
  logEvent({ k: "cache.clearedAtStartup" });
}

async function applyPendingGameStorageClear(): Promise<void> {
  const paths = gamePaths();
  try {
    await stat(paths.gameStorageClearRequest);
  } catch {
    return;
  }
  // Run before a renderer can mount IDBFS, otherwise auto-persisting game
  // writes can race the destructive clear and recreate entries before quit.
  await session.defaultSession.clearStorageData({
    origin: "gw://app",
    storages: ["indexdb"],
  });
  await rm(paths.gameStorageClearRequest, { force: true });
  logEvent({ k: "filesystem.resetCompleted" });
}

function buildWindowHost(
  clientRuntime: ClientRuntime,
  sockets: SocketManager,
  toolboxSelection: ToolboxSelection,
): WindowHost {
  return {
    sockets,
    toolboxSelection,
    getProgress: () => clientRuntime.progress,
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
      void win.loadURL(RENDERER_URL);
    },
    prepareRendererRecovery: async () => {
      await clientRuntime.recoverRendererCrash();
    },
  };
}

if (primaryInstance) app.on("second-instance", revealMainWindow);

if (primaryInstance) void app.whenReady().then(async () => {
  if (INJECT_STARTUP_FAILURE) {
    throw new Error("injected startup failure");
  }
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
  await applyPendingGameStorageClear();
  await ensureDirs();
  await startDiagnostics();
  await clearBrowserCookies("startup");
  await clearBrowserNetworkCache();
  logEvent({ k: "electron.ready" });
  const settings = await loadSettings(gamePaths().settings, async () => {
    logEvent({ k: "settings.corruptRecovered" });
    await dialog.showMessageBox({
      type: "warning",
      buttons: ["Continue"],
      message: "Settings were reset",
      detail:
        "The settings file was corrupt. Defaults were restored and a diagnostic copy was preserved.",
    });
  });
  const toolboxSelection = toolboxSelectionFor(settings);
  await prepareWindowState();
  const paths = gamePaths();
  const expectedUserData = process.env.GW_EXPECT_USER_DATA;
  const profileMatches =
    !expectedUserData ||
    path.resolve(expectedUserData) === path.resolve(app.getPath("userData"));
  const clientRuntime = new ClientRuntime({
    paths,
    hostVersion: app.getVersion(),
    cachedOnly: process.env.GW_REQUIRE_CACHED_CLIENT === "1",
    offlineShell: process.env.GW_OFFLINE_SHELL === "1",
    toolboxEnabled: toolboxEnabledFor(settings),
    onProgress: setProgress,
    onPrefetch: setPrefetch,
  });
  const sockets = buildSocketManager();
  powerMonitor.on("suspend", () => {
    if (!clientRuntime.isDownloading) return;
    logEvent({ k: "fullDownload.stoppedForSleep" });
    clientRuntime.stopDownload();
  });
  setProtocolDeps({
    getActiveClient: () => clientRuntime.active,
  });
  installGwProtocolHandler();
  logEvent({ k: "protocol.installed" });

  registerIpcHandlers({
    sockets,
    getProgress: () => clientRuntime.progress,
    getChunkStore: () => clientRuntime.active?.store ?? null,
    getSettings: () => loadSettings(gamePaths().settings),
    updateSettings: updateAppSettings,
    resetSettings: resetAppSettings,
    downloadFullGame: () => clientRuntime.downloadAll(),
    stopFullDownload: () => clientRuntime.stopDownload(),
    confirmClientHealthy: (token) =>
      clientRuntime.confirmCandidateHealthy(token),
    // A retry is a request to run the update again, nothing more. Whether it
    // worked is already on the progress channel, which is where the renderer
    // reads it — a second, thrown answer would have been a second owner.
    retryClient: () => clientRuntime.requestUpdate(),
    checkReleaseNotice: () => checkForNewerRelease(app.getVersion()),
    getClientSession: () => ({
      appVersion: app.getVersion(),
      compatibility: clientRuntime.compatibility,
      healthToken: clientRuntime.healthToken,
    }),
  });

  onAppQuit(async () => {
    await flushWindowState();
    sockets.closeAll();
    updateLongRunningTaskFeedback({
      ...INITIAL_PROGRESS,
      phase: "ready",
      label: "Quitting",
    });
    await clientRuntime.shutdown();
    await clearBrowserCookies("quit");
    await stopDiagnostics();
  });

  const win = createMainWindow(buildWindowHost(
    clientRuntime,
    sockets,
    toolboxSelection,
  ));
  if (secondInstanceRequested) win.once("ready-to-show", revealMainWindow);
  if (TOOLBOX_AUTOMATION_ENABLED) {
    process.on("message", (message) => {
      if (message === AUTOMATION_COMMAND.startLevel1Capture) {
        void startDiagnosticCapture(1).catch((error) => {
          logEvent({
            k: "capture.automationStartFailed",
            code: errorCode(error),
          });
        });
      } else if (message === AUTOMATION_COMMAND.stopCapture) {
        void stopDiagnosticCapture();
      }
    });
  } else {
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
  }
  logEvent({ k: "window.created" });
  if (profileMatches) {
    void clientRuntime.requestUpdate();
  } else {
    logEvent({ k: "app.unexpectedUserData" });
    setProgress({ phase: "error", errorCode: "wrong_profile" });
  }

  app.on("activate", () => {
    if (!getMainWindow()) {
      createMainWindow(buildWindowHost(clientRuntime, sockets, toolboxSelection));
    }
  });
  app.on("child-process-gone", (_event, details) => {
    logEvent({ k: "childProcess.gone",
      exitCode: details.exitCode,
    });
  });
}).catch((error) => {
  startFatalExit(
    "app.startupFailed",
    error,
    "Guild Wars could not start",
    "Startup failed before the game window could open. Reopen the app and, if it repeats, report the problem.",
  );
});

let fatalExitStarted = false;

function startFatalExit(
  event: "app.startupFailed" | "app.uncaughtException",
  error: unknown,
  title: string,
  detail: string,
): void {
  if (fatalExitStarted) return;
  fatalExitStarted = true;
  const code = errorCode(error);
  if (event === "app.startupFailed") {
    logEvent({ k: "app.startupFailed", code });
  } else {
    logEvent({ k: "app.uncaughtException", code });
  }
  // The injected failure is an unpackaged-only test seam. Production startup
  // failures are always visible; the deterministic process-exit test must not
  // wait on a native modal with no window available to dismiss it.
  if (!INJECT_STARTUP_FAILURE) {
    try {
      dialog.showErrorBox(title, detail);
    } catch {
      // Cleanup and lock release are still mandatory if the OS dialog fails.
    }
  }
  void runQuitCleanup().then(
    () => app.exit(1),
    () => app.exit(1),
  );
}

if (primaryInstance) process.on("uncaughtException", (err) => {
  startFatalExit(
    "app.uncaughtException",
    err,
    "Guild Wars stopped unexpectedly",
    "A fatal application error occurred. After reopening, choose Help → Report a Problem.",
  );
});

if (primaryInstance) process.on("unhandledRejection", (reason) => {
  logEvent({ k: "app.unhandledRejection", code: errorCode(reason) });
});
