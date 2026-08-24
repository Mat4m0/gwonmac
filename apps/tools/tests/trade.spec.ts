import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.goto("/?trade=1");
  await expect(page.locator("#app[data-ready=true]")).toBeAttached();
});

test("searches and inspects the Kamadan ledger", async ({ page }) => {
  const dialog = page.getByRole("dialog", { name: "Trade Chat" });
  await expect(dialog).toBeVisible();
  await expect(dialog.locator(".trade-row")).toHaveCount(7);
  await dialog.getByRole("searchbox").fill("Polar Bear");
  await dialog.getByRole("button", { name: "Search", exact: true }).click();
  await expect(dialog.locator(".trade-row")).toHaveCount(1);
  await dialog.locator(".offer-cell").click();
  await expect(dialog.getByText("Quiet Ember")).toHaveCount(2);
  await dialog.getByRole("button", { name: "Live feed" }).click();
  await expect(dialog.locator(".trade-row")).toHaveCount(7);
});

test("searches character names and returns to live when cleared", async ({ page }) => {
  const dialog = page.getByRole("dialog", { name: "Trade Chat" });
  const search = dialog.getByRole("searchbox", { name: "Search offers or character names" });
  await search.fill("Tyria Cartographer");
  await dialog.getByRole("button", { name: "Search", exact: true }).click();
  const rows = dialog.locator(".trade-row");
  await expect(rows).toHaveCount(2);
  await expect(rows.first()).toContainText("Tyria Cartographer");
  await expect(rows.first()).toContainText("WTS arms 29e each");
  await expect(rows.last()).toContainText("Earlier trade listing");

  await search.fill("");
  await expect(dialog.getByText("Latest messages", { exact: true })).toBeVisible();
  await expect(dialog.locator(".trade-row").first()).toContainText("Tyria Cartographer");
});

test("keeps Pre-Searing separate and adapts to a narrow window", async ({ page }) => {
  await page.setViewportSize({ width: 600, height: 720 });
  const dialog = page.getByRole("dialog", { name: "Trade Chat" });
  await dialog.getByRole("button", { name: "Pre-Searing" }).click();
  await expect(dialog.locator(".trade-row").first()).toContainText("Vanguard Althea");
  await expect(dialog.getByText("Tyria Cartographer")).toHaveCount(0);
  await dialog.locator(".offer-cell").first().click();
  await expect(dialog.getByRole("button", { name: "Back to offers" })).toBeVisible();
  await dialog.getByRole("button", { name: "Back to offers" }).click();
  await expect(dialog.locator(".trade-row").first()).toBeVisible();
});

test("opens a player's listings and returns to the prior results", async ({ page }) => {
  const dialog = page.getByRole("dialog", { name: "Trade Chat" });
  await dialog.getByRole("searchbox").fill("arms");
  await dialog.getByRole("button", { name: "Search", exact: true }).click();
  await expect(dialog.locator(".trade-row")).toHaveCount(1);

  await dialog.getByRole("list", { name: "Trade offers" })
    .getByRole("button", { name: "Show listings from Tyria Cartographer" }).click();
  await expect(dialog.locator(".trade-row")).toHaveCount(2);
  await expect(dialog.getByText("Earlier trade listing, now superseded")).toBeVisible();

  await dialog.getByRole("button", { name: "Back to results" }).click();
  await expect(dialog.locator(".trade-row")).toHaveCount(1);
  await expect(dialog.getByText("Results for “arms”", { exact: true })).toBeVisible();
});

test("reveals row actions without moving the ledger columns", async ({ page }) => {
  const dialog = page.getByRole("dialog", { name: "Trade Chat" });
  const row = dialog.locator(".trade-row").first();
  const character = row.locator(".character-cell");
  const message = row.locator(".offer-cell");
  const before = {
    character: await character.boundingBox(),
    message: await message.boundingBox(),
  };

  await row.hover();
  await expect(row.locator(".row-quick-actions")).toBeVisible();

  expect(await character.boundingBox()).toEqual(before.character);
  expect(await message.boundingBox()).toEqual(before.message);
});

test("browses trader prices, zooms history, and returns to the ledger", async ({ page }) => {
  const dialog = page.getByRole("dialog", { name: "Trade Chat" });
  const firstMessage = await dialog.locator(".offer-cell").first().textContent();

  await dialog.getByRole("button", { name: "Trader prices" }).click();
  await expect(dialog.getByRole("heading", { name: "Trader Prices" })).toBeVisible();
  await expect(dialog.getByRole("option", { name: /Glob of Ectoplasm/u })).toBeVisible();
  await expect(dialog.getByRole("option", { name: /Glob of Ectoplasm/u }).locator("img"))
    .not.toHaveAttribute("src", /kamadan\.gwtoolbox\.com/u);
  await expect(dialog.locator(".price-series-buy")).toBeVisible();
  await expect(dialog.locator(".price-series-sell")).toBeVisible();

  await dialog.getByRole("button", { name: "Zoom in" }).click();
  await expect(dialog.getByRole("button", { name: "Reset view" })).toBeVisible();
  await dialog.getByRole("button", { name: "Reset view" }).click();
  await expect(dialog.getByRole("button", { name: "Reset view" })).toHaveCount(0);

  await dialog.getByRole("button", { name: "Back to listings" }).click();
  await expect(dialog.getByRole("heading", { name: "Kamadan Trade" })).toBeVisible();
  await expect(dialog.locator(".offer-cell").first()).toHaveText(firstMessage ?? "");
});

test("filters selling and buying without relying on chip colour", async ({ page }) => {
  const dialog = page.getByRole("dialog", { name: "Trade Chat" });
  await dialog.getByRole("button", { name: "Buying" }).click();
  await expect(dialog.locator(".trade-row")).toHaveCount(2);
  await expect(dialog.getByText("WTB", { exact: true })).toHaveCount(2);
  await dialog.getByRole("button", { name: "Selling" }).click();
  await expect(dialog.locator(".trade-row")).toHaveCount(4);
  await expect(dialog.getByText("WTS", { exact: true })).toHaveCount(4);
});

test("saves offers and players in an anchored drawer", async ({ page }) => {
  const dialog = page.getByRole("dialog", { name: "Trade Chat" });
  const firstOffer = dialog.locator(".trade-row").first();
  const firstRow = firstOffer.locator("..");
  await firstOffer.hover();
  await firstRow.getByRole("button", { name: "Save offer from Tyria Cartographer" }).click();
  await firstRow.getByRole("button", { name: "Follow Tyria Cartographer" }).click();
  await dialog.getByRole("button", { name: /Saved 2/ }).click();
  const drawer = dialog.getByRole("complementary", { name: "Saved trade items" });
  await expect(drawer).toContainText("Tyria Cartographer");
  await drawer.getByRole("button", { name: /Players 1/ }).click();
  await expect(drawer).toContainText("2 current offers");
  await drawer.getByRole("button", { name: "Close Saved" }).click();
  await expect(drawer).toHaveCount(0);
});
