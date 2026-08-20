import { expect, test } from "@playwright/test";
import { existsSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import {
  closeOffline,
  launchCachedClient,
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
  var __gameStorageReset: {
    accept: boolean;
    quit: number;
    relaunch: number;
    originalDialog: Electron.Dialog["showMessageBox"];
    originalQuit: Electron.App["quit"];
    originalRelaunch: Electron.App["relaunch"];
  };
  var __clientRetryRestart: {
    quit: number;
    relaunch: number;
    originalQuit: Electron.App["quit"];
    originalRelaunch: Electron.App["relaunch"];
  };
  interface Window {
    __nativeInputReset?: boolean;
    __clientRetryPageMarker?: boolean;
  }
}

test.describe("launcher recovery", () => {
  test("keeps verified data, retries interruption, and verifies before startup", async () => {
    const fixture = await launchCachedClient(
      "gw-launcher-e2e-",
      {},
      async () => undefined,
      { snapshotSize: 8 * 1024 ** 3 },
    );
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
      const size = 8 * 1024 ** 3;
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

  test("offers retry when no game client is available", async () => {
    const fixture = await launchOffline("gw-startup-recovery-e2e-");
    try {
      // The empty cached-only launch owns one refusal. Assert the renderer's
      // projection of that canonical state instead of racing it with an
      // injected second failure presentation.
      await expect.poll(() => fixture.page.evaluate(async () =>
        window.gwNative.progress.current(),
      )).toMatchObject({ phase: "error", errorCode: "not_ready" });
      await expect(fixture.page.locator("#loading-label")).toHaveText(
        "No game client has been downloaded yet, and ArenaNet could not be reached.",
      );
      await expect(fixture.page.locator("#loading-retry")).toBeVisible();
      await expect(fixture.page.locator("#loading-detail")).toHaveText(
        "Error code: not_ready",
      );
      await fixture.page.locator("#loading-retry").click();
      await expect(fixture.page.locator("#loading-label")).toHaveText(
        "No game client has been downloaded yet, and ArenaNet could not be reached.",
      );
      await expect(fixture.page.locator("#loading-detail")).toHaveText(
        "Error code: not_ready",
      );
      await expect(fixture.page.locator("#loading-retry")).toBeVisible();
    } finally {
      await closeOffline(fixture);
    }
  });

  test("refuses snapshot metadata until an active client exists", async () => {
    const fixture = await launchOffline("gw-snapshot-not-ready-e2e-");
    try {
      await expect.poll(() => fixture.page.evaluate(async () =>
        window.gwNative.progress.current(),
      )).toMatchObject({ phase: "error", errorCode: "not_ready" });
      const result = await fixture.page.evaluate(async () => {
        const session = await window.gwNative.client.session();
        try {
          await window.gwNative.snapshot.metadata();
          return { session, refusal: null };
        } catch (error) {
          return {
            session,
            refusal: error instanceof Error ? error.message : String(error),
          };
        }
      });
      expect(result.session).toMatchObject({
        compatibility: null,
        healthToken: null,
      });
      expect(result.refusal).toContain("no active client snapshot is available");
    } finally {
      await closeOffline(fixture);
    }
  });

  test("relaunches an active client before startup retry can move its files", async () => {
    const fixture = await launchCachedClient("gw-active-client-retry-e2e-");
    try {
      const { app, page } = fixture;
      const rejectedPath = path.join(
        fixture.userData,
        "game",
        "rejected-client.json",
      );
      await writeFile(rejectedPath, "rejected");
      await expect.poll(() => page.evaluate(async () => {
        const [session, progress] = await Promise.all([
          window.gwNative.client.session(),
          window.gwNative.progress.current(),
        ]);
        return {
          active: session.compatibility !== null,
          phase: progress.phase,
        };
      })).toEqual({ active: true, phase: "ready" });
      await app.evaluate(({ app: electronApp }) => {
        globalThis.__clientRetryRestart = {
          quit: 0,
          relaunch: 0,
          originalQuit: electronApp.quit,
          originalRelaunch: electronApp.relaunch,
        };
        electronApp.quit = () => {
          globalThis.__clientRetryRestart.quit += 1;
        };
        electronApp.relaunch = () => {
          globalThis.__clientRetryRestart.relaunch += 1;
          throw new Error("injected client-retry relaunch refusal");
        };
      });

      await page.evaluate(() => window.gwNative.client.retry());
      expect(existsSync(rejectedPath)).toBe(false);
      expect(await app.evaluate(() => ({
        quit: globalThis.__clientRetryRestart.quit,
        relaunch: globalThis.__clientRetryRestart.relaunch,
      }))).toEqual({ quit: 0, relaunch: 1 });
      await expect.poll(() => page.evaluate(async () =>
        window.gwNative.progress.current(),
      )).toMatchObject({ phase: "error", errorCode: "unknown" });

      await app.evaluate(({ app: electronApp }) => {
        electronApp.relaunch = () => {
          globalThis.__clientRetryRestart.relaunch += 1;
        };
      });
      await page.evaluate(() => {
        window.__clientRetryPageMarker = true;
        window.gwLoading.fail("Injected active-client retry");
      });
      await page.locator("#loading-retry").dispatchEvent("click");
      await expect.poll(() => app.evaluate(() => ({
        quit: globalThis.__clientRetryRestart.quit,
        relaunch: globalThis.__clientRetryRestart.relaunch,
      }))).toEqual({ quit: 1, relaunch: 2 });
      await expect.poll(() => page.evaluate(async () =>
        window.gwNative.progress.current(),
      )).toMatchObject({
        phase: "starting",
        label: "Restarting the game client",
      });
      await expect.poll(() => page.evaluate(() =>
        !(document.getElementById("loading-retry") as HTMLButtonElement).disabled,
      )).toBe(true);
      // Main now owns relaunch and quit cleanup. The renderer must stay alive
      // long enough for that cleanup instead of starting its own page reload.
      expect(await page.evaluate(() => window.__clientRetryPageMarker)).toBe(true);
    } finally {
      await fixture.app.evaluate(({ app: electronApp }) => {
        electronApp.quit = globalThis.__clientRetryRestart.originalQuit;
        electronApp.relaunch = globalThis.__clientRetryRestart.originalRelaunch;
      }).catch(() => undefined);
      await closeOffline(fixture);
    }
  });

  test("offers a scoped saved-file reset without trapping held input", async () => {
    const fixture = await launchOffline("gw-filesystem-recovery-e2e-");
    try {
      const { app, page } = fixture;
      // Let the cached-only boot settle so its expected client failure cannot
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

  test("confirms, persists, and applies a saved-files reset before replacement startup", async () => {
    let fixture = await launchOffline("gw-filesystem-reset-e2e-");
    const { userData } = fixture;
    const marker = path.join(userData, "clear-game-storage-on-start");
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

      await fixture.app.evaluate(({ app: electronApp, dialog }) => {
        globalThis.__gameStorageReset = {
          accept: false,
          quit: 0,
          relaunch: 0,
          originalDialog: dialog.showMessageBox,
          originalQuit: electronApp.quit,
          originalRelaunch: electronApp.relaunch,
        };
        dialog.showMessageBox = async () => ({
          response: globalThis.__gameStorageReset.accept ? 0 : 1,
          checkboxChecked: false,
        });
        electronApp.relaunch = () => {
          globalThis.__gameStorageReset.relaunch += 1;
        };
        electronApp.quit = () => {
          globalThis.__gameStorageReset.quit += 1;
        };
      });

      expect(
        await fixture.page.evaluate(() =>
          window.gwNative.gameStorage.resetAndRestart(),
        ),
      ).toBe(false);
      expect(existsSync(marker)).toBe(false);
      expect(
        await fixture.app.evaluate(() => ({
          quit: globalThis.__gameStorageReset.quit,
          relaunch: globalThis.__gameStorageReset.relaunch,
        })),
      ).toEqual({ quit: 0, relaunch: 0 });

      await fixture.app.evaluate(() => {
        globalThis.__gameStorageReset.accept = true;
      });
      expect(
        await fixture.page.evaluate(() =>
          window.gwNative.gameStorage.resetAndRestart(),
        ),
      ).toBe(true);
      expect(existsSync(marker)).toBe(true);
      expect(
        await fixture.app.evaluate(() => ({
          quit: globalThis.__gameStorageReset.quit,
          relaunch: globalThis.__gameStorageReset.relaunch,
        })),
      ).toEqual({ quit: 1, relaunch: 1 });

      await fixture.app.evaluate(({ app: electronApp, dialog }) => {
        dialog.showMessageBox = globalThis.__gameStorageReset.originalDialog;
        electronApp.quit = globalThis.__gameStorageReset.originalQuit;
        electronApp.relaunch = globalThis.__gameStorageReset.originalRelaunch;
      });
      await fixture.app.close();

      fixture = await launchOfflineAt(userData);
      expect(
        await fixture.page.evaluate(async () =>
          (await globalThis.indexedDB.databases()).some(
            (database) => database.name === "gwonmac-reset-probe",
          ),
        ),
      ).toBe(false);
      expect(
        existsSync(marker),
      ).toBe(false);
    } finally {
      await closeOffline(fixture);
    }
  });
});
