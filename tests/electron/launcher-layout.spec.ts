/** Launcher chrome remains usable at the supported minimum size and 200% zoom. */
import { expect, test } from "@playwright/test";
import { closeOffline, launchOffline } from "./fixtures.mjs";

interface Rect {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
}

interface WindowSize {
  readonly width: number;
  readonly height: number;
  readonly zoom: number;
}

async function setLauncherSize(
  fixture: Awaited<ReturnType<typeof launchOffline>>,
  size: WindowSize,
): Promise<void> {
  await fixture.app.evaluate(({ BrowserWindow }, value) => {
    const launcher = BrowserWindow.getAllWindows().find((win) =>
      win.webContents.getURL().endsWith("launcher/index.html"));
    if (!launcher) throw new Error("launcher window is required");
    launcher.webContents.setZoomFactor(value.zoom);
    launcher.setSize(value.width, value.height);
  }, size);
  await fixture.page.evaluate(() => new Promise<void>((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  }));
}

async function expectCurrentContentFitsHorizontally(
  fixture: Awaited<ReturnType<typeof launchOffline>>,
): Promise<void> {
  const overflow = await fixture.page.evaluate(() => {
    const main = document.querySelector<HTMLElement>("main");
    const content = document.querySelector<HTMLElement>(".page, .settings-page, .home-panel, .hero-panel");
    if (!main || !content) throw new Error("launcher content is required");
    return {
      document: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      main: main.scrollWidth - main.clientWidth,
      content: content.scrollWidth - content.clientWidth,
    };
  });
  expect(overflow.document).toBeLessThanOrEqual(1);
  expect(overflow.main).toBeLessThanOrEqual(1);
  expect(overflow.content).toBeLessThanOrEqual(1);
}

async function expectNoHorizontalClipping(
  fixture: Awaited<ReturnType<typeof launchOffline>>,
): Promise<void> {
  await expectCurrentContentFitsHorizontally(fixture);

  const criticalControls = [
    fixture.page.getByRole("button", { name: "Settings" }),
    fixture.page.getByRole("button", { name: "Add account" }),
    fixture.page.locator(".account-card").first().getByRole("button", { name: "Edit" }),
    fixture.page.locator(".account-card").first().getByRole("button", { name: "Play" }),
    fixture.page.locator(".launchbar .launch"),
  ];
  for (const control of criticalControls) {
    await control.scrollIntoViewIfNeeded();
    await expect(control).toBeVisible();
    const box = await control.boundingBox();
    if (!box) throw new Error("critical launcher control has no layout box");
    const viewportWidth = await fixture.page.evaluate(() => window.innerWidth);
    expect(box.x).toBeGreaterThanOrEqual(-1);
    expect(box.x + box.width).toBeLessThanOrEqual(viewportWidth + 1);
  }
}

test("minimum window and 200% zoom keep primary launcher controls reachable", async () => {
  test.setTimeout(60_000);
  const fixture = await launchOffline("gw-launcher-layout-", {
    GW_TEST_RETURN_LAUNCHER: "1",
  });
  try {
    await fixture.page.getByRole("button", { name: "Continue" }).click();
    await fixture.page.getByRole("button", { name: "Not now" }).click();
    await fixture.page.getByRole("button", { name: "Skip" }).click();
    await fixture.page.getByRole("button", { name: "Accounts", exact: true }).click();
    await fixture.page.getByRole("button", { name: "Add account" }).click();
    const dialog = fixture.page.getByRole("dialog", { name: "Add account" });
    await dialog.getByRole("textbox", { name: "Name" }).fill("Storage account");
    await dialog.getByRole("button", { name: "Add account" }).click();
    await expect(fixture.page.getByRole("heading", { name: "Storage account" })).toBeVisible();

    for (const size of [
      { width: 1180, height: 760, zoom: 1 },
      { width: 1024, height: 640, zoom: 1 },
      { width: 900, height: 640, zoom: 1 },
      { width: 900, height: 640, zoom: 2 },
    ]) {
      await setLauncherSize(fixture, size);
      await expectNoHorizontalClipping(fixture);
    }

    const geometry = await fixture.page.evaluate(() => {
      const rect = (selector: string): Rect => {
        const value = document.querySelector<HTMLElement>(selector)?.getBoundingClientRect();
        if (!value) throw new Error(`${selector} is missing`);
        return { left: value.left, top: value.top, right: value.right, bottom: value.bottom };
      };
      return {
        width: window.innerWidth,
        height: window.innerHeight,
        titlebar: rect(".titlebar"),
        main: rect("main"),
        launchbar: rect(".launchbar"),
        picker: rect(".account-picker"),
        launch: rect(".launch"),
      };
    });
    for (const control of [geometry.titlebar, geometry.launchbar, geometry.picker, geometry.launch]) {
      expect(control.left).toBeGreaterThanOrEqual(-1);
      expect(control.right).toBeLessThanOrEqual(geometry.width + 1);
      expect(control.top).toBeGreaterThanOrEqual(-1);
      expect(control.bottom).toBeLessThanOrEqual(geometry.height + 1);
    }
    expect(geometry.main.bottom).toBeLessThanOrEqual(geometry.launchbar.top + 1);
    expect(geometry.main.bottom - geometry.main.top).toBeGreaterThanOrEqual(80);

    await fixture.page.getByRole("navigation", { name: "Main navigation" }).getByRole("button", { name: "Home", exact: true }).click();
    await expect(fixture.page.locator(".hero-panel h1")).toBeVisible();
    await expectCurrentContentFitsHorizontally(fixture);

    await fixture.page.getByRole("button", { name: "Known issues", exact: true }).click();
    await expect(fixture.page.getByRole("heading", { name: "Known issues" })).toBeVisible();
    await expectCurrentContentFitsHorizontally(fixture);
    await fixture.page.getByRole("button", { name: "Feedback", exact: true }).click();
    await expect(fixture.page.getByRole("heading", { name: "Tell us what happened" })).toBeVisible();
    await expectCurrentContentFitsHorizontally(fixture);

    await fixture.page.getByRole("button", { name: "Settings" }).click();
    for (const section of ["Updates", "Content", "Advanced", "Game settings", "Tools", "Maps", "Game files"]) {
      await fixture.page.getByRole("button", { name: section, exact: true }).click();
      await expect(fixture.page.getByRole("heading", { name: section, exact: true })).toBeVisible();
      await expectCurrentContentFitsHorizontally(fixture);
    }
  } finally {
    await closeOffline(fixture);
  }
});
