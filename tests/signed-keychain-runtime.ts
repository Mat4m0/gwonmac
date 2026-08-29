import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import {
  DISTRIBUTION_CHANNEL_CONFIG,
  isDistributionChannel,
} from "../src/shared/distribution-channel.ts";
import {
  closePackagedApp,
  launchPackagedApp,
  openPackagedProfile,
} from "./helpers/packaged-app.ts";
import { seedCachedClient } from "./helpers/cached-client.ts";

const execFileAsync = promisify(execFile);
const sourceApp = process.env.GW_SIGNED_APP_PATH;
const replacementApp = process.env.GW_SIGNED_REPLACEMENT_APP_PATH;
const signingKeychain = process.env.APPLE_KEYCHAIN;
const channel = process.env.GW_SIGNED_CHANNEL;
if (
  process.env.GITHUB_ACTIONS !== "true"
  && process.env.GW_ALLOW_LOCAL_SIGNED_KEYCHAIN_TEST !== "1"
) {
  throw new Error(
    "the signed Keychain test requires an ephemeral GitHub Actions runner or the explicit local signed-development test command",
  );
}
if (
  !sourceApp
  || !isDistributionChannel(channel)
  || (!replacementApp && !signingKeychain)
) {
  throw new Error(
    "GW_SIGNED_APP_PATH, a known GW_SIGNED_CHANNEL, and either GW_SIGNED_REPLACEMENT_APP_PATH or APPLE_KEYCHAIN are required",
  );
}

const identity = process.env.APPLE_SIGNING_IDENTITY;
if (!replacementApp && !identity) {
  throw new Error("APPLE_SIGNING_IDENTITY is required to create a replacement");
}
const channelConfig = DISTRIBUTION_CHANNEL_CONFIG[channel];
const entitlements = path.resolve(`packaging/entitlements.${channel}.plist`);
const credentials = {
  username: "signed-runtime@example.invalid",
  password: "synthetic-signed-runtime-secret",
};
const secondCredentials = {
  username: "signed-runtime-second@example.invalid",
  password: "synthetic-signed-runtime-second-secret",
};
// The only Steam-token writer is the main process's own interactive OAuth
// flow. The renderer's `steam.store` is the client's expiry storeback, and
// against an empty keychain it must be ignored — so this synthetic session is
// expected to be *refused*, proving a renderer cannot plant a Steam credential
// in the signed app.
const steamSession = {
  token: "synthetic-signed-runtime-steam-token",
  expiry: Date.now() + 86_400_000,
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
await seedCachedClient({
  artifacts: path.join(profile, "game/artifacts"),
  userData: profile,
});

type SecretAction =
  | "save-and-load"
  | "load"
  | "clear-and-load"
  | "clear-steam-and-load";

async function useSecrets(
  appPath: string,
  action: SecretAction,
  accountName = "Main account",
  accountCredentials = credentials,
): Promise<unknown> {
  console.log(`signed keychain: ${accountName}: ${action}: launching`);
  const running = await launchPackagedApp({
    appPath,
    productName: channelConfig.productName,
    userData: profile,
    openFirstProfile: true,
  });
  try {
    let gamePage = running.page;
    if (accountName !== "Main account") {
      const launcher = running.launcherPage;
      if (!launcher) throw new Error("the signed app did not expose the unified launcher");
      let target = (await launcher.evaluate(() => window.gwNative.accounts.get()))
        .profiles.find((candidate) => candidate.name === accountName);
      if (!target) {
        target = (await launcher.evaluate(
          (name) => window.gwNative.accounts.create({ name }),
          accountName,
        )).profiles.find((candidate) => candidate.name === accountName);
      }
      if (!target) throw new Error(`could not create signed test account ${accountName}`);
      gamePage = await openPackagedProfile(running, target.id);
    }
    console.log(`signed keychain: ${accountName}: ${action}: invoking`);
    const result = await gamePage.evaluate(
      async ({ action: next, value }) => {
        const api = (
          globalThis as unknown as {
            gwNative: {
              credentials: {
                load(): Promise<unknown>;
                save(value: unknown): Promise<void>;
                clear(): Promise<void>;
              };
              steam: {
                getToken(silent: boolean): Promise<{ token: string | null }>;
                store(token: string, expiry: number | null): Promise<void>;
                clear(): Promise<void>;
              };
            };
          }
        ).gwNative;
        if (next === "save-and-load") {
          await api.credentials.save(value.credentials);
          await api.steam.store(value.steam.token, value.steam.expiry);
        }
        if (next === "clear-and-load") {
          await api.credentials.clear();
          await api.steam.clear();
        }
        if (next === "clear-steam-and-load") await api.steam.clear();
        return {
          credentials: await api.credentials.load(),
          steam: await api.steam.getToken(true),
        };
      },
      { action, value: { credentials: accountCredentials, steam: steamSession } },
    );
    console.log(`signed keychain: ${accountName}: ${action}: completed`);
    return result;
  } finally {
    console.log(`signed keychain: ${accountName}: ${action}: closing`);
    await closePackagedApp(running);
    console.log(`signed keychain: ${accountName}: ${action}: closed`);
  }
}

let createdSyntheticMain = false;
let createdSyntheticSecond = false;
try {
  assert.deepEqual(
    await useSecrets(sourceApp, "load"),
    { credentials: null, steam: { token: null } },
    "refusing to overwrite an existing production credential",
  );
  createdSyntheticMain = true;
  assert.deepEqual(
    await useSecrets(sourceApp, "save-and-load"),
    { credentials, steam: { token: null } },
    "the renderer storeback planted a Steam token in an empty keychain",
  );
  assert.deepEqual(
    await useSecrets(sourceApp, "load"),
    { credentials, steam: { token: null } },
    "the signed app did not retain the credentials across relaunch",
  );
  assert.deepEqual(
    await useSecrets(sourceApp, "load", "Second account", secondCredentials),
    { credentials: null, steam: { token: null } },
    "a new profile inherited the adopted Main account credentials",
  );
  createdSyntheticSecond = true;
  assert.deepEqual(
    await useSecrets(sourceApp, "save-and-load", "Second account", secondCredentials),
    { credentials: secondCredentials, steam: { token: null } },
    "the second profile could not retain its isolated credentials",
  );
  assert.deepEqual(
    await useSecrets(sourceApp, "load"),
    { credentials, steam: { token: null } },
    "writing the second profile changed the adopted Main account credentials",
  );

  const movedApp = path.join(
    appCopies,
    "moved",
    `${channelConfig.productName}.app`,
  );
  await mkdir(path.dirname(movedApp), { recursive: true });
  await execFileAsync("ditto", [sourceApp, movedApp]);
  assert.deepEqual(
    await useSecrets(movedApp, "load"),
    { credentials, steam: { token: null } },
    "moving the signed app changed its Keychain identity",
  );

  let upgradedApp = replacementApp;
  if (!upgradedApp) {
    await writeFile(
      path.join(movedApp, "Contents/Resources/upgrade-proof"),
      "newly signed build",
    );
    await execFileAsync("codesign", [
      "--force",
      "--sign",
      identity!,
      "--keychain",
      signingKeychain!,
      "--options",
      "runtime",
      "--timestamp",
      "--entitlements",
      entitlements,
      movedApp,
    ]);
    upgradedApp = movedApp;
  }
  await execFileAsync("codesign", ["--verify", "--deep", "--strict", upgradedApp]);
  assert.deepEqual(
    await useSecrets(upgradedApp, "load"),
    { credentials, steam: { token: null } },
    "a newly signed build could not read the existing Keychain item",
  );
  assert.deepEqual(
    await useSecrets(upgradedApp, "load", "Second account", secondCredentials),
    { credentials: secondCredentials, steam: { token: null } },
    "a newly signed build could not read the isolated profile Keychain item",
  );

  assert.deepEqual(
    await useSecrets(upgradedApp, "clear-and-load", "Second account", secondCredentials),
    { credentials: null, steam: { token: null } },
    "the isolated profile Keychain item was not cleared",
  );
  createdSyntheticSecond = false;
  assert.deepEqual(
    await useSecrets(upgradedApp, "load"),
    { credentials, steam: { token: null } },
    "clearing one profile also cleared the adopted Main account",
  );

  assert.deepEqual(
    await useSecrets(upgradedApp, "clear-steam-and-load"),
    { credentials, steam: { token: null } },
    "clearing the Steam session slot also cleared independent credentials",
  );
  assert.deepEqual(
    await useSecrets(upgradedApp, "clear-and-load"),
    { credentials: null, steam: { token: null } },
  );
  createdSyntheticMain = false;
  if (channel === "release") {
    await assert.rejects(readFile(path.join(profile, "credentials.bin")));
    await assert.rejects(readFile(path.join(profile, "steam-session.bin")));
  } else {
    assert.equal(
      await readFile(path.join(profile, "credentials.bin"), "utf8"),
      "retired",
    );
    assert.equal(
      await readFile(path.join(profile, "steam-session.bin"), "utf8"),
      "retired",
    );
  }
  assert.equal(
    await readFile(path.join(profile, "settings.json"), "utf8"),
    settings,
  );
  assert.equal(
    await readFile(path.join(profile, "game/chunks/preserved"), "utf8"),
    "chunk-sentinel",
  );
  console.log(
    `signed ${channel} Data Protection Keychain survived relaunch, move, and upgrade; the renderer storeback never planted a Steam token`,
  );
} finally {
  if (createdSyntheticSecond) {
    await useSecrets(
      sourceApp,
      "clear-and-load",
      "Second account",
      secondCredentials,
    ).catch(() => {});
  }
  if (createdSyntheticMain) {
    await useSecrets(sourceApp, "clear-and-load").catch(() => {});
  }
  await rm(profile, { recursive: true, force: true });
  await rm(appCopies, { recursive: true, force: true });
}
