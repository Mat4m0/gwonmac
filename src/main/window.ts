import {
  app,
  BrowserWindow,
  dialog,
  Menu,
  powerSaveBlocker,
  screen,
  shell,
  type MenuItemConstructorOptions,
} from "electron";
import type {
  AppSettings,
  AppSettingsPatch,
  DownloadProgress,
} from "../shared/contracts.js";
import { EXTERNAL_URLS } from "../shared/contracts.js";
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
import { log } from "./diagnostics.js";
import { isQuitting } from "./lifecycle.js";
import { gamePaths, preloadPath } from "./paths.js";
import { isDevBuild } from "./protocol.js";

const BUG_REPORT_URL =
  `${EXTERNAL_URLS.github}/issues/new?template=bug-report.yml`;
const USER_GUIDE_URL = `${EXTERNAL_URLS.github}/blob/main/docs/user-guide.md`;

export interface WindowHost {
  sockets: SocketManager;
  getProgress: () => DownloadProgress;
  getSettings: () => Promise<AppSettings>;
  updateSettings: (value: AppSettingsPatch) => Promise<AppSettings>;
  exportDiagnostics: () => Promise<string>;
  markPerformanceProblem: () => void;
  startCapture: (level: 1 | 2) => Promise<void>;
  stopCapture: () => Promise<void>;
  reloadGame: (win: BrowserWindow) => void;
}

let mainWindow: BrowserWindow | null = null;
let rendererRecoveryUsed = false;
let restoredWindowState: WindowState | null = null;
let lastNormalBounds: WindowBounds | null = null;
let windowStateTimer: ReturnType<typeof setTimeout> | null = null;
let windowStateWrite: Promise<void> = Promise.resolve();
let downloadPowerBlockerId: number | null = null;

export function updateLongRunningTaskFeedback(
  value: DownloadProgress,
  win = mainWindow,
): boolean {
  const feedback = longRunningTaskFeedback(value);
  if (feedback.preventAppSuspension && downloadPowerBlockerId === null) {
    downloadPowerBlockerId = powerSaveBlocker.start("prevent-app-suspension");
    log("app", "info", "download.appSuspensionPrevented");
  } else if (!feedback.preventAppSuspension && downloadPowerBlockerId !== null) {
    powerSaveBlocker.stop(downloadPowerBlockerId);
    downloadPowerBlockerId = null;
    log("app", "info", "download.appSuspensionRestored");
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
    log("app", "warn", "window.stateCorruptCleared");
  });
  restoredWindowState = loaded
    ? fitWindowStateToDisplays(loaded, workAreas(), primaryWorkArea())
    : null;
  lastNormalBounds = restoredWindowState?.bounds ?? null;
  if (restoredWindowState) {
    log("app", "info", "window.stateRestored", {
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
  if (windowStateTimer) clearTimeout(windowStateTimer);
  windowStateTimer = setTimeout(() => {
    windowStateTimer = null;
    void persistWindowState(win).catch(() => {
      log("app", "error", "window.stateSaveFailed");
    });
  }, 300);
}

export async function flushWindowState(): Promise<void> {
  if (windowStateTimer) {
    clearTimeout(windowStateTimer);
    windowStateTimer = null;
  }
  const win = mainWindow;
  if (!win || win.isDestroyed()) return;
  await persistWindowState(win);
  await windowStateWrite;
}

export async function resetWindowState(win = mainWindow): Promise<void> {
  if (windowStateTimer) {
    clearTimeout(windowStateTimer);
    windowStateTimer = null;
  }
  const reset = defaultWindowState(primaryWorkArea());
  restoredWindowState = reset;
  lastNormalBounds = reset.bounds;
  if (win && !win.isDestroyed()) {
    if (win.isFullScreen()) {
      await new Promise<void>((resolve) => {
        const timeout = setTimeout(resolve, 5_000);
        win.once("leave-full-screen", () => {
          clearTimeout(timeout);
          resolve();
        });
        win.setFullScreen(false);
      });
    }
    if (win.isMaximized()) {
      await new Promise<void>((resolve) => {
        const timeout = setTimeout(resolve, 5_000);
        win.once("unmaximize", () => {
          clearTimeout(timeout);
          resolve();
        });
        win.unmaximize();
      });
    }
    win.setBounds(reset.bounds);
  }
  const write = windowStateWrite.then(() =>
    saveWindowState(gamePaths().windowState, reset),
  );
  windowStateWrite = write.catch(() => undefined);
  await write;
  log("app", "info", "window.stateReset", {
    width: reset.bounds.width,
    height: reset.bounds.height,
  });
}

export function getMainWindow(): BrowserWindow | null {
  return mainWindow;
}

export function createMainWindow(host: WindowHost): BrowserWindow {
  const initialState = restoredWindowState
    ? fitWindowStateToDisplays(
        restoredWindowState,
        workAreas(),
        primaryWorkArea(),
      )
    : null;
  const win = new BrowserWindow({
    ...(initialState?.bounds ?? { width: 1280, height: 800 }),
    minWidth: 800,
    minHeight: 600,
    title: "Guild Wars",
    show: false,
    webPreferences: {
      preload: preloadPath(),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      webviewTag: false,
      spellcheck: false,
      allowRunningInsecureContent: false,
      experimentalFeatures: false,
    },
  });

  mainWindow = win;
  updateLongRunningTaskFeedback(host.getProgress(), win);
  const rendererId = win.webContents.id;

  win.once("ready-to-show", () => {
    if (initialState?.mode === "maximized") win.maximize();
    win.show();
    if (initialState?.mode === "fullscreen") win.setFullScreen(true);
  });

  const rememberNormalBounds = (): void => {
    if (win.isFullScreen() || win.isMaximized()) return;
    lastNormalBounds = { ...win.getBounds() };
    scheduleWindowStateSave(win);
  };
  win.on("move", rememberNormalBounds);
  win.on("resize", rememberNormalBounds);
  const persistMode = (): void => {
    void persistWindowState(win).catch(() => {
      log("app", "error", "window.stateSaveFailed");
    });
  };
  win.on("maximize", persistMode);
  win.on("unmaximize", persistMode);
  win.on("enter-full-screen", persistMode);
  win.on("leave-full-screen", persistMode);

  win.webContents.setWindowOpenHandler(() => {
    log("app", "warn", "security.windowOpenBlocked");
    return { action: "deny" };
  });

  win.webContents.on("will-navigate", (event, url) => {
    if (!isAppUrl(url)) {
      event.preventDefault();
      log("app", "warn", "security.navigationBlocked", { url });
    }
  });

  win.webContents.on("will-redirect", (event, url) => {
    if (!isAppUrl(url)) {
      event.preventDefault();
      log("app", "warn", "security.redirectBlocked", { url });
    }
  });

  win.webContents.session.setPermissionRequestHandler((_wc, _perm, callback) => {
    callback(false);
  });
  win.webContents.session.setPermissionCheckHandler(() => false);
  win.webContents.on("will-attach-webview", (event) => {
    event.preventDefault();
    log("app", "warn", "security.webviewBlocked");
  });

  win.webContents.on("destroyed", () => {
    log("app", "info", "webContents.destroyed");
    host.sockets.closeAll(rendererId);
  });

  win.webContents.on("render-process-gone", (_event, details) => {
    log("renderer", isQuitting() ? "info" : "error", "renderer.processGone", {
      reason: details.reason,
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
      log("renderer", "warn", "renderer.recoveryScheduled");
      setTimeout(() => {
        if (isQuitting() || win.isDestroyed()) return;
        createMainWindow(host);
        win.destroy();
        log("renderer", "info", "renderer.recovered");
      }, 500);
    } else if (details.reason !== "clean-exit") {
      dialog.showErrorBox(
        "Guild Wars stopped unexpectedly",
        "Use View → Reload Game to try again. If it repeats, choose Help → Report a Problem.",
      );
    }
  });

  win.on("close", (event) => {
    if (isQuitting()) return;
    event.preventDefault();
    log("app", "info", "window.closeRequested");
    app.quit();
  });

  win.on("closed", () => {
    if (mainWindow === win) mainWindow = null;
  });

  installMenu(host, win);
  void win.loadURL("gw://app/");
  return win;
}

function isAppUrl(raw: string): boolean {
  try {
    const url = new URL(raw);
    return url.protocol === "gw:" && url.hostname === "app";
  } catch {
    return false;
  }
}

export async function resetGameInput(win: BrowserWindow): Promise<void> {
  if (win.isDestroyed() || win.webContents.isDestroyed()) return;
  try {
    await win.webContents.executeJavaScript(
      "window.dispatchEvent(new CustomEvent('gw:input-reset'))",
    );
  } catch {
    // Reload/quit can destroy the renderer between the liveness check and send.
  }
}

export async function exportProblemReport(
  win: BrowserWindow,
  exportDiagnostics: () => Promise<string>,
): Promise<void> {
  try {
    const saved = await exportDiagnostics();
    if (!saved) return;
    log("app", "info", "diagnostics.exported");
    const { response } = await dialog.showMessageBox(win, {
      type: "info",
      buttons: ["Open Bug Report", "Reveal in Finder", "Done"],
      defaultId: 0,
      cancelId: 2,
      message: "Problem report ready",
      detail:
        "Send the single .gwdiag file when reporting the problem. It contains redacted diagnostics and no credentials.",
    });
    if (response === 0) await shell.openExternal(BUG_REPORT_URL);
    if (response === 1) shell.showItemInFolder(saved);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log("app", "error", "diagnostics.exportFailed", { message });
    dialog.showErrorBox("Report export failed", message);
  }
}

function installMenu(host: WindowHost, win: BrowserWindow): void {
  const isMac = process.platform === "darwin";
  const dev = isDevBuild();
  const reportProblem = async (): Promise<void> => {
    await resetGameInput(win);
    const { response } = await dialog.showMessageBox(win, {
      type: "info",
      buttons: [
        "Export Recent Diagnostics…",
        "Record Performance Problem",
        "Cancel",
      ],
      defaultId: 0,
      cancelId: 2,
      message: "Report a problem",
      detail:
        "Export immediately for crashes, startup, downloads, or general bugs. For stutter, record the problem, press Cmd+Shift+M when it happens, then stop the capture.",
    });
    if (response === 0) {
      await exportProblemReport(win, host.exportDiagnostics);
    }
    if (response === 1) {
      try {
        await host.startCapture(1);
      } catch (error) {
        dialog.showErrorBox(
          "Capture could not start",
          error instanceof Error ? error.message : String(error),
        );
      }
    }
  };

  const template: MenuItemConstructorOptions[] = [
    ...(isMac
      ? [
          {
            label: app.name,
            submenu: [
              { role: "about" as const },
              { type: "separator" as const },
              {
                label: "Settings…",
                accelerator: "CmdOrCtrl+,",
                click: async () => {
                  if (win.isDestroyed() || win.webContents.isDestroyed()) return;
                  await resetGameInput(win);
                  await win.webContents.executeJavaScript(
                    "window.dispatchEvent(new CustomEvent('gw:settings'))",
                  );
                },
              },
              { type: "separator" as const },
              { role: "hide" as const },
              { role: "hideOthers" as const },
              { role: "unhide" as const },
              { type: "separator" as const },
              { role: "quit" as const },
            ],
          },
        ]
      : []),
    {
      label: "Edit",
      submenu: [
        { role: "cut" },
        { role: "copy" },
        { role: "paste" },
        { role: "selectAll" },
      ],
    },
    {
      label: "View",
      submenu: [
        { role: "togglefullscreen" },
        {
          id: "reset-window-state",
          label: "Reset Window Size and Position",
          click: () => {
            void resetWindowState(win).catch(() => {
              log("app", "error", "window.stateResetFailed");
            });
          },
        },
        { type: "separator" },
        {
          label: "Toggle Diagnostics",
          click: async () => {
            await resetGameInput(win);
            const cur = await host.getSettings();
            await host.updateSettings({ showDiagnostics: !cur.showDiagnostics });
            if (win.isDestroyed() || win.webContents.isDestroyed()) return;
            void win.webContents.executeJavaScript(
              "window.dispatchEvent(new CustomEvent('gw:diagnostics-toggle'))",
            );
          },
        },
        {
          label: "Start Performance Capture",
          click: async () => {
            await resetGameInput(win);
            void host.startCapture(1).catch((error) => {
              dialog.showErrorBox(
                "Capture could not start",
                error instanceof Error ? error.message : String(error),
              );
            });
          },
        },
        {
          id: "mark-performance-problem",
          label: "Mark Performance Problem",
          accelerator: "CmdOrCtrl+Shift+M",
          click: async () => {
            await resetGameInput(win);
            host.markPerformanceProblem();
          },
        },
        {
          label: "Start Chromium Trace",
          click: async () => {
            await resetGameInput(win);
            void host.startCapture(2).catch((error) => {
              dialog.showErrorBox(
                "Trace could not start",
                error instanceof Error ? error.message : String(error),
              );
            });
          },
        },
        {
          label: "Stop Capture",
          click: async () => {
            await resetGameInput(win);
            void host.stopCapture();
          },
        },
        {
          label: "Reload Game",
          accelerator: "CmdOrCtrl+R",
          click: async () => {
            await resetGameInput(win);
            if (host.sockets.size(win.webContents.id) > 0) {
              const { response } = await dialog.showMessageBox(win, {
                type: "warning",
                buttons: ["Reload", "Cancel"],
                defaultId: 1,
                cancelId: 1,
                message: "Reload the game?",
                detail: "Live game sockets are open and will be closed.",
              });
              if (response !== 0) return;
            }
            host.reloadGame(win);
          },
        },
        ...(dev
          ? [
              { type: "separator" as const },
              { role: "toggleDevTools" as const },
            ]
          : []),
      ],
    },
    {
      label: "Help",
      submenu: [
        {
          label: "User Guide",
          click: () => {
            void shell.openExternal(USER_GUIDE_URL);
          },
        },
        {
          label: "Project Website",
          click: () => {
            void shell.openExternal(EXTERNAL_URLS.github);
          },
        },
        {
          id: "report-problem",
          label: "Report a Problem…",
          click: () => void reportProblem(),
        },
      ],
    },
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}
