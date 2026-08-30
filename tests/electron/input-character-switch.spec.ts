/**
 * Exercises the adaptive Character Switch palette against the real renderer
 * surface and focus controller without invoking any native game action.
 */
import { expect, test } from "@playwright/test";
import {
  closeOffline,
  isDomActiveElement,
  launchCachedClient,
} from "./fixtures.mjs";
import { startGameInput } from "./input-helpers.js";

test("a 27-character account searches, scrolls, and keeps the ten-key default", async () => {
  const fixture = await launchCachedClient("gw-character-switch-e2e-");
  try {
    const { page } = fixture;
    await startGameInput(page);
    await page.evaluate(() => {
      document.getElementById("loading")?.classList.add("gone");
      const characters = Array.from({ length: 27 }, (_, index) => ({
        name: index === 26 ? "Rudolph Prime" : `Character ${String(index + 1).padStart(2, "0")}`,
        characterKey: (index + 1).toString(16).padStart(16, "0"),
        primaryProfession: index % 10 + 1,
        secondaryProfession: index % 3 === 0 ? 0 : (index + 4) % 10 + 1,
        characterType: "roleplaying" as const,
        campaign: 1,
        level: 20,
        mapId: index % 2 === 0 ? 55 : 999,
      }));
      window.gwCharacterSwitchHost?.attach({
        characters: {
          status: "ready",
          sequence: 8,
          selectedIndex: 0,
          characters,
        },
        action: { status: "idle" },
        usage: { formatVersion: 1, sequence: 0, entries: [] },
        request(_sequence, index) {
          document.body.dataset.characterSwitchRequest = String(index);
        },
        reset() {},
        diagnostics: () => ({ version: 1, stage: "test", lastCode: null }),
        subscribe: () => () => {},
      });
      window.dispatchEvent(new CustomEvent("gw:character-toggle", { cancelable: true }));
    });

    const dialog = page.getByRole("dialog", { name: "Switch Character" });
    const search = page.getByRole("combobox", { name: "Search characters" });
    const list = dialog.getByRole("listbox", { name: "Characters" });
    await expect(dialog).toBeVisible();
    await expect.poll(() => isDomActiveElement(search)).toBe(true);
    await expect(list.getByRole("option")).toHaveCount(10);

    await search.fill("Character");
    await expect(list.getByRole("option")).toHaveCount(26);
    await expect.poll(() => list.evaluate((node) => node.scrollHeight > node.clientHeight)).toBe(true);
    await search.press("1");
    await expect(page.locator("body")).not.toHaveAttribute("data-character-switch-request", /.*/u);

    await search.fill("rud");
    await expect(list.getByRole("option")).toHaveCount(1);
    await expect(list.getByRole("option")).toContainText("Rudolph Prime");
    await search.press("Escape");
    await expect(search).toHaveValue("");
    await expect(list.getByRole("option")).toHaveCount(10);

    await search.press("0");
    await expect(page.locator("body")).toHaveAttribute("data-character-switch-request", "9");
    await search.press("Tab");
    await expect.poll(() => page.evaluate(() =>
      document.activeElement?.getAttribute("role"))).toBe("option");
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect.poll(() => isDomActiveElement(page.locator("#canvas"))).toBe(true);
  } finally {
    await closeOffline(fixture);
  }
});
