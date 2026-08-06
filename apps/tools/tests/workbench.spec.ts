import { expect, test, type Page } from "@playwright/test";

async function openBuild(page: Page, name = /Word of Healing Mo/) {
  await page.getByRole("tab", { name: /Builds/ }).click();
  await page.getByRole("option", { name }).first().click();
  await expect(page.locator("#build-name")).toBeVisible();
}

async function chooseSkill(page: Page, slot: number, name: string) {
  await page.getByRole("tab", { name: "Skills", exact: true }).click();
  await page.locator(".authoring-bar .skill").nth(slot).click();
  await page.getByRole("searchbox", { name: "Search skills" }).fill(name);
  await page.locator(".skill-result").filter({ hasText: name }).first().click();
  await page.getByRole("button", { name: new RegExp(`Use in slot ${slot + 1}`) }).click();
}

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("#app[data-ready=true]")).toBeAttached();
});

test("manages teams and finds builds without Electron or the game", async ({ page }) => {
  await expect(page.getByRole("heading", { name: "GWonMac Tools" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Team composition" })).toBeVisible();
  await expect(page.locator(".team-slots > li")).toHaveCount(8);

  await page.getByRole("tab", { name: /Builds/ }).click();
  await page.getByRole("searchbox", { name: "Search library" }).fill("Barrage");
  await expect(page.getByRole("option", { name: /Splinter Barrage/ })).toHaveCount(1);
  await page.getByRole("option", { name: /Splinter Barrage/ }).click();
  await expect(page.locator(".authoring-bar .skill")).toHaveCount(8);
});

test("authors, commits, reloads, discards, and undoes one atomic draft", async ({ page }) => {
  await openBuild(page);
  await chooseSkill(page, 0, "Infuse Health");
  await page.locator("#build-name").fill("Field test monk");
  await expect(page.getByText("Unsaved draft")).toBeVisible();
  await page.getByRole("button", { name: "Save changes" }).click();
  await page.getByRole("button", { name: "Update all teams" }).click();
  await expect(page.locator("#build-name")).toHaveValue("Field test monk");

  await page.reload();
  await openBuild(page, /Field test monk/);
  await expect(page.locator(".authoring-bar .skill").first()).toHaveAttribute("title", "Infuse Health");
  await page.locator("#build-name").fill("Throw this away");
  await page.getByRole("button", { name: "Discard" }).click();
  await expect(page.locator("#build-name")).toHaveValue("Field test monk");
});

test("forks a shared edit, rebinds selected teams, and keeps one undo", async ({ page }) => {
  await openBuild(page);
  await chooseSkill(page, 0, "Infuse Health");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByRole("heading", { name: "This build is shared" })).toBeVisible();
  await page.getByRole("button", { name: "Fork selected" }).click();
  await expect(page.locator("#build-name")).toHaveValue(/variant/);
  await expect(page.locator(".authoring-bar .skill").first()).toHaveAttribute("title", "Infuse Health");
  await page.getByRole("tab", { name: "Details" }).click();
  await expect(page.getByText(/Variant of Word of Healing/)).toBeVisible();
  await page.getByRole("button", { name: /Undo/ }).first().click();
  await expect(page.locator("#build-name")).toHaveValue("Word of Healing");
});

test("allocates the nonlinear 200-point budget and excludes the secondary primary attribute", async ({ page }) => {
  await page.getByRole("button", { name: "Import build" }).click();
  await page.getByLabel("Name optional").fill("Sword and bow");
  await page.getByRole("button", { name: "Start blank" }).click();
  await page.getByLabel("Secondary profession").selectOption("R");

  for (let rank = 0; rank < 12; rank += 1) {
    await page.getByRole("button", { name: "Increase Strength" }).click();
    await page.getByRole("button", { name: "Increase Swordsmanship" }).click();
  }
  for (let rank = 0; rank < 3; rank += 1) {
    await page.getByRole("button", { name: "Increase Marksmanship" }).click();
  }

  await expect(page.getByText("200 invested")).toBeVisible();
  await expect(page.getByText("0 remaining · 200 total")).toBeVisible();
  await expect(page.getByRole("button", { name: "Increase Marksmanship" })).toBeDisabled();
  await expect(page.getByRole("group", { name: "Expertise rank" })).toHaveCount(0);
});

test("uses the inline catalogue for filters, mechanics, elite replacement, and keyboard return", async ({ page }) => {
  await openBuild(page);
  await page.getByRole("tab", { name: "Skills", exact: true }).click();
  const origin = page.locator(".authoring-bar .skill").nth(0);
  await origin.focus();
  await origin.press("Enter");
  await expect(page.getByRole("heading", { name: "Choose skill 1" })).toBeVisible();
  await page.getByRole("button", { name: "Elite", exact: true }).click();
  await expect(page.locator(".skill-result")).not.toHaveCount(0);
  await expect(page.locator(".skill-result .ui-chip").filter({ hasText: "Elite" }).first()).toBeVisible();
  await page.getByRole("searchbox", { name: "Search skills" }).fill("Cry of Frustration");
  await page.locator(".skill-result").first().click();
  await expect(page.getByText("Recharge", { exact: true })).toBeVisible();
  await expect(page.locator(".skill-description")).toContainText(
    "Cry of Frustration demonstrates the client-owned skill description",
  );
  await expect(page.getByText(/This replaces .* in slot/)).toBeVisible();
  await page.getByRole("button", { name: "Replace current elite" }).click();
  await expect(page.locator(".authoring-bar .skill").nth(0)).toHaveAttribute("title", "Cry of Frustration");
  await page.keyboard.press("Escape");
  await expect(origin).toBeFocused();
});

test("keeps imported conflicts visible and repairs a profession change", async ({ page }) => {
  await openBuild(page);
  await page.getByLabel("Primary profession").selectOption("W");
  await expect(page.getByText(/issues?/i).first()).toBeVisible();
  await expect(page.locator(".authoring-bar [data-invalid]")).not.toHaveCount(0);
  await expect(page.getByRole("button", { name: "Save changes" })).toBeDisabled();
  await page.getByRole("button", { name: "Review first issue" }).click();
  await expect(page.getByRole("heading", { name: /Choose skill/ })).toBeVisible();
});

test("applies a fresh account team with one hero", async ({ page }) => {
  await page.getByRole("button", { name: "New team" }).click();
  await page.getByLabel("Name optional").fill("Me and Koss");
  await page.getByRole("button", { name: "Create team" }).click();

  const player = page.locator(".team-slots > li").nth(0);
  const hero = page.locator(".team-slots > li").nth(1);
  await player.locator(".build-picker select").selectOption({ label: "Splinter Barrage" });
  await hero.locator(".hero-picker select").selectOption({ label: "Koss" });
  await hero.locator(".build-picker select").selectOption({ label: "Discord Necro" });
  await hero.getByRole("button", { name: /Hero controls for Koss/ }).click();
  await hero.getByRole("button", { name: /1 Discord/ }).click();

  await page.getByRole("button", { name: "Apply team" }).click();
  await expect(page.getByText(/Team applied/)).toBeVisible();
  await expect(
    page.getByText(
      /Applies the roster, difficulty, builds, behavior, and disabled skills/,
    ),
  ).toBeVisible();
});

for (const width of [320, 360, 640]) {
  test(`keeps authoring reachable at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 700 });
    await page.getByRole("tab", { name: /Builds/ }).click();
    await page.getByRole("option", { name: /Word of Healing Mo/ }).first().click();
    await expect(page.getByRole("button", { name: "Library" })).toBeVisible();
    await expect(page.locator(".authoring-bar .skill")).toHaveCount(8);
    await expect(page.locator("body")).toHaveJSProperty("scrollWidth", width);
    await expect(page.getByRole("button", { name: "Write skill template" })).toBeVisible();
  });
}

test("keeps bar and commit actions reachable at short height", async ({ page }) => {
  await page.setViewportSize({ width: 1000, height: 420 });
  await openBuild(page);
  await expect(page.locator(".authoring-bar")).toBeVisible();
  await expect(page.getByRole("button", { name: "Save changes" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Write skill template" })).toBeVisible();
});

test("preserves native text undo and protects dirty navigation", async ({ page }) => {
  await openBuild(page);
  await page.locator("#build-name").fill("Draft name");
  await page.locator("#build-name").press(process.platform === "darwin" ? "Meta+z" : "Control+z");
  await expect(page.locator("#build-name")).toHaveValue("Word of Healing");

  await page.locator("#build-name").fill("Still editing");
  await expect(page.getByText("Unsaved draft")).toBeVisible();
  await page.getByRole("tab", { name: /Teams/ }).click();
  await expect(page.getByRole("heading", { name: "Save this draft?" })).toBeVisible();
  await page.getByRole("button", { name: "Continue editing" }).click();
  await expect(page.locator("#build-name")).toHaveValue("Still editing");
});
