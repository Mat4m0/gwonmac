/** Real Electron coverage for the opt-in Hub and profile isolation boundary. */
import { expect, test } from "@playwright/test";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import type { ProfileId } from "../../src/shared/multiple-accounts.js";
import { closeOffline, launchOffline } from "./fixtures.mjs";

declare global {
  var __multiModeRestart: {
    quit: boolean;
    relaunch: boolean;
    originalQuit: Electron.App["quit"];
    originalRelaunch: Electron.App["relaunch"];
  };
}

const FIRST = "00000000-0000-4000-8000-000000000001";
const SECOND = "00000000-0000-4000-8000-000000000002";

test("Multi starts at the Hub and isolates two profile windows from Single", async () => {
  const fixture = await launchOffline("gw-multi-e2e-", {}, async (userData) => {
    await mkdir(path.join(userData, "multi"), { recursive: true });
    await writeFile(
      path.join(userData, "launcher-mode.json"),
      JSON.stringify({ formatVersion: 1, mode: "multi" }),
    );
    await writeFile(
      path.join(userData, "multi", "workspace.json"),
      JSON.stringify({
        formatVersion: 1,
        profiles: [
          { id: FIRST, name: "Primary", archived: false, templates: "private", builds: "private" },
          { id: SECOND, name: "Alt", archived: false, templates: "private", builds: "private" },
        ],
      }),
    );
    await writeFile(path.join(userData, "build-library.json"), "single-sentinel");
    await writeFile(path.join(userData, "clear-game-storage-on-start"), "pending");
  });
  try {
    await expect(fixture.page.locator("h1")).toHaveText("Who are you playing?");
    const state = await fixture.page.evaluate(() => window.gwNative.accounts.get());
    expect(state.mode).toBe("multi");
    expect(state.profiles.map((profile) => profile.name)).toEqual(["Primary", "Alt"]);

    await fixture.page.evaluate(
      ([first, second]) =>
        window.gwNative.accounts.open([first, second] as ProfileId[]),
      [FIRST, SECOND] as const,
    );
    await expect.poll(() => fixture.app.windows().length).toBe(3);
    const games = fixture.app.windows().filter((page) => page !== fixture.page);
    await Promise.all(games.map((page) => page.waitForLoadState("domcontentloaded")));

    const titles = await fixture.app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows().map((win) => win.getTitle()).sort(),
    );
    expect(titles).toEqual([
      "Guild Wars Reforged — Accounts",
      "Guild Wars Reforged — Alt",
      "Guild Wars Reforged — Primary",
    ]);
    const storagePaths = await fixture.app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()
        .filter((win) => win.getTitle() !== "Guild Wars Reforged — Accounts")
        .map((win) => win.webContents.session.storagePath),
    );
    expect(new Set(storagePaths).size).toBe(2);
    expect(storagePaths.every((value) => value?.includes("Partitions/gw-multi-"))).toBe(true);

    await games[0]!.evaluate(() => localStorage.setItem("profile-proof", "first"));
    await games[1]!.evaluate(() => localStorage.setItem("profile-proof", "second"));
    expect(await games[0]!.evaluate(() => localStorage.getItem("profile-proof"))).toBe("first");
    expect(await games[1]!.evaluate(() => localStorage.getItem("profile-proof"))).toBe("second");

    await games[0]!.evaluate(() =>
      window.gwNative.credentials.save({ username: "first@example.test", password: "one" }),
    );
    await games[1]!.evaluate(() =>
      window.gwNative.credentials.save({ username: "second@example.test", password: "two" }),
    );
    expect(await games[0]!.evaluate(() => window.gwNative.credentials.load()))
      .toEqual({ username: "first@example.test", password: "one" });
    expect(await games[1]!.evaluate(() => window.gwNative.credentials.load()))
      .toEqual({ username: "second@example.test", password: "two" });
    await expect(
      fixture.page.evaluate(() => window.gwNative.credentials.load()),
    ).rejects.toThrow();

    for (const game of games) {
      await game.evaluate(async () => {
        const { library } = await window.gwNative.buildLibrary.get();
        await window.gwNative.buildLibrary.set(library);
      });
    }
    expect(await readFile(path.join(fixture.userData, "build-library.json"), "utf8"))
      .toBe("single-sentinel");
    await stat(path.join(fixture.userData, "multi", "profiles", FIRST, "build-library.json"));
    await stat(path.join(fixture.userData, "multi", "profiles", SECOND, "build-library.json"));
    await stat(path.join(fixture.userData, "clear-game-storage-on-start"));
  } finally {
    await closeOffline(fixture);
  }
});

test("opt-in publishes a separate workspace before requesting restart", async () => {
  const fixture = await launchOffline("gw-multi-setup-e2e-", {}, async (userData) => {
    await writeFile(path.join(userData, "build-library.json"), "single-stays-here");
  });
  try {
    await fixture.app.evaluate(({ app }) => {
      globalThis.__multiModeRestart = {
        quit: false,
        relaunch: false,
        originalQuit: app.quit.bind(app),
        originalRelaunch: app.relaunch.bind(app),
      };
      app.quit = () => { globalThis.__multiModeRestart.quit = true; };
      app.relaunch = () => { globalThis.__multiModeRestart.relaunch = true; };
    });
    await fixture.page.evaluate(() => window.gwNative.accounts.setup({
      name: "Primary",
      templates: "shared",
      builds: "private",
      importTemplates: false,
      templateEntries: [],
      importBuilds: false,
    }));
    expect(JSON.parse(await readFile(
      path.join(fixture.userData, "launcher-mode.json"),
      "utf8",
    ))).toEqual({ formatVersion: 1, mode: "multi" });
    const workspace = JSON.parse(await readFile(
      path.join(fixture.userData, "multi", "workspace.json"),
      "utf8",
    )) as { profiles: Array<{ name: string }> };
    expect(workspace.profiles.map((profile) => profile.name)).toEqual(["Primary"]);
    expect(await readFile(path.join(fixture.userData, "build-library.json"), "utf8"))
      .toBe("single-stays-here");
    expect(await fixture.app.evaluate(() => ({
      quit: globalThis.__multiModeRestart.quit,
      relaunch: globalThis.__multiModeRestart.relaunch,
    }))).toEqual({ quit: true, relaunch: true });
  } finally {
    await fixture.app.evaluate(({ app }) => {
      if (!globalThis.__multiModeRestart) return;
      app.quit = globalThis.__multiModeRestart.originalQuit;
      app.relaunch = globalThis.__multiModeRestart.originalRelaunch;
    }).catch(() => undefined);
    await closeOffline(fixture);
  }
});
