import {
  app,
  BrowserWindow,
  type Session,
} from "electron";
import {
  desktopPlatformFor,
  IPC,
  RENDERER_INIT_ARGUMENT,
  type RendererInit,
} from "../shared/contracts.js";
import { isCanonicalControlRendererUrl } from "./core/renderer-trust.js";
import { logEvent } from "./diagnostics.js";
import { preloadPath } from "./paths.js";
import type { WindowRegistry } from "./window-registry.js";

export const CONTROL_RENDERER_URL = "gw://control/";

function controlRendererInitArgument(): string {
  const init: RendererInit = {
    rendererRole: "control",
    desktopPlatform: desktopPlatformFor(process.platform),
    enhancementAutomation: false,
    enhancementSelection: {
      nativeCursor: false,
      targetReadout: false,
    },
    templateFsTrace: false,
  };
  return `${RENDERER_INIT_ARGUMENT}${JSON.stringify(init)}`;
}

export function createControlWindow(
  targetSession: Session,
  windows: WindowRegistry,
): BrowserWindow {
  const existing = windows.controlWindow();
  if (existing && !existing.isDestroyed()) return existing;
  const win = new BrowserWindow({
    width: 620,
    height: 720,
    minWidth: 480,
    minHeight: 520,
    title: "Guild Wars",
    show: false,
    webPreferences: {
      session: targetSession,
      preload: preloadPath(),
      additionalArguments: [controlRendererInitArgument()],
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
  windows.registerControl(win);
  win.once("ready-to-show", () => {
    if (process.env.GW_BACKGROUND_LAUNCH === "1" && !app.isPackaged) {
      win.showInactive();
    } else {
      win.show();
    }
  });
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  win.webContents.on("will-navigate", (event, url) => {
    if (!isCanonicalControlRendererUrl(url)) {
      event.preventDefault();
      logEvent({ k: "security.navigationBlocked" });
    }
  });
  win.webContents.on("will-redirect", (event, url) => {
    if (!isCanonicalControlRendererUrl(url)) {
      event.preventDefault();
      logEvent({ k: "security.redirectBlocked" });
    }
  });
  win.webContents.on("will-attach-webview", (event) => event.preventDefault());
  void win.loadURL(CONTROL_RENDERER_URL);
  return win;
}

export function notifyProfilesChanged(windows: WindowRegistry): void {
  const win = windows.controlWindow();
  if (!win || win.isDestroyed() || win.webContents.isDestroyed()) return;
  win.webContents.send(IPC.profilesChanged);
}
