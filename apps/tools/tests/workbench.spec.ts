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
  await page.mouse.up();
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
  await expect(page.locator(".library-row").filter({ hasText: /Splinter Barrage/ })).toHaveCount(1);
  await page.locator(".library-row").filter({ hasText: /Splinter Barrage/ }).click();
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

test("places catalogue skills and reorders slots by pointer and keyboard", async ({ page }) => {
  await openBuild(page);
  const slots = page.locator(".authoring-bar .skill");
  const firstTitle = await slots.nth(0).getAttribute("title");
  const secondTitle = await slots.nth(1).getAttribute("title");

  await pointerDrag(page, slots.nth(0), slots.nth(2), 0.75);
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
    },
  );
  await expect(slots.nth(7)).toHaveAttribute("title", "Infuse Health");
  await expect(page.getByText("Infuse Health placed in slot 8.")).toBeAttached();
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
  await expect(page.getByRole("heading", { name: "Before you can apply" })).toBeVisible();
  await expect(page.getByText(/complete party roster/i)).toBeVisible();
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

test("keeps critical team text and focus treatment legible", async ({ page }) => {
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
