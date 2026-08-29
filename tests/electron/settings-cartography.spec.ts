import { expect, test } from "@playwright/test";
import { closeOffline, isDomActiveElement, launchOffline } from "./fixtures.mjs";
import "./settings-test-fixture.mjs";

test.describe("Cartography settings", () => {
  test("turns a built-in style into an editable style without a disabled editor", async () => {
    test.setTimeout(60_000);
    const fixture = await launchOffline("gw-settings-cartography-e2e-");
    try {
      const { page } = fixture;
      await page.evaluate(() =>
        globalThis.dispatchEvent(new globalThis.Event("gw:settings")),
      );
      await page.locator("#settings-tab-maps").click();

      const pane = page.locator("#settings-pane-maps");
      const customize = pane.locator('[data-cartography-preset-action="customize"]');
      const customizer = pane.locator("[data-cartography-customizer]");
      await expect(pane).toBeVisible();
      await expect(customizer).toBeHidden();
      await expect(customize).toBeEnabled();
      await expect(pane.locator('input[name="cartographyUnseenMarker"]')).toHaveCount(5);

      await customize.click();
      await expect(customizer).toBeVisible();
      await expect(customize).toHaveText("Edit style…");
      await expect(customizer.locator(":disabled")).toHaveCount(0);
      await expect(
        customizer.locator('input[name="cartographyUnseenMarker"][value="diamond"]'),
      ).toBeChecked();
      await expect.poll(() => page.evaluate(async () => {
        const settings = await window.gwNative.settings.get();
        return {
          active: settings.cartographyPresetLibrary.activePreset.kind,
          customCount: settings.cartographyPresetLibrary.customPresets.length,
        };
      })).toEqual({ active: "custom", customCount: 1 });

      await customizer.getByText("Cross", { exact: true }).click();
      await expect.poll(() => page.evaluate(async () => {
        const settings = await window.gwNative.settings.get();
        const active = settings.cartographyPresetLibrary.activePreset;
        if (active.kind !== "custom") return null;
        return settings.cartographyPresetLibrary.customPresets
          .find((style) => style.id === active.id)?.style.grid.unseen.marker ?? null;
      })).toBe("cross");

      const done = customizer.getByRole("button", { name: "Done" });
      await done.click();
      await expect(customizer).toBeHidden();
      await expect.poll(() => isDomActiveElement(customize)).toBe(true);

      await page.locator("#settings-done").click();
      await page.evaluate(() =>
        globalThis.dispatchEvent(new globalThis.Event("gw:settings")),
      );
      await page.locator("#settings-tab-maps").click();
      await expect(customize).toHaveText("Edit style…");
      await customize.click();
      await expect(customizer.locator(
        'input[name="cartographyUnseenMarker"][value="cross"]',
      )).toBeChecked();
    } finally {
      await closeOffline(fixture);
    }
  });
});
