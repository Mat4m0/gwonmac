/** Real Electron coverage for explicit, account-owned unsafe-close decisions. */
import { expect, test } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { ProfileId } from "../../src/shared/multiple-accounts.js";
import { closeOffline, launchCachedClient } from "./fixtures.mjs";

declare global {
  var __profileCloseDialogs: {
    parents: string[];
    responses: number[];
  } | undefined;
}

const FIRST = "00000000-0000-4000-8000-000000000001";
const SECOND = "00000000-0000-4000-8000-000000000002";

test("keeps an account open until an incomplete save is resolved explicitly", async () => {
  const fixture = await launchCachedClient("gw-multi-close-save-e2e-", {}, async (userData) => {
    await mkdir(path.join(userData, "multi"), { recursive: true });
    await writeFile(
      path.join(userData, "launcher-mode.json"),
      JSON.stringify({ formatVersion: 1, mode: "multi" }),
    );
    await writeFile(path.join(userData, "multi", "workspace.json"), JSON.stringify({
      formatVersion: 1,
      deletingProfileIds: [],
      profiles: [
        { id: FIRST, name: "Primary", archived: false, templates: "shared", builds: "shared" },
        { id: SECOND, name: "Alt", archived: false, templates: "shared", builds: "shared" },
      ],
    }));
  });
  try {
    const launcher = fixture.app.windows().find(
      (page) => page.url() === "gw://app/launcher/index.html",
    );
    if (!launcher) throw new Error("launcher window not found");
    await launcher.evaluate(
      ([first, second]) => window.launcherNative.profiles.play(
        [first, second] as ProfileId[],
      ),
      [FIRST, SECOND] as const,
    );
    await expect.poll(() => fixture.app.windows().length).toBe(3);
    await fixture.app.evaluate(async ({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows().find((candidate) =>
        candidate.getTitle().endsWith("Primary"));
      if (!win) throw new Error("Primary window not found");
      await win.webContents.executeJavaScript(`
        window.Module ??= {};
        Object.defineProperty(window.Module, "FS", {
          configurable: true,
          get() { throw new Error("'FS' was not exported"); },
        });
        Object.assign(globalThis, {
          FS: { syncfs: (_populate, callback) => callback() },
        });
        true;
      `);
    });
    await fixture.app.evaluate(({ BrowserWindow, dialog }) => {
      globalThis.__profileCloseDialogs = {
        parents: [],
        responses: [0, 2, 1],
      };
      Object.defineProperty(dialog, "showMessageBox", {
        configurable: true,
        value: async (first: unknown) => {
          const state = globalThis.__profileCloseDialogs;
          if (!state) throw new Error("profile close dialog state is missing");
          state.parents.push(first instanceof BrowserWindow ? first.getTitle() : "unowned");
          return {
            response: state.responses.shift() ?? 2,
            checkboxChecked: false,
          };
        },
      });
      const win = BrowserWindow.getAllWindows().find((candidate) =>
        candidate.getTitle().endsWith("Primary"));
      if (!win) throw new Error("Primary window not found");
      const send = win.webContents.send.bind(win.webContents);
      let swallowed = false;
      Object.defineProperty(win.webContents, "send", {
        configurable: true,
        value: (channel: string, ...args: unknown[]) => {
          const command = args[1] as { type?: string } | undefined;
          if (!swallowed && command?.type === "filesystem.sync") {
            swallowed = true;
            return;
          }
          send(channel, ...args);
        },
      });
      win.close();
    });
    await expect.poll(() => fixture.app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows().some((win) =>
        win.getTitle().endsWith("Primary")),
    ), { timeout: 12_000 }).toBe(false);
    expect(await fixture.app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows().some((win) => win.getTitle().endsWith("Alt")),
    )).toBe(true);

    await fixture.app.evaluate(({ BrowserWindow, ipcMain }) => {
      const win = BrowserWindow.getAllWindows().find((candidate) =>
        candidate.getTitle().endsWith("Alt"));
      if (!win) throw new Error("Alt window not found");
      const send = win.webContents.send.bind(win.webContents);
      Object.defineProperty(win.webContents, "send", {
        configurable: true,
        value: (channel: string, ...args: unknown[]) => {
          const [id, command] = args as [number, { type?: string }];
          if (command?.type === "filesystem.sync") {
            queueMicrotask(() => ipcMain.emit(
              "gw:renderer:commandDone",
              { sender: win.webContents },
              id,
              "failed",
            ));
            return;
          }
          send(channel, ...args);
        },
      });
      win.close();
    });
    await expect.poll(() => fixture.app.evaluate(() =>
      globalThis.__profileCloseDialogs?.parents.length)).toBe(2);
    expect(await fixture.app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows().some((win) => win.getTitle().endsWith("Alt")),
    )).toBe(true);

    await fixture.app.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows().find((candidate) =>
        candidate.getTitle().endsWith("Alt"));
      if (!win) throw new Error("Alt window not found");
      win.close();
    });
    await expect.poll(() => fixture.app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows().some((win) => win.getTitle().endsWith("Alt")),
    )).toBe(false);
    expect(await fixture.app.evaluate(() => globalThis.__profileCloseDialogs))
      .toEqual({
        parents: [
          "Guild Wars Reforged — Primary",
          "Guild Wars Reforged — Alt",
          "Guild Wars Reforged — Alt",
        ],
        responses: [],
      });
    expect(await launcher.evaluate(() => document.visibilityState)).toBe("visible");
  } finally {
    await closeOffline(fixture);
  }
});
