import {
  _electron as electron,
  expect,
  test as base,
  type ElectronApplication,
  type Page,
} from "@playwright/test";
import { AsyncLocalStorage } from "node:async_hooks";
import type { ChildProcess } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { developmentElectronExecutable } from "../../scripts/electron-layout.js";

export const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
export const main = path.join(root, "build/main/main.js");

const electronBin = developmentElectronExecutable(root);

interface FixtureProcess {
  readonly pid?: number | undefined;
  readonly exitCode: number | null;
  readonly signalCode: NodeJS.Signals | null;
  once(
    event: "exit",
    listener: (code: number | null, signal: NodeJS.Signals | null) => void,
  ): unknown;
  off(
    event: "exit",
    listener: (code: number | null, signal: NodeJS.Signals | null) => void,
  ): unknown;
  kill(signal?: NodeJS.Signals | number): boolean;
}

interface ShutdownDeadlines {
  readonly graceful: number;
  readonly terminate: number;
  readonly kill: number;
}

const SHUTDOWN_DEADLINES: ShutdownDeadlines = {
  graceful: 10_000,
  terminate: 5_000,
  kill: 5_000,
};

export interface OfflineFixture {
  readonly app: ElectronApplication;
  readonly page: Page;
  readonly process: ChildProcess;
  readonly userData: string;
}

const fixtureOwner = new AsyncLocalStorage<Set<OfflineFixture>>();

export { expect };

export const test = base.extend<{ electronLifecycle: void }>({
  electronLifecycle: [
    // Playwright requires fixture dependencies to use an object pattern.
    // eslint-disable-next-line no-empty-pattern
    async ({}, use) => {
      const owned = new Set<OfflineFixture>();
      let cleanupFailures: unknown[] = [];
      await fixtureOwner.run(owned, async () => {
        try {
          await use();
        } finally {
          const results = await Promise.allSettled(
            [...owned].reverse().map((fixture) => closeOffline(fixture)),
          );
          cleanupFailures = results
            .filter(
              (result): result is PromiseRejectedResult =>
                result.status === "rejected",
            )
            .map((result) => result.reason);
        }
      });
      if (cleanupFailures.length > 0) {
        throw new AggregateError(
          cleanupFailures,
          `${cleanupFailures.length} Electron fixture cleanup(s) failed`,
        );
      }
    },
    { auto: true, timeout: 25_000 },
  ],
});

export async function launchOffline(
  prefix: string,
  environment: Record<string, string> = {},
  prepare: (userData: string) => Promise<void> = async () => {},
): Promise<OfflineFixture> {
  const userData = await mkdtemp(path.join(tmpdir(), prefix));
  await prepare(userData);
  return launchOfflineAt(userData, environment);
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
    GW_OFFLINE_SHELL: "1",
    GW_TEST_DIRECT_GAME: "1",
    // Launch without taking keyboard focus. Specs that assert on real OS focus
    // (document.hasFocus, pointer lock, fullscreen) pass GW_BACKGROUND_LAUNCH: "0".
    GW_BACKGROUND_LAUNCH: "1",
    ...environment,
  });
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await electron.launch({
    cwd: root,
    args: [".", `--user-data-dir=${userData}`],
    chromiumSandbox: true,
    env,
    executablePath: electronBin,
  });
  const childProcess = app.process();
  try {
    const page = await app.firstWindow({ timeout: 30_000 });
    await page.waitForLoadState("domcontentloaded");
    const fixture = { app, page, process: childProcess, userData };
    fixtureOwner.getStore()?.add(fixture);
    return fixture;
  } catch (error) {
    await shutdownFixtureProcess(childProcess, () => app.close()).catch(() => undefined);
    await rm(userData, { recursive: true, force: true }).catch(() => undefined);
    throw error;
  }
}

function processExited(process: FixtureProcess): boolean {
  return process.exitCode !== null || process.signalCode !== null;
}

async function waitForProcessExit(
  process: FixtureProcess,
  timeout: number,
): Promise<boolean> {
  if (processExited(process)) return true;
  return new Promise<boolean>((resolve) => {
    const timer = setTimeout(() => finish(processExited(process)), timeout);
    const finish = (exited: boolean): void => {
      clearTimeout(timer);
      process.off("exit", onExit);
      resolve(exited);
    };
    const onExit = (): void => finish(true);
    process.once("exit", onExit);
    // Close the check/listener race without leaving another turn in which an
    // already-dead process can strand this promise.
    if (processExited(process)) {
      finish(true);
      return;
    }
  });
}

export async function shutdownFixtureProcess(
  process: FixtureProcess,
  requestClose: () => Promise<void>,
  deadlines: ShutdownDeadlines = SHUTDOWN_DEADLINES,
): Promise<"graceful" | "terminated" | "killed"> {
  void requestClose().catch(() => undefined);
  if (await waitForProcessExit(process, deadlines.graceful)) return "graceful";

  process.kill("SIGTERM");
  if (await waitForProcessExit(process, deadlines.terminate)) return "terminated";

  process.kill("SIGKILL");
  if (await waitForProcessExit(process, deadlines.kill)) return "killed";

  throw new Error(
    `Electron fixture process${process.pid ? ` ${process.pid}` : ""} did not exit`,
  );
}

export async function closeOffline(
  fixture: OfflineFixture,
  options: { removeUserData?: boolean } = {},
): Promise<void> {
  await shutdownFixtureProcess(fixture.process, () => fixture.app.close());
  if (options.removeUserData !== false) {
    await rm(fixture.userData, {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 100,
    });
  }
  fixtureOwner.getStore()?.delete(fixture);
}
