/**
 * The one Settings window: construction, trust and placement above the window
 * that opened it. Settings changes go through the launcher IPC handlers that
 * accept the `settings` role; this module only owns the window.
 */
import { BrowserWindow } from "electron";
import { isQuitting } from "./lifecycle.js";
import { settingsPreloadPath } from "./paths.js";
import type { ProtocolDeps } from "./protocol.js";
import { launcherSession } from "./accounts-window.js";
import { sendIfLive } from "./ipc-channel-registry.js";
import { windowRegistry } from "./window-registry.js";
import { LAUNCHER_IPC } from "../shared/launcher-contracts.js";
import type { SettingsTarget } from "../shared/settings-catalogue.js";

const SETTINGS_URL = "gw://app/launcher/settings.html";
/** The target asked for before the page could listen; the page takes it once on load. */
let pendingTarget: SettingsTarget | null = null;

export function takeSettingsTarget(): SettingsTarget | null {
  const target = pendingTarget;
  pendingTarget = null;
  return target;
}

/**
 * Shows Settings above `opener`, at `target` when given. A child window stays above
 * its parent and joins its Space, so Settings opened from a full-screen game appears
 * over that game instead of on another desktop.
 */
export function openSettingsWindow(
  deps: ProtocolDeps,
  target: SettingsTarget | undefined,
  opener: BrowserWindow | null,
  onFocus: () => void,
): BrowserWindow {
  const parent = opener && !opener.isDestroyed() && windowRegistry.contextForWebContents(opener.webContents.id)?.role !== "settings"
    ? opener
    : null;
  const existing = windowRegistry.settingsWindow();
  if (existing) {
    if (parent && existing.getParentWindow() !== parent) existing.setParentWindow(parent);
    if (target) sendIfLive(existing, LAUNCHER_IPC.settingsTargetEvent, target);
    if (existing.isMinimized()) existing.restore();
    existing.show();
    existing.focus();
    return existing;
  }
  pendingTarget = target ?? null;
  const win = new BrowserWindow({
    width: 960,
    height: 680,
    minWidth: 760,
    minHeight: 520,
    title: "Settings",
    backgroundColor: "#181714",
    show: false,
    fullscreenable: false,
    ...(parent ? { parent } : {}),
    webPreferences: {
      session: launcherSession(deps),
      preload: settingsPreloadPath(),
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
  windowRegistry.register(win, { role: "settings" });
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  win.webContents.on("will-navigate", (event, url) => {
    if (url !== SETTINGS_URL) event.preventDefault();
  });
  win.webContents.on("will-attach-webview", (event) => event.preventDefault());
  win.once("ready-to-show", () => win.show());
  win.on("focus", onFocus);
  win.on("closed", () => {
    windowRegistry.unregister(win);
    pendingTarget = null;
  });
  // Saves land in main as they happen, so a crashed page loses nothing: reload once, then close.
  let recoveryUsed = false;
  win.webContents.on("render-process-gone", (_event, details) => {
    if (isQuitting() || details.reason === "clean-exit" || win.isDestroyed()) return;
    if (recoveryUsed) { win.close(); return; }
    recoveryUsed = true;
    win.reload();
  });
  void win.loadURL(SETTINGS_URL);
  return win;
}
