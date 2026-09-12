/** Exercises the real Resign dialog and shortcut without sending game traffic. */
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { closeOffline, launchPlayableClient } from "./fixtures.mjs";
import { startGameInput } from "./input-helpers.js";

test("Resign uses the shared modal and submits only on Enter or its button", async () => {
  const fixture = await launchPlayableClient("gw-resign-", { GW_BACKGROUND_LAUNCH: "0" }, async userData => {
    await writeFile(path.join(userData, "settings.json"), JSON.stringify({ gwonmacTools: true, resignEnabled: true }));
  });
  try {
    const { app, page } = fixture;
    await startGameInput(page);
    await app.evaluate(({ dialog }) => {
      dialog.showMessageBox = async () => { throw new Error("Resign must not open a native message box"); };
    });
    const press = (key = "R") => app.evaluate(({ BrowserWindow }, key) => {
      const win = BrowserWindow.getAllWindows().find(window => window.webContents.getURL() === "gw://app/")!;
      win.show(); win.focus();
      win.webContents.sendInputEvent({ type: "keyDown", keyCode: key, modifiers: ["meta", "shift"] });
      win.webContents.sendInputEvent({ type: "keyUp", keyCode: key, modifiers: ["meta", "shift"] });
    }, key);
    await page.evaluate(async () => {
      const modulePath = "gw://app/resign.js";
      const { installResignCommand } = await import(modulePath);
      let count = 0;
      const resign = installResignCommand({
        enhancement_configure_resign() { return 1; },
        enhancement_resign() { document.body.dataset.resignCount = String(++count); return 1; },
      });
      const sync = () => resign.update(window.gwToolsSettings().gwonmacTools && window.gwToolsSettings().resignEnabled);
      sync();
      window.addEventListener("gw:tools-settings", sync);
      document.body.dataset.resignCount = "0";
      document.getElementById("loading")?.classList.add("gone");
      window.gwCharacterSwitch = {
        context: "pve-explorable",
        characters: { status: "waiting", reason: "memory" },
        action: { status: "idle" },
        request() {}, confirm() {}, cancelConfirmation() {}, reset() {},
        diagnostics: () => ({ version: 1, stage: "unavailable", lastCode: "play-path-unproved" }),
        subscribe: () => () => {},
      };
      document.getElementById("canvas")!.focus();
    });
    const modal = page.getByRole("dialog", { name: "Resign?", exact: true });
    const confirm = modal.getByRole("button", { name: "Resign", exact: true });
    const cancelled = async () => {
      await expect(modal).not.toBeVisible();
      await expect(page.locator("body")).toHaveAttribute("data-resign-count", "0");
      await expect(page.locator("#canvas")).toBeFocused();
    };
    await press();
    await expect(modal).toBeVisible();
    await expect(confirm).toBeFocused();
    await press();
    await expect(modal).toBeVisible();
    await modal.getByText("Resigning can end your current attempt.").click();
    await confirm.focus();
    await page.keyboard.press("Space");
    await page.keyboard.press("Shift+Enter");
    await page.keyboard.press("a");
    await expect(page.locator("body")).toHaveAttribute("data-resign-count", "0");
    for (let i = 0; i < 5; i++) {
      await page.keyboard.press("Tab");
      expect(await modal.evaluate(node => node.contains(document.activeElement))).toBe(true);
    }
    await page.keyboard.press("Escape");
    await cancelled();
    await press();
    await expect(modal).toBeVisible();
    await page.mouse.click(5, 5);
    await cancelled();
    await press();
    await modal.getByRole("button", { name: "Close Resign" }).click();
    await cancelled();
    await press();
    await modal.getByRole("button", { name: "Cancel", exact: true }).click();
    await cancelled();
    await press();
    await expect(modal).toBeVisible();
    await page.screenshot({ path: test.info().outputPath("resign-dialog.png") });
    await page.keyboard.press("Enter");
    await expect(modal).not.toBeVisible();
    await expect(page.locator("body")).toHaveAttribute("data-resign-count", "1");
    await press();
    await confirm.click();
    await expect(modal).not.toBeVisible();
    await expect(page.locator("body")).toHaveAttribute("data-resign-count", "2");
    const launcher = app.windows().find(window => window.url().endsWith("launcher/index.html"));
    if (!launcher) throw new Error("launcher is required");
    await press();
    await launcher.evaluate(() => window.launcherNative.tools.setFeature({ tool: "resign", enabled: false }));
    await expect(modal).not.toBeVisible();
    await expect.poll(() => app.evaluate(({ Menu }) => Menu.getApplicationMenu()?.getMenuItemById("resign-game")?.enabled)).toBe(false);
    await press();
    await expect(modal).not.toBeVisible();
    await launcher.evaluate(async () => {
      await window.launcherNative.tools.setFeature({ tool: "resign", enabled: true });
      await window.launcherNative.tools.replaceShortcut({ action: "game.resign", binding: { key: "j", shift: true, option: false } });
    });
    await expect.poll(() => app.evaluate(({ Menu }) => Menu.getApplicationMenu()?.getMenuItemById("resign-game")?.enabled)).toBe(true);
    await press("J");
    await expect(modal).toBeVisible();
    await launcher.evaluate(() => window.launcherNative.tools.setMasterEnabled(false));
    await expect(modal).not.toBeVisible();
    await press("J");
    await expect(modal).not.toBeVisible();
    await launcher.evaluate(() => window.launcherNative.tools.setMasterEnabled(true));
    await page.evaluate(() => {
      const field = document.getElementById("osk-input-text") as HTMLInputElement;
      field.value = "unfinished chat";
    });
    await press("J");
    await expect(confirm).toBeDisabled();
    await page.keyboard.press("Enter");
    await expect(page.locator("body")).toHaveAttribute("data-resign-count", "2");
    await expect(page.locator("#osk-input-text")).toHaveValue("unfinished chat");
  } finally { await closeOffline(fixture); }
});
