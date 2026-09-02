/** Settings, native shortcuts, and feature visibility agree through real IPC. */
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
    await expect(page.getByRole("checkbox", { name: /Character Switch Search/ })).toBeEnabled();
    await expect(page.getByRole("button", { name: "Maps", exact: true })).toHaveCount(0);
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
    await expect(page.getByRole("heading", { name: "Tools", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Maps", exact: true })).toHaveCount(0);
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
