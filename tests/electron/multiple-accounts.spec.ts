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

test("Single Account remains the invisible default", async () => {
  const fixture = await launchOffline("gw-single-default-e2e-");
  try {
    await expect(fixture.page).toHaveURL("gw://app/");
    expect((await fixture.app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows().map((win) => win.getTitle()),
    )).some((title) => title.endsWith("Accounts"))).toBe(false);
    expect(await fixture.page.evaluate(() => window.gwNative.accounts.get()))
      .toMatchObject({ mode: "single", profiles: [] });
    await expect(stat(path.join(fixture.userData, "multi")))
      .rejects.toMatchObject({ code: "ENOENT" });
  } finally {
    await closeOffline(fixture);
  }
});

test("Hub exposes the focused chooser, account sheets, and Settings management", async () => {
  const fixture = await launchOffline("gw-multi-hub-ui-e2e-", {}, async (userData) => {
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
          { id: FIRST, name: "Primary Account With A Deliberately Long Name", archived: false, templates: "shared", builds: "shared" },
          { id: SECOND, name: "Alt", archived: false, templates: "private", builds: "private" },
          { id: "00000000-0000-4000-8000-000000000003", name: "Pre-Searing", archived: false, templates: "shared", builds: "shared" },
          { id: "00000000-0000-4000-8000-000000000004", name: "Storage", archived: false, templates: "shared", builds: "shared" },
          { id: "00000000-0000-4000-8000-000000000005", name: "PvP", archived: false, templates: "shared", builds: "shared" },
          { id: "00000000-0000-4000-8000-000000000006", name: "Archived", archived: true, templates: "shared", builds: "shared" },
          { id: "00000000-0000-4000-8000-000000000007", name: "Delete Me", archived: true, templates: "shared", builds: "shared" },
        ],
      }),
    );
  });
  try {
    await expect(fixture.page.getByRole("heading", { name: "Choose Accounts" })).toBeVisible();
    await expect(fixture.page.getByText("Each account keeps its own saved login and game files.")).toBeVisible();
    await expect(fixture.page.getByRole("checkbox")).toHaveCount(5);
    await expect(fixture.page.getByRole("button", { name: "Open", exact: true })).toBeDisabled();

    const primary = fixture.page.getByRole("checkbox", { name: /Select Primary Account/ });
    await primary.check();
    await expect(fixture.page.getByRole("button", { name: /Open Primary Account/ })).toBeEnabled();
    expect(await fixture.page.locator("#accounts-list").evaluate((element) =>
      element.scrollHeight >= element.clientHeight)).toBe(true);
    await expect(fixture.page.locator(".account-copy strong").first()).toHaveAttribute(
      "title",
      "Primary Account With A Deliberately Long Name",
    );

    await fixture.page.getByRole("button", { name: "New Account…" }).click();
    await expect(fixture.page.getByRole("dialog", { name: "New Account" })).toBeVisible();
    await expect(fixture.page.getByText("Builds and teams", { exact: true })).toBeVisible();
    await expect(fixture.page.getByText("In-game templates", { exact: true })).toBeVisible();
    await expect(fixture.page.getByText("Start with Single Account data")).toBeHidden();
    await expect(fixture.page.getByText(/Single Account data are never shared/)).toBeVisible();
    await fixture.page.getByRole("button", { name: "Cancel" }).click();

    await fixture.page.getByRole("button", { name: /More options for Primary/ }).click();
    await expect(fixture.page.getByRole("menuitem", { name: "Edit Account…" })).toBeVisible();
    await expect(fixture.page.getByRole("menuitem", { name: "Archive Account" })).toBeVisible();
    await fixture.page.keyboard.press("Escape");

    await fixture.app.evaluate(({ Menu }) => {
      const item = Menu.getApplicationMenu()?.getMenuItemById("accounts-settings-menu");
      if (!item?.click) throw new Error("Accounts Settings menu item is unavailable");
      item.click(item, undefined, {} as Electron.KeyboardEvent);
    });
    await expect(fixture.page.getByRole("dialog", { name: "Multiple Accounts Settings" })).toBeVisible();
    expect(await fixture.page.locator("#accounts-settings").evaluate((element) =>
      getComputedStyle(element).getPropertyValue("-webkit-app-region"),
    )).toBe("no-drag");
    await expect(fixture.page.getByText("Archived", { exact: true })).toBeVisible();
    await expect(fixture.page.getByRole("button", { name: "Restore" })).toHaveCount(2);
    await expect(fixture.page.getByRole("button", { name: "Delete…" })).toHaveCount(2);
    await expect(fixture.page.getByRole("button", { name: "Return to Single Account…" })).toBeVisible();

    await fixture.page.getByRole("button", { name: "Restore" }).first().click();
    await expect(fixture.page.getByText("Archived was restored.")).toBeVisible();
    await expect(fixture.page.getByRole("checkbox", { name: "Select Archived" })).toBeVisible();
    await expect(fixture.page.getByRole("button", { name: "Restore" })).toHaveCount(1);

    await fixture.app.evaluate(({ dialog }) => {
      dialog.showMessageBox = async () => ({ response: 0, checkboxChecked: false });
    });
    await fixture.page.getByRole("button", { name: "Delete…" }).click();
    await expect(fixture.page.getByText("Delete Me was permanently deleted.")).toBeVisible();
    await expect(fixture.page.getByText("No archived accounts.")).toBeVisible();
  } finally {
    await closeOffline(fixture);
  }
});

test("a bank account opens alone and Show never creates a duplicate window", async () => {
  const fixture = await launchOffline("gw-multi-bank-e2e-", {}, async (userData) => {
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
          { id: FIRST, name: "Main", archived: false, templates: "shared", builds: "shared" },
          { id: SECOND, name: "Storage and Materials", archived: false, templates: "shared", builds: "shared" },
        ],
      }),
    );
  });
  try {
    const bank = fixture.page.getByRole("checkbox", { name: "Select Storage and Materials" });
    await bank.check();
    await fixture.page.getByRole("button", { name: "Open Storage and Materials" }).click();
    await expect.poll(() => fixture.app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows().filter((win) => !win.getTitle().endsWith("Accounts")).length,
    )).toBe(1);
    await expect.poll(() => fixture.page.evaluate(() => window.gwNative.accounts.get()))
      .toMatchObject({
        profiles: [
          { name: "Main", state: "ready" },
          { name: "Storage and Materials", state: "running" },
        ],
      });

    await fixture.app.evaluate(({ app }) => app.emit("activate"));
    await expect(fixture.page.getByRole("heading", { name: "Choose Accounts" })).toBeVisible();
    await expect(fixture.page.getByRole("button", { name: "Show Storage and Materials" })).toBeVisible();
    await fixture.page.getByRole("button", { name: "Show Storage and Materials" }).click();
    await expect.poll(() => fixture.app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows().filter((win) => !win.getTitle().endsWith("Accounts")).length,
    )).toBe(1);
    expect(await fixture.app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getFocusedWindow()?.getTitle(),
    )).toBe("Guild Wars Reforged — Storage and Materials");
  } finally {
    await closeOffline(fixture);
  }
});

test("renderer recovery stays with its account and a second crash needs attention", async () => {
  const fixture = await launchOffline("gw-multi-recovery-e2e-", {}, async (userData) => {
    await mkdir(path.join(userData, "multi"), { recursive: true });
    await writeFile(path.join(userData, "launcher-mode.json"), JSON.stringify({ formatVersion: 1, mode: "multi" }));
    await writeFile(path.join(userData, "multi", "workspace.json"), JSON.stringify({
      formatVersion: 1,
      profiles: [
        { id: FIRST, name: "Primary", archived: false, templates: "shared", builds: "shared" },
        { id: SECOND, name: "Alt", archived: false, templates: "shared", builds: "shared" },
      ],
    }));
  });
  try {
    await fixture.page.evaluate(
      ([first, second]) => window.gwNative.accounts.open([first, second] as ProfileId[]),
      [FIRST, SECOND] as const,
    );
    const firstRenderer = await fixture.app.evaluate(({ BrowserWindow, dialog }) => {
      dialog.showErrorBox = () => undefined;
      const win = BrowserWindow.getAllWindows().find((candidate) => candidate.getTitle().endsWith("Primary"));
      if (!win) throw new Error("Primary window not found");
      const id = win.webContents.id;
      win.webContents.forcefullyCrashRenderer();
      return id;
    });
    await expect.poll(() => fixture.app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows().find((win) => win.getTitle().endsWith("Primary"))?.webContents.id,
    )).not.toBe(firstRenderer);
    await expect.poll(() => fixture.page.evaluate(() =>
      window.gwNative.accounts.get().then((state) => state.profiles.find((profile) => profile.name === "Primary")?.state),
    )).toBe("running");
    expect(await fixture.app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows().find((win) => win.getTitle().endsWith("Accounts"))?.isVisible(),
    )).toBe(false);

    await fixture.app.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows().find((candidate) => candidate.getTitle().endsWith("Primary"));
      if (!win) throw new Error("Recovered Primary window not found");
      win.webContents.forcefullyCrashRenderer();
    });
    await expect.poll(() => fixture.page.evaluate(() =>
      window.gwNative.accounts.get().then((state) => state.profiles.find((profile) => profile.name === "Primary")),
    )).toMatchObject({ state: "failed", launchIssue: "renderer-crash" });
    expect(await fixture.app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows().find((win) => win.getTitle().endsWith("Accounts"))?.isVisible(),
    )).toBe(true);
    expect(await fixture.app.evaluate(({ BrowserWindow }) => {
      const alt = BrowserWindow.getAllWindows().find((win) => win.getTitle().endsWith("Alt"));
      return !!alt && !alt.webContents.isCrashed();
    })).toBe(true);
  } finally {
    await closeOffline(fixture);
  }
});

test("Multi starts at the Hub and isolates two profile windows from Single", async () => {
  const fixture = await launchOffline("gw-multi-e2e-", {
    GW_BACKGROUND_LAUNCH: "0",
  }, async (userData) => {
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
    await expect(fixture.page.locator("h1")).toHaveText("Choose Accounts");
    const state = await fixture.page.evaluate(() => window.gwNative.accounts.get());
    expect(state.mode).toBe("multi");
    expect(state.profiles.map((profile) => profile.name)).toEqual(["Primary", "Alt"]);

    await fixture.page.getByRole("checkbox", { name: "Select Primary" }).check();
    await expect(fixture.page.getByRole("button", { name: "Open Primary" })).toBeVisible();
    await fixture.page.getByRole("checkbox", { name: "Select Alt" }).check();
    await expect(fixture.page.getByRole("button", { name: "Open 2 Accounts" })).toBeVisible();
    await fixture.page.getByRole("button", { name: "Open 2 Accounts" }).click();
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
    const presentation = await fixture.app.evaluate(({ BrowserWindow }) => {
      const windows = BrowserWindow.getAllWindows();
      return {
        focused: BrowserWindow.getFocusedWindow()?.getTitle(),
        hubVisible: windows.find((win) => win.getTitle() === "Guild Wars Reforged — Accounts")?.isVisible(),
        bounds: Object.fromEntries(windows
          .filter((win) => win.getTitle() !== "Guild Wars Reforged — Accounts")
          .map((win) => [win.getTitle(), win.getBounds()])),
      };
    });
    expect(presentation.focused).toBe("Guild Wars Reforged — Primary");
    expect(presentation.hubVisible).toBe(false);
    const primaryBounds = presentation.bounds["Guild Wars Reforged — Primary"]!;
    const altBounds = presentation.bounds["Guild Wars Reforged — Alt"]!;
    expect(altBounds.x - primaryBounds.x).toBe(32);
    expect(altBounds.y - primaryBounds.y).toBe(32);
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
      templateEntries: [{
        path: "Skills/Imported.txt",
        contents: "OQCiUyo8AkVwR4KMMGAAAEAA",
      }],
    }));
    expect(JSON.parse(await readFile(
      path.join(fixture.userData, "launcher-mode.json"),
      "utf8",
    ))).toEqual({ formatVersion: 1, mode: "multi" });
    const workspace = JSON.parse(await readFile(
      path.join(fixture.userData, "multi", "workspace.json"),
      "utf8",
    )) as { profiles: Array<{ id: string; name: string }> };
    expect(workspace.profiles).toEqual([]);
    expect(await readFile(path.join(fixture.userData, "build-library.json"), "utf8"))
      .toBe(singleLibrary);
    expect(JSON.parse(await readFile(
      path.join(fixture.userData, "multi", "single-template-import.json"),
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

test("the empty Hub owns first-account creation and optional Single Account copies", async () => {
  const singleLibrary = { version: 3, builds: [], teams: [], tags: ["single"] };
  const fixture = await launchOffline("gw-multi-first-account-e2e-", {}, async (userData) => {
    await mkdir(path.join(userData, "multi"), { recursive: true });
    await writeFile(
      path.join(userData, "launcher-mode.json"),
      JSON.stringify({ formatVersion: 1, mode: "multi" }),
    );
    await writeFile(
      path.join(userData, "multi", "workspace.json"),
      JSON.stringify({ formatVersion: 1, profiles: [] }),
    );
    await writeFile(
      path.join(userData, "multi", "single-template-import.json"),
      JSON.stringify({
        formatVersion: 1,
        revision: 1,
        entries: [{
          path: "Skills/Imported.txt",
          contents: "OQCiUyo8AkVwR4KMMGAAAEAA",
        }],
      }),
    );
    await writeFile(path.join(userData, "build-library.json"), JSON.stringify(singleLibrary));
  });
  try {
    await expect(fixture.page.getByRole("heading", { name: "No accounts yet" })).toBeVisible();
    await expect(fixture.page.getByRole("button", { name: "Create First Account" })).toBeVisible();
    await expect(fixture.page.getByRole("button", { name: "New Account…" })).toBeHidden();

    await fixture.page.getByRole("button", { name: "Create First Account" }).click();
    const dialog = fixture.page.getByRole("dialog", { name: "Create First Account" });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText("Start with Single Account data")).toBeVisible();
    await dialog.getByLabel("Account name").fill("Main");
    await dialog.getByLabel("Copy builds and teams").check();
    await dialog.getByLabel("Copy in-game templates").check();
    await dialog.getByRole("button", { name: "Create First Account" }).click();

    await expect(fixture.page.getByRole("checkbox", { name: "Select Main" })).toBeVisible();
    const workspace = JSON.parse(await readFile(
      path.join(fixture.userData, "multi", "workspace.json"),
      "utf8",
    )) as { profiles: Array<{ id: string; name: string }> };
    expect(workspace.profiles.map((profile) => profile.name)).toEqual(["Main"]);
    expect(JSON.parse(await readFile(
      path.join(fixture.userData, "multi", "shared", "build-library.json"),
      "utf8",
    ))).toEqual(singleLibrary);
    expect(JSON.parse(await readFile(
      path.join(fixture.userData, "multi", "shared", "templates.json"),
      "utf8",
    ))).toMatchObject({ entries: [{ path: "Skills/Imported.txt" }] });
    await expect(stat(path.join(
      fixture.userData,
      "multi",
      "single-template-import.json",
    ))).rejects.toMatchObject({ code: "ENOENT" });
    expect(await readFile(path.join(fixture.userData, "build-library.json"), "utf8"))
      .toBe(JSON.stringify(singleLibrary));
  } finally {
    await closeOffline(fixture);
  }
});
