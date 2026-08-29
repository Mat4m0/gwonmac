/** End-to-end proof for the unified launcher and profile window foundation. */
import { expect, test } from "@playwright/test";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
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
const PRESENTING_CLIENT_GLUE = `
var testGraphics = {
  eglCreateContext: function () {
    return Module.canvas.getContext("webgl") ? 1 : 0;
  },
  eglSwapBuffers: function () { return 1; },
  emscripten_get_device_pixel_ratio: function () { return 1; },
  emscripten_set_canvas_element_size: function (_target, width, height) {
    Module.canvas.width = width;
    Module.canvas.height = height;
    return 0;
  }
};
Module.instantiateWasm({ env: testGraphics }, function () {
  Module.onRuntimeInitialized();
  addEventListener("gw-test-submit-frame", function () {
    testGraphics.eglCreateContext();
    var gl = Module.canvas.getContext("webgl");
    if (gl) {
      gl.clearColor(0.1, 0.2, 0.3, 1);
      gl.clear(gl.COLOR_BUFFER_BIT);
    }
    testGraphics.eglSwapBuffers();
  }, { once: true });
});
`;

for (const scenario of ["multi", "mixed", "interrupted"] as const) {
  test(`${scenario} account data bootstraps into the unified launcher`, async () => {
    test.setTimeout(60_000);
    const fixture = await launchCachedClient(`gw-${scenario}-bootstrap-`, {
      GW_TEST_RETURN_LAUNCHER: "1",
    }, (userData) => seedLauncherProfileFixture(userData, scenario));
    let restarted: Awaited<ReturnType<typeof launchOfflineAt>> | null = null;
    try {
      const launcherModePath = path.join(fixture.userData, "launcher-mode.json");
      const launcherModeBefore = await readFile(launcherModePath).catch(() => null);
      const snapshot = await fixture.page.evaluate(() => window.launcherNative.state.get());
      expect(snapshot.experience.installationKind).toBe(
        scenario === "multi" ? "migrated-multi" : scenario === "mixed" ? "mixed" : "fresh",
      );
      expect(snapshot.profiles.map(({ name }) => name)).toEqual(
        scenario === "multi"
          ? ["Existing account"]
          : scenario === "mixed"
            ? ["Main account", "Existing account"]
            : ["Main account"],
      );
      expect(snapshot.experience.setup).toBe(scenario === "interrupted" ? "pending" : "complete");
      if (scenario === "interrupted") {
        expect((await readFile(path.join(fixture.userData, "multi", "workspace.json.1234.abcdef12.tmp"), "utf8").catch(() => null))).toBeNull();
      }
      const workspaceAfterBootstrap = await readFile(
        path.join(fixture.userData, "multi", "workspace.json"),
      );
      const launcherStateAfterBootstrap = await readFile(
        path.join(fixture.userData, "launcher-state.json"),
      );

      await fixture.app.close();
      restarted = await launchOfflineAt(fixture.userData, {
        GW_TEST_RETURN_LAUNCHER: "1",
      });
      const afterRestart = await restarted.page.evaluate(() => window.launcherNative.state.get());
      expect(afterRestart.experience.installationKind).toBe(snapshot.experience.installationKind);
      expect(afterRestart.experience.setup).toBe(snapshot.experience.setup);
      expect(afterRestart.profiles.map(({ id, name }) => ({ id, name }))).toEqual(
        snapshot.profiles.map(({ id, name }) => ({ id, name })),
      );
      expect(await readFile(launcherModePath).catch(() => null)).toEqual(launcherModeBefore);
      expect(await readFile(path.join(fixture.userData, "multi", "workspace.json")))
        .toEqual(workspaceAfterBootstrap);
      expect(await readFile(path.join(fixture.userData, "launcher-state.json")))
        .toEqual(launcherStateAfterBootstrap);
    } finally {
      if (restarted) await closeOffline(restarted);
      else await closeOffline(fixture);
    }
  });
}

test("corrupt launcher preferences recover conservatively and remain visible across restart", async () => {
  const corruptBytes = Buffer.from("{not-json\n");
  const fixture = await launchCachedClient(
    "gw-launcher-corrupt-state-",
    { GW_TEST_RETURN_LAUNCHER: "1" },
    async (userData) => {
      await seedLauncherProfileFixture(userData, "single");
      await writeFile(path.join(userData, "launcher-state.json"), corruptBytes, { mode: 0o600 });
    },
  );
  let restarted: Awaited<ReturnType<typeof launchOfflineAt>> | null = null;
  let acknowledged: Awaited<ReturnType<typeof launchOfflineAt>> | null = null;
  try {
    const first = await fixture.page.evaluate(() => window.launcherNative.state.get());
    expect(first.experience.installationKind).toBe("migrated-single");
    expect(first.experience.setup).toBe("complete");
    expect(first.experience.preferencesReset).toBe(true);
    await expect(fixture.page.getByText("Launcher preferences were reset.")).toBeVisible();
    const backupName = (await readdir(fixture.userData))
      .find((name) => name.startsWith("launcher-state.json.corrupt-"));
    expect(backupName).toBeTruthy();
    expect(await readFile(path.join(fixture.userData, backupName!))).toEqual(corruptBytes);

    await fixture.app.close();
    restarted = await launchOfflineAt(fixture.userData, {
      GW_TEST_RETURN_LAUNCHER: "1",
    });
    expect((await restarted.page.evaluate(() => window.launcherNative.state.get()))
      .experience.preferencesReset).toBe(true);
    await expect(restarted.page.getByText("Launcher preferences were reset.")).toBeVisible();
    await restarted.page.getByRole("button", { name: "Dismiss" }).click();
    await expect(restarted.page.getByText("Your existing account is ready.")).toBeVisible();
    await restarted.page.getByRole("button", { name: "Dismiss" }).click();

    await restarted.app.close();
    acknowledged = await launchOfflineAt(fixture.userData, {
      GW_TEST_RETURN_LAUNCHER: "1",
    });
    expect((await acknowledged.page.evaluate(() => window.launcherNative.state.get()))
      .experience.preferencesReset).toBe(false);
    await expect(acknowledged.page.getByText("Launcher preferences were reset.")).toHaveCount(0);
  } finally {
    if (acknowledged) await closeOffline(acknowledged);
    else if (restarted) await closeOffline(restarted);
    else await closeOffline(fixture);
  }
});

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
    await fixture.page.getByRole("button", { name: "Continue" }).click();
    await fixture.page.getByRole("button", { name: "Not now" }).click();
    await fixture.page.getByRole("button", { name: "Skip" }).click();
    await expect(fixture.page.getByRole("button", { name: "Play" })).toBeVisible();
    await fixture.page.getByRole("button", { name: "Accounts", exact: true }).click();
    await expect(fixture.page.getByText("Main account", { exact: true })).toBeVisible();
    const processId = fixture.app.process().pid;

    await fixture.page.getByRole("button", { name: "Add account" }).click();
    await fixture.page.getByLabel("Name").fill("Second account");
    await fixture.page.getByText("Appearance", { exact: true }).click();
    await fixture.page.getByRole("button", { name: "map" }).click();
    await fixture.page.getByRole("button", { name: "Use #46658a" }).click();
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
    const appearance = await fixture.page.evaluate(async () =>
      (await window.launcherNative.state.get()).profiles.find((profile) => profile.name === "Second account")?.appearance);
    expect(appearance).toEqual({ icon: "map", color: "#46658a" });
  } finally {
    await closeOffline(fixture);
  }
});

test("serializes concurrent profile launches behind one client canary", async () => {
  const fixture = await launchCachedClient(
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

test("publishes global Tool changes to every open profile", async () => {
  const fixture = await launchCachedClient(
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
    await Promise.all(games.map((game) => game.waitForLoadState("domcontentloaded")));

    await fixture.page.evaluate(async () => {
      await window.launcherNative.tools.setMasterEnabled(true);
      await window.launcherNative.tools.setFeature({
        tool: "quick-travel",
        enabled: true,
      });
    });

    await expect.poll(() => Promise.all(games.map((game) =>
      game.evaluate(() => window.gwToolsSettings().travelPalette),
    ))).toEqual([true, true]);
  } finally {
    await closeOffline(fixture);
  }
});

test("an existing Single account is adopted before a new profile is added", async () => {
  const fixture = await launchCachedClient(
    "gw-launcher-adopted-",
    { GW_TEST_RETURN_LAUNCHER: "1" },
    (userData) => seedLauncherProfileFixture(userData, "single"),
  );
  try {
    await expect(fixture.page.getByText("Ready to play")).toBeVisible({ timeout: 30_000 });
    await fixture.app.evaluate(({ app, BrowserWindow }) => {
      app.focus({ steal: true });
      const launcher = BrowserWindow.getAllWindows()
        .find((win) => win.webContents.getURL().endsWith("launcher/index.html"));
      launcher?.show();
      launcher?.focus();
    });
    const state = await fixture.page.evaluate(() => window.launcherNative.state.get());
    expect(state.profiles[0]?.id).toBe(LEGACY_PRIMARY_PROFILE_ID);

    await fixture.page.getByRole("button", { name: "Accounts", exact: true }).click();
    await fixture.page.getByRole("button", { name: "Add account" }).click();
    await fixture.page.getByLabel("Name").fill("Second account");
    await fixture.page.getByRole("button", { name: "Add account", exact: true }).last().click();
    await expect(fixture.page.getByText("Second account", { exact: true })).toBeVisible();

    const profiles = await fixture.page.evaluate(() =>
      window.launcherNative.state.get().then((snapshot) => snapshot.profiles));
    expect(profiles.map(({ id, name }) => ({ id, name }))).toEqual([
      { id: LEGACY_PRIMARY_PROFILE_ID, name: "Main account" },
      { id: profiles[1]!.id, name: "Second account" },
    ]);
    expect(profiles[1]!.id).not.toBe(LEGACY_PRIMARY_PROFILE_ID);
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
    await fixture.page.evaluate(async () => {
      const id = (await window.launcherNative.state.get()).profiles[0]?.id;
      if (!id) throw new Error("Main account is required");
      window.__concurrentProfileOpen = window.launcherNative.profiles.play([id]);
    });
    await expect.poll(() => fixture.app.windows().length).toBe(2);
    const startedGame = fixture.app.windows().find((page) => page.url() === "gw://app/");
    if (!startedGame) throw new Error("game window is required");
    await startedGame.evaluate(() => window.gwNative.client.readyToPresent());
    await fixture.page.evaluate(() => window.__concurrentProfileOpen);
    await expect.poll(() => fixture.page.evaluate(() =>
      window.launcherNative.state.get().then((snapshot) => snapshot.profiles[0]?.state),
    )).toBe("running");

    await fixture.app.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()
        .find((win) => win.webContents.getURL() === "gw://app/")
        ?.minimize();
    });
    const profileId = await fixture.page.evaluate(() =>
      window.launcherNative.state.get().then((snapshot) => snapshot.profiles[0]!.id));
    await fixture.page.evaluate((id) => window.launcherNative.profiles.show(id), profileId);
    expect(fixture.app.windows()).toHaveLength(2);
    await expect.poll(() => fixture.app.evaluate(({ BrowserWindow }) => {
      const game = BrowserWindow.getAllWindows()
        .find((win) => win.webContents.getURL() === "gw://app/");
      return game ? { visible: game.isVisible(), minimized: game.isMinimized() } : null;
    })).toEqual({ visible: true, minimized: false });

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
      return launcher?.isVisible() ?? false;
    })).toBe(true);

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
  test.setTimeout(60_000);
  const first = await launchCachedClient("gw-launcher-restart-", {
    GW_TEST_RETURN_LAUNCHER: "1",
  });
  let restarted: Awaited<ReturnType<typeof launchOfflineAt>> | null = null;
  try {
    await first.page.getByRole("button", { name: "Continue" }).click();
    await first.page.getByRole("button", { name: "Not now" }).click();
    await first.page.getByRole("button", { name: "Skip" }).click();
    await first.page.getByRole("button", { name: "Accounts", exact: true }).click();
    await first.page.getByRole("button", { name: "Add account" }).click();
    await first.page.getByLabel("Name").fill("Second account");
    await first.page.getByRole("button", { name: "Add account", exact: true }).last().click();
    await expect(first.page.getByText("Second account", { exact: true })).toBeVisible();
    await first.app.close();

    restarted = await launchOfflineAt(first.userData, {
      GW_TEST_RETURN_LAUNCHER: "1",
    });
    await restarted.page.getByRole("button", { name: "Accounts", exact: true }).click();
    await expect(restarted.page.getByText("Main account", { exact: true })).toBeVisible();
    await expect(restarted.page.getByText("Second account", { exact: true })).toBeVisible();
  } finally {
    if (restarted) await closeOffline(restarted);
    else await closeOffline(first);
  }
});

test("global map settings live in the launcher and survive restart", async () => {
  test.setTimeout(60_000);
  const first = await launchOffline("gw-launcher-maps-", {
    GW_TEST_RETURN_LAUNCHER: "1",
  });
  let restarted: Awaited<ReturnType<typeof launchOfflineAt>> | null = null;
  try {
    await first.page.getByRole("button", { name: "Continue" }).click();
    await first.page.getByRole("button", { name: "Not now" }).click();
    await first.page.getByRole("button", { name: "Skip" }).click();
    await first.page.getByRole("button", { name: "Settings" }).click();
    await first.page.getByRole("button", { name: "Maps" }).click();
    await expect(first.page.getByRole("heading", { name: "Maps" })).toBeVisible();
    await first.page.getByLabel("Exploration grid").check();
    await first.page.getByRole("button", { name: "Customize style" }).click();
    await expect(first.page.getByText("Custom style", { exact: true })).toBeVisible();
    const beforeRestart = await first.page.evaluate(() => window.launcherNative.state.get());
    expect(beforeRestart.settings.cartographyGridEnabled).toBe(true);
    expect(beforeRestart.settings.cartographyPresetLibrary.activePreset.kind).toBe("custom");
    await first.app.close();

    restarted = await launchOfflineAt(first.userData, {
      GW_TEST_RETURN_LAUNCHER: "1",
    });
    const afterRestart = await restarted.page.evaluate(() => window.launcherNative.state.get());
    expect(afterRestart.settings.cartographyGridEnabled).toBe(true);
    expect(afterRestart.settings.cartographyPresetLibrary.activePreset).toEqual(
      beforeRestart.settings.cartographyPresetLibrary.activePreset,
    );
  } finally {
    if (restarted) await closeOffline(restarted);
    else await closeOffline(first);
  }
});

test("renderer recovery stays inside one profile and leaves the launcher alive", async () => {
  const fixture = await launchCachedClient("gw-launcher-recovery-", {
    GW_TEST_RETURN_LAUNCHER: "1",
  });
  try {
    await fixture.page.getByRole("button", { name: "Continue" }).click();
    await fixture.page.getByRole("button", { name: "Not now" }).click();
    await fixture.page.getByRole("button", { name: "Skip" }).click();
    await fixture.page.evaluate(async () => {
      const id = (await window.launcherNative.state.get()).profiles[0]!.id;
      window.__concurrentProfileOpen = window.launcherNative.profiles.play([id]);
    });
    await expect.poll(() => fixture.app.windows().filter((page) => page.url() === "gw://app/").length)
      .toBe(1);
    const initialGame = fixture.app.windows().find((page) => page.url() === "gw://app/");
    if (!initialGame) throw new Error("Main account game window is required");
    await initialGame.evaluate(() => window.gwNative.client.readyToPresent());
    await fixture.page.evaluate(() => window.__concurrentProfileOpen);

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
    await expect.poll(() =>
      fixture.app.windows().filter((page) => page.url() === "gw://app/").length,
    ).toBe(1);

    await fixture.app.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()
        .find((win) => win.getTitle().endsWith("Main account"))
        ?.close();
    });
    await expect.poll(() => fixture.app.windows().filter((page) => page.url() === "gw://app/").length)
      .toBe(0);
    await expect(fixture.page.locator("body")).toBeVisible();
  } finally {
    await closeOffline(fixture);
  }
});

test("mandatory client repair blocks Play without rejecting and stays global", async () => {
  const fixture = await launchOffline("gw-launcher-repair-", {
    GW_TEST_ALLOW_UNREADY_LAUNCH: "0",
    GW_TEST_RETURN_LAUNCHER: "1",
  });
  try {
    await fixture.page.getByRole("button", { name: "Continue" }).click();
    await fixture.page.getByRole("button", { name: "Not now" }).click();
    await fixture.page.getByRole("button", { name: "Skip" }).click();
    await expect(fixture.page.getByText("Game files need repair").first()).toBeVisible({
      timeout: 30_000,
    });
    const outcome = await fixture.page.evaluate(async () => {
      const id = (await window.launcherNative.state.get()).profiles[0]!.id;
      await window.launcherNative.profiles.play([id]);
      return window.launcherNative.state.get();
    });
    expect(outcome.readiness.state).toBe("repair-required");
    expect(outcome.profiles[0]?.state).toBe("ready");
    expect(fixture.app.windows().filter((page) => page.url() === "gw://app/")).toHaveLength(0);
    await fixture.page.locator(".priority-banner").getByRole("button", { name: "Open Game Files" }).click();
    await expect(fixture.page.getByRole("button", { name: "Repair game files" })).toBeVisible();
  } finally {
    await closeOffline(fixture);
  }
});

test("a production renderer reveals the game only after its first submitted frame", async () => {
  const fixture = await launchCachedClient("gw-first-frame-cutover-", {
    GW_TEST_RETURN_LAUNCHER: "1",
    GW_TEST_ALLOW_UNREADY_LAUNCH: "0",
    GW_BACKGROUND_LAUNCH: "0",
  }, async () => {}, { glue: PRESENTING_CLIENT_GLUE });
  try {
    await fixture.app.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()
        .find((win) => win.webContents.getURL().endsWith("launcher/index.html"))
        ?.focus();
    });
    const id = await fixture.page.evaluate(async () =>
      (await window.launcherNative.state.get()).profiles[0]!.id);
    await fixture.page.evaluate((profileId) => {
      window.__concurrentProfileOpen = window.launcherNative.profiles.play([
        profileId as ProfileId,
      ]);
    }, id);
    const game = await fixture.app.waitForEvent("window");
    await game.waitForLoadState("domcontentloaded");
    expect(await fixture.app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows().find((win) =>
        win.webContents.getURL() === "gw://app/")?.isVisible() ?? true,
    )).toBe(false);
    expect(await game.evaluate(() => ({
      canvas: document.querySelectorAll("canvas").length,
      launcherBridge: typeof (window as Window & { launcherNative?: unknown }).launcherNative,
      forbiddenText: /Play Guild Wars|Check for updates|Repair game files|Settings/.test(document.body.innerText),
    }))).toEqual({ canvas: 1, launcherBridge: "undefined", forbiddenText: false });
    await expect.poll(() => game.evaluate(() =>
      performance.getEntriesByName("gw.runtime.initialized").length,
    )).toBe(1);
    await game.evaluate(() => dispatchEvent(new Event("gw-test-submit-frame")));
    await fixture.page.evaluate(() => window.__concurrentProfileOpen);
    await expect.poll(() => game.evaluate(() =>
      performance.getEntriesByName("gw.frame.first-submit").length,
    )).toBe(1);
    await expect.poll(() => fixture.app.evaluate(({ BrowserWindow }) => {
      const gameWindow = BrowserWindow.getAllWindows().find((win) =>
        win.webContents.getURL() === "gw://app/");
      return gameWindow?.isVisible() ?? false;
    })).toBe(true);
  } finally {
    await closeOffline(fixture);
  }
});

test("first-frame presentation does not steal focus after the launcher loses it", async () => {
  const fixture = await launchCachedClient("gw-first-frame-no-focus-steal-", {
    GW_TEST_RETURN_LAUNCHER: "1",
    GW_TEST_ALLOW_UNREADY_LAUNCH: "0",
    GW_BACKGROUND_LAUNCH: "0",
  }, async () => {}, { glue: PRESENTING_CLIENT_GLUE });
  try {
    const id = await fixture.page.evaluate(async () =>
      (await window.launcherNative.state.get()).profiles[0]!.id);
    await fixture.page.evaluate((profileId) => {
      window.__concurrentProfileOpen = window.launcherNative.profiles.play([profileId]);
    }, id);
    const game = await fixture.app.waitForEvent("window");
    await game.waitForLoadState("domcontentloaded");
    await expect.poll(() => game.evaluate(() =>
      performance.getEntriesByName("gw.runtime.initialized").length,
    )).toBe(1);
    await fixture.app.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()
        .find((win) => win.webContents.getURL().endsWith("launcher/index.html"))
        ?.blur();
    });
    await game.evaluate(() => dispatchEvent(new Event("gw-test-submit-frame")));
    await fixture.page.evaluate(() => window.__concurrentProfileOpen);
    await expect.poll(() => fixture.app.evaluate(({ BrowserWindow }) => {
      const gameWindow = BrowserWindow.getAllWindows().find((win) =>
        win.webContents.getURL() === "gw://app/");
      return gameWindow
        ? { visible: gameWindow.isVisible(), focused: gameWindow.isFocused() }
        : null;
    })).toEqual({ visible: true, focused: false });
  } finally {
    await closeOffline(fixture);
  }
});

test("a missing first frame times out only its profile window", async () => {
  const fixture = await launchCachedClient("gw-first-frame-timeout-", {
    GW_TEST_RETURN_LAUNCHER: "1",
    GW_TEST_ALLOW_UNREADY_LAUNCH: "0",
    GW_BACKGROUND_LAUNCH: "0",
  }, seedTwoProfiles, { glue: PRESENTING_CLIENT_GLUE });
  try {
    await fixture.app.evaluate((_electron, modulePath) => {
      const load = process.getBuiltinModule("node:module").createRequire(modulePath);
      const { ClientRuntime } = load(modulePath);
      Object.defineProperty(ClientRuntime.prototype, "healthToken", {
        configurable: true,
        get: () => null,
      });
    }, path.join(root, "build/main/client-runtime.js"));
    await fixture.page.evaluate((profileId) => {
      window.__concurrentProfileOpen = window.launcherNative.profiles.play([
        profileId as ProfileId,
      ]);
    }, FIRST);
    const healthyGame = await fixture.app.waitForEvent("window");
    await healthyGame.waitForLoadState("domcontentloaded");
    await expect.poll(() => healthyGame.evaluate(() =>
      performance.getEntriesByName("gw.runtime.initialized").length,
    )).toBe(1);
    await healthyGame.evaluate(() => dispatchEvent(new Event("gw-test-submit-frame")));
    await fixture.page.evaluate(() => window.__concurrentProfileOpen);

    await fixture.app.evaluate(() => {
      const realSetTimeout = globalThis.setTimeout;
      globalThis.setTimeout = ((handler: () => void, timeout?: number) => {
        if (timeout === 90_000) {
          globalThis.setTimeout = realSetTimeout;
          return realSetTimeout(handler, 1_000);
        }
        return realSetTimeout(handler, timeout);
      }) as typeof setTimeout;
    });
    await fixture.page.evaluate((profileId) => {
      window.__concurrentProfileOpen = window.launcherNative.profiles.play([
        profileId as ProfileId,
      ])
        .catch(() => undefined);
    }, SECOND);
    const timedOutGame = await fixture.app.waitForEvent("window");
    await timedOutGame.waitForLoadState("domcontentloaded");
    expect(await fixture.app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows().find((win) =>
        win.getTitle().endsWith("Alt"))?.isVisible() ?? true,
    )).toBe(false);
    await expect.poll(() => fixture.app.windows().filter(
      (page) => page.url() === "gw://app/",
    ).length).toBe(1);
    await expect.poll(() => fixture.page.evaluate(() =>
      window.launcherNative.state.get().then((snapshot) => snapshot.profiles.map(
        (profile) => ({ id: profile.id, state: profile.state }),
      )),
    )).toEqual([
      { id: FIRST, state: "running" },
      { id: SECOND, state: "failed" },
    ]);
    expect(healthyGame.isClosed()).toBe(false);
    await expect(fixture.page.locator("body")).toBeVisible();
  } finally {
    await closeOffline(fixture);
  }
});
