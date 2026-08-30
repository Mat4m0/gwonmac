/**
 * The launcher BrowserWindow and its non-game security boundary.
 *
 * Window identity stays in the registry and presentation policy stays in the
 * coordinator. This module owns only construction, trust, and local renderer
 * recovery so a launcher failure never closes a running game.
 */
import { app, BrowserWindow, Menu, session } from "electron";
import { BACKGROUND_LAUNCH } from "./background-launch.js";
import { isQuitting } from "./lifecycle.js";
import { launcherPreloadPath } from "./paths.js";
import type { ProtocolDeps } from "./protocol.js";
import { installLauncherProtocolHandlerForSession } from "./protocol.js";
import type { WindowCoordinator } from "./window-coordinator.js";
import { windowRegistry } from "./window-registry.js";

const LAUNCHER_URL = "gw://app/launcher/index.html";
let protocolInstalled = false;

function installLauncherMenu(): void {
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    ...(process.platform === "darwin"
      ? [{
          label: app.name,
          submenu: [
            { role: "about" as const },
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
  ]));
}

export function createLauncherWindow(
  deps: ProtocolDeps,
  coordinator: WindowCoordinator<BrowserWindow>,
): BrowserWindow {
  const existing = windowRegistry.launcherWindow();
  if (existing) {
    coordinator.revealLauncher({ activateApp: true });
    return existing;
  }
  const owner = session.fromPartition("persist:gw-launcher", { cache: false });
  if (BACKGROUND_LAUNCH) app.dock?.hide();
  if (!protocolInstalled) {
    installLauncherProtocolHandlerForSession(owner);
    protocolInstalled = true;
  }
  owner.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  owner.setPermissionCheckHandler(() => false);
  const win = new BrowserWindow({
    width: 1180,
    height: 760,
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
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  win.webContents.on("will-navigate", (event, url) => {
    if (url !== LAUNCHER_URL) event.preventDefault();
  });
  win.webContents.on("will-attach-webview", (event) => event.preventDefault());
  win.once("ready-to-show", () => {
    if (!BACKGROUND_LAUNCH) win.show();
  });
  win.on("focus", () => {
    coordinator.recordFocused(win);
    installLauncherMenu();
  });
  installLauncherMenu();
  win.on("close", (event) => {
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
    const replacement = createLauncherWindow(deps, coordinator);
    if (!win.isDestroyed()) win.destroy();
    coordinator.revealLauncher();
    replacement.focus();
  });
  void win.loadURL(LAUNCHER_URL);
  return win;
}
