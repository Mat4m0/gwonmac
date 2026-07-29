import { writeFile } from "node:fs/promises";
import path from "node:path";
import {
  closeOffline,
  expect,
  launchOffline,
  test,
} from "./fixtures.mjs";

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
            ?.items.flatMap((menu) => menu.submenu?.items ?? [])
            .find(
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
