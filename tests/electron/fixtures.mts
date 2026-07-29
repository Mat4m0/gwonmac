import {
  _electron as electron,
  type ElectronApplication,
  type Page,
} from "@playwright/test";
import { existsSync } from "node:fs";
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
    env,
    // Omitted rather than passed as `undefined`: a tree without the downloaded
    // binary falls back to Playwright's own resolution.
    ...(existsSync(electronBin) ? { executablePath: electronBin } : {}),
  });
  const page = await app.firstWindow({ timeout: 30_000 });
  await page.waitForLoadState("domcontentloaded");
  return { app, page, userData };
}

export async function closeOffline(fixture: OfflineFixture): Promise<void> {
  await fixture.app.close().catch(() => undefined);
  await rm(fixture.userData, { recursive: true, force: true });
}
