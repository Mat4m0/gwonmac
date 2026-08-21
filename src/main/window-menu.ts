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
  dialog,
  Menu,
  shell,
  type BrowserWindow,
  type MenuItemConstructorOptions,
} from "electron";
import { EXTERNAL_URLS } from "../shared/contracts.js";
import { logEvent } from "./diagnostics.js";
import { exportDiagnosticsReport } from "./diagnostics-export.js";
import {
  openStorage,
  resetGameInput,
  sendRendererCommand,
  toggleTravel,
  toggleTools,
} from "./renderer-commands.js";
import { isDevBuild } from "./protocol.js";
import {
  inputTraceEnabled,
  setInputTraceVisibility,
} from './input-trace.js';
import type { WindowHost } from "./window.js";
import {
  resolveShortcuts,
  shortcutAccelerator,
} from "../shared/keyboard-shortcuts.js";
import { windowRegistry } from "./window-registry.js";

const USER_GUIDE_URL = `${EXTERNAL_URLS.github}/blob/main/docs/user-guide.md`;

export interface ApplicationMenuActions {
  host: WindowHost;
  shortcuts?: ReturnType<typeof resolveShortcuts>;
  /** Window state stays window.ts's; the menu only asks for the reset. */
  resetWindowState: (win: BrowserWindow) => Promise<void>;
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

export function installApplicationMenu({
  host,
  shortcuts = resolveShortcuts({}),
  resetWindowState,
}: ApplicationMenuActions): void {
  const isMac = process.platform === "darwin";
  const dev = isDevBuild();
  const toolsAccelerator = shortcutAccelerator(shortcuts["tools.toggle"]);
  const storageAccelerator = shortcutAccelerator(shortcuts["storage.open"]);
  const travelAccelerator = shortcutAccelerator(shortcuts["travel.open"]);

  const template: MenuItemConstructorOptions[] = [
    ...(isMac
      ? [
          {
            label: app.name,
            submenu: [
              { role: "about" as const },
              { type: "separator" as const },
              {
                label: "Check for Updates…",
                click: withGameOwner(async (win) => {
                  await resetGameInput(win);
                  await sendRendererCommand(win, {
                    type: "settings.open",
                    pane: "updates",
                    checkForUpdates: true,
                  });
                }),
              },
              {
                label: "Settings…",
                accelerator: "CmdOrCtrl+,",
                click: withGameOwner(async (win) => {
                  await resetGameInput(win);
                  await sendRendererCommand(win, { type: "settings.open" });
                }),
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
        // AppKit consumes these role accelerators before Electron emits
        // `before-input-event`. Keep the clickable menu commands, but let the
        // renderer's active game-text owner receive physical Command chords.
        { role: "cut", registerAccelerator: false },
        { role: "copy", registerAccelerator: false },
        { role: "paste", registerAccelerator: false },
        { role: "selectAll", registerAccelerator: false },
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
            await resetGameInput(win);
            void resetWindowState(win).catch(() => {
              logEvent({ k: "window.stateResetFailed" });
            });
          }),
        },
        { type: "separator" },
        {
          id: "toggle-tools",
          label: "Toggle Tools",
          // Displayed, not bound. Electron dispatches a key to the page before
          // it considers menu shortcuts, and Guild Wars claims most single
          // letters whatever modifier is held -- it handles `b` and its
          // preventDefault cancels the accelerator with it. The key is owned by
          // `before-input-event` in window.ts instead, which runs before the
          // page; `registerAccelerator: false` keeps the shortcut visible here
          // without binding it a second time and firing twice.
          ...(toolsAccelerator ? { accelerator: toolsAccelerator } : {}),
          registerAccelerator: false,
          click: withGameOwner((win) => toggleTools(win)),
        },
        {
          id: "open-xunlai-storage",
          label: "Open Xunlai Storage",
          ...(storageAccelerator ? { accelerator: storageAccelerator } : {}),
          registerAccelerator: false,
          click: withGameOwner((win) => openStorage(win)),
        },
        {
          id: "open-travel",
          label: "Open Travel",
          ...(travelAccelerator ? { accelerator: travelAccelerator } : {}),
          registerAccelerator: false,
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
          id: "reload-game",
          label: "Reload Game",
          accelerator: "CmdOrCtrl+R",
          click: withGameOwner(async (win) => {
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
          }),
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
          id: "report-bug",
          label: "Report a Bug…",
          click: withGameOwner(async (win) => {
            await resetGameInput(win);
            await shell.openExternal(EXTERNAL_URLS.bugReport);
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

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}
