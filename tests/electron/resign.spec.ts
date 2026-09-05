/** Exercises confirmed, fixed-text resignation without sending game traffic. */
import { expect, test } from "@playwright/test";
import { closeOffline, launchPlayableClient } from "./fixtures.mjs";
import { startGameInput } from "./input-helpers.js";

test("resign confirms once and sends only /resign through an empty chat editor", async () => {
  const fixture = await launchPlayableClient("gw-resign-");
  try {
    const { app, page } = fixture;
    await startGameInput(page);
    await page.evaluate(() => {
      document.getElementById("loading")?.classList.add("gone");
      window.gwCharacterSwitch = {
        context: "pve-explorable",
        characters: { status: "waiting", reason: "memory" },
        action: { status: "idle" },
        request() {}, confirm() {}, cancelConfirmation() {}, reset() {},
        diagnostics: () => ({ version: 1, stage: "unavailable", lastCode: "play-path-unproved" }),
        subscribe: () => () => {},
      };
      const canvas = document.getElementById("canvas")!;
      const field = document.getElementById("osk-input-text") as HTMLInputElement;
      canvas.addEventListener("keydown", (event) => {
        if ((event as KeyboardEvent).key === "Enter") {
          const module = window.Module as { oskActiveInput?: Element; oskIsActive?: boolean };
          module.oskActiveInput = field;
          module.oskIsActive = true;
          field.value = ""; field.focus();
        }
      });
      field.addEventListener("input", (event) => {
        document.body.dataset.resignText = (event as InputEvent).data ?? "";
      });
      field.addEventListener("keydown", (event) => {
        if (event.key === "Enter") document.body.dataset.resignSubmitted = field.value;
      });
      canvas.focus();
    });
    await app.evaluate(({ dialog }) => {
      dialog.showMessageBox = async (_window, options?: Electron.MessageBoxOptions) => {
        if (!options) throw new Error("expected window-owned dialog");
        if (options.message !== "Resign from this instance?") throw new Error(options.message);
        if (options.defaultId !== 0 || options.cancelId !== 1) throw new Error("missing Enter/Escape defaults");
        return { response: 1, checkboxChecked: false };
      };
    });
    const click = () => app.evaluate(({ Menu, BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows().find((item) => item.webContents.getURL() === "gw://app/")!;
      const item = Menu.getApplicationMenu()!.getMenuItemById("resign-game")!;
      return item.click(item, win, {} as Electron.KeyboardEvent);
    });
    await click();
    await expect(page.locator("body")).not.toHaveAttribute("data-resign-text", /.*/u);
    await app.evaluate(({ dialog }) => {
      dialog.showMessageBox = async () => ({ response: 0, checkboxChecked: false });
    });
    await page.locator("#canvas").focus();
    await click();
    await expect(page.locator("body")).toHaveAttribute("data-resign-text", "/resign");
    await expect(page.locator("body")).toHaveAttribute("data-resign-submitted", "/resign");
    await page.evaluate(() => {
      delete document.body.dataset.resignText;
      delete document.body.dataset.resignSubmitted;
      const field = document.getElementById("osk-input-text") as HTMLInputElement;
      field.value = "unfinished chat";
      field.focus();
    });
    await click();
    await expect(page.locator("body")).not.toHaveAttribute("data-resign-submitted", /.*/u);
    await expect(page.locator("#osk-input-text")).toHaveValue("unfinished chat");
  } finally {
    await closeOffline(fixture);
  }
});
