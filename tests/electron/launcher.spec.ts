import { expect, test } from "@playwright/test";
import { existsSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import {
  closeOffline,
  launchOffline,
  launchOfflineAt,
} from "./fixtures.mjs";

/** The reply this spec holds open on `gw:cache:downloadAll`. */
interface DownloadOutcome {
  status: string;
  errorCode?: string;
}

declare global {
  // Probes installed by this spec: the first two in the main process, the last
  // in the renderer. They exist only while it runs.
  var __failLauncherDownloadTest: ((result: DownloadOutcome) => void) | undefined;
  var __fullGameVerificationCalls: number | undefined;
  interface Window {
    __nativeInputReset?: boolean;
  }
}

test.describe("launcher recovery", () => {
  test("keeps verified data and offers one retry after an interrupted download", async () => {
    const fixture = await launchOffline("gw-launcher-e2e-", {
      GW_OFFLINE_SNAPSHOT_SIZE: String(8 * 1024 ** 3),
    });
    try {
      const { app, page } = fixture;
      await expect(page.locator("#data-choice")).toBeVisible();
      // One decision and one consent line. The game tools live in Settings
      // only — a first launch must not ask about restarts.
      await expect(page.locator("#data-choice-auto-updates")).toBeChecked();
      await expect(page.locator("#data-choice")).toContainText(
        "about every six hours",
      );
      await expect(page.locator("#data-choice")).not.toContainText("cursor");
      await expect(page.locator("#data-choice")).not.toContainText("restart");
      // The recommended card reads first.
      await expect(
        page.locator(".data-choice-actions .data-choice-option").first(),
      ).toHaveId("data-choice-quick");
      // The card carries the size, the disk reality, and the hybrid promise.
      await expect(page.locator("#data-choice-full-size")).toContainText(
        "Download 8.00 GB first",
      );
      await expect(page.locator("#data-choice-full-size")).toContainText(
        "free on this Mac",
      );
      await expect(page.locator("#data-choice-full-size")).toContainText(
        "You can play while it downloads.",
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
          if (!firstRequest) return { status: "stopped" };
          firstRequest = false;
          return new Promise<DownloadOutcome>((resolve) => {
            globalThis.__failLauncherDownloadTest = resolve;
          });
        });
      });
      await page.locator("#data-choice-full").click();
      await expect(page.locator("#data-download")).toBeVisible();
      await expect(page.locator("#data-download-toggle")).toHaveText(
        "Pause Download",
      );
      await app.evaluate(() => {
        // The download reports a code; the sentence below is the renderer's.
        globalThis.__failLauncherDownloadTest?.({
          status: "failed",
          errorCode: "fetch_failed",
        });
        // Cleared rather than deleted: every read is optional-chained, so this
        // is the same "the probe is spent" state without a `delete` on a global.
        globalThis.__failLauncherDownloadTest = undefined;
      });
      await expect(page.locator("#data-download-status")).toHaveText(
        "The download could not continue. Check your connection, then choose Resume Download.",
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
      // The first boot parks on the strategy choice, because it resolves with
      // the default settings and therefore never runs a Full Game
      // verification. Waiting for it leaves the reload as the only boot that
      // can call downloadAll, which is what the count below asserts.
      await expect(page.locator("#data-choice")).toBeVisible();
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
          freeBytes: -1,
          fullDownloadShortfall: 0,
        }));
        ipcMain.removeHandler("gw:cache:downloadAll");
        ipcMain.handle("gw:cache:downloadAll", () => {
          globalThis.__fullGameVerificationCalls =
            (globalThis.__fullGameVerificationCalls || 0) + 1;
          return { status: "failed", errorCode: "disk_full" };
        });
      }, size);
      await page.reload();

      await expect(page.locator("#data-download")).toBeVisible();
      await expect(page.locator("#data-download-status")).toHaveText(
        "There is not enough free disk space to download the full game. Free some space, then choose Resume Download.",
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
        "The game client could not be loaded.",
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
          new Promise<void>((resolve, reject) => {
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
