/**
 * The launcher BrowserWindow and its non-game security boundary.
 *
 * Window identity stays in the registry and presentation policy stays in the
 * coordinator. This module owns only construction, trust, and local renderer
 * recovery so a launcher failure never closes a running game.
 */
import { app, BrowserWindow, screen, session } from "electron";
import { BACKGROUND_LAUNCH } from "./background-launch.js";
import { isQuitting, onAppQuit } from "./lifecycle.js";
import { gamePaths, launcherPreloadPath } from "./paths.js";
import type { ProtocolDeps } from "./protocol.js";
import { installLauncherProtocolHandlerForSession } from "./protocol.js";
import type { WindowCoordinator } from "./window-coordinator.js";
import { windowRegistry } from "./window-registry.js";
import {
  installNativeApplicationMenu,
  type LauncherReveal,
  type AccountMenuActions,
} from "./window-menu.js";

import { fitWindowStateToDisplays, loadWindowState, saveWindowState, type WindowState } from "./core/window-state.js";

let launcherPlacement: WindowState | null = null;
// Renderer recovery can briefly overlap two windows sharing this one file.
let placementWrites = Promise.resolve();

export async function prepareLauncherWindowState(): Promise<void> {
  try {
    const saved = await loadWindowState(gamePaths().launcherWindowState);
    if (saved) launcherPlacement = fitWindowStateToDisplays(saved,
      screen.getAllDisplays().map(display => display.workArea), screen.getPrimaryDisplay().workArea);
  } catch (error) {
    console.error("Launcher window placement could not be restored", error);
  }
}

const LAUNCHER_URL = "gw://app/launcher/index.html";
let protocolInstalled = false;

function installLauncherMenu(revealLauncher: LauncherReveal, accounts: AccountMenuActions): void {
  installNativeApplicationMenu([
    ...(process.platform === "darwin"
      ? [{
          label: app.name,
          submenu: [
            { role: "about" as const },
            { type: "separator" as const },
            {
              id: "check-for-updates",
              label: "Check for Updates…",
              click: () => revealLauncher("settings"),
            },
            {
              id: "show-settings",
              label: "Settings…",
              accelerator: "CmdOrCtrl+,",
              click: () => revealLauncher("settings"),
            },
            { type: "separator" as const },
            { role: "hide" as const },
            { role: "hideOthers" as const },
            { role: "unhide" as const },
            { type: "separator" as const },
            { role: "quit" as const },
          ],
        }]
      : []),
    {
      label: "Edit",
      submenu: [
        { role: "cut" as const },
        { role: "copy" as const },
        { role: "paste" as const },
        { role: "selectAll" as const },
      ],
    },
    { role: "windowMenu" },
  ], revealLauncher, accounts);
}

export function createLauncherWindow(
  deps: ProtocolDeps,
  coordinator: WindowCoordinator<BrowserWindow>,
  revealLauncher: LauncherReveal,
  accounts: AccountMenuActions,
): BrowserWindow {
  const existing = windowRegistry.launcherWindow();
  if (existing) {
    coordinator.revealLauncher({ activateApp: true });
    return existing;
  }
  const owner = session.fromPartition("persist:gw-launcher", { cache: false });
  if (BACKGROUND_LAUNCH) app.dock?.hide();
  if (!protocolInstalled) {
    installLauncherProtocolHandlerForSession(owner, deps);
    protocolInstalled = true;
  }
  owner.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  owner.setPermissionCheckHandler(() => false);
  const restored = launcherPlacement ? fitWindowStateToDisplays(launcherPlacement,
    screen.getAllDisplays().map(display => display.workArea), screen.getPrimaryDisplay().workArea) : null;
  const win = new BrowserWindow({
    width: 1180,
    height: 760,
    ...(restored?.bounds ?? {}),
    minWidth: 900,
    minHeight: 640,
    title: "Guild Wars Reforged",
    titleBarStyle: "hiddenInset",
    backgroundColor: "#0a0806",
    show: false,
    webPreferences: {
      session: owner,
      preload: launcherPreloadPath(),
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
  windowRegistry.register(win, { role: "launcher" });
  let saveTimer: ReturnType<typeof setTimeout> | undefined;
  let restoring = true;
  let normalBounds = restored?.bounds ?? win.getBounds();
  function capturePlacement() {
    if (win.isDestroyed() || restoring) return;
    const mode = win.isFullScreen() ? "fullscreen" : win.isMaximized() ? "maximized" : "normal";
    if (mode === "normal" && !win.isMinimized()) normalBounds = win.getNormalBounds();
    launcherPlacement = { bounds: { ...normalBounds }, mode,
      displayWorkArea: { ...screen.getDisplayMatching(normalBounds).workArea } };
  }
  function persistPlacement(): Promise<void> {
    clearTimeout(saveTimer);
    saveTimer = undefined;
    const value = launcherPlacement;
    if (value) placementWrites = placementWrites.then(() => saveWindowState(gamePaths().launcherWindowState, value))
      .catch(error => { console.error("Launcher window placement could not be saved", error); });
    return placementWrites;
  }
  function schedulePlacement() {
    if (restoring || isQuitting()) return;
    capturePlacement();
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => { void persistPlacement(); }, 300);
  }
  win.on("move", schedulePlacement);
  win.on("resize", schedulePlacement);
  win.on("maximize", schedulePlacement);
  win.on("unmaximize", schedulePlacement);
  win.on("enter-full-screen", schedulePlacement);
  win.on("leave-full-screen", schedulePlacement);
  const removeCleanup = onAppQuit(async () => {
    capturePlacement();
    await persistPlacement();
  });
  win.on("closed", () => {
    void persistPlacement().finally(removeCleanup);
  });
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  win.webContents.on("will-navigate", (event, url) => {
    if (url !== LAUNCHER_URL) event.preventDefault();
  });
  win.webContents.on("will-attach-webview", (event) => event.preventDefault());
  win.once("ready-to-show", () => {
    if (restored?.mode === "maximized") win.maximize();
    if (restored?.mode === "fullscreen") win.setFullScreen(true);
    restoring = false;
    if (!BACKGROUND_LAUNCH) win.show();
  });
  win.on("focus", () => {
    coordinator.recordFocused(win);
    installLauncherMenu(revealLauncher, accounts);
  });
  installLauncherMenu(revealLauncher, accounts);
  win.on("close", (event) => {
    capturePlacement();
    void persistPlacement();
    if (!isQuitting()) coordinator.handleLauncherClose(event);
  });
  win.on("closed", () => windowRegistry.unregister(win));

  let recoveryUsed = false;
  win.webContents.on("render-process-gone", (_event, details) => {
    if (isQuitting() || details.reason === "clean-exit") return;
    if (!recoveryUsed) {
      recoveryUsed = true;
      setTimeout(() => {
        if (!isQuitting() && !win.isDestroyed()) win.reload();
      }, 250);
      return;
    }
    windowRegistry.unregister(win);
    const replacement = createLauncherWindow(deps, coordinator, revealLauncher, accounts);
    if (!win.isDestroyed()) win.destroy();
    coordinator.revealLauncher();
    replacement.focus();
  });
  void win.loadURL(LAUNCHER_URL);
  return win;
}
