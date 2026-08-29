/** End-to-end proof for the unified launcher and profile window foundation. */
import { expect, test } from "@playwright/test";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  LEGACY_PRIMARY_PROFILE_ID,
  type ProfileId,
} from "../../src/shared/multiple-accounts.js";
import { seedLauncherProfileFixture } from "../helpers/launcher-profile-fixtures.js";
import {
  closeOffline,
  launchCachedClient,
  launchOffline,
  launchOfflineAt,
  root,
} from "./fixtures.mjs";

declare global {
  var __forcedCandidateHealthToken: object | null;
  var __healthTokenDescriptor: PropertyDescriptor | undefined;
  interface Window {
    __concurrentProfileOpen?: Promise<void>;
  }
}

const FIRST = "00000000-0000-4000-8000-000000000001";
const SECOND = "00000000-0000-4000-8000-000000000002";

async function seedTwoProfiles(userData: string): Promise<void> {
  await mkdir(path.join(userData, "multi"), { recursive: true });
  await writeFile(path.join(userData, "multi", "workspace.json"), JSON.stringify({
    formatVersion: 1,
    deletingProfileIds: [],
    profiles: [
      { id: FIRST, name: "Primary", archived: false, templates: "shared", builds: "shared" },
      { id: SECOND, name: "Alt", archived: false, templates: "shared", builds: "shared" },
    ],
  }));
}

test("fresh startup creates Main and adds an account without restart", async () => {
  const fixture = await launchCachedClient("gw-launcher-fresh-", {
    GW_TEST_RETURN_LAUNCHER: "1",
  });
  try {
    await expect(fixture.page).toHaveURL("gw://app/launcher/index.html");
    await expect(fixture.page.getByRole("button", { name: "Play" })).toBeVisible();
    await fixture.page.getByRole("button", { name: "Accounts" }).click();
    await expect(fixture.page.getByText("Main account", { exact: true })).toBeVisible();
    const processId = fixture.app.process().pid;

    await fixture.page.getByRole("button", { name: "Add account" }).click();
    await fixture.page.getByLabel("Name").fill("Second account");
    await fixture.page.getByRole("button", { name: "Add account", exact: true }).last().click();
    await expect(fixture.page.getByText("Second account", { exact: true })).toBeVisible();
    expect(fixture.app.process().pid).toBe(processId);

    const workspace = JSON.parse(await readFile(
      path.join(fixture.userData, "multi", "workspace.json"),
      "utf8",
    )) as { profiles: Array<{ name: string }> };
    expect(workspace.profiles.map((profile) => profile.name)).toEqual([
      "Main account",
      "Second account",
    ]);
  } finally {
    await closeOffline(fixture);
  }
});

test("serializes concurrent profile launches behind one client canary", async () => {
  const fixture = await launchOffline(
    "gw-launcher-concurrent-open-",
    { GW_TEST_RETURN_LAUNCHER: "1" },
    seedTwoProfiles,
  );
  try {
    await fixture.app.evaluate((_electron, modulePath) => {
      const load = process.getBuiltinModule("node:module").createRequire(modulePath);
      const { ClientRuntime } = load(modulePath);
      globalThis.__healthTokenDescriptor = Object.getOwnPropertyDescriptor(
        ClientRuntime.prototype,
        "healthToken",
      );
      globalThis.__forcedCandidateHealthToken = {
        generation: 999,
        fingerprint: "a".repeat(64),
      };
      Object.defineProperty(ClientRuntime.prototype, "healthToken", {
        configurable: true,
        get: () => globalThis.__forcedCandidateHealthToken,
      });
    }, path.join(root, "build/main/client-runtime.js"));

    await fixture.page.evaluate(([first, second]) => {
      window.__concurrentProfileOpen = Promise.all([
        window.launcherNative.profiles.play([first as ProfileId]),
        window.launcherNative.profiles.play([second as ProfileId]),
      ]).then(() => undefined);
    }, [FIRST, SECOND] as const);

    const gameCount = () => fixture.app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows().filter(
        (win) => win.webContents.getURL() === "gw://app/",
      ).length,
    );
    await expect.poll(gameCount).toBe(1);
    await fixture.page.waitForTimeout(500);
    expect(await gameCount()).toBe(1);

    await fixture.app.evaluate(() => {
      globalThis.__forcedCandidateHealthToken = null;
    });
    await fixture.page.evaluate(() => window.__concurrentProfileOpen);
    await expect.poll(gameCount).toBe(2);
  } finally {
    await fixture.app.evaluate((_electron, modulePath) => {
      const descriptor = globalThis.__healthTokenDescriptor;
      if (!descriptor) return;
      const load = process.getBuiltinModule("node:module").createRequire(modulePath);
      const { ClientRuntime } = load(modulePath);
      Object.defineProperty(ClientRuntime.prototype, "healthToken", descriptor);
      globalThis.__forcedCandidateHealthToken = null;
      globalThis.__healthTokenDescriptor = undefined;
    }, path.join(root, "build/main/client-runtime.js")).catch(() => undefined);
    await closeOffline(fixture);
  }
});

test("publishes global Settings changes to every open profile", async () => {
  const fixture = await launchOffline(
    "gw-launcher-settings-broadcast-",
    { GW_TEST_RETURN_LAUNCHER: "1" },
    seedTwoProfiles,
  );
  try {
    await fixture.page.evaluate(
      ([first, second]) => window.launcherNative.profiles.play(
        [first, second] as ProfileId[],
      ),
      [FIRST, SECOND] as const,
    );
    await expect.poll(() => fixture.app.windows().filter(
      (page) => page.url() === "gw://app/",
    ).length).toBe(2);
    const games = fixture.app.windows().filter((page) => page.url() === "gw://app/");
    const primary = games[0];
    const alt = games[1];
    if (!primary || !alt) throw new Error("both profile renderers are required");
    await Promise.all(games.map((game) => game.waitForLoadState("domcontentloaded")));

    await alt.evaluate(() => window.gwNative.settings.set({
      uiStyle: "obsidian",
      targetReadout: true,
      shortcutOverrides: {
        "tools.toggle": { key: "k", shift: false, option: false },
      },
    }));

    await expect.poll(() => primary.evaluate(async () => ({
      style: document.documentElement.dataset.uiStyle,
      targetReadout: window.gwToolsSettings().targetReadout,
      shortcut: (await window.gwNative.settings.get())
        .shortcutOverrides["tools.toggle"]?.key,
    }))).toEqual({ style: "obsidian", targetReadout: true, shortcut: "k" });
  } finally {
    await closeOffline(fixture);
  }
});

test("an existing Single account is adopted and remains isolated from a new profile", async () => {
  const fixture = await launchCachedClient(
    "gw-launcher-adopted-",
    { GW_TEST_RETURN_LAUNCHER: "1" },
    (userData) => seedLauncherProfileFixture(userData, "single"),
  );
  try {
    await expect(fixture.page.getByText("Ready to play")).toBeVisible({ timeout: 30_000 });
    const state = await fixture.page.evaluate(() => window.launcherNative.state.get());
    expect(state.profiles[0]?.id).toBe(LEGACY_PRIMARY_PROFILE_ID);

    await fixture.page.getByRole("button", { name: "Add account" }).click();
    await fixture.page.getByLabel("Name").fill("Second account");
    await fixture.page.getByRole("button", { name: "Add account", exact: true }).last().click();

    await fixture.page.getByRole("button", { name: "Play Main account" }).click();
    await expect.poll(() => fixture.app.windows().length).toBe(2);
    await fixture.page.getByRole("button", { name: "Play Second account" }).click();
    await expect.poll(() => fixture.app.windows().length).toBe(3);

    const games = fixture.app.windows().filter((page) => page.url() === "gw://app/");
    expect(games).toHaveLength(2);
    await Promise.all(games.map((page) => page.waitForLoadState("domcontentloaded")));
    const storagePaths = await fixture.app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()
        .filter((win) => win.webContents.getURL() === "gw://app/")
        .map((win) => win.webContents.session.storagePath),
    );
    expect(storagePaths.some((value) => !value?.includes("Partitions/gw-multi-"))).toBe(true);
    expect(storagePaths.some((value) => value?.includes("Partitions/gw-multi-"))).toBe(true);

    await games[0]!.evaluate(() => localStorage.setItem("profile-proof", "first"));
    await games[1]!.evaluate(() => localStorage.setItem("profile-proof", "second"));
    expect(await games[0]!.evaluate(() => localStorage.getItem("profile-proof"))).toBe("first");
    expect(await games[1]!.evaluate(() => localStorage.getItem("profile-proof"))).toBe("second");
  } finally {
    await closeOffline(fixture);
  }
});

test("Show never duplicates a game and companion close policy stays profile-local", async () => {
  const fixture = await launchCachedClient(
    "gw-launcher-companion-",
    { GW_BACKGROUND_LAUNCH: "0", GW_TEST_RETURN_LAUNCHER: "1" },
  );
  try {
    await expect(fixture.page.getByText("Ready to play")).toBeVisible({ timeout: 30_000 });
    await fixture.page.getByRole("button", { name: "Play Main account" }).click();
    await expect.poll(() => fixture.app.windows().length).toBe(2);
    await expect.poll(() => fixture.app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows().find((win) => win.webContents.getURL() === "gw://app/")?.isFocused(),
    )).toBe(true);
    await expect(fixture.page.getByRole("button", { name: "Show Main account" })).toBeVisible();

    await fixture.app.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()
        .find((win) => win.webContents.getURL() === "gw://app/")
        ?.minimize();
    });
    await fixture.page.getByRole("button", { name: "Show Main account" }).click();
    expect(fixture.app.windows()).toHaveLength(2);
    await expect.poll(() => fixture.app.evaluate(({ BrowserWindow }) => {
      const game = BrowserWindow.getAllWindows()
        .find((win) => win.webContents.getURL() === "gw://app/");
      return game ? { focused: game.isFocused(), minimized: game.isMinimized() } : null;
    })).toEqual({ focused: true, minimized: false });

    await fixture.app.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()
        .find((win) => win.webContents.getURL().endsWith("launcher/index.html"))
        ?.close();
    });
    await expect.poll(() => fixture.app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows().find((win) => win.webContents.getURL().endsWith("launcher/index.html"))?.isVisible(),
    )).toBe(false);
    await fixture.app.evaluate(({ app }) => app.emit("activate"));
    await expect.poll(() => fixture.app.evaluate(({ BrowserWindow }) => {
      const launcher = BrowserWindow.getAllWindows()
        .find((win) => win.webContents.getURL().endsWith("launcher/index.html"));
      return launcher ? { focused: launcher.isFocused(), visible: launcher.isVisible() } : null;
    })).toEqual({ focused: true, visible: true });

    const game = fixture.app.windows().find((page) => page.url() === "gw://app/");
    if (!game) throw new Error("game window is required");
    await fixture.app.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()
        .find((win) => win.webContents.getURL() === "gw://app/")
        ?.close();
    });
    await expect.poll(() => fixture.app.windows().length).toBe(1);
    await expect(fixture.page.locator("body")).toBeVisible();
  } finally {
    await closeOffline(fixture);
  }
});

test("the account workspace survives a full application restart", async () => {
  const first = await launchCachedClient("gw-launcher-restart-", {
    GW_TEST_RETURN_LAUNCHER: "1",
  });
  let restarted: Awaited<ReturnType<typeof launchOfflineAt>> | null = null;
  try {
    await first.page.getByRole("button", { name: "Add account" }).click();
    await first.page.getByLabel("Name").fill("Second account");
    await first.page.getByRole("button", { name: "Add account", exact: true }).last().click();
    await expect(first.page.getByText("Second account", { exact: true })).toBeVisible();
    await first.app.close();

    restarted = await launchOfflineAt(first.userData, {
      GW_TEST_RETURN_LAUNCHER: "1",
    });
    await expect(restarted.page.getByText("Main account", { exact: true })).toBeVisible();
    await expect(restarted.page.getByText("Second account", { exact: true })).toBeVisible();
  } finally {
    if (restarted) await closeOffline(restarted);
    else await closeOffline(first);
  }
});

test("renderer recovery stays inside one profile and closes with honest state", async () => {
  const fixture = await launchCachedClient("gw-launcher-recovery-", {
    GW_TEST_RETURN_LAUNCHER: "1",
  });
  try {
    await fixture.page.getByRole("button", { name: "Add account" }).click();
    await fixture.page.getByLabel("Name").fill("Second account");
    await fixture.page.getByRole("button", { name: "Add account", exact: true }).last().click();
    await fixture.page.getByRole("button", { name: "Play Main account" }).click();
    await fixture.page.getByRole("button", { name: "Play Second account" }).click();
    await expect.poll(() => fixture.app.windows().filter((page) => page.url() === "gw://app/").length)
      .toBe(2);

    const mainWindowId = await fixture.app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows().find((win) => win.getTitle().endsWith("Main account"))?.id,
    );
    if (!mainWindowId) throw new Error("Main account window is required");
    await fixture.app.evaluate(({ BrowserWindow }, id) => {
      BrowserWindow.fromId(id)?.webContents.forcefullyCrashRenderer();
    }, mainWindowId);
    await expect.poll(() => fixture.app.evaluate(({ BrowserWindow }, id) => {
      const replacement = BrowserWindow.getAllWindows()
        .find((win) => win.getTitle().endsWith("Main account"));
      return replacement && replacement.id !== id ? replacement.id : null;
    }, mainWindowId), { timeout: 15_000 }).not.toBeNull();
    expect(fixture.app.windows().filter((page) => page.url() === "gw://app/")).toHaveLength(2);

    await fixture.app.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()
        .find((win) => win.getTitle().endsWith("Main account"))
        ?.close();
    });
    await expect(fixture.page.getByRole("button", { name: "Play Main account" })).toBeVisible();
    await expect(fixture.page.getByRole("button", { name: "Show Second account" })).toBeVisible();
    await expect.poll(() => fixture.app.windows().filter((page) => page.url() === "gw://app/").length)
      .toBe(1);
  } finally {
    await closeOffline(fixture);
  }
});

test("mandatory client repair blocks Play and offers a local retry", async () => {
  const fixture = await launchOffline("gw-launcher-repair-", {
    GW_TEST_ALLOW_UNREADY_LAUNCH: "0",
    GW_TEST_RETURN_LAUNCHER: "1",
  });
  try {
    await expect(fixture.page.getByText("Game files need attention")).toBeVisible({
      timeout: 30_000,
    });
    await expect(fixture.page.getByRole("button", { name: "Retry", exact: true })).toBeVisible();
    await fixture.page.getByRole("button", { name: "Play Main account" }).click();
    await expect(fixture.page.getByRole("button", { name: "Retry Main account" })).toBeVisible();
    expect(fixture.app.windows().filter((page) => page.url() === "gw://app/")).toHaveLength(0);

    await fixture.page.getByRole("button", { name: "Retry", exact: true }).first().click();
    await expect(fixture.page.getByText(/Game files .*attention/u)).toBeVisible({
      timeout: 30_000,
    });
  } finally {
    await closeOffline(fixture);
  }
});
