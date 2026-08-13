/**
 * The Multiple Accounts picker window and its non-game security boundary.
 *
 * The Hub uses a dedicated session and is registered with role `hub`, so game
 * IPC refuses it. Closing it does not close running accounts; a later app
 * activation can reveal the same window again.
 */
import { app, BrowserWindow, Menu, session } from "electron";
import type { ProtocolDeps } from "./protocol.js";
import { installGwProtocolHandlerForSession } from "./protocol.js";
import { preloadPath } from "./paths.js";
import { windowRegistry } from "./window-registry.js";

const HUB_URL = "gw://app/accounts.html";
let hubWindow: BrowserWindow | null = null;
let protocolInstalled = false;

function installAccountsMenu(): void {
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

export function getAccountsWindow(): BrowserWindow | null {
  return hubWindow && !hubWindow.isDestroyed() ? hubWindow : null;
}

export function revealAccountsWindow(): boolean {
  const win = getAccountsWindow();
  if (!win) return false;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
  return true;
}

export function createAccountsWindow(deps: ProtocolDeps): BrowserWindow {
  const existing = getAccountsWindow();
  if (existing) {
    revealAccountsWindow();
    return existing;
  }
  const owner = session.fromPartition("persist:gw-multi-hub", { cache: false });
  if (!protocolInstalled) {
    installGwProtocolHandlerForSession(owner, deps);
    protocolInstalled = true;
  }
  owner.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  owner.setPermissionCheckHandler(() => false);
  const win = new BrowserWindow({
    width: 700,
    height: 620,
    minWidth: 560,
    minHeight: 480,
    title: "Guild Wars Reforged — Accounts",
    show: false,
    webPreferences: {
      session: owner,
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
  hubWindow = win;
  windowRegistry.register(win, { mode: "multi", role: "hub" });
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  win.webContents.on("will-navigate", (event, url) => {
    if (url !== HUB_URL) event.preventDefault();
  });
  win.webContents.on("will-attach-webview", (event) => event.preventDefault());
  win.once("ready-to-show", () => win.show());
  win.on("focus", installAccountsMenu);
  installAccountsMenu();
  win.on("close", (event) => {
    if (windowRegistry.gameWindows().length > 0) {
      event.preventDefault();
      win.hide();
    }
  });
  win.on("closed", () => {
    windowRegistry.unregister(win);
    if (hubWindow === win) hubWindow = null;
  });
  void win.loadURL(HUB_URL);
  return win;
}
