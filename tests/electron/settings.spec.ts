import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { closeOffline, launchOffline } from "./fixtures.mjs";

const packageVersion = (
  JSON.parse(readFileSync(path.resolve("package.json"), "utf8")) as {
    version: string;
  }
).version;

declare global {
  // The main-process probe that records what the reset dialog was asked and
  // whether the app quit and relaunched. It exists only while this spec runs.
  var __resetRestart: {
    quit: boolean;
    relaunch: boolean;
    options: Electron.MessageBoxOptions | null;
    originalQuit: Electron.App["quit"];
    originalRelaunch: Electron.App["relaunch"];
  };
  var __updateInstallCalls: number;
}

test.describe("settings experience", () => {
  // P5.1: the menu item used to run a string of JavaScript in the renderer.
  // It now sends a typed command, and this is the only caller of `settings.open`
  // — every other spec dispatches the renderer event directly, which would keep
  // passing if the main-process half were removed entirely.
  test("the Settings menu item opens the dialog through the command channel", async () => {
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
    } finally {
      await closeOffline(fixture);
    }
  });

  test("the update menu opens the dedicated pane and starts one check", async () => {
    const fixture = await launchOffline("gw-updates-menu-e2e-");
    try {
      const { app, page } = fixture;
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
      await expect(page.locator("#settings-update-channel")).toHaveText("Preview");
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
                  prerelease: true,
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

  test("explains render cost and will not change the cursor without a restart", async () => {
    const fixture = await launchOffline("gw-settings-e2e-");
    try {
      const { page } = fixture;
      await page.evaluate(() =>
        globalThis.dispatchEvent(new globalThis.Event("gw:settings")),
      );
      await expect(page.locator("#settings-dialog")).toHaveAttribute("open", "");
      await page.locator("#settings-tab-advanced").click();
      await expect(page.locator('[name="touchMode"]')).toHaveCount(0);
      await expect(page.locator("#settings-pane-advanced")).not.toContainText(
        "Mobile touch compatibility",
      );
      await page.locator("#settings-tab-display").click();
      await expect(
        page.locator('input[name="renderScale"][value="2"]'),
      ).toBeChecked();

      const dimensions = await page.evaluate(() => {
        const canvas = globalThis.document.getElementById("canvas");
        if (!canvas) throw new Error("the game canvas is missing");
        const label = (scale: string) => {
          const element = globalThis.document.querySelector(
            `[data-render-scale="${scale}"]`,
          );
          if (!element) throw new Error(`no label for render scale ${scale}`);
          return element.textContent;
        };
        return {
          width: canvas.clientWidth,
          height: canvas.clientHeight,
          one: label("1"),
          oneAndHalf: label("1.5"),
          two: label("2"),
        };
      });
      expect(dimensions.one).toBe(
        `≈ ${dimensions.width} × ${dimensions.height}`,
      );
      expect(dimensions.oneAndHalf).toBe(
        `≈ ${Math.round(dimensions.width * 1.5)} × ` +
          `${Math.round(dimensions.height * 1.5)}`,
      );
      expect(dimensions.two).toBe(
        `≈ ${dimensions.width * 2} × ${dimensions.height * 2}`,
      );
      await expect(page.locator("#settings-pane-display")).toContainText(
        "2× renders four times the pixels",
      );

      await page.locator('input[name="renderScale"][value="1.5"]').check();
      await fixture.app.evaluate(({ Menu }) => {
        const view = Menu.getApplicationMenu()?.items.find(
          (item) => item.label === "View",
        );
        view?.submenu?.items
          .find((item) => item.label === "Toggle Diagnostics")
          ?.click();
      });
      await expect
        .poll(async () =>
          (await page.evaluate(() => window.gwNative.settings.get()))
            .showDiagnostics,
        )
        .toBe(true);
      await page.locator("#settings-tab-controls").click();
      // The cursor ships on, so the change a player makes here is turning it
      // off. It picks the WASM main at launch, so main asks to restart before
      // it saves anything (P7.6); this drives the declined answer, where the
      // rule is that nothing is written and nothing on screen claims it was.
      await fixture.app.evaluate(({ dialog }) => {
        dialog.showMessageBox = async () => ({
          response: 1,
          checkboxChecked: false,
        });
      });
      // Not uncheck(): the box is re-rendered from the settings main returned,
      // which uncheck() would read as a failed click.
      await page.locator('input[name="nativeCursor"]').click();
      await expect(page.locator("#settings-feedback")).toHaveText(
        "The cursor was not changed.",
      );
      await expect(page.locator('input[name="nativeCursor"]')).toBeChecked();
      await expect
        .poll(() => page.evaluate(() => window.gwNative.settings.get()))
        .toMatchObject({
          renderScale: 1.5,
          nativeCursor: true,
          targetReadout: false,
          showDiagnostics: true,
        });
      // The second tool is independent and defaults off. Declining its restart
      // cannot change the cursor choice or leave the readout box ticked.
      await page.locator('input[name="targetReadout"]').click();
      await expect(page.locator("#settings-feedback")).toHaveText(
        "The target readout was not changed.",
      );
      await expect(page.locator('input[name="targetReadout"]')).not.toBeChecked();
      await expect(page.locator('input[name="nativeCursor"]')).toBeChecked();
      // Nothing about the running session's cursor may change.
      expect(
        await page.locator("#canvas").evaluate((canvas) =>
          globalThis.getComputedStyle(canvas).cursor,
        ),
      ).toBe("auto");

      await page.locator("#settings-done").click();
      await page.evaluate(() =>
        globalThis.dispatchEvent(new globalThis.Event("gw:settings")),
      );
      await expect(page.locator(".settings-panes")).toHaveAttribute(
        "data-active",
        "controls",
      );
    } finally {
      await closeOffline(fixture);
    }
  });

  test("labels the game cursor honestly and ships it on", async () => {
    const fixture = await launchOffline("gw-cursor-default-e2e-");
    try {
      const { page } = fixture;
      expect(await page.evaluate(() => window.gwNative.settings.get())).toMatchObject({
        nativeCursor: true,
        targetReadout: false,
      });
      await page.evaluate(() =>
        globalThis.dispatchEvent(new globalThis.Event("gw:settings")),
      );
      await page.locator("#settings-tab-controls").click();
      // A fresh profile arrives with the box already ticked, so the control is
      // how a player turns the cursor off rather than how they find it.
      await expect(page.locator('input[name="nativeCursor"]')).toBeChecked();
      await expect(page.locator('input[name="targetReadout"]')).not.toBeChecked();

      // Each tool has its own label and default; the cursor note has to say
      // where its artwork comes from and what changing it costs.
      const controls = page.locator("#settings-pane-controls");
      await expect(controls).toContainText("your own installed Guild Wars");
      await expect(controls).toContainText("no artwork ships with this app");
      await expect(controls).toContainText("Show target distance and range");
      await expect(controls).toContainText("Off by default");
      // The write and the restart are one action (P7.6), so the note must not
      // say the change waits quietly for the next launch.
      await expect(controls).toContainText("restarts the app");
      await expect(controls).not.toContainText("next time you open this app");
      // Loading the Enhancement does not paint a cursor by itself: the game must
      // publish one first, and this launcher has no game.
      expect(
        await page.locator("#canvas").evaluate((canvas) =>
          globalThis.getComputedStyle(canvas).cursor,
        ),
      ).toBe("auto");
      // The default reaches the renderer through the same init payload an
      // explicit opt-in does, not around it.
      expect(
        await page.evaluate(
          () => window.gwNative.init.enhancementSelection.nativeCursor,
        ),
      ).toBe(true);
      expect(
        await page.evaluate(
          () => window.gwNative.init.enhancementSelection.targetReadout,
        ),
      ).toBe(false);
      // The generated launch selection carries the canonical Enhancement registry
      // into the renderer. Every member must bind the Settings pane — and only
      // the Settings pane: the first-run gate asks one question, so a tool
      // checkbox appearing there again is a regression, not a feature.
      expect(
        await page.evaluate(() =>
          Object.keys(window.gwNative.init.enhancementSelection).map((name) => {
            const id = name.replace(/[A-Z]/gu, (letter) =>
              `-${letter.toLowerCase()}`);
            return {
              name,
              settings: !!globalThis.document.querySelector(
                `input[name="${name}"]`,
              ),
              launcher: !!globalThis.document.getElementById(
                `data-choice-${id}`,
              ),
            };
          }),
        ),
      ).toEqual([
        { name: "nativeCursor", settings: true, launcher: false },
        { name: "targetReadout", settings: true, launcher: false },
      ]);
    } finally {
      await closeOffline(fixture);
    }
  });

  test("reset and a changed Enhancement posture restart as one action", async () => {
    const fixture = await launchOffline(
      "gw-settings-reset-restart-e2e-",
      {},
      (userData) =>
        writeFile(
          path.join(userData, "settings.json"),
          JSON.stringify({ formatVersion: 1, nativeCursor: false }),
        ),
    );
    try {
      const { app, page } = fixture;
      expect(await page.evaluate(() => window.gwNative.settings.get())).toMatchObject({
        nativeCursor: false,
      });
      await app.evaluate(({ app: electronApp, dialog }) => {
        globalThis.__resetRestart = {
          quit: false,
          relaunch: false,
          options: null,
          originalQuit: electronApp.quit,
          originalRelaunch: electronApp.relaunch,
        };
        // Electron declares `showMessageBox` as two overloads and the app calls
        // the window+options one; a stub written for that form is not assignable
        // to the options-only signature, so the replacement is stated once.
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

      const reset = await page.evaluate(() => window.gwNative.settings.reset());
      expect(reset).toMatchObject({
        renderScale: 2,
        nativeCursor: true,
        targetReadout: false,
      });
      expect(
        await app.evaluate(() => {
          const { quit, relaunch, options } = globalThis.__resetRestart;
          if (!options) throw new Error("no message box was shown");
          return { quit, relaunch, buttons: options.buttons };
        }),
      ).toEqual({
        quit: true,
        relaunch: true,
        buttons: ["Reset and Restart", "Cancel"],
      });
      expect(await page.evaluate(() => window.gwNative.settings.get())).toMatchObject({
        renderScale: 2,
        nativeCursor: true,
      });
      await app.evaluate(({ app: electronApp }) => {
        electronApp.quit = globalThis.__resetRestart.originalQuit;
        electronApp.relaunch = globalThis.__resetRestart.originalRelaunch;
      });
    } finally {
      await closeOffline(fixture);
    }
  });

  test("keeps a committed settings reset when window-state reset fails", async () => {
    const fixture = await launchOffline("gw-settings-reset-window-failure-e2e-");
    try {
      const { app, page, userData } = fixture;
      await page.evaluate(() =>
        window.gwNative.settings.set({ showDiagnostics: true }),
      );
      const windowState = path.join(userData, "window-state.json");
      await rm(windowState, { recursive: true, force: true });
      // Atomic rename cannot replace a directory with the window-state file,
      // deterministically exercising the independent document's failure.
      await mkdir(windowState);
      await app.evaluate(({ dialog }) => {
        dialog.showMessageBox = async () => ({
          response: 0,
          checkboxChecked: false,
        });
      });

      const reset = await page.evaluate(() => window.gwNative.settings.reset());
      expect(reset).toMatchObject({
        renderScale: 2,
        showDiagnostics: false,
        nativeCursor: true,
      });
      expect(await page.evaluate(() => window.gwNative.settings.get())).toMatchObject({
        renderScale: 2,
        showDiagnostics: false,
        nativeCursor: true,
      });
    } finally {
      await closeOffline(fixture);
    }
  });

  test("keeps settings keyboard navigation and reduced motion accessible", async () => {
    // toBeFocused() requires document.hasFocus(), so this launch takes focus.
    const fixture = await launchOffline("gw-settings-accessibility-e2e-", {
      GW_BACKGROUND_LAUNCH: "0",
    });
    try {
      const { page } = fixture;
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.evaluate(() =>
        globalThis.dispatchEvent(new globalThis.Event("gw:settings")),
      );

      const dataTab = page.locator("#settings-tab-data");
      const displayTab = page.locator("#settings-tab-display");
      await dataTab.focus();
      await dataTab.press("ArrowRight");
      await expect(displayTab).toBeFocused();
      await expect(displayTab).toHaveAttribute("aria-selected", "true");
      await expect(page.locator("#settings-pane-display")).toBeVisible();
      await expect(page.locator("#settings-pane-data")).toBeHidden();

      expect(
        await page.locator("#settings-saved").evaluate(
          (element) => globalThis.getComputedStyle(element).transitionDuration,
        ),
      ).toBe("0s");
      await page.locator("#settings-done").click();
      await expect(page.locator("#settings-dialog")).not.toHaveAttribute(
        "open",
        "",
      );
    } finally {
      await closeOffline(fixture);
    }
  });

  test("restores canonical presentation when a settings save fails", async () => {
    const fixture = await launchOffline("gw-settings-save-failure-e2e-");
    try {
      const { app, page } = fixture;
      await page.evaluate(() =>
        globalThis.dispatchEvent(new globalThis.Event("gw:settings")),
      );
      await page.locator("#settings-tab-controls").click();
      await app.evaluate(({ ipcMain }) => {
        ipcMain.removeHandler("gw:settings:set");
        ipcMain.handle("gw:settings:set", () => {
          throw new Error("forced settings write failure");
        });
      });

      // Not uncheck(): the box ships ticked and the rollback re-ticks it,
      // which uncheck() reads as a failed click. Clicking is what a player
      // does, and the change is undone.
      await page.locator('input[name="nativeCursor"]').click();
      await expect(page.locator("#settings-feedback")).toHaveText(
        "Settings could not be saved.",
      );
      // A failed write must not leave the box showing a state the main process
      // never accepted — here, a cursor the player still has.
      await expect(page.locator('input[name="nativeCursor"]')).toBeChecked();
      expect(
        await page.evaluate(() => window.gwNative.settings.get()),
      ).toMatchObject({ nativeCursor: true });
    } finally {
      await closeOffline(fixture);
    }
  });
});
