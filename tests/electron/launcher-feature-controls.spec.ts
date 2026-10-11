/** Settings, native shortcuts, and feature visibility agree through real IPC. */
import { writeFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import { closeOffline, focusGameWindow, launchOffline, openSettings } from "./fixtures.mjs";

test("feature controls preserve preferences and validate native commands", async () => {
  const fixture = await launchOffline("gw-launcher-features-", { GW_TEST_RETURN_LAUNCHER: "1" });
  const page = fixture.page;
  try {
    await page.evaluate(async () => {
      await window.launcherNative.experience.completeSetup({ enableTools: false });
    });
    const settings = await openSettings(fixture);
    const nav = (name: string) => settings.locator(".settings-page aside").getByRole("button", { name, exact: true });
    await nav("Tools").click();
    await expect(settings.getByRole("checkbox", { name: "Switch Character", exact: true })).toBeEnabled();
    await expect(nav("Maps")).toHaveCount(1);
    await settings.evaluate(() => window.settingsNative.tools.setFeature({ tool: "character-switch", enabled: false }));
    await expect.poll(() => page.evaluate(async () => (await window.launcherNative.state.get()).tools.features["character-switch"].enabled)).toBe(false);
    await settings.evaluate(async () => {
      await window.settingsNative.tools.setFeature({ tool: "character-switch", enabled: true });
      await window.settingsNative.tools.replaceShortcut({ action: "character.switch", binding: { key: "j", shift: false, option: false } });
    });
    await expect(settings.getByText("⌘J", { exact: true })).toBeVisible();
    await settings.evaluate(() => window.settingsNative.tools.setMasterEnabled(true));
    const resign = settings.getByRole("checkbox", { name: "Resign", exact: true });
    await expect(resign).not.toBeChecked();
    await resign.check();
    await expect(resign).toBeChecked();
    await settings.evaluate(() => window.settingsNative.tools.replaceShortcut({ action: "game.resign", binding: { key: "j", shift: true, option: false } }));
    await expect(settings.getByRole("button", { name: "Change Resign shortcut", exact: true }).locator("kbd")).toHaveText(["⇧", "⌘", "J"]);
    await resign.uncheck();
    await expect(resign).not.toBeChecked();
    await settings.screenshot({ path: test.info().outputPath("tools-settings.png") });
    await nav("Maps").click();
    await expect(settings.getByRole("heading", { name: "Maps", exact: true })).toBeVisible();
    const shortcuts = await page.evaluate(async () => (await window.launcherNative.state.get()).shortcuts);
    expect(shortcuts["cartography.grid.toggle"]).toBeNull();
    expect(shortcuts["cartography.walkability.toggle"]).toBeNull();
    await settings.getByRole("checkbox", { name: /Exploration grid/ }).check();
    await settings.evaluate(() => window.settingsNative.tools.replaceShortcut({ action: "cartography.grid.toggle", binding: { key: "g", shift: false, option: false } }));
    await settings.screenshot({ path: test.info().outputPath("maps-settings.png") });
    await settings.evaluate(() => window.settingsNative.tools.setFeature({ tool: "maps", enabled: false }));
    await expect(settings.getByRole("heading", { name: "Maps", exact: true })).toBeVisible();
    await expect(nav("Maps")).toHaveCount(1);
    const snapshot = await page.evaluate(() => window.launcherNative.state.get());
    expect(snapshot.settings.cartographyGridEnabled).toBe(true);
    expect(snapshot.shortcuts["cartography.grid.toggle"]?.key).toBe("g");
    for (const bad of [
      () => settings.evaluate(() => window.settingsNative.tools.captureShortcut("unknown" as "travel.open")),
      () => settings.evaluate(() => window.settingsNative.tools.replaceShortcut({ action: "travel.open", binding: { key: "q", shift: false, option: false } })),
      () => settings.evaluate(() => window.settingsNative.settings.update({ skillKeyBindings: [] as never })),
    ]) await expect(bad()).rejects.toThrow();
  } finally { await closeOffline(fixture); }
});

test("the game menu follows saved Character Switch enablement and bindings", async () => {
  const fixture = await launchOffline("gw-feature-menu-");
  try {
    // The menu follows the focused window: the Settings window shows the launcher menu, so
    // each read focuses the game window, whose menu is built from the saved settings.
    const menu = async () => {
      await focusGameWindow(fixture.app);
      return fixture.app.evaluate(({ Menu }) => {
        const item = Menu.getApplicationMenu()?.getMenuItemById("switch-character");
        return item ? { enabled: item.enabled, accelerator: item.accelerator ?? null } : null;
      });
    };
    await expect.poll(menu).toEqual({ enabled: true, accelerator: "Command+E" });
    const settings = await openSettings(fixture);
    await settings.evaluate(async () => {
      await window.settingsNative.tools.setFeature({ tool: "character-switch", enabled: false });
      await window.settingsNative.tools.replaceShortcut({ action: "character.switch", binding: { key: "j", shift: false, option: false } });
    });
    await expect.poll(menu).toEqual({ enabled: false, accelerator: "Command+J" });
    await settings.evaluate(async () => {
      await window.settingsNative.tools.setFeature({ tool: "character-switch", enabled: true });
      await window.settingsNative.tools.replaceShortcut({ action: "character.switch", binding: null });
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
    });
    const settings = await openSettings(fixture);
    const nav = (name: string) => settings.locator(".settings-page aside").getByRole("button", { name, exact: true });
    await settings.evaluate(() => window.settingsNative.tools.setMasterEnabled(true));
    await nav("Maps").click();
    const compass = settings.getByRole("checkbox", { name: /Markers on Compass/ });
    await expect(compass).not.toBeChecked();
    await expect(compass).toBeDisabled();
    await settings.getByRole("checkbox", { name: /Exploration grid/ }).check();
    await compass.check();
    await compass.uncheck();
    await expect.poll(() => page.evaluate(async () => (await window.launcherNative.state.get()).settings)).toMatchObject({ cartographyGridEnabled: true, cartographyCompassGridEnabled: false });
    const thickness = settings.getByRole("spinbutton", { name: "Terrain border thickness value" });
    await thickness.fill("4");
    await thickness.press("Tab");
    await expect.poll(() => page.evaluate(async () => (await window.launcherNative.state.get()).settings.cartographyPresetLibrary.customPresets[0]?.style.walkability.boundaryWidth)).toBe(4);
    await settings.getByRole("button", { name: "Edit style" }).click();
    await expect(settings.getByRole("textbox", { name: "Shaded area color hex" })).toBeVisible();
    await settings.locator('select').filter({ has: settings.locator('option[value="builtin:cartographer"]') }).selectOption("builtin:synthwave");
    await expect(settings.getByRole("button", { name: "Customize style" })).toBeVisible();
    await settings.getByRole("button", { name: "Customize style" }).click();
    await expect.poll(() => page.evaluate(async () => (await window.launcherNative.state.get()).settings.cartographyPresetLibrary.customPresets.length)).toBe(2);
    await settings.getByRole("textbox", { name: "Shaded area color hex" }).fill("112233");
    await settings.getByRole("textbox", { name: "Shaded area color hex" }).press("Tab");
    await expect.poll(() => page.evaluate(async () => (await window.launcherNative.state.get()).settings.cartographyPresetLibrary.customPresets[1]?.style.walkability.veilColor)).toBe("#112233");
    await settings.reload();
    await nav("Maps").click();
    await settings.getByRole("button", { name: "Edit style" }).click();
    await settings.getByRole("textbox", { name: "Terrain border color hex" }).fill("334455");
    await settings.getByRole("textbox", { name: "Terrain border color hex" }).press("Tab");
    await expect.poll(() => page.evaluate(async () => (await window.launcherNative.state.get()).settings.cartographyPresetLibrary.customPresets[1]?.style.walkability.boundaryColor)).toBe("#334455");
    await expect(settings.getByRole("spinbutton", { name: "Terrain border thickness value" })).toHaveValue("1");
    await settings.getByRole("button", { name: "Done", exact: true }).click();
    await settings.getByRole("heading", { name: "Maps", exact: true }).scrollIntoViewIfNeeded();
    await settings.screenshot({ path: test.info().outputPath("map-controls.png") });
  } finally { await closeOffline(fixture); }
});

test("map styles offer usable color and numeric controls at normal size and 200% zoom", async () => {
  test.setTimeout(60_000);
  const fixture = await launchOffline("gw-settings-controls-", { GW_TEST_RETURN_LAUNCHER: "1" });
  const page = fixture.page;
  try {
    await page.evaluate(async () => {
      await window.launcherNative.experience.completeSetup({ enableTools: false });
    });
    const settings = await openSettings(fixture);
    const nav = (name: string) => settings.locator(".settings-page aside").getByRole("button", { name, exact: true });
    await settings.evaluate(() => window.settingsNative.tools.setMasterEnabled(true));
    await nav("Maps").click();
    await settings.getByRole("button", { name: "Customize style" }).click();
    const hex = settings.getByRole("textbox", { name: "Shaded area color hex" });
    await hex.fill("ABCDEF");
    await hex.press("Tab");
    await expect.poll(() => page.evaluate(async () =>
      (await window.launcherNative.state.get()).settings.cartographyPresetLibrary.customPresets[0]?.style.walkability.veilColor,
    )).toBe("#ABCDEF");
    await settings.getByRole("spinbutton", { name: "Terrain border thickness value", exact: true }).fill("0");
    await settings.getByRole("spinbutton", { name: "Terrain border thickness value", exact: true }).press("Tab");
    await expect.poll(() => page.evaluate(async () =>
      (await window.launcherNative.state.get()).settings.cartographyPresetLibrary.customPresets[0]?.style.walkability.boundaryWidth,
    )).toBe(0);

    await settings.getByText("Inspection outlines", { exact: true }).click();
    for (const size of [
      { width: 1180, height: 900, zoom: 1 },
      { width: 900, height: 700, zoom: 1 },
      { width: 900, height: 700, zoom: 2 },
    ]) {
      await fixture.app.evaluate(({ BrowserWindow }, value) => {
        const win = BrowserWindow.getAllWindows().find(win => win.webContents.getURL().endsWith("launcher/settings.html"))!;
        win.webContents.setZoomFactor(value.zoom);
        win.setSize(value.width, value.height);
      }, size);
      await settings.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
      await settings.locator(".map-style-editor").scrollIntoViewIfNeeded();
      const controls = settings.locator(".map-style-editor input, .map-style-editor select");
      for (const control of await controls.all()) {
        await control.scrollIntoViewIfNeeded();
        const box = await control.boundingBox();
        expect(box).not.toBeNull();
        // Desktop controls retain a 32px minimum target at every zoom level.
        expect(box!.width).toBeGreaterThanOrEqual(32);
        expect(box!.height).toBeGreaterThanOrEqual(32);
        expect(box!.x).toBeGreaterThanOrEqual(0);
        expect(box!.x + box!.width).toBeLessThanOrEqual(await settings.evaluate(() => innerWidth));
        expect(await control.evaluate(el => el.hasAttribute("aria-label") || !!(el as HTMLInputElement).labels?.length)).toBe(true);
        expect(await control.evaluate(el => {
          const box = el.getBoundingClientRect();
          return document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2) === el;
        })).toBe(true);
      }
      const clipped = await settings.locator(".map-style-editor").evaluate(el => el.scrollWidth > el.clientWidth + 1);
      expect(clipped).toBe(false);
      await hex.scrollIntoViewIfNeeded();
      // Electron's native capture preserves the window at non-default zoom.
      const capture = await fixture.app.evaluate(async ({ BrowserWindow }) => {
        const win = BrowserWindow.getAllWindows().find(win => win.webContents.getURL().endsWith("launcher/settings.html"))!;
        return (await win.webContents.capturePage()).toPNG().toString("base64");
      });
      await writeFile(test.info().outputPath(`map-style-${size.width}-${size.zoom}x.png`), Buffer.from(capture, "base64"));
    }
    await fixture.app.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows().find(win => win.webContents.getURL().endsWith("launcher/settings.html"))!;
      win.webContents.setZoomFactor(1);
      win.setSize(1180, 900);
    });
    await nav("Appearance").click();
    await settings.getByRole("combobox", { name: "Panel style", exact: true }).selectOption("custom");
    await settings.getByRole("textbox", { name: "Accent hex", exact: true }).fill("BBCCDD");
    await settings.getByRole("textbox", { name: "Accent hex", exact: true }).press("Tab");
    await expect.poll(() => page.evaluate(async () => (await window.launcherNative.state.get()).settings.uiCustomTheme.accent)).toBe("#BBCCDD");
    await settings.getByRole("combobox", { name: "Panel style", exact: true }).scrollIntoViewIfNeeded();
    await settings.screenshot({ path: test.info().outputPath("panel-appearance.png") });
  } finally { await closeOffline(fixture); }
});
