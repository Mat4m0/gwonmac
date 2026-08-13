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
  fitWindowStateToDisplays,
  loadWindowState,
  saveWindowState,
  type WindowBounds,
  type WindowState,
} from "./core/window-state.js";
import { logEvent } from "./diagnostics.js";
import { isCanonicalRendererUrl } from "./core/renderer-trust.js";
import { isQuitting } from "./lifecycle.js";
import { gamePaths, preloadPath } from "./paths.js";
import { toggleTools } from "./renderer-commands.js";
import { installApplicationMenu } from "./window-menu.js";
import { windowRegistry, type WindowContext } from "./window-registry.js";

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
  exportDiagnostics: () => Promise<string>;
  markPerformanceProblem: () => void;
  startCapture: (level: 1 | 2) => Promise<void>;
  stopCapture: () => Promise<void>;
  reloadGame: (win: BrowserWindow) => void;
  prepareRendererRecovery: () => Promise<void>;
}

let mainWindow: BrowserWindow | null = null;
let rendererRecoveryUsed = false;
let restoredWindowState: WindowState | null = null;
let lastNormalBounds: WindowBounds | null = null;
let windowStateTimer: ReturnType<typeof setTimeout> | null = null;
let windowStateWrite: Promise<void> = Promise.resolve();
let windowStateReset: Promise<void> = Promise.resolve();
let windowStateResetDepth = 0;
let downloadPowerBlockerId: number | null = null;

export function updateLongRunningTaskFeedback(
  value: DownloadProgress,
  win = mainWindow,
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

export async function prepareWindowState(): Promise<void> {
  const loaded = await loadWindowState(gamePaths().windowState, () => {
    logEvent({ k: "window.stateCorruptCleared" });
  });
  restoredWindowState = loaded
    ? fitWindowStateToDisplays(loaded, workAreas(), primaryWorkArea())
    : null;
  lastNormalBounds = restoredWindowState?.bounds ?? null;
  if (restoredWindowState) {
    logEvent({ k: "window.stateRestored",
      mode: restoredWindowState.mode,
      width: restoredWindowState.bounds.width,
      height: restoredWindowState.bounds.height,
    });
  }
}

function currentWindowState(win: BrowserWindow): WindowState {
  const mode = win.isFullScreen()
    ? "fullscreen"
    : win.isMaximized()
      ? "maximized"
      : "normal";
  if (mode === "normal") {
    lastNormalBounds = { ...win.getBounds() };
  }
  return {
    bounds:
      lastNormalBounds ??
      fitWindowStateToDisplays(
        defaultWindowState(primaryWorkArea()),
        workAreas(),
        primaryWorkArea(),
      ).bounds,
    mode,
  };
}

async function persistWindowState(win: BrowserWindow): Promise<void> {
  if (win.isDestroyed() || mainWindow !== win) return;
  const state = currentWindowState(win);
  restoredWindowState = state;
  const write = windowStateWrite.then(() =>
    saveWindowState(gamePaths().windowState, state),
  );
  windowStateWrite = write.catch(() => undefined);
  await write;
}

function scheduleWindowStateSave(win: BrowserWindow): void {
  // Leaving fullscreen/maximized and applying the default bounds emits several
  // intermediate events. Persisting one of those after the explicit reset
  // write can resurrect the old placement.
  if (windowStateResetDepth > 0) return;
  if (windowStateTimer) clearTimeout(windowStateTimer);
  windowStateTimer = setTimeout(() => {
    windowStateTimer = null;
    void persistWindowState(win).catch(() => {
      logEvent({ k: "window.stateSaveFailed" });
    });
  }, 300);
}

export async function flushWindowState(): Promise<void> {
  await windowStateReset;
  if (windowStateTimer) {
    clearTimeout(windowStateTimer);
    windowStateTimer = null;
  }
  const win = mainWindow;
  if (!win || win.isDestroyed()) return;
  await persistWindowState(win);
  await windowStateWrite;
}

export function resetWindowState(win = mainWindow): Promise<void> {
  const reset = windowStateReset.then(async () => {
    windowStateResetDepth += 1;
    try {
      if (windowStateTimer) {
        clearTimeout(windowStateTimer);
        windowStateTimer = null;
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
      restoredWindowState = settled;
      lastNormalBounds = settled.bounds;
      const write = windowStateWrite.then(() =>
        saveWindowState(gamePaths().windowState, settled),
      );
      windowStateWrite = write.catch(() => undefined);
      await write;
      logEvent({ k: "window.stateReset",
        width: settled.bounds.width,
        height: settled.bounds.height,
      });
    } finally {
      windowStateResetDepth -= 1;
    }
  });
  windowStateReset = reset.catch(() => undefined);
  return reset;
}

export function getMainWindow(): BrowserWindow | null {
  return mainWindow;
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
    readonly context?: WindowContext;
    readonly session?: Electron.Session;
    readonly title?: string;
  } = {},
): BrowserWindow {
  const context = options.context ?? { mode: "single", role: "game" };
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

  mainWindow = win;
  windowRegistry.register(win, context);
  updateLongRunningTaskFeedback(host.getProgress(), win);
  const rendererId = win.webContents.id;

  win.once("ready-to-show", () => {
    if (initialState?.mode === "maximized") win.maximize();
    if (BACKGROUND_LAUNCH) win.showInactive();
    else win.show();
    if (initialState?.mode === "fullscreen") win.setFullScreen(true);
  });

  const rememberNormalBounds = (): void => {
    if (
      windowStateResetDepth > 0 ||
      win.isFullScreen() ||
      win.isMaximized()
    ) return;
    lastNormalBounds = { ...win.getBounds() };
    scheduleWindowStateSave(win);
  };
  win.on("move", rememberNormalBounds);
  win.on("resize", rememberNormalBounds);
  const persistMode = (): void => {
    if (windowStateResetDepth > 0) return;
    void persistWindowState(win).catch(() => {
      logEvent({ k: "window.stateSaveFailed" });
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
  win.on("focus", () => logEvent({ k: "window.focused" }));
  win.on("blur", () => logEvent({ k: "window.blurred" }));
  win.on("minimize", () => logEvent({ k: "window.minimized" }));
  win.on("restore", () => logEvent({ k: "window.restored" }));
  win.on("hide", () => logEvent({ k: "window.hidden" }));
  win.on("show", () => logEvent({ k: "window.shown" }));
  // Only the settled events. Electron emits `will-resize` and `will-move` once
  // per step of a live drag, which would flood the bounded event ring and
  // evict the very evidence these listeners exist to keep.
  win.on("resized", () => logEvent({ k: "window.resized" }));
  win.on("moved", () => logEvent({ k: "window.moved" }));

  win.webContents.setWindowOpenHandler(() => {
    logEvent({ k: "security.windowOpenBlocked" });
    return { action: "deny" };
  });

  // Cmd/Ctrl+B, decided in the main process before the page sees the key.
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
  // The View menu item carries the same accelerator with
  // `registerAccelerator: false`, so the shortcut is still shown and
  // discoverable without also being bound and fired twice.
  win.webContents.on("before-input-event", (event, input) => {
    if (input.type !== "keyDown") return;
    if (input.key.toLowerCase() !== "b") return;
    if (!(input.meta || input.control) || input.shift || input.alt) return;
    event.preventDefault();
    void toggleTools(win);
  });

  win.webContents.on("will-navigate", (event, url) => {
    if (!isCanonicalRendererUrl(url)) {
      event.preventDefault();
      logEvent({ k: "security.navigationBlocked" });
    }
  });

  win.webContents.on("will-redirect", (event, url) => {
    if (!isCanonicalRendererUrl(url)) {
      event.preventDefault();
      logEvent({ k: "security.redirectBlocked" });
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
    logEvent({ k: "security.webviewBlocked" });
  });

  win.webContents.on("destroyed", () => {
    logEvent({ k: "webContents.destroyed" });
    host.sockets.closeAll(rendererId);
  });

  win.webContents.on("render-process-gone", (_event, details) => {
    logEvent({
      k: isQuitting()
        ? "renderer.processExitedDuringQuit"
        : "renderer.processGone",
      exitCode: details.exitCode,
    });
    host.sockets.closeAll(rendererId);
    if (isQuitting()) return;
    if (
      !rendererRecoveryUsed &&
      details.reason !== "clean-exit" &&
      !win.isDestroyed()
    ) {
      rendererRecoveryUsed = true;
      logEvent({ k: "renderer.recoveryScheduled" });
      setTimeout(() => {
        if (isQuitting() || win.isDestroyed()) return;
        void host
          .prepareRendererRecovery()
          .catch((error) => {
            logEvent({
              k: "renderer.recoveryPreparationFailed",
              code: errorCode(error),
            });
          })
          .finally(() => {
            if (isQuitting() || win.isDestroyed()) return;
            createMainWindow(host, options);
            win.destroy();
            logEvent({ k: "renderer.recovered" });
          });
      }, 500);
    } else if (details.reason !== "clean-exit") {
      dialog.showErrorBox(
        "Guild Wars stopped unexpectedly",
        "Use View → Reload Game to try again. If it repeats, choose Help → Report a Bug.",
      );
    }
  });

  win.on("close", (event) => {
    if (isQuitting()) return;
    if (context.mode === "multi") return;
    event.preventDefault();
    logEvent({ k: "window.closeRequested" });
    app.quit();
  });

  win.on("closed", () => {
    windowRegistry.unregister(win);
    if (mainWindow === win) mainWindow = null;
  });

  installApplicationMenu({
    host,
    win,
    resetWindowState: () => resetWindowState(win),
  });
  void win.loadURL(RENDERER_URL);
  return win;
}
