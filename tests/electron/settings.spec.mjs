import { expect, test } from "@playwright/test";
import { existsSync } from "node:fs";
import { closeOffline, launchOffline, main } from "./fixtures.mjs";

test.describe("settings experience", () => {
  test.skip(!existsSync(main), "run tsc + copy-renderer before electron tests");

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

  test("explains render cost and will not change the cursor without a restart", async () => {
    const fixture = await launchOffline("gw-settings-e2e-");
    try {
      const { page } = fixture;
      await page.evaluate(() =>
        globalThis.dispatchEvent(new globalThis.Event("gw:settings")),
      );
      await expect(page.locator("#settings-dialog")).toHaveAttribute("open", "");
      await page.locator("#settings-tab-display").click();
      await expect(
        page.locator('input[name="renderScale"][value="2"]'),
      ).toBeChecked();

      const dimensions = await page.evaluate(() => {
        const canvas = globalThis.document.getElementById("canvas");
        const label = (scale) =>
          globalThis.document.querySelector(
            `[data-render-scale="${scale}"]`,
          ).textContent;
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
          showDiagnostics: true,
        });
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
      });
      await page.evaluate(() =>
        globalThis.dispatchEvent(new globalThis.Event("gw:settings")),
      );
      await page.locator("#settings-tab-controls").click();
      // A fresh profile arrives with the box already ticked, so the control is
      // how a player turns the cursor off rather than how they find it.
      await expect(page.locator('input[name="nativeCursor"]')).toBeChecked();

      // The note has to say where the artwork comes from and when it applies;
      // nothing is bundled, so the box is the only thing the player toggles.
      const controls = page.locator("#settings-pane-controls");
      await expect(controls).toContainText("your own installed Guild Wars");
      await expect(controls).toContainText("no artwork ships with this app");
      await expect(controls).toContainText("next time you open this app");
      // Loading the Toolbox does not paint a cursor by itself: the game must
      // publish one first, and this launcher has no game.
      expect(
        await page.locator("#canvas").evaluate((canvas) =>
          globalThis.getComputedStyle(canvas).cursor,
        ),
      ).toBe("auto");
      // The default reaches the renderer through the same init payload an
      // explicit opt-in does, not around it.
      expect(
        await page.evaluate(() => globalThis.gwNative.init.nativeCursor),
      ).toBe(true);
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
