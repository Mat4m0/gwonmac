/** Verifies the shortcut-to-client input boundary without sending game traffic. */
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { closeOffline, launchPlayableClient } from "./fixtures.mjs";
import { startGameInput } from "./input-helpers.js";

test("Call target sends one balanced chord, preserves held keys, and refuses text input", async () => {
  const fixture = await launchPlayableClient("gw-call-target-", { GW_BACKGROUND_LAUNCH: "0" }, d => writeFile(path.join(d, "settings.json"), JSON.stringify({ gwonmacTools: true, callTargetEnabled: true })));
  try {
    const { app, page } = fixture;
    await startGameInput(page);
    await app.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows().find(window => window.webContents.getURL() === "gw://app/")!;
      win.show(); win.focus();
    });
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
      canvas.focus();
      document.body.dataset.callEvents = "";
      document.body.dataset.callCommands = "0";
      for (const type of ["keydown", "keyup"]) {
        canvas.addEventListener(type, event => {
          if (!(event instanceof KeyboardEvent) || event.isTrusted) return;
          document.body.dataset.callEvents += `${event.type}:${event.code}:${Number(event.ctrlKey)}${Number(event.shiftKey)}${Number(event.altKey)}${Number(event.metaKey)};`;
        });
      }
      window.addEventListener("gw:call-target", () => {
        document.body.dataset.callCommands = String(Number(document.body.dataset.callCommands) + 1);
      });
    });
    const body = page.locator("body");
    let calls = 0;
    const press = async (key = "G", modifiers: Electron.KeyboardInputEvent["modifiers"] = ["meta"]) => {
      await page.evaluate(() => { document.body.dataset.callEvents = ""; });
      await app.evaluate(({ BrowserWindow }, { key, modifiers }) => {
        const win = BrowserWindow.getAllWindows().find(window => window.webContents.getURL() === "gw://app/")!;
        // Feed the main input boundary directly. sendInputEvent leaves macOS
        // Command state held because it has no physical AppKit key-up.
        const input = { key: key.toLowerCase(), code: `Key${key}`, meta: true,
          control: false, shift: modifiers?.includes("shift") ?? false,
          alt: modifiers?.includes("alt") ?? false };
        win.webContents.emit("before-input-event", { preventDefault() {} }, { ...input, type: "keyDown", isAutoRepeat: false });
        win.webContents.emit("before-input-event", { preventDefault() {} }, { ...input, type: "keyDown", isAutoRepeat: true });
        win.webContents.emit("before-input-event", { preventDefault() {} }, { ...input, type: "keyUp", isAutoRepeat: false });
      }, { key, modifiers });
      await expect(body).toHaveAttribute("data-call-commands", String(++calls));
    };
    const chord = "keydown:ControlLeft:1000;keydown:ShiftLeft:1100;keydown:Space:1100;keyup:Space:1100;keyup:ShiftLeft:1000;keyup:ControlLeft:0000;";
    await press();
    await expect(body).toHaveAttribute("data-call-events", chord);

    await page.keyboard.down("KeyW");
    await page.keyboard.down("Shift");
    const launcher = app.windows().find(window => window.url().endsWith("launcher/index.html"))!;
    await launcher.evaluate(() => window.launcherNative.tools.replaceShortcut({
      action: "game.call-target", binding: { key: "g", shift: true, option: false },
    }));
    await press("G", ["meta", "shift"]);
    await expect(body).toHaveAttribute("data-call-events", "keydown:ControlLeft:1100;keydown:Space:1100;keyup:Space:1100;keyup:ControlLeft:0100;");
    await page.keyboard.up("Shift");
    await page.keyboard.up("KeyW");
    await launcher.evaluate(() => window.launcherNative.tools.replaceShortcut({
      action: "game.call-target", binding: { key: "j", shift: false, option: true },
    }));
    await page.keyboard.down("Alt");
    await press("J", ["meta", "alt"]);
    await expect(body).toHaveAttribute("data-call-events", `keyup:AltLeft:0000;${chord}keydown:AltLeft:0010;`);
    await page.keyboard.up("Alt");
    await launcher.evaluate(() => window.launcherNative.tools.replaceShortcut({
      action: "game.call-target", binding: { key: "g", shift: false, option: false },
    }));

    await page.evaluate(() => {
      const field = document.getElementById("osk-input-text");
      const module = window.Module as NonNullable<Window["Module"]> & { oskActiveInput?: EventTarget | null };
      module.oskActiveInput = field;
      if (field instanceof HTMLInputElement) field.focus();
    });
    await press();
    await expect(body).toHaveAttribute("data-call-events", "");
    await page.evaluate(() => {
      const module = window.Module as NonNullable<Window["Module"]> & { oskActiveInput?: EventTarget | null };
      module.oskActiveInput = null;
      document.getElementById("canvas")!.focus();
    });
    await page.keyboard.down("Space");
    await press();
    await expect(body).toHaveAttribute("data-call-events", "");
    await page.keyboard.up("Space");
    await page.evaluate(() => {
      if (window.gwCharacterSwitch) Object.defineProperty(window.gwCharacterSwitch, "context", { value: "character-select", configurable: true });
    });
    await press();
    await expect(body).toHaveAttribute("data-call-events", "");
    await page.evaluate(() => {
      if (window.gwCharacterSwitch) Object.defineProperty(window.gwCharacterSwitch, "context", { value: "pvp-explorable", configurable: true });
    });
    await press();
    await expect(body).toHaveAttribute("data-call-events", chord);
    await launcher.evaluate(() => window.launcherNative.tools.setFeature({ tool: "call-target", enabled: false }));
    const refused = await page.evaluate(() => {
      document.body.dataset.callEvents = "";
      return window.dispatchEvent(new CustomEvent("gw:call-target", { cancelable: true }));
    });
    expect(refused).toBe(true);
    await expect(body).toHaveAttribute("data-call-events", "");
  } finally {
    await closeOffline(fixture);
  }
});
