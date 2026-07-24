import { expect, test } from "@playwright/test";
import { existsSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import {
  closeOffline,
  launchOffline,
  launchOfflineAt,
  main,
} from "./fixtures.mjs";

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

  test("verifies apparently complete Full Game data before startup", async () => {
    const size = 8 * 1024 ** 3;
    const fixture = await launchOffline("gw-launcher-verify-e2e-", {
      GW_OFFLINE_SNAPSHOT_SIZE: String(size),
    });
    try {
      const { app, page } = fixture;
      await page.evaluate(() =>
        window.gwNative.settings.set({ dataStrategy: "full" }),
      );
      await app.evaluate(({ ipcMain }, totalBytes) => {
        ipcMain.removeHandler("gw:cache:info");
        ipcMain.handle("gw:cache:info", () => ({
          bytes: totalBytes,
          chunks: 1,
          totalBytes,
          totalChunks: 1,
        }));
        ipcMain.removeHandler("gw:cache:downloadAll");
        ipcMain.handle("gw:cache:downloadAll", () => {
          globalThis.__fullGameVerificationCalls =
            (globalThis.__fullGameVerificationCalls || 0) + 1;
          throw new Error(
            "A cached chunk was corrupt. Choose Resume Download to repair it.",
          );
        });
      }, size);
      await page.reload();

      await expect(page.locator("#data-download")).toBeVisible();
      await expect(page.locator("#data-download-status")).toContainText(
        "cached chunk was corrupt",
      );
      await expect(page.locator("#data-download-toggle")).toHaveText(
        "Resume Download",
      );
      expect(
        await app.evaluate(() => globalThis.__fullGameVerificationCalls),
      ).toBe(1);
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
      await fixture.page.locator("#loading-retry").click();
      await expect(fixture.page.locator("#loading-label")).toHaveText(
        "No game build could be loaded.",
      );
      await expect(fixture.page.locator("#loading-retry")).toBeVisible();
    } finally {
      await closeOffline(fixture);
    }
  });

  test("offers a scoped saved-file reset without trapping held input", async () => {
    const fixture = await launchOffline("gw-filesystem-recovery-e2e-");
    try {
      const { app, page } = fixture;
      // Let the offline boot settle so its expected client failure cannot
      // overwrite the filesystem failure injected below.
      await expect(page.locator("#loading-retry")).toBeVisible();
      await page.evaluate(() => {
        window.__nativeInputReset = false;
        window.addEventListener("gw:input-reset", () => {
          window.__nativeInputReset = true;
        });
        window.gwLoading.failFilesystem();
      });
      await expect(page.locator("#loading-label")).toHaveText(
        "Saved game files could not be opened.",
      );
      await expect(page.locator("#loading-detail")).toContainText(
        "Downloaded game data and your saved login are kept.",
      );
      await expect(page.locator("#loading-retry")).toHaveText(
        "Reset Saved Files…",
      );

      await app.evaluate(({ dialog }) => {
        dialog.showMessageBox = async () => ({
          response: 1,
          checkboxChecked: false,
        });
      });
      await page.locator("#loading-retry").click();
      await expect(page.locator("#loading-retry")).toBeVisible();
      await expect(page.locator("#loading-retry")).toBeEnabled();
      expect(await page.evaluate(() => window.__nativeInputReset)).toBe(true);
    } finally {
      await closeOffline(fixture);
    }
  });

  test("clears saved files before the replacement renderer can mount IDBFS", async () => {
    let fixture = await launchOffline("gw-filesystem-reset-e2e-");
    const { userData } = fixture;
    try {
      await fixture.page.evaluate(
        () =>
          new Promise((resolve, reject) => {
            const request = globalThis.indexedDB.open(
              "gwonmac-reset-probe",
              1,
            );
            request.onupgradeneeded = () => {
              request.result.createObjectStore("files");
            };
            request.onerror = () => reject(request.error);
            request.onsuccess = () => {
              request.result.close();
              resolve();
            };
          }),
      );
      await fixture.app.close();
      await writeFile(
        path.join(userData, "clear-game-storage-on-start"),
        "",
      );

      fixture = await launchOfflineAt(userData);
      expect(
        await fixture.page.evaluate(async () =>
          (await globalThis.indexedDB.databases()).some(
            (database) => database.name === "gwonmac-reset-probe",
          ),
        ),
      ).toBe(false);
      expect(
        existsSync(path.join(userData, "clear-game-storage-on-start")),
      ).toBe(false);
    } finally {
      await closeOffline(fixture);
    }
  });
});
