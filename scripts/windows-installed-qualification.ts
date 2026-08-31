/**
 * Install the exact unsigned Squirrel.Windows artifact on a fresh hosted
 * runner and exercise its real LocalAppData, launcher, game, and uninstall.
 */
import { execFile, spawn } from "node:child_process";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { promisify } from "node:util";
import {
  closePackagedApp,
  launchPackagedApp,
  openPackagedProfile,
  type RunningPackagedApp,
} from "../tests/helpers/packaged-app.js";
import { seedCachedClient } from "../tests/helpers/cached-client.js";
import { windowsStorageRoots } from "../src/main/core/paths.js";
import { DISTRIBUTION_CHANNEL_CONFIG } from "../src/shared/distribution-channel.js";
import type { ProfileId } from "../src/shared/multiple-accounts.js";
import { releaseUpdateArtifactName } from "../src/shared/project-identity.js";

const execFileAsync = promisify(execFile);
const root = path.resolve(import.meta.dirname, "..");
const release = DISTRIBUTION_CHANNEL_CONFIG.release;
const signedQualification = process.env.GW_WINDOWS_SIGNED_QUALIFICATION === "1";
const baselineFeed = process.env.GW_WINDOWS_BASELINE_FEED;
const candidateFeed = process.env.GW_WINDOWS_CANDIDATE_FEED;

const delay = (milliseconds: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

interface WindowsProcess {
  readonly ProcessId: number;
  readonly ParentProcessId: number;
  readonly CommandLine: string | null;
}

async function proveNormalCrashpadStartup(
  executable: string,
  arguments_: readonly string[],
): Promise<void> {
  let output = "";
  const child = spawn(executable, arguments_, {
    env: {
      ...process.env,
      ELECTRON_ENABLE_LOGGING: "1",
      GW_REQUIRE_CACHED_CLIENT: "1",
      GW_BACKGROUND_LAUNCH: "1",
    },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  const capture = (chunk: Buffer) => {
    output = `${output}${chunk.toString("utf8")}`.slice(-65_536);
  };
  child.stdout.on("data", capture);
  child.stderr.on("data", capture);
  try {
    await delay(5_000);
    assert.equal(
      child.exitCode,
      null,
      `the normal installed application exited before qualification\n${output.trim()}`,
    );
    assert.ok(child.pid, "the normal installed application has no process ID");
    const { stdout } = await execFileAsync(
      "powershell.exe",
      [
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        "Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,CommandLine | ConvertTo-Json -Compress",
      ],
      { encoding: "utf8", timeout: 30_000, windowsHide: true },
    );
    const parsed = JSON.parse(stdout) as WindowsProcess | WindowsProcess[];
    const processes = Array.isArray(parsed) ? parsed : [parsed];
    const descendants = new Set([child.pid]);
    let changed = true;
    while (changed) {
      changed = false;
      for (const candidate of processes) {
        if (
          descendants.has(candidate.ParentProcessId)
          && !descendants.has(candidate.ProcessId)
        ) {
          descendants.add(candidate.ProcessId);
          changed = true;
        }
      }
    }
    assert.ok(
      processes.some((candidate) =>
        descendants.has(candidate.ProcessId)
        && candidate.CommandLine?.includes("--type=crashpad-handler")
      ),
      "the normal installed application did not keep a Crashpad handler alive",
    );
  } finally {
    if (child.exitCode === null && child.pid) {
      await execFileAsync("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], {
        timeout: 30_000,
        windowsHide: true,
      }).catch(() => {});
    }
  }
}

function hostedWindowsRunner(): string {
  if (
    process.platform !== "win32"
    || process.arch !== "x64"
    || process.env.GITHUB_ACTIONS !== "true"
    || process.env.RUNNER_ENVIRONMENT !== "github-hosted"
  ) {
    throw new Error(
      "The installed Windows qualification runs only on a fresh GitHub-hosted Windows x64 runner",
    );
  }
  const localAppData = process.env.LOCALAPPDATA;
  if (!localAppData || !path.win32.isAbsolute(localAppData)) {
    throw new Error("LOCALAPPDATA is not an absolute Windows path");
  }
  return localAppData;
}

async function oneInstalledExecutable(
  packageRoot: string,
): Promise<string> {
  const candidates: string[] = [];
  for (const entry of await readdir(packageRoot, { withFileTypes: true })) {
    if (!entry.isDirectory() || !entry.name.startsWith("app-")) continue;
    const executable = path.join(
      packageRoot,
      entry.name,
      `${release.productName}.exe`,
    );
    if (existsSync(executable)) candidates.push(executable);
  }
  assert.equal(
    candidates.length,
    1,
    "the first Squirrel install must contain one application version",
  );
  return candidates[0]!;
}

async function oneSetup(feed: string): Promise<string> {
  const setups = (await readdir(feed))
    .filter((entry) => entry.endsWith("-Setup.exe"));
  assert.equal(setups.length, 1, `expected one Setup executable in ${feed}`);
  return path.join(feed, setups[0]!);
}

function installedExecutableForVersion(
  packageRoot: string,
  version: string,
): string {
  const executable = path.join(
    packageRoot,
    `app-${version}`,
    `${release.productName}.exe`,
  );
  assert.equal(existsSync(executable), true, `installed version ${version} is missing`);
  return executable;
}

async function waitForRunning(
  running: RunningPackagedApp,
  profileId: ProfileId,
): Promise<void> {
  const launcher = running.launcherPage;
  assert.ok(launcher, "the installed app did not expose its launcher");
  await launcher.waitForFunction(async (id) =>
    (await window.launcherNative.state.get()).profiles.find(
      (profile) => profile.id === id,
    )?.state === "running"
  , profileId, { timeout: 30_000 });
}

async function uninstall(updateExecutable: string): Promise<void> {
  await execFileAsync(updateExecutable, ["--uninstall", "-s"], {
    timeout: 120_000,
    windowsHide: true,
  });
}

const localAppData = hostedWindowsRunner();
const packageRoot = path.join(localAppData, release.windowsPackageId);
const storage = windowsStorageRoots(localAppData);
const setup = path.join(
  root,
  "out",
  "make",
  "squirrel.windows",
  "x64",
  releaseUpdateArtifactName(
    (JSON.parse(await readFile(path.join(root, "package.json"), "utf8")) as {
      version: string;
    }).version,
    "win32-x64",
  ),
);
assert.equal(existsSync(setup), true, "the Windows Setup executable is missing");
if (signedQualification && (!baselineFeed || !candidateFeed)) {
  throw new Error("signed qualification requires baseline and candidate feeds");
}
for (const candidate of [packageRoot, path.dirname(storage.config)]) {
  assert.equal(
    existsSync(candidate),
    false,
    `refusing to replace a pre-existing Windows fixture root: ${candidate}`,
  );
}

let running: RunningPackagedApp | null = null;
let installedExecutable: string | null = null;
try {
  const initialSetup = baselineFeed ? await oneSetup(baselineFeed) : setup;
  await execFileAsync(initialSetup, ["--silent"], {
    timeout: 120_000,
    windowsHide: true,
  });
  installedExecutable = await oneInstalledExecutable(packageRoot);
  const updateExecutable = path.join(packageRoot, "Update.exe");
  assert.equal(existsSync(updateExecutable), true, "Squirrel Update.exe is missing");

  await Promise.all([
    mkdir(storage.config, { recursive: true }),
    mkdir(storage.data, { recursive: true }),
    mkdir(storage.cache, { recursive: true }),
    mkdir(storage.state, { recursive: true }),
    mkdir(storage.logs, { recursive: true }),
    mkdir(storage.sessions, { recursive: true }),
  ]);
  await writeFile(
    path.join(storage.config, "launcher-mode.json"),
    `${JSON.stringify({ formatVersion: 1, mode: "single" })}\n`,
  );
  await writeFile(
    path.join(storage.config, "settings.json"),
    `${JSON.stringify({ autoCheckUpdates: false, gwonmacTools: true })}\n`,
  );
  await seedCachedClient({
    artifacts: path.join(storage.cache, "game", "artifacts"),
    chunks: path.join(storage.cache, "game", "chunks"),
    userData: storage.sessions,
  });

  const qualificationArguments = [
    "--disable-gpu",
    "--enable-logging=stderr",
    ...(signedQualification ? [] : ["--gw-volatile-secrets"]),
  ];
  await proveNormalCrashpadStartup(installedExecutable, qualificationArguments);

  running = await launchPackagedApp({
    appPath: packageRoot,
    executablePath: installedExecutable,
    productName: release.productName,
    userData: storage.sessions,
    // GitHub's hosted Windows service session has no stable accelerated
    // graphics context. Keep the Chromium sandbox enabled, but render this
    // package qualification in software so a runner-only GPU crash cannot
    // mask launcher, profile, storage, and uninstall behavior. The preceding
    // normal launch proves production Crashpad. CDP is test instrumentation
    // that starts before application JavaScript can connect that handler.
    arguments: [
      ...qualificationArguments,
      "--disable-crash-reporter",
    ],
    environment: { ELECTRON_ENABLE_LOGGING: "1" },
    useDefaultUserData: true,
  });
  const launcher = running.launcherPage;
  assert.ok(launcher, "the installed package did not open the Vue launcher");
  await launcher.locator('nav[aria-label="Main navigation"]').waitFor();
  const initial = await launcher.evaluate(async () => {
    const snapshot = await window.launcherNative.state.get();
    return {
      platform: snapshot.platform,
      setup: snapshot.experience.setup,
      profiles: snapshot.profiles.map(({ id, name }) => ({ id, name })),
    };
  });
  assert.equal(initial.platform, "windows");
  assert.equal(initial.setup, "complete");
  assert.deepEqual(initial.profiles.map(({ name }) => name), ["Main account"]);

  await launcher.evaluate(() =>
    window.launcherNative.profiles.create({ name: "Second account" })
  );
  const profiles = await launcher.evaluate(async () =>
    (await window.launcherNative.state.get()).profiles.map(
      ({ id, name }) => ({ id, name }),
    )
  );
  assert.deepEqual(profiles.map(({ name }) => name), [
    "Main account",
    "Second account",
  ]);
  const [mainProfile, secondProfile] = profiles;
  assert.ok(mainProfile && secondProfile);

  const mainGame = await openPackagedProfile(running, mainProfile.id);
  await waitForRunning(running, mainProfile.id);
  await mainGame.evaluate(() => localStorage.setItem("profile-proof", "main"));
  const secondGame = await openPackagedProfile(running, secondProfile.id);
  await waitForRunning(running, secondProfile.id);
  assert.equal(
    await secondGame.evaluate(() => localStorage.getItem("profile-proof")),
    null,
    "two installed profiles shared browser storage",
  );
  await secondGame.evaluate(() => localStorage.setItem("profile-proof", "second"));
  assert.equal(
    await mainGame.evaluate(() => localStorage.getItem("profile-proof")),
    "main",
  );
  if (signedQualification) {
    await mainGame.evaluate(() => window.gwNative.credentials.save({
      username: "main-qualified@example.invalid",
      password: "synthetic-main-password",
    }));
    await secondGame.evaluate(() => window.gwNative.credentials.save({
      username: "second-qualified@example.invalid",
      password: "synthetic-second-password",
    }));
    assert.deepEqual(await mainGame.evaluate(() => window.gwNative.credentials.load()), {
      username: "main-qualified@example.invalid",
      password: "synthetic-main-password",
    });
    assert.deepEqual(await secondGame.evaluate(() => window.gwNative.credentials.load()), {
      username: "second-qualified@example.invalid",
      password: "synthetic-second-password",
    });
  }

  const beforeShow = running.browser.contexts().flatMap(
    (context) => context.pages(),
  ).length;
  await launcher.evaluate((id) => window.launcherNative.profiles.show(id), mainProfile.id);
  assert.equal(
    running.browser.contexts().flatMap((context) => context.pages()).length,
    beforeShow,
    "Show created a duplicate game window",
  );
  const tools = await launcher.evaluate(async () =>
    (await window.launcherNative.state.get()).tools
  );
  assert.equal(tools.configured, true);
  assert.equal(tools.loaded, true);
  assert.deepEqual(Object.keys(tools.features).sort(), [
    "build-management",
    "quick-travel",
    "xunlai-storage",
  ]);

  const cdp = await running.browser.newBrowserCDPSession();
  const gpu = await cdp.send("SystemInfo.getInfo");
  assert.ok(gpu.gpu.devices.length > 0, "the installed renderer reported no GPU device");
  const processes = await cdp.send("SystemInfo.getProcessInfo");
  assert.ok(
    processes.processInfo.some((entry) => entry.type === "browser"),
    "the installed app reported no browser process",
  );

  await mainGame.close();
  await launcher.waitForFunction(async (id) =>
    (await window.launcherNative.state.get()).profiles.find(
      (profile) => profile.id === id,
    )?.state === "ready"
  , mainProfile.id);
  assert.equal(secondGame.isClosed(), false, "closing one account closed its peer");
  running = { ...running, page: secondGame };
  await closePackagedApp(running);
  running = null;

  if (signedQualification && baselineFeed && candidateFeed) {
    const brokenFeed = path.join(process.env.RUNNER_TEMP!, "windows-broken-update");
    await mkdir(brokenFeed, { recursive: true });
    await assert.rejects(execFileAsync(
      updateExecutable,
      ["--update", brokenFeed, "--silent"],
      { timeout: 120_000, windowsHide: true },
    ));
    assert.equal(
      existsSync(installedExecutable),
      true,
      "a refused update removed the installed baseline",
    );
    await execFileAsync(updateExecutable, ["--update", candidateFeed, "--silent"], {
      timeout: 120_000,
      windowsHide: true,
    });
    const candidateVersion = (
      JSON.parse(await readFile(path.join(root, "package.json"), "utf8")) as {
        version: string;
      }
    ).version;
    installedExecutable = installedExecutableForVersion(packageRoot, candidateVersion);
  }

  running = await launchPackagedApp({
    appPath: packageRoot,
    executablePath: installedExecutable,
    productName: release.productName,
    userData: storage.sessions,
    arguments: signedQualification ? [] : ["--gw-volatile-secrets"],
    useDefaultUserData: true,
  });
  const restartedLauncher = running.launcherPage;
  assert.ok(restartedLauncher);
  assert.deepEqual(
    await restartedLauncher.evaluate(async () =>
      (await window.launcherNative.state.get()).profiles.map(({ name }) => name)
    ),
    ["Main account", "Second account"],
    "the installed workspace did not survive restart",
  );
  const restartedMain = await openPackagedProfile(running, mainProfile.id);
  if (signedQualification) {
    assert.deepEqual(
      await restartedMain.evaluate(() => window.gwNative.credentials.load()),
      {
        username: "main-qualified@example.invalid",
        password: "synthetic-main-password",
      },
      "signed replacement lost the Main credential",
    );
    const restartedSecond = await openPackagedProfile(running, secondProfile.id);
    assert.deepEqual(
      await restartedSecond.evaluate(() => window.gwNative.credentials.load()),
      {
        username: "second-qualified@example.invalid",
        password: "synthetic-second-password",
      },
      "signed replacement lost the second profile credential",
    );
  }
  running = { ...running, page: restartedMain };
  await closePackagedApp(running);
  running = null;

  if (signedQualification && baselineFeed) {
    await uninstall(updateExecutable);
    await execFileAsync(await oneSetup(baselineFeed), ["--silent"], {
      timeout: 120_000,
      windowsHide: true,
    });
    installedExecutable = await oneInstalledExecutable(packageRoot);
    running = await launchPackagedApp({
      appPath: packageRoot,
      executablePath: installedExecutable,
      productName: release.productName,
      userData: storage.sessions,
      useDefaultUserData: true,
    });
    const rollbackLauncher = running.launcherPage;
    assert.ok(rollbackLauncher);
    assert.deepEqual(
      await rollbackLauncher.evaluate(async () =>
        (await window.launcherNative.state.get()).profiles.map(({ name }) => name)
      ),
      ["Main account", "Second account"],
      "the rollback install could not read the candidate workspace",
    );
    const rollbackMain = await openPackagedProfile(running, mainProfile.id);
    assert.deepEqual(
      await rollbackMain.evaluate(() => window.gwNative.credentials.load()),
      {
        username: "main-qualified@example.invalid",
        password: "synthetic-main-password",
      },
      "rollback lost the Main credential",
    );
    const rollbackSecond = await openPackagedProfile(running, secondProfile.id);
    assert.deepEqual(
      await rollbackSecond.evaluate(() => window.gwNative.credentials.load()),
      {
        username: "second-qualified@example.invalid",
        password: "synthetic-second-password",
      },
      "rollback lost the second credential",
    );
    await rollbackSecond.evaluate(() => window.gwNative.credentials.clear());
    assert.notEqual(
      await rollbackMain.evaluate(() => window.gwNative.credentials.load()),
      null,
      "clearing the second profile cleared Main",
    );
    await rollbackMain.evaluate(() => window.gwNative.credentials.clear());
    running = { ...running, page: rollbackMain };
    await closePackagedApp(running);
    running = null;
  }

  await uninstall(updateExecutable);
  assert.equal(
    existsSync(installedExecutable),
    false,
    "uninstall left the installed application executable behind",
  );
  assert.equal(
    existsSync(path.join(storage.config, "settings.json")),
    true,
    "uninstall removed player settings",
  );
  globalThis.console.log(JSON.stringify({
    platform: "win32-x64",
    package: "Squirrel.Windows installed",
    profiles: "isolated and restart-stable",
    tools: "loaded globally",
    credentials: signedQualification
      ? "isolated, update- and rollback-stable, and cleared"
      : "qualified separately through the native synthetic probe",
    updates: signedQualification
      ? "refused feed preserved baseline; candidate update and rollback passed"
      : "signed update round trip runs in the protected qualification",
    gpuProcess: "reported",
    uninstall: "application removed; player data preserved",
    unproven: [
      "native taskbar focus on physical Windows hardware",
      "hardware GPU performance and long-session memory",
      ...(signedQualification
        ? []
        : ["signed publisher identity", "installed update and rollback"]),
    ],
  }, null, 2));
} finally {
  if (running) await closePackagedApp(running).catch(() => {});
  if (installedExecutable && existsSync(path.join(packageRoot, "Update.exe"))) {
    await uninstall(path.join(packageRoot, "Update.exe")).catch(() => {});
  }
  await rm(path.dirname(storage.config), { recursive: true, force: true });
  await rm(packageRoot, { recursive: true, force: true });
}
