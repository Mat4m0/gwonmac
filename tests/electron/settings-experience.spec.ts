/** Settings stay understandable through save failures, navigation, and zoom. */
import { test, expect } from "@playwright/test";
import { writeFile } from "node:fs/promises";
import { launchOffline, closeOffline, openSettings } from "./fixtures.mjs";

test("failed map edits remain visibly unsaved and can be retried or reverted at 200%", async () => {
  const fixture = await launchOffline("gw-settings-recovery-", { GW_TEST_RETURN_LAUNCHER: "1" });
  const page = fixture.page;
  try {
    await page.evaluate(async () => {
      await window.launcherNative.experience.completeSetup({ enableTools: false });
    });
    const settings = await openSettings(fixture);
    await settings.locator(".settings-page aside").getByRole("button", { name: "Maps", exact: true }).click();
    await expect(settings.getByText("Tools are off", { exact: true })).toBeVisible();
    await settings.getByRole("button", { name: "Customize style", exact: true }).click();
    await expect(settings.getByRole("textbox", { name: "Shaded area color hex" })).toBeVisible();
    const original = await settings.getByRole("textbox", { name: "Shaded area color hex" }).inputValue();
    await fixture.app.evaluate(({ ipcMain, BrowserWindow }) => {
      ipcMain.removeHandler("gw:launcher:settings:update");
      ipcMain.handle("gw:launcher:settings:update", () => { throw new Error("offline fixture save refusal"); });
      const win = BrowserWindow.getAllWindows().find(win => win.webContents.getURL().endsWith("launcher/index.html"))!;
      win.setSize(900, 640);
      win.webContents.setZoomFactor(2);
    });
    const hex = settings.getByRole("textbox", { name: "Shaded area color hex" });
    await hex.fill("112233"); await hex.press("Tab");
    const feedback = settings.locator(".settings-status[role=alert]");
    await expect(feedback).toContainText("The change shown is not saved");
    expect(await feedback.ariaSnapshot()).toContain("could not be saved");
    expect(await feedback.evaluate(el => { const r = el.getBoundingClientRect(); return r.top >= 0 && r.bottom <= innerHeight; })).toBe(true);
    await expect(hex).toBeDisabled();
    await settings.getByRole("button", { name: "Retry", exact: true }).click();
    await expect(feedback).toContainText("The change shown is not saved");
    const png = await fixture.app.evaluate(async ({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows().find(win => win.webContents.getURL().endsWith("launcher/index.html"))!;
      return (await win.webContents.capturePage()).toPNG().toString("base64");
    });
    await writeFile(test.info().outputPath("save-failure-200.png"), Buffer.from(png, "base64"));
    await settings.getByRole("button", { name: "Revert", exact: true }).click();
    await expect(feedback).toHaveCount(0);
    await settings.getByRole("button", { name: "Edit style", exact: true }).click();
    await expect(hex).toHaveValue(original);
    await expect(hex).toBeEnabled();
    const grid = settings.getByRole("checkbox", { name: /Exploration grid/ });
    await grid.check();
    await expect(feedback).toBeVisible();
    await settings.getByRole("button", { name: "Revert", exact: true }).click();
    await expect(grid).not.toBeChecked();
    expect((await page.evaluate(() => window.launcherNative.state.get())).settings.cartographyGridEnabled).toBe(false);
  } finally { await closeOffline(fixture); }
});

test("settings navigation has one scroll owner and compact controls at supported sizes", async () => {
  test.setTimeout(60_000);
  const fixture = await launchOffline("gw-settings-layout-", { GW_TEST_RETURN_LAUNCHER: "1" });
  const page = fixture.page;
  try {
    await page.evaluate(async () => {
      await window.launcherNative.experience.completeSetup({ enableTools: false });
    });
    const settings = await openSettings(fixture);
    for (const size of [{ width: 1180, height: 760, zoom: 1 }, { width: 900, height: 640, zoom: 1 }, { width: 1180, height: 760, zoom: 2 }, { width: 900, height: 640, zoom: 2 }]) {
      await fixture.app.evaluate(({ BrowserWindow }, size) => {
        const win = BrowserWindow.getAllWindows().find(win => win.webContents.getURL().endsWith("launcher/index.html"))!;
        win.setSize(size.width, size.height); win.webContents.setZoomFactor(size.zoom);
      }, size);
      for (const section of ["Tools", "Maps", "Appearance", "Game", "Texture packs", "Game files", "Updates", "Home screen", "Advanced"]) {
        await settings.locator(".settings-page aside").getByRole("button", { name: section, exact: true }).click();
        await expect.poll(() => settings.locator(".settings-content").evaluate(el => el.scrollTop)).toBe(0);
        const heading = settings.locator(".settings-content h1");
        expect(await heading.evaluate(el => document.activeElement === el)).toBe(true);
        expect(await heading.evaluate(el => { const r = el.getBoundingClientRect(); const p = el.closest(".settings-content")!.getBoundingClientRect(); return r.top >= p.top && r.bottom <= p.bottom; })).toBe(true);
        expect(await settings.locator("main").evaluate(el => el.scrollHeight > el.clientHeight + 1)).toBe(false);
        if (section === "Maps" || section === "Tools") {
          const control = settings.locator('.settings-fields input[type="checkbox"]').first();
          await control.scrollIntoViewIfNeeded();
          expect(await control.evaluate(el => { const r=el.getBoundingClientRect(); return document.elementFromPoint(r.x+r.width/2,r.y+r.height/2) === el; })).toBe(true);
        }
        const png = await fixture.app.evaluate(async ({ BrowserWindow }) => {
          const win = BrowserWindow.getAllWindows().find(win => win.webContents.getURL().endsWith("launcher/index.html"))!;
          return (await win.webContents.capturePage()).toPNG().toString("base64");
        });
        await writeFile(test.info().outputPath(`${section.replaceAll(" ", "-")}-${size.width}-${size.zoom}.png`), Buffer.from(png,"base64"));
        if (section === "Tools" && size.width === 1180 && size.zoom === 1) {
          await settings.locator('.tool-options > summary').first().click();
          const options = settings.locator('.feature-setting .shortcut-options').first();
          await options.locator('summary').click();
          const clear = options.getByRole('button', { name: /Clear .* shortcut/ });
          await expect(clear).toBeVisible();
          expect(await clear.evaluate(el => { const r = el.getBoundingClientRect(); return document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2) === el; })).toBe(true);
          const menuPng = await fixture.app.evaluate(async ({ BrowserWindow }) => {
            const win = BrowserWindow.getAllWindows().find(win => win.webContents.getURL().endsWith("launcher/index.html"))!;
            return (await win.webContents.capturePage()).toPNG().toString("base64");
          });
          await writeFile(test.info().outputPath("shortcut-options.png"), Buffer.from(menuPng, "base64"));
          await options.locator('summary').press('Escape');
          await expect(clear).not.toBeVisible();
        }
        await settings.locator(".settings-content").evaluate(el => { el.scrollTop = el.scrollHeight; });
      }
    }
  } finally { await closeOffline(fixture); }
});
