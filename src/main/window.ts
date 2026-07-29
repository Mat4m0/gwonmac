import {
  app,
  BrowserWindow,
  dialog,
  Menu,
  powerSaveBlocker,
  shell,
  type MenuItemConstructorOptions,
  type Session,
} from "electron";
import path from "node:path";
import type {
  AppSettings,
  AppSettingsPatch,
  DownloadProgress,
  RendererInit,
  EnhancementSelection,
} from "../shared/contracts.js";
import {
  desktopPlatformFor,
  EXTERNAL_URLS,
  RENDERER_INIT_ARGUMENT,
} from "../shared/contracts.js";
import { errorCode } from "../shared/errors.js";
import { longRunningTaskFeedback } from "../shared/progress.js";
import type { SocketManager } from "./core/sockets.js";
import {
  type WindowStateOwner,
} from "./window-state-owner.js";
import { logEvent } from "./diagnostics.js";
import { isCanonicalRendererUrl } from "./core/renderer-trust.js";
import { sendRendererCommand } from "./renderer-commands.js";
import { isQuitting } from "./lifecycle.js";
import { preloadPath } from "./paths.js";
import { ENHANCEMENT_AUTOMATION_ENABLED } from "./enhancement-policy.js";
import { isDevBuild } from "./protocol.js";
import type { WindowRegistry } from "./window-registry.js";
import type { ProfileId } from "./core/profiles.js";

// Tests launch the app dozens of times; without this they steal keyboard focus
// on every launch. Focus-dependent specs leave the flag unset.
const BACKGROUND_LAUNCH =
  !app.isPackaged && process.env.GW_BACKGROUND_LAUNCH === "1";
const approvedGameCloses = new WeakSet<BrowserWindow>();

const BUG_REPORT_URL =
  `${EXTERNAL_URLS.github}/issues/new?template=bug-report.yml`;
const USER_GUIDE_URL = `${EXTERNAL_URLS.github}/blob/main/docs/user-guide.md`;

export interface WindowHost {
  sockets: SocketManager;
  /** Launch-time tool choices; the served module decides whether they can run. */
  enhancementSelection: EnhancementSelection;
  getProgress: () => DownloadProgress;
  getSettings: () => Promise<AppSettings>;
  updateSettings: (value: AppSettingsPatch) => Promise<AppSettings>;
  exportDiagnostics: () => Promise<string>;
  markPerformanceProblem: (win: BrowserWindow) => void;
  startCapture: (win: BrowserWindow, level: 1 | 2) => Promise<void>;
  stopCapture: () => Promise<void>;
  reloadGame: (win: BrowserWindow) => void;
  prepareRendererRecovery: () => Promise<void>;
  closeGame: (win: BrowserWindow) => Promise<void>;
  windowState: WindowStateOwner;
  profileId: ProfileId;
  gameSession: Session;
}

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
}): string {
  const init: RendererInit = {
    rendererRole: "game",
    desktopPlatform: desktopPlatformFor(process.platform),
    enhancementAutomation: ENHANCEMENT_AUTOMATION_ENABLED,
    enhancementSelection: options.enhancementSelection,
    templateFsTrace:
      !app.isPackaged && process.env.GW_TEMPLATE_FS_TRACE === "1",
  };
  return `${RENDERER_INIT_ARGUMENT}${JSON.stringify(init)}`;
}

export function createMainWindow(
  host: WindowHost,
  windows: WindowRegistry,
): BrowserWindow {
  const initialState = host.windowState.initialState();
  if (BACKGROUND_LAUNCH) app.dock?.hide();
  const win = new BrowserWindow({
    ...(initialState?.bounds ?? { width: 1280, height: 800 }),
    minWidth: 800,
    minHeight: 600,
    title: "Guild Wars",
    ...(process.platform === "linux"
      ? { icon: path.join(process.resourcesPath, "AppIcon-linux.png") }
      : {}),
    show: false,
    webPreferences: {
      session: host.gameSession,
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
    },
  });

  windows.registerGame(win, host.profileId);
  updateLongRunningTaskFeedback(host.getProgress(), win);
  const rendererId = win.webContents.id;

  win.once("ready-to-show", () => {
    if (initialState?.mode === "maximized") win.maximize();
    if (BACKGROUND_LAUNCH) win.showInactive();
    else win.show();
    if (initialState?.mode === "fullscreen") win.setFullScreen(true);
  });

  host.windowState.attach(win);

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
      details.reason !== "clean-exit" &&
      !win.isDestroyed() &&
      windows.claimRendererRecovery(win)
    ) {
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
            host.windowState.detach(win);
            // Keep the crashed window registered until this exact handoff so
            // the manager cannot see a stopped profile and launch a duplicate
            // while recovery is already pending.
            windows.unregister(win);
            createMainWindow(host, windows);
            approvedGameCloses.add(win);
            win.destroy();
            logEvent({ k: "renderer.recovered" });
          });
      }, 500);
    } else if (details.reason !== "clean-exit") {
      dialog.showErrorBox(
        "Guild Wars stopped unexpectedly",
        "Use View → Reload Game to try again. If it repeats, choose Help → Report a Problem.",
      );
    }
  });

  let closePending = false;
  win.on("close", (event) => {
    if (isQuitting() || approvedGameCloses.has(win)) return;
    event.preventDefault();
    if (closePending) return;
    closePending = true;
    logEvent({ k: "window.closeRequested" });
    void host.closeGame(win).catch(() => {
      closePending = false;
      dialog.showErrorBox(
        "Guild Wars could not close safely",
        "The saved game files could not be flushed. Try closing the window again.",
      );
    });
  });

  installMenu(host, windows);
  void win.loadURL(RENDERER_URL);
  return win;
}

export function destroyGameWindow(win: BrowserWindow): void {
  approvedGameCloses.add(win);
  win.destroy();
}

export async function resetGameInput(win: BrowserWindow): Promise<void> {
  await sendRendererCommand(win, { type: "input.reset" });
}

export async function exportProblemReport(
  win: BrowserWindow,
  exportDiagnostics: () => Promise<string>,
): Promise<void> {
  try {
    const saved = await exportDiagnostics();
    if (!saved) return;
    logEvent({ k: "diagnostics.exported" });
    const { response } = await dialog.showMessageBox(win, {
      type: "info",
      buttons: ["Open Bug Report", "Show in Folder", "Done"],
      defaultId: 0,
      cancelId: 2,
      message: "Problem report ready",
      detail:
        "Diagnostics are optional. GitHub accepts the report after a copy is renamed from .gwdiag to .zip. It is redacted and contains no credentials.",
    });
    if (response === 0) await shell.openExternal(BUG_REPORT_URL);
    if (response === 1) shell.showItemInFolder(saved);
  } catch (error) {
    logEvent({ k: "diagnostics.exportFailed", code: errorCode(error) });
    // The prose is for the person in front of the screen, not for the export.
    dialog.showErrorBox(
      "Report export failed",
      error instanceof Error ? error.message : String(error),
    );
  }
}

function menuGameWindow(windows: WindowRegistry): BrowserWindow | null {
  const focused = BrowserWindow.getFocusedWindow();
  if (focused && windows.contextForWindow(focused)?.kind === "game") {
    return focused;
  }
  return windows.gameWindow();
}

function installMenu(host: WindowHost, windows: WindowRegistry): void {
  const isMac = process.platform === "darwin";
  const dev = isDevBuild();
  const reportProblem = async (): Promise<void> => {
    const win = menuGameWindow(windows);
    if (!win) return;
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
        `Export immediately for crashes, startup, downloads, or general bugs. For stutter, record the problem, press ${isMac ? "Cmd" : "Ctrl"}+Shift+M when it happens, then stop the capture.`,
    });
    if (response === 0) {
      await exportProblemReport(win, host.exportDiagnostics);
    }
    if (response === 1) {
      try {
        await host.startCapture(win, 1);
      } catch (error) {
        dialog.showErrorBox(
          "Capture could not start",
          error instanceof Error ? error.message : String(error),
        );
      }
    }
  };

  const settingsMenuItem: MenuItemConstructorOptions = {
    label: "Settings…",
    accelerator: "CmdOrCtrl+,",
    click: async () => {
      const win = menuGameWindow(windows);
      if (!win) return;
      await resetGameInput(win);
      await sendRendererCommand(win, { type: "settings.open" });
    },
  };

  const template: MenuItemConstructorOptions[] = [
    ...(isMac
      ? [
          {
            label: app.name,
            submenu: [
              { role: "about" as const },
              { type: "separator" as const },
              settingsMenuItem,
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
        ...(!isMac
          ? [
              settingsMenuItem,
              { type: "separator" as const },
            ]
          : []),
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
          click: async () => {
            const win = menuGameWindow(windows);
            if (!win) return;
            await resetGameInput(win);
            void host.windowState.reset(win).catch(() => {
              logEvent({ k: "window.stateResetFailed" });
            });
          },
        },
        { type: "separator" },
        {
          label: "Toggle Diagnostics",
          click: async () => {
            const win = menuGameWindow(windows);
            if (!win) return;
            await resetGameInput(win);
            const cur = await host.getSettings();
            await host.updateSettings({ showDiagnostics: !cur.showDiagnostics });
            await sendRendererCommand(win, { type: "diagnostics.toggle" });
          },
        },
        {
          id: "start-performance-capture",
          label: "Start Performance Capture",
          click: async () => {
            const win = menuGameWindow(windows);
            if (!win) return;
            await resetGameInput(win);
            void host.startCapture(win, 1).catch((error) => {
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
            const win = menuGameWindow(windows);
            if (!win) return;
            await resetGameInput(win);
            host.markPerformanceProblem(win);
          },
        },
        {
          id: "start-chromium-trace",
          label: "Start Chromium Trace",
          click: async () => {
            const win = menuGameWindow(windows);
            if (!win) return;
            await resetGameInput(win);
            void host.startCapture(win, 2).catch((error) => {
              dialog.showErrorBox(
                "Trace could not start",
                error instanceof Error ? error.message : String(error),
              );
            });
          },
        },
        {
          id: "stop-capture",
          label: "Stop Capture",
          click: async () => {
            const win = menuGameWindow(windows);
            if (!win) return;
            await resetGameInput(win);
            void host.stopCapture();
          },
        },
        {
          label: "Reload Game",
          accelerator: "CmdOrCtrl+R",
          click: async () => {
            const win = menuGameWindow(windows);
            if (!win) return;
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
