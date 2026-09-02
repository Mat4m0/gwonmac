/**
 * The application menu, which is the whole keyboard-and-mouse surface of this
 * application outside the game itself.
 *
 * Item ids are the contract the Electron specs click through, so an item keeps
 * its id when it moves between submenus. Every item that opens a sheet or takes
 * focus clears game input first: the game never sees the key that opened it
 * released.
 */
import {
  app,
  BrowserWindow,
  clipboard,
  dialog,
  Menu,
  MenuItem,
  shell,
  type BaseWindow,
  type MenuItemConstructorOptions,
} from "electron";
import type { LauncherDestination } from "../shared/launcher-contracts.js";
import {
  EXTERNAL_URLS,
  type AppSettings,
  type GameTextEditCommand,
} from "../shared/contracts.js";
import { errorCode } from "../shared/errors.js";
import { featureActivationRequested, type FeatureId } from "../shared/feature-contracts.js";
import { logEvent, reloadTranscriptForWindow } from "./diagnostics.js";
import { exportDiagnosticsReport } from "./diagnostics-export.js";
import {
  editWindowText,
  openStorage,
  resetGameInput,
  sendRendererCommand,
  toggleTravel,
  toggleCharacterSwitch,
  toggleTrade,
  toggleTools,
} from "./renderer-commands.js";
import { isDevBuild } from "./protocol.js";
import {
  inputTraceEnabled,
  setInputTraceVisibility,
} from './input-trace.js';
import type { WindowHost } from "./window.js";
import { resolveShortcuts, shortcutAccelerator, type ShortcutAction } from "../shared/keyboard-shortcuts.js";
import { windowRegistry } from "./window-registry.js";

const USER_GUIDE_URL = `${EXTERNAL_URLS.github}/blob/main/docs/user-guide.md`;

export interface ApplicationMenuActions {
  host: WindowHost;
  /** Window state stays window.ts's; the menu only asks for the reset. */
  resetWindowState: (win: BrowserWindow) => Promise<void>;
  revealLauncher: LauncherReveal;
}

export type LauncherReveal = (destination?: LauncherDestination) => void;

/** Install one native Window menu and add the launcher's explicit recovery. */
export function installNativeApplicationMenu(
  template: MenuItemConstructorOptions[],
  revealLauncher: LauncherReveal,
): void {
  const menu = Menu.buildFromTemplate(template);
  const windowMenu = menu.items.find(
    (item) => item.role?.toLowerCase() === "windowmenu",
  )?.submenu;
  if (windowMenu) {
    windowMenu.insert(0, new MenuItem({
      id: "show-launcher",
      label: "Show Launcher",
      click: () => revealLauncher("home"),
    }));
    windowMenu.insert(1, new MenuItem({ type: "separator" }));
  }
  Menu.setApplicationMenu(menu);
}

type ToolMenuSettings = Pick<AppSettings,
  "gwonmacTools" | "buildLibrary" | "tradeChat" | "xunlaiStorage"
  | "travelPalette" | "characterSwitchEnabled" | "shortcutOverrides">;
const TOOL_MENU_FEATURES: Readonly<Record<string, { feature: FeatureId; action: ShortcutAction }>> = {
  "toggle-tools": { feature: "buildLibrary", action: "tools.toggle" },
  "toggle-trade": { feature: "tradeChat", action: "trade.toggle" },
  "open-xunlai-storage": { feature: "xunlaiStorage", action: "storage.open" },
  "open-travel": { feature: "travel", action: "travel.open" },
  "switch-character": { feature: "characterSwitch", action: "character.switch" },
};
// Electron makes accelerators immutable. Retain the existing menu builder,
// not a second mutable copy of either menu items or settings.
let rebuildGameMenu: ((settings: ToolMenuSettings) => void) | undefined;

/** Keep native menu availability and accelerators aligned with input ownership. */
export function updateToolsMenuItems(settings: ToolMenuSettings): void {
  const menu = Menu.getApplicationMenu();
  const shortcuts = resolveShortcuts(settings.shortcutOverrides);
  for (const [id, { feature, action }] of Object.entries(TOOL_MENU_FEATURES)) {
    const item = menu?.getMenuItemById(id);
    if (!item) continue;
    if ((item.accelerator ?? null) !== (shortcutAccelerator(shortcuts[action]) ?? null)) {
      rebuildGameMenu?.(settings);
      return;
    }
    item.enabled = featureActivationRequested(feature, settings);
  }
}

async function editFocusedText(
  suppliedWindow: BaseWindow | undefined,
  command: GameTextEditCommand,
): Promise<void> {
  const win = suppliedWindow
    ? BrowserWindow.fromId(suppliedWindow.id)
    : null;
  if (!win || win.isDestroyed()) return;
  const context = windowRegistry.contextForWebContents(win.webContents.id);
  if (context?.role !== "game") return;
  await editWindowText(win, command);
}

function editMenuItem(
  id: string,
  label: string,
  accelerator: string,
  command: GameTextEditCommand,
): MenuItemConstructorOptions {
  return {
    id,
    label,
    accelerator,
    click: (_item, win) => {
      void editFocusedText(win, command);
    },
  };
}

function withGameOwner(
  run: (win: BrowserWindow) => void | Promise<void>,
): () => void | Promise<void> {
  return () => {
    const win = windowRegistry.focusedOrSoleGameWindow();
    if (!win) return;
    return run(win);
  };
}

const activeQuitOrReloadDialogs = new WeakMap<BrowserWindow, Promise<void>>();
const AUTO_RELOG_LABEL = "Return to my character automatically";

async function readAutoRelogPreference(host: WindowHost): Promise<boolean | null> {
  try {
    return (await host.getSettings()).autoRelogAfterReload;
  } catch (error) {
    logEvent({ k: "settings.loadFailed", code: errorCode(error) });
    return null;
  }
}

async function saveAutoRelogPreference(
  host: WindowHost,
  previous: boolean | null,
  next: boolean,
): Promise<boolean> {
  if (previous === next) return true;
  try {
    await host.updateSettings({ autoRelogAfterReload: next });
    return true;
  } catch (error) {
    logEvent({ k: "settings.saveFailed", code: errorCode(error) });
    return false;
  }
}

async function showAutoRelogSettingsError(win: BrowserWindow): Promise<void> {
  await dialog.showMessageBox(win, {
    type: "error",
    buttons: ["OK"],
    message: "Reload setting is unavailable",
    detail: "Guild Wars was not reloaded. Try again so automatic return matches your choice.",
  });
}

async function reloadGameOrShowError(
  host: WindowHost,
  win: BrowserWindow,
  cause: "menu" | "command-q",
): Promise<void> {
  try {
    await host.reloadGame(win, cause);
  } catch {
    await dialog.showMessageBox(win, {
      type: "error",
      buttons: ["OK"],
      message: "Guild Wars could not reload",
      detail: "Your account stayed open. Try Reload Guild Wars again.",
    });
  }
}

function runExclusiveReloadDialog(
  win: BrowserWindow,
  show: () => Promise<void>,
): Promise<void> {
  const active = activeQuitOrReloadDialogs.get(win);
  if (active) return active;
  const operation = show().finally(() => {
    if (activeQuitOrReloadDialogs.get(win) === operation) {
      activeQuitOrReloadDialogs.delete(win);
    }
  });
  activeQuitOrReloadDialogs.set(win, operation);
  return operation;
}

/** The one Quit-or-Reload workflow used by the menu and physical Command-Q. */
export function showQuitOrReloadGame(
  host: WindowHost,
  win: BrowserWindow,
): Promise<void> {
  return runExclusiveReloadDialog(
    win,
    () => showQuitOrReloadGameOnce(host, win),
  );
}

function showReloadGame(host: WindowHost, win: BrowserWindow): Promise<void> {
  return runExclusiveReloadDialog(win, async () => {
    void resetGameInput(win);
    const autoRelog = await readAutoRelogPreference(host);
    const result = await dialog.showMessageBox(win, {
      type: "none",
      buttons: ["Reload Guild Wars", "Cancel"],
      defaultId: 0,
      cancelId: 1,
      noLink: true,
      message: "Reload Guild Wars?",
      detail:
        "This account restarts with fresh memory. Other accounts stay open.",
      checkboxLabel: AUTO_RELOG_LABEL,
      checkboxChecked: autoRelog ?? false,
    });
    if (result.response !== 0) return;
    if (
      autoRelog === null
      || !await saveAutoRelogPreference(host, autoRelog, result.checkboxChecked)
    ) {
      await showAutoRelogSettingsError(win);
      return;
    }
    await reloadGameOrShowError(host, win, "menu");
  });
}

async function showQuitOrReloadGameOnce(
  host: WindowHost,
  win: BrowserWindow,
): Promise<void> {
  const ownerId = windowRegistry.requireDiagnosticOwnerForWindow(win);
  const recordDialog = (
    phase: "requested" | "opened" | "settled",
    action: "pending" | "reload" | "quit" | "cancel" | "failed",
    autoRelog: boolean | null,
  ) => {
    try {
      logEvent({
        k: "quitReloadDialog.lifecycle",
        phase,
        action,
        autoRelog,
      }, ownerId);
    } catch {
      // Diagnostics are passive: a recorder failure cannot trap the sheet.
    }
  };
  recordDialog("requested", "pending", null);
  // Sending the reset is synchronous; only its acknowledgement is async.
  // A busy game renderer may take the full five-second command timeout to
  // answer, but a native Command-Q dialog must never wait on the renderer it
  // may be about to reload or quit.
  void resetGameInput(win);
  const autoRelogAfterReload = await readAutoRelogPreference(host);
  recordDialog("opened", "pending", autoRelogAfterReload);
  let result: Awaited<ReturnType<typeof dialog.showMessageBox>>;
  try {
    result = await dialog.showMessageBox(win, {
      type: "none",
      buttons: ["Reload Guild Wars", "Quit Game", "Cancel"],
      defaultId: 0,
      cancelId: 2,
      noLink: true,
      message: "Quit or reload Guild Wars?",
      detail:
        "Reload restarts this account with fresh memory. Other accounts stay open.",
      checkboxLabel: AUTO_RELOG_LABEL,
      checkboxChecked: autoRelogAfterReload ?? false,
    });
  } catch (error) {
    recordDialog("settled", "failed", autoRelogAfterReload);
    throw error;
  }
  const action = result.response === 0
    ? "reload"
    : result.response === 1
      ? "quit"
      : "cancel";
  recordDialog("settled", action, result.checkboxChecked);
  if (result.response === 0) {
    if (
      autoRelogAfterReload === null
      || !await saveAutoRelogPreference(
        host,
        autoRelogAfterReload,
        result.checkboxChecked,
      )
    ) {
      await showAutoRelogSettingsError(win);
      return;
    }
    await reloadGameOrShowError(host, win, "command-q");
  } else if (result.response === 1) {
    if (autoRelogAfterReload !== null) {
      await saveAutoRelogPreference(
        host,
        autoRelogAfterReload,
        result.checkboxChecked,
      );
    }
    host.requestQuit(win);
  } else if (autoRelogAfterReload !== null) {
    await saveAutoRelogPreference(
      host,
      autoRelogAfterReload,
      result.checkboxChecked,
    );
  }
}

export function installApplicationMenu(actions: ApplicationMenuActions, settings?: ToolMenuSettings): void {
  const { host, resetWindowState, revealLauncher } = actions;
  const isMac = process.platform === "darwin";
  const dev = isDevBuild();

  const template: MenuItemConstructorOptions[] = [
    ...(isMac
      ? [
          {
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
              {
                id: "quit-or-reload-game",
                label: "Quit or Reload Game…",
                accelerator: "CommandOrControl+Q",
                click: withGameOwner((win) => showQuitOrReloadGame(host, win)),
              },
            ],
          },
        ]
      : []),
    {
      label: "Edit",
      submenu: [
        editMenuItem("edit-cut", "Cut", "CmdOrCtrl+X", "cut"),
        editMenuItem("edit-copy", "Copy", "CmdOrCtrl+C", "copy"),
        editMenuItem("edit-paste", "Paste", "CmdOrCtrl+V", "paste"),
        editMenuItem(
          "edit-select-all",
          "Select All",
          "CmdOrCtrl+A",
          "selectAll",
        ),
      ],
    },
    {
      label: "View",
      submenu: [
        { role: "togglefullscreen" },
        {
          id: "reset-window-state",
          label: "Reset Window Size and Position",
          click: withGameOwner(async (win) => {
            const ownerId = windowRegistry.requireDiagnosticOwnerForWindow(win);
            await resetGameInput(win);
            void resetWindowState(win).catch(() => {
              logEvent(
                { k: "window.stateResetFailed" },
                ownerId,
              );
            });
          }),
        },
        { type: "separator" },
        {
          id: "toggle-tools",
          label: "Build Library",
          enabled: false,
          click: withGameOwner((win) => toggleTools(win)),
        },
        {
          id: "toggle-trade",
          label: "Trade Chat",
          enabled: false,
          click: withGameOwner((win) => toggleTrade(win)),
        },
        {
          id: "open-xunlai-storage",
          label: "Open Xunlai Storage",
          enabled: false,
          click: withGameOwner((win) => openStorage(win)),
        },
        {
          id: "open-travel",
          label: "Travel",
          enabled: false,
          click: withGameOwner((win) => toggleTravel(win)),
        },
        {
          label: "Toggle Diagnostics",
          click: withGameOwner(async (win) => {
            await resetGameInput(win);
            const cur = await host.getSettings();
            await host.updateSettings({ showDiagnostics: !cur.showDiagnostics });
            await sendRendererCommand(win, { type: "diagnostics.toggle" });
          }),
        },
        {
          id: "switch-character",
          label: "Switch Character",
          enabled: false,
          click: withGameOwner((win) => toggleCharacterSwitch(win)),
        },
        {
          id: "reload-game",
          label: "Reload Guild Wars…",
          accelerator: "CmdOrCtrl+Shift+R",
          click: withGameOwner((win) => showReloadGame(host, win)),
        },
        ...(dev
          ? [
              { type: "separator" as const },
              { role: "toggleDevTools" as const },
            ]
          : []),
      ],
    },
    { role: "windowMenu" },
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
          id: "report-bug",
          label: "Report a Bug…",
          click: withGameOwner(async (win) => {
            await resetGameInput(win);
            await shell.openExternal(EXTERNAL_URLS.bugReport);
          }),
        },
        {
          id: "report-visual-problem",
          label: "Capture Visual Corruption…",
          click: withGameOwner(async (win) => {
            await resetGameInput(win);
            await host.reportVisualProblem(win);
          }),
        },
        {
          id: "request-feature",
          label: "Request a Feature…",
          click: withGameOwner(async (win) => {
            await resetGameInput(win);
            await shell.openExternal(EXTERNAL_URLS.featureRequest);
          }),
        },
        // Diagnostics are optional support tools, never a gate before filing
        // an issue. ⌘⇧M stays global for an active performance capture.
        {
          label: "Diagnostics",
          submenu: [
            {
              id: "copy-reload-trace",
              label: "Copy Reload Trace",
              click: withGameOwner(async (win) => {
                clipboard.writeText(await reloadTranscriptForWindow(win));
              }),
            },
            { type: "separator" },
            {
              id: "export-diagnostics",
              label: "Export Recent Diagnostics…",
              click: withGameOwner(async (win) => {
                await resetGameInput(win);
                await exportDiagnosticsReport(win, () => host.exportDiagnostics(win));
              }),
            },
            { type: "separator" },
            {
              id: "start-performance-capture",
              label: "Start Performance Capture",
              click: withGameOwner(async (win) => {
                await resetGameInput(win);
                void host.startCapture(win, 1).catch((error) => {
                  void dialog.showMessageBox(win, {
                    type: "error",
                    buttons: ["OK"],
                    message: "Capture could not start",
                    detail: error instanceof Error ? error.message : String(error),
                  }).catch(() => undefined);
                });
              }),
            },
            {
              id: "mark-performance-problem",
              label: "Mark Performance Problem",
              accelerator: "CmdOrCtrl+Shift+M",
              click: withGameOwner(async (win) => {
                await resetGameInput(win);
                host.markPerformanceProblem(win);
              }),
            },
            {
              id: "start-chromium-trace",
              label: "Start Chromium Trace",
              click: withGameOwner(async (win) => {
                await resetGameInput(win);
                void host.startCapture(win, 2).catch((error) => {
                  void dialog.showMessageBox(win, {
                    type: "error",
                    buttons: ["OK"],
                    message: "Trace could not start",
                    detail: error instanceof Error ? error.message : String(error),
                  }).catch(() => undefined);
                });
              }),
            },
            // The trace answers a different question from a capture — what the
            // input host decided, not what the frame cost — so it is its own
            // switch rather than a level of the capture it would otherwise
            // have to be armed alongside.
            {
              id: "toggle-input-trace",
              label: "Show Input Trace",
              click: withGameOwner(async (win) => {
                const enabled = !inputTraceEnabled(win);
                await setInputTraceVisibility(win, enabled, sendRendererCommand);
              }),
            },
            {
              id: "stop-capture",
              label: "Stop Capture",
              click: withGameOwner(async (win) => {
                await resetGameInput(win);
                void host.stopCapture(win).catch(() => undefined);
              }),
            },
          ],
        },
      ],
    },
  ];

  if (settings) {
    const shortcuts = resolveShortcuts(settings.shortcutOverrides);
    const view = template.find(section => section.label === "View");
    if (Array.isArray(view?.submenu)) for (const item of view.submenu) {
      const selection = TOOL_MENU_FEATURES[item.id ?? ""];
      if (!selection) continue;
      item.enabled = featureActivationRequested(selection.feature, settings);
      const accelerator = shortcutAccelerator(shortcuts[selection.action]);
      if (accelerator) item.accelerator = accelerator;
    }
  }
  rebuildGameMenu = next => installApplicationMenu(actions, next);
  installNativeApplicationMenu(template, revealLauncher);
  if (!settings) {
    const installedMenu = Menu.getApplicationMenu();
    void host.getSettings().then(next => {
      // A different window may have installed its own menu in the meantime.
      if (Menu.getApplicationMenu() === installedMenu) updateToolsMenuItems(next);
    }).catch(error => console.error("Game menu settings could not load", error));
  }
}
