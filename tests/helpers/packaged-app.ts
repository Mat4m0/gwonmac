import { chromium, type Browser, type Page } from "playwright";
import { spawn, type ChildProcess } from "node:child_process";
import { readFile, rm } from "node:fs/promises";
import path from "node:path";
import type { ProfileId } from "../../src/shared/multiple-accounts.ts";

export interface RunningPackagedApp {
  readonly browser: Browser;
  readonly child: ChildProcess;
  /** Bounded stdout/stderr retained for installed-package failure evidence. */
  readonly output: () => string;
  /** Present only for the unified launcher-first application. */
  readonly launcherPage: Page | null;
  readonly page: Page;
}

export interface PackagedAppLaunch {
  readonly appPath: string;
  readonly productName: string;
  /** Exact executable for installed Windows/Linux packages. */
  readonly executablePath?: string;
  /** Arguments a package manager needs before the Electron application args. */
  readonly executableArgumentsPrefix?: readonly string[];
  readonly userData: string;
  readonly environment?: Readonly<Record<string, string>>;
  readonly arguments?: readonly string[];
  /** Use the package's native platform roots instead of a user-data override. */
  readonly useDefaultUserData?: boolean;
  /** Launch as an OS desktop process while CDP connects through its port file. */
  readonly desktopProcessShape?: boolean;
  /** Let the Windows app initialize Crashpad before its qualification CDP port. */
  readonly appOwnedRemoteDebugging?: boolean;
  /** Open the first active profile when the packaged app starts on the launcher. */
  readonly openFirstProfile?: boolean;
}

const delay = (milliseconds: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

async function waitUntil<T>(
  description: string,
  operation: () => Promise<T | null>,
  timeoutMs = 30_000,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
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
  return page.evaluate(() => location.pathname.endsWith("/launcher/index.html"));
}

async function waitForGamePage(
  browser: Browser,
  previousPages: ReadonlySet<Page>,
  launchFailure: () => unknown,
): Promise<Page> {
  return waitUntil("the packaged game window", async () => {
    const failure = launchFailure();
    if (failure !== undefined) throw failure;
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
  }, 95_000);
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
  let launchFailure: unknown;
  // The first profile's Play promise settles only after that game proves its
  // presentation and client canary. A package proof needs the page in order
  // to exercise those renderer-owned steps, so observe an early rejection
  // while waiting for the window instead of deadlocking on the command first.
  void launcher.evaluate(
    (id) => window.launcherNative.profiles.play([id]),
    profileId,
  ).catch((error: unknown) => {
    launchFailure = error;
  });
  return waitForGamePage(
    running.browser,
    previousPages,
    () => launchFailure,
  );
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
  const executablePath = options.executablePath ?? path.join(
    options.appPath,
    `Contents/MacOS/${options.productName}`,
  );
  const activePort = path.join(options.userData, "DevToolsActivePort");
  await rm(activePort, { force: true });
  let capturedOutput = "";
  const capture = (chunk: Buffer) => {
    capturedOutput = `${capturedOutput}${chunk.toString("utf8")}`.slice(-65_536);
  };
  const child = spawn(
    executablePath,
    [
      ...(options.executableArgumentsPrefix ?? []),
      ...(options.useDefaultUserData === true
        ? []
        : [`--user-data-dir=${options.userData}`]),
      ...(options.appOwnedRemoteDebugging === true
        ? ["--gw-qualification-debugging"]
        : [
            "--remote-debugging-address=127.0.0.1",
            "--remote-debugging-port=0",
          ]),
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
      detached: options.desktopProcessShape === true,
      stdio: options.desktopProcessShape === true
        ? "ignore"
        : ["ignore", "pipe", "pipe"],
      windowsHide: options.desktopProcessShape === true,
    },
  );
  child.stdout?.on("data", capture);
  child.stderr?.on("data", capture);
  try {
    const port = await waitUntil("the packaged app DevTools port", async () => {
      if (child.exitCode !== null) {
        const detail = capturedOutput.trim();
        throw new Error(
          `packaged app exited with code ${child.exitCode}${detail ? `\n${detail}` : ""}`,
        );
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
      output: () => capturedOutput,
      launcherPage,
      page: firstPage,
    };
    if (!launcherPage || options.openFirstProfile !== true) return running;

    const profileId = await launcherPage.evaluate(async () =>
      (await window.launcherNative.state.get()).profiles.find(
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
  { browser, child, launcherPage, page }: RunningPackagedApp,
): Promise<void> {
  // A game-window quit closes only that profile; the unified launcher is
  // intentionally left alive. CDP's browser close is the automation
  // equivalent of quitting the application and reaches Electron's ordinary
  // before-quit cleanup. Older game-only package proofs retain their renderer
  // request because they have no companion window.
  if (launcherPage) {
    await Promise.race([
      browser.newBrowserCDPSession()
        .then((cdp) => cdp.send("Browser.close"))
        .catch(() => {}),
      delay(4_000),
    ]);
  } else {
    await Promise.race([
      page.evaluate(() => window.gwNative.app.requestQuit()).catch(() => {}),
      delay(4_000),
    ]);
  }
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
