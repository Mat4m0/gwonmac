import {
  _electron as electron,
  expect,
  test as base,
  type ElectronApplication,
  type Page,
} from "@playwright/test";
import type { ChildProcess } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
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
const diagnosticsModule = path.join(root, "build/main/diagnostics.js");

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

let activeFixtureOwner: Set<OfflineFixture> | null = null;

async function attachFailureEvidence(
  fixture: OfflineFixture,
  index: number,
  outputPath: (name: string) => string,
  attach: (
    name: string,
    options: { path: string; contentType: string },
  ) => Promise<void>,
): Promise<void> {
  let main:
    | {
      reachable: true;
      windows: Array<{ crashed: boolean; destroyed: boolean }>;
      summary: unknown;
    }
    | { reachable: false };
  try {
    main = await fixture.app.evaluate(
      ({ BrowserWindow }, modulePath) => {
        const { createRequire } = process.getBuiltinModule("node:module");
        const load = createRequire(modulePath);
        const { diagnosticSummary } = load(modulePath) as {
          diagnosticSummary(): unknown;
        };
        return {
          reachable: true as const,
          windows: BrowserWindow.getAllWindows().map((window) => ({
            crashed: window.webContents.isCrashed(),
            destroyed: window.isDestroyed(),
          })),
          summary: diagnosticSummary(),
        };
      },
      diagnosticsModule,
    );
  } catch {
    main = { reachable: false };
  }
  const name = `electron-evidence-${index}.json`;
  const evidencePath = outputPath(name);
  await writeFile(
    evidencePath,
    JSON.stringify(
      {
        formatVersion: 1,
        process: {
          exited: processExited(fixture.process),
          exitCode: fixture.process.exitCode,
          signalCode: fixture.process.signalCode,
        },
        main,
      },
      null,
      2,
    ),
    { encoding: "utf8", mode: 0o600 },
  );
  await attach(name, {
    path: evidencePath,
    contentType: "application/json",
  });
}

export { expect };

export const test = base.extend<{ electronLifecycle: void }>({
  electronLifecycle: [
    // Playwright requires fixture dependencies to use an object pattern.
    // eslint-disable-next-line no-empty-pattern
    async ({}, use, testInfo) => {
      const owned = new Set<OfflineFixture>();
      let cleanupFailures: unknown[];
      activeFixtureOwner = owned;
      try {
        await use();
      } finally {
        const evidenceResults = await Promise.allSettled(
          [...owned].map((fixture, index) =>
            attachFailureEvidence(
              fixture,
              index,
              (name) => testInfo.outputPath(name),
              (name, options) => testInfo.attach(name, options),
            ),
          ),
        );
        const results = await Promise.allSettled(
          [...owned].reverse().map((fixture) => closeOffline(fixture)),
        );
        cleanupFailures = [...evidenceResults, ...results]
          .filter(
            (result): result is PromiseRejectedResult =>
              result.status === "rejected",
          )
          .map((result) => result.reason);
        activeFixtureOwner = null;
      }
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
    activeFixtureOwner?.add(fixture);
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
  if (options.removeUserData === false) {
    activeFixtureOwner?.delete(fixture);
  }
}
