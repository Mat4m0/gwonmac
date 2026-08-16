import { expect, test } from "@playwright/test";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { closeOffline, launchOffline } from "./fixtures.mjs";
import { packageVersion } from "./settings-test-fixture.mjs";

test.describe("tools and update settings", () => {
  test("Command-Shift-C opens storage or its settings, never hero builds", async () => {
    const fixture = await launchOffline("gw-storage-shortcut-e2e-");
    try {
      const { app, page } = fixture;
      await page.evaluate(() => {
        document.body.dataset.toolsActions = "0";
        window.addEventListener("gw:tools-toggle", (event) => {
          event.preventDefault();
          document.body.dataset.toolsActions = String(
            Number(document.body.dataset.toolsActions ?? "0") + 1,
          );
        });
      });
      await app.evaluate(({ BrowserWindow }) => {
        const contents = BrowserWindow.getAllWindows()[0]?.webContents;
        contents?.sendInputEvent({
          type: "keyDown",
          keyCode: "C",
          modifiers: ["meta", "shift"],
        });
        contents?.sendInputEvent({
          type: "keyUp",
          keyCode: "C",
          modifiers: ["meta", "shift"],
        });
      });

      await expect(page.locator("#settings-dialog")).toHaveAttribute("open", "");
      await expect(page.locator(".settings-panes")).toHaveAttribute(
        "data-active",
        "controls",
      );
      await expect(page.locator("body")).toHaveAttribute("data-tools-actions", "0");
    } finally {
      await closeOffline(fixture);
    }
  });

  test("records, replaces, clears, and restores app shortcuts without firing them", async () => {
      const fixture = await launchOffline("gw-settings-shortcuts-e2e-");
    try {
      const { app, page } = fixture;
      const sendInput = (
        keyCode: string,
        modifiers: Array<"meta" | "control" | "shift" | "alt"> = [],
      ) => app.evaluate(({ BrowserWindow }, input) => {
        const contents = BrowserWindow.getAllWindows()[0]?.webContents;
        contents?.sendInputEvent({
          type: "keyDown",
          keyCode: input.keyCode,
          modifiers: input.modifiers,
        });
        contents?.sendInputEvent({
          type: "keyUp",
          keyCode: input.keyCode,
          modifiers: input.modifiers,
        });
      }, { keyCode, modifiers });
      await app.evaluate(({ Menu }) => {
        Menu.getApplicationMenu()
          ?.items[0]?.submenu?.items.find((item) => item.label === "Settings…")
          ?.click();
      });
      await page.locator("#settings-tab-controls").click();

      const toolsRow = page.locator('[data-shortcut-action="tools.toggle"]');
      const storageRow = page.locator('[data-shortcut-action="storage.open"]');
      await expect(toolsRow.locator("kbd")).toHaveText("⌘B");
      await expect(storageRow.locator("kbd")).toHaveText("⌘⇧C");

      await page.evaluate(() => {
        document.body.dataset.shortcutActions = "0";
        document.body.dataset.shortcutLeaks = "0";
        window.addEventListener("gw:tools-toggle", (event) => {
          event.preventDefault();
          document.body.dataset.shortcutActions = String(
            Number(document.body.dataset.shortcutActions ?? "0") + 1,
          );
        });
        window.addEventListener("keydown", (event) => {
          if (event.code === "KeyK") {
            document.body.dataset.shortcutLeaks = String(
              Number(document.body.dataset.shortcutLeaks ?? "0") + 1,
            );
          }
        }, true);
      });

      await toolsRow.locator(".settings-shortcut-change").click();
      await expect(toolsRow.locator("kbd")).toHaveText("Listening…");
      await expect(toolsRow.locator(".settings-shortcut-message"))
        .toContainText("Delete clears · Escape cancels");
      await sendInput("B", ["meta"]);
      await expect.poll(() => page.evaluate(() => window.gwNative.settings.get()))
        .toMatchObject({
          shortcutOverrides: {},
        });
      await expect(page.locator("body")).toHaveAttribute("data-shortcut-actions", "0");

      await toolsRow.locator(".settings-shortcut-change").click();
      await expect(toolsRow.locator("kbd")).toHaveText("Listening…");
      await sendInput("K", ["meta", "shift"]);
      await expect.poll(async () => ({
        key: await toolsRow.locator("kbd").textContent(),
        message: await toolsRow.locator(".settings-shortcut-message").textContent(),
        change: await toolsRow.locator(".settings-shortcut-change").textContent(),
      })).toEqual({ key: "⌘⇧K", message: "", change: "Change" });
      await expect.poll(() => page.evaluate(() => window.gwNative.settings.get()))
        .toMatchObject({
          shortcutOverrides: {
            "tools.toggle": { key: "k", shift: true, option: false },
          },
        });
      await expect(page.locator("body")).toHaveAttribute("data-shortcut-actions", "0");
      await expect(page.locator("body")).toHaveAttribute("data-shortcut-leaks", "0");
      expect(await app.evaluate(({ Menu }) => Menu.getApplicationMenu()
        ?.getMenuItemById("toggle-tools")?.accelerator)).toBe("Command+Shift+K");

      await storageRow.locator(".settings-shortcut-change").click();
      await sendInput("K", ["meta", "shift"]);
      await expect(storageRow.locator(".settings-shortcut-message"))
        .toContainText("used by Toggle Tools");
      await storageRow.locator(".settings-shortcut-replace").click();
      await expect.poll(() => page.evaluate(() => window.gwNative.settings.get()))
        .toMatchObject({
          shortcutOverrides: {
            "tools.toggle": null,
            "storage.open": { key: "k", shift: true, option: false },
          },
        });
      await expect(toolsRow.locator("kbd")).toHaveText("Not set");

      await storageRow.locator(".settings-shortcut-change").click();
      await sendInput("Backspace");
      await expect(storageRow.locator("kbd")).toHaveText("Not set");

      await page.locator("#settings-shortcuts-restore").click();
      await expect.poll(() => page.evaluate(() => window.gwNative.settings.get()))
        .toMatchObject({ shortcutOverrides: {} });
      await expect(toolsRow.locator("kbd")).toHaveText("⌘B");
      await expect(storageRow.locator("kbd")).toHaveText("⌘⇧C");
      await page.locator("#settings-done").click();
      await sendInput("B", ["control"]);
      await expect(page.locator("body")).toHaveAttribute("data-shortcut-actions", "0");
      await sendInput("B", ["meta"]);
      await expect(page.locator("body")).toHaveAttribute("data-shortcut-actions", "1");
    } finally {
      await closeOffline(fixture);
    }
  });

  test("the application menu opens Settings and the dedicated Updates pane", async () => {
    const fixture = await launchOffline("gw-settings-menu-e2e-");
    try {
      const { app, page } = fixture;
      await expect(page.locator("#settings-dialog")).not.toHaveAttribute(
        "open",
        "",
      );
      expect(
        await app.evaluate(({ Menu }) => {
          const item = Menu.getApplicationMenu()
            ?.items[0]?.submenu?.items.find(
              (candidate) => candidate.label === "Settings…",
            );
          item?.click();
          return item?.accelerator;
        }),
      ).toBe("CmdOrCtrl+,");
      await expect(page.locator("#settings-dialog")).toHaveAttribute("open", "");
      await expect(page.locator("#settings-form")).toHaveAttribute(
        "aria-busy",
        "false",
      );
      await expect(page.locator("#settings-feedback")).toHaveText(
        "Changes save automatically.",
      );
      await expect.poll(() => page.evaluate(() => document.activeElement?.id))
        .toBe("settings-tab-data");
      await page.keyboard.press("Escape");
      await expect(page.locator("#settings-dialog")).not.toHaveAttribute("open", "");
      await app.evaluate(({ Menu }) => {
        Menu.getApplicationMenu()
          ?.items[0]?.submenu?.items.find(
            (candidate) => candidate.label === "Settings…",
          )
          ?.click();
      });
      await expect(page.locator("#settings-dialog")).toHaveAttribute("open", "");
      await page.locator("#settings-done").click();
      await app.evaluate(({ Menu }) => {
        Menu.getApplicationMenu()
          ?.items[0]?.submenu?.items.find(
            (candidate) => candidate.label === "Check for Updates…",
          )
          ?.click();
      });
      await expect(page.locator("#settings-dialog")).toHaveAttribute("open", "");
      await expect(page.locator(".settings-panes")).toHaveAttribute(
        "data-active",
        "updates",
      );
      await expect(page.locator("#settings-pane-updates")).toContainText(
        "Automatically check for and download app updates",
      );
      await expect(page.locator("#settings-update-version")).toHaveText(
        packageVersion,
      );
      // Installed release stage and selected update track are separate facts.
      await expect(page.locator("#settings-update-stage")).toHaveText(
        packageVersion.includes("-beta.")
          ? "Beta"
          : packageVersion.includes("-rc.")
            ? "Release Candidate"
            : packageVersion.includes("-alpha.")
              ? "Alpha"
              : "Stable",
      );
      await expect(page.locator('select[name="updateTrack"]')).toHaveValue("stable");
      await page.locator('select[name="updateTrack"]').selectOption("beta");
      await expect
        .poll(() => page.evaluate(() => window.gwNative.settings.get()))
        .toMatchObject({ updateTrack: "beta" });
      await expect(page.locator("#settings-update-status")).toContainText(
        "must be updated manually",
      );
      await expect(page.locator("#settings-restart-update")).toBeHidden();
    } finally {
      await closeOffline(fixture);
    }
  });

  test("an older Stable return is presented only as the fixed Releases action", async () => {
    const fixture = await launchOffline("gw-update-manual-return-e2e-");
    try {
      const result = await fixture.page.evaluate(async () => {
        const root = document.implementation.createHTMLDocument("update proof");
        root.body.innerHTML = `
          <a id="loading-update-check"></a>
          <span id="loading-update-status"></span>
          <span id="loading-update-when"></span>
          <a id="loading-update-get"></a>
          <button id="settings-check-updates"></button>
          <button id="settings-open-releases"></button>
          <button id="settings-restart-update"></button>
          <span id="settings-update-status"></span>
          <span id="settings-update-when"></span>
          <span id="settings-update-version"></span>
          <span id="settings-update-stage"></span>
          <button id="client-compat-check"></button>
          <button id="client-compat-restart"></button>
          <button id="client-compat-releases"></button>
          <span id="client-compat-update"></span>
        `;
        const importRenderer = async <T>(specifier: string): Promise<T> =>
          import(specifier);
        const module = await importRenderer<
          typeof import("../../src/renderer/update-action.js")
        >("./update-action.js");
        const action = module.createUpdateAction({
          getState: async () => ({
            phase: "manual-stable-return" as const,
            currentVersion: "2026.8.0-beta.1",
            checkedAt: "2026-08-10T00:00:00.000Z",
            stableVersion: "2026.7.0",
          }),
          check: async () => undefined,
          restartAndInstall: async () => undefined,
          onState: () => () => undefined,
        });
        let releases = 0;
        module.bindUpdateActionDom(root, action, async () => {
          releases += 1;
        });
        await action.initialize();
        root.getElementById("settings-open-releases")?.click();
        return {
          message: root.getElementById("settings-update-status")?.textContent,
          label: root.getElementById("settings-open-releases")?.textContent,
          restartHidden: (root.getElementById("settings-restart-update") as HTMLElement).hidden,
          releases,
        };
      });

      expect(result).toEqual({
        message:
          "Stable version 2026.7.0 is available. Returning to Stable requires a manual install.",
        label: "Open Releases to Return to Stable…",
        restartHidden: true,
        releases: 1,
      });
    } finally {
      await closeOffline(fixture);
    }
  });

  test("a ready update flushes IDBFS before installing", async () => {
    const fixture = await launchOffline(
      "gw-update-restart-e2e-",
      { GW_TEST_DISTRIBUTION_CHANNEL: "release" },
      async (userData) => {
        // Update-capable build: the default launch check would reach the real
        // GitHub before the stub below installs, so this profile opts out and
        // the test drives every check itself.
        await writeFile(
          path.join(userData, "settings.json"),
          JSON.stringify({ autoCheckUpdates: false }),
          { mode: 0o600 },
        );
      },
    );
    try {
      const { app, page } = fixture;
      await app.evaluate(({ autoUpdater }) => {
        globalThis.__updateInstallCalls = 0;
        const version = "9999.1.0";
        const tag = `v${version}`;
        const zip = `Guild-Wars-Reforged-${version}-macOS-arm64.zip`;
        const base =
          `https://github.com/Mat4m0/gwonmac/releases/download/${tag}`;
        globalThis.fetch = async (input) => {
          const url = String(input);
          return new Response(JSON.stringify(
            url === "https://api.github.com/repos/Mat4m0/gwonmac/releases?per_page=100"
              ? [{
                  tag_name: tag,
                  draft: false,
                  // A stable offer is eligible on both tracks and lets a beta
                  // or RC advance to its final release. The Preview tester
                  // identity cannot reach AppUpdater at all.
                  prerelease: false,
                  assets: [
                    {
                      name: "RELEASES.json",
                      browser_download_url: `${base}/RELEASES.json`,
                    },
                    {
                      name: zip,
                      browser_download_url: `${base}/${zip}`,
                    },
                  ],
                }]
              : {
                  url: `${base}/${zip}`,
                  name: `Guild Wars Reforged v${version}`,
                  version,
                  tag,
                  pub_date: "2026-07-30T00:00:00.000Z",
                  notes: "",
                },
          ), { status: 200 });
        };
        autoUpdater.setFeedURL = () => undefined;
        autoUpdater.checkForUpdates = () => {
          queueMicrotask(() => autoUpdater.emit("update-downloaded"));
        };
        autoUpdater.quitAndInstall = () => {
          globalThis.__updateInstallCalls += 1;
        };
      });
      await page.evaluate(() => {
        window.Module ??= {};
        window.Module.FS = {
          syncfs: (_populate, callback) => {
            document.documentElement.dataset.updateFsSynced = "yes";
            callback();
          },
        };
        globalThis.dispatchEvent(new globalThis.CustomEvent("gw:settings", {
          detail: { pane: "updates" },
        }));
      });
      await expect(page.locator("#settings-update-version")).toHaveText(
        packageVersion,
      );
      await page.locator("#settings-check-updates").click();
      await expect(page.locator("#settings-restart-update")).toBeVisible();
      await page.locator("#settings-restart-update").click();
      await expect
        .poll(() => page.locator("html").getAttribute("data-update-fs-synced"))
        .toBe("yes");
      await expect
        .poll(() => app.evaluate(() => globalThis.__updateInstallCalls))
        .toBe(1);
    } finally {
      await closeOffline(fixture);
    }
  });

  test("the first Tools enable can be declined and a saved enable survives relaunch refusal", async () => {
    const fixture = await launchOffline("gw-tools-enable-restart-e2e-");
    try {
      const { app, page } = fixture;
      await page.evaluate(() =>
        globalThis.dispatchEvent(new globalThis.Event("gw:settings")),
      );
      await page.locator("#settings-tab-controls").click();
      const controls = page.locator("#settings-pane-controls");
      await expect(page.locator("#settings-tool-features")).toBeHidden();
      await expect(page.locator("#settings-tools-off")).toBeVisible();
      await expect(page.locator("#settings-availability")).not.toHaveAttribute(
        "open",
        "",
      );
      await expect(controls).toContainText(
        "Guild Wars cursor",
      );
      await expect(controls).toContainText(
        "Your saved Builds and Teams stay available at login and in PvP",
      );
      await expect(controls).toContainText("Apply teams in Guild Wars");
      await expect(page.locator('input[name="nativeCursor"]')).toHaveCount(0);
      await expect(page.locator('input[name="teamManagement"]')).toBeDisabled();
      await expect(page.locator('input[name="xunlaiStorage"]')).toBeDisabled();
      await expect(page.locator('input[name="targetReadout"]')).toBeDisabled();
      expect(
        await page.evaluate(
          () => window.gwNative.init.enhancementSelection.nativeCursor,
        ),
      ).toBe(true);
      await app.evaluate(({ dialog }) => {
        dialog.showMessageBox = async () => ({
          response: 1,
          checkboxChecked: false,
        });
      });
      await page.locator('input[name="gwonmacTools"]').click();
      await expect(page.locator("#settings-feedback")).toHaveText(
        "Optional Tools were not changed. Your current setup is still active.",
      );
      await expect(page.locator("#settings-feedback")).toHaveAttribute(
        "data-tone",
        "warning",
      );
      await expect(page.locator('input[name="gwonmacTools"]')).not.toBeChecked();
      expect(await page.evaluate(() => window.gwNative.settings.get()))
        .toMatchObject({ gwonmacTools: false });

      await app.evaluate(({ app: electronApp, dialog }) => {
        globalThis.__resetRestart = {
          quit: false,
          relaunch: false,
          options: null,
          messages: [],
          originalQuit: electronApp.quit,
          originalRelaunch: electronApp.relaunch,
        };
        const record = async (
          _win: Electron.BaseWindow,
          options: Electron.MessageBoxOptions,
        ): Promise<Electron.MessageBoxReturnValue> => {
          globalThis.__resetRestart.options = options;
          globalThis.__resetRestart.messages?.push(options);
          return { response: 0, checkboxChecked: false };
        };
        dialog.showMessageBox = record as typeof dialog.showMessageBox;
        electronApp.relaunch = () => {
          globalThis.__resetRestart.relaunch = true;
          throw new Error("injected relaunch refusal");
        };
        electronApp.quit = () => {
          globalThis.__resetRestart.quit = true;
        };
      });

      await page.locator('input[name="gwonmacTools"]').click();
      await expect.poll(() => page.evaluate(async () =>
        (await window.gwNative.settings.get()).gwonmacTools)).toBe(true);
      await expect.poll(() => app.evaluate(() =>
        globalThis.__resetRestart.messages?.length ?? 0)).toBe(2);
      expect(await app.evaluate(() => {
        const { quit, relaunch, messages } = globalThis.__resetRestart;
        const [confirmation, warning] = messages ?? [];
        if (!confirmation || !warning) throw new Error("both restart dialogs were not shown");
        return {
          quit,
          relaunch,
          confirmation: {
            buttons: confirmation.buttons,
            detail: confirmation.detail,
            message: confirmation.message,
          },
          warning: {
            buttons: warning.buttons,
            detail: warning.detail,
            message: warning.message,
          },
        };
      })).toEqual({
        quit: false,
        relaunch: true,
        confirmation: {
          buttons: ["Enable and Restart", "Cancel"],
          detail:
            "GWonMac prepares every certified Tools capability together. Restart once to use the saved change. This closes Guild Wars if it is running.",
          message: "Restart to enable optional Tools?",
        },
        warning: {
          buttons: ["OK"],
          detail: "Your change is saved. Quit and reopen GWonMac to apply it.",
          message: "Restart did not start",
        },
      });
      await app.evaluate(({ app: electronApp }) => {
        electronApp.quit = globalThis.__resetRestart.originalQuit;
        electronApp.relaunch = globalThis.__resetRestart.originalRelaunch;
      });
    } finally {
      await closeOffline(fixture);
    }
  });

  test("child Tools toggles stay immediate after the one preparation restart", async () => {
    const fixture = await launchOffline(
      "gw-tools-capability-restart-e2e-",
      {},
      async (userData) => {
        await writeFile(
          path.join(userData, "settings.json"),
          JSON.stringify({
            gwonmacTools: true,
            targetReadout: false,
            teamManagement: false,
            xunlaiStorage: false,
            travelPalette: false,
          }),
          { mode: 0o600 },
        );
      },
    );
    try {
      const { app, page } = fixture;
      await app.evaluate(({ dialog }) => {
        globalThis.__capabilityRestartMessages = [];
        dialog.showMessageBox = (async (
          _win: Electron.BaseWindow,
          options: Electron.MessageBoxOptions,
        ) => {
          globalThis.__capabilityRestartMessages?.push(options.message);
          return { response: 1, checkboxChecked: false };
        }) as typeof dialog.showMessageBox;
      });

      await page.evaluate(async () => {
        await window.gwNative.settings.set({ targetReadout: true });
        await window.gwNative.settings.set({ teamManagement: true });
        await window.gwNative.settings.set({ xunlaiStorage: true });
        await window.gwNative.settings.set({ travelPalette: true });
        await window.gwNative.settings.set({ gwonmacTools: false });
        await window.gwNative.settings.set({ gwonmacTools: true });
      });
      expect(await app.evaluate(() => globalThis.__capabilityRestartMessages))
        .toEqual([]);
      await expect.poll(() => page.evaluate(() => window.gwNative.settings.get()))
        .toMatchObject({
          targetReadout: true,
          teamManagement: true,
          xunlaiStorage: true,
          travelPalette: true,
          gwonmacTools: true,
        });
    } finally {
      await closeOffline(fixture);
    }
  });

});
