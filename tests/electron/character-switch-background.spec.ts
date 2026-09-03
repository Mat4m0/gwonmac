/** Real window focus changes exercise the shipped controller with offline actions. */
import { expect, test } from "@playwright/test";
import { closeOffline, launchPlayableClient } from "./fixtures.mjs";
import type { CharacterSwitchController } from "../../src/renderer/character-switch-controller.js";

type SwitchFixtureWindow = typeof window & {
  __backgroundSwitch: {
    controller: CharacterSwitchController;
    calls: number[];
    enabled(): boolean;
    release(): void;
  };
};

for (const [boundary, heldAction] of [["immediately", 1], ["after logout", 2], ["after selection", 3]] as const) {
  for (const minimize of [false, true]) {
    test(`switch finishes ${boundary} when the game ${minimize ? "is minimized" : "loses focus"}`, async () => {
      const fixture = await launchPlayableClient("gw-switch-background-", { GW_BACKGROUND_LAUNCH: "0" });
      try {
        const { app, page } = fixture;
        // Playwright normally emulates focus even when the native window blurs.
        const session = await page.context().newCDPSession(page);
        await session.send("Emulation.setFocusEmulationEnabled", { enabled: false });
        await app.evaluate(({ app: electronApp, BrowserWindow }) => {
          const game = BrowserWindow.getAllWindows().find(win => win.webContents.getURL() === "gw://app/");
          if (!game) throw new Error("game window is required");
          game.show();
          electronApp.focus({ steal: true });
          game.focus();
        });
        await expect.poll(() => page.evaluate(() => document.hasFocus())).toBe(true);
        await page.evaluate(async (hold) => {
          const specifier = "gw://app/character-switch-controller.js";
          const module: typeof import("../../src/renderer/character-switch-controller.js") = await import(specifier);
          const memory = new WebAssembly.Memory({ initial: 1 });
          const pointer = 64;
          let enabled = false;
          let released = false;
          let pending: { kind: number; argument: number } | null = null;
          let selectedIndex = 0;
          let sequence = 2;
          let context: CharacterSwitchContext = "outpost";
          const characters = [
            { name: "Alpha", characterKey: "0000000000000001", primaryProfession: 1, secondaryProfession: 0, characterType: "roleplaying", campaign: 1, level: 20, mapId: 55 },
            { name: "Beta", characterKey: "0000000000000002", primaryProfession: 2, secondaryProfession: 0, characterType: "roleplaying", campaign: 1, level: 20, mapId: 55 },
          ] as const;
          const calls: number[] = [];
          const drain = () => {
            if (!enabled || !pending || (!released && pending.kind === hold)) return;
            const { kind, argument } = pending;
            pending = null;
            if (kind === 1) { context = "character-select"; sequence += 2; }
            if (kind === 2) selectedIndex = argument;
            if (kind === 3) context = "outpost";
            new DataView(memory.buffer).setUint32(pointer + 20, 1, true);
          };
          const controller = module.createCharacterSwitchController({
            memory, payloadPointer: pointer, buildId: 7, programId: 1,
            configure(payload, policy) {
              enabled = payload === pointer && policy === 1;
              if (!enabled) pending = null;
              return 1;
            },
            enqueue(kind, argument) {
              if (!enabled || pending) return 0;
              calls.push(kind);
              pending = { kind, argument };
              setTimeout(drain, 25);
              return 1;
            },
            characters: {
              get state() { return { status: "ready" as const, sequence, selectedIndex, characters }; },
              subscribe: () => () => false,
              dispose() {},
            },
            controls: { state: () => "unknown", switchContext: () => context, diagnosticMask: () => 0 },
          });
          window.addEventListener("pagehide", () => controller.dispose(), { once: true });
          (window as SwitchFixtureWindow).__backgroundSwitch = {
            controller, calls, enabled: () => enabled,
            release() { released = true; drain(); },
          };
          controller.request(characters[1].characterKey);
        }, heldAction);
        await expect.poll(() => page.evaluate(() =>
          (window as SwitchFixtureWindow).__backgroundSwitch.calls.at(-1))).toBe(heldAction);
        await app.evaluate(({ BrowserWindow }, hide) => {
          const game = BrowserWindow.getAllWindows().find(win => win.webContents.getURL() === "gw://app/");
          const launcher = BrowserWindow.getAllWindows().find(win => win.webContents.getURL().endsWith("launcher/index.html"));
          if (!game || !launcher) throw new Error("game and launcher windows are required");
          if (hide) game.minimize();
          launcher.show();
          launcher.focus();
        }, minimize);
        await expect.poll(() => page.evaluate(() => document.hasFocus())).toBe(false);
        await page.evaluate(() => (window as SwitchFixtureWindow).__backgroundSwitch.release());
        await expect.poll(() => page.evaluate(() =>
          (window as SwitchFixtureWindow).__backgroundSwitch.controller.action.status)).toBe("complete");
        expect(await page.evaluate(() => {
          const f = (window as SwitchFixtureWindow).__backgroundSwitch;
          return { calls: f.calls, enabled: f.enabled(), focused: document.hasFocus() };
        })).toEqual({ calls: [1, 2, 3], enabled: false, focused: false });
        if (minimize) expect(await app.evaluate(({ BrowserWindow }) =>
          BrowserWindow.getAllWindows().find(win => win.webContents.getURL() === "gw://app/")?.isMinimized())).toBe(true);
      } finally {
        await closeOffline(fixture);
      }
    });
  }
}
