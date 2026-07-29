import {
  app,
  dialog,
  powerMonitor,
  session,
  shell,
  type Session,
} from "electron";
import { mkdir, rm, stat } from "node:fs/promises";
import path from "node:path";
import {
  EXTERNAL_URLS,
  type EnhancementSelection,
} from "../shared/contracts.js";
import { errorCode } from "../shared/errors.js";
import { AUTOMATION_COMMAND } from "../shared/automation.js";
import { ClientRuntime } from "./client-runtime.js";
import { loadSettings } from "./core/settings.js";
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
import {
  discardObsoleteEnhancementCache,
  documentDirectories,
} from "./core/paths.js";
import { appPaths } from "./paths.js";
import {
  ENHANCEMENT_AUTOMATION_ENABLED,
  enhancementsEnabledFor,
  enhancementSelectionFor,
} from "./enhancement-policy.js";
import {
  gameProtocolHandler,
  registerGwScheme,
  setProtocolDeps,
} from "./protocol.js";
import { installGameSession } from "./game-session.js";
import {
  createMainWindow,
  exportProblemReport,
  RENDERER_URL,
  resetGameInput,
  type WindowHost,
  updateLongRunningTaskFeedback,
} from "./window.js";
import { WindowRegistry } from "./window-registry.js";
import { AppRuntime, ownedGameWindow } from "./app-runtime.js";
import { bootstrapProfiles } from "./profile-bootstrap.js";
import type { ProfileRecord } from "./core/profiles.js";
import { WindowStateOwner } from "./window-state-owner.js";

if (process.platform === "win32") {
  app.setAppUserModelId("com.squirrel.GuildWars.GuildWars");
}

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

let secondInstanceRequested = false;
let activeRuntime: AppRuntime | null = null;
const INJECT_STARTUP_FAILURE =
  !app.isPackaged && process.env.GW_TEST_STARTUP_FAILURE === "1";

function revealMainWindow(): void {
  const win = ownedGameWindow(activeRuntime);
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

function buildSocketManager(windows: WindowRegistry): SocketManager {
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
      emitSocketEvent(windows, ownerId, event);
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

async function ensureDirs(): Promise<void> {
  const paths = appPaths();
  await mkdir(paths.game, { recursive: true });
  await mkdir(paths.chunks, { recursive: true });
  await mkdir(paths.diagnostics, { recursive: true });
  // P1.2 — first open of the directories we own. A process killed between
  // write and rename leaves `<name>.<pid>.<hex>.tmp` behind, and boot is the
  // only moment at which every one of those directories is known to be idle.
  const removed = await sweepOrphanDirectories(documentDirectories(paths));
  if (removed > 0) logEvent({ k: "orphanTemps.swept", removed });
}

async function clearBrowserCookies(
  target: Session,
  phase: AppPhase,
): Promise<void> {
  try {
    await target.clearStorageData({ storages: ["cookies"] });
    logEvent({ k: "browserCookies.cleared", phase });
  } catch (error) {
    logEvent({
      k: "browserCookies.clearFailed",
      phase,
      code: errorCode(error),
    });
  }
}

async function clearBrowserNetworkCache(target: Session): Promise<void> {
  try {
    // Snapshot chunks are canonical in the native content-addressed store.
    // Chromium's HTTP cache would only duplicate them and can retain stale
    // same-URL client artifacts between exact-hash updates.
    await target.clearCache();
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
  const paths = appPaths();
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

async function applyPendingGameStorageClear(
  profile: ProfileRecord,
  target: Session,
): Promise<void> {
  try {
    await stat(profile.paths.gameStorageClearRequest);
  } catch {
    return;
  }
  // Run before a renderer can mount IDBFS, otherwise auto-persisting game
  // writes can race the destructive clear and recreate entries before quit.
  await target.clearStorageData({
    origin: "gw://app",
    storages: ["indexdb"],
  });
  await rm(profile.paths.gameStorageClearRequest, { force: true });
  logEvent({ k: "filesystem.resetCompleted" });
}

function buildWindowHost(
  runtime: AppRuntime<ClientRuntime, SocketManager>,
  profile: ProfileRecord,
  gameSession: Session,
  windowState: WindowStateOwner,
  enhancementSelection: EnhancementSelection,
): WindowHost {
  const { client, sockets, windows } = runtime;
  return {
    sockets,
    enhancementSelection,
    getProgress: () => client.progress,
    getSettings: () => runtime.getSettings(),
    updateSettings: (patch) => runtime.updateSettings(patch),
    exportDiagnostics: async () => {
      const win = windows.gameWindow();
      return win ? exportDiagnosticsForWindow(win) : "";
    },
    markPerformanceProblem: (win) => markPerformanceProblem(win),
    startCapture: (win, level) => startDiagnosticCapture(win, level),
    stopCapture: stopDiagnosticCapture,
    reloadGame: (win) => {
      sockets.closeAll(win.webContents.id);
      void win.loadURL(RENDERER_URL);
    },
    prepareRendererRecovery: async () => {
      await client.recoverRendererCrash();
    },
    windowState,
    profileId: profile.id,
    gameSession,
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
  await ensureDirs();
  await startDiagnostics();
  const paths = appPaths();
  const profileBootstrap = await bootstrapProfiles({
    userData: paths.userData,
    profilesRoot: paths.profiles,
    trashItem: (target) => shell.trashItem(target),
  });
  const profile = profileBootstrap.profile;
  const gameSession = session.fromPath(profile.paths.browser, { cache: true });
  await applyPendingGameStorageClear(profile, gameSession);
  const obsoleteCacheError = await discardObsoleteEnhancementCache(
    appPaths(),
    rm,
  );
  if (obsoleteCacheError !== null) {
    // This is a derived beta cache. Failure must not block the canonical client.
    logEvent({
      k: "enhancement.obsoleteCacheDiscardFailed",
      code: errorCode(obsoleteCacheError),
    });
  }
  await clearBrowserCookies(gameSession, "startup");
  await clearBrowserNetworkCache(gameSession);
  logEvent({ k: "electron.ready" });
  const settings = await loadSettings(appPaths().settings, async () => {
    logEvent({ k: "settings.corruptRecovered" });
    await dialog.showMessageBox({
      type: "warning",
      buttons: ["Continue"],
      message: "Settings were reset",
      detail:
        "The settings file was corrupt. Defaults were restored and a diagnostic copy was preserved.",
    });
  });
  const enhancementSelection = enhancementSelectionFor(settings);
  const windowState = new WindowStateOwner(profile.paths.windowState);
  await windowState.prepare();
  const expectedUserData = process.env.GW_EXPECT_USER_DATA;
  const profileMatches =
    !expectedUserData ||
    path.resolve(expectedUserData) === path.resolve(app.getPath("userData"));
  const runtimeOwner: {
    current: AppRuntime<ClientRuntime, SocketManager> | null;
  } = { current: null };
  const clientRuntime = new ClientRuntime({
    paths,
    hostVersion: app.getVersion(),
    cachedOnly: process.env.GW_REQUIRE_CACHED_CLIENT === "1",
    offlineShell: process.env.GW_OFFLINE_SHELL === "1",
    enhancementsEnabled: enhancementsEnabledFor(settings),
    onProgress: (progress) => runtimeOwner.current?.publishProgress(progress),
    onPrefetch: (progress) => runtimeOwner.current?.publishPrefetch(progress),
  });
  const socketOwner: { current: SocketManager | null } = { current: null };
  const windows = new WindowRegistry(1, (ownerId) => {
    socketOwner.current?.closeAll(ownerId);
  });
  const sockets = buildSocketManager(windows);
  socketOwner.current = sockets;
  const runtime = new AppRuntime(
    clientRuntime,
    sockets,
    windows,
    paths.settings,
    {
      flushWindowState: () => windowState.flush(),
      clearBrowserCookies: () => clearBrowserCookies(gameSession, "quit"),
      stopDiagnostics,
      updateLongRunningTaskFeedback,
    },
  );
  runtimeOwner.current = runtime;
  activeRuntime = runtime;
  powerMonitor.on("suspend", () => {
    if (!clientRuntime.isDownloading) return;
    logEvent({ k: "fullDownload.stoppedForSleep" });
    clientRuntime.stopDownload();
  });
  setProtocolDeps({
    getActiveClient: () => clientRuntime.active,
  });
  installGameSession(gameSession, windows, gameProtocolHandler);
  logEvent({ k: "protocol.installed" });

  registerIpcHandlers({
    windows,
    sockets,
    getProfile: async (id) => {
      const found = (await profileBootstrap.store.scan()).profiles.find(
        (candidate) => candidate.id === id,
      );
      if (!found) throw new Error("profile no longer exists");
      return found;
    },
    getProgress: () => clientRuntime.progress,
    getChunkStore: () => clientRuntime.active?.store ?? null,
    getSettings: () => runtime.getSettings(),
    updateSettings: (patch) => runtime.updateSettings(patch),
    resetSettings: () => runtime.resetSettings(),
    resetWindowState: (win) => windowState.reset(win),
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
    await runtime.dispose();
    if (activeRuntime === runtime) activeRuntime = null;
  });

  const win = createMainWindow(
    buildWindowHost(
      runtime,
      profile,
      gameSession,
      windowState,
      enhancementSelection,
    ),
    windows,
  );
  if (secondInstanceRequested) win.once("ready-to-show", revealMainWindow);
  if (ENHANCEMENT_AUTOMATION_ENABLED) {
    process.on("message", (message) => {
      if (message === AUTOMATION_COMMAND.startLevel1Capture) {
        const target = windows.gameWindow();
        if (!target) return;
        void startDiagnosticCapture(target, 1).catch((error) => {
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
      const win = windows.gameWindow();
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
    runtime.publishProgress({ phase: "error", errorCode: "wrong_profile" });
  }

  app.on("activate", () => {
    if (!windows.gameWindow()) {
      createMainWindow(
        buildWindowHost(
          runtime,
          profile,
          gameSession,
          windowState,
          enhancementSelection,
        ),
        windows,
      );
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
