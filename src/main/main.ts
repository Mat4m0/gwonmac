/**
 * The composition root: it constructs the subsystems, wires them to one
 * another, and owns the order in which a launch happens.
 *
 * Nothing here implements a behaviour. Every rule this file appears to make —
 * what a setting is, when an update may be checked, which module is served,
 * which secrets are available — belongs to the module it hands the work to, and
 * a decision that starts growing here belongs somewhere else. What main owns is
 * sequence and lifetime: the single-instance lock, the work that must precede
 * `ready`, the profile location, and what is registered to run at quit.
 */
import {
  app,
  autoUpdater,
  dialog,
  Notification,
  powerMonitor,
  session,
} from "electron";
import { readFileSync } from "node:fs";
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
} from "../shared/contracts.js";
import {
  enhancementCapabilitiesFor,
  type EnhancementProgram,
  type EnhancementSelection,
} from "../shared/enhancement-contracts.js";
import { errorCode } from "../shared/errors.js";
import { EMPTY_PREFETCH, INITIAL_PROGRESS } from "../shared/progress.js";
import { AUTOMATION_COMMAND } from "../shared/automation.js";
import { ClientRuntime } from "./client-runtime.js";
import { Mutex } from "./core/mutex.js";
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
import type { AppPhase } from "./diagnostics/schema-fields.js";
import { emitSocketEvent, registerIpcHandlers } from "./ipc.js";
import {
  AppUpdater,
  PERIODIC_CHECK_TICK_MS,
  periodicCheckDue,
} from "./app-updater.js";
import {
  CertificateFeedDelivery,
  CERTIFICATE_FEED_REFUSALS,
} from "./certification/certificate-feed-delivery.js";
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
import { gamePaths } from "./paths.js";
import {
  DEVELOPER_ENHANCEMENT_PROGRAM,
  ENHANCEMENT_AUTOMATION_ENABLED,
  enhancementSelectionFor,
} from "./certification/enhancement-policy.js";
import { installGwProtocolHandler, registerGwScheme, setProtocolDeps } from "./protocol.js";
import {
  createMainWindow,
  flushWindowState,
  getMainWindow,
  prepareWindowState,
  RENDERER_URL,
  type WindowHost,
  updateLongRunningTaskFeedback,
} from "./window.js";
import { exportProblemReport } from "./problem-report.js";
import { resetGameInput, sendRendererCommand } from "./renderer-commands.js";
import { STEAM_OAUTH } from "./core/steam-oauth.js";
import { acquireSteamToken } from "./steam-acquire.js";
import { CredentialsStore } from "./core/credentials.js";
import { SteamSessionStore } from "./core/steam-session.js";
import {
  VolatileNativeKeychain,
  type NativeKeychain,
} from "./core/native-keychain.js";
import { loadNativeKeychain } from "./native-keychain.js";
import { cleanupLegacySecretFiles } from "./core/legacy-secret-cleanup.js";
import {
  distributionCapabilities,
  isDistributionChannel,
  parseDistributionMarker,
  type DistributionChannel,
} from "../shared/distribution-channel.js";

// The public app name changed after alpha profiles already existed. Keep that
// one profile as the canonical home so the rename cannot strand saved login,
// settings, diagnostics, or roughly 4 GB of verified game data. An explicit
// profile remains authoritative for tests and the deliberately scoped tools.
if (!app.commandLine.hasSwitch("user-data-dir")) {
  app.setPath("userData", path.join(app.getPath("appData"), "Guild Wars"));
}

const primaryInstance = app.requestSingleInstanceLock();
if (!primaryInstance) {
  app.quit();
} else {
  enableSandboxBeforeReady();
  registerGwScheme();
  wireLifecycle();
}

const HOST_VERSION = (() => {
  try {
    const manifest = JSON.parse(
      readFileSync(path.join(app.getAppPath(), "package.json"), "utf8"),
    ) as unknown;
    if (
      typeof manifest === "object"
      && manifest !== null
      && !Array.isArray(manifest)
    ) {
      const version = (manifest as Record<string, unknown>).version;
      if (typeof version === "string") return version;
    }
  } catch {
    // Electron's answer remains the safe fallback for a broken development
    // checkout. Official packages always carry their package manifest.
  }
  return app.getVersion();
})();

const prefetch: PrefetchProgress = { ...EMPTY_PREFETCH };
/** Every settings write is a read-modify-write of one file. */
const settingsLock = new Mutex();
let appUpdaterController: AppUpdater | null = null;
let certificateFeedDelivery: CertificateFeedDelivery | null = null;
let updateRestartInFlight: Promise<void> | null = null;
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

/**
 * The one "ask this project what is new" action. AppUpdater is the application
 * update owner. The transitional certificate-feed path shares its trigger and
 * consent rather than owning another scheduler; the accepted refactor plan
 * removes that non-operational remote authority.
 */
async function checkForProjectUpdates(): Promise<void> {
  await Promise.allSettled([
    appUpdaterController?.check() ?? Promise.resolve(),
    certificateFeedDelivery?.refresh() ?? Promise.resolve(),
  ]);
}

function updateAppSettings(patch: AppSettingsPatch): Promise<AppSettings> {
  return settingsLock.run(async () => {
    const settingsPath = gamePaths().settings;
    const current = await loadSettings(settingsPath);
    const saved = await saveSettings(settingsPath, { ...current, ...patch });
    if (!current.autoCheckUpdates && saved.autoCheckUpdates) {
      void checkForProjectUpdates();
    }
    return saved;
  });
}

/**
 * The pinned certificate-feed key. A packaged build reads it from the bundle's
 * Resources, where the code signature seals it; an unpackaged one reads the
 * committed real public key.
 *
 * The unpackaged override is how the Electron suite exercises a signed feed
 * with a keypair it generates per run without changing repository state. It is
 * unreachable from a packaged build.
 */
function pinnedCertificateFeedKeyPath(): string {
  if (app.isPackaged) return path.join(process.resourcesPath, "public-key.txt");
  return (
    process.env.GW_TEST_CERTIFICATE_FEED_KEY
    ?? path.join(app.getAppPath(), "certificates", "public-key.txt")
  );
}

function resetAppSettings(): Promise<AppSettings> {
  return settingsLock.run(() =>
    saveSettings(gamePaths().settings, { ...DEFAULT_SETTINGS }),
  );
}

function buildSocketManager(): SocketManager {
  return new SocketManager(
    (ownerId, event) => {
      if (event.type === "open") {
        logEvent({ k: "socket.open", socketId: event.socketId, port: event.port });
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

function packagedDistributionChannel(): DistributionChannel | null {
  if (!app.isPackaged) {
    const channel = process.env.GW_TEST_DISTRIBUTION_CHANNEL;
    return isDistributionChannel(channel) ? channel : null;
  }
  if (process.platform !== "darwin") return null;
  try {
    const marker = JSON.parse(
      readFileSync(
        path.join(process.resourcesPath, "distribution-channel.json"),
        "utf8",
      ),
    ) as unknown;
    return parseDistributionMarker(marker)?.channel ?? null;
  } catch {
    return null;
  }
}

async function ensureDirs(): Promise<void> {
  const paths = gamePaths();
  await mkdir(paths.game, { recursive: true });
  await mkdir(paths.chunks, { recursive: true });
  await mkdir(paths.diagnostics, { recursive: true });
  // On the first open of the directories we own, remove incomplete atomic
  // writes. A process killed between
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
  enhancementSelection: EnhancementSelection,
  enhancementProgram: EnhancementProgram,
): WindowHost {
  return {
    sockets,
    enhancementSelection,
    enhancementProgram,
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
    applicationName: app.getName(),
    applicationVersion: HOST_VERSION,
    version: HOST_VERSION,
    copyright:
      "Independent GPL-3.0 project · Guild Wars © ArenaNet LLC.",
    credits:
      "Mat4m0/gwonmac · App icon artwork © ArenaNet LLC · QT Friz Quad © 1992 QualiType (SIL OFL 1.1) · Not affiliated with ArenaNet or NCSOFT.",
    website: EXTERNAL_URLS.github,
  });
  await applyPendingCacheClear();
  await applyPendingGameStorageClear();
  await ensureDirs();
  await startDiagnostics();
  const distributionChannel = packagedDistributionChannel();
  const distribution = distributionCapabilities(distributionChannel);
  if (!app.isPackaged) {
    console.warn(
      "Saved login is memory-only in pnpm dev; use pnpm dev:signed for persistent development credentials.",
    );
  }
  const persistentSecrets =
    app.isPackaged
    && distribution.persistentSecrets
    && !app.commandLine.hasSwitch("gw-volatile-secrets");
  if (persistentSecrets && distribution.cleanupLegacySecrets) {
    const legacySecretFailures = await cleanupLegacySecretFiles(
      app.getPath("userData"),
      rm,
    );
    for (const failure of legacySecretFailures) {
      logEvent({ k: "legacySecrets.cleanupFailed", code: errorCode(failure) });
    }
  }
  const obsoleteCacheError = await discardObsoleteEnhancementCache(
    gamePaths(),
    rm,
  );
  if (obsoleteCacheError !== null) {
    // This is a derived beta cache. Failure must not block the canonical client.
    logEvent({
      k: "enhancement.obsoleteCacheDiscardFailed",
      code: errorCode(obsoleteCacheError),
    });
  }
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
  const enhancementSelection = enhancementSelectionFor(settings);
  const enhancementProgram = DEVELOPER_ENHANCEMENT_PROGRAM;
  const enhancementCapabilities = enhancementCapabilitiesFor(
    enhancementSelection,
    enhancementProgram,
  );
  await prepareWindowState();
  const paths = gamePaths();
  const keychain: NativeKeychain = persistentSecrets
    ? loadNativeKeychain({
        packaged: true,
        appPath: app.getAppPath(),
        resourcesPath: process.resourcesPath,
      })
    : new VolatileNativeKeychain();
  const credentialsStore = new CredentialsStore(keychain);
  const steamSessionStore = new SteamSessionStore(keychain);
  const expectedUserData = process.env.GW_EXPECT_USER_DATA;
  const profileMatches =
    !expectedUserData ||
    path.resolve(expectedUserData) === path.resolve(app.getPath("userData"));
  certificateFeedDelivery = new CertificateFeedDelivery({
    storePath: paths.certificateFeed,
    pinnedKeyPath: pinnedCertificateFeedKeyPath(),
    // The same answer that decides whether an automatic release check may
    // reach the network. One predicate, so the two cannot disagree about what
    // the player consented to.
    enabled: distribution.automaticUpdates,
    publish: (status) => {
      gauge("certificateFeed.source", status.source);
      gauge("certificateFeed.sequence", status.sequence);
      gauge("certificateFeed.outcome", status.outcome);
      gauge("certificateFeed.lastSuccessAt", status.lastSuccessAt);
      if (CERTIFICATE_FEED_REFUSALS.has(status.outcome)) {
        logEvent({ k: "certificateFeed.refused", outcome: status.outcome });
      } else {
        logEvent({
          k: "certificateFeed.resolved",
          source: status.source,
          sequence: status.sequence,
          outcome: status.outcome,
        });
      }
    },
  });
  // Before the first certification pass: a feed that governs only after the
  // launch it arrived on would answer one question two ways in one session.
  await certificateFeedDelivery.load();
  const clientRuntime = new ClientRuntime({
    paths,
    hostVersion: HOST_VERSION,
    cachedOnly: process.env.GW_REQUIRE_CACHED_CLIENT === "1",
    offlineShell: process.env.GW_OFFLINE_SHELL === "1",
    enhancementCapabilities,
    // The environment variable is a developer/qualification shortcut only.
    // Saved settings remain the sole durable request made by the product UI.
    extendedMemoryEnabled:
      settings.extendedMemoryEnabled
      || process.env.GWONMAC_EXTENDED_MEMORY_RESEARCH === "1",
    certificateFeed: () => certificateFeedDelivery!.feed,
    onProgress: setProgress,
    onPrefetch: setPrefetch,
  });
  const sockets = buildSocketManager();
  appUpdaterController = new AppUpdater({
    currentVersion: HOST_VERSION,
    capable: distribution.automaticUpdates,
    nativeUpdater: {
      setFeedURL: (options) => autoUpdater.setFeedURL(options),
      checkForUpdates: () => {
        autoUpdater.checkForUpdates();
      },
      quitAndInstall: () => autoUpdater.quitAndInstall(),
    },
    rememberCheckedAt: async (lastUpdateCheckAt) => {
      await updateAppSettings({ lastUpdateCheckAt });
    },
    recordFailure: (stage, reason) => {
      logEvent({ k: "appUpdate.requestFailed", stage, reason });
    },
    publish: (state) => {
      if (state.phase === "failed") {
        logEvent({ k: "appUpdate.failed", reason: state.reason });
      }
      if (
        app.isPackaged
        && state.phase === "ready"
        && Notification.isSupported()
      ) {
        new Notification({
          title: "Guild Wars Reforged update ready",
          body: `Version ${state.latestVersion} will install when you restart.`,
          silent: true,
        }).show();
      }
      sendToRenderer(IPC.appUpdatesState, state);
    },
  });
  appUpdaterController.restoreLastCheckedAt(settings.lastUpdateCheckAt);
  autoUpdater.on("update-downloaded", () => {
    appUpdaterController?.updateDownloaded();
  });
  autoUpdater.on("error", () => {
    appUpdaterController?.updateFailed();
  });
  autoUpdater.on("update-not-available", () => {
    appUpdaterController?.updateNotAvailable();
  });
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

  const ipcCleanup = registerIpcHandlers({
    sockets,
    credentialsStore,
    steamSessionStore,
    getProgress: () => clientRuntime.progress,
    getChunkStore: () => clientRuntime.active?.store ?? null,
    getSettings: () => loadSettings(gamePaths().settings),
    updateSettings: updateAppSettings,
    resetSettings: resetAppSettings,
    toolsCapableAtLaunch: settings.gwonmacTools,
    downloadFullGame: () => clientRuntime.downloadAll(),
    stopFullDownload: () => clientRuntime.stopDownload(),
    confirmClientHealthy: (token) =>
      clientRuntime.confirmCandidateHealthy(token),
    // A retry is a request to run the update again, nothing more. Whether it
    // worked is already on the progress channel, which is where the renderer
    // reads it — a second, thrown answer would have been a second owner.
    retryClient: () => clientRuntime.requestUpdate(),
    getAppUpdateState: () => appUpdaterController!.getState(),
    checkAppUpdates: () => checkForProjectUpdates(),
    restartAndInstallUpdate: (win) => {
      if (updateRestartInFlight) return updateRestartInFlight;
      const operation = (async () => {
        if (appUpdaterController?.getState().phase !== "ready") return;
        await resetGameInput(win);
        if (sockets.size() > 0) {
          const { response } = await dialog.showMessageBox(win, {
            type: "warning",
            buttons: ["Restart and Update", "Later"],
            defaultId: 1,
            cancelId: 1,
            message: "Restart and update Guild Wars?",
            detail:
              "The current game connection will close. The downloaded update remains ready if you choose Later.",
          });
          if (response !== 0) return;
        }
        await runQuitCleanup();
        appUpdaterController.quitAndInstall();
      })().finally(() => {
        if (updateRestartInFlight === operation) updateRestartInFlight = null;
      });
      updateRestartInFlight = operation;
      return operation;
    },
    getClientSession: () => ({
      appVersion: HOST_VERSION,
      compatibility: clientRuntime.compatibility,
      extendedMemory: clientRuntime.extendedMemory,
      healthToken: clientRuntime.healthToken,
    }),
    exportProblemReport: (win) =>
      exportProblemReport(win, () => exportDiagnosticsForWindow(win)),
    acquireSteamToken: (parent, record) =>
      acquireSteamToken(STEAM_OAUTH, { parent, record }),
  });

  onAppQuit(async () => {
    const win = getMainWindow();
    if (win && !win.isDestroyed()) {
      const outcome = await sendRendererCommand(win, {
        type: "filesystem.sync",
      });
      if (outcome !== "completed") {
        logEvent({ k: "quit.rendererSyncIncomplete", outcome });
      }
    }
    await ipcCleanup.drainSecrets();
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
    enhancementSelection,
    enhancementProgram,
  ));
  if (settings.autoCheckUpdates) {
    void checkForProjectUpdates();
  }
  // A 30-minute tick with a six-hour due-time instead of a six-hour timer:
  // a laptop waking past the boundary checks within half an hour, with no
  // resume handler and no new diagnostic event. check() already coalesces,
  // so a due tick during a download or a ready update is a no-op.
  const periodicCheckTick = setInterval(() => {
    void (async () => {
      const current = await loadSettings(gamePaths().settings);
      if (!periodicCheckDue({
        capable: distribution.automaticUpdates,
        autoCheckUpdates: current.autoCheckUpdates,
        activeSockets: sockets.size(),
        lastUpdateCheckAt: current.lastUpdateCheckAt,
        now: Date.now(),
      })) return;
      void checkForProjectUpdates();
    })().catch(() => {
      // A periodic check is silent by contract; an unreadable settings file
      // already surfaces on the next explicit settings read.
    });
  }, PERIODIC_CHECK_TICK_MS);
  onAppQuit(() => clearInterval(periodicCheckTick));
  if (secondInstanceRequested) win.once("ready-to-show", revealMainWindow);
  if (ENHANCEMENT_AUTOMATION_ENABLED) {
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
      createMainWindow(buildWindowHost(
        clientRuntime,
        sockets,
        enhancementSelection,
        enhancementProgram,
      ));
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
