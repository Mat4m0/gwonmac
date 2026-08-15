import { expect, test } from "@playwright/test";
import {
  closeOffline,
  isDomActiveElement,
  launchCachedClient,
} from "./fixtures.mjs";
import { startGameInput } from "./input-helpers.js";

test.describe("renderer Travel input", () => {
  test("stays open over game interaction and closes from every focus state", async () => {
    const fixture = await launchCachedClient("gw-travel-input-e2e-");
    try {
      const { page } = fixture;
      await startGameInput(page);
      await page.evaluate(async () => {
        document.getElementById("loading")?.classList.add("gone");
        const specifier = "./travel-palette.js";
        const module = await import(specifier) as
          typeof import("../../src/renderer/travel-palette.js");
        const palette = module.createTravelPalette(document.body, {
          travel: () => undefined,
          unavailable: () => null,
        });
        palette.setEnabled(true);
      });

      const canvas = page.locator("#canvas");
      const palette = page.getByRole("dialog", { name: "Travel" });
      const search = page.getByRole("combobox", { name: "Search destinations" });

      await page.evaluate(() => {
        window.dispatchEvent(new CustomEvent("gw:travel-toggle", {
          cancelable: true,
          detail: {},
        }));
      });
      await expect(palette).toBeVisible();
      await expect.poll(() => isDomActiveElement(search)).toBe(true);

      // Native modal work is above non-modal surfaces. The first Escape closes
      // Settings and restores Travel; the palette remains open underneath.
      await page.evaluate(() => {
        window.dispatchEvent(new CustomEvent("gw:settings", {
          detail: { pane: "controls" },
        }));
      });
      await expect(page.locator("#settings-dialog")).toHaveAttribute("open", "");
      await page.keyboard.press("Escape");
      await expect(page.locator("#settings-dialog")).not.toHaveAttribute("open", "");
      await expect(palette).toBeVisible();

      await canvas.click({ position: { x: 20, y: 300 } });
      await expect.poll(() => isDomActiveElement(canvas)).toBe(true);
      await expect(palette).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(palette).toBeHidden();
      await expect.poll(() => isDomActiveElement(canvas)).toBe(true);

      await page.evaluate(() => {
        window.dispatchEvent(new CustomEvent("gw:travel-toggle", {
          cancelable: true,
          detail: {},
        }));
      });
      await expect.poll(() => isDomActiveElement(search)).toBe(true);
      await canvas.click({ position: { x: 20, y: 300 } });
      await page.keyboard.press("Tab");
      await expect.poll(() => isDomActiveElement(search)).toBe(true);

      await page.getByRole("button", { name: "Close Travel" }).click();
      await expect(palette).toBeHidden();
      await expect.poll(() => isDomActiveElement(canvas)).toBe(true);
    } finally {
      await closeOffline(fixture);
    }
  });
});
