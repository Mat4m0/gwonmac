import { expect, test } from "@playwright/test";
import { existsSync } from "node:fs";
import { closeOffline, launchOffline, main } from "./fixtures.mjs";

test.describe("settings experience", () => {
  test.skip(!existsSync(main), "run tsc + copy-renderer before electron tests");

  test("explains render cost and switches cursor themes immediately", async () => {
    const fixture = await launchOffline("gw-settings-e2e-");
    try {
      const { page } = fixture;
      await page.evaluate(() =>
        globalThis.dispatchEvent(new globalThis.Event("gw:settings")),
      );
      await expect(page.locator("#settings-dialog")).toHaveAttribute("open", "");
      await page.locator("#settings-tab-display").click();

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
      await page
        .locator('select[name="cursorTheme"]')
        .selectOption("guild-wars-2");
      await expect
        .poll(() => page.evaluate(() => window.gwNative.settings.get()))
        .toMatchObject({
          renderScale: 1.5,
          cursorTheme: "guild-wars-2",
          showDiagnostics: true,
        });
      await expect(page.locator("#canvas")).toHaveAttribute(
        "data-cursor-theme",
        "guild-wars-2",
      );
      expect(
        await page.locator("#settings-cursor-preview").evaluate((preview) =>
          globalThis.getComputedStyle(preview).cursor,
        ),
      ).toContain("guild-wars-2.png");

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

  test("labels the native cursor honestly and defaults to Guild Wars", async () => {
    const fixture = await launchOffline("gw-cursor-default-e2e-");
    try {
      const { page } = fixture;
      expect(await page.evaluate(() => window.gwNative.settings.get())).toMatchObject({
        cursorTheme: "guild-wars",
      });
      await page.evaluate(() =>
        globalThis.dispatchEvent(new globalThis.Event("gw:settings")),
      );
      await page.locator("#settings-tab-controls").click();
      await expect(
        page.locator('select[name="cursorTheme"] option[value="system"]'),
      ).toHaveText("macOS Default");
      await page.locator('select[name="cursorTheme"]').selectOption("system");
      await expect(page.locator("#canvas")).toHaveAttribute(
        "data-cursor-theme",
        "system",
      );
      expect(
        await page.locator("#canvas").evaluate((canvas) =>
          globalThis.getComputedStyle(canvas).cursor,
        ),
      ).toBe("default");
    } finally {
      await closeOffline(fixture);
    }
  });

  test("keeps settings keyboard navigation and reduced motion accessible", async () => {
    const fixture = await launchOffline("gw-settings-accessibility-e2e-");
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
});
