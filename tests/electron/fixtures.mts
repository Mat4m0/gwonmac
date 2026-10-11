import {
  _electron as electron,
  type ElectronApplication,
  type Locator,
  type Page,
} from "@playwright/test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  type CachedClientOptions,
  seedCachedClient,
} from "../helpers/cached-client.js";
import type { SettingsNativeApi } from "../../src/shared/launcher-contracts.js";

declare global {
  // The Settings window's bridge; specs evaluate it on the page `openSettings` returns.
  interface Window {
    settingsNative: SettingsNativeApi;
  }
}

export const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
export const main = path.join(root, "build/main/main.js");

export const electronBin = path.join(
  root,
  "node_modules/electron/dist/Electron.app/Contents/MacOS/Electron",
);

export interface OfflineFixture {
  readonly app: ElectronApplication;
  readonly page: Page;
  readonly userData: string;
}

/**
 * Test DOM keyboard ownership without requiring the background Electron window
 * to become the active macOS application.
 */
export async function isDomActiveElement(target: Locator): Promise<boolean> {
  return target.evaluate(
    (element) => element.ownerDocument.activeElement === element,
  );
}

const removeUserData = (userData: string): Promise<void> =>
  rm(userData, {
    recursive: true,
    force: true,
    maxRetries: 5,
    retryDelay: 100,
  });

export async function launchOffline(
  prefix: string,
  environment: Record<string, string> = {},
  prepare: (userData: string) => Promise<void> = async () => {},
): Promise<OfflineFixture> {
  const userData = await mkdtemp(path.join(tmpdir(), prefix));
  try {
    await prepare(userData);
    return await launchOfflineAt(userData, environment);
  } catch (error) {
    await removeUserData(userData);
    throw error;
  }
}

/**
 * Launch against one explicit verified client generation. Most tests should
 * use `launchOffline`: its empty cache reaches the network-free error state,
 * which is enough for shell and pre-ready module coverage. This helper is for
 * tests that genuinely cross the client/session/snapshot/glue boundary.
 */
export async function launchCachedClient(
  prefix: string,
  environment: Record<string, string> = {},
  prepare: (userData: string) => Promise<void> = async () => {},
  client: CachedClientOptions = {},
): Promise<OfflineFixture> {
  return launchOffline(prefix, environment, async (userData) => {
    await seedCachedClient({
      artifacts: path.join(userData, "game", "artifacts"),
      userData,
    }, {
      ...client,
      beforeSeal: async () => {
        await client.beforeSeal?.();
        await prepare(userData);
      },
    });
  });
}

/** Launch a cached client through the same readiness queue as production. */
export async function launchPlayableClient(
  prefix: string,
  environment: Record<string, string> = {},
  prepare: (userData: string) => Promise<void> = async () => {},
  client: CachedClientOptions = {},
): Promise<OfflineFixture> {
  return launchCachedClient(prefix, {
    GW_TEST_ALLOW_UNREADY_LAUNCH: "0",
    ...environment,
  }, prepare, client);
}

export async function launchOfflineAt(
  userData: string,
  environment: Record<string, string> = {},
): Promise<OfflineFixture> {
  // `process.env` is declared with optional values but only ever holds strings,
  // so copying it entry by entry is the same environment Electron would have
  // inherited, stated in the shape the launcher accepts.
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined) env[key] = value;
  }
  Object.assign(env, {
    // Keep the real Electron windows hidden while they render. Specs that
    // assert on native visibility, OS focus, pointer lock, or fullscreen pass
    // GW_BACKGROUND_LAUNCH: "0".
    GW_BACKGROUND_LAUNCH: "1",
    // Existing game-renderer tests can still exercise the shell's pre-ready
    // states. Production never reads this unpackaged-only launch seam.
    GW_TEST_ALLOW_UNREADY_LAUNCH: "1",
    ...environment,
    // Every default launch is offline by policy. With no seeded generation the
    // runtime publishes a normal `not_ready` failure; it never fabricates a
    // ready client for the test harness.
    GW_REQUIRE_CACHED_CLIENT: "1",
  });
  delete env.ELECTRON_RUN_AS_NODE;
  let app: ElectronApplication | null = null;
  try {
    app = await electron.launch({
      cwd: root,
      args: [".", `--user-data-dir=${userData}`],
      env,
      executablePath: electronBin,
    });
    const page = await app.firstWindow({ timeout: 30_000 });
    await page.waitForLoadState("domcontentloaded");
    if (environment.GW_TEST_RETURN_LAUNCHER === "1") {
      return { app, page, userData };
    }
    const profileId = await page.evaluate(async () =>
      (await window.launcherNative.state.get()).profiles.find(
        (profile) => !profile.archived,
      )?.id,
    );
    if (!profileId) throw new Error("launcher fixture has no active profile");
    const gamePage = app.waitForEvent("window", { timeout: 30_000 });
    await page.evaluate((id) => window.launcherNative.profiles.play([id]), profileId);
    const game = await gamePage;
    await game.waitForLoadState("domcontentloaded");
    return { app, page: game, userData };
  } catch (error) {
    if (!app) throw error;
    try {
      await stopElectron(app);
    } catch (cleanupError) {
      throw new AggregateError(
        [error, cleanupError],
        "Electron launch and cleanup both failed",
        { cause: cleanupError },
      );
    }
    throw error;
  }
}

async function waitForExit(
  child: ReturnType<ElectronApplication["process"]>,
  timeoutMs: number,
): Promise<boolean> {
  if (child.exitCode !== null || child.signalCode !== null) return true;
  return new Promise((resolve) => {
    const exited = () => {
      clearTimeout(timeout);
      resolve(true);
    };
    const timeout = setTimeout(() => {
      child.removeListener("exit", exited);
      resolve(false);
    }, timeoutMs);
    child.once("exit", exited);
  });
}

async function stopElectron(app: ElectronApplication): Promise<void> {
  let child: ReturnType<ElectronApplication["process"]>;
  try {
    child = app.process();
  } catch {
    // Playwright drops its process handle after an app has already exited.
    return;
  }
  const closed = await new Promise<boolean>((resolve) => {
    const finish = (value: boolean) => {
      clearTimeout(timeout);
      resolve(value);
    };
    const timeout = setTimeout(() => finish(false), 5_000);
    void app.close().then(
      () => finish(true),
      () => finish(false),
    );
  });
  if (!closed && child.exitCode === null && child.signalCode === null) {
    child.kill("SIGKILL");
  }
  if (await waitForExit(child, 5_000)) return;
  if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
  if (!(await waitForExit(child, 5_000))) {
    throw new Error("Electron process did not exit after SIGKILL");
  }
}

export async function closeOffline(fixture: OfflineFixture): Promise<void> {
  await stopElectron(fixture.app);
  await removeUserData(fixture.userData);
}

/**
 * Opens the one Settings window through the launcher's real bridge and returns its page.
 * Settings writes (tools, settings, texture packs, game files) live only on `settingsNative`.
 */
export async function openSettings(
  fixture: OfflineFixture,
  target?: { section: string; control?: string },
): Promise<Page> {
  const isSettings = (page: Page) => page.url().endsWith("/launcher/settings.html");
  const launcher = fixture.app.windows().find(page => page.url().endsWith("/launcher/index.html")) ?? fixture.page;
  const existing = fixture.app.windows().find(isSettings);
  const opened = existing ? null : fixture.app.waitForEvent("window", { predicate: isSettings, timeout: 15_000 });
  await launcher.evaluate(t => window.launcherNative.settings.open(t as never), target);
  const page = existing ?? await opened!;
  await page.waitForLoadState("domcontentloaded");
  await page.locator(".settings-page").waitFor();
  return page;
}

/**
 * Brings the game window forward. The application menu follows the focused window, and the
 * Settings window shows the launcher menu, so menu checks after a Settings write call this first.
 */
export async function focusGameWindow(app: ElectronApplication): Promise<void> {
  await app.evaluate(({ BrowserWindow, app: electronApp }) => {
    const game = BrowserWindow.getAllWindows().find(win => win.webContents.getURL() === "gw://app/");
    if (game && !game.isFocused()) {
      electronApp.focus({ steal: true });
      game.show();
      game.focus();
    }
  });
}
