/** Exercise the exact repository-installed Flatpak with disposable app data. */
import { execFile } from "node:child_process";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import {
  closePackagedApp,
  launchPackagedApp,
  openPackagedProfile,
  type RunningPackagedApp,
} from "../tests/helpers/packaged-app.js";
import { seedCachedClient } from "../tests/helpers/cached-client.js";
import { DISTRIBUTION_CHANNEL_CONFIG } from "../src/shared/distribution-channel.js";
import type { ProfileId } from "../src/shared/multiple-accounts.js";

const execFileAsync = promisify(execFile);
const applicationId = DISTRIBUTION_CHANNEL_CONFIG.release.bundleId;
const secretQualification = process.env.GW_LINUX_SECRET_QUALIFICATION === "1";
const nativeWayland = process.env.GW_LINUX_NATIVE_WAYLAND === "1";
const baselineCommit = process.env.GW_LINUX_BASELINE_COMMIT;
const candidateCommit = process.env.GW_LINUX_CANDIDATE_COMMIT;
const qualificationRemote = process.env.GW_LINUX_QUALIFICATION_REMOTE;
const qualificationRemoteUrl = process.env.GW_LINUX_QUALIFICATION_REMOTE_URL;
const updateQualification = baselineCommit !== undefined
  || candidateCommit !== undefined
  || qualificationRemote !== undefined
  || qualificationRemoteUrl !== undefined;

if (
  updateQualification
  && (!baselineCommit || !candidateCommit || !qualificationRemote || !qualificationRemoteUrl)
) {
  throw new Error("Linux update qualification requires both commits, remote, and remote URL");
}

if (
  process.platform !== "linux"
  || process.arch !== "x64"
  || process.env.GITHUB_ACTIONS !== "true"
  || process.env.RUNNER_ENVIRONMENT !== "github-hosted"
) {
  throw new Error(
    "The installed Linux qualification runs only on a fresh GitHub-hosted Linux x64 runner",
  );
}

const home = os.homedir();
const appRoot = path.join(home, ".var", "app", applicationId);
const storage = {
  config: path.join(appRoot, "config", "gwonmac"),
  data: path.join(appRoot, "data", "gwonmac"),
  cache: path.join(appRoot, "cache", "gwonmac"),
  state: path.join(appRoot, ".local", "state", "gwonmac"),
  sessions: path.join(appRoot, "data", "gwonmac", "sessions"),
};

async function waitForRunning(
  running: RunningPackagedApp,
  profileId: ProfileId,
): Promise<void> {
  const launcher = running.launcherPage;
  assert.ok(launcher);
  await launcher.waitForFunction(async (id) =>
    (await window.launcherNative.state.get()).profiles.find(
      (profile) => profile.id === id,
    )?.state === "running"
  , profileId, { timeout: 30_000 });
}

async function launch(): Promise<RunningPackagedApp> {
  return launchPackagedApp({
    appPath: "",
    executablePath: "flatpak",
    executableArgumentsPrefix: ["run", "--user", applicationId],
    productName: DISTRIBUTION_CHANNEL_CONFIG.release.productName,
    userData: storage.sessions,
    useDefaultUserData: true,
    arguments: [
      "--enable-logging=stderr",
      ...(secretQualification ? [] : ["--gw-volatile-secrets"]),
      ...(nativeWayland ? ["--ozone-platform=wayland"] : []),
    ],
    environment: {
      // Flatpak exposes the app-owned XDG directories at their canonical
      // ~/.var/app path inside the sandbox. Assert the exact installed root;
      // /var/data is a flatpak-builder build path, not the runtime data home.
      GW_EXPECT_USER_DATA: storage.sessions,
      ELECTRON_ENABLE_LOGGING: "1",
      LIBGL_ALWAYS_SOFTWARE: "1",
    },
  });
}

async function installed(): Promise<boolean> {
  try {
    await execFileAsync("flatpak", ["info", "--user", applicationId]);
    return true;
  } catch {
    return false;
  }
}

async function flatpakIsRunning(): Promise<boolean> {
  const { stdout } = await execFileAsync(
    "flatpak",
    ["ps", "--columns=application"],
    { encoding: "utf8" },
  );
  return stdout.split(/\r?\n/u).some((line) => line.trim() === applicationId);
}

async function waitForFlatpakExit(): Promise<void> {
  const deadline = Date.now() + 15_000;
  while (await flatpakIsRunning()) {
    if (Date.now() >= deadline) {
      throw new Error(`the installed Flatpak did not exit normally: ${applicationId}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

async function installedCommit(): Promise<string> {
  const { stdout } = await execFileAsync(
    "flatpak",
    ["info", "--user", "--show-commit", applicationId],
    { encoding: "utf8" },
  );
  return stdout.trim();
}

async function qualifyUpdateRecovery(): Promise<void> {
  assert.ok(baselineCommit && candidateCommit && qualificationRemote && qualificationRemoteUrl);
  assert.equal(await installedCommit(), baselineCommit);
  const brokenUrl = `file://${path.join(os.tmpdir(), "missing-gwonmac-flatpak-repository")}`;
  await execFileAsync(
    "flatpak",
    ["remote-modify", "--user", `--url=${brokenUrl}`, qualificationRemote],
  );
  await assert.rejects(execFileAsync(
    "flatpak",
    ["update", "--user", "-y", `--commit=${candidateCommit}`, applicationId],
    { timeout: 120_000 },
  ));
  assert.equal(
    await installedCommit(),
    baselineCommit,
    "a failed Flatpak update changed the installed deployment",
  );
  await execFileAsync(
    "flatpak",
    ["remote-modify", "--user", `--url=${qualificationRemoteUrl}`, qualificationRemote],
  );
  await execFileAsync(
    "flatpak",
    ["update", "--user", "-y", `--commit=${candidateCommit}`, applicationId],
    { timeout: 120_000 },
  );
  assert.equal(await installedCommit(), candidateCommit);
}

async function rollBackInstalledPackage(): Promise<void> {
  assert.ok(baselineCommit);
  await execFileAsync(
    "flatpak",
    ["update", "--user", "-y", `--commit=${baselineCommit}`, applicationId],
    { timeout: 120_000 },
  );
  assert.equal(await installedCommit(), baselineCommit);
}

assert.equal(await installed(), true, "the signed Flatpak is not installed");
if (updateQualification) assert.equal(await installedCommit(), baselineCommit);
assert.equal(
  existsSync(appRoot),
  false,
  `refusing to replace pre-existing Flatpak data: ${appRoot}`,
);

let running: RunningPackagedApp | null = null;
try {
  await Promise.all(Object.values(storage).map((directory) =>
    mkdir(directory, { recursive: true })
  ));
  await writeFile(
    path.join(storage.config, "settings.json"),
    `${JSON.stringify({ autoCheckUpdates: true, gwonmacTools: true })}\n`,
    { mode: 0o600 },
  );
  await seedCachedClient({
    artifacts: path.join(storage.cache, "game", "artifacts"),
    chunks: path.join(storage.cache, "game", "chunks"),
    userData: storage.sessions,
  });

  running = await launch();
  const launcher = running.launcherPage;
  assert.ok(launcher, "the installed Flatpak did not open the Vue launcher");
  await launcher.locator('nav[aria-label="Main navigation"]').waitFor();
  const initial = await launcher.evaluate(async () => {
    const snapshot = await window.launcherNative.state.get();
    return {
      platform: snapshot.platform,
      appUpdate: snapshot.appUpdate,
      setup: snapshot.experience.setup,
      profiles: snapshot.profiles.map(({ id, name }) => ({ id, name })),
    };
  });
  assert.equal(initial.platform, "linux");
  assert.equal(initial.appUpdate.phase, "managed");
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

  let mainGame: Awaited<ReturnType<typeof openPackagedProfile>>;
  try {
    mainGame = await openPackagedProfile(running, mainProfile.id);
  } catch (error) {
    const evidence = await launcher.evaluate(async (id) => {
      const snapshot = await window.launcherNative.state.get();
      return {
        profile: snapshot.profiles.find((profile) => profile.id === id) ?? null,
        readiness: snapshot.readiness,
      };
    }, mainProfile.id);
    throw new Error(
      `the installed Flatpak did not open its first game window: ${JSON.stringify(evidence)}\n${running.output().trim()}`,
      { cause: error },
    );
  }
  await mainGame.evaluate(() => window.gwNative.client.readyToPresent());
  await waitForRunning(running, mainProfile.id);
  await mainGame.evaluate(() => localStorage.setItem("profile-proof", "main"));
  let secondGame: Awaited<ReturnType<typeof openPackagedProfile>>;
  try {
    secondGame = await openPackagedProfile(running, secondProfile.id);
  } catch (error) {
    const evidence = await launcher.evaluate(async (id) => {
      const snapshot = await window.launcherNative.state.get();
      return {
        profile: snapshot.profiles.find((profile) => profile.id === id) ?? null,
        readiness: snapshot.readiness,
      };
    }, secondProfile.id);
    throw new Error(
      `the installed Flatpak did not open its second game window: ${JSON.stringify(evidence)}\n${running.output().trim()}`,
      { cause: error },
    );
  }
  await secondGame.evaluate(() => window.gwNative.client.readyToPresent());
  await waitForRunning(running, secondProfile.id);
  assert.equal(
    await secondGame.evaluate(() => localStorage.getItem("profile-proof")),
    null,
    "two installed profiles shared browser storage",
  );

  if (secretQualification) {
    await mainGame.evaluate(() => window.gwNative.credentials.save({
      username: "main-linux-qualified@example.invalid",
      password: "synthetic-main-password",
    }));
    await secondGame.evaluate(() => window.gwNative.credentials.save({
      username: "second-linux-qualified@example.invalid",
      password: "synthetic-second-password",
    }));
    assert.equal(
      (await mainGame.evaluate(() => window.gwNative.credentials.load()))?.username,
      "main-linux-qualified@example.invalid",
    );
    assert.equal(
      (await secondGame.evaluate(() => window.gwNative.credentials.load()))?.username,
      "second-linux-qualified@example.invalid",
    );
    const mainEncrypted = await readFile(
      path.join(storage.data, "secrets", "arenaNetCredentials.secret"),
    );
    const secondEncrypted = await readFile(
      path.join(storage.data, "secrets", `multi.${secondProfile.id}.arenaNetCredentials.secret`),
    );
    assert.equal(mainEncrypted.includes(Buffer.from("synthetic-main-password")), false);
    assert.equal(secondEncrypted.includes(Buffer.from("synthetic-second-password")), false);
  }

  const tools = await launcher.evaluate(async () =>
    (await window.launcherNative.state.get()).tools
  );
  assert.equal(tools.loaded, true);
  assert.deepEqual(Object.keys(tools.features).sort(), [
    "build-management",
    "quick-travel",
    "xunlai-storage",
  ]);
  const cdp = await running.browser.newBrowserCDPSession();
  const gpu = await cdp.send("SystemInfo.getInfo");
  assert.ok(gpu.gpu.devices.length > 0, "the Flatpak reported no GPU device");

  await mainGame.close();
  assert.equal(secondGame.isClosed(), false, "closing one profile closed its peer");
  running = { ...running, page: secondGame };
  await closePackagedApp(running);
  running = null;
  await waitForFlatpakExit();

  if (updateQualification) await qualifyUpdateRecovery();

  running = await launch();
  const restartedLauncher = running.launcherPage;
  assert.ok(restartedLauncher);
  assert.deepEqual(
    await restartedLauncher.evaluate(async () =>
      (await window.launcherNative.state.get()).profiles.map(({ name }) => name)
    ),
    ["Main account", "Second account"],
  );
  const restartedMain = await openPackagedProfile(running, mainProfile.id);
  await restartedMain.evaluate(() => window.gwNative.client.readyToPresent());
  if (secretQualification) {
    assert.equal(
      (await restartedMain.evaluate(() => window.gwNative.credentials.load()))?.username,
      "main-linux-qualified@example.invalid",
    );
    await restartedMain.evaluate(() => window.gwNative.credentials.clear());
  }
  running = { ...running, page: restartedMain };
  await closePackagedApp(running);
  running = null;
  await waitForFlatpakExit();

  if (updateQualification) {
    await rollBackInstalledPackage();
    running = await launch();
    const rollbackLauncher = running.launcherPage;
    assert.ok(rollbackLauncher);
    assert.deepEqual(
      await rollbackLauncher.evaluate(async () =>
        (await window.launcherNative.state.get()).profiles.map(({ name }) => name)
      ),
      ["Main account", "Second account"],
      "the prior package could not read the candidate-preserved workspace",
    );
    await closePackagedApp(running);
    running = null;
    await waitForFlatpakExit();
  }

  await execFileAsync("flatpak", ["uninstall", "--user", "-y", applicationId]);
  assert.equal(await installed(), false);
  assert.equal(
    existsSync(path.join(storage.config, "settings.json")),
    true,
    "uninstall removed player data without explicit --delete-data",
  );
  console.log(JSON.stringify({
    platform: "linux-x64",
    package: "GPG-verified Flatpak installed",
    display: nativeWayland ? "native-wayland" : "xwayland",
    profiles: "isolated and restart-stable",
    tools: "loaded globally",
    credentials: secretQualification
      ? "portal-encrypted, isolated, and restart-stable"
      : "volatile in this smoke; portal runs in the signed desktop gate",
    updates: updateQualification
      ? "failed update recovered; upgraded and rolled back with data preserved"
      : "software-center managed",
    uninstall: "application removed; player data preserved",
  }, null, 2));
} finally {
  if (running) await closePackagedApp(running).catch(() => {});
  if (await installed()) {
    await execFileAsync("flatpak", ["uninstall", "--user", "-y", applicationId])
      .catch(() => {});
  }
  await rm(appRoot, { recursive: true, force: true });
}
