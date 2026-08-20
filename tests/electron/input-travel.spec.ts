import { expect, test } from "@playwright/test";
import {
  closeOffline,
  isDomActiveElement,
  launchCachedClient,
} from "./fixtures.mjs";
import { startGameInput } from "./input-helpers.js";

test.describe("renderer Travel input", () => {
  test("opens from the certified one-shot chat request", async () => {
    const fixture = await launchCachedClient("gw-travel-chat-e2e-");
    try {
      const { page } = fixture;
      await startGameInput(page);
      await page.evaluate(async () => {
        document.getElementById("loading")?.classList.add("gone");
        let toggle = 1;
        const specifier = "./enhancement-travel-installation.js";
        const { createTravelInstallation }:
          typeof import("../../src/renderer/enhancement-travel-installation.js") =
            await import(specifier);
        const installation = createTravelInstallation({
          enhancement_travel: () => 1,
          enhancement_configure_travel: () => 1,
          enhancement_take_travel_toggle: () => {
            const current = toggle;
            toggle = 0;
            return current;
          },
        }, true);
        if (installation === null) throw new Error("Travel did not install");
        installation.allocate(() => 128);
        installation.initialize();
        installation.mount(document.body);
        installation.update({
          enabled: true,
          playRegion: "pve",
          state: { status: "ready", mapId: 133 },
        });
      });

      await expect(page.getByRole("dialog", { name: "Travel" })).toBeVisible();
    } finally {
      await closeOffline(fixture);
    }
  });

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
        const gameCanvas = document.getElementById("canvas");
        if (!(gameCanvas instanceof HTMLCanvasElement)) {
          throw new Error("#canvas is missing");
        }
        document.body.dataset.travelCanvasBlurs = "0";
        gameCanvas.addEventListener("blur", () => {
          const count = Number(document.body.dataset.travelCanvasBlurs ?? "0");
          document.body.dataset.travelCanvasBlurs = String(count + 1);
        });
      });

      await page.evaluate(() => {
        window.dispatchEvent(new CustomEvent("gw:travel-toggle", {
          cancelable: true,
          detail: {},
        }));
      });
      await expect(palette).toBeVisible();
      await expect.poll(() => isDomActiveElement(search)).toBe(true);
      await expect(page.locator("body")).toHaveAttribute(
        "data-travel-canvas-blurs",
        "0",
      );
      await expect(search).toHaveAccessibleName("Search destinations");
      await expect(palette.getByRole("listbox")).toHaveCount(0);
      await expect(page.getByText("Start typing to search all 199 direct-travel destinations."))
        .toBeVisible();
      await expect(palette.locator(".travel-shortcut-tile")).toHaveCount(9);

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
