/**
 * The composition root: it constructs the subsystems, wires them to one
 * another, and owns the order in which a launch happens.
 *
 * Main owns app-wide sequence, lifetime, and presentation: the single-instance
 * lock, work that must precede `ready`, the profile location, top-level dialogs,
 * and quit registration. Feature rules belong to the module it hands work to;
 * a feature decision that starts growing here should move to that owner.
 */
import {
  app,
  autoUpdater,
  type BrowserWindow,
  dialog,
  Notification,
  powerMonitor,
  session,
  systemPreferences,
} from "electron";
import { readFileSync } from "node:fs";
import { access, mkdir, rm } from "node:fs/promises";
import path from "node:path";
import {
  EXTERNAL_URLS,
  IPC,
  type AppSettings,
  type DownloadProgress,
  type DiagnosticProfile,
  type UpdateTrack,
} from "../shared/contracts.js";
import {
  NO_ENHANCEMENT_CAPABILITIES,
  enhancementCapabilityProfile,
  type EnhancementProgram,
  type EnhancementSelection,
} from "../shared/enhancement-contracts.js";
import { errorCode } from "../shared/errors.js";
import { INITIAL_PROGRESS } from "../shared/progress.js";
import { diagnosticProfilePolicy } from "../shared/diagnostic-profile.js";
import { AUTOMATION_COMMAND } from "../shared/automation.js";
import { ClientRuntime } from "./client-runtime.js";
import { RendererClientSessions } from "./renderer-client-sessions.js";
import { loadSettings } from "./core/settings.js";
import {
  loadDiagnosticProfile,
  saveDiagnosticProfile,
} from "./core/diagnostic-profile.js";
import { PreferencesCoordinator } from "./core/preferences-coordinator.js";
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
  stopDiagnosticCaptureForWindow,
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
  enableSandboxBeforeReady,
  onAppQuit,
  runQuitCleanup,
  wireLifecycle,
} from "./lifecycle.js";
import { sweepOrphanDirectories } from "./core/atomic-file.js";
import { documentDirectories } from "./core/paths.js";
import { gamePaths } from "./paths.js";
import {
  DEVELOPER_ENHANCEMENT_PROGRAM,
  ENHANCEMENT_AUTOMATION_ENABLED,
  enhancementSelectionFor,
  requestedEnhancementCapabilities,
} from "./certification/enhancement-policy.js";
import { registerGwScheme } from "./protocol.js";
import {
  flushWindowState,
  prepareWindowState,
  RENDERER_URL,
  requestGameQuit,
  type WindowHost,
  updateLongRunningTaskFeedback,
} from "./window.js";
import {
  releaseWindowShortcutKey,
  updateWindowShortcuts,
} from './window-shortcuts.js';
import { exportDiagnosticsReport } from "./diagnostics-export.js";
import { reportVisualProblem } from "./visual-problem-report.js";
import { resetGameInput, sendRendererCommand } from "./renderer-commands.js";
import { STEAM_OAUTH } from "./core/steam-oauth.js";
import { acquireSteamToken } from "./steam-acquire.js";
import {
  VolatileNativeKeychain,
  type NativeKeychain,
} from "./core/native-keychain.js";
import { loadNativeHost } from "./native-host.js";
import { installMacosCommandKeyUps } from "./macos-command-key-ups.js";
import { recordMainInput } from './input-trace.js';
import { cleanupLegacySecretFiles } from "./core/legacy-secret-cleanup.js";
import {
  distributionCapabilities,
  isDistributionChannel,
  parseDistributionMarker,
  type DistributionChannel,
} from "../shared/distribution-channel.js";
import {
  applyPendingCacheClear,
  applyPendingGameStorageReset,
} from "./settings-actions.js";
import { windowRegistry } from "./window-registry.js";
import {
  bootstrapAccountWorkspace,
  loadAccountMode,
} from "./core/multiple-accounts.js";
import { createLauncherWindow } from "./accounts-window.js";
import { MultipleAccountsController } from "./multiple-accounts-controller.js";
import { WindowCoordinator } from "./window-coordinator.js";
import { GameReloader } from "./game-reload.js";
import { updateToolsMenuItems } from "./window-menu.js";
import { resolveAdoptedProfileStorage } from "./core/profile-storage.js";
import {
  LauncherStateStore,
  classifyLauncherInstallation,
  loadOrCreateLauncherState,
} from "./core/launcher-state.js";
import { LauncherOrchestrator } from "./launcher-orchestrator.js";
import { registerLauncherIpc } from "./launcher-ipc.js";
import { LAUNCHER_IPC } from "../shared/launcher-contracts.js";
import { sendIfLive } from "./ipc-channel-registry.js";

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

const preferences = new PreferencesCoordinator(
  () => gamePaths(),
  () => logEvent({ k: "travelPreferences.corruptRecovered" }),
  publishSettings,
);
let appUpdaterController: AppUpdater | null = null;
const rendererClientSessions = new RendererClientSessions<BrowserWindow>();
const SINGLE_DIAGNOSTIC_OWNER_ID = 1;
let updateRestartInFlight: Promise<void> | null = null;
let secondInstanceRequested = false;
const windowCoordinator = new WindowCoordinator(
  {
    ...(app.dock ? { dock: app.dock } : {}),
    focus: (options) => app.focus(options),
  },
  windowRegistry,
);
const INJECT_STARTUP_FAILURE =
  !app.isPackaged && process.env.GW_TEST_STARTUP_FAILURE === "1";

function revealMainWindow(): void {
  if (!windowCoordinator.revealLauncher({ activateApp: true })) {
    secondInstanceRequested = true;
  }
  else secondInstanceRequested = false;
}

/** The one application-update action; AppUpdater owns every outcome. */
async function checkForAppUpdates(track?: UpdateTrack): Promise<void> {
  const selected = track ?? (await preferences.getSettings()).updateTrack;
  await appUpdaterController?.check(selected);
}

function buildSocketManager(): SocketManager {
  return new SocketManager(
    (ownerId, event) => {
      const diagnosticOwnerId =
        windowRegistry.diagnosticOwnerForWebContents(ownerId);
      if (event.type === "open") {
        if (diagnosticOwnerId !== null) logEvent(
          { k: "socket.open", socketId: event.socketId, port: event.port },
          diagnosticOwnerId,
        );
      } else if (event.type === "close") {
        if (diagnosticOwnerId !== null) logEvent({
          k: "socket.close",
          socketId: event.socketId,
          reason: event.reason,
        }, diagnosticOwnerId);
      } else if (event.type === "error") {
        if (diagnosticOwnerId !== null) logEvent({
          k: "socket.error",
          socketId: event.socketId,
          code: event.code,
        }, diagnosticOwnerId);
      }
      emitSocketEvent(ownerId, event);
    },
    {
      count: (name, delta, ownerId) => {
        const diagnosticOwnerId = ownerId === undefined
          ? null
          : windowRegistry.diagnosticOwnerForWebContents(ownerId);
        if (diagnosticOwnerId !== null) count(name, delta, diagnosticOwnerId);
      },
      observe: (name, durationUs, ownerId) => {
        const diagnosticOwnerId = ownerId === undefined
          ? null
          : windowRegistry.diagnosticOwnerForWebContents(ownerId);
        if (diagnosticOwnerId !== null) {
          observe(name, durationUs, diagnosticOwnerId);
        }
      },
      gauge,
      peakGauge,
    },
    // An unpackaged Electron test may replace the production destination
    // validator with one that admits exactly its loopback fixture. Production
    // still uses the public-ArenaNet allowlist and grants no such exception.
    !app.isPackaged && process.env.GW_TEST_SOCKET_LOOPBACK === "1"
      ? (destination) => {
          if (destination !== "127.0.0.1:6112") {
            throw new Error(
              "test socket fixture permits only 127.0.0.1:6112",
            );
          }
          return { host: "127.0.0.1", port: 6112, family: 4 };
        }
      : undefined,
  );
}

function setProgress(next: DownloadProgress): void {
  const windows = windowRegistry.windows();
  if (windows.length === 0) updateLongRunningTaskFeedback(next, null);
  else {
    for (const win of windows) updateLongRunningTaskFeedback(next, win);
  }
  sendToRenderer(IPC.progressEvent, next);
  launcherOrchestrator?.clientChanged();
}

let launcherOrchestrator: LauncherOrchestrator | null = null;

function sendToRenderer(channel: string, value: unknown): void {
  for (const win of windowRegistry.windows()) {
    if (win.isDestroyed() || win.webContents.isDestroyed()) continue;
    try {
      win.webContents.send(channel, value);
    } catch {
      // Renderer teardown can race a native progress callback.
    }
  }
}

/** Publish the one durable Settings snapshot to every live game projection. */
let applyToolsSettings: ((settings: AppSettings) => Promise<void>) | null = null;

async function publishSettings(settings: AppSettings): Promise<void> {
  await applyToolsSettings?.(settings);
  updateToolsMenuItems(settings);
  for (const win of windowRegistry.gameWindows()) {
    updateWindowShortcuts(win, settings);
  }
  sendToRenderer(IPC.settingsEvent, settings);
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

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

/** Classify released Single data before the candidate publishes any owner. */
async function hasReleasedSingleData(paths: ReturnType<typeof gamePaths>): Promise<boolean> {
  if (await pathExists(paths.launcherMode)) {
    try {
      return await loadAccountMode(paths.launcherMode) === "single";
    } catch {
      // The old mode document is not operational state anymore. Preserve it
      // byte-for-byte and fall back to canonical Single-owned evidence.
    }
  }
  return (await Promise.all([
    paths.settings,
    paths.buildLibrary,
    paths.windowState,
    path.join(paths.userData, "IndexedDB"),
    path.join(paths.userData, "Local Storage"),
  ].map(pathExists))).some(Boolean);
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
  const roots = documentDirectories(paths);
  roots.push(paths.multiRoot, paths.multiProfiles);
  const removed = await sweepOrphanDirectories(roots);
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

function buildWindowHost(
  clientRuntime: ClientRuntime,
  sockets: SocketManager,
  enhancementSelection: EnhancementSelection,
  enhancementProgram: EnhancementProgram,
  diagnosticProfile: DiagnosticProfile,
): WindowHost {
  const gameReloader = new GameReloader({
    sockets,
    getSettings: () => preferences.getSettings(),
    diagnosticOwner: (win) =>
      windowRegistry.requireDiagnosticOwnerForWindow(win),
    record: logEvent,
    sync: (win) => sendRendererCommand(win, { type: "filesystem.sync" }),
    load: (win, url) => win.loadURL(url),
    rendererUrl: RENDERER_URL,
  });
  return {
    sockets,
    enhancementSelection,
    enhancementProgram,
    diagnosticProfile,
    getProgress: () => clientRuntime.progress,
    getSettings: () => preferences.getSettings(),
    updateSettings: (patch) => preferences.updateSettings(patch),
    exportDiagnostics: (win) =>
      clientRuntime.diagnosticState().then((runtimeState) =>
        exportDiagnosticsForWindow(win, () => preferences.getSettings(), {
          runtimeState,
        })),
    reportVisualProblem: (win) =>
      reportVisualProblem(
        win,
        () => preferences.getSettings(),
        () => clientRuntime.diagnosticState(),
      ),
    markPerformanceProblem,
    startCapture: startDiagnosticCapture,
    stopCapture: stopDiagnosticCaptureForWindow,
    reloadGame: (win, cause) => gameReloader.reload(win, cause),
    claimRelogIntent: (win) => gameReloader.claimRelogIntent(win),
    requestQuit: requestGameQuit,
    prepareRendererRecovery: async () => {
      await clientRuntime.recoverRendererCrash();
    },
    gameWindowClosed: () => {
      windowCoordinator.afterGameClosed();
    },
  };
}

if (primaryInstance) app.on("second-instance", revealMainWindow);

if (primaryInstance) void app.whenReady().then(async () => {
  if (INJECT_STARTUP_FAILURE) {
    throw new Error("injected startup failure");
  }
  // AppKit reads this bundle-specific persistent preference when it creates
  // text clients. Set it before any BrowserWindow can construct one. This does
  // not change the global macOS keyboard preference or synthesize cadence.
  if (process.platform === "darwin") {
    systemPreferences.setUserDefault(
      "ApplePressAndHoldEnabled",
      "boolean",
      false,
    );
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
  const nativeHost = loadNativeHost({
    packaged: app.isPackaged,
    appPath: app.getAppPath(),
    resourcesPath: process.resourcesPath,
  });
  const stopCommandKeyUps = installMacosCommandKeyUps(nativeHost, {
    focusedGameTarget() {
      return windowRegistry.focusedGameWindow();
    },
    release(win, code) {
      releaseWindowShortcutKey(win, code);
      recordMainInput(win, {
        source: 'appkit',
        kind: 'native-key',
        phase: 'up',
        key: code.startsWith('Key') || code.startsWith('Digit')
          ? 'printable'
          : 'other',
        repeat: false,
        decision: 'normalized-release',
      });
      void sendRendererCommand(win, { type: "input.release", code });
    },
  });
  app.once("will-quit", () => stopCommandKeyUps());
  const paths = gamePaths();
  const legacySingleData = await hasReleasedSingleData(paths);
  const workspaceExisted = await pathExists(paths.multiWorkspace);
  const loadedLauncherState = await loadOrCreateLauncherState(
    paths.launcherState,
    classifyLauncherInstallation({ legacySingleData, existingWorkspace: workspaceExisted }),
  );
  const launcherState = new LauncherStateStore(
    paths.launcherState,
    loadedLauncherState.document,
    loadedLauncherState.recoveredFromCorruption,
  );
  let accountWorkspace;
  for (;;) {
    try {
      accountWorkspace = await bootstrapAccountWorkspace(
        paths.multiWorkspace,
        legacySingleData,
      );
      break;
    } catch {
      const { response } = await dialog.showMessageBox({
        type: "warning",
        buttons: ["Retry", "Quit"],
        defaultId: 0,
        cancelId: 1,
        message: "Account profiles could not be opened",
        detail:
          "No account data was changed. Retry after fixing the workspace, or quit and report the problem.",
      });
      if (response === 0) continue;
      app.quit();
      return;
    }
  }
  const adoptedStorage = resolveAdoptedProfileStorage(accountWorkspace, paths);
  await applyPendingCacheClear(paths);
  if (adoptedStorage) {
    await applyPendingGameStorageReset(paths, SINGLE_DIAGNOSTIC_OWNER_ID);
  }
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
  if (
    adoptedStorage
    && persistentSecrets
    && distribution.cleanupLegacySecrets
  ) {
    const legacySecretFailures = await cleanupLegacySecretFiles(
      app.getPath("userData"),
      rm,
    );
    for (const failure of legacySecretFailures) {
      logEvent({ k: "legacySecrets.cleanupFailed", code: errorCode(failure) });
    }
  }
  if (adoptedStorage) {
    await clearBrowserCookies("startup");
    await clearBrowserNetworkCache();
  }
  logEvent({ k: "electron.ready" });
  const settings = await loadSettings(paths.settings, async () => {
    logEvent({ k: "settings.corruptRecovered" });
    await dialog.showMessageBox({
      type: "warning",
      buttons: ["Continue"],
      message: "Settings were reset",
      detail:
        "The settings file was corrupt. Defaults were restored and a diagnostic copy was preserved.",
    });
  });
  let diagnosticProfile = await loadDiagnosticProfile(paths.diagnosticProfile);
  const diagnosticPolicy = diagnosticProfilePolicy(diagnosticProfile);
  const enhancementSelection: EnhancementSelection = diagnosticPolicy.officialClient
    ? Object.freeze({ nativeCursor: false, tools: false })
    : enhancementSelectionFor(settings);
  const enhancementProgram = DEVELOPER_ENHANCEMENT_PROGRAM;
  const enhancementCapabilities = diagnosticPolicy.officialClient
    ? NO_ENHANCEMENT_CAPABILITIES
    : requestedEnhancementCapabilities(settings, enhancementProgram);
  logEvent({
    k: "enhancement.launchSelected",
    buildKind: app.isPackaged ? "packaged" : "development",
    program: enhancementProgram,
    toolsAtLaunch: enhancementSelection.tools,
    diagnosticProfile,
    requestedProfile: enhancementCapabilityProfile(enhancementCapabilities),
  });
  if (adoptedStorage) {
    await prepareWindowState(SINGLE_DIAGNOSTIC_OWNER_ID, adoptedStorage.windowState);
  }
  const keychain: NativeKeychain = persistentSecrets
    ? nativeHost
    : new VolatileNativeKeychain();
  const expectedUserData = process.env.GW_EXPECT_USER_DATA;
  const profileMatches =
    !expectedUserData ||
    path.resolve(expectedUserData) === path.resolve(app.getPath("userData"));
  const clientRuntime = new ClientRuntime({
    paths,
    hostVersion: HOST_VERSION,
    cachedOnly: process.env.GW_REQUIRE_CACHED_CLIENT === "1",
    enhancementCapabilities,
    enhancementProgram,
    extendedMemoryEnabled: settings.extendedMemoryEnabled,
    diagnosticProfile,
    onProgress: setProgress,
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
      await preferences.updateSettings({ lastUpdateCheckAt });
    },
    recordFailure: (reason) => {
      logEvent({ k: "appUpdate.requestFailed", reason });
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
          body: `Version ${state.latestVersion} is ready to install.`,
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
  const protocolDeps = {
    getActiveClient: () => clientRuntime.active,
    diagnosticOwnerId: () => SINGLE_DIAGNOSTIC_OWNER_ID,
  };
  const host = buildWindowHost(
    clientRuntime,
    sockets,
    enhancementSelection,
    enhancementProgram,
    diagnosticProfile,
  );
  const accounts = new MultipleAccountsController({
    workspace: accountWorkspace,
    paths,
    keychain,
    clientRuntime,
    protocol: protocolDeps,
    windowHost: host,
    windows: windowCoordinator,
    publishState: (state) => {
      sendToRenderer(IPC.accountsState, state);
      launcherOrchestrator?.publish();
    },
    allowUnreadyLaunch:
      (!app.isPackaged || distributionChannel === null)
      && process.env.GW_TEST_ALLOW_UNREADY_LAUNCH === "1",
  });
  await accounts.resumePendingDeletions();
  const toolsRuntime = enhancementSelection.tools
    ? (await import("./tools-runtime.js")).createToolsRuntime({
        paths,
        windows: windowRegistry,
        accounts,
        preferences,
        initialSettings: settings,
      })
    : null;
  applyToolsSettings = toolsRuntime?.applySettings ?? null;
  await toolsRuntime?.applySettings(settings);

  launcherOrchestrator = new LauncherOrchestrator({
    accounts,
    state: launcherState,
    hasActiveClient: () => clientRuntime.active !== null,
    getProgress: () => clientRuntime.progress,
    getAppUpdate: () => appUpdaterController!.getState(),
    toolsConfigured: () => enhancementSelectionFor(settings).tools,
    toolsLoaded: () => enhancementSelection.tools,
    developmentFixtures: !app.isPackaged || process.env.GW_LAUNCHER_FIXTURES === "1",
    publish: (snapshot) => {
      const launcher = windowRegistry.launcherWindow();
      if (launcher) sendIfLive(launcher, LAUNCHER_IPC.stateEvent, snapshot);
    },
  });

  registerLauncherIpc({
    windows: windowRegistry,
    snapshot: () => launcherOrchestrator!.snapshot(),
    create: async (name) => {
      await accounts.create({ name });
    },
    setSelection: (ids) => launcherOrchestrator!.setSelection(ids),
    play: (ids) => launcherOrchestrator!.play(ids),
    show: (id) => launcherOrchestrator!.show(id),
    cancelQueued: (ids) => launcherOrchestrator!.cancel(ids),
    dismissMigrationNotice: () => launcherOrchestrator!.dismissMigrationNotice(),
    completeIntroduction: () => launcherOrchestrator!.completeIntroduction(),
    updatePreferences: (patch) => launcherOrchestrator!.updatePreferences(patch),
    checkUpdates: () => checkForAppUpdates(),
    restartAndInstall: async (_win) => {
      await appUpdaterController?.quitAndInstall();
    },
  });

  const ipcCleanup = registerIpcHandlers({
    sockets,
    windows: windowRegistry,
    credentialsStoreFor: (win) => accounts.credentialsStoreFor(win),
    steamSessionStoreFor: (win) => accounts.steamSessionStoreFor(win),
    gameStorageResetMarkerFor: (win) => accounts.gameStorageResetMarkerFor(win),
    getProgress: () => clientRuntime.progress,
    getSnapshotMetadata: () => clientRuntime.snapshotMetadata(),
    getCacheInfo: () => clientRuntime.cacheInfo(),
    getSettings: () => preferences.getSettings(),
    updateSettings: (patch) => preferences.updateSettings(patch),
    resetSettings: () => toolsRuntime?.resetSettings()
      ?? preferences.resetCoreSettings(),
    setDiagnosticProfile: async (profile) => {
      diagnosticProfile = await saveDiagnosticProfile(
        paths.diagnosticProfile,
        profile,
      );
      return diagnosticProfile;
    },
    toolsEnabledAtLaunch: enhancementSelection.tools,
    downloadFullGame: () => clientRuntime.downloadAll(),
    stopFullDownload: () => clientRuntime.stopDownload(),
    confirmClientHealthy: (token) =>
      clientRuntime.confirmCandidateHealthy(token),
    retryClient: () =>
      clientRuntime.retryClient(() => {
        // An active generation may still have protocol reads in flight. End the
        // process before startup rollback/update renames its artifact paths; the
        // replacement process then follows the ordinary no-client boot path.
        app.relaunch();
        app.quit();
      }),
    getAppUpdateState: () => appUpdaterController!.getState(),
    checkAppUpdates: () => checkForAppUpdates(),
    restartAndInstallUpdate: (win) => {
      if (updateRestartInFlight) return updateRestartInFlight;
      const updater = appUpdaterController;
      const operation = (async () => {
        if (updater?.getState().phase !== "ready") return;
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
        // Cleanup is deliberately irreversible. If Squirrel refuses the
        // terminal handoff, leave instead of resuming a process whose sockets,
        // client runtime, diagnostics, and persistence owners are gone.
        if (!updater.quitAndInstall()) app.exit(1);
      })().finally(() => {
        if (updateRestartInFlight === operation) updateRestartInFlight = null;
      });
      updateRestartInFlight = operation;
      return operation;
    },
    getClientSession: (win) => rendererClientSessions.session(
      {
        owner: win,
        documentId: win.webContents.mainFrame.routingId,
        generation: clientRuntime.active?.generation ?? 0,
      },
      clientRuntime.session(HOST_VERSION),
    ),
    recordClientFeatureFailure: (win, features) => {
      rendererClientSessions.recordFailures(
        {
          owner: win,
          documentId: win.webContents.mainFrame.routingId,
          generation: clientRuntime.active?.generation ?? 0,
        },
        clientRuntime.session(HOST_VERSION),
        features,
      );
    },
    acquireSteamToken: (parent, record) =>
      acquireSteamToken(STEAM_OAUTH, { parent, record }),
    getAccountsState: () => accounts.state(),
    openAccounts: (profileIds) => accounts.open(profileIds),
    createAccount: (request) => accounts.create(request),
    updateAccount: (request) => accounts.update(request),
    archiveAccount: (profileId) => accounts.archive(profileId),
    restoreAccount: (profileId) => accounts.restore(profileId),
    deleteAccount: (parent, profileId) => accounts.delete(parent, profileId),
    loadAccountTemplates: (win) => accounts.loadTemplates(win),
    saveAccountTemplates: (win, entries) => accounts.saveTemplates(win, entries),
    requestQuit: requestGameQuit,
    reloadGame: (win, cause) => host.reloadGame(win, cause),
    claimRelogIntent: (win) => host.claimRelogIntent(win),
  });

  onAppQuit(async () => {
    const gameWindows = windowRegistry.gameWindows();
    await Promise.all(gameWindows.map(async (win) => {
      if (!win.isDestroyed()) {
        const outcome = await sendRendererCommand(win, {
          type: "filesystem.sync",
        });
        if (outcome !== "completed") {
          logEvent({ k: "quit.rendererSyncIncomplete", outcome });
        }
      }
    }));
    await ipcCleanup.drainSecrets();
    await Promise.all(gameWindows.map((win) => flushWindowState(win)));
    sockets.closeAll();
    await toolsRuntime?.dispose();
    applyToolsSettings = null;
    updateLongRunningTaskFeedback(INITIAL_PROGRESS, null);
    await clientRuntime.shutdown();
    if (adoptedStorage) await clearBrowserCookies("quit");
    await stopDiagnostics();
  });

  const win = createLauncherWindow(protocolDeps, windowCoordinator);
  // The same persisted due-time governs launch and background checks. A player
  // who restarts repeatedly therefore does not spend another network request
  // until the previous settled attempt is six hours old.
  if (periodicCheckDue({
    capable: distribution.automaticUpdates,
    autoCheckUpdates: settings.autoCheckUpdates,
    activeSockets: sockets.size(),
    lastUpdateCheckAt: settings.lastUpdateCheckAt,
    now: Date.now(),
  })) {
    void checkForAppUpdates(settings.updateTrack);
  }
  // A 30-minute tick with a six-hour due-time instead of a six-hour timer:
  // a laptop waking past the boundary checks within half an hour, with no
  // resume handler and no new diagnostic event. check() already coalesces,
  // so a due tick during a download or a ready update is a no-op.
  const periodicCheckTick = setInterval(() => {
    void (async () => {
      const current = await preferences.getSettings();
      if (!periodicCheckDue({
        capable: distribution.automaticUpdates,
        autoCheckUpdates: current.autoCheckUpdates,
        activeSockets: sockets.size(),
        lastUpdateCheckAt: current.lastUpdateCheckAt,
        now: Date.now(),
      })) return;
      void checkForAppUpdates(current.updateTrack);
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
        const win = windowRegistry.focusedOrSoleGameWindow();
        if (!win) {
          return;
        }
        const diagnosticOwnerId =
          windowRegistry.requireDiagnosticOwnerForWindow(win);
        void startDiagnosticCapture(win, 1).catch((error) => {
          logEvent({
            k: "capture.automationStartFailed",
            code: errorCode(error),
          }, diagnosticOwnerId);
        });
      } else if (message === AUTOMATION_COMMAND.stopCapture) {
        void stopDiagnosticCapture();
      }
    });
  } else {
    setDiagnosticCaptureStoppedHandler(async (win) => {
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
        await exportDiagnosticsReport(win, () =>
          exportDiagnosticsForWindow(win, () => preferences.getSettings())
        );
      }
    });
  }
  if (profileMatches) {
    void clientRuntime.requestUpdate();
  } else {
    logEvent({ k: "app.unexpectedUserData" });
    setProgress({ phase: "error", errorCode: "wrong_profile" });
  }

  app.on("activate", () => {
    if (!windowCoordinator.revealLauncher({ activateApp: true })) {
      createLauncherWindow(protocolDeps, windowCoordinator);
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
    "A fatal application error occurred. After reopening, choose Help → Report a Bug.",
  );
});

if (primaryInstance) process.on("unhandledRejection", (reason) => {
  logEvent({ k: "app.unhandledRejection", code: errorCode(reason) });
});
