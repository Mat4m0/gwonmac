import { expect, test } from "@playwright/test";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import {
  closeOffline,
  isDomActiveElement,
  launchCachedClient,
} from "./fixtures.mjs";
import { startGameInput } from "./input-helpers.js";

test.describe("renderer Travel input", () => {
  test("opens from the certified one-shot chat request", async () => {
    const fixture = await launchCachedClient(
      "gw-travel-chat-e2e-",
      {},
      (userData) => writeFile(
        path.join(userData, "settings.json"),
        JSON.stringify({ gwonmacTools: true, travelPalette: true }),
      ),
    );
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
          state: {
            status: "ready",
            mapId: 133,
            characterKey: null,
            unlockedMapWords: Array.from({ length: 28 }, () => 0xffff_ffff),
          },
        });
        installation.poll();
      });

      await expect(page.getByRole("dialog", { name: "Quick Travel" })).toBeVisible();
    } finally {
      await closeOffline(fixture);
    }
  });

  test("is modal, dismisses without click-through, and shares transient ownership", async () => {
    const fixture = await launchCachedClient(
      "gw-travel-input-e2e-",
      {},
      (userData) => writeFile(
        path.join(userData, "settings.json"),
        JSON.stringify({ gwonmacTools: true, travelPalette: true }),
      ),
    );
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
      const palette = page.getByRole("dialog", { name: "Quick Travel" });
      const search = page.getByRole("combobox", {
        name: "Destination or search phrase",
      });
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
        gameCanvas.addEventListener("click", () => {
          const count = Number(document.body.dataset.travelGameClicks ?? "0");
          document.body.dataset.travelGameClicks = String(count + 1);
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
      await expect(search).toHaveAccessibleName("Destination or search phrase");
      await expect(palette.getByRole("listbox")).toHaveCount(0);
      await expect(palette.getByRole("heading", { name: "Favorites" })).toBeVisible();
      await expect(palette.locator(".travel-favorite-grid .travel-favorite")).toHaveCount(6);

      // Every shortcut that shows a GWonMac interface is a toggle. A second
      // Travel request closes the same palette and returns focus to the game.
      await page.evaluate(() => {
        window.dispatchEvent(new CustomEvent("gw:travel-toggle", {
          cancelable: true,
          detail: {},
        }));
      });
      await expect(palette).toBeHidden();
      await expect.poll(() => isDomActiveElement(canvas)).toBe(true);
      await page.evaluate(() => {
        window.dispatchEvent(new CustomEvent("gw:travel-toggle", {
          cancelable: true,
          detail: {},
        }));
      });
      await expect(palette).toBeVisible();

      // Top-level dialogs have one transient owner. Opening Settings dismisses
      // Travel instead of leaving one modal hidden behind another.
      await page.evaluate(() => {
        window.dispatchEvent(new CustomEvent("gw:settings", {
          detail: { pane: "controls" },
        }));
      });
      await expect(page.locator("#settings-dialog")).toHaveAttribute("open", "");
      await expect(palette).toBeHidden();
      await page.evaluate(() => {
        window.dispatchEvent(new CustomEvent("gw:travel-toggle", {
          cancelable: true,
          detail: {},
        }));
      });
      await expect(page.locator("#settings-dialog")).not.toHaveAttribute("open", "");
      await expect(palette).toBeVisible();
      await page.mouse.click(8, 8);
      await expect(palette).toBeHidden();
      await expect(page.locator("body")).not.toHaveAttribute(
        "data-travel-game-clicks",
        /.*/u,
      );
      await expect.poll(() => isDomActiveElement(canvas)).toBe(true);

      await page.evaluate(() => {
        window.dispatchEvent(new CustomEvent("gw:travel-toggle", {
          cancelable: true,
          detail: {},
        }));
      });
      await expect.poll(() => isDomActiveElement(search)).toBe(true);
      await page.keyboard.press("Tab");
      await expect.poll(() => page.evaluate(() =>
        document.querySelector("#travel-palette-root")?.contains(document.activeElement),
      )).toBe(true);

      await page.getByRole("button", { name: "Close Quick Travel" }).click();
      await expect(palette).toBeHidden();
      await expect.poll(() => isDomActiveElement(canvas)).toBe(true);

      // The shared owner closes the native modal even if a feature's local
      // dismissal callback fails to do so. Otherwise Chromium refuses to show
      // the replacement and leaves the previous interface blocking the game.
      await page.evaluate(() => {
        const stubborn = document.createElement("dialog");
        stubborn.id = "stubborn-transient-dialog";
        document.body.append(stubborn);
        window.gwSurfaces.registerDialog({
          root: stubborn,
          priority: 5,
          transient: true,
          dismiss: () => undefined,
          restoreFocus: () => document.getElementById("canvas"),
        }).show();
      });
      await expect(page.locator("#stubborn-transient-dialog")).toHaveAttribute("open", "");
      await page.evaluate(() => {
        window.dispatchEvent(new CustomEvent("gw:travel-toggle", {
          cancelable: true,
          detail: {},
        }));
      });
      await expect(page.locator("#stubborn-transient-dialog")).not.toHaveAttribute("open", "");
      await expect(palette).toBeVisible();
    } finally {
      await closeOffline(fixture);
    }
  });
});
