/** Launch the intended checkout and prove its launcher identity before handoff. */
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { ElectronApplication } from "playwright";
import { defaultGuildWarsProfile } from "../src/tools/enhancement-workspace.js";
import { activeProfileOwner } from "./enhancements-live/profile-lock.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const launcherUrl = "gw://app/launcher/index.html";

export async function verifyDevelopmentApp(app: ElectronApplication, expectedRoot: string, expectedProfile: string) {
  const identity = await app.evaluate(({ app }) => ({
    root: app.getAppPath(), profile: app.getPath("userData"), pid: process.pid,
  }));
  if (await realpath(identity.root) !== await realpath(expectedRoot)
    || await realpath(identity.profile) !== await realpath(expectedProfile)) {
    throw new Error("Development app identity mismatch; no launcher handoff.");
  }
  const page = await app.firstWindow({ timeout: 30_000 });
  await page.waitForURL(launcherUrl, { timeout: 30_000 });
  await page.waitForLoadState("domcontentloaded");
  const visible = await app.evaluate(({ BrowserWindow }, url) => {
    const window = BrowserWindow.getAllWindows().find((candidate) => candidate.webContents.getURL() === url);
    if (!window) return false;
    if (window.isVisible()) return true;
    // DOM readiness can precede the native ready-to-show event. Observe the
    // actual show event instead of declaring success early or racing a snapshot.
    return new Promise<boolean>((resolve) => {
      const shown = () => { clearTimeout(timeout); resolve(true); };
      const timeout = setTimeout(() => {
        window.removeListener("show", shown);
        resolve(false);
      }, 10_000);
      window.once("show", shown);
    });
  }, launcherUrl);
  if (!visible) throw new Error("Development launcher is not visible; no launcher handoff.");
  return { ...identity, url: launcherUrl, status: "launcher-open" as const };
}

export async function launchDevelopmentApp(userData: string, cachedOnly: boolean) {
  const profile = await realpath(userData);
  const owner = await activeProfileOwner(profile);
  if (owner !== null) {
    throw new Error(`Profile already running (PID ${owner}); preserve that session instead of opening another app.`);
  }
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined) env[key] = value;
  }
  delete env.ELECTRON_RUN_AS_NODE;
  Object.assign(env, {
    GW_BACKGROUND_LAUNCH: "0", GW_EXPECT_USER_DATA: profile,
    GW_REQUIRE_CACHED_CLIENT: cachedOnly ? "1" : "0",
  });
  const { _electron: electron } = await import("playwright");
  const app = await electron.launch({
    cwd: root, args: [root, `--user-data-dir=${profile}`], env,
    timeout: 30_000,
  });
  try {
    const receipt = await verifyDevelopmentApp(app, root, profile);
    return { app, receipt };
  } catch (error) {
    await app.close();
    throw error;
  }
}

async function main() {
  const args = process.argv.slice(2).filter((arg) => arg !== "--");
  const usage = "usage: pnpm dev [--isolated | --profile PATH] [--cached-only]";
  if (args.length === 1 && args[0] === "--help") { console.log(usage); return; }
  let profileInput: string | undefined;
  let isolated = false;
  let cachedOnly = process.env.GW_REQUIRE_CACHED_CLIENT === "1";
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "--isolated" && !isolated && profileInput === undefined) isolated = true;
    else if (arg === "--profile" && !isolated && profileInput === undefined) {
      const value = args[++i];
      if (!value || value.startsWith("--")) throw new Error(usage);
      profileInput = value;
    } else if (arg === "--cached-only") cachedOnly = true;
    else throw new Error(usage);
  }
  // Reject bad or active explicit profiles before paying for a build. Recheck
  // ownership during launch because another process may start while building.
  let profile = profileInput === undefined ? undefined : await realpath(profileInput);
  if (!isolated) {
    profile ??= defaultGuildWarsProfile();
    const owner = await activeProfileOwner(profile);
    if (owner !== null) throw new Error(`Profile already running (PID ${owner}); preserve that session.`);
  }
  const build = spawnSync(process.execPath, ["scripts/build.mjs"], {
    cwd: root, stdio: "inherit",
  });
  if (build.error || build.status !== 0) throw new Error("Development build failed; app was not launched.");
  profile ??= await mkdtemp(path.join(tmpdir(), "gwonmac-dev-"));
  await mkdir(profile, { recursive: true });
  const { app, receipt } = await launchDevelopmentApp(profile, cachedOnly);
  // These are local developer coordinates, never production diagnostics.
  console.log(JSON.stringify(receipt));
  console.log("Launcher verified. Keep this command running. Reuse the printed profile on the next launch.");
  const close = () => { void app.close(); };
  process.once("SIGINT", close);
  process.once("SIGTERM", close);
  await app.waitForEvent("close", { timeout: 0 });
  process.removeListener("SIGINT", close);
  process.removeListener("SIGTERM", close);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : "Development launch failed.");
    process.exitCode = 1;
  });
}
