import { expect, test } from "@playwright/test";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  closeOffline,
  launchCachedClient,
  launchOffline,
  launchOfflineAt,
  type OfflineFixture,
} from "./fixtures.mjs";

test.describe("extended memory settings", () => {
  test("persists the graphics profile outside ordinary settings until restart", async () => {
    const fixture = await launchOffline("gw-settings-graphics-profile-e2e-");
    let relaunched: OfflineFixture | null = null;
    try {
      const { page } = fixture;
      await page.evaluate(() =>
        globalThis.dispatchEvent(new globalThis.Event("gw:settings")),
      );
      await page.locator("#settings-tab-advanced").click();
      const profile = page.locator('select[name="diagnosticProfile"]');
      await profile.selectOption("no-gl-overrides");
      await expect(page.locator("#settings-feedback")).toContainText(
        "Restart GWonMac",
      );
      await expect(profile).toHaveValue("no-gl-overrides");

      // A normal Settings render must not replace the separately persisted
      // restart-required selection with this session's launch value.
      await page.locator('input[name="showDiagnostics"]').click();
      await expect(profile).toHaveValue("no-gl-overrides");
      await expect.poll(async () => JSON.parse(
        await readFile(path.join(fixture.userData, "diagnostic-profile.json"), "utf8"),
      )).toEqual({ formatVersion: 1, profile: "no-gl-overrides" });

      await fixture.app.close();
      relaunched = await launchOfflineAt(fixture.userData);
      await expect.poll(() => relaunched!.page.evaluate(
        () => window.gwNative.init.diagnosticProfile,
      )).toBe("no-gl-overrides");
      await expect(relaunched.page.locator("#diagnostic-profile-banner"))
        .toBeVisible();
    } finally {
      await closeOffline(relaunched ?? fixture);
    }
  });

  test("shows requested and effective memory modes without blocking an unsupported launch", async () => {
    test.setTimeout(60_000);
    let relaunched: OfflineFixture | null = null;
    const fixture = await launchCachedClient(
      "gw-settings-memory-e2e-",
      {},
      async (userData) => {
        await writeFile(
          path.join(userData, "settings.json"),
          JSON.stringify({
            autoCheckUpdates: false,
            extendedMemoryEnabled: true,
          }),
        );
      },
    );
    try {
      const { page } = fixture;
      await expect.poll(() => page.evaluate(async () =>
        (await window.gwNative.client.session()).extendedMemory,
      ), { timeout: 30_000 }).toMatchObject({
        requestedAtLaunch: true,
        status: "unavailable",
        effectiveCapBytes: 2_147_483_648,
      });

      await page.evaluate(() =>
        globalThis.dispatchEvent(new globalThis.Event("gw:settings")),
      );
      await page.locator("#settings-tab-advanced").click();
      await expect(page.locator('input[name="extendedMemoryEnabled"]')).toBeChecked();
      await expect(page.locator("#settings-memory-badge")).toHaveText(
        "Unavailable for this Guild Wars update",
      );
      await expect(page.locator("#settings-memory-status")).toContainText(
        "Guild Wars started normally with 2 GB",
      );

      await page.locator('input[name="extendedMemoryEnabled"]').click();
      await expect(page.locator("#settings-memory-badge")).toHaveText(
        "Restart required",
      );
      await expect(page.locator("#settings-memory-status")).toContainText(
        "This session is still using 2 GB",
      );
      await expect.poll(() => page.evaluate(async () =>
        (await window.gwNative.settings.get()).extendedMemoryEnabled,
      )).toBe(false);
      await fixture.app.close();
      relaunched = await launchOfflineAt(fixture.userData);
      await expect.poll(() => relaunched!.page.evaluate(async () =>
        (await window.gwNative.client.session()).extendedMemory,
      ), { timeout: 30_000 }).toEqual({
        requestedAtLaunch: false,
        status: "standard",
        effectiveCapBytes: 2_147_483_648,
        fallbackReason: null,
      });
    } finally {
      await closeOffline(relaunched ?? fixture);
    }
  });

  // The menu item used to run a string of JavaScript in the renderer.
  // It now sends a typed command, and this is the only caller of `settings.open`
  // — every other spec dispatches the renderer event directly, which would keep
  // passing if the main-process half were removed entirely.
});
