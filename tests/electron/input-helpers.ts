import { expect } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";

/** Playwright reports no box for a node that is not rendered. */
export const boxOf = async (locator: Locator) => {
  const box = await locator.boundingBox();
  if (!box) throw new Error("the game canvas has no bounding box");
  return box;
};

export async function startGameInput(page: Page) {
  const canvas = page.locator("#canvas");
  const quickStart = page.locator("#data-choice-quick");
  await expect
    .poll(
      async () =>
        (await canvas.getAttribute("data-input-ready")) === "true" ||
        (await quickStart.isVisible()),
    )
    .toBe(true);
  if (await quickStart.isVisible()) await quickStart.click();
  await expect(canvas).toHaveAttribute("data-input-ready", "true");
}
