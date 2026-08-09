import { expect, test } from "@playwright/test";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { closeOffline, launchOffline } from "./fixtures.mjs";
import { packageVersion } from "./settings-test-fixture.mjs";

test.describe("tools and update settings", () => {
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
      // The label follows the running version's shape, so this test holds on
      // both sides of a stable release.
      await expect(page.locator("#settings-update-channel")).toHaveText(
        /^\d+\.\d+\.\d+$/u.test(packageVersion) ? "Stable" : "Preview",
      );
      await expect(page.locator("#settings-update-status")).toContainText(
        "can't update itself",
      );
      await expect(page.locator("#settings-restart-update")).toBeHidden();
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
            url.includes("api.github.com")
              ? [{
                  tag_name: tag,
                  draft: false,
                  // A stable offer is the one shape every install accepts: a
                  // preview may advance to stable, while a stable install is
                  // never offered a preview — so a preview fixture would be
                  // refused the day the app version loses its suffix.
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

  test("the first Tools enable can be declined, then saves and restarts atomically", async () => {
    const fixture = await launchOffline("gw-tools-enable-restart-e2e-");
    try {
      const { app, page } = fixture;
      await page.evaluate(() =>
        globalThis.dispatchEvent(new globalThis.Event("gw:settings")),
      );
      await page.locator("#settings-tab-controls").click();
      const controls = page.locator("#settings-pane-controls");
      await expect(controls).toContainText(
        "Core is on for supported Guild Wars builds",
      );
      await expect(controls).toContainText("native cursor");
      await expect(controls).toContainText("Optional tools stay off in PvP");
      await expect(page.locator('input[name="nativeCursor"]')).toHaveCount(0);
      await expect(page.locator('input[name="teamManagement"]')).toBeDisabled();
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
          originalQuit: electronApp.quit,
          originalRelaunch: electronApp.relaunch,
        };
        const record = async (
          _win: Electron.BaseWindow,
          options: Electron.MessageBoxOptions,
        ): Promise<Electron.MessageBoxReturnValue> => {
          globalThis.__resetRestart.options = options;
          return { response: 0, checkboxChecked: false };
        };
        dialog.showMessageBox = record as typeof dialog.showMessageBox;
        electronApp.relaunch = () => {
          globalThis.__resetRestart.relaunch = true;
        };
        electronApp.quit = () => {
          globalThis.__resetRestart.quit = true;
        };
      });

      await page.locator('input[name="gwonmacTools"]').click();
      await expect.poll(() => page.evaluate(async () =>
        (await window.gwNative.settings.get()).gwonmacTools)).toBe(true);
      expect(await app.evaluate(() => {
        const { quit, relaunch, options } = globalThis.__resetRestart;
        if (!options) throw new Error("no message box was shown");
        return { quit, relaunch, buttons: options.buttons };
      })).toEqual({
        quit: true,
        relaunch: true,
        buttons: ["Enable and Restart", "Cancel"],
      });
      await app.evaluate(({ app: electronApp }) => {
        electronApp.quit = globalThis.__resetRestart.originalQuit;
        electronApp.relaunch = globalThis.__resetRestart.originalRelaunch;
      });
    } finally {
      await closeOffline(fixture);
    }
  });

});
