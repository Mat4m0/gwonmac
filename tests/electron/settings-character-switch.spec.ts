import { expect, test } from "@playwright/test";
import { closeOffline, launchOffline } from "./fixtures.mjs";

test("Switch Character shortcut settings stay available without Tools", async () => {
  const fixture = await launchOffline("gw-settings-character-shortcut-e2e-");
  try {
    const { app, page } = fixture;
    await app.evaluate(({ Menu }) => {
      Menu.getApplicationMenu()
        ?.items[0]?.submenu?.items.find((item) => item.label === "Settings…")
        ?.click();
    });
    await page.locator("#settings-tab-controls").click();

    await expect(page.locator("#settings-tool-features")).toBeHidden();
    await expect(page.locator('[data-shortcut-action="character.switch"]'))
      .toContainText("⌘R");
    await expect(page.locator("#settings-shortcuts-restore")).toBeVisible();
  } finally {
    await closeOffline(fixture);
  }
});
