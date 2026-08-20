import { expect, test, type Page } from "@playwright/test";

async function openBuild(page: Page, name = /Word of Healing/) {
  await page.getByRole("tab", { name: /Builds/ }).click();
  await page.locator(".library-row").filter({ hasText: name }).first().click();
  await expect(page.locator("#build-name")).toBeVisible();
}

async function chooseSkill(page: Page, slot: number, name: string) {
  await page.getByRole("tab", { name: "Skill catalogue", exact: true }).click();
  await page.locator(".authoring-bar .skill").nth(slot).click();
  await page.getByRole("searchbox", { name: "Search skills" }).fill(name);
  await page.locator(".skill-result").filter({ hasText: name }).first().click();
  await page.getByRole("button", { name: new RegExp(`Use in slot ${slot + 1}`) }).click();
}

async function pointerDrag(
  page: Page,
  source: ReturnType<Page["locator"]>,
  target: ReturnType<Page["locator"]>,
  targetX = 0.5,
  during?: () => Promise<void>,
  over?: () => Promise<void>,
) {
  await source.scrollIntoViewIfNeeded();
  const from = await source.boundingBox();
  const to = await target.boundingBox();
  if (!from || !to) throw new Error("Drag endpoints must be visible");
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(from.x + from.width / 2 + 8, from.y + from.height / 2, {
    steps: 2,
  });
  await page.waitForTimeout(40);
  await during?.();
  await page.mouse.move(to.x + to.width * targetX, to.y + to.height / 2, { steps: 12 });
  await page.waitForTimeout(40);
  await over?.();
  await page.mouse.up();
}

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("#app[data-ready=true]")).toBeAttached();
});

test("offers destination autocomplete and numbered Travel shortcuts", async ({ page }) => {
  await page.goto("/?travel=1");
  const palette = page.getByRole("dialog", { name: "Quick Travel" });
  await expect(palette).toBeVisible();
  await expect(palette.locator('label[for="travel-search-input"] > span')).toHaveCount(0);
  await expect(palette.getByRole("status")).toHaveCount(0);
  await expect.poll(async () => (await palette.boundingBox())?.y).toBeGreaterThanOrEqual(95);
  await page.getByRole("combobox", { name: "Destination or search phrase" }).fill("kama");
  await expect(page.getByRole("option", { name: /Kamadan, Jewel of Istan/ })).toBeVisible();
  await page.keyboard.press("Meta+9");
  await expect(page.getByRole("status")).toContainText("shortcut 9");
  await page.getByRole("combobox", { name: "Destination or search phrase" }).fill("");
  await expect(page.getByRole("button", {
    name: /Travel to Kamadan, Jewel of Istan, shortcut 9/,
  })).toBeVisible();
});

test("keeps map-only Travel controls and status visible in a short window", async ({ page }) => {
  await page.setViewportSize({ width: 480, height: 560 });
  await page.goto("/?travel=1");

  await expect(page.getByRole("dialog", { name: "Quick Travel" })).toBeVisible();
  await expect(page.locator(".travel-footer")).toBeInViewport();
  await expect(page.getByRole("combobox", {
    name: "Destination or search phrase",
  })).toBeInViewport();
  await expect(page.getByRole("spinbutton", { name: "District number" })).toHaveCount(0);
  await expect(page.getByRole("tab", { name: "Customize" })).toBeVisible();
  const grid = page.locator(".travel-favorite-grid");
  await expect(grid.locator(".travel-favorite")).toHaveCount(6);
  await expect.poll(() => grid.evaluate((element) =>
    getComputedStyle(element).gridTemplateColumns.split(" ").length
  )).toBe(3);

  await page.getByRole("tab", { name: "Customize" }).click();
  await expect(page.locator(".travel-customize-shortcuts .travel-favorite")).toHaveCount(9);
});

test("manages teams and finds builds without Electron or the game", async ({ page }) => {
  await expect(page.getByRole("heading", { name: "GWonMac Tools" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Team composition" })).toBeVisible();
  await expect(page.locator(".team-slots > li")).toHaveCount(8);

  await page.getByRole("tab", { name: /Builds/ }).click();
  await page.getByRole("searchbox", { name: "Search library" }).fill("Barrage");
  await expect(page.locator(".library-row").filter({ hasText: /Splinter Barrage/ })).toHaveCount(1);
  await page.locator(".library-row").filter({ hasText: /Splinter Barrage/ }).click();
  await expect(page.locator(".authoring-bar .skill")).toHaveCount(8);
});

test("collapses party capture without hiding library navigation", async ({ page }) => {
  const party = page.locator(".live-party");
  await expect(party).toHaveAttribute("open", "");
  await expect(page.getByRole("button", { name: "Save as new team" })).toBeVisible();

  await party.locator("summary").click();
  await expect(party).not.toHaveAttribute("open", "");
  await expect(page.getByRole("button", { name: "Save as new team" })).toBeHidden();
  await expect(page.getByRole("tab", { name: /Teams/ })).toBeVisible();
  await expect(page.getByRole("searchbox", { name: "Search library" })).toBeVisible();
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

test("places catalogue skills and reorders slots by pointer and keyboard", async ({ page }) => {
  test.setTimeout(40_000);
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await openBuild(page);
  const slots = page.locator(".authoring-bar .skill");
  const firstTitle = await slots.nth(0).getAttribute("title");
  const secondTitle = await slots.nth(1).getAttribute("title");
  const dragged = await slots.nth(0).elementHandle();
  if (!dragged) throw new Error("The first skill slot must exist");

  await pointerDrag(page, slots.nth(0), slots.nth(2), 0.75, undefined, async () => {
    expect(await dragged.evaluate((element) => ({
      connected: element.isConnected,
      parent: element.parentElement?.classList.contains("skill-bar") ?? false,
    }))).toEqual({ connected: true, parent: true });
  });
  await expect(slots.nth(0)).toHaveAttribute("title", secondTitle!);
  await expect(slots.nth(2)).toHaveAttribute("title", firstTitle!);
  await expect(page.getByText("Skill moved from slot 1 to slot 3.")).toBeAttached();

  await slots.nth(2).focus();
  await page.keyboard.press("Meta+ArrowLeft");
  await expect(slots.nth(1)).toHaveAttribute("title", firstTitle!);
  await expect(page.getByText("Skill moved from slot 3 to slot 2.")).toBeAttached();

  await slots.nth(7).focus();
  await page.keyboard.press("Delete");
  await expect(slots.nth(7)).toHaveAttribute("title", "Empty skill slot");
  await pointerDrag(page, slots.nth(1), slots.nth(7), 0.9);
  await expect(slots.nth(7)).toHaveAttribute("title", firstTitle!);
  await expect(page.getByText("Skill moved from slot 2 to slot 8.")).toBeAttached();

  await slots.nth(7).click();
  await page.getByRole("searchbox", { name: "Search skills" }).fill("Infuse Health");
  const result = page.locator(".skill-result").filter({ hasText: "Infuse Health" }).first();
  await expect(result).toBeEnabled();
  await pointerDrag(
    page,
    result.locator(".catalogue-drag-handle"),
    slots.nth(7),
    0.25,
    async () => {
      await expect(result.locator(".catalogue-drag-handle")).toHaveAttribute(
        "data-pointer-dragging",
        "",
      );
      await expect(page.locator(".authoring-bar")).toHaveClass(/skill-bar--receiving/);
      const preview = await page.locator(".catalogue-pointer-preview").boundingBox();
      expect(preview).not.toBeNull();
      expect(preview?.width).toBeLessThanOrEqual(220);
      expect(preview?.height).toBe(52);
    },
    async () => {
      await expect(slots.nth(7).locator(".skill-drop-label")).toHaveText("Place in 8");
      await expect(page.locator(".catalogue-pointer-copy small")).toHaveText("Place in 8");
    },
  );
  await expect(slots.nth(7)).toHaveAttribute("title", "Infuse Health");
  await expect(page.getByText("Infuse Health placed in slot 8.")).toBeAttached();

  await expect(result).toHaveAttribute("aria-disabled", "true");
  await result.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByText("Infuse Health is already used in slot 8.")).toBeVisible();

  await page.getByRole("searchbox", { name: "Search skills" }).fill("Cry of Frustration");
  const elite = page.locator(".skill-result").filter({ hasText: "Cry of Frustration" }).first();
  await pointerDrag(
    page,
    elite.locator(".catalogue-drag-handle"),
    slots.nth(6),
    0.5,
    undefined,
    async () => {
      await expect(slots.nth(6).locator(".skill-drop-label")).toHaveText("Replace elite in 7");
      await expect(slots.nth(0)).toHaveAttribute("data-drop-affected", "");
    },
  );
  await expect(slots.nth(6)).toHaveAttribute("title", "Cry of Frustration");
  await expect(slots.nth(0)).toHaveAttribute("title", "Empty skill slot");
  await expect(page.getByText(/replacing Word of Healing in slot 1/)).toBeVisible();
  expect(pageErrors).toEqual([]);
});

test("keeps catalogue choices across builds and reloads", async ({ page }) => {
  await openBuild(page);
  await page.locator(".authoring-bar .skill").first().click();
  await page.locator(".catalogue-placeable").click();
  await page.locator(".catalogue-unlocked").click();

  await page.locator(".library-row").nth(1).click();
  await page.locator(".authoring-bar .skill").first().click();
  await expect(page.locator(".catalogue-placeable")).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".catalogue-unlocked")).toHaveAttribute("aria-pressed", "true");

  await page.reload();
  await openBuild(page);
  await page.locator(".authoring-bar .skill").first().click();
  await expect(page.locator(".catalogue-placeable")).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".catalogue-unlocked")).toHaveAttribute("aria-pressed", "true");
});

test("exports build and team codes without hiding the manual fallback", async ({ page }) => {
  await openBuild(page);
  await page.getByRole("button", { name: "Export build" }).click();
  const buildCode = page.locator(".build-export textarea");
  await expect(buildCode).toHaveValue(/^O/u);
  await expect(page.getByRole("button", { name: "Copy code" })).toBeVisible();
  await page.getByRole("button", { name: "Done" }).click();

  await page.getByRole("tab", { name: /Teams/ }).click();
  await page.locator(".library-row").first().click();
  await page.getByRole("button", { name: "Export team" }).click();
  const teamCode = page.locator(".share-team textarea");
  await expect(teamCode).toHaveValue(/^gwonmac-team:/u);
  await expect(page.getByRole("button", { name: "Copy code" })).toBeVisible();
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
  await page.getByRole("tab", { name: /Builds/ }).click();
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
  await page.getByRole("tab", { name: "Skill catalogue", exact: true }).click();
  const origin = page.locator(".authoring-bar .skill").nth(0);
  await origin.focus();
  await origin.press("Enter");
  await expect(page.getByRole("heading", { name: "Choose skill 1" })).toBeVisible();
  await page.getByRole("button", { name: "Elite", exact: true }).click();
  await page.getByRole("button", { name: "Show placeable skills only" }).click();
  await expect(page.getByRole("button", { name: "Show placeable skills only" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await page.getByRole("button", { name: "Show unlocked skills only" }).click();
  await expect(page.getByRole("button", { name: "Show unlocked skills only" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(page.locator(".skill-result")).not.toHaveCount(0);
  await expect(page.locator(".skill-result .ui-chip").filter({ hasText: "Elite" }).first()).toBeVisible();
  await page.getByRole("searchbox", { name: "Search skills" }).fill("Cry of Frustration");
  await page.locator(".skill-result").first().click();
  await expect(page.getByText("Recharge", { exact: true })).toBeVisible();
  await expect(page.locator(".skill-description")).toContainText(
    "Cry of Frustration demonstrates the client-owned skill description",
  );
  await expect(page.getByText(/This replaces .* in slot/)).toBeVisible();
  await page.getByRole("button", { name: "Replace elite in slot 1" }).click();
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

test("configures a fresh team and explains why Apply is waiting", async ({ page }) => {
  await page.getByRole("button", { name: "New team", exact: true }).click();
  await page.getByLabel("Name optional").fill("Me and Koss");
  await page.getByRole("button", { name: "Create team" }).click();

  const player = page.locator(".team-slots > li").nth(0);
  const hero = page.locator(".team-slots > li").nth(1);
  await expect(page.locator(".team-slots > li")).toHaveCount(8);
  await expect(page.locator(".team-slot--compact")).toHaveCount(7);
  await expect(hero.getByText("Available slot")).toBeVisible();
  await player.locator(".build-picker select").selectOption("b-barrage");
  await hero.locator(".hero-picker select").selectOption("6");
  await expect(page.locator(".team-slot--compact")).toHaveCount(6);
  await hero.locator(".build-picker select").selectOption("b-discord");
  await hero.locator(".behavior-picker select").selectOption("guard");

  await expect(player.locator(".build-picker select")).toHaveValue("b-barrage");
  await expect(hero.locator(".hero-picker select")).toHaveValue("6");
  await expect(hero.locator(".build-picker select")).toHaveValue("b-discord");
  await expect(page.getByRole("button", { name: "Apply team" })).toBeDisabled();
  const readiness = page.locator("#apply-readiness");
  await expect(readiness.getByRole("heading", { name: "Before you can apply" })).toBeVisible();
  await expect(readiness.getByText(/complete party roster/i)).toBeVisible();
});

for (const width of [320, 360, 640]) {
  test(`keeps authoring reachable at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 700 });
    await page.getByRole("tab", { name: /Builds/ }).click();
    await page.locator(".library-row").filter({ hasText: /Word of Healing/ }).first().click();
    await expect(page.getByRole("button", { name: "Library" })).toBeVisible();
    await expect(page.locator(".authoring-bar .skill")).toHaveCount(8);
    await expect(page.locator("body")).toHaveJSProperty("scrollWidth", width);
    await expect(page.getByRole("button", { name: "Export build" })).toBeVisible();
  });
}

test("keeps bar and commit actions reachable at short height", async ({ page }) => {
  await page.setViewportSize({ width: 1000, height: 420 });
  await openBuild(page);
  await expect(page.locator(".authoring-bar")).toBeVisible();
  await expect(page.getByRole("button", { name: "Save changes" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Export build" })).toBeVisible();
});

test("Escape cancels skill movement before it closes the catalogue", async ({ page }) => {
  await openBuild(page);
  const first = page.locator(".authoring-bar .skill").first();
  const firstTitle = await first.getAttribute("title");
  const firstBox = await first.boundingBox();
  if (!firstBox) throw new Error("Skill slot must be visible");
  await page.mouse.move(firstBox.x + firstBox.width / 2, firstBox.y + firstBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(firstBox.x + firstBox.width + 12, firstBox.y + firstBox.height / 2, {
    steps: 3,
  });
  await expect(page.locator(".skill-reorder-preview")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator(".skill-reorder-preview")).not.toBeAttached();
  await expect(first).toHaveAttribute("title", firstTitle!);
  await page.mouse.up();

  const origin = page.locator(".authoring-bar .skill").nth(7);
  await origin.click();
  await page.getByRole("searchbox", { name: "Search skills" }).fill("Infuse Health");
  const handle = page.locator(".skill-result .catalogue-drag-handle").first();
  await handle.scrollIntoViewIfNeeded();
  const from = await handle.boundingBox();
  if (!from) throw new Error("Drag handle must be visible");
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(from.x + from.width / 2 + 10, from.y + from.height / 2, { steps: 3 });
  await expect(page.locator(".catalogue-pointer-preview")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator(".catalogue-pointer-preview")).not.toBeAttached();
  await expect(page.getByRole("heading", { name: "Choose skill 8" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator(".catalogue-workspace")).not.toBeAttached();
  await expect(origin).toBeFocused();
  await page.mouse.up();
});

for (const [width, height, minimumResultsHeight] of [
  [320, 800, 70],
  [360, 800, 75],
  [640, 900, 250],
  [1024, 420, 100],
  [1280, 720, 100],
] as const) {
  test(`gives the catalogue one unobscured scroll surface at ${width}x${height}`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await openBuild(page);
    await page.locator(".authoring-bar .skill").first().click();
    await expect(page.locator(".authoring-bar .skill")).toHaveCount(8);
    await expect(page.getByRole("button", { name: "Done" })).toBeVisible();

    const geometry = await page.evaluate(() => {
      const rect = (selector: string) => {
        const element = document.querySelector<HTMLElement>(selector);
        if (!element) throw new Error(`Missing ${selector}`);
        const bounds = element.getBoundingClientRect();
        return {
          top: bounds.top,
          bottom: bounds.bottom,
          clientHeight: element.clientHeight,
          scrollHeight: element.scrollHeight,
          clientWidth: element.clientWidth,
          scrollWidth: element.scrollWidth,
        };
      };
      return {
        outer: rect(".authoring-scroll"),
        rail: rect(".authoring-bar-section"),
        bar: rect(".authoring-bar"),
        catalogue: rect(".catalogue-workspace"),
        tools: rect(".catalogue-tools"),
        results: rect(".skill-results"),
      };
    });
    expect(geometry.outer.scrollHeight).toBeLessThanOrEqual(geometry.outer.clientHeight);
    expect(geometry.bar.scrollWidth).toBeLessThanOrEqual(geometry.bar.clientWidth);
    expect(Math.abs(geometry.catalogue.top - geometry.rail.bottom)).toBeLessThanOrEqual(1);
    expect(geometry.tools.bottom).toBeLessThanOrEqual(geometry.results.top + 1);
    expect(geometry.results.clientHeight).toBeGreaterThanOrEqual(minimumResultsHeight);
    expect(await page.locator("body").evaluate((body) => body.scrollWidth)).toBe(width);
    expect(await page.locator(".skill-group-heading").first().evaluate((heading) => {
      const color = getComputedStyle(heading).backgroundColor;
      return !color.startsWith("rgba(") && !color.includes(" / ");
    })).toBe(true);

    if (height <= 520) {
      await expect(page.locator(".authoring-header")).toBeHidden();
      await expect(page.locator(".authoring-actions")).toBeHidden();
      await page.getByRole("searchbox", { name: "Search skills" }).fill("Infuse Health");
      await page.locator(".skill-result").first().click();
      await page.getByRole("button", { name: /Use in slot 1/ }).click();
      await page.getByRole("button", { name: "Done" }).click();
      await expect(page.locator(".authoring-header")).toBeVisible();
      await expect(page.getByRole("button", { name: "Save changes" })).toBeVisible();
      await expect(page.getByText("Unsaved draft")).toBeVisible();
    }
  });
}

for (const [width, height] of [
  [320, 800], [360, 800], [640, 900], [1024, 420], [1180, 760],
] as const) {
  test(`keeps team composition and Apply trustworthy at ${width}x${height}`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    if (width <= 640) await page.locator(".library-row").first().click();

    await expect(page.locator(".team-slots > li")).toHaveCount(8);
    await expect(page.locator("#apply-feedback")).toBeVisible();
    await expect(page.getByRole("button", { name: "Apply team" })).toBeVisible();
    const geometry = await page.locator(".team-scroll").evaluate((element) => ({
      clientWidth: element.clientWidth,
      scrollWidth: element.scrollWidth,
    }));
    expect(geometry.scrollWidth).toBeLessThanOrEqual(geometry.clientWidth);
    if (height === 420) expect(await page.locator(".team-scroll").evaluate(
      (element) => element.clientHeight,
    )).toBeGreaterThanOrEqual(100);

    const invalid = page.locator(".team-slots > li[data-invalid]").first();
    await invalid.scrollIntoViewIfNeeded();
    await expect(invalid.locator(".assignment-error")).toBeVisible();
  });
}

test("aligns team header controls and configured row controls", async ({ page }) => {
  const top = async (selector: string) => page.locator(selector).first().evaluate(
    (element) => element.getBoundingClientRect().top,
  );
  const bottom = async (selector: string) => page.locator(selector).first().evaluate(
    (element) => element.getBoundingClientRect().bottom,
  );
  const closeTo = (left: number, right: number) => expect(Math.abs(left - right)).toBeLessThanOrEqual(1);

  closeTo(await top("#team-name"), await top(".detail-header-actions .ui-button"));
  closeTo(await bottom(".team-mode .ui-segment"), await bottom(".team-controls .tag-entry input"));

  const hero = page.locator(".team-slots > li").nth(1);
  const controlTops = await hero.locator(".hero-picker select, .build-picker select, .behavior-picker select")
    .evaluateAll((elements) => elements.map((element) => element.getBoundingClientRect().top));
  expect(Math.max(...controlTops) - Math.min(...controlTops)).toBeLessThanOrEqual(1);
});

test("reorders team members with keyboard and pointer drag, then removes and undoes", async ({ page }) => {
  const selectedHeroes = () => page.locator(".hero-picker select").evaluateAll(
    (selects) => selects.map((select) => (select as HTMLSelectElement).value).filter(Boolean),
  );
  const before = await selectedHeroes();
  expect(before.length).toBeGreaterThanOrEqual(3);

  await page.locator("#team-move-2").focus();
  await page.keyboard.press("Home");
  const reordered = [before[1], before[0], ...before.slice(2)];
  await expect.poll(selectedHeroes).toEqual(reordered);
  await expect(page.locator("#team-move-1")).toBeFocused();

  const handle = await page.locator("#team-move-1").boundingBox();
  const destination = await page.locator('[data-team-slot="3"]').boundingBox();
  expect(handle).not.toBeNull();
  expect(destination).not.toBeNull();
  await page.mouse.move(handle!.x + handle!.width / 2, handle!.y + handle!.height / 2);
  await page.mouse.down();
  await page.mouse.move(handle!.x + handle!.width / 2 + 8, handle!.y + handle!.height / 2 + 8);
  await page.mouse.move(
    destination!.x + destination!.width / 2,
    destination!.y + destination!.height / 2,
    { steps: 4 },
  );
  await expect(page.locator('[data-team-slot="1"]')).toHaveClass(/team-slot--dragging/);
  await expect(page.locator('[data-team-slot="3"]')).toHaveClass(/team-slot--drop-target/);
  await expect(page.locator('[data-team-slot="3"]')).toHaveClass(/team-slot--drop-after/);
  await page.mouse.up();
  const pointerReordered = [reordered[1], reordered[2], reordered[0], ...reordered.slice(3)];
  await expect.poll(selectedHeroes).toEqual(pointerReordered);

  await page.locator(".team-remove-member").first().click();
  await expect.poll(selectedHeroes).toEqual(pointerReordered.slice(1));

  await page.locator(".library-summary .ui-link").click();
  await expect.poll(selectedHeroes).toEqual(pointerReordered);
});

test("projects Obsidian through the shared system without layout drift", async ({ page }) => {
  await page.evaluate(() => {
    document.documentElement.dataset.uiStyle = "obsidian";
    document.documentElement.dataset.uiFont = "inter";
    document.documentElement.style.setProperty("--ui-panel-opacity", "0.65");
  });
  await page.setViewportSize({ width: 360, height: 800 });
  await openBuild(page);

  const appearance = await page.evaluate(() => {
    const root = getComputedStyle(document.documentElement);
    const frame = document.querySelector<HTMLElement>(".tools-window");
    const primary = document.querySelector<HTMLElement>(
      '.ui-button[data-variant="primary"]',
    );
    if (!frame || !primary || !document.scrollingElement) {
      throw new Error("Obsidian fixture is incomplete");
    }
    return {
      borderWidth: root.getPropertyValue("--ui-border-width").trim(),
      textShadow: root.getPropertyValue("--ui-text-shadow").trim(),
      font: getComputedStyle(frame).fontFamily,
      primaryFill: getComputedStyle(primary).backgroundImage,
      overflow:
        document.scrollingElement.scrollWidth - document.scrollingElement.clientWidth,
    };
  });

  expect(appearance.borderWidth).toBe("0px");
  expect(appearance.textShadow).toBe("none");
  expect(appearance.font).toContain("ui-sans-serif");
  expect(appearance.primaryFill).not.toBe("none");
  expect(appearance.overflow).toBeLessThanOrEqual(1);
  await expect(page.locator(".authoring-bar .skill")).toHaveCount(8);
});

test("keeps critical team and skill feedback legible", async ({ page }) => {
  const contrast = async (selector: string) => page.locator(selector).first().evaluate((element) => {
    type Colour = [number, number, number, number];
    const parse = (value: string): Colour => {
      const values = value.match(/[\d.]+/gu)?.map(Number) ?? [];
      if (value.startsWith("oklch")) {
        const lightness = value.includes("%") ? (values[0] ?? 0) / 100 : values[0] ?? 0;
        const chroma = values[1] ?? 0;
        const hue = ((values[2] ?? 0) * Math.PI) / 180;
        const a = chroma * Math.cos(hue);
        const b = chroma * Math.sin(hue);
        const l = (lightness + 0.3963377774 * a + 0.2158037573 * b) ** 3;
        const m = (lightness - 0.1055613458 * a - 0.0638541728 * b) ** 3;
        const s = (lightness - 0.0894841775 * a - 1.291485548 * b) ** 3;
        const gamma = (channel: number) => {
          const linear = Math.max(0, Math.min(1, channel));
          return 255 * (linear <= 0.0031308
            ? 12.92 * linear
            : 1.055 * linear ** (1 / 2.4) - 0.055);
        };
        return [
          gamma(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
          gamma(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
          gamma(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
          values[3] ?? 1,
        ];
      }
      if (value.startsWith("color(srgb")) {
        return [
          (values[0] ?? 0) * 255,
          (values[1] ?? 0) * 255,
          (values[2] ?? 0) * 255,
          values[3] ?? 1,
        ];
      }
      return [values[0] ?? 0, values[1] ?? 0, values[2] ?? 0, values[3] ?? 1];
    };
    const over = (front: Colour, back: Colour): Colour => {
      const alpha = front[3] + back[3] * (1 - front[3]);
      if (alpha === 0) return [0, 0, 0, 0];
      return [
        (front[0] * front[3] + back[0] * back[3] * (1 - front[3])) / alpha,
        (front[1] * front[3] + back[1] * back[3] * (1 - front[3])) / alpha,
        (front[2] * front[3] + back[2] * back[3] * (1 - front[3])) / alpha,
        alpha,
      ];
    };
    let background: Colour = [0, 0, 0, 1];
    const layers: Colour[] = [];
    for (let node: Element | null = element; node; node = node.parentElement) {
      const layer = parse(getComputedStyle(node).backgroundColor);
      if (layer[3] > 0) layers.push(layer);
    }
    for (const layer of layers.reverse()) background = over(layer, background);
    const foreground = over(parse(getComputedStyle(element).color), background);
    const luminance = (colour: Colour) => {
      const channel = (value: number) => {
        const normalized = value / 255;
        return normalized <= 0.03928
          ? normalized / 12.92
          : ((normalized + 0.055) / 1.055) ** 2.4;
      };
      return 0.2126 * channel(colour[0])
        + 0.7152 * channel(colour[1])
        + 0.0722 * channel(colour[2]);
    };
    const light = luminance(foreground);
    const dark = luminance(background);
    return (Math.max(light, dark) + 0.05) / (Math.min(light, dark) + 0.05);
  });

  expect(await contrast(".apply-readiness strong")).toBeGreaterThanOrEqual(4.5);
  expect(await contrast(".apply-readiness p")).toBeGreaterThanOrEqual(4.5);
  expect(await contrast(".assignment-error")).toBeGreaterThanOrEqual(4.5);

  const apply = page.getByRole("button", { name: "Apply team" });
  await apply.focus();
  expect(await apply.evaluate((element) => getComputedStyle(element).boxShadow)).not.toBe("none");

  await openBuild(page);
  expect(await contrast(".authoring-bar .skill-fallback")).toBeGreaterThanOrEqual(4.5);
  await page.locator(".authoring-bar .skill").first().click();
  await page.getByRole("searchbox", { name: "Search skills" }).fill("Aegis");
  const unavailable = page.locator(".skill-result").first();
  await unavailable.focus();
  await page.keyboard.press("Enter");
  expect(await contrast(".bar-drag-status")).toBeGreaterThanOrEqual(4.5);
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
