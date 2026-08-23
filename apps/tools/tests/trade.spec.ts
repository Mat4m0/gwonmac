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
