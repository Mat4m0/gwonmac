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
          { id: FIRST, name: "Primary", archived: false, templates: "shared", builds: "shared" },
          { id: SECOND, name: "Alt", archived: false, templates: "shared", builds: "shared" },
        ],
      }),
    );
    await writeFile(path.join(userData, "build-library.json"), "single-sentinel");
    await writeFile(path.join(userData, "clear-game-storage-on-start"), "pending");
    await mkdir(path.join(userData, "multi", "profiles", FIRST), { recursive: true });
    await writeFile(
      path.join(
        userData,
        "multi",
        "profiles",
        FIRST,
        "clear-game-storage-on-start",
      ),
      "pending",
    );
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
    expect(games.map((page) => page.url())).toEqual(["gw://app/", "gw://app/"]);

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

    await Promise.all(games.map((game) =>
      game.evaluate(() => window.gwNative.accounts.loadTemplates()),
    ));
    await games[0]!.evaluate(() => window.gwNative.accounts.saveTemplates([{
      path: "Skills/Primary.txt",
      contents: "OQCiUyo8AkVwR4KMMGAAAEAA",
    }]));
    await games[1]!.evaluate(() => window.gwNative.accounts.saveTemplates([{
      path: "Skills/Alt.txt",
      contents: "OQCiUyo8AkVwR4KMMGAAAEAB",
    }]));
    const sharedTemplates = JSON.parse(await readFile(
      path.join(fixture.userData, "multi", "shared", "templates.json"),
      "utf8",
    )) as { entries: Array<{ path: string }> };
    expect(sharedTemplates.entries.map((entry) => entry.path)).toEqual([
      "Skills/Alt.txt",
      "Skills/Primary.txt",
    ]);

    const libraries = await Promise.all(games.map((game) =>
      game.evaluate(() => window.gwNative.buildLibrary.get()),
    ));
    await games[0]!.evaluate(
      (library) => window.gwNative.buildLibrary.set({ ...library, tags: ["primary"] }),
      libraries[0]!.library,
    );
    await expect(games[1]!.evaluate(
      (library) => window.gwNative.buildLibrary.set({ ...library, tags: ["alt"] }),
      libraries[1]!.library,
    )).rejects.toThrow();
    expect(await readFile(path.join(fixture.userData, "build-library.json"), "utf8"))
      .toBe("single-sentinel");
    expect(JSON.parse(await readFile(
      path.join(fixture.userData, "multi", "shared", "build-library.json"),
      "utf8",
    ))).toMatchObject({ tags: ["primary"] });
    await stat(path.join(fixture.userData, "clear-game-storage-on-start"));
    await expect(stat(path.join(
      fixture.userData,
      "multi",
      "profiles",
      FIRST,
      "clear-game-storage-on-start",
    ))).rejects.toMatchObject({ code: "ENOENT" });

    const identifiedGames = await Promise.all(games.map(async (game) => ({
      game,
      credentials: await game.evaluate(() => window.gwNative.credentials.load()),
    })));
    const primaryPage = identifiedGames.find(({ credentials }) =>
      credentials?.username === "first@example.test")?.game;
    const altPage = identifiedGames.find(({ credentials }) =>
      credentials?.username === "second@example.test")?.game;
    if (!primaryPage || !altPage) throw new Error("profile pages not found");
    const primaryClosed = primaryPage.waitForEvent("close", { timeout: 12_000 });
    await primaryPage.evaluate(() => {
      void window.gwNative.app.requestQuit();
    });
    await primaryClosed;
    expect(await altPage.evaluate(() => window.gwNative.credentials.load())).toEqual({
      username: "second@example.test",
      password: "two",
    });
    expect(await fixture.page.evaluate(() => document.visibilityState)).toBe("visible");
  } finally {
    await closeOffline(fixture);
  }
});

test("opt-in publishes a separate workspace before requesting restart", async () => {
  const singleLibrary = JSON.stringify({ version: 3, builds: [], teams: [], tags: [] });
  const fixture = await launchOffline("gw-multi-setup-e2e-", {}, async (userData) => {
    await writeFile(path.join(userData, "build-library.json"), singleLibrary);
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
      importTemplates: true,
      templateEntries: [{
        path: "Skills/Imported.txt",
        contents: "OQCiUyo8AkVwR4KMMGAAAEAA",
      }],
      importBuilds: true,
    }));
    expect(JSON.parse(await readFile(
      path.join(fixture.userData, "launcher-mode.json"),
      "utf8",
    ))).toEqual({ formatVersion: 1, mode: "multi" });
    const workspace = JSON.parse(await readFile(
      path.join(fixture.userData, "multi", "workspace.json"),
      "utf8",
    )) as { profiles: Array<{ id: string; name: string }> };
    expect(workspace.profiles.map((profile) => profile.name)).toEqual(["Primary"]);
    expect(await readFile(path.join(fixture.userData, "build-library.json"), "utf8"))
      .toBe(singleLibrary);
    expect(JSON.parse(await readFile(
      path.join(
        fixture.userData,
        "multi",
        "profiles",
        workspace.profiles[0]!.id,
        "build-library.json",
      ),
      "utf8",
    ))).toEqual(JSON.parse(singleLibrary));
    expect(JSON.parse(await readFile(
      path.join(fixture.userData, "multi", "shared", "templates.json"),
      "utf8",
    ))).toEqual({
      formatVersion: 1,
      revision: 1,
      entries: [{
        path: "Skills/Imported.txt",
        contents: "OQCiUyo8AkVwR4KMMGAAAEAA",
      }],
    });
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
