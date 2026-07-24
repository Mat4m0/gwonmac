import { _electron as electron } from "@playwright/test";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
export const main = path.join(root, "build/main/main.js");

const electronBin = path.join(
  root,
  "node_modules/electron/dist/Electron.app/Contents/MacOS/Electron",
);

export async function launchOffline(
  prefix,
  environment = {},
  prepare = async () => {},
) {
  const userData = await mkdtemp(path.join(tmpdir(), prefix));
  await prepare(userData);
  const env = {
    ...process.env,
    GW_OFFLINE_SHELL: "1",
    ...environment,
  };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await electron.launch({
    cwd: root,
    args: [".", `--user-data-dir=${userData}`],
    env,
    executablePath: existsSync(electronBin) ? electronBin : undefined,
  });
  const page = await app.firstWindow({ timeout: 30_000 });
  await page.waitForLoadState("domcontentloaded");
  return { app, page, userData };
}

export async function closeOffline(fixture) {
  await fixture.app.close().catch(() => undefined);
  await rm(fixture.userData, { recursive: true, force: true });
}
