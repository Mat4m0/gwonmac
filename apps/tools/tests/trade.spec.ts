import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.goto("/?trade=1");
  await expect(page.locator("#app[data-ready=true]")).toBeAttached();
});

test("searches and inspects the Kamadan ledger", async ({ page }) => {
  const dialog = page.getByRole("dialog", { name: "Trade Chat" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("option")).toHaveCount(6);
  await dialog.getByRole("searchbox").fill("Polar Bear");
  await dialog.getByRole("button", { name: "Search", exact: true }).click();
  await expect(dialog.getByRole("option")).toHaveCount(1);
  await dialog.getByRole("option").click();
  await expect(dialog.getByText("Quiet Ember")).toHaveCount(2);
  await dialog.getByRole("button", { name: "Live feed" }).click();
  await expect(dialog.getByRole("option")).toHaveCount(6);
});

test("searches character names and returns to live when cleared", async ({ page }) => {
  const dialog = page.getByRole("dialog", { name: "Trade Chat" });
  const search = dialog.getByRole("searchbox", { name: "Search offers or character names" });
  await search.fill("Tyria Cartographer");
  await dialog.getByRole("button", { name: "Search", exact: true }).click();
  await expect(dialog.getByRole("option")).toHaveCount(1);
  await expect(dialog.getByRole("option")).toContainText("Tyria Cartographer");

  await search.fill("");
  await expect(dialog.getByText("Latest messages", { exact: true })).toBeVisible();
  await expect(dialog.getByRole("option").first()).toContainText("Tyria Cartographer");
});

test("keeps Pre-Searing separate and adapts to a narrow window", async ({ page }) => {
  await page.setViewportSize({ width: 600, height: 720 });
  const dialog = page.getByRole("dialog", { name: "Trade Chat" });
  await dialog.getByRole("button", { name: "Pre-Searing" }).click();
  await expect(dialog.getByRole("option").first()).toContainText("Vanguard Althea");
  await expect(dialog.getByText("Tyria Cartographer")).toHaveCount(0);
  await dialog.getByRole("option").first().click();
  await expect(dialog.getByRole("button", { name: "Back to offers" })).toBeVisible();
  await dialog.getByRole("button", { name: "Back to offers" }).click();
  await expect(dialog.getByRole("option").first()).toBeVisible();
});

test("filters selling and buying without relying on chip colour", async ({ page }) => {
  const dialog = page.getByRole("dialog", { name: "Trade Chat" });
  await dialog.getByRole("button", { name: "Buying" }).click();
  await expect(dialog.getByRole("option")).toHaveCount(2);
  await expect(dialog.getByText("WTB", { exact: true })).toHaveCount(2);
  await dialog.getByRole("button", { name: "Selling" }).click();
  await expect(dialog.getByRole("option")).toHaveCount(4);
  await expect(dialog.getByText("WTS", { exact: true })).toHaveCount(4);
});

test("saves offers and players in an anchored drawer", async ({ page }) => {
  const dialog = page.getByRole("dialog", { name: "Trade Chat" });
  const firstOffer = dialog.getByRole("option").first();
  await firstOffer.hover();
  await dialog.getByRole("button", { name: "Save offer from Tyria Cartographer" }).click();
  await dialog.getByRole("button", { name: "Follow Tyria Cartographer" }).click();
  await dialog.getByRole("button", { name: /Saved 2/ }).click();
  const drawer = dialog.getByRole("complementary", { name: "Saved trade items" });
  await expect(drawer).toContainText("Tyria Cartographer");
  await drawer.getByRole("button", { name: /Players 1/ }).click();
  await expect(drawer).toContainText("1 current offer");
  await drawer.getByRole("button", { name: "Close Saved" }).click();
  await expect(drawer).toHaveCount(0);
});
