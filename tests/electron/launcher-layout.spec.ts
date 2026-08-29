/** Launcher chrome remains usable at the supported minimum size and 200% zoom. */
import { expect, test } from "@playwright/test";
import { closeOffline, launchOffline } from "./fixtures.mjs";

interface Rect {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
}

test("minimum window and 200% zoom keep primary launcher controls reachable", async () => {
  const fixture = await launchOffline("gw-launcher-layout-", {
    GW_TEST_RETURN_LAUNCHER: "1",
  });
  try {
    await fixture.page.getByRole("button", { name: "Continue" }).click();
    await fixture.page.getByRole("button", { name: "Not now" }).click();
    await fixture.page.getByRole("button", { name: "Skip" }).click();
    await fixture.app.evaluate(({ BrowserWindow }) => {
      const launcher = BrowserWindow.getAllWindows().find((win) =>
        win.webContents.getURL().endsWith("launcher/index.html"));
      if (!launcher) throw new Error("launcher window is required");
      launcher.setSize(900, 640);
      launcher.webContents.setZoomFactor(2);
    });
    await expect.poll(() => fixture.page.evaluate(() => window.innerWidth)).toBeLessThanOrEqual(460);

    const geometry = await fixture.page.evaluate(() => {
      const rect = (selector: string): Rect => {
        const value = document.querySelector<HTMLElement>(selector)?.getBoundingClientRect();
        if (!value) throw new Error(`${selector} is missing`);
        return { left: value.left, top: value.top, right: value.right, bottom: value.bottom };
      };
      return {
        width: window.innerWidth,
        height: window.innerHeight,
        titlebar: rect(".titlebar"),
        main: rect("main"),
        launchbar: rect(".launchbar"),
        picker: rect(".account-picker"),
        launch: rect(".launch"),
      };
    });
    for (const control of [geometry.titlebar, geometry.launchbar, geometry.picker, geometry.launch]) {
      expect(control.left).toBeGreaterThanOrEqual(-1);
      expect(control.right).toBeLessThanOrEqual(geometry.width + 1);
      expect(control.top).toBeGreaterThanOrEqual(-1);
      expect(control.bottom).toBeLessThanOrEqual(geometry.height + 1);
    }
    expect(geometry.main.bottom).toBeLessThanOrEqual(geometry.launchbar.top + 1);

    await fixture.page.getByRole("button", { name: "Settings" }).click();
    await expect(fixture.page.getByRole("button", { name: "Game files", exact: true })).toBeVisible();
    await fixture.page.getByRole("button", { name: "Game files", exact: true }).click();
    await expect(fixture.page.getByRole("heading", { name: "Game files" })).toBeVisible();
  } finally {
    await closeOffline(fixture);
  }
});
