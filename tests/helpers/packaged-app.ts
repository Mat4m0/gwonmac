import { chromium, type Browser, type Page } from "playwright";
import { spawn, type ChildProcess } from "node:child_process";
import { readFile, rm } from "node:fs/promises";
import path from "node:path";
import type { ProfileId } from "../../src/shared/multiple-accounts.ts";

export interface RunningPackagedApp {
  readonly browser: Browser;
  readonly child: ChildProcess;
  /** Present only for the unified launcher-first application. */
  readonly launcherPage: Page | null;
  readonly page: Page;
}

export interface PackagedAppLaunch {
  readonly appPath: string;
  readonly productName: string;
  readonly userData: string;
  readonly environment?: Readonly<Record<string, string>>;
  readonly arguments?: readonly string[];
  /** Open the first active profile when the packaged app starts on the launcher. */
  readonly openFirstProfile?: boolean;
}

const delay = (milliseconds: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

async function waitUntil<T>(
  description: string,
  operation: () => Promise<T | null>,
): Promise<T> {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const value = await operation();
    if (value !== null) return value;
    await delay(50);
  }
  throw new Error(`timed out waiting for ${description}`);
}

async function waitForExit(child: ChildProcess, timeoutMs: number): Promise<boolean> {
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

const allPages = (browser: Browser): Page[] =>
  browser.contexts().flatMap((context) => context.pages());

async function isLauncherPage(page: Page): Promise<boolean> {
  return page.evaluate(() => location.pathname.endsWith("/launcher.html"));
}

async function waitForGamePage(
  browser: Browser,
  previousPages: ReadonlySet<Page>,
): Promise<Page> {
  return waitUntil("the packaged game window", async () => {
    for (const page of allPages(browser)) {
      if (previousPages.has(page) || page.isClosed()) continue;
      try {
        await page.waitForLoadState("domcontentloaded", { timeout: 250 });
        if (!(await isLauncherPage(page))) return page;
      } catch {
        // A renderer can disappear while CDP enumerates it. Keep polling.
      }
    }
    return null;
  });
}

/** Open one profile through the packaged launcher's validated preload API. */
export async function openPackagedProfile(
  running: RunningPackagedApp,
  profileId: ProfileId,
): Promise<Page> {
  const launcher = running.launcherPage;
  if (!launcher) {
    throw new Error("this packaged app has no unified launcher page");
  }
  const previousPages = new Set(allPages(running.browser));
  await launcher.evaluate((id) => {
    void window.gwNative.accounts.open([id]).catch(() => undefined);
  }, profileId);
  return waitForGamePage(running.browser, previousPages);
}

/**
 * Launch one already-packaged app against an explicit disposable profile.
 *
 * Release proofs cannot use Playwright's Electron launcher: that launcher
 * expects a development Electron binary, while these apps have production
 * fuses and signatures. The packaged binary owns its process; CDP supplies
 * only the same narrow renderer view the existing signed-runtime proof uses.
 */
export async function launchPackagedApp(
  options: PackagedAppLaunch,
): Promise<RunningPackagedApp> {
  const executablePath = path.join(
    options.appPath,
    `Contents/MacOS/${options.productName}`,
  );
  const activePort = path.join(options.userData, "DevToolsActivePort");
  await rm(activePort, { force: true });
  const child = spawn(
    executablePath,
    [
      `--user-data-dir=${options.userData}`,
      "--remote-debugging-address=127.0.0.1",
      "--remote-debugging-port=0",
      ...(options.arguments ?? []),
    ],
    {
      env: {
        ...process.env,
        // Signed-package checks exercise capabilities available before a game
        // client is active. Refuse network and reach the ordinary cached-client
        // error state instead of granting a test-only ready lifecycle.
        GW_REQUIRE_CACHED_CLIENT: "1",
        GW_BACKGROUND_LAUNCH: "1",
        ...options.environment,
      },
      stdio: "ignore",
    },
  );
  try {
    const port = await waitUntil("the packaged app DevTools port", async () => {
      if (child.exitCode !== null) {
        throw new Error(`packaged app exited with code ${child.exitCode}`);
      }
      try {
        return (await readFile(activePort, "utf8")).split("\n", 1)[0] ?? null;
      } catch {
        return null;
      }
    });
    const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
    const firstPage = await waitUntil("the packaged app window", async () => {
      for (const context of browser.contexts()) {
        const [first] = context.pages();
        if (first) return first;
      }
      return null;
    });
    await firstPage.waitForLoadState("domcontentloaded");
    const launcherPage = await isLauncherPage(firstPage) ? firstPage : null;
    const running: RunningPackagedApp = {
      browser,
      child,
      launcherPage,
      page: firstPage,
    };
    if (!launcherPage || options.openFirstProfile !== true) return running;

    const profileId = await launcherPage.evaluate(async () =>
      (await window.gwNative.accounts.get()).profiles.find(
        (profile) => !profile.archived,
      )?.id ?? null
    );
    if (!profileId) throw new Error("the packaged launcher has no active profile");
    return {
      ...running,
      page: await openPackagedProfile(running, profileId),
    };
  } catch (error) {
    child.kill("SIGTERM");
    throw error;
  }
}

/** Let the app own normal quit and escalate only if its bounded cleanup fails. */
export async function closePackagedApp(
  { browser, child, page }: RunningPackagedApp,
): Promise<void> {
  // Closing the unified launcher's game window deliberately leaves its
  // companion available. Ask the app to perform its normal coordinated quit
  // so release proofs cover shutdown and do not wait for a forced signal.
  await page.evaluate(() => window.gwNative.app.requestQuit()).catch(() => {});
  await page.close().catch(() => {});
  await browser.close().catch(() => {});
  if (await waitForExit(child, 6_000)) return;
  child.kill("SIGTERM");
  if (await waitForExit(child, 4_000)) return;
  child.kill("SIGKILL");
  if (!(await waitForExit(child, 4_000))) {
    throw new Error("packaged app did not exit after SIGKILL");
  }
}
