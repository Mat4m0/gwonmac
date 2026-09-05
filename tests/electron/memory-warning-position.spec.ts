/** Verifies warning placement using pointer, keyboard, and durable settings. */
import { expect, test, type Page } from "@playwright/test";
import { closeOffline, launchPlayableClient } from "./fixtures.mjs";
import { startGameInput } from "./input-helpers.js";

type WarningModule = typeof import("../../src/renderer/memory-warning.js");

async function showWarning(page: Page) {
  await page.evaluate(async () => {
    document.getElementById("loading")?.classList.add("gone");
    const old = document.getElementById("memory-notice")!;
    old.replaceWith(old.cloneNode(true));
    const url: string = "gw://app/memory-warning.js";
    const { bindMemoryWarning } = await import(url) as WarningModule;
    const settings = await window.gwNative.settings.get();
    const warning = bindMemoryWarning(document, {
      position: settings.memoryWarningPosition,
      savePosition: async (memoryWarningPosition) => { await window.gwNative.settings.set({ memoryWarningPosition }); },
      autoRelogAfterReload: false,
      async saveAutoRelog() {},
      reload() {},
    });
    warning?.present("critical", 2_147_483_648);
    document.getElementById("canvas")?.focus();
  });
}

test("dragged and keyboard positions survive reload and stay in a smaller viewport", async () => {
  const fixture = await launchPlayableClient("gw-memory-position-");
  try {
    const { page } = fixture;
    await startGameInput(page);
    await showWarning(page);
    const warning = page.locator("#memory-notice");
    const heading = page.getByRole("button", { name: "Guild Wars is almost out of memory." });
    const before = (await warning.boundingBox())!;
    const handle = (await heading.boundingBox())!;
    await page.mouse.move(handle.x + 20, handle.y + 10);
    await page.mouse.down();
    await page.mouse.move(handle.x + 70, handle.y + 150, { steps: 5 });
    await page.mouse.up();
    await expect.poll(async () => (await warning.boundingBox())!.y).toBeGreaterThan(before.y + 100);
    await expect.poll(() => page.evaluate(async () => (await window.gwNative.settings.get()).memoryWarningPosition)).not.toBeNull();
    await heading.focus();
    const dragged = (await warning.boundingBox())!;
    await heading.press("ArrowDown");
    await expect.poll(async () => (await warning.boundingBox())!.y).toBeCloseTo(dragged.y + 10, 0);
    const position = await page.evaluate(async () => (await window.gwNative.settings.get()).memoryWarningPosition);
    await page.reload();
    await startGameInput(page);
    await showWarning(page);
    expect(await page.evaluate(async () => (await window.gwNative.settings.get()).memoryWarningPosition)).toEqual(position);
    await expect.poll(async () => (await warning.boundingBox())!.y).toBeCloseTo(dragged.y + 10, 0);
    await page.setViewportSize({ width: 400, height: 300 });
    await page.locator("#memory-notice-details summary").click();
    await expect.poll(async () => {
      const box = (await warning.boundingBox())!;
      return box.y >= 7 && box.x >= 7 && box.y + box.height <= 293 && box.x + box.width <= 393;
    }).toBe(true);
    await page.getByRole("button", { name: "Later" }).click();
    await expect(warning).toBeHidden();
  } finally {
    await closeOffline(fixture);
  }
});
