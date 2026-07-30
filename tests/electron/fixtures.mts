import {
  _electron as electron,
  type ElectronApplication,
  type Page,
} from "@playwright/test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

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
    await rm(userData, { recursive: true, force: true });
    throw error;
  }
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
    // Launch without taking keyboard focus. Specs that assert on real OS focus
    // (document.hasFocus, pointer lock, fullscreen) pass GW_BACKGROUND_LAUNCH: "0".
    GW_BACKGROUND_LAUNCH: "1",
    ...environment,
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
    return { app, page, userData };
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
  const child = app.process();
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
  await rm(fixture.userData, { recursive: true, force: true });
}
