/** Settings, native shortcuts, and feature visibility agree through real IPC. */
import { writeFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import { closeOffline, launchOffline } from "./fixtures.mjs";

test("feature controls preserve preferences and validate native commands", async () => {
  const fixture = await launchOffline("gw-launcher-features-", { GW_TEST_RETURN_LAUNCHER: "1" });
  const page = fixture.page;
  try {
    await page.evaluate(async () => {
      await window.launcherNative.experience.completeSetup({ enableTools: false });
      await window.launcherNative.experience.completeIntroduction();
    });
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    await page.getByRole("button", { name: "Tools", exact: true }).click();
    await expect(page.getByRole("checkbox", { name: "Character Switch", exact: true })).toBeEnabled();
    await expect(page.getByRole("button", { name: "Maps", exact: true })).toHaveCount(1);
    await page.evaluate(() => window.launcherNative.tools.setFeature({ tool: "character-switch", enabled: false }));
    await expect.poll(() => page.evaluate(async () => (await window.launcherNative.state.get()).tools.features["character-switch"].enabled)).toBe(false);
    await page.evaluate(async () => {
      await window.launcherNative.tools.setFeature({ tool: "character-switch", enabled: true });
      await window.launcherNative.tools.replaceShortcut({ action: "character.switch", binding: { key: "j", shift: false, option: false } });
    });
    await expect(page.getByText("⌘J", { exact: true })).toBeVisible();
    await page.evaluate(() => window.launcherNative.tools.setMasterEnabled(true));
    await page.screenshot({ path: test.info().outputPath("tools-settings.png") });
    await page.getByRole("button", { name: "Maps", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Maps", exact: true })).toBeVisible();
    const shortcuts = await page.evaluate(async () => (await window.launcherNative.state.get()).shortcuts);
    expect(shortcuts["cartography.grid.toggle"]).toBeNull();
    expect(shortcuts["cartography.walkability.toggle"]).toBeNull();
    await page.getByRole("checkbox", { name: /Exploration grid/ }).check();
    await page.evaluate(() => window.launcherNative.tools.replaceShortcut({ action: "cartography.grid.toggle", binding: { key: "g", shift: false, option: false } }));
    await page.screenshot({ path: test.info().outputPath("maps-settings.png") });
    await page.evaluate(() => window.launcherNative.tools.setFeature({ tool: "maps", enabled: false }));
    await expect(page.getByRole("heading", { name: "Maps", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Maps", exact: true })).toHaveCount(1);
    const snapshot = await page.evaluate(() => window.launcherNative.state.get());
    expect(snapshot.settings.cartographyGridEnabled).toBe(true);
    expect(snapshot.shortcuts["cartography.grid.toggle"]?.key).toBe("g");
    for (const bad of [
      () => page.evaluate(() => window.launcherNative.tools.captureShortcut("unknown" as "travel.open")),
      () => page.evaluate(() => window.launcherNative.tools.replaceShortcut({ action: "travel.open", binding: { key: "q", shift: false, option: false } })),
      () => page.evaluate(() => window.launcherNative.settings.update({ skillKeyBindings: [] as never })),
    ]) await expect(bad()).rejects.toThrow();
  } finally { await closeOffline(fixture); }
});

test("the game menu follows saved Character Switch enablement and bindings", async () => {
  const fixture = await launchOffline("gw-feature-menu-");
  try {
    const launcher = fixture.app.windows().find(page => page.url().endsWith("launcher/index.html"));
    if (!launcher) throw new Error("launcher is required");
    const menu = () => fixture.app.evaluate(({ Menu }) => {
      const item = Menu.getApplicationMenu()?.getMenuItemById("switch-character");
      return item ? { enabled: item.enabled, accelerator: item.accelerator ?? null } : null;
    });
    await expect.poll(menu).toEqual({ enabled: true, accelerator: "Command+R" });
    await launcher.evaluate(async () => {
      await window.launcherNative.tools.setFeature({ tool: "character-switch", enabled: false });
      await window.launcherNative.tools.replaceShortcut({ action: "character.switch", binding: { key: "j", shift: false, option: false } });
    });
    await expect.poll(menu).toEqual({ enabled: false, accelerator: "Command+J" });
    await launcher.evaluate(async () => {
      await window.launcherNative.tools.setFeature({ tool: "character-switch", enabled: true });
      await window.launcherNative.tools.replaceShortcut({ action: "character.switch", binding: null });
    });
    await expect.poll(menu).toEqual({ enabled: true, accelerator: null });
  } finally { await closeOffline(fixture); }
});

test("existing custom map styles can be selected, edited and extended", async () => {
  const fixture = await launchOffline("gw-existing-map-styles-", { GW_TEST_RETURN_LAUNCHER: "1" });
  const page = fixture.page;
  try {
    await page.evaluate(async () => {
      await window.launcherNative.experience.completeSetup({ enableTools: false });
      await window.launcherNative.experience.completeIntroduction();
      await window.launcherNative.tools.setMasterEnabled(true);
    });
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    await page.getByRole("button", { name: "Maps", exact: true }).click();
    const compass = page.getByRole("checkbox", { name: /Grid on Compass/ });
    await expect(compass).not.toBeChecked();
    await expect(compass).toBeDisabled();
    await page.getByRole("checkbox", { name: /Exploration grid/ }).check();
    await compass.check();
    await compass.uncheck();
    await expect.poll(() => page.evaluate(async () => (await window.launcherNative.state.get()).settings)).toMatchObject({ cartographyGridEnabled: true, cartographyCompassGridEnabled: false });
    const thickness = page.getByRole("spinbutton", { name: "Terrain border thickness value" });
    await thickness.fill("4");
    await thickness.press("Tab");
    await expect.poll(() => page.evaluate(async () => (await window.launcherNative.state.get()).settings.cartographyPresetLibrary.customPresets[0]?.style.walkability.boundaryWidth)).toBe(4);
    await page.getByRole("button", { name: "Edit style" }).click();
    await expect(page.getByRole("textbox", { name: "Shaded area color hex" })).toBeVisible();
    await page.locator('select').filter({ has: page.locator('option[value="builtin:cartographer"]') }).selectOption("builtin:synthwave");
    await expect(page.getByRole("button", { name: "Customize style" })).toBeVisible();
    await page.getByRole("button", { name: "Customize style" }).click();
    await expect.poll(() => page.evaluate(async () => (await window.launcherNative.state.get()).settings.cartographyPresetLibrary.customPresets.length)).toBe(2);
    await page.getByRole("textbox", { name: "Shaded area color hex" }).fill("112233");
    await page.getByRole("textbox", { name: "Shaded area color hex" }).press("Tab");
    await expect.poll(() => page.evaluate(async () => (await window.launcherNative.state.get()).settings.cartographyPresetLibrary.customPresets[1]?.style.walkability.veilColor)).toBe("#112233");
    await page.reload();
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    await page.getByRole("button", { name: "Maps", exact: true }).click();
    await page.getByRole("button", { name: "Edit style" }).click();
    await page.getByRole("textbox", { name: "Terrain border color hex" }).fill("334455");
    await page.getByRole("textbox", { name: "Terrain border color hex" }).press("Tab");
    await expect.poll(() => page.evaluate(async () => (await window.launcherNative.state.get()).settings.cartographyPresetLibrary.customPresets[1]?.style.walkability.boundaryColor)).toBe("#334455");
    await expect(page.getByRole("spinbutton", { name: "Terrain border thickness value" })).toHaveValue("1");
    await page.getByRole("button", { name: "Done", exact: true }).click();
    await page.getByRole("heading", { name: "Maps", exact: true }).scrollIntoViewIfNeeded();
    await page.screenshot({ path: test.info().outputPath("map-controls.png") });
  } finally { await closeOffline(fixture); }
});

test("map styles offer usable color and numeric controls at normal size and 200% zoom", async () => {
  test.setTimeout(60_000);
  const fixture = await launchOffline("gw-settings-controls-", { GW_TEST_RETURN_LAUNCHER: "1" });
  const page = fixture.page;
  try {
    await page.evaluate(async () => {
      await window.launcherNative.experience.completeSetup({ enableTools: false });
      await window.launcherNative.experience.completeIntroduction();
      await window.launcherNative.tools.setMasterEnabled(true);
    });
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    await page.getByRole("button", { name: "Maps", exact: true }).click();
    await page.getByRole("button", { name: "Customize style" }).click();
    const hex = page.getByRole("textbox", { name: "Shaded area color hex" });
    await hex.fill("ABCDEF");
    await hex.press("Tab");
    await expect.poll(() => page.evaluate(async () =>
      (await window.launcherNative.state.get()).settings.cartographyPresetLibrary.customPresets[0]?.style.walkability.veilColor,
    )).toBe("#ABCDEF");
    await page.getByRole("spinbutton", { name: "Terrain border thickness value", exact: true }).fill("0");
    await page.getByRole("spinbutton", { name: "Terrain border thickness value", exact: true }).press("Tab");
    await expect.poll(() => page.evaluate(async () =>
      (await window.launcherNative.state.get()).settings.cartographyPresetLibrary.customPresets[0]?.style.walkability.boundaryWidth,
    )).toBe(0);

    await page.getByText("Advanced grid lines", { exact: true }).click();
    for (const size of [
      { width: 1180, height: 900, zoom: 1 },
      { width: 900, height: 700, zoom: 1 },
      { width: 900, height: 700, zoom: 2 },
    ]) {
      await fixture.app.evaluate(({ BrowserWindow }, value) => {
        const win = BrowserWindow.getAllWindows().find(win => win.webContents.getURL().endsWith("launcher/index.html"))!;
        win.webContents.setZoomFactor(value.zoom);
        win.setSize(value.width, value.height);
      }, size);
      await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
      await page.locator(".map-style-editor").scrollIntoViewIfNeeded();
      const controls = page.locator(".map-style-editor input, .map-style-editor select");
      for (const control of await controls.all()) {
        await control.scrollIntoViewIfNeeded();
        const box = await control.boundingBox();
        expect(box).not.toBeNull();
        // Desktop controls retain a 32px minimum target at every zoom level.
        expect(box!.width).toBeGreaterThanOrEqual(32);
        expect(box!.height).toBeGreaterThanOrEqual(32);
        expect(box!.x).toBeGreaterThanOrEqual(0);
        expect(box!.x + box!.width).toBeLessThanOrEqual(await page.evaluate(() => innerWidth));
        expect(await control.evaluate(el => el.hasAttribute("aria-label") || !!(el as HTMLInputElement).labels?.length)).toBe(true);
        expect(await control.evaluate(el => {
          const box = el.getBoundingClientRect();
          return document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2) === el;
        })).toBe(true);
      }
      const clipped = await page.locator(".map-style-editor").evaluate(el => el.scrollWidth > el.clientWidth + 1);
      expect(clipped).toBe(false);
      await hex.scrollIntoViewIfNeeded();
      // Electron's native capture preserves the window at non-default zoom.
      const capture = await fixture.app.evaluate(async ({ BrowserWindow }) => {
        const win = BrowserWindow.getAllWindows().find(win => win.webContents.getURL().endsWith("launcher/index.html"))!;
        return (await win.webContents.capturePage()).toPNG().toString("base64");
      });
      await writeFile(test.info().outputPath(`map-style-${size.width}-${size.zoom}x.png`), Buffer.from(capture, "base64"));
    }
    await fixture.app.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows().find(win => win.webContents.getURL().endsWith("launcher/index.html"))!;
      win.webContents.setZoomFactor(1);
      win.setSize(1180, 900);
    });
    await page.getByRole("button", { name: "Game settings", exact: true }).click();
    await page.getByRole("combobox", { name: "Panel style", exact: true }).selectOption("custom");
    await page.getByRole("textbox", { name: "Accent hex", exact: true }).fill("BBCCDD");
    await page.getByRole("textbox", { name: "Accent hex", exact: true }).press("Tab");
    await expect.poll(() => page.evaluate(async () => (await window.launcherNative.state.get()).settings.uiCustomTheme.accent)).toBe("#BBCCDD");
    await page.getByRole("combobox", { name: "Panel style", exact: true }).scrollIntoViewIfNeeded();
    await page.screenshot({ path: test.info().outputPath("panel-appearance.png") });
  } finally { await closeOffline(fixture); }
});
