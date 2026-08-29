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

declare global {
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
  test("starts the complete download automatically without blocking play", async () => {
    const fixture = await launchCachedClient(
      "gw-launcher-e2e-",
      {},
      async () => undefined,
      { snapshotSize: 8 * 1024 ** 3 },
    );
    try {
      const { page } = fixture;
      await expect(page.locator("#client-compat-play")).toBeVisible();
      await page.locator("#client-compat-play").click();
      await expect.poll(() => page.evaluate(() =>
        [...globalThis.document.scripts].some((script) =>
          script.src.endsWith("/Gw.jspi.js"),
        ))).toBe(true);
      await page.locator("#loading-links [data-settings]").click();
      await expect(page.locator("#settings-download-full")).toHaveText("Resume Download");
      await expect(page.locator("#settings-cache")).toHaveText(
        "The download could not continue. Check your connection, then choose Resume Download.",
      );
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
        extendedMemory: null,
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
    let fixture = await launchOffline(
      "gw-filesystem-reset-e2e-",
      {},
      async (userData) => {
        await writeFile(path.join(userData, "settings.json"), "{}", { mode: 0o600 });
      },
    );
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
