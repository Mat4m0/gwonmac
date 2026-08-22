/**
 * The game window: its creation, the navigation and permission handlers bound
 * to it, and the owner-only state persisted beneath it.
 *
 * `window-menu.ts` owns the surfaces that act on the window, so every
 * transition of window state is written here and a menu handler can only ask
 * for one.
 */
import {
  app,
  BrowserWindow,
  dialog,
  powerSaveBlocker,
  screen,
} from "electron";
import type {
  AppSettings,
  AppSettingsPatch,
  DownloadProgress,
  RendererInit,
} from "../shared/contracts.js";
import { RENDERER_INIT_ARGUMENT } from "../shared/contracts.js";
import type {
  EnhancementProgram,
  EnhancementSelection,
} from "../shared/enhancement-contracts.js";
import { errorCode } from "../shared/errors.js";
import { longRunningTaskFeedback } from "../shared/progress.js";
import type { SocketManager } from "./core/sockets.js";
import {
  defaultWindowState,
  cascadeWindowState,
  fitWindowStateToDisplays,
  loadWindowState,
  saveWindowState,
  type WindowBounds,
  type WindowState,
} from "./core/window-state.js";
import { logEvent, resetRendererDiagnostics } from "./diagnostics.js";
import { isCanonicalRendererUrl } from "./core/renderer-trust.js";
import { isQuitting } from "./lifecycle.js";
import { gamePaths, preloadPath } from "./paths.js";
import {
  editWindowText,
  openStorage,
  sendRendererCommand,
  toggleTools,
  toggleTravel,
} from "./renderer-commands.js";
import { installApplicationMenu } from "./window-menu.js";
import {
  installWindowShortcuts,
  updateWindowShortcuts,
} from "./window-shortcuts.js";
import { windowRegistry, type GameWindowContext } from "./window-registry.js";

// Tests launch the app dozens of times; without this they steal keyboard focus
// on every launch. Focus-dependent specs leave the flag unset.
const BACKGROUND_LAUNCH =
  !app.isPackaged && process.env.GW_BACKGROUND_LAUNCH === "1";

export interface WindowHost {
  sockets: SocketManager;
  /** Launch-time tool choices; the served module decides whether they can run. */
  enhancementSelection: EnhancementSelection;
  /** Developer-only feature program; never inferred from automation. */
  enhancementProgram: EnhancementProgram;
  getProgress: () => DownloadProgress;
  getSettings: () => Promise<AppSettings>;
  updateSettings: (value: AppSettingsPatch) => Promise<AppSettings>;
  exportDiagnostics: (win: BrowserWindow) => Promise<string>;
  reportVisualProblem: (win: BrowserWindow) => Promise<void>;
  markPerformanceProblem: (win: BrowserWindow) => void;
  startCapture: (win: BrowserWindow, level: 1 | 2) => Promise<void>;
  stopCapture: (win: BrowserWindow) => Promise<void>;
  reloadGame: (win: BrowserWindow) => void;
  prepareRendererRecovery: () => Promise<void>;
  gameWindowClosed?: () => void;
}

const rendererRecoveryUsed = new Set<string>();

/** A deliberate player retry gets one fresh automatic renderer recovery. */
export function resetRendererRecovery(statePath: string): void {
  rendererRecoveryUsed.delete(statePath);
}
interface WindowStateOwner {
  readonly path: string;
  readonly diagnosticOwnerId: number;
  restored: WindowState | null;
  lastNormalBounds: WindowBounds | null;
  timer: ReturnType<typeof setTimeout> | null;
  write: Promise<void>;
  reset: Promise<void>;
  resetDepth: number;
}
const preparedWindowStates = new Map<string, WindowState | null>();
const windowStateOwners = new Map<BrowserWindow, WindowStateOwner>();
const ownedWindowTitles = new WeakMap<BrowserWindow, string>();
const profileCloses = new WeakMap<BrowserWindow, Promise<void>>();
let downloadPowerBlockerId: number | null = null;

export function updateLongRunningTaskFeedback(
  value: DownloadProgress,
  win: BrowserWindow | null,
): boolean {
  const feedback = longRunningTaskFeedback(value);
  if (feedback.preventAppSuspension && downloadPowerBlockerId === null) {
    downloadPowerBlockerId = powerSaveBlocker.start("prevent-app-suspension");
    logEvent({ k: "download.appSuspensionPrevented" });
  } else if (!feedback.preventAppSuspension && downloadPowerBlockerId !== null) {
    powerSaveBlocker.stop(downloadPowerBlockerId);
    downloadPowerBlockerId = null;
    logEvent({ k: "download.appSuspensionRestored" });
  }

  const preventingAppSuspension =
    downloadPowerBlockerId !== null &&
    powerSaveBlocker.isStarted(downloadPowerBlockerId);
  if (!win || win.isDestroyed()) return preventingAppSuspension;
  win.setProgressBar(feedback.dockProgress);
  return preventingAppSuspension;
}

function workAreas(): WindowBounds[] {
  return screen.getAllDisplays().map((display) => ({ ...display.workArea }));
}

function primaryWorkArea(): WindowBounds {
  return { ...screen.getPrimaryDisplay().workArea };
}

export async function prepareWindowState(
  diagnosticOwnerId: number,
  statePath = gamePaths().windowState,
  newWindowOrdinal?: number,
): Promise<boolean> {
  const loaded = await loadWindowState(statePath, () => {
    logEvent({ k: "window.stateCorruptCleared" }, diagnosticOwnerId);
  });
  const restored = loaded
    ? fitWindowStateToDisplays(loaded, workAreas(), primaryWorkArea())
    : null;
  const prepared = restored ?? (
    newWindowOrdinal === undefined
      ? null
      : cascadeWindowState(
          defaultWindowState(primaryWorkArea()),
          newWindowOrdinal,
          primaryWorkArea(),
        )
  );
  preparedWindowStates.set(statePath, prepared);
  if (restored) {
    logEvent({ k: "window.stateRestored",
      mode: restored.mode,
      width: restored.bounds.width,
      height: restored.bounds.height,
    }, diagnosticOwnerId);
  }
  return restored !== null;
}

function currentWindowState(win: BrowserWindow, owner: WindowStateOwner): WindowState {
  const mode = win.isFullScreen()
    ? "fullscreen"
    : win.isMaximized()
      ? "maximized"
      : "normal";
  if (mode === "normal") {
    owner.lastNormalBounds = { ...win.getBounds() };
  }
  return {
    bounds:
      owner.lastNormalBounds ??
      fitWindowStateToDisplays(
        defaultWindowState(primaryWorkArea()),
        workAreas(),
        primaryWorkArea(),
      ).bounds,
    mode,
  };
}

async function persistWindowState(win: BrowserWindow): Promise<void> {
  const owner = windowStateOwners.get(win);
  if (win.isDestroyed() || !owner) return;
  const state = currentWindowState(win, owner);
  owner.restored = state;
  const write = owner.write.then(() =>
    saveWindowState(owner.path, state),
  );
  owner.write = write.catch(() => undefined);
  await write;
}

function scheduleWindowStateSave(win: BrowserWindow): void {
  const owner = windowStateOwners.get(win);
  if (!owner) return;
  // Leaving fullscreen/maximized and applying the default bounds emits several
  // intermediate events. Persisting one of those after the explicit reset
  // write can resurrect the old placement.
  if (owner.resetDepth > 0) return;
  if (owner.timer) clearTimeout(owner.timer);
  owner.timer = setTimeout(() => {
    owner.timer = null;
    void persistWindowState(win).catch(() => {
      logEvent(
        { k: "window.stateSaveFailed" },
        owner.diagnosticOwnerId,
      );
    });
  }, 300);
}

export async function flushWindowState(win: BrowserWindow): Promise<void> {
  if (!win || win.isDestroyed()) return;
  const owner = windowStateOwners.get(win);
  if (!owner) return;
  await owner.reset;
  if (owner.timer) {
    clearTimeout(owner.timer);
    owner.timer = null;
  }
  await persistWindowState(win);
  await owner.write;
}

export function resetWindowState(win: BrowserWindow): Promise<void> {
  if (!win || win.isDestroyed()) return Promise.resolve();
  const owner = windowStateOwners.get(win);
  if (!owner) return Promise.resolve();
  const reset = owner.reset.then(async () => {
    owner.resetDepth += 1;
    try {
      if (owner.timer) {
        clearTimeout(owner.timer);
        owner.timer = null;
      }
      const requested = defaultWindowState(primaryWorkArea());
      let settled = requested;
      if (win && !win.isDestroyed()) {
        if (win.isFullScreen()) {
          await new Promise<void>((resolve, reject) => {
            const completed = () => {
              clearTimeout(timeout);
              resolve();
            };
            const timeout = setTimeout(() => {
              win.removeListener("leave-full-screen", completed);
              reject(new Error("window did not leave full screen"));
            }, 5_000);
            win.once("leave-full-screen", completed);
            win.setFullScreen(false);
          });
        }
        if (win.isMaximized()) {
          await new Promise<void>((resolve, reject) => {
            const completed = () => {
              clearTimeout(timeout);
              resolve();
            };
            const timeout = setTimeout(() => {
              win.removeListener("unmaximize", completed);
              reject(new Error("window did not leave maximized mode"));
            }, 5_000);
            win.once("unmaximize", completed);
            win.unmaximize();
          });
        }
        win.setBounds(requested.bounds);
        settled = { bounds: { ...win.getBounds() }, mode: "normal" };
      }
      owner.restored = settled;
      owner.lastNormalBounds = settled.bounds;
      const write = owner.write.then(() =>
        saveWindowState(owner.path, settled),
      );
      owner.write = write.catch(() => undefined);
      await write;
      logEvent({ k: "window.stateReset",
        width: settled.bounds.width,
        height: settled.bounds.height,
      }, owner.diagnosticOwnerId);
    } finally {
      owner.resetDepth -= 1;
    }
  });
  owner.reset = reset.catch(() => undefined);
  return reset;
}

export function setOwnedWindowTitle(win: BrowserWindow, title: string): void {
  ownedWindowTitles.set(win, title);
  win.setTitle(title);
}

async function closeProfileWindowOnce(win: BrowserWindow): Promise<void> {
  const diagnosticOwnerId = windowRegistry.requireDiagnosticOwnerForWindow(win);
  while (!win.isDestroyed()) {
    const outcome = await sendRendererCommand(win, { type: "filesystem.sync" });
    if (outcome === "completed") break;

    let response: number;
    try {
      response = (await dialog.showMessageBox(win, {
        type: "warning",
        buttons: ["Retry", "Close Without Saving", "Cancel"],
        defaultId: 2,
        cancelId: 2,
        noLink: true,
        message: "This account could not finish saving",
        detail:
          "Keep the account open and retry, or close it knowing that recent game files may be lost.",
      })).response;
    } catch (error) {
      console.error("profile close confirmation failed", error);
      return;
    }
    if (response === 0) continue;
    if (response !== 1) return;
    break;
  }
  if (win.isDestroyed()) return;
  try {
    await flushWindowState(win);
  } catch (error) {
    logEvent(
      { k: "window.stateSaveFailed" },
      diagnosticOwnerId,
    );
    console.error("profile window state save failed", error);
  }
  if (!win.isDestroyed()) win.destroy();
}

/** Flush and destroy exactly one Multi game window without quitting the app. */
export function closeProfileWindow(win: BrowserWindow): Promise<void> {
  if (win.isDestroyed()) return Promise.resolve();
  const active = profileCloses.get(win);
  if (active) return active;
  const operation = closeProfileWindowOnce(win).finally(() => {
    profileCloses.delete(win);
  });
  profileCloses.set(win, operation);
  return operation;
}

/** The only renderer URL, and it carries no configuration. */
export const RENDERER_URL = "gw://app/";

/**
 * Launch configuration, delivered to the preload as one process argument
 * instead of as query parameters the trust root had to allow-list. It is fixed
 * for the life of a window, which is what a reload must not drop: reloading
 * `RENDERER_URL` keeps the same `additionalArguments`, so the Enhancement survives.
 */
export function rendererInitArgument(options: {
  enhancementSelection: EnhancementSelection;
  enhancementProgram: EnhancementProgram;
}): string {
  const init: RendererInit = {
    development: !app.isPackaged,
    enhancementProgram: options.enhancementProgram,
    enhancementSelection: options.enhancementSelection,
    templateFsTrace:
      !app.isPackaged && process.env.GW_TEMPLATE_FS_TRACE === "1",
  };
  return `${RENDERER_INIT_ARGUMENT}${JSON.stringify(init)}`;
}

export function createMainWindow(
  host: WindowHost,
  options: {
    readonly context: GameWindowContext;
    /** Process-local account identity retained across renderer recovery. */
    readonly diagnosticOwnerId: number;
    readonly session?: Electron.Session;
    readonly title?: string;
    readonly windowStatePath?: string;
    readonly showInactive?: boolean;
    readonly onRendererRecoveryStart?: () => void;
    readonly onRendererRecovered?: () => void;
    readonly onRendererFailure?: () => void;
  },
): BrowserWindow {
  const context = options.context;
  const statePath = options.windowStatePath ?? gamePaths().windowState;
  const restoredWindowState = preparedWindowStates.get(statePath) ?? null;
  const initialState = restoredWindowState
    ? fitWindowStateToDisplays(
        restoredWindowState,
        workAreas(),
        primaryWorkArea(),
      )
    : null;
  if (BACKGROUND_LAUNCH) app.dock?.hide();
  const win = new BrowserWindow({
    ...(initialState?.bounds ?? { width: 1280, height: 800 }),
    minWidth: 800,
    minHeight: 600,
    title: options.title ?? "Guild Wars Reforged",
    show: false,
    webPreferences: {
      preload: preloadPath(),
      additionalArguments: [rendererInitArgument(host)],
      // Guild Wars advances its Emscripten main loop on animation frames.
      // Keep game simulation, network delivery, and enabled background audio
      // running when macOS fully covers or minimizes this window.
      backgroundThrottling: false,
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      webviewTag: false,
      spellcheck: false,
      allowRunningInsecureContent: false,
      experimentalFeatures: false,
      ...(options.session ? { session: options.session } : {}),
    },
  });

  const stateOwner: WindowStateOwner = {
    path: statePath,
    diagnosticOwnerId: options.diagnosticOwnerId,
    restored: initialState,
    lastNormalBounds: initialState?.bounds ?? null,
    timer: null,
    write: Promise.resolve(),
    reset: Promise.resolve(),
    resetDepth: 0,
  };
  windowStateOwners.set(win, stateOwner);
  windowRegistry.register(win, context, options.diagnosticOwnerId);
  resetRendererDiagnostics(options.diagnosticOwnerId);
  logEvent({ k: "window.created" }, options.diagnosticOwnerId);
  if (options.title) {
    ownedWindowTitles.set(win, options.title);
    win.webContents.on("page-title-updated", (event) => {
      event.preventDefault();
      win.setTitle(ownedWindowTitles.get(win) ?? "Guild Wars Reforged");
    });
  }
  updateLongRunningTaskFeedback(host.getProgress(), win);
  const rendererId = win.webContents.id;
  const diagnosticOwnerId = options.diagnosticOwnerId;

  win.once("ready-to-show", () => {
    if (initialState?.mode === "maximized") win.maximize();
    if (BACKGROUND_LAUNCH || options.showInactive) win.showInactive();
    else win.show();
    if (initialState?.mode === "fullscreen") win.setFullScreen(true);
  });

  const rememberNormalBounds = (): void => {
    if (
      stateOwner.resetDepth > 0 ||
      win.isFullScreen() ||
      win.isMaximized()
    ) return;
    stateOwner.lastNormalBounds = { ...win.getBounds() };
    scheduleWindowStateSave(win);
  };
  win.on("move", rememberNormalBounds);
  win.on("resize", rememberNormalBounds);
  const persistMode = (): void => {
    if (stateOwner.resetDepth > 0) return;
    void persistWindowState(win).catch(() => {
      logEvent({ k: "window.stateSaveFailed" }, diagnosticOwnerId);
    });
  };
  win.on("maximize", persistMode);
  win.on("unmaximize", persistMode);
  win.on("enter-full-screen", persistMode);
  win.on("leave-full-screen", persistMode);

  // A window that is unfocused, occluded, minimized, or mid-resize stops
  // being composited, which stops requestAnimationFrame with no CPU spent
  // anywhere. `document.hidden` does not report any of that on macOS, so
  // without these a stall of that kind is indistinguishable from a real one.
  // Main stays responsive while the renderer is frozen, so these timestamps
  // are the reliable ones to line up against frames.bin.
  win.on("focus", () => logEvent({ k: "window.focused" }, diagnosticOwnerId));
  win.on("blur", () => logEvent({ k: "window.blurred" }, diagnosticOwnerId));
  win.on("minimize", () => logEvent({ k: "window.minimized" }, diagnosticOwnerId));
  win.on("restore", () => logEvent({ k: "window.restored" }, diagnosticOwnerId));
  win.on("hide", () => logEvent({ k: "window.hidden" }, diagnosticOwnerId));
  win.on("show", () => logEvent({ k: "window.shown" }, diagnosticOwnerId));
  // Only the settled events. Electron emits `will-resize` and `will-move` once
  // per step of a live drag, which would flood the bounded event ring and
  // evict the very evidence these listeners exist to keep.
  win.on("resized", () => logEvent({ k: "window.resized" }, diagnosticOwnerId));
  win.on("moved", () => logEvent({ k: "window.moved" }, diagnosticOwnerId));

  win.webContents.setWindowOpenHandler(() => {
    logEvent({ k: "security.windowOpenBlocked" }, diagnosticOwnerId);
    return { action: "deny" };
  });

  // App shortcuts are decided in the main process before the page sees the key.
  //
  // A menu accelerator is not enough, and the reason is the opposite of what it
  // looks like: Electron dispatches a key to the page first and only considers
  // menu shortcuts for events the renderer reports unhandled. Guild Wars binds
  // most single letters and acts on the base key whatever modifier is held, so
  // `Cmd+B` arrives at the client as `B`, the client handles it, and its
  // `preventDefault()` cancels our accelerator along with the keystroke.
  //
  // `before-input-event` fires in main *before* the renderer receives anything,
  // so `preventDefault()` here means neither our page nor the client ever sees
  // the key. There is nothing to out-race and no ordering to get wrong.
  //
  const installMenu = () => {
    // The application menu is global. Settings can finish loading in any game
    // window, so an unfocused window must never replace the focused owner's
    // menu with callbacks that close over itself.
    const focused = windowRegistry.focusedWindow();
    if (focused ? focused !== win : windowRegistry.gameWindows().length !== 1) {
      return;
    }
    installApplicationMenu({
      host,
      resetWindowState,
    });
  };
  installWindowShortcuts(win, {
    run(action) {
      if (action === "tools.toggle") void toggleTools(win);
      else if (action === "storage.open") void openStorage(win);
      else void toggleTravel(win);
    },
    edit(command) {
      void editWindowText(win, command);
    },
  });
  void host.getSettings().then((settings) => {
    if (!win.isDestroyed()) {
      updateWindowShortcuts(win, settings.shortcutOverrides);
    }
  }).catch((error) => {
    logEvent({ k: "settings.loadFailed", code: errorCode(error) });
  });

  win.webContents.on("will-navigate", (event, url) => {
    if (!isCanonicalRendererUrl(url)) {
      event.preventDefault();
      logEvent({ k: "security.navigationBlocked" }, diagnosticOwnerId);
    }
  });

  win.webContents.on("will-redirect", (event, url) => {
    if (!isCanonicalRendererUrl(url)) {
      event.preventDefault();
      logEvent({ k: "security.redirectBlocked" }, diagnosticOwnerId);
    }
  });

  const mayLockPointer = (
    webContents: Electron.WebContents | null,
    permission: string,
    isMainFrame: boolean,
  ): boolean =>
    permission === "pointerLock" &&
    webContents === win.webContents &&
    isMainFrame &&
    isCanonicalRendererUrl(webContents.getURL());
  win.webContents.session.setPermissionRequestHandler(
    (webContents, permission, callback, details) => {
      callback(mayLockPointer(webContents, permission, details.isMainFrame));
    },
  );
  win.webContents.session.setPermissionCheckHandler(
    (webContents, permission, _origin, details) =>
      mayLockPointer(webContents, permission, details.isMainFrame),
  );
  win.webContents.on("will-attach-webview", (event) => {
    event.preventDefault();
    logEvent({ k: "security.webviewBlocked" }, diagnosticOwnerId);
  });

  win.webContents.on("destroyed", () => {
    logEvent({ k: "webContents.destroyed" }, diagnosticOwnerId);
    host.sockets.closeAll(rendererId);
  });

  win.webContents.on("render-process-gone", (_event, details) => {
    logEvent({
      k: isQuitting()
        ? "renderer.processExitedDuringQuit"
        : "renderer.processGone",
      exitCode: details.exitCode,
    }, diagnosticOwnerId);
    host.sockets.closeAll(rendererId);
    if (isQuitting()) return;
    if (
      !rendererRecoveryUsed.has(statePath) &&
      details.reason !== "clean-exit" &&
      !win.isDestroyed()
    ) {
      rendererRecoveryUsed.add(statePath);
      options.onRendererRecoveryStart?.();
      logEvent({ k: "renderer.recoveryScheduled" }, diagnosticOwnerId);
      setTimeout(() => {
        if (isQuitting() || win.isDestroyed()) return;
        void host
          .prepareRendererRecovery()
          .catch((error) => {
            logEvent({
              k: "renderer.recoveryPreparationFailed",
              code: errorCode(error),
            }, diagnosticOwnerId);
          })
          .finally(() => {
            if (isQuitting() || win.isDestroyed()) return;
            // Release the immutable profile ownership before registering its
            // replacement. Destroying afterward keeps the transition local to
            // this profile and lets the old closed handler remain idempotent.
            windowRegistry.unregister(win);
            createMainWindow(host, options);
            win.destroy();
            options.onRendererRecovered?.();
            logEvent({ k: "renderer.recovered" }, diagnosticOwnerId);
          });
      }, 500);
    } else if (details.reason !== "clean-exit") {
      options.onRendererFailure?.();
      void dialog.showMessageBox(win, {
        type: "error",
        buttons: ["OK"],
        message: "Guild Wars stopped unexpectedly",
        detail:
          "Use View → Reload Game to try again. If it repeats, choose Help → Report a Bug.",
      }).catch(() => undefined);
    }
  });

  win.on("close", (event) => {
    if (isQuitting()) return;
    if (context.mode === "multi") {
      event.preventDefault();
      void closeProfileWindow(win);
      return;
    }
    event.preventDefault();
    logEvent({ k: "window.closeRequested" }, diagnosticOwnerId);
    app.quit();
  });

  win.on("closed", () => {
    windowRegistry.unregister(win);
    windowStateOwners.delete(win);
    if (
      context.mode === "multi"
      && context.role === "game"
      && !windowRegistry.profileWindow(context.profileId)
    ) host.gameWindowClosed?.();
  });

  win.on("focus", installMenu);
  installMenu();
  void win.loadURL(RENDERER_URL);
  return win;
}
