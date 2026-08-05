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
import { reportProblem } from "./problem-report.js";
import { resetGameInput, sendRendererCommand } from "./renderer-commands.js";
import { isDevBuild } from "./protocol.js";
import type { WindowHost } from "./window.js";

/** Launch with `--gw-debug-panel` to reveal the memory panel on any build. */
export const DEBUG_PANEL_SWITCH = "gw-debug-panel";

const USER_GUIDE_URL = `${EXTERNAL_URLS.github}/blob/main/docs/user-guide.md`;

export interface ApplicationMenuActions {
  host: WindowHost;
  win: BrowserWindow;
  /** Window state stays window.ts's; the menu only asks for the reset. */
  resetWindowState: () => Promise<void>;
}

export function installApplicationMenu({
  host,
  win,
  resetWindowState,
}: ApplicationMenuActions): void {
  const isMac = process.platform === "darwin";
  const dev = isDevBuild();
  // The memory panel's own gate, deliberately not `dev` alone. The sessions
  // worth measuring are hours long on a real account, and a dev build refuses
  // persistent secrets — so the build that needs these controls is the
  // packaged one, launched with the switch. Nothing about it persists, and a
  // player cannot reach it by clicking.
  const debugPanel = dev || app.commandLine.hasSwitch(DEBUG_PANEL_SWITCH);

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
                click: async () => {
                  await resetGameInput(win);
                  await sendRendererCommand(win, {
                    type: "settings.open",
                    pane: "updates",
                    checkForUpdates: true,
                  });
                },
              },
              {
                label: "Settings…",
                accelerator: "CmdOrCtrl+,",
                click: async () => {
                  await resetGameInput(win);
                  await sendRendererCommand(win, { type: "settings.open" });
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
          click: async () => {
            await resetGameInput(win);
            void resetWindowState().catch(() => {
              logEvent({ k: "window.stateResetFailed" });
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
            await sendRendererCommand(win, { type: "diagnostics.toggle" });
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
          click: () => void reportProblem(win, host),
        },
        // Capture tooling supports Report a Problem, so it lives beside it
        // rather than in View next to everyday commands. Ids are the test
        // contract and survive the move; ⌘⇧M stays global.
        {
          label: "Diagnostics",
          submenu: [
            {
              id: "start-performance-capture",
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
              id: "start-chromium-trace",
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
            // The trace answers a different question from a capture — what the
            // input host decided, not what the frame cost — so it is its own
            // switch rather than a level of the capture it would otherwise
            // have to be armed alongside.
            {
              id: "toggle-input-trace",
              label: "Show Input Trace",
              click: () => {
                void sendRendererCommand(win, { type: "input.trace" });
              },
            },
            // The memory panel and the one trigger main owns. Crashing the
            // renderer is here rather than in the panel because it is the one
            // path with no renderer involvement at all, which is exactly what
            // makes it the most faithful imitation of a real crash.
            ...(debugPanel
              ? ([
                  { type: "separator" },
                  {
                    id: "toggle-dev-panel",
                    label: "Show Memory Debug Panel",
                    accelerator: "CmdOrCtrl+Shift+D",
                    click: () => {
                      void sendRendererCommand(win, { type: "dev.panel" });
                    },
                  },
                  {
                    id: "crash-renderer-process",
                    label: "Crash Renderer Process (test reconnect)",
                    click: () => {
                      win.webContents.forcefullyCrashRenderer();
                    },
                  },
                ] as MenuItemConstructorOptions[])
              : []),
            {
              id: "stop-capture",
              label: "Stop Capture",
              click: async () => {
                await resetGameInput(win);
                void host.stopCapture();
              },
            },
          ],
        },
      ],
    },
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}
