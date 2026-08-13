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
  dialog,
  Notification,
  powerMonitor,
  session,
} from "electron";
import { readFileSync } from "node:fs";
import { mkdir, readFile, rm } from "node:fs/promises";
import path from "node:path";
import {
  EXTERNAL_URLS,
  DEFAULT_SETTINGS,
  IPC,
  type AppSettings,
  type AppSettingsPatch,
  type AccountsSetupRequest,
  type AccountsState,
  type AccountProfileRequest,
  type AccountProfileUpdateRequest,
  type DownloadProgress,
  type PrefetchProgress,
  type UpdateTrack,
} from "../shared/contracts.js";
import {
  enhancementCapabilitiesFor,
  type EnhancementProgram,
  type EnhancementSelection,
} from "../shared/enhancement-contracts.js";
import { errorCode } from "../shared/errors.js";
import { INITIAL_PROGRESS } from "../shared/progress.js";
import { AUTOMATION_COMMAND } from "../shared/automation.js";
import { ClientRuntime } from "./client-runtime.js";
import { Mutex } from "./core/mutex.js";
import { saveBuildLibrary } from "./core/build-library.js";
import { parseBuildLibrary } from "../shared/builds/parse-library.js";
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
  enableSandboxBeforeReady,
  onAppQuit,
  runQuitCleanup,
  wireLifecycle,
} from "./lifecycle.js";
import { sweepOrphanDirectories } from "./core/atomic-file.js";
import { documentDirectories } from "./core/paths.js";
import { multiProfilePaths } from "./core/paths.js";
import { gamePaths } from "./paths.js";
import {
  DEVELOPER_ENHANCEMENT_PROGRAM,
  ENHANCEMENT_AUTOMATION_ENABLED,
  enhancementSelectionFor,
} from "./certification/enhancement-policy.js";
import {
  installGwProtocolHandler,
  installGwProtocolHandlerForSession,
  registerGwScheme,
} from "./protocol.js";
import {
  createMainWindow,
  closeProfileWindow,
  flushWindowState,
  getMainWindow,
  prepareWindowState,
  RENDERER_URL,
  setOwnedWindowTitle,
  type WindowHost,
  updateLongRunningTaskFeedback,
} from "./window.js";
import { exportDiagnosticsReport } from "./diagnostics-export.js";
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
import {
  applyPendingCacheClear,
  applyPendingGameStorageReset,
  applyPendingSessionStorageReset,
} from "./settings-actions.js";
import { windowRegistry } from "./window-registry.js";
import {
  createMultiWorkspace,
  addMultiProfile,
  archiveMultiProfile,
  loadAccountMode,
  loadMultiWorkspace,
  saveAccountMode,
  saveMultiWorkspace,
  quarantineAccountDocument,
  removeArchivedMultiProfile,
  restoreMultiProfile,
  updateMultiProfile,
} from "./core/multiple-accounts.js";
import {
  type AccountMode,
  type MultiWorkspace,
  type ProfileId,
} from "../shared/multiple-accounts.js";
import { multiSecretSlot } from "./core/native-keychain.js";
import {
  loadAccountTemplateLibrary,
  reconcileAccountTemplates,
  saveAccountTemplateLibrary,
} from "./core/account-template-library.js";
import {
  createAccountsWindow,
  revealAccountsWindow,
} from "./accounts-window.js";

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

/** Every settings write is a read-modify-write of one file. */
const settingsLock = new Mutex();
const accountsLock = new Mutex();
const templatesLock = new Mutex();
let appUpdaterController: AppUpdater | null = null;
let updateRestartInFlight: Promise<void> | null = null;
let secondInstanceRequested = false;
let activeAccountMode: AccountMode = "single";
const INJECT_STARTUP_FAILURE =
  !app.isPackaged && process.env.GW_TEST_STARTUP_FAILURE === "1";

function revealMainWindow(): void {
  if (activeAccountMode === "multi" && revealAccountsWindow()) return;
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

/** The one application-update action; AppUpdater owns every outcome. */
async function checkForAppUpdates(track?: UpdateTrack): Promise<void> {
  const selected = track ?? (await loadSettings(gamePaths().settings)).updateTrack;
  await appUpdaterController?.check(selected);
}

function updateAppSettings(patch: AppSettingsPatch): Promise<AppSettings> {
  return settingsLock.run(async () => {
    const settingsPath = gamePaths().settings;
    const current = await loadSettings(settingsPath);
    return saveSettings(settingsPath, { ...current, ...patch });
  });
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
  const gameWindows = windowRegistry.gameWindows();
  if (gameWindows.length === 0) updateLongRunningTaskFeedback(next, null);
  else {
    for (const win of gameWindows) updateLongRunningTaskFeedback(next, win);
  }
  sendToRenderer(IPC.progressEvent, next);
}

function setPrefetch(next: PrefetchProgress): void {
  sendToRenderer(IPC.prefetchEvent, { ...next });
}

function sendToRenderer(channel: string, value: unknown): void {
  for (const win of windowRegistry.gameWindows()) {
    if (win.isDestroyed() || win.webContents.isDestroyed()) continue;
    try {
      win.webContents.send(channel, value);
    } catch {
      // Renderer teardown can race a native progress callback.
    }
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

async function ensureDirs(mode: AccountMode): Promise<void> {
  const paths = gamePaths();
  await mkdir(paths.game, { recursive: true });
  await mkdir(paths.chunks, { recursive: true });
  await mkdir(paths.diagnostics, { recursive: true });
  // On the first open of the directories we own, remove incomplete atomic
  // writes. A process killed between
  // write and rename leaves `<name>.<pid>.<hex>.tmp` behind, and boot is the
  // only moment at which every one of those directories is known to be idle.
  const roots = documentDirectories(paths);
  if (mode === "multi") roots.push(paths.multiRoot, paths.multiProfiles);
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

async function importBuildLibraryIfPresent(
  source: string,
  destination: string,
): Promise<void> {
  let bytes: string;
  try {
    bytes = await readFile(source, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }
  const library = parseBuildLibrary(JSON.parse(bytes) as unknown);
  await saveBuildLibrary(destination, library);
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
    exportDiagnostics: (win) => exportDiagnosticsForWindow(win),
    markPerformanceProblem,
    startCapture: startDiagnosticCapture,
    stopCapture: stopDiagnosticCapture,
    reloadGame: (win) => {
      void (async () => {
        await sendRendererCommand(win, { type: "filesystem.sync" });
        sockets.closeAll(win.webContents.id);
        await win.loadURL(RENDERER_URL);
      })();
    },
    prepareRendererRecovery: async () => {
      await clientRuntime.recoverRendererCrash();
    },
    gameWindowClosed: () => {
      if (activeAccountMode === "multi") revealAccountsWindow();
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
  const paths = gamePaths();
  try {
    activeAccountMode = await loadAccountMode(paths.launcherMode);
  } catch {
    const { response } = await dialog.showMessageBox({
      type: "warning",
      buttons: ["Open Single Account Mode", "Quit"],
      defaultId: 0,
      cancelId: 1,
      message: "Account mode settings are damaged",
      detail:
        "GWonMac can preserve the damaged file and restart in Single Account mode. Your saved login, templates, builds, and downloaded game data will not be changed.",
    });
    if (response !== 0) {
      app.quit();
      return;
    }
    await quarantineAccountDocument(paths.launcherMode);
    await saveAccountMode(paths.launcherMode, "single");
    app.relaunch();
    app.quit();
    return;
  }
  // The registry is safe to inspect from Single mode for the explicit Accounts
  // settings pane. Its sessions, libraries, and Keychain items remain closed.
  let multiWorkspace: MultiWorkspace | null;
  try {
    multiWorkspace = await loadMultiWorkspace(paths.multiWorkspace);
  } catch {
    if (activeAccountMode === "multi") {
      const { response } = await dialog.showMessageBox({
        type: "warning",
        buttons: ["Open Single Account Mode", "Quit"],
        defaultId: 0,
        cancelId: 1,
        message: "Multiple Accounts profiles are damaged",
        detail:
          "GWonMac can preserve the damaged workspace and restart in Single Account mode. Single Account data and profile Keychain items will not be changed.",
      });
      if (response !== 0) {
        app.quit();
        return;
      }
      await quarantineAccountDocument(paths.multiWorkspace);
      await saveAccountMode(paths.launcherMode, "single");
      app.relaunch();
      app.quit();
      return;
    }
    await quarantineAccountDocument(paths.multiWorkspace);
    multiWorkspace = null;
  }
  if (activeAccountMode === "multi" && !multiWorkspace) {
    const { response } = await dialog.showMessageBox({
      type: "warning",
      buttons: ["Open Single Account Mode", "Quit"],
      defaultId: 0,
      cancelId: 1,
      message: "Multiple Accounts profiles are missing",
      detail:
        "Restart in Single Account mode without changing its saved login, templates, builds, or Guild Wars files.",
    });
    if (response !== 0) {
      app.quit();
      return;
    }
    await saveAccountMode(paths.launcherMode, "single");
    app.relaunch();
    app.quit();
    return;
  }
  await applyPendingCacheClear(paths);
  if (activeAccountMode === "single") {
    await applyPendingGameStorageReset(paths);
  }
  await ensureDirs(activeAccountMode);
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
    activeAccountMode === "single"
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
  if (activeAccountMode === "single") {
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
  const enhancementSelection = enhancementSelectionFor(settings);
  const enhancementProgram = DEVELOPER_ENHANCEMENT_PROGRAM;
  const enhancementCapabilities = enhancementCapabilitiesFor(
    enhancementSelection,
    enhancementProgram,
  );
  if (activeAccountMode === "single") await prepareWindowState();
  const keychain: NativeKeychain = persistentSecrets
    ? loadNativeKeychain({
        packaged: true,
        appPath: app.getAppPath(),
        resourcesPath: process.resourcesPath,
      })
    : new VolatileNativeKeychain();
  const credentialsStores = new Map<string, CredentialsStore>();
  const steamSessionStores = new Map<string, SteamSessionStore>();
  const credentialStoreForProfile = (profileId?: ProfileId): CredentialsStore => {
    const key = profileId ?? "single";
    let store = credentialsStores.get(key);
    if (!store) {
      store = new CredentialsStore(
        keychain,
        profileId
          ? multiSecretSlot(profileId, "arenaNetCredentials")
          : "arenaNetCredentials",
      );
      credentialsStores.set(key, store);
    }
    return store;
  };
  const steamStoreForProfile = (profileId?: ProfileId): SteamSessionStore => {
    const key = profileId ?? "single";
    let store = steamSessionStores.get(key);
    if (!store) {
      store = new SteamSessionStore(
        keychain,
        profileId
          ? multiSecretSlot(profileId, "steamSession")
          : "steamSession",
      );
      steamSessionStores.set(key, store);
    }
    return store;
  };
  const expectedUserData = process.env.GW_EXPECT_USER_DATA;
  const profileMatches =
    !expectedUserData ||
    path.resolve(expectedUserData) === path.resolve(app.getPath("userData"));
  const clientRuntime = new ClientRuntime({
    paths,
    hostVersion: HOST_VERSION,
    cachedOnly: process.env.GW_REQUIRE_CACHED_CLIENT === "1",
    enhancementCapabilities,
    extendedMemoryEnabled: settings.extendedMemoryEnabled,
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
  };
  if (activeAccountMode === "single") {
    installGwProtocolHandler(protocolDeps);
    logEvent({ k: "protocol.installed" });
  }

  const host = buildWindowHost(
    clientRuntime,
    sockets,
    enhancementSelection,
    enhancementProgram,
  );
  const profileProtocolSessions = new Set<ProfileId>();
  const profileLaunchState = new Map<ProfileId, "opening" | "failed">();
  const profileFor = (profileId: ProfileId) => {
    const profile = multiWorkspace?.profiles.find(
      (candidate) => candidate.id === profileId && !candidate.archived,
    );
    if (!profile) throw new Error("Unknown Multiple Accounts profile");
    return profile;
  };
  const accountsState = (): AccountsState => ({
    mode: activeAccountMode,
    profiles: (multiWorkspace?.profiles ?? []).map((profile) => ({
        id: profile.id,
        name: profile.name,
        templates: profile.templates,
        builds: profile.builds,
        archived: profile.archived,
        state: !profile.archived && windowRegistry.profileWindow(profile.id)
          ? "running"
          : (profileLaunchState.get(profile.id) ?? "ready"),
      })),
  });
  const openProfile = async (profileId: ProfileId): Promise<boolean> => {
    const profile = profileFor(profileId);
    const existing = windowRegistry.profileWindow(profileId);
    if (existing) {
      if (existing.isMinimized()) existing.restore();
      existing.show();
      existing.focus();
      return false;
    }
    if (profileLaunchState.get(profileId) === "opening") return false;
    profileLaunchState.set(profileId, "opening");
    try {
      const owner = session.fromPartition(`persist:gw-multi-${profileId}`, {
        cache: false,
      });
      if (!profileProtocolSessions.has(profileId)) {
        installGwProtocolHandlerForSession(owner, protocolDeps);
        profileProtocolSessions.add(profileId);
      }
      await Promise.all([
        owner.clearStorageData({ storages: ["cookies"] }),
        owner.clearCache(),
      ]);
      const profilePaths = multiProfilePaths(paths, profileId);
      const reset = await applyPendingSessionStorageReset(
        owner,
        profilePaths.gameStorageClearRequest,
      );
      if (reset && profile.templates === "private") {
        await rm(profilePaths.templates, { force: true });
        await rm(profilePaths.templateSync, { force: true });
      }
      await mkdir(profilePaths.root, { recursive: true });
      await prepareWindowState(profilePaths.windowState);
      const win = createMainWindow(host, {
        context: { mode: "multi", role: "game", profileId },
        session: owner,
        title: `Guild Wars Reforged — ${profile.name}`,
        windowStatePath: profilePaths.windowState,
      });
      win.on("closed", () => {
        if (profileLaunchState.get(profileId) !== "failed") {
          profileLaunchState.delete(profileId);
        }
      });
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => {
          cleanup();
          reject(new Error("profile window did not finish loading"));
        }, 30_000);
        const cleanup = () => {
          clearTimeout(timeout);
          win.webContents.removeListener("did-finish-load", loaded);
          win.removeListener("closed", closed);
        };
        const loaded = () => {
          cleanup();
          resolve();
        };
        const closed = () => {
          cleanup();
          reject(new Error("profile window closed while loading"));
        };
        win.webContents.once("did-finish-load", loaded);
        win.once("closed", closed);
      });
      profileLaunchState.delete(profileId);
      return true;
    } catch (error) {
      profileLaunchState.set(profileId, "failed");
      const failedWindow = windowRegistry.profileWindow(profileId);
      if (failedWindow && !failedWindow.isDestroyed()) failedWindow.destroy();
      throw error;
    }
  };
  const waitForCandidateCanary = async (): Promise<void> => {
    const candidate = clientRuntime.healthToken;
    if (!candidate) return;
    const deadline = Date.now() + 60_000;
    while (clientRuntime.healthToken === candidate && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    if (clientRuntime.healthToken === candidate) {
      throw new Error("first profile did not confirm the new client generation");
    }
  };

  const setupAccounts = async (request: AccountsSetupRequest): Promise<void> => {
    if (activeAccountMode !== "single") {
      throw new Error("Multiple Accounts mode is already enabled");
    }
    multiWorkspace ??= await loadMultiWorkspace(paths.multiWorkspace);
    if (!multiWorkspace) {
      const candidate = createMultiWorkspace(request);
      const profile = candidate.profiles[0]!;
      const profilePaths = multiProfilePaths(paths, profile.id);
      await mkdir(profilePaths.root, { recursive: true });
      if (request.importBuilds) {
        await importBuildLibraryIfPresent(
          paths.buildLibrary,
          profile.builds === "shared"
            ? paths.multiSharedBuildLibrary
            : profilePaths.buildLibrary,
        );
      }
      if (request.importTemplates) {
        const templatePath = profile.templates === "shared"
          ? paths.multiSharedTemplates
          : profilePaths.templates;
        await saveAccountTemplateLibrary(templatePath, {
          revision: 1,
          entries: request.templateEntries,
        });
      }
      await saveMultiWorkspace(paths.multiWorkspace, candidate);
      multiWorkspace = candidate;
    }
    await saveAccountMode(paths.launcherMode, "multi");
    app.relaunch();
    app.quit();
  };

  const useSingleAccountMode = async (): Promise<void> => {
    await saveAccountMode(paths.launcherMode, "single");
    app.relaunch();
    app.quit();
  };

  const ipcCleanup = registerIpcHandlers({
    sockets,
    windows: windowRegistry,
    credentialsStoreFor: (win) => {
      const context = windowRegistry.contextForWebContents(win.webContents.id);
      return context?.mode === "multi" && context.role === "game"
        ? credentialStoreForProfile(context.profileId)
        : credentialStoreForProfile();
    },
    steamSessionStoreFor: (win) => {
      const context = windowRegistry.contextForWebContents(win.webContents.id);
      return context?.mode === "multi" && context.role === "game"
        ? steamStoreForProfile(context.profileId)
        : steamStoreForProfile();
    },
    buildLibraryPathFor: (win) => {
      const context = windowRegistry.contextForWebContents(win.webContents.id);
      if (context?.mode !== "multi" || context.role !== "game") {
        return paths.buildLibrary;
      }
      const profile = profileFor(context.profileId);
      return profile.builds === "shared"
        ? paths.multiSharedBuildLibrary
        : multiProfilePaths(paths, profile.id).buildLibrary;
    },
    gameStorageResetMarkerFor: (win) => {
      const context = windowRegistry.contextForWebContents(win.webContents.id);
      return context?.mode === "multi" && context.role === "game"
        ? multiProfilePaths(paths, context.profileId).gameStorageClearRequest
        : paths.gameStorageClearRequest;
    },
    getProgress: () => clientRuntime.progress,
    getChunkStore: () => clientRuntime.active?.store ?? null,
    getSettings: () => loadSettings(paths.settings),
    updateSettings: updateAppSettings,
    resetSettings: resetAppSettings,
    toolsCapableAtLaunch: settings.gwonmacTools,
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
    getClientSession: () => ({
      appVersion: HOST_VERSION,
      compatibility: clientRuntime.compatibility,
      extendedMemory: clientRuntime.extendedMemory,
      healthToken: clientRuntime.healthToken,
    }),
    acquireSteamToken: (parent, record) =>
      acquireSteamToken(STEAM_OAUTH, { parent, record }),
    getAccountsState: accountsState,
    setupAccounts,
    openAccounts: async (profileIds) => {
      let canaryChecked = false;
      let firstFailure: unknown = null;
      for (let index = 0; index < profileIds.length; index += 1) {
        const profileId = profileIds[index]!;
        let opened: boolean;
        try {
          opened = await accountsLock.run(() => openProfile(profileId));
        } catch (error) {
          firstFailure ??= error;
          continue;
        }
        if (opened && !canaryChecked) {
          await waitForCandidateCanary();
          canaryChecked = true;
        }
      }
      if (firstFailure) throw firstFailure;
    },
    createAccount: (request: AccountProfileRequest) => accountsLock.run(async () => {
      if (activeAccountMode !== "multi" || !multiWorkspace) {
        throw new Error("Multiple Accounts mode is not active");
      }
      const next = addMultiProfile(multiWorkspace, request);
      const profile = next.profiles.at(-1)!;
      await mkdir(multiProfilePaths(paths, profile.id).root, { recursive: true });
      await saveMultiWorkspace(paths.multiWorkspace, next);
      multiWorkspace = next;
      return accountsState();
    }),
    updateAccount: (request: AccountProfileUpdateRequest) => accountsLock.run(async () => {
      if (activeAccountMode !== "multi" || !multiWorkspace) {
        throw new Error("Multiple Accounts mode is not active");
      }
      const current = profileFor(request.id);
      if (
        windowRegistry.profileWindow(request.id)
        && (current.builds !== request.builds || current.templates !== request.templates)
      ) {
        throw new Error("Close this account before changing sharing");
      }
      const next = updateMultiProfile(multiWorkspace, request.id, request);
      await saveMultiWorkspace(paths.multiWorkspace, next);
      multiWorkspace = next;
      const profileWindow = windowRegistry.profileWindow(request.id);
      if (profileWindow) {
        setOwnedWindowTitle(
          profileWindow,
          `Guild Wars Reforged — ${request.name}`,
        );
      }
      return accountsState();
    }),
    archiveAccount: (profileId: ProfileId) => accountsLock.run(async () => {
      if (activeAccountMode !== "multi" || !multiWorkspace) {
        throw new Error("Multiple Accounts mode is not active");
      }
      if (windowRegistry.profileWindow(profileId)) {
        throw new Error("Close this account before archiving it");
      }
      const next = archiveMultiProfile(multiWorkspace, profileId);
      await saveMultiWorkspace(paths.multiWorkspace, next);
      multiWorkspace = next;
      return accountsState();
    }),
    restoreAccount: (profileId: ProfileId) => accountsLock.run(async () => {
      if (activeAccountMode !== "multi" || !multiWorkspace) {
        throw new Error("Multiple Accounts mode is not active");
      }
      const next = restoreMultiProfile(multiWorkspace, profileId);
      await saveMultiWorkspace(paths.multiWorkspace, next);
      multiWorkspace = next;
      return accountsState();
    }),
    deleteAccount: (parent, profileId: ProfileId) => accountsLock.run(async () => {
      if (activeAccountMode !== "multi" || !multiWorkspace) {
        throw new Error("Multiple Accounts mode is not active");
      }
      const profile = multiWorkspace.profiles.find(
        (candidate) => candidate.id === profileId && candidate.archived,
      );
      if (!profile) throw new Error("Only an archived profile can be deleted");
      const { response } = await dialog.showMessageBox(parent, {
        type: "warning",
        buttons: ["Permanently Delete", "Cancel"],
        defaultId: 1,
        cancelId: 1,
        message: `Permanently delete “${profile.name}”?`,
        detail:
          "Its saved login, Guild Wars files, private templates, builds, and window state cannot be recovered. Shared libraries and Single Account data stay untouched.",
      });
      if (response !== 0) return accountsState();
      const next = removeArchivedMultiProfile(multiWorkspace, profileId);
      const owner = session.fromPartition(`persist:gw-multi-${profileId}`, {
        cache: false,
      });
      await Promise.all([
        credentialStoreForProfile(profileId).clear(),
        steamStoreForProfile(profileId).clear(),
        owner.clearStorageData(),
        owner.clearCache(),
      ]);
      await rm(multiProfilePaths(paths, profileId).root, {
        recursive: true,
        force: true,
      });
      await saveMultiWorkspace(paths.multiWorkspace, next);
      credentialsStores.delete(profileId);
      steamSessionStores.delete(profileId);
      multiWorkspace = next;
      return accountsState();
    }),
    loadAccountTemplates: async (win) => {
      const context = windowRegistry.contextForWebContents(win.webContents.id);
      if (context?.mode !== "multi" || context.role !== "game") return null;
      const profile = profileFor(context.profileId);
      const profilePaths = multiProfilePaths(paths, profile.id);
      const libraryPath = profile.templates === "shared"
        ? paths.multiSharedTemplates
        : profilePaths.templates;
      const library = await loadAccountTemplateLibrary(libraryPath);
      await saveAccountTemplateLibrary(profilePaths.templateSync, library);
      return library;
    },
    saveAccountTemplates: (win, entries) => templatesLock.run(async () => {
      const context = windowRegistry.contextForWebContents(win.webContents.id);
      if (context?.mode !== "multi" || context.role !== "game") return;
      const profile = profileFor(context.profileId);
      const profilePaths = multiProfilePaths(paths, profile.id);
      if (profile.templates === "private") {
        const current = await loadAccountTemplateLibrary(profilePaths.templates);
        await saveAccountTemplateLibrary(profilePaths.templates, {
          revision: current.revision + 1,
          entries,
        });
        return;
      }
      const [base, latest] = await Promise.all([
        loadAccountTemplateLibrary(profilePaths.templateSync),
        loadAccountTemplateLibrary(paths.multiSharedTemplates),
      ]);
      const merged = {
        revision: latest.revision + 1,
        entries: reconcileAccountTemplates(base.entries, latest.entries, entries),
      };
      await saveAccountTemplateLibrary(paths.multiSharedTemplates, merged);
      await saveAccountTemplateLibrary(profilePaths.templateSync, merged);
    }),
    requestQuit: (win) => {
      const context = windowRegistry.contextForWebContents(win.webContents.id);
      if (context?.mode === "multi") void closeProfileWindow(win);
      else app.quit();
    },
    useSingleAccountMode,
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
    updateLongRunningTaskFeedback(INITIAL_PROGRESS);
    await clientRuntime.shutdown();
    if (activeAccountMode === "single") await clearBrowserCookies("quit");
    await stopDiagnostics();
  });

  const win = activeAccountMode === "multi"
    ? createAccountsWindow(protocolDeps)
    : createMainWindow(host);
  if (settings.autoCheckUpdates) {
    void checkForAppUpdates(settings.updateTrack);
  }
  // A 30-minute tick with a six-hour due-time instead of a six-hour timer:
  // a laptop waking past the boundary checks within half an hour, with no
  // resume handler and no new diagnostic event. check() already coalesces,
  // so a due tick during a download or a ready update is a no-op.
  const periodicCheckTick = setInterval(() => {
    void (async () => {
      const current = await loadSettings(paths.settings);
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
      const gameWindows = windowRegistry.gameWindows();
      const win = gameWindows.find((candidate) => candidate.isFocused())
        ?? gameWindows[0];
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
        await exportDiagnosticsReport(() => exportDiagnosticsForWindow(win));
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
    if (activeAccountMode === "multi") {
      if (!revealAccountsWindow()) createAccountsWindow(protocolDeps);
    } else if (!getMainWindow()) {
      createMainWindow(host);
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
