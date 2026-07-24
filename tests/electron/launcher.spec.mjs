import { expect, test } from "@playwright/test";
import { existsSync } from "node:fs";
import { closeOffline, launchOffline, main } from "./fixtures.mjs";

test.describe("launcher recovery", () => {
  test.skip(!existsSync(main), "run tsc + copy-renderer before electron tests");

  test("keeps verified data and offers one retry after an interrupted download", async () => {
    const fixture = await launchOffline("gw-launcher-e2e-", {
      GW_OFFLINE_SNAPSHOT_SIZE: String(8 * 1024 ** 3),
    });
    try {
      const { app, page } = fixture;
      await expect(page.locator("#data-choice")).toBeVisible();
      await expect(page.locator("#data-choice-full-size")).toHaveText(
        "Download 8.00 GB before starting.",
      );
      expect(
        await page.evaluate(() =>
          [...globalThis.document.scripts].some((script) =>
            script.src.endsWith("/Gw.jspi.js"),
          ),
        ),
      ).toBe(false);

      await app.evaluate(({ ipcMain }) => {
        let firstRequest = true;
        ipcMain.removeHandler("gw:cache:downloadAll");
        ipcMain.handle("gw:cache:downloadAll", () => {
          if (!firstRequest) return false;
          firstRequest = false;
          return new Promise((_resolve, reject) => {
            globalThis.__rejectLauncherDownloadTest = reject;
          });
        });
      });
      await page.locator("#data-choice-full").click();
      await expect(page.locator("#data-download")).toBeVisible();
      await expect(page.locator("#data-download-toggle")).toHaveText(
        "Pause Download",
      );
      await app.evaluate(() => {
        globalThis.__rejectLauncherDownloadTest?.(
          new Error("ArenaNet is unavailable. The download can resume later."),
        );
        delete globalThis.__rejectLauncherDownloadTest;
      });
      await expect(page.locator("#data-download-status")).toContainText(
        "ArenaNet is unavailable",
      );
      await expect(page.locator("#data-download-detail")).toHaveText(
        "Verified data is safe. Choose Resume Download to try again.",
      );
      await expect(page.locator("#data-download-toggle")).toHaveText(
        "Resume Download",
      );
      expect(
        await page.evaluate(async () =>
          (await window.gwNative.settings.get()).dataStrategy,
        ),
      ).toBe("full");
    } finally {
      await closeOffline(fixture);
    }
  });

  test("offers retry and diagnostics when the game client cannot start", async () => {
    const fixture = await launchOffline("gw-startup-recovery-e2e-");
    try {
      await fixture.page.evaluate(() => {
        window.gwLoading.fail(
          "ArenaNet is unavailable and no previous game client could be restored.",
        );
      });
      await expect(fixture.page.locator("#loading-retry")).toBeVisible();
      await expect(fixture.page.locator("#loading-detail")).toHaveText(
        "You can retry, or choose Help → Report a Problem.",
      );
    } finally {
      await closeOffline(fixture);
    }
  });
});
