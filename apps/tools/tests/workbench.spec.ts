import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("#app[data-ready=true]")).toBeAttached();
});

test("manages teams and builds without Electron or the game", async ({ page }) => {
  await expect(page.getByRole("heading", { name: "GWonMac Tools" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Team composition" })).toBeVisible();
  await expect(page.locator(".team-slots > li")).toHaveCount(8);

  await page.getByRole("tab", { name: /Builds/ }).click();
  await page.getByPlaceholder("Search names, tags, heroes, skills").fill("Barrage");
  await expect(page.getByRole("option", { name: /Splinter Barrage/ })).toHaveCount(1);
  await page.getByRole("option", { name: /Splinter Barrage/ }).click();
  await expect(page.getByRole("heading", { name: "Skill bar" })).toBeVisible();
  await expect(page.locator(".bar-section .skill")).toHaveCount(8);
});

test("forks and rebinds through an explicit inline flow", async ({ page }) => {
  await page.getByRole("tab", { name: /Builds/ }).click();
  await page.getByRole("option", { name: /Word of Healing Mo/ }).first().click();
  await page.getByRole("button", { name: "Fork variant" }).click();
  await expect(page.getByRole("heading", { name: "Fork a linked variant" })).toBeVisible();
  await page.getByRole("checkbox", { name: /Classic Discordway/ }).check();
  await page.getByRole("button", { name: "Create variant" }).click();
  await expect(page.locator("#build-name")).toHaveValue(/variant/);
  await expect(page.getByRole("button", { name: /Undo/ }).first()).toBeEnabled();
});

test("reflows to list then detail at a narrow panel width", async ({ page }) => {
  await page.setViewportSize({ width: 520, height: 760 });
  await expect(page.locator(".library-pane")).toBeVisible();
  await page.getByRole("option", { name: /Balanced vanquish/ }).click();
  await expect(page.getByRole("button", { name: "Library" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Team composition" })).toBeVisible();
  await page.getByRole("button", { name: "Library" }).click();
  await expect(page.locator(".library-pane")).toBeVisible();
});

test("supports keyboard search and undo", async ({ page }) => {
  await page.keyboard.press("/");
  await expect(page.getByPlaceholder("Search names, tags, heroes, skills")).toBeFocused();
  await page.getByRole("tab", { name: /Builds/ }).click();
  await page.getByRole("option", { name: /Word of Healing Mo/ }).first().click();
  await page.locator("#build-name").fill("Field test monk");
  await page.locator("#build-name").press("Enter");
  await expect(page.locator("#build-name")).toHaveValue("Field test monk");
  await page.keyboard.press("Meta+z");
  await expect(page.locator("#build-name")).toHaveValue("Word of Healing");
});

test("imports a real template and composes it into a new team", async ({ page }) => {
  await page.getByRole("button", { name: "Import build" }).click();
  await page.getByLabel("Name optional").fill("Fresh monk");
  await page.getByLabel("Skill template code").fill("OwAU0Kn8Q4FgMjrUgtEA3TnA");
  await page.getByRole("button", { name: "Import build", exact: true }).last().click();
  await expect(page.locator("#build-name")).toHaveValue("Fresh monk");

  await page.getByRole("button", { name: "New team" }).click();
  await page.getByLabel("Name optional").fill("Fresh account");
  await page.getByRole("button", { name: "Create team" }).click();
  await expect(page.locator("#team-name")).toHaveValue("Fresh account");
  await page.locator(".team-slots .ui-select").first().selectOption({ label: "Fresh monk" });
  await expect(page.locator(".team-slots > li").first()).not.toHaveClass(/team-slot--empty/);
});

test("authors a dual-profession build from an empty bar", async ({ page }) => {
  await page.getByRole("button", { name: "Import build" }).click();
  await page.getByLabel("Name optional").fill("Sword and bow");
  await page.getByRole("button", { name: "Start blank" }).click();
  await expect(page.locator("#build-name")).toHaveValue("Sword and bow");

  await page.getByLabel("Secondary profession").selectOption("R");
  await page.getByLabel("Swordsmanship rank").selectOption("12");
  await page.getByLabel("Marksmanship rank").selectOption("12");
  await expect(page.locator(".attribute-budget strong")).toHaveText("6");
  await page.getByLabel("Strength rank").selectOption("3");
  await expect(page.locator(".attribute-budget strong")).toHaveText("0");
  await expect(page.getByLabel("Strength rank").locator("option[value='4']")).toHaveAttribute("disabled", "");
  await expect(page.getByLabel("Expertise rank")).toHaveCount(0);

  await page.locator(".bar-section .skill--editable").first().click();
  await expect(page.getByRole("heading", { name: "Choose skill 1" })).toBeVisible();
  await page.getByPlaceholder("Search skill or attribute").fill("Barrage");
  await page.locator(".skill-picker").getByRole("option", { name: /Barrage/ }).click();
  await expect(page.locator(".skill-list strong").first()).toHaveText("Barrage");
});

test("builds a useful handoff for a fresh account with one hero", async ({ page }) => {
  await page.getByRole("button", { name: "New team" }).click();
  await page.getByLabel("Name optional").fill("Me and Koss");
  await page.getByRole("button", { name: "Create team" }).click();

  const player = page.locator(".team-slots > li").nth(0);
  const hero = page.locator(".team-slots > li").nth(1);
  await player.locator(".build-picker select").selectOption({ label: "Splinter Barrage" });
  await hero.locator(".hero-picker select").selectOption({ label: "Koss" });
  await hero.locator(".build-picker select").selectOption({ label: "Discord Necro" });
  await hero.getByRole("button", { name: /Hero controls for Koss/ }).click();
  await hero.getByRole("checkbox", { name: /skill panel/ }).check();
  await hero.getByRole("button", { name: /1 Discord/ }).click();
  await expect(hero.getByRole("button", { name: /1 Discord/ })).toHaveAttribute("aria-pressed", "false");

  await page.getByRole("button", { name: "Prepare team handoff" }).click();
  await expect(page.locator(".handoff-sheet li")).toHaveCount(2);
  await expect(page.locator('.handoff-sheet li[data-status="saved"]')).toHaveCount(2);
  await expect(page.getByText("Nothing was applied automatically")).toBeVisible();
});

test("adapts a shared build without surprising its other teams", async ({ page }) => {
  await page.getByRole("tab", { name: /Builds/ }).click();
  await page.getByRole("option", { name: /Word of Healing Mo/ }).first().click();
  await page.getByRole("button", { name: "Adapt from code" }).click();
  await page.getByLabel("Replacement template code").fill("OwAU0Kn8Q4FgMjrUgtEA3TnA");
  await page.getByRole("button", { name: "Create adapted variant" }).click();

  await expect(page.locator("#build-name")).toHaveValue("Word of Healing — variant");
  await expect(page.getByText(/Variant of Word of Healing/)).toBeVisible();
  await expect(page.getByText("Skill 288", { exact: true }).first()).toBeVisible();
  await page.getByRole("button", { name: /Undo/ }).first().click();
  await expect(page.locator("#build-name")).toHaveValue("Word of Healing");
});
