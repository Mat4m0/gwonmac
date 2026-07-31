import { chromium, type Browser, type Page } from "playwright";
import assert from "node:assert/strict";
import { execFile, spawn, type ChildProcess } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const sourceApp = process.env.GW_SIGNED_APP_PATH;
const signingKeychain = process.env.APPLE_KEYCHAIN;
if (!sourceApp || !signingKeychain) {
  throw new Error("GW_SIGNED_APP_PATH and APPLE_KEYCHAIN are required");
}

const identity = "7F9A56793C16683742AA7818FE65221A884FA108";
const entitlements = path.resolve("packaging/entitlements.release.plist");
const credentials = {
  username: "signed-runtime@example.invalid",
  password: "synthetic-signed-runtime-secret",
};
const profile = await mkdtemp(
  path.join(tmpdir(), "gw-signed-keychain-profile-"),
);
const appCopies = await mkdtemp(
  path.join(tmpdir(), "gw-signed-keychain-apps-"),
);
const settings = JSON.stringify({ autoCheckUpdates: false });
await writeFile(path.join(profile, "settings.json"), settings, { mode: 0o600 });
await writeFile(path.join(profile, "credentials.bin"), "retired");
await writeFile(path.join(profile, "steam-session.bin"), "retired");
await mkdir(path.join(profile, "game/chunks"), { recursive: true });
await writeFile(path.join(profile, "game/chunks/preserved"), "chunk-sentinel");

interface RunningApp {
  browser: Browser;
  child: ChildProcess;
  page: Page;
}

async function delay(milliseconds: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, milliseconds));
}

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

async function launch(appPath: string): Promise<RunningApp> {
  const executablePath = path.join(
    appPath,
    "Contents/MacOS/Guild Wars Reforged",
  );
  const activePort = path.join(profile, "DevToolsActivePort");
  await rm(activePort, { force: true });
  const child = spawn(
    executablePath,
    [
      `--user-data-dir=${profile}`,
      "--remote-debugging-address=127.0.0.1",
      "--remote-debugging-port=0",
    ],
    {
      env: {
        ...process.env,
        GW_OFFLINE_SHELL: "1",
        GW_BACKGROUND_LAUNCH: "1",
      },
      stdio: "ignore",
    },
  );
  try {
    const port = await waitUntil("the signed app DevTools port", async () => {
      if (child.exitCode !== null) {
        throw new Error(`signed app exited with code ${child.exitCode}`);
      }
      try {
        return (await readFile(activePort, "utf8")).split("\n", 1)[0] ?? null;
      } catch {
        return null;
      }
    });
    const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
    const page = await waitUntil("the signed app window", async () => {
      for (const context of browser.contexts()) {
        const [first] = context.pages();
        if (first) return first;
      }
      return null;
    });
    await page.waitForLoadState("domcontentloaded");
    return { browser, child, page };
  } catch (error) {
    child.kill("SIGTERM");
    throw error;
  }
}

async function closeApp({ browser, child, page }: RunningApp): Promise<void> {
  await page.close().catch(() => {});
  await browser.close().catch(() => {});
  if (child.exitCode !== null) return;
  child.kill("SIGTERM");
  await Promise.race([
    new Promise<void>((resolve) => child.once("exit", () => resolve())),
    delay(10_000),
  ]);
  if (child.exitCode === null) child.kill("SIGKILL");
}

async function useCredentials(
  appPath: string,
  action: "save-and-load" | "load" | "clear-and-load",
): Promise<unknown> {
  console.log(`signed keychain: ${action}: launching`);
  const running = await launch(appPath);
  try {
    console.log(`signed keychain: ${action}: invoking`);
    const result = await running.page.evaluate(
      async ({ action: next, value }) => {
        const api = (
          globalThis as unknown as {
            gwNative: {
              credentials: {
                load(): Promise<unknown>;
                save(value: unknown): Promise<void>;
                clear(): Promise<void>;
              };
            };
          }
        ).gwNative.credentials;
        if (next === "save-and-load") await api.save(value);
        if (next === "clear-and-load") await api.clear();
        return api.load();
      },
      { action, value: credentials },
    );
    console.log(`signed keychain: ${action}: completed`);
    return result;
  } finally {
    console.log(`signed keychain: ${action}: closing`);
    await closeApp(running);
    console.log(`signed keychain: ${action}: closed`);
  }
}

let cleanupApp = sourceApp;
try {
  assert.equal(
    await useCredentials(sourceApp, "load"),
    null,
    "refusing to overwrite an existing production credential",
  );
  assert.deepEqual(
    await useCredentials(sourceApp, "save-and-load"),
    credentials,
  );
  assert.deepEqual(
    await useCredentials(sourceApp, "load"),
    credentials,
    "the signed app did not retain credentials across relaunch",
  );

  const movedApp = path.join(appCopies, "moved", "Guild Wars Reforged.app");
  await mkdir(path.dirname(movedApp), { recursive: true });
  await execFileAsync("ditto", [sourceApp, movedApp]);
  cleanupApp = movedApp;
  assert.deepEqual(
    await useCredentials(movedApp, "load"),
    credentials,
    "moving the signed app changed its Keychain identity",
  );

  await writeFile(
    path.join(movedApp, "Contents/Resources/upgrade-proof"),
    "newly signed build",
  );
  await execFileAsync("codesign", [
    "--force",
    "--sign",
    identity,
    "--keychain",
    signingKeychain,
    "--options",
    "runtime",
    "--timestamp",
    "--entitlements",
    entitlements,
    movedApp,
  ]);
  await execFileAsync("codesign", ["--verify", "--deep", "--strict", movedApp]);
  assert.deepEqual(
    await useCredentials(movedApp, "load"),
    credentials,
    "a newly signed build could not read the existing Keychain item",
  );

  assert.equal(await useCredentials(movedApp, "clear-and-load"), null);
  assert.equal(
    await readFile(path.join(profile, "settings.json"), "utf8"),
    settings,
  );
  assert.equal(
    await readFile(path.join(profile, "game/chunks/preserved"), "utf8"),
    "chunk-sentinel",
  );
  console.log(
    "signed Data Protection Keychain survived relaunch, move, and upgrade",
  );
} finally {
  await useCredentials(cleanupApp, "clear-and-load").catch(() => {});
  await rm(profile, { recursive: true, force: true });
  await rm(appCopies, { recursive: true, force: true });
}
